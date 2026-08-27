import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser } from '../src/repositories/users.js';
import { insertRecipe } from '../src/repositories/recipes.js';
import { applyShareAction } from '../src/services/sharing.js';

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

test('the burger menu markup contains the Log out form with a CSRF field, and the Report a bug link with rel="noopener noreferrer"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);

    assert.match(res.text, /<form method="post" action="\/logout"[^>]*class="menu__item-form"/);
    assert.match(res.text, /name="_csrf" value="[^"]+"/);
    assert.match(
      res.text,
      /href="https:\/\/github\.com\/AlexanderHultsch\/Dishlist\/issues"[^>]*rel="noopener noreferrer"/
    );
  });
});

test('the bottom nav appears on / and on a recipe page, and does NOT appear in the response of GET /r/:token', async () => {
  await withApp(async (app, db) => {
    const owner = await seedUser(db, 'alex');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    db.prepare('INSERT INTO ingredient_groups (recipe_id, name, position) VALUES (?, NULL, 0)').run(recipe.id);
    const group = db.prepare('SELECT id FROM ingredient_groups WHERE recipe_id = ?').get(recipe.id);
    db.prepare(
      'INSERT INTO ingredients (group_id, name, scales, is_optional, exclude_from_shopping, position) VALUES (?, ?, 1, 0, 0, 0)'
    ).run(group.id, 'Broth');
    applyShareAction(db, recipe.id, owner.id, 'enable');
    const shared = db.prepare('SELECT share_token FROM recipes WHERE id = ?').get(recipe.id);

    const agent = await loginAgent(app, 'alex');

    const listRes = await agent.get('/');
    assert.match(listRes.text, /class="bottom-nav"/);

    const recipeRes = await agent.get(`/recipes/${recipe.id}`);
    assert.match(recipeRes.text, /class="bottom-nav"/);

    const shareRes = await request(app).get(`/r/${shared.share_token}`);
    assert.equal(shareRes.status, 200);
    assert.ok(!shareRes.text.includes('class="bottom-nav"'));
  });
});

test('the bottom nav is not present on the login page or the error page', async () => {
  await withApp(async (app) => {
    const loginRes = await request(app).get('/login');
    assert.ok(!loginRes.text.includes('class="bottom-nav"'));

    const errorRes = await request(app).get('/this-does-not-exist');
    assert.ok(!errorRes.text.includes('class="bottom-nav"'));
  });
});
