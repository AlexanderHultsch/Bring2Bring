import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser, findUserById } from '../src/repositories/users.js';
import { insertRecipe, replaceRecipeContent, setRecipePublic } from '../src/repositories/recipes.js';

// SPECIFICATION.md section 6.4 / 9 (v2.0, D3): "admin acts without reading".
// These tests exercise the routes and views built on top of the already
// tested src/repositories/admin.js and src/services/admin.js (see
// test/admin.test.js for the repository/service-level coverage).

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

async function seedUser(db, username, role) {
  const passwordHash = await hashPassword(PASSWORD);
  return insertUser(db, { username, passwordHash, role });
}

async function loginAgent(app, username) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/login');
  const csrfToken = csrfFieldFrom(loginPage.text);
  await agent.post('/login').type('form').send({ _csrf: csrfToken, username, password: PASSWORD });
  return agent;
}

// The double-submit CSRF token is bound to the session, not the route (see
// test/authorization.test.js), so any authenticated page's hidden field —
// here, the logout form the menu always renders — works for any POST.
async function csrfFor(agent, path) {
  const page = await agent.get(path);
  return csrfFieldFrom(page.text);
}

test('GET /admin/recipes and /admin/users redirect an unauthenticated caller to /login', async () => {
  await withApp(async (app) => {
    for (const path of ['/admin/recipes', '/admin/users']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.location, '/login', path);
    }
  });
});

test('GET /admin/recipes and /admin/users answer 404, not 403, for a logged-in non-admin', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'plain');
    const agent = await loginAgent(app, 'plain');

    for (const path of ['/admin/recipes', '/admin/users']) {
      const res = await agent.get(path);
      assert.equal(res.status, 404, path);
    }
  });
});

test('GET /admin/recipes and /admin/users answer 200 for an admin', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'root', 'admin');
    const agent = await loginAgent(app, 'root');

    for (const path of ['/admin/recipes', '/admin/users']) {
      const res = await agent.get(path);
      assert.equal(res.status, 200, path);
    }
  });
});

// ACCEPTANCE 14 (SPECIFICATION.md section 13), over HTTP rather than at the
// repository level (test/admin.test.js already covers the repository).
test('ACCEPTANCE 14 over HTTP: GET /admin/recipes leaks no ingredient name or method text', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'root', 'admin');
    const owner = await seedUser(db, 'someoneelse');
    const recipe = insertRecipe(db, owner.id, { title: "Someone Else's Recipe" });
    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [{ name: null, ingredients: [{ name: 'Zimtstange' }] }],
      steps: [{ text: 'GEHEIM' }],
      tagIds: [],
    });

    const agent = await loginAgent(app, 'root');
    const res = await agent.get('/admin/recipes');

    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('Zimtstange'));
    assert.ok(!res.text.includes('GEHEIM'));
  });
});

test('the admin recipe list shows the recipe title and its author username', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'root', 'admin');
    const owner = await seedUser(db, 'someoneelse');
    insertRecipe(db, owner.id, { title: 'Distinctive Soup Title' });

    const agent = await loginAgent(app, 'root');
    const res = await agent.get('/admin/recipes');

    assert.match(res.text, /Distinctive Soup Title/);
    assert.match(res.text, /someoneelse/);
  });
});

test('POST /admin/recipes/:id/unpublish clears is_public; the recipe disappears from GET /public', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'root', 'admin');
    const owner = await seedUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    setRecipePublic(db, recipe.id, owner.id, true);

    const adminAgent = await loginAgent(app, 'root');
    const csrfToken = await csrfFor(adminAgent, '/admin/recipes');
    const res = await adminAgent
      .post(`/admin/recipes/${recipe.id}/unpublish`)
      .type('form')
      .send({ _csrf: csrfToken });
    assert.equal(res.status, 302);
    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id).is_public, 0);

    const ownerAgent = await loginAgent(app, 'owner');
    const publicRes = await ownerAgent.get('/public');
    assert.ok(!publicRes.text.includes('Soup'));
  });
});

test('POST /admin/recipes/:id/unpublish by a non-admin answers 404 and does not change is_public', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'plain');
    const owner = await seedUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    setRecipePublic(db, recipe.id, owner.id, true);

    const agent = await loginAgent(app, 'plain');
    const csrfToken = await csrfFor(agent, '/');
    const res = await agent
      .post(`/admin/recipes/${recipe.id}/unpublish`)
      .type('form')
      .send({ _csrf: csrfToken });

    assert.equal(res.status, 404);
    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id).is_public, 1);
  });
});

test('POST /admin/recipes/:id/delete removes the recipe', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'root', 'admin');
    const owner = await seedUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const agent = await loginAgent(app, 'root');
    const csrfToken = await csrfFor(agent, '/admin/recipes');
    const res = await agent.post(`/admin/recipes/${recipe.id}/delete`).type('form').send({ _csrf: csrfToken });

    assert.equal(res.status, 302);
    assert.equal(db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipe.id), undefined);
  });
});

test('POST /admin/users/:id/delete removes a normal user and their recipes', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'root', 'admin');
    const target = await seedUser(db, 'someone');
    const recipe = insertRecipe(db, target.id, { title: 'Soup' });

    const agent = await loginAgent(app, 'root');
    const csrfToken = await csrfFor(agent, '/admin/users');
    const res = await agent.post(`/admin/users/${target.id}/delete`).type('form').send({ _csrf: csrfToken });

    assert.equal(res.status, 302);
    assert.equal(findUserById(db, target.id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipe.id), undefined);
  });
});

test('deleting the last admin is refused, and the response says so', async () => {
  await withApp(async (app, db) => {
    const admin = await seedUser(db, 'root', 'admin');

    const agent = await loginAgent(app, 'root');
    const csrfToken = await csrfFor(agent, '/admin/users');
    const res = await agent.post(`/admin/users/${admin.id}/delete`).type('form').send({ _csrf: csrfToken });

    assert.equal(res.status, 422);
    assert.match(res.text, /last remaining admin/i);
    assert.ok(findUserById(db, admin.id));
  });
});

test('the burger menu contains an Admin link for an admin and does not for a normal user', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'root', 'admin');
    await seedUser(db, 'plain');

    const adminAgent = await loginAgent(app, 'root');
    const adminHome = await adminAgent.get('/');
    assert.match(adminHome.text, /href="\/admin\/recipes"/);

    const plainAgent = await loginAgent(app, 'plain');
    const plainHome = await plainAgent.get('/');
    assert.ok(!plainHome.text.includes('href="/admin/recipes"'));
  });
});
