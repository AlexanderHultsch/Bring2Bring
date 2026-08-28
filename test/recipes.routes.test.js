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
// posts carrying nested ingredient rows are encoded by hand here.
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
    servings: '4',
    ingredients: [
      { name: 'Flour', amount: '250', unit: 'g' },
      { name: 'Salt', amount: '10', unit: 'g' },
    ],
    method: 'Mix.',
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
    servings: '4',
    ingredients: [
      { name: 'Tomatoes', amount: '500', unit: 'g' },
      { name: 'Onion', amount: '1', unit: 'piece' },
      { name: 'Basil', unit: 'piece' },
    ],
    method: 'Chop the vegetables.\nSimmer for 20 minutes.',
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

test('POST /recipes creates a recipe with three ingredients and a method; GET /recipes/:id shows them', async () => {
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

test('V3: a recipe with three ingredients and a method stores exactly one ingredient_groups row, the ingredients in order, and one steps row holding the method verbatim', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const createRes = await agent
      .post('/recipes')
      .type('form')
      .send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const groups = db.prepare('SELECT * FROM ingredient_groups WHERE recipe_id = ?').all(recipeId);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, null);
    assert.equal(groups[0].position, 0);

    const ingredients = db
      .prepare('SELECT name, position FROM ingredients WHERE group_id = ? ORDER BY position')
      .all(groups[0].id);
    assert.deepEqual(
      ingredients.map((i) => i.name),
      ['Tomatoes', 'Onion', 'Basil']
    );
    assert.deepEqual(
      ingredients.map((i) => i.position),
      [0, 1, 2]
    );

    const steps = db.prepare('SELECT * FROM steps WHERE recipe_id = ?').all(recipeId);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].position, 0);
    assert.equal(steps[0].section_title, null);
    assert.equal(steps[0].text, 'Chop the vegetables.\nSimmer for 20 minutes.');
  });
});

test('V3: a recipe with no method stores zero steps rows and renders fine', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({ method: '' });
    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(createRes.status, 302);
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM steps WHERE recipe_id = ?').get(recipeId).c, 0);

    const showRes = await agent.get(`/recipes/${recipeId}`);
    assert.equal(showRes.status, 200);
    assert.match(showRes.text, /Tomatoes/);
  });
});

test('a submitted ingredient row with a blank name is dropped, not stored', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({
      ingredients: [
        { name: 'Tomatoes', amount: '500', unit: 'g' },
        { name: '   ', amount: '1', unit: 'piece' },
      ],
    });

    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(createRes.status, 302);
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    assert.equal(ingredientCount(db, recipeId), 1);
  });
});

test('V2: a recipe of only blank-name ingredient rows is a 422 with "Add at least one ingredient."', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({
      ingredients: [
        { name: '', amount: '', unit: 'g' },
        { name: '   ', amount: '1', unit: 'piece' },
      ],
    });

    const res = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(res.status, 422);
    assert.match(res.text, /Add at least one ingredient\./);
  });
});

test('a recipe posted with 25 ingredients stores all 25', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const ingredients = Array.from({ length: 25 }, (_, i) => ({
      name: `Ingredient ${i + 1}`,
      unit: 'piece',
    }));
    const body = {
      title: 'Big recipe',
      servings: '4',
      ingredients,
      method: 'Do it.',
    };

    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(createRes.status, 302);
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    assert.equal(ingredientCount(db, recipeId), 25);
  });
});

test("'1,5' and '1.5' in an amount field both store the number 1.5", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    for (const raw of ['1,5', '1.5']) {
      const csrfToken = await csrfFor(agent, '/recipes/new');
      const body = basicRecipeBody({
        ingredients: [{ name: 'Milk', amount: raw, unit: 'l' }],
      });

      const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
      assert.equal(createRes.status, 302, `amount ${raw}`);
      const recipeId = recipeIdFromLocation(createRes.headers.location);

      const row = db
        .prepare(
          `SELECT amount FROM ingredients i
           JOIN ingredient_groups g ON g.id = i.group_id
           WHERE g.recipe_id = ?`
        )
        .get(recipeId);
      assert.equal(row.amount, 1.5, `amount ${raw}`);
    }
  });
});

test('V2: a blank amount stores NULL and the recipe page shows the name with no number', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({
      ingredients: [{ name: 'Salz', amount: '', unit: 'piece' }],
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
    assert.equal(row.amount, null);

    const showRes = await agent.get(`/recipes/${recipeId}`);
    assert.match(showRes.text, /Salz/);
  });
});

test('V2: a non-numeric amount re-renders the editor with status 422 and the submitted title still present in the HTML', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({
      ingredients: [{ name: 'Tomatoes', amount: 'a lot', unit: 'g' }],
    });

    const res = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(res.status, 422);
    assert.match(res.text, /Tomato Soup/);
  });
});

test('V2: a unit not in EDITOR_UNITS is a 422', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const body = basicRecipeBody({
      ingredients: [{ name: 'Tomatoes', amount: '500', unit: 'clove' }],
    });

    const res = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    assert.equal(res.status, 422);
  });
});

test('V7: a method with several lines round-trips byte-for-byte through save and re-edit', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    const method = 'Step one.\n\nStep two, with   extra   spacing.\nStep three.';
    const body = basicRecipeBody({ method });
    const createRes = await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...body }));
    const recipeId = recipeIdFromLocation(createRes.headers.location);

    const stored = db.prepare('SELECT text FROM steps WHERE recipe_id = ?').get(recipeId);
    assert.equal(stored.text, method);

    const editRes = await agent.get(`/recipes/${recipeId}/edit`);
    assert.equal(editRes.status, 200);
    assert.match(editRes.text, /Step one\.\n\nStep two, with {3}extra {3}spacing\.\nStep three\./);
  });
});

test('V7: the recipe page renders the method with a white-space: pre-wrap class hook', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.match(res.text, /class="recipe-method__text"/);
  });
});

test('V1: the editor page contains a <select> with exactly the nine EDITOR_UNITS options', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/recipes/new');
    assert.equal(res.status, 200);

    const selectMatch = res.text.match(/<select[^>]*class="ingredient-row__unit"[^>]*>([\s\S]*?)<\/select>/);
    assert.ok(selectMatch, 'expected the unit <select> in the ingredient row');
    const optionValues = [...selectMatch[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(optionValues, ['piece', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pinch', 'stueck']);
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

test('V6: POST /recipes/:id/duplicate copies the ingredients and the method', async () => {
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
    const dupId = recipeIdFromLocation(dupRes.headers.location);

    const originalNames = db
      .prepare(
        `SELECT i.name FROM ingredients i
         JOIN ingredient_groups g ON g.id = i.group_id
         WHERE g.recipe_id = ? ORDER BY i.position`
      )
      .all(recipeId)
      .map((row) => row.name);
    const copyNames = db
      .prepare(
        `SELECT i.name FROM ingredients i
         JOIN ingredient_groups g ON g.id = i.group_id
         WHERE g.recipe_id = ? ORDER BY i.position`
      )
      .all(dupId)
      .map((row) => row.name);
    assert.deepEqual(copyNames, originalNames);

    const originalStep = db.prepare('SELECT text FROM steps WHERE recipe_id = ?').get(recipeId);
    const copyStep = db.prepare('SELECT text FROM steps WHERE recipe_id = ?').get(dupId);
    assert.equal(copyStep.text, originalStep.text);
  });
});

// SPECIFICATION.md section 10.E: the archive is reached through the burger
// menu, not a button on the list screen, and the way back from the archive
// is the header's back arrow (E5).
test('GET /?archived=1 renders the header back link to /', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/?archived=1');
    assert.equal(res.status, 200);
    assert.match(res.text, /class="site-header__back" href="\/"/);
  });
});

// SPECIFICATION.md section 10.E (v2.1): identity moved to the burger menu's
// Account item, so the list screen no longer greets the user by name.
test('GET / does not contain "Signed in as"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('Signed in as'));
  });
});

// SPECIFICATION.md section 10.E item 1: the search field submits itself, so
// the screen needs no submit button of its own.
test('GET / renders no submit button labelled Apply', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('>Apply<'));
  });
});

// SPECIFICATION.md section 10.E item 1: the ingredients toggle is a link, not
// a checkbox, and its href always applies the opposite of the current state.
test('GET / renders the ingredients toggle as a link whose href turns the filter on when it is off, and off when it is on', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const offRes = await agent.get('/');
    assert.equal(offRes.status, 200);
    const offMatch = offRes.text.match(/class="ingredients-toggle" href="([^"]+)"/);
    assert.ok(offMatch, 'expected the ingredients toggle link in the HTML');
    assert.match(offMatch[1].replace(/&amp;/g, '&'), /ingredients=1/);

    const onRes = await agent.get('/?ingredients=1');
    assert.equal(onRes.status, 200);
    const onMatch = onRes.text.match(/class="ingredients-toggle ingredients-toggle--on" href="([^"]+)"/);
    assert.ok(onMatch, 'expected the "on" ingredients toggle link in the HTML');
    assert.doesNotMatch(onMatch[1].replace(/&amp;/g, '&'), /ingredients=1/);
  });
});

test('GET /?q=Tomato keeps the search text in the ingredients toggle link', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/?q=Tomato');
    assert.equal(res.status, 200);
    const match = res.text.match(/class="ingredients-toggle" href="([^"]+)"/);
    assert.ok(match, 'expected the ingredients toggle link in the HTML');
    const href = match[1].replace(/&amp;/g, '&');
    assert.match(href, /q=Tomato/);
  });
});

// SPECIFICATION.md section 10.E, decision F1: "My Recipes", not "Recipes".
test('the bottom nav says My Recipes, not My Dishes', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /My Recipes<\/span>/);
    assert.ok(!res.text.includes('My Dishes'));
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

// SPECIFICATION.md section 10.1/10.E: "Search box is title-first; ingredient
// search is a secondary toggle beside it, not the default."
test('GET /?q=<ingredient name> does NOT find a recipe by ingredient name with the ingredients toggle off (the default)', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const listRes = await agent.get('/?q=Basil');
    assert.equal(listRes.status, 200);
    assert.ok(!listRes.text.includes('Tomato Soup'));
  });
});

test('GET /?q=<ingredient name>&ingredients=1 finds a recipe by an ingredient name, not just a title', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');

    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const listRes = await agent.get('/?q=Basil&ingredients=1');
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
      ingredients: [{ name: 'Broth', amount: '1500', unit: 'g' }],
    });

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /1,5 kg/);
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

// SPECIFICATION.md section 10.1/10.E: default sort is A-Z, and My Dishes
// renders sticky letter section headers plus the A-Z rail against it.
test('GET / sorted A-Z (the default) renders letter section headers with id="sect-A"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /id="sect-T"/);
    assert.match(res.text, /class="az-rail"/);
  });
});

// SPECIFICATION.md section 10.1/10.E: letter grouping is meaningless once
// the list isn't A-Z, so a non-alphabetical sort renders a flat list.
test('GET /?sort=updated renders NO letter headers and NO rail', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/?sort=updated');
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /class="recipe-list__section"/);
    assert.doesNotMatch(res.text, /class="az-rail"/);
  });
});

test('GET / does NOT render an author line for the signed-in user\'s own recipes', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /recipe-list__author/);
    assert.doesNotMatch(res.text, /@alex/);
  });
});

test('GET / renders the import count and the i-bring icon on each row', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /class="recipe-list__count">\s*<svg class="icon"><use href="#i-bring"><\/use><\/svg>\s*0/);
  });
});

// SPECIFICATION.md section 7.4 (v2.0, D6): the servings wheel is exactly the
// integers 1..10, each a real ?yield=N link (works with JavaScript disabled).
test('the servings wheel renders exactly the integers 1..10, each linking to ?yield=N', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    const items = [
      ...res.text.matchAll(
        /<a\s+class="servings-wheel__item[^"]*"\s+href="\?yield=(\d+)"\s+data-yield-option="(\d+)"/g
      ),
    ];
    assert.equal(items.length, 10);
    items.forEach((m, i) => {
      assert.equal(Number(m[1]), i + 1);
      assert.equal(Number(m[2]), i + 1);
    });
  });
});

test('the current servings is marked as selected on the wheel; at ?yield=3 it is 3, not the base yield', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent); // base yield 4

    const res = await agent.get(`/recipes/${recipeId}?yield=3`);
    assert.equal(res.status, 200);
    assert.match(res.text, /class="servings-wheel__item servings-wheel__item--selected"\s+href="\?yield=3"/);
    assert.doesNotMatch(res.text, /class="servings-wheel__item servings-wheel__item--selected"\s+href="\?yield=4"/);
  });
});

test("?yield=0, ?yield=11, ?yield=3.5 and ?yield=abc each fall back to the recipe's own servings and return 200, never 400", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    for (const badYield of ['0', '11', '3.5', 'abc']) {
      const res = await agent.get(`/recipes/${recipeId}?yield=${encodeURIComponent(badYield)}`);
      assert.equal(res.status, 200, `?yield=${badYield}`);
      assert.match(res.text, /250 g/, `?yield=${badYield}`);
    }
  });
});

test('the ingredients heading names the selected servings', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}?yield=6`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Ingredients \(for <span data-servings-count>6<\/span> servings\)/);
  });
});

test('the public-link <details> has no open attribute on load, and the expanded content has the URL, Copy, Rotate and Disable controls', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    assert.match(res.text, /<details class="public-link">/);
    assert.doesNotMatch(res.text, /<details class="public-link"[^>]*\sopen/);

    assert.ok(res.text.includes('Public link · on'));
    assert.match(res.text, /data-share-url="https:\/\/dishlist\.example\.com\/r\/[^"]+"/);
    assert.match(res.text, /Copy\s*<\/button>/);
    assert.match(res.text, /Rotate\s*<\/button>/);
    assert.match(res.text, /Disable\s*<\/button>/);
  });
});

test('POST /recipes/:id/publish action=publish sets is_public and leaves the recipe with an enabled share token', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const csrfToken = await csrfFor(agent, `/recipes/${recipeId}`);
    const res = await agent
      .post(`/recipes/${recipeId}/publish`)
      .type('form')
      .send({ _csrf: csrfToken, action: 'publish' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/recipes/${recipeId}`);

    const stored = db.prepare('SELECT is_public, share_enabled FROM recipes WHERE id = ?').get(recipeId);
    assert.equal(stored.is_public, 1);
    assert.equal(stored.share_enabled, 1);
  });
});

test('POST /recipes/:id/publish action=unpublish clears is_public and leaves the share token enabled', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const publishCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/publish`).type('form').send({ _csrf: publishCsrf, action: 'publish' });

    const unpublishCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    const res = await agent
      .post(`/recipes/${recipeId}/publish`)
      .type('form')
      .send({ _csrf: unpublishCsrf, action: 'unpublish' });
    assert.equal(res.status, 302);

    const stored = db.prepare('SELECT is_public, share_enabled FROM recipes WHERE id = ?').get(recipeId);
    assert.equal(stored.is_public, 0);
    assert.equal(stored.share_enabled, 1);
  });
});

test('POST /recipes/:id/publish with an invalid action is a 400', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const csrfToken = await csrfFor(agent, `/recipes/${recipeId}`);
    const res = await agent
      .post(`/recipes/${recipeId}/publish`)
      .type('form')
      .send({ _csrf: csrfToken, action: 'nonsense' });
    assert.equal(res.status, 400);
  });
});

test('POST /recipes/:id/publish from a non-owner is a 404 and leaves is_public unchanged', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Secret Soup' });

    const agent = await loginAgent(app, 'stranger');
    const csrfToken = await csrfFor(agent, '/');
    const res = await agent
      .post(`/recipes/${recipe.id}/publish`)
      .type('form')
      .send({ _csrf: csrfToken, action: 'publish' });
    assert.equal(res.status, 404);

    const stored = db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id);
    assert.equal(stored.is_public, 0);
  });
});

test('a published recipe appears on GET /public for a different user', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const owner = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(owner, { title: 'Shelf Soup' });

    const publishCsrf = await csrfFor(owner, `/recipes/${recipeId}`);
    await owner.post(`/recipes/${recipeId}/publish`).type('form').send({ _csrf: publishCsrf, action: 'publish' });

    await seedUser(db, 'other');
    const other = await loginAgent(app, 'other');
    const res = await other.get('/public');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Shelf Soup'));
  });
});

test('the recipe page states, next to the publish control, that publishing creates a link anyone on the internet can open', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('a link anyone on the internet can open'));
  });
});

test('a non-owner viewing a public recipe sees Send to Bring! and Duplicate, but NO Edit link, NO Rotate, NO Disable, and NO publish control', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const owner = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(owner);
    const publishCsrf = await csrfFor(owner, `/recipes/${recipeId}`);
    await owner.post(`/recipes/${recipeId}/publish`).type('form').send({ _csrf: publishCsrf, action: 'publish' });

    await seedUser(db, 'other');
    const other = await loginAgent(app, 'other');
    const res = await other.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    assert.match(res.text, /Send to Bring!/);
    assert.match(res.text, /Duplicate\s*<\/button>/);

    assert.doesNotMatch(res.text, /href="\/recipes\/\d+\/edit">Edit</);
    assert.doesNotMatch(res.text, /Rotate\s*<\/button>/);
    assert.doesNotMatch(res.text, /Disable\s*<\/button>/);
    assert.doesNotMatch(res.text, /class="publish-control"/);
  });
});

test('the owner\'s view of the same public recipe still contains Edit, Rotate, Disable and the publish control', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const owner = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(owner);
    const publishCsrf = await csrfFor(owner, `/recipes/${recipeId}`);
    await owner.post(`/recipes/${recipeId}/publish`).type('form').send({ _csrf: publishCsrf, action: 'publish' });

    const res = await owner.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    assert.match(res.text, /Send to Bring!/);
    assert.match(res.text, new RegExp(`href="/recipes/${recipeId}/edit">Edit<`));
    assert.match(res.text, /Rotate\s*<\/button>/);
    assert.match(res.text, /Disable\s*<\/button>/);
    assert.match(res.text, /class="publish-control"/);
  });
});

test('the recipe page\'s Send to Bring! button now points at /recipes/:id/bring, not directly at api.getbring.com, and carries the data hook recipe-view.js looks for', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    const res = await agent.get(`/recipes/${recipeId}?yield=6`);
    assert.equal(res.status, 200);

    const match = res.text.match(/<a class="button button--bring" href="([^"]+)"\s+data-bring-link>/);
    assert.ok(match, 'expected the Send to Bring! link with the data-bring-link hook');
    assert.equal(match[1], `/recipes/${recipeId}/bring?yield=6`);
    assert.doesNotMatch(res.text, /button--bring" href="https:\/\/api\.getbring\.com/);
  });
});

// SPECIFICATION.md section 8.5: acceptance criterion 5, now checked over
// HTTP against GET /recipes/:id/bring instead of the page's rendered href —
// the deeplink is built server-side from ?yield=N, never client-side, so the
// servings wheel and the exported quantities can never drift apart.
test('ACCEPTANCE 5 over HTTP: GET /recipes/:id/bring?yield=6 redirects to an api.getbring.com deeplink with baseQuantity equal to requestedQuantity, both 6, and a URL-encoded share url containing yield=6', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    const res = await agent.get(`/recipes/${recipeId}/bring?yield=6`);
    assert.equal(res.status, 302);

    const url = new URL(res.headers.location);
    assert.equal(url.origin + url.pathname, 'https://api.getbring.com/rest/bringrecipes/deeplink');
    assert.equal(url.searchParams.get('baseQuantity'), '6');
    assert.equal(url.searchParams.get('requestedQuantity'), '6');
    assert.equal(url.searchParams.get('baseQuantity'), url.searchParams.get('requestedQuantity'));

    const shareUrl = url.searchParams.get('url');
    assert.ok(shareUrl.includes('yield=6'), `expected the share url to carry yield=6, got ${shareUrl}`);
    assert.ok(res.headers.location.includes(`url=${encodeURIComponent(shareUrl)}`));
  });
});

test('GET /recipes/:id/bring with no ?yield uses the recipe\'s own servings, base still equal to requested', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent); // base yield 4

    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    const res = await agent.get(`/recipes/${recipeId}/bring`);
    assert.equal(res.status, 302);

    const url = new URL(res.headers.location);
    assert.equal(url.searchParams.get('baseQuantity'), '4');
    assert.equal(url.searchParams.get('requestedQuantity'), '4');
  });
});

test('GET /recipes/:id/bring with ?yield=11 or ?yield=abc falls back to the recipe\'s own servings, still 302, never 400, base still equal to requested', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent); // base yield 4

    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    for (const badYield of ['11', 'abc']) {
      const res = await agent.get(`/recipes/${recipeId}/bring?yield=${encodeURIComponent(badYield)}`);
      assert.equal(res.status, 302, `?yield=${badYield}`);
      const url = new URL(res.headers.location);
      assert.equal(url.searchParams.get('baseQuantity'), '4', `?yield=${badYield}`);
      assert.equal(url.searchParams.get('requestedQuantity'), '4', `?yield=${badYield}`);
    }
  });
});

test('GET /recipes/:id/bring redirects back to the recipe page, not api.getbring.com, when sharing is disabled', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}/bring?yield=6`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/recipes/${recipeId}`);
  });
});

test('GET /recipes/:id/bring answers 404 for another user\'s private recipe', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const ownerAgent = await loginAgent(app, 'owner');
    const recipeId = await createScalingRecipe(ownerAgent);
    const enableCsrf = await csrfFor(ownerAgent, `/recipes/${recipeId}`);
    await ownerAgent
      .post(`/recipes/${recipeId}/share/link`)
      .type('form')
      .send({ _csrf: enableCsrf, action: 'enable' });

    const strangerAgent = await loginAgent(app, 'stranger');
    const res = await strangerAgent.get(`/recipes/${recipeId}/bring`);
    assert.equal(res.status, 404);
  });
});

test('GET /recipes/:id/bring answers 302 to /login when unauthenticated', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await request(app).get(`/recipes/${recipeId}/bring`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
  });
});

function methodBlocks(html) {
  return [...html.matchAll(/<p class="recipe-method__text">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
}

test('the method renders verbatim on the recipe page, one block per typed line: a two-line method with a blank line between round-trips into the HTML with its line breaks intact as three blocks', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const method = 'Preheat the oven.\n\nWhisk vigorously.';
    const recipeId = await createScalingRecipe(agent, { method });

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(methodBlocks(res.text), ['Preheat the oven.', '', 'Whisk vigorously.']);
  });
});

test('a three-line method renders three separate recipe-method__text blocks, each with the exact typed text, including a leading "1. " the user typed, and adds no numbering of its own', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const method = '1. Mehl, Eier und Milch in eine Schüssel geben und verrühren.\n2. Teig 10 Minuten ruhen lassen.\n3. In der Pfanne backen.';
    const recipeId = await createScalingRecipe(agent, { method });

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(methodBlocks(res.text), [
      '1. Mehl, Eier und Milch in eine Schüssel geben und verrühren.',
      '2. Teig 10 Minuten ruhen lassen.',
      '3. In der Pfanne backen.',
    ]);

    const noDigitsMethod = 'Preheat the oven.\nWhisk vigorously.';
    const otherRecipeId = await createScalingRecipe(agent, { title: 'No Digits', method: noDigitsMethod });
    const otherRes = await agent.get(`/recipes/${otherRecipeId}`);
    assert.doesNotMatch(methodBlocks(otherRes.text).join(''), /\d/);
  });
});

test('the recipe page includes the back link to My Recipes and the bottom nav', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /<a class="site-header__back" href="\/" aria-label="Back">/);
    assert.match(res.text, /<nav class="bottom-nav" aria-label="Primary">/);
  });
});

test('the A-Z rail renders 27 entries, and a letter with no recipes is not a link', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    const railMatch = res.text.match(/<nav class="az-rail"[\s\S]*?<\/nav>/);
    assert.ok(railMatch, 'expected the A-Z rail in the response');
    const entries = [...railMatch[0].matchAll(/class="az-rail__letter[^"]*"/g)];
    assert.equal(entries.length, 27);

    assert.doesNotMatch(railMatch[0], /<a class="az-rail__letter" href="#sect-B">B<\/a>/);
    assert.match(railMatch[0], /<span class="az-rail__letter az-rail__letter--inert"[^>]*>B<\/span>/);
  });
});

// SPECIFICATION.md section 10.E, F6: az-rail.js reads data-az-letter to know
// which letter each rail element is, since textContent would break once the
// markup gains a wrapper.
test('every A-Z rail entry carries data-az-letter, values # then A-Z in order', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    const railMatch = res.text.match(/<nav class="az-rail"[\s\S]*?<\/nav>/);
    assert.ok(railMatch, 'expected the A-Z rail in the response');
    const letters = [...railMatch[0].matchAll(/data-az-letter="([^"]*)"/g)].map((m) => m[1]);
    const expected = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];
    assert.deepEqual(letters, expected);
  });
});

// SPECIFICATION.md section 10.E, F6: the magnification bubble is decorative
// (it repeats a letter already in the rail), so it must be aria-hidden and
// there must be exactly one of it.
test('the A-Z rail renders exactly one magnification bubble, and it is aria-hidden', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    const railMatch = res.text.match(/<nav class="az-rail"[\s\S]*?<\/nav>/);
    assert.ok(railMatch, 'expected the A-Z rail in the response');
    const bubbleTags = [...railMatch[0].matchAll(/<span[^>]*data-az-bubble[^>]*>/g)];
    assert.equal(bubbleTags.length, 1);
    assert.match(bubbleTags[0][0], /aria-hidden="true"/);
  });
});

// SPECIFICATION.md section 10.E, F6: the JavaScript-free path — a letter with
// a recipe is a real #sect-X anchor, a letter without one stays an inert span.
// draggable="false" is required on the anchor: without it, the browser's
// native link-drag gesture cancels the pointer on the first move and the
// rail cannot be dragged.
test('letters with recipes are real anchors and letters without stay inert spans', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const csrfToken = await csrfFor(agent, '/recipes/new');
    await agent.post('/recipes').type('form').send(encodeForm({ _csrf: csrfToken, ...basicRecipeBody() }));

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    const railMatch = res.text.match(/<nav class="az-rail"[\s\S]*?<\/nav>/);
    assert.ok(railMatch, 'expected the A-Z rail in the response');
    assert.match(railMatch[0], /<a class="az-rail__letter" href="#sect-T" data-az-letter="T" draggable="false">T<\/a>/);
    assert.match(railMatch[0], /<span class="az-rail__letter az-rail__letter--inert" data-az-letter="B" aria-hidden="true">B<\/span>/);
  });
});

// SPECIFICATION.md section 10.E, F6: az-rail.js ships as an external file
// (CLAUDE.md: no inline scripts) with the same cache buster as the other
// deferred scripts.
test('the page references az-rail.js with a non-empty ?v= cache buster', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    const scriptMatch = res.text.match(/\/js\/az-rail\.js\?v=([^"]+)"/);
    assert.ok(scriptMatch, 'expected az-rail.js to carry ?v=');
    assert.notEqual(scriptMatch[1], '');
  });
});

function setCookieFor(res, name) {
  const raw = res.headers['set-cookie'] || [];
  return raw.find((cookie) => cookie.startsWith(`${name}=`));
}

function importCount(db, recipeId) {
  return db.prepare('SELECT bring_import_count FROM recipes WHERE id = ?').get(recipeId)
    .bring_import_count;
}

// SPECIFICATION.md section 13 acceptance 12 (v2.0, D4): two GETs from the
// same device on the same day increment the counter by exactly one, and both
// still answer 302 to a deeplink with baseQuantity === requestedQuantity.
test('ACCEPTANCE 12: two GETs of /recipes/:id/bring from the same device on the same day increment bring_import_count by exactly one', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);
    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await agent.get(`/recipes/${recipeId}/bring?yield=6`);
      assert.equal(res.status, 302);
      const url = new URL(res.headers.location);
      assert.equal(url.searchParams.get('baseQuantity'), url.searchParams.get('requestedQuantity'));
    }

    assert.equal(importCount(db, recipeId), 1);
  });
});

// SPECIFICATION.md section 13 acceptance 13 (v2.0, D4).
test('ACCEPTANCE 13: the same request from a different device id increments bring_import_count again', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);
    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    await agent.get(`/recipes/${recipeId}/bring`);
    assert.equal(importCount(db, recipeId), 1);

    const otherDeviceAgent = await loginAgent(app, 'alex');
    await otherDeviceAgent.get(`/recipes/${recipeId}/bring`);
    assert.equal(importCount(db, recipeId), 2);
  });
});

test('the first GET /recipes/:id/bring sets bring2bring.did, httpOnly and SameSite=Lax; the second reuses the same value', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);
    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    const first = await agent.get(`/recipes/${recipeId}/bring`);
    const firstCookie = setCookieFor(first, 'bring2bring.did');
    assert.ok(firstCookie, 'expected bring2bring.did to be set on the first request');
    assert.match(firstCookie, /HttpOnly/);
    assert.match(firstCookie, /SameSite=Lax/i);
    const firstValue = firstCookie.split(';')[0].split('=')[1];
    assert.ok(firstValue.length > 0);

    const second = await agent.get(`/recipes/${recipeId}/bring`);
    const secondCookie = setCookieFor(second, 'bring2bring.did');
    assert.equal(secondCookie, undefined, 'expected no new bring2bring.did cookie on the second request');
  });
});

test('GET /recipes/:id/bring does not increment bring_import_count when sharing is disabled', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    await agent.get(`/recipes/${recipeId}/bring?yield=6`);
    assert.equal(importCount(db, recipeId), 0);
  });
});

test("GET /recipes/:id/bring does not increment bring_import_count for another user's private recipe", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const ownerAgent = await loginAgent(app, 'owner');
    const recipeId = await createScalingRecipe(ownerAgent);
    const enableCsrf = await csrfFor(ownerAgent, `/recipes/${recipeId}`);
    await ownerAgent
      .post(`/recipes/${recipeId}/share/link`)
      .type('form')
      .send({ _csrf: enableCsrf, action: 'enable' });

    const strangerAgent = await loginAgent(app, 'stranger');
    const res = await strangerAgent.get(`/recipes/${recipeId}/bring`);
    assert.equal(res.status, 404);
    assert.equal(importCount(db, recipeId), 0);
  });
});

test('GET /recipes/:id/bring does not increment bring_import_count when unauthenticated', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);
    const enableCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: enableCsrf, action: 'enable' });

    const res = await request(app).get(`/recipes/${recipeId}/bring`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
    assert.equal(importCount(db, recipeId), 0);
  });
});

// SPECIFICATION.md section 9 (v2.0, D1): a recipe on the Public shelf whose
// owner has since disabled its link. The fallback "enable and send to Bring!"
// form posts to an owner-only route, so a non-owner must not see it.
test('a non-owner viewing a public recipe whose link is disabled sees an explanatory sentence, not the enable form', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const ownerAgent = await loginAgent(app, 'owner');
    const recipeId = await createScalingRecipe(ownerAgent);

    const publishCsrf = await csrfFor(ownerAgent, `/recipes/${recipeId}`);
    await ownerAgent
      .post(`/recipes/${recipeId}/publish`)
      .type('form')
      .send({ _csrf: publishCsrf, action: 'publish' });
    const disableCsrf = await csrfFor(ownerAgent, `/recipes/${recipeId}`);
    await ownerAgent
      .post(`/recipes/${recipeId}/share/link`)
      .type('form')
      .send({ _csrf: disableCsrf, action: 'disable' });

    const strangerAgent = await loginAgent(app, 'stranger');
    const res = await strangerAgent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /Enable public link and send to Bring!/);
    assert.match(res.text, /author has turned its link off/);
  });
});

test('the owner of that same recipe still sees the enable form', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'owner');
    const ownerAgent = await loginAgent(app, 'owner');
    const recipeId = await createScalingRecipe(ownerAgent);

    const publishCsrf = await csrfFor(ownerAgent, `/recipes/${recipeId}`);
    await ownerAgent
      .post(`/recipes/${recipeId}/publish`)
      .type('form')
      .send({ _csrf: publishCsrf, action: 'publish' });
    const disableCsrf = await csrfFor(ownerAgent, `/recipes/${recipeId}`);
    await ownerAgent
      .post(`/recipes/${recipeId}/share/link`)
      .type('form')
      .send({ _csrf: disableCsrf, action: 'disable' });

    const res = await ownerAgent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Enable public link and send to Bring!/);
  });
});

// SPECIFICATION.md decision E5 (v2.1): the header no longer duplicates the
// page title, since the <h1> already carries it.
test('the recipe page renders the title exactly once, in the h1, not the header', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.text, /site-header__title/);
    assert.match(res.text, /<h1>Scalable Soup<\/h1>/);
  });
});

// SPECIFICATION.md decision E5 (v2.1): reading order is servings,
// ingredients, Send to Bring!, Method, then the collapsed manage disclosure.
test('the Method section comes before the manage disclosure', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    const methodIndex = res.text.indexOf('<h2>Method</h2>');
    const manageIndex = res.text.indexOf('<details class="manage">');

    assert.ok(methodIndex > -1, 'expected a Method section');
    assert.ok(manageIndex > -1, 'expected the manage disclosure');
    assert.ok(methodIndex < manageIndex, 'Method should come before the manage disclosure');
  });
});

test('Send to Bring! comes before the Method section', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);
    const shareCsrf = await csrfFor(agent, `/recipes/${recipeId}`);
    await agent.post(`/recipes/${recipeId}/share/link`).type('form').send({ _csrf: shareCsrf, action: 'enable' });

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    const bringIndex = res.text.indexOf('Send to Bring!');
    const methodIndex = res.text.indexOf('<h2>Method</h2>');

    assert.ok(bringIndex > -1, 'expected a Send to Bring! action');
    assert.ok(methodIndex > -1, 'expected a Method section');
    assert.ok(bringIndex < methodIndex, 'Send to Bring! should come before Method');
  });
});

// SPECIFICATION.md decision E5 (v2.1): publishing, the public link and
// Archive are owner-only administration, tucked behind one disclosure.
test('an owner sees the manage disclosure; a signed-in non-owner viewing a public recipe does not', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const owner = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(owner);
    const publishCsrf = await csrfFor(owner, `/recipes/${recipeId}`);
    await owner.post(`/recipes/${recipeId}/publish`).type('form').send({ _csrf: publishCsrf, action: 'publish' });

    const ownerRes = await owner.get(`/recipes/${recipeId}`);
    assert.equal(ownerRes.status, 200);
    assert.match(ownerRes.text, /<details class="manage">/);

    await seedUser(db, 'other');
    const other = await loginAgent(app, 'other');
    const otherRes = await other.get(`/recipes/${recipeId}`);
    assert.equal(otherRes.status, 200);
    assert.doesNotMatch(otherRes.text, /<details class="manage">/);
  });
});

// SPECIFICATION.md decision E6 (v2.1): the servings ruler wraps each number
// in its own span so a filled circle can be drawn behind it.
test('each servings-wheel item wraps its number in a servings-wheel__value span', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    const values = [...res.text.matchAll(/<span class="servings-wheel__value">(\d+)<\/span>/g)];
    assert.equal(values.length, 10);
    values.forEach((m, i) => assert.equal(Number(m[1]), i + 1));
  });
});

// SPECIFICATION.md decision F5 (v2.2): the servings wheel is centre-locked —
// a fixed lens over a scrolling strip. The scroll interaction itself is not
// testable by this server-rendered suite; this only pins the markup shape.
test('the servings wheel renders one lens, one scroll container, and role="list" on the data-yield-wheel track', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    assert.equal((res.text.match(/class="servings-wheel__lens"/g) || []).length, 1);
    assert.equal((res.text.match(/data-yield-scroll/g) || []).length, 1);
    assert.equal((res.text.match(/data-yield-wheel/g) || []).length, 1);
    assert.match(
      res.text,
      /<div class="servings-wheel__track" data-yield-wheel role="list" aria-label="Servings">/
    );
  });
});

test('all ten servings anchors still sit inside the data-yield-wheel track with their ?yield=N hrefs', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createScalingRecipe(agent);

    const res = await agent.get(`/recipes/${recipeId}`);
    assert.equal(res.status, 200);

    const trackStart = res.text.indexOf(
      '<div class="servings-wheel__track" data-yield-wheel role="list" aria-label="Servings">'
    );
    assert.ok(trackStart >= 0, 'expected the servings-wheel__track markup');
    const track = res.text.slice(trackStart, res.text.indexOf('</section>', trackStart));

    const items = [
      ...track.matchAll(
        /<a\s+class="servings-wheel__item[^"]*"\s+href="\?yield=(\d+)"\s+data-yield-option="(\d+)"/g
      ),
    ];
    assert.equal(items.length, 10);
    items.forEach((m, i) => {
      assert.equal(Number(m[1]), i + 1);
      assert.equal(Number(m[2]), i + 1);
    });
  });
});
