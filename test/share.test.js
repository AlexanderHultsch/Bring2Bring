import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser } from '../src/repositories/users.js';
import { redactPath } from '../src/middleware/request-logger.js';

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
    yield_amount: '4',
    yield_unit: 'servings',
    groups: [
      {
        name: 'Base',
        ingredients: [{ name: 'Flour', amount: '250', unit: 'g', scales: true }],
      },
    ],
    steps: [{ text: 'Mix.' }],
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

test('the share page contains no app chrome: no username, no link to /, no link to /login, no "Dishlist" nav link', async () => {
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
    assert.ok(!/>Dishlist</.test(res.text));
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
