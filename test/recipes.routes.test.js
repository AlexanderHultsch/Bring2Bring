import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser } from '../src/repositories/users.js';
import { insertRecipe } from '../src/repositories/recipes.js';

const PASSWORD = 'correct-horse-battery';

const testEnv = () => ({
  SESSION_SECRET: 'a'.repeat(16),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'super-secret-password',
  PUBLIC_BASE_URL: 'https://dishlist.example.com',
  NODE_ENV: 'test',
});

async function withApp(fn) {
  const { db, cleanup } = createTestDb();
  try {
    const config = loadConfig(testEnv());
    const app = createApp({ db, config });
    await fn(app, db);
  } finally {
    cleanup();
  }
}

function csrfFieldFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'expected a hidden _csrf field in the response HTML');
  return match[1];
}

async function seedUser(db, username) {
  const passwordHash = await hashPassword(PASSWORD);
  return insertUser(db, { username, passwordHash });
}

async function loginAgent(app, username) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/login');
  const csrfToken = csrfFieldFrom(loginPage.text);
  await agent.post('/login').type('form').send({ _csrf: csrfToken, username, password: PASSWORD });
  return agent;
}

async function csrfFor(agent, path) {
  const page = await agent.get(path);
  return csrfFieldFrom(page.text);
}

function toFormPairs(value, prefix) {
  const pairs = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => pairs.push(...toFormPairs(item, `${prefix}[${index}]`)));
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      pairs.push(...toFormPairs(value[key], prefix ? `${prefix}[${key}]` : key));
    }
  } else if (value !== undefined) {
    pairs.push([prefix, String(value)]);
  }
  return pairs;
}

// supertest/superagent's own `.send(object)` nested-array serialization does not
// match the qs encoding our server expects (it drops array indices), so form
// posts carrying nested groups/ingredients/steps are encoded by hand here.
function encodeForm(body) {
  return toFormPairs(body, '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function recipeIdFromLocation(location) {
  return Number(location.split('?')[0].split('/').filter(Boolean).pop());
}

function ingredientCount(db, recipeId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM ingredients i
       JOIN ingredient_groups g ON g.id = i.group_id
       WHERE g.recipe_id = ?`
    )
    .get(recipeId).c;
}

function scalingRecipeBody(overrides = {}) {
  return {
    title: 'Scalable Soup',
    yield_amount: '4',
    yield_unit: 'servings',
    groups: [
      {
        name: 'Base',
        ingredients: [
          { name: 'Flour', amount: '250', unit: 'g', scales: true },
          { name: 'Salt', amount: '10', unit: 'g' },
        ],
      },
    ],
    steps: [{ text: 'Mix.' }],
    ...overrides,
  };
}

async function createScalingRecipe(agent, overrides) {
  const csrfToken = await csrfFor(agent, '/recipes/new');
  const createRes = await agent
    .post('/recipes')
    .type('form')
    .send(encodeForm({ _csrf: csrfToken, ...scalingRecipeBody(overrides) }));
  return recipeIdFromLocation(createRes.headers.location);
}

function basicRecipeBody(overrides = {}) {
  return {
    title: 'Tomato Soup',
    yield_amount: '4',
    yield_unit: 'servings',
    groups: [
      {
        name: 'Base',
        ingredients: [
          { name: 'Tomatoes', amount: '500', unit: 'g' },
          { name: 'Onion', amount: '1' },
        ],
      },
      {
        name: 'Topping',
        ingredients: [{ name: 'Basil' }],
      },
    ],
    steps: [{ text: 'Chop the vegetables.' }, { text: 'Simmer for 20 minutes.' }],
    ...overrides,
  };
}

test('GET /, /recipes/new, /recipes/:id, /recipes/:id/edit unauthenticated all redirect 302 to /login', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    for (const path of ['/', '/recipes/new', `/recipes/${recipe.id}`, `/recipes/${recipe.id}/edit`]) {
      const res = await request(app).get(path);
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.location, '/login', path);
    }
  });
});

test('POST /recipes creates a recipe with two groups, ingredients and steps; GET /recipes/:id shows them', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));
    assert.equal(createRes.status, 302);
    assert.match(createRes.headers.location, /^\/recipes\/\d+\?saved=new$/);

    const showRes = await agent.get(createRes.headers.location);
    assert.equal(showRes.status, 200);
    assert.match(showRes.text, /Tomatoes/);
    assert.match(showRes.text, /Onion/);
    assert.match(showRes.text, /Basil/);
    assert.match(showRes.text, /Chop the vegetables\./);
    assert.match(showRes.text, /Simmer for 20 minutes\./);
  });
});

test('a submitted ingredient row with a blank name is dropped, not stored', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({
      groups: [
        {
          name: 'Base',
          ingredients: [
            { name: 'Tomatoes', amount: '500' },
            { name: '   ', amount: '1' },
          ],
        },
      ],
    });

    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(createRes.status, 302);
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    assert.equal(ingredientCount(db, recipeId), 1);
  });
});

test('a recipe posted with 25 ingredients in one group stores all 25', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const ingredients = Array.from({ length: 25 }, (_, i) => ({ name: `Ingredient ${i + 1}` }));
    const body = {
      title: 'Big recipe',
      yield_amount: '4',
      yield_unit: 'servings',
      groups: [{ name: 'All', ingredients }],
      steps: [{ text: 'Do it.' }],
    };

    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(createRes.status, 302);
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    assert.equal(ingredientCount(db, recipeId), 25);
  });
});

test("'1,5' in an amount field is stored as the number 1.5", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({
      groups: [{ name: 'Base', ingredients: [{ name: 'Milk', amount: '1,5', unit: 'l' }] }],
    });

    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(createRes.status, 302);
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const row = db
      .prepare(
        `SELECT amount FROM ingredients i
         JOIN ingredient_groups g ON g.id = i.group_id
         WHERE g.recipe_id = ?`
      )
      .get(recipeId);
    assert.equal(row.amount, 1.5);
  });
});

test('a non-numeric prep_minutes re-renders the editor with status 422 and the submitted title still present in the HTML', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({ prep_minutes: 'soon' });

    const res = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(res.status, 422);
    assert.match(res.text, /Tomato Soup/);
  });
});

test("GET /recipes/:id for another user's recipe returns 404", async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Secret Soup' });

    const agent = await loginAgent(app, 'stranger');
    const res = await agent.get(`/recipes/${recipe.id}`);
    assert.equal(res.status, 404);
  });
});

test("POST /recipes/:id for another user's recipe returns 404 and does not modify it", async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Secret Soup' });

    const agent = await loginAgent(app, 'stranger');
    const csrfToken = await csrfFor(agent, '/');

    const res = await agent
      .post(`/recipes/${recipe.id}`)
      .type('form')
      .send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody({ title: 'Hijacked' }) }));

    assert.equal(res.status, 404);

    const stored = db.prepare('SELECT title FROM recipes WHERE id = ?').get(recipe.id);
    assert.equal(stored.title, 'Secret Soup');
  });
});

test('POST /recipes/:id/delete archives on the first call and hard-deletes on the second', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const firstCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    const firstDelete = await agent
      .post(`/recipes/${recipeId}/delete`)
      .type('form')
      .send({ _csrf: firstCsrf });
    assert.equal(firstDelete.status, 302);
    assert.equal(firstDelete.headers.location, `/recipes/${recipeId}`);
    assert.equal(db.prepare('SELECT is_archived FROM recipes WHERE id = ?').get(recipeId).is_archived, 1);

    const secondCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    const secondDelete = await agent
      .post(`/recipes/${recipeId}/delete`)
      .type('form')
      .send({ _csrf: secondCsrf });
    assert.equal(secondDelete.status, 302);
    assert.equal(secondDelete.headers.location, '/');

    const getRes = await agent.get(`/recipes/${recipeId}`);
    assert.equal(getRes.status, 404);
  });
});

test('POST /recipes/:id/duplicate creates a second recipe owned by the acting user with a (Copy) title and no share token', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const dupCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    const dupRes = await agent.post(`/recipes/${recipeId}/duplicate`).type('form').send({ _csrf: dupCsrf });
    assert.equal(dupRes.status, 302);
    const dupId = recipeIdFromLocation(dupRes.headers.location);
    assert.notEqual(dupId, recipeId);

    const stored = db.prepare('SELECT title, owner_id, share_token FROM recipes WHERE id = ?').get(dupId);
    assert.equal(stored.title, 'Tomato Soup (Copy)');
    assert.equal(stored.share_token, null);

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('alex');
    assert.equal(stored.owner_id, user.id);
  });
});

test('POST /recipes/:id/duplicate copies the tags: a recipe with two tags produces a copy carrying the same two tag ids', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody({ tags: 'quick, italian' }) }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const dupCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    const dupRes = await agent.post(`/recipes/${recipeId}/duplicate`).type('form').send({ _csrf: dupCsrf });
    assert.equal(dupRes.status, 302);
    const dupId = recipeIdFromLocation(dupRes.headers.location);

    const originalTagIds = db
      .prepare('SELECT tag_id FROM recipe_tags WHERE recipe_id = ? ORDER BY tag_id')
      .all(recipeId)
      .map((row) => row.tag_id);
    const copyTagIds = db
      .prepare('SELECT tag_id FROM recipe_tags WHERE recipe_id = ? ORDER BY tag_id')
      .all(dupId)
      .map((row) => row.tag_id);

    assert.equal(originalTagIds.length, 2);
    assert.deepEqual(copyTagIds, originalTagIds);
  });
});

test('the archive toggle link in the rendered list preserves an active q and sort', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const listRes = await agent.get('/?q=Tomato&sort=title');
    assert.equal(listRes.status, 200);

    const match = listRes.text.match(/class="button button--ghost" href="([^"]+)"/);
    assert.ok(match, 'expected the archive toggle link in the HTML');
    const href = match[1].replace(/&amp;/g, '&');

    assert.match(href, /^\/\?/);
    const params = new URLSearchParams(href.slice(2));
    assert.equal(params.get('q'), 'Tomato');
    assert.equal(params.get('sort'), 'title');
    assert.equal(params.get('archived'), '1');
  });
});

test('the archived recipe does not appear in GET / but does appear in GET /?archived=1', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const deleteCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/delete`).type('form').send({ _csrf: deleteCsrf });

    const listRes = await agent.get('/');
    assert.ok(!listRes.text.includes('Tomato Soup'));

    const archiveRes = await agent.get('/?archived=1');
    assert.ok(archiveRes.text.includes('Tomato Soup'));
  });
});

test('GET /recipes/not-a-number returns 404', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const res = await agent.get('/recipes/not-a-number');
    assert.equal(res.status, 404);
  });
});

test('POST /recipes on success redirects to /recipes/:id?saved=new', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));
    assert.equal(createRes.status, 302);
    assert.match(createRes.headers.location, /^\/recipes\/\d+\?saved=new$/);
  });
});

test('POST /recipes/:id on success redirects to /recipes/:id?saved=1', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const editCsrf = await csrfFor(agent, `/recipes/${recipeId}/edit`);
    const updateRes = await agent
      .post(`/recipes/${recipeId}`)
      .type('form')
      .send(encodeForm({ _csrf: editCsrf, ...basicRecipeBody({ title: 'Tomato Soup, Updated' }) }));
    assert.equal(updateRes.status, 302);
    assert.match(updateRes.headers.location, /^\/recipes\/\d+\?saved=1$/);
  });
});

test('GET /recipes/:id?saved=new renders HTML containing data-saved="new"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const showRes = await agent.get(`/recipes/${recipeId}?saved=new`);
    assert.equal(showRes.status, 200);
    assert.match(showRes.text, /data-saved="new"/);
  });
});

test('GET /recipes/:id with no query renders HTML containing data-saved=""', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const showRes = await agent.get(`/recipes/${recipeId}`);
    assert.equal(showRes.status, 200);
    assert.match(showRes.text, /data-saved=""/);
  });
});

test("creating a recipe with tags: 'Pasta, quick , Pasta' stores exactly two tags, trimmed and de-duplicated", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({ tags: 'Pasta, quick , Pasta' });
    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(createRes.status, 302);
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const tagNames = db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN recipe_tags rt ON rt.tag_id = t.id
         WHERE rt.recipe_id = ?
         ORDER BY t.name`
      )
      .all(recipeId)
      .map((row) => row.name);
    assert.deepEqual(tagNames, ['Pasta', 'quick']);
  });
});

test('GET /?q=<ingredient name> finds a recipe by an ingredient name, not just a title', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const listRes = await agent.get('/?q=Basil');
    assert.equal(listRes.status, 200);
    assert.match(listRes.text, /Tomato Soup/);
  });
});

test('GET /?q=<tag name> finds a recipe by a tag name', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody({ tags: 'weeknight' }) }));

    const listRes = await agent.get('/?q=weeknight');
    assert.equal(listRes.status, 200);
    assert.match(listRes.text, /Tomato Soup/);
  });
});

test('GET /?q=<term matching another user\'s recipe> does not return that recipe', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    insertRecipe(db, owner.id, { title: 'Secret Chili' });

    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const listRes = await agent.get('/?q=Secret Chili');
    assert.equal(listRes.status, 200);
    assert.ok(!listRes.text.includes('recipe-list__title">Secret Chili'));
  });
});

test("GET /?q=100%25 does not match a recipe titled 'Plain' (the LIKE wildcard is escaped)", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody({ title: 'Plain' }) }));

    const listRes = await agent.get('/?q=100%25');
    assert.equal(listRes.status, 200);
    assert.ok(!listRes.text.includes('Plain'));
  });
});

test('GET /?tag=<id> filters to recipes carrying that tag; two tag params return only recipes carrying both', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const csrf1 = await csrfFor(agent, '/recipes/new');
    await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrf1, ...basicRecipeBody({ title: 'Soup A', tags: 'quick, italian' }) }));

    const csrf2 = await csrfFor(agent, '/recipes/new');
    await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrf2, ...basicRecipeBody({ title: 'Soup B', tags: 'quick' }) }));

    const quickTag = db.prepare("SELECT id FROM tags WHERE name = 'quick'").get();
    const italianTag = db.prepare("SELECT id FROM tags WHERE name = 'italian'").get();

    const quickRes = await agent.get(`/?tag=${quickTag.id}`);
    assert.match(quickRes.text, /Soup A/);
    assert.match(quickRes.text, /Soup B/);

    const bothRes = await agent.get(`/?tag=${quickTag.id}&tag=${italianTag.id}`);
    assert.match(bothRes.text, /Soup A/);
    assert.ok(!bothRes.text.includes('Soup B'));
  });
});

test('GET /?sort=title orders alphabetically ignoring case; GET /?sort=nonsense behaves like the default', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const csrf1 = await csrfFor(agent, '/recipes/new');
    await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrf1, ...basicRecipeBody({ title: 'zucchini bake' }) }));

    const csrf2 = await csrfFor(agent, '/recipes/new');
    await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrf2, ...basicRecipeBody({ title: 'Apple Pie' }) }));

    const titleRes = await agent.get('/?sort=title');
    const applePos = titleRes.text.indexOf('Apple Pie');
    const zucchiniPos = titleRes.text.indexOf('zucchini bake');
    assert.ok(applePos !== -1 && zucchiniPos !== -1);
    assert.ok(applePos < zucchiniPos);

    const defaultRes = await agent.get('/');
    const nonsenseRes = await agent.get('/?sort=nonsense');
    assert.equal(nonsenseRes.text, defaultRes.text);
  });
});

test('a search matching nothing renders the "no recipes match" state, not the "no recipes at all" state', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/?q=nonexistentterm');
    assert.equal(res.status, 200);
    assert.match(res.text, /no recipes match/i);
    assert.ok(!res.text.includes('Add your first recipe'));
  });
});

test('GET /recipes/:id?saved=<script> does not reflect the query value into the page', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const createCsrf = await csrfFor(agent, '/recipes/new');
    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: createCsrf, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const showRes = await agent.get(`/recipes/${recipeId}?saved=${encodeURIComponent('<script>alert(1)</script>')}`);
    assert.equal(showRes.status, 200);
    assert.match(showRes.text, /data-saved=""/);
    assert.ok(!showRes.text.includes('alert(1)'));
  });
});

test('GET /recipes/:id?yield=6 on a recipe with base yield 4 and a 250 g ingredient renders 375 g', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}?yield=6`);
    assert.equal(res.status, 200);
    assert.match(res.text, /375 g/);
  });
});

test('GET /recipes/:id (no yield) renders 250 g', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /250 g/);
  });
});

test('?yield=0, ?yield=-5, ?yield=abc, ?yield=99999 each fall back to the base yield and return 200', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    for (const badYield of ['0', '-5', 'abc', '99999']) {
      const res = await agent.get(`/recipes/${recipeId}?yield=${encodeURIComponent(badYield)}`);
      assert.equal(res.status, 200, `?yield=${badYield}`);
      assert.match(res.text, /250 g/, `?yield=${badYield}`);
    }
  });
});

test('the ingredient element carries data-amount="250", the base value, not the scaled one', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}?yield=6`);
    assert.equal(res.status, 200);
    assert.match(res.text, /data-amount="250"/);
  });
});

test('the ingredients container carries data-base-yield="4"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /data-base-yield="4"/);
  });
});

test('the ingredients container carries data-locale="de-DE"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /data-locale="de-DE"/);
  });
});

test('a recipe with a 1500 g ingredient at yield 1x renders "1,5 kg" with a comma decimal separator', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent, {
      groups: [
        {
          name: 'Base',
          ingredients: [{ name: 'Broth', amount: '1500', unit: 'g', scales: true }],
        },
      ],
    });

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /1,5 kg/);
  });
});

test('an ingredient with scales = 0 renders its marker and is not scaled at ?yield=6', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}?yield=6`);
    assert.equal(res.status, 200);
    assert.match(res.text, /10 g/);
    assert.match(res.text, /ingredient-list__marker--fixed/);
    assert.ok(!res.text.includes('15 g'));
  });
});

test('GET /js/domain/scaling.js returns 200 with a JavaScript content-type and is byte-identical to the file on disk', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/js/domain/scaling.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);

    const onDisk = fs.readFileSync(fileURLToPath(new URL('../src/domain/scaling.js', import.meta.url)), 'utf8');
    assert.equal(res.text, onDisk);
  });
});

test('GET /js/domain/../config.js does not escape the static mount', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/js/domain/../config.js');
    assert.notEqual(res.status, 200);
  });
});
