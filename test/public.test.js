import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser } from '../src/repositories/users.js';
import { insertRecipe, setRecipePublic } from '../src/repositories/recipes.js';

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

test('GET /public without a session redirects 302 to /login', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/public');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
  });
});

test('GET /public logged in as user B lists user A\'s public recipe with @alex and not their private one', async () => {
  await withApp(async (app, db) => {
    const alex = await seedUser(db, 'alex');
    const publicRecipe = insertRecipe(db, alex.id, { title: 'Public Pfannkuchen' });
    setRecipePublic(db, publicRecipe.id, alex.id, true);
    insertRecipe(db, alex.id, { title: 'Alex Private Soup' });

    await seedUser(db, 'blake');
    const agent = await loginAgent(app, 'blake');

    const res = await agent.get('/public');
    assert.equal(res.status, 200);
    assert.match(res.text, /Public Pfannkuchen/);
    assert.match(res.text, /@alex/);
    assert.ok(!res.text.includes('Alex Private Soup'));
  });
});

test('GET /public?sort=title, ?sort=imports and ?sort=recent each return 200, and the default (no sort param) is A-Z', async () => {
  await withApp(async (app, db) => {
    const alex = await seedUser(db, 'alex');
    const zRecipe = insertRecipe(db, alex.id, { title: 'Zucchini Bake' });
    const aRecipe = insertRecipe(db, alex.id, { title: 'Apple Pie' });
    setRecipePublic(db, zRecipe.id, alex.id, true);
    setRecipePublic(db, aRecipe.id, alex.id, true);

    await seedUser(db, 'blake');
    const agent = await loginAgent(app, 'blake');

    for (const sort of ['title', 'imports', 'recent']) {
      const res = await agent.get(`/public?sort=${sort}`);
      assert.equal(res.status, 200, `sort=${sort}`);
    }

    const defaultRes = await agent.get('/public');
    const titleRes = await agent.get('/public?sort=title');
    assert.equal(defaultRes.text, titleRes.text);

    const applePos = defaultRes.text.indexOf('Apple Pie');
    const zucchiniPos = defaultRes.text.indexOf('Zucchini Bake');
    assert.ok(applePos !== -1 && zucchiniPos !== -1);
    assert.ok(applePos < zucchiniPos);
  });
});

test('GET /public with no published recipes shows the "nothing published yet" empty state', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/public');
    assert.equal(res.status, 200);
    assert.match(res.text, /Public dishes from any Dishlist user appear here/);
  });
});
