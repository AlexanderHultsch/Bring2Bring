import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser, updateUserUnitPreferences } from '../src/repositories/users.js';
import { redactPath } from '../src/middleware/request-logger.js';
import { replaceRecipeContent } from '../src/repositories/recipes.js';

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

// K3/K4 (§7.5/§7.6): sets preferences through the repository function, not
// raw SQL, matching how the Account screen itself writes them.
async function seedUserWithPreferences(db, username, { unitLanguage, measurementSystem }) {
  const user = await seedUser(db, username);
  updateUserUnitPreferences(db, user.id, { unitLanguage, measurementSystem });
  return user;
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

function encodeForm(body) {
  return toFormPairs(body, '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function recipeIdFromLocation(location) {
  return Number(location.split('?')[0].split('/').filter(Boolean).pop());
}

function scalingRecipeBody(overrides = {}) {
  return {
    title: 'Scalable Soup',
    servings: '4',
    ingredients: [{ name: 'Flour', amount: '250', unit: 'g' }],
    method: 'Mix.',
    ...overrides,
  };
}

async function createRecipe(agent, overrides) {
  const csrfToken = await csrfFor(agent, '/recipes/new');
  const createRes = await agent
    .post('/recipes')
    .type('form')
    .send(encodeForm({ _csrf: csrfToken, ...scalingRecipeBody(overrides) }));
  return recipeIdFromLocation(createRes.headers.location);
}

async function shareAction(agent, recipeId, action, csrfPath) {
  const csrfToken = await csrfFor(agent, csrfPath ?? `/recipes/${recipeId}`);
  return agent
    .post(`/recipes/${recipeId}/share/link`)
    .type('form')
    .send({ _csrf: csrfToken, action });
}

function shareRow(db, recipeId) {
  return db.prepare('SELECT share_token, share_enabled FROM recipes WHERE id = ?').get(recipeId);
}

function extractJsonLd(html) {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a <script type="application/ld+json"> block');
  return JSON.parse(match[1]);
}

function visibleIngredientTexts(html) {
  const items = [...html.matchAll(/<li class="ingredient-list__item"[^>]*>([\s\S]*?)<\/li>/g)];
  return items.map(([, inner]) =>
    inner
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

test('ACCEPTANCE 2: GET /r/:token returns 200 when sent with no cookies at all', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

test('ACCEPTANCE 3: GET /r/:token returns 404 after disabling, and after rotation the old token also returns 404', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);

    await shareAction(agent, recipeId, 'enable');
    const { share_token: enabledToken } = shareRow(db, recipeId);
    const enabledRes = await request(app).get(`/r/${enabledToken}`);
    assert.equal(enabledRes.status, 200);

    await shareAction(agent, recipeId, 'disable');
    const disabledRes = await request(app).get(`/r/${enabledToken}`);
    assert.equal(disabledRes.status, 404);

    await shareAction(agent, recipeId, 'enable');
    await shareAction(agent, recipeId, 'rotate');
    const { share_token: newToken } = shareRow(db, recipeId);
    assert.notEqual(newToken, enabledToken);

    const oldTokenRes = await request(app).get(`/r/${enabledToken}`);
    assert.equal(oldTokenRes.status, 404);
    const newTokenRes = await request(app).get(`/r/${newToken}`);
    assert.equal(newTokenRes.status, 200);
  });
});

test('an unknown token returns 404, indistinguishable from a disabled token', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);
    await shareAction(agent, recipeId, 'disable');

    const disabledRes = await request(app).get(`/r/${share_token}`);
    const unknownRes = await request(app).get('/r/this-token-was-never-issued');

    assert.equal(disabledRes.status, 404);
    assert.equal(unknownRes.status, 404);
    assert.ok(!disabledRes.text.includes(share_token));
    assert.ok(!unknownRes.text.includes(share_token));
  });
});

test('GET /r/:token sets the exact D4 response headers', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['cache-control'], 'public, max-age=300');
  });
});

test('the share page emits <meta name="robots" content="noindex,nofollow">', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.match(res.text, /<meta name="robots" content="noindex,nofollow">/);
  });
});

test('GET /r/:token?yield=6 on a base-4 recipe with a 250 g ingredient renders 375 g', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}?yield=6`);
    assert.equal(res.status, 200);
    assert.match(res.text, /375 g/);
  });
});

test('the share page contains no app chrome: no username, no link to /, no link to /login, no "Bring2Bring!" nav link', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('alex'));
    assert.ok(!res.text.includes('href="/"'));
    assert.ok(!res.text.includes('href="/login"'));
    assert.ok(!/>Bring2Bring!</.test(res.text));
  });
});

test('SPECIFICATION.md §8.4: GET /r/:token does not contain the method text of a recipe that has one', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent, { method: 'Preheat the oven to 200C, then whisk vigorously.' });
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('Preheat the oven to 200C'));
  });
});

test('enabling twice reuses the same token', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);

    await shareAction(agent, recipeId, 'enable');
    const first = shareRow(db, recipeId).share_token;
    await shareAction(agent, recipeId, 'enable');
    const second = shareRow(db, recipeId).share_token;

    assert.equal(first, second);
  });
});

test("a user without write access gets 404 from POST /recipes/:id/share/link and the recipe's share_enabled is unchanged", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const ownerAgent = await loginAgent(app, 'owner');
    const recipeId = await createRecipe(ownerAgent);

    const strangerAgent = await loginAgent(app, 'stranger');
    const res = await shareAction(strangerAgent, recipeId, 'enable', '/');
    assert.equal(res.status, 404);

    const row = shareRow(db, recipeId);
    assert.equal(row.share_enabled, 0);
  });
});

test("GET /r/:token sets no session cookie even after the app has served an authenticated request in the same test", async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    // loginAgent above already drove this same app instance through session,
    // cookieParser and csrf middleware — confirm the share route still never
    // sets a session cookie (proves D1's mount position).
    const res = await request(app).get(`/r/${share_token}`);
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

test('redactPath applied to the real share route path shape redacts the token', () => {
  const token = 'abcDEF123_-xyz9876543210ABCDEFghijkl';
  const redacted = redactPath(`/r/${token}`);
  assert.equal(redacted, '/r/[redacted]');
  assert.ok(!redacted.includes(token));
});

test('GET /r/:token contains a <script type="application/ld+json"> block whose content JSON.parse()s successfully', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    const jsonLd = extractJsonLd(res.text);
    assert.equal(jsonLd['@context'], 'https://schema.org');
    assert.equal(jsonLd['@type'], 'Recipe');
  });
});

test('ACCEPTANCE 2 (completing it): the ingredient strings in the JSON-LD match what the visible HTML shows', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    const jsonLd = extractJsonLd(res.text);
    const visible = visibleIngredientTexts(res.text);

    assert.deepEqual(jsonLd.recipeIngredient, visible);
  });
});

test('§7.5/§7.6: GET /r/:token with no session renders in the recipe AUTHOR\'s en/imperial preferences, not the de/metric default', async () => {
  await withApp(async (app, db) => {
    await seedUserWithPreferences(db, 'alex', { unitLanguage: 'en', measurementSystem: 'imperial' });
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent, {
      ingredients: [
        { name: 'Flour', amount: '250', unit: 'g' },
        { name: 'Vanilla', amount: '1', unit: 'tbsp' },
      ],
    });
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['set-cookie'], undefined);
    assert.match(res.text, /8\.8 oz/);
    assert.match(res.text, /1 tbsp/);
    assert.ok(!res.text.includes('1 EL'));

    // The JSON-LD Bring! fetches must carry the same numbers as the visible
    // text — asserted by comparing the two, not by restating a number twice.
    const jsonLd = extractJsonLd(res.text);
    const visible = visibleIngredientTexts(res.text);
    assert.deepEqual(jsonLd.recipeIngredient, visible);
  });
});

test('GET /r/:token?yield=6 has recipeYield reflecting 6 and ingredient strings scaled to 6', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}?yield=6`);
    const jsonLd = extractJsonLd(res.text);
    assert.equal(jsonLd.recipeYield, '6 servings');
    assert.ok(jsonLd.recipeIngredient[0].includes('375'));
  });
});

test('a recipe whose TITLE contains </script><script>alert(1)</script> does not break out of the ld+json block', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const maliciousTitle = 'Cake</script><script>alert(1)</script>';
    const recipeId = await createRecipe(agent, { title: maliciousTitle });
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.ok(!res.text.includes('</script><script>'));
    const jsonLd = extractJsonLd(res.text);
    assert.equal(jsonLd.name, maliciousTitle);
  });
});

test('the visible HTML carries itemtype="https://schema.org/Recipe" and at least one itemprop="recipeIngredient"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    assert.match(res.text, /itemtype="https:\/\/schema\.org\/Recipe"/);
    assert.match(res.text, /itemprop="recipeIngredient"/);
  });
});

// SPECIFICATION.md section 2.1 A2 / this task's §13 criterion 6: the editor
// has no UI to set exclude_from_shopping any more, so these three tests set
// it directly through replaceRecipeContent (the repository/builder level)
// rather than through a form field that no longer exists.
test('REGRESSION (no index-zip): the excluded ingredient FIRST of three is the only one missing from the JSON-LD, all three visible', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    replaceRecipeContent(db, recipeId, owner.id, {
      groups: [
        {
          name: null,
          ingredients: [
            { name: 'Water', amount: null, unit: 'piece', exclude_from_shopping: 1 },
            { name: 'Flour', amount: 250, unit: 'g' },
            { name: 'Sugar', amount: 100, unit: 'g' },
          ],
        },
      ],
      steps: [],
      tagIds: [],
    });
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}?yield=6`);
    const jsonLd = extractJsonLd(res.text);
    const visible = visibleIngredientTexts(res.text);

    assert.equal(visible.length, 3, 'all three ingredients are visible in the HTML');
    assert.ok(visible.some((text) => text.includes('Water')));
    assert.ok(visible.some((text) => text.includes('Flour')));
    assert.ok(visible.some((text) => text.includes('Sugar')));

    assert.equal(jsonLd.recipeIngredient.length, 2);
    assert.ok(!jsonLd.recipeIngredient.some((entry) => entry.includes('Water')));
    assert.ok(jsonLd.recipeIngredient.some((entry) => entry.includes('Flour')));
    assert.ok(jsonLd.recipeIngredient.some((entry) => entry.includes('Sugar')));
  });
});

test('REGRESSION (no index-zip): the excluded ingredient LAST of three is the only one missing from the JSON-LD, all three visible', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    replaceRecipeContent(db, recipeId, owner.id, {
      groups: [
        {
          name: null,
          ingredients: [
            { name: 'Flour', amount: 250, unit: 'g' },
            { name: 'Sugar', amount: 100, unit: 'g' },
            { name: 'Water', amount: null, unit: 'piece', exclude_from_shopping: 1 },
          ],
        },
      ],
      steps: [],
      tagIds: [],
    });
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}?yield=6`);
    const jsonLd = extractJsonLd(res.text);
    const visible = visibleIngredientTexts(res.text);

    assert.equal(visible.length, 3, 'all three ingredients are visible in the HTML');
    assert.ok(visible.some((text) => text.includes('Water')));
    assert.ok(visible.some((text) => text.includes('Flour')));
    assert.ok(visible.some((text) => text.includes('Sugar')));

    assert.equal(jsonLd.recipeIngredient.length, 2);
    assert.ok(!jsonLd.recipeIngredient.some((entry) => entry.includes('Water')));
    assert.ok(jsonLd.recipeIngredient.some((entry) => entry.includes('Flour')));
    assert.ok(jsonLd.recipeIngredient.some((entry) => entry.includes('Sugar')));
  });
});

test('ACCEPTANCE 6 on the visible page (D4): an excluded ingredient\'s name is shown but its element has no itemprop="recipeIngredient"', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    replaceRecipeContent(db, recipeId, owner.id, {
      groups: [
        {
          name: null,
          ingredients: [
            { name: 'Flour', amount: 250, unit: 'g' },
            { name: 'Water', amount: null, unit: 'piece', exclude_from_shopping: 1 },
          ],
        },
      ],
      steps: [],
      tagIds: [],
    });
    await shareAction(agent, recipeId, 'enable');
    const { share_token } = shareRow(db, recipeId);

    const res = await request(app).get(`/r/${share_token}`);
    const items = [...res.text.matchAll(/<li class="ingredient-list__item"([^>]*)>([\s\S]*?)<\/li>/g)];
    const waterItem = items.find(([, , inner]) => inner.includes('Water'));
    assert.ok(waterItem, 'expected a list item for the excluded ingredient');
    assert.ok(!waterItem[1].includes('itemprop="recipeIngredient"'));

    const jsonLd = extractJsonLd(res.text);
    assert.ok(!jsonLd.recipeIngredient.some((entry) => entry.includes('Water')));
  });
});
