import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser } from '../src/repositories/users.js';
import { insertRecipe } from '../src/repositories/recipes.js';

// This file makes acceptance criterion 4 (SPECIFICATION.md §13) impossible to
// regress: every authenticated route redirects to /login when unauthenticated,
// and every recipe-scoped route 404s for a recipe belonging to another user.
// The route table below is read off src/routes/recipes.js and src/routes/auth.js
// directly (plus src/routes/health.js for the one public route it mounts) — a
// route added to those files without a matching entry here is the thing this
// file is meant to make a reviewer notice.

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

// The double-submit CSRF token is bound to req.session.userId ('anonymous'
// when there is none — see src/middleware/csrf.js), not to the target route,
// so a token collected from GET /login as an anonymous visitor is valid for a
// POST to any route while that visitor stays unauthenticated.
async function anonymousCsrf(agent) {
  const page = await agent.get('/login');
  return csrfFieldFrom(page.text);
}

function minimalRecipeFormBody() {
  return {
    title: 'Hijacked title',
    yield_amount: '4',
    yield_unit: 'servings',
  };
}

// method, path template (":id" substituted with a recipe id when recipeScoped),
// whether the route is scoped to a recipe, and (for POST routes) a body to send.
const ROUTES = [
  { method: 'get', path: '/', recipeScoped: false },
  { method: 'get', path: '/recipes/new', recipeScoped: false },
  { method: 'post', path: '/recipes', recipeScoped: false, body: minimalRecipeFormBody() },
  { method: 'get', path: '/recipes/:id', recipeScoped: true },
  { method: 'get', path: '/recipes/:id/edit', recipeScoped: true },
  { method: 'post', path: '/recipes/:id', recipeScoped: true, body: minimalRecipeFormBody() },
  { method: 'post', path: '/recipes/:id/duplicate', recipeScoped: true, body: {} },
  { method: 'post', path: '/recipes/:id/delete', recipeScoped: true, body: {} },
  { method: 'post', path: '/logout', recipeScoped: false, body: {} },
];

function resolvePath(route, recipeId) {
  return route.recipeScoped ? route.path.replace(':id', String(recipeId)) : route.path;
}

test('Group A: every authenticated route redirects an unauthenticated caller to /login', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    for (const route of ROUTES) {
      const agent = request.agent(app);
      const path = resolvePath(route, recipe.id);

      let res;
      if (route.method === 'get') {
        res = await agent.get(path);
      } else {
        const csrfToken = await anonymousCsrf(agent);
        res = await agent
          .post(path)
          .type('form')
          .send({ _csrf: csrfToken, ...route.body });
      }

      assert.equal(res.status, 302, `${route.method.toUpperCase()} ${path}`);
      assert.equal(res.headers.location, '/login', `${route.method.toUpperCase()} ${path}`);
    }
  });
});

test('Group B: every recipe-scoped route returns exactly 404 for another user\'s recipe', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Secret Soup' });

    const agent = await loginAgent(app, 'stranger');

    for (const route of ROUTES.filter((r) => r.recipeScoped)) {
      const path = resolvePath(route, recipe.id);

      let res;
      if (route.method === 'get') {
        res = await agent.get(path);
      } else {
        const csrfToken = csrfFieldFrom((await agent.get('/')).text);
        res = await agent
          .post(path)
          .type('form')
          .send({ _csrf: csrfToken, ...route.body });
      }

      assert.equal(res.status, 404, `${route.method.toUpperCase()} ${path}`);
    }
  });
});

test('Group C: the public routes stay public', async () => {
  await withApp(async (app) => {
    const health = await request(app).get('/healthz');
    assert.equal(health.status, 200);

    const loginPage = await request(app).get('/login');
    assert.equal(loginPage.status, 200);

    const anonAgent = request.agent(app);
    const csrfToken = await anonymousCsrf(anonAgent);
    const loginRes = await anonAgent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: 'nobody', password: 'wrong' });
    assert.equal(loginRes.status, 401);
  });
});

test('Group D: a cross-user POST attempt does not modify the target recipe', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'owner');
    await seedUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Secret Soup' });
    db.prepare('INSERT INTO ingredient_groups (recipe_id, name, position) VALUES (?, ?, 0)').run(
      recipe.id,
      'Base'
    );
    const group = db.prepare('SELECT id FROM ingredient_groups WHERE recipe_id = ?').get(recipe.id);
    db.prepare(
      'INSERT INTO ingredients (group_id, name, scales, is_optional, exclude_from_shopping, position) VALUES (?, ?, 1, 0, 0, 0)'
    ).run(group.id, 'Tomatoes');
    db.prepare('INSERT INTO steps (recipe_id, position, text) VALUES (?, 0, ?)').run(
      recipe.id,
      'Chop.'
    );

    const rowCounts = () => ({
      title: db.prepare('SELECT title FROM recipes WHERE id = ?').get(recipe.id).title,
      ingredients: db
        .prepare(
          `SELECT COUNT(*) AS c FROM ingredients i
           JOIN ingredient_groups g ON g.id = i.group_id
           WHERE g.recipe_id = ?`
        )
        .get(recipe.id).c,
      steps: db.prepare('SELECT COUNT(*) AS c FROM steps WHERE recipe_id = ?').get(recipe.id).c,
    });

    const before = rowCounts();

    const agent = await loginAgent(app, 'stranger');
    const postRoutes = ROUTES.filter((r) => r.recipeScoped && r.method === 'post');

    for (const route of postRoutes) {
      const path = resolvePath(route, recipe.id);
      const csrfToken = csrfFieldFrom((await agent.get('/')).text);
      const res = await agent
        .post(path)
        .type('form')
        .send({ _csrf: csrfToken, ...route.body });
      assert.equal(res.status, 404, `${route.method.toUpperCase()} ${path}`);
    }

    assert.deepEqual(rowCounts(), before);
  });
});
