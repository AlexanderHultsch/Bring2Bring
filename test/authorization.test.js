import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    servings: '4',
    ingredients: [{ name: 'Salt', unit: 'piece' }],
  };
}

// method, path template (":id" substituted with a recipe id when recipeScoped),
// whether the route is scoped to a recipe, and (for POST routes) a body to send.
const ROUTES = [
  { method: 'get', path: '/', recipeScoped: false },
  { method: 'get', path: '/public', recipeScoped: false },
  { method: 'get', path: '/recipes/new', recipeScoped: false },
  { method: 'post', path: '/recipes', recipeScoped: false, body: minimalRecipeFormBody() },
  { method: 'get', path: '/recipes/:id', recipeScoped: true },
  { method: 'get', path: '/recipes/:id/edit', recipeScoped: true },
  { method: 'post', path: '/recipes/:id', recipeScoped: true, body: minimalRecipeFormBody() },
  { method: 'post', path: '/recipes/:id/duplicate', recipeScoped: true, body: {} },
  // A valid action is required so the assertion below proves the auth check
  // fired, not the PublishActionSchema validation in src/routes/recipes.js.
  { method: 'post', path: '/recipes/:id/publish', recipeScoped: true, body: { action: 'publish' } },
  // A valid action is required so the assertion below proves the auth check
  // fired, not the ShareActionSchema validation in src/routes/recipes.js.
  { method: 'post', path: '/recipes/:id/share/link', recipeScoped: true, body: { action: 'enable' } },
  { method: 'get', path: '/recipes/:id/bring', recipeScoped: true },
  { method: 'post', path: '/recipes/:id/delete', recipeScoped: true, body: {} },
  { method: 'post', path: '/recipes/:id/restore', recipeScoped: true, body: {} },
  { method: 'get', path: '/account', recipeScoped: false },
  { method: 'post', path: '/account/password', recipeScoped: false, body: {} },
  // A valid body is required so the assertion below proves the auth check
  // fired, not the UnitPreferencesSchema validation in src/services/account.js.
  { method: 'post', path: '/account/units', recipeScoped: false, body: { unitLanguage: 'de', measurementSystem: 'metric' } },
  { method: 'get', path: '/privacy', recipeScoped: false },
  { method: 'post', path: '/logout', recipeScoped: false, body: {} },
  // Admin routes (SPECIFICATION.md section 6.4 / 9, v2.0, D3): requireAuth()
  // then requireAdmin(), so a logged-in non-admin — exactly the "stranger" of
  // Group B/D below — gets 404 like any other recipe this user doesn't own.
  { method: 'get', path: '/admin/recipes', recipeScoped: false },
  { method: 'post', path: '/admin/recipes/:id/unpublish', recipeScoped: true, body: {} },
  { method: 'post', path: '/admin/recipes/:id/delete', recipeScoped: true, body: {} },
  { method: 'get', path: '/admin/users', recipeScoped: false },
  { method: 'post', path: '/admin/users/:id/delete', recipeScoped: true, body: {} },
];

// Routes deliberately excluded from the completeness guard below: reachable
// without a session by design, so they have no place in ROUTES above.
const PUBLIC_ROUTES = [
  { method: 'get', path: '/healthz' }, // §9: for Uptime Kuma
  { method: 'get', path: '/login' }, // §9: public by design
  { method: 'post', path: '/login' }, // §9: public by design
  { method: 'get', path: '/r/:token' }, // §8.3: the one route open to the internet
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

test('GUARD: every route mounted in src/routes/ is either in ROUTES or PUBLIC_ROUTES', () => {
  // All routers in src/app.js are mounted with app.use(router) — no path
  // prefix — so the string literal inside router.get(...)/router.post(...)
  // is already the route's full path. Verified by reading src/app.js: every
  // `app.use(...Router(...))` call there takes no leading path argument.
  const routesDir = fileURLToPath(new URL('../src/routes/', import.meta.url));
  const mounted = [];
  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
    for (const m of src.matchAll(/router\.(get|post)\(\s*['"]([^'"]+)['"]/g)) {
      mounted.push({ method: m[1], path: m[2], file });
    }
  }

  const isKnown = (route, table) =>
    table.some((r) => r.method === route.method && r.path === route.path);

  const missing = mounted.filter(
    (route) => !isKnown(route, ROUTES) && !isKnown(route, PUBLIC_ROUTES)
  );

  assert.equal(
    missing.length,
    0,
    `route(s) mounted in src/routes/ but missing from ROUTES (and not in PUBLIC_ROUTES): ${missing
      .map((r) => `${r.method.toUpperCase()} ${r.path} (${r.file})`)
      .join(', ')}`
  );
});
