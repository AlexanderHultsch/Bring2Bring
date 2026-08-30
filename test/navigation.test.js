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
import { applyShareAction } from '../src/services/sharing.js';

const headerPartialPath = fileURLToPath(new URL('../src/views/partials/header.ejs', import.meta.url));

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
      /href="https:\/\/github\.com\/AlexanderHultsch\/Bring2Bring\/issues"[^>]*rel="noopener noreferrer"/
    );
  });
});

test('the burger menu toggle is a summary child of .menu, with both open and close icons present', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);

    assert.match(res.text, /<details class="menu"[^>]*>\s*<summary class="menu__toggle"/);
    assert.match(res.text, /class="icon menu__icon-open"/);
    assert.match(res.text, /class="icon menu__icon-close"/);
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

// SPECIFICATION.md decision F3 (v2.2): after New becomes an ordinary nav
// item, "Send to Bring!" is the only accent-coloured primary button anywhere.
test('the bottom nav has no primary item, and all three items carry a label', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('bottom-nav__item--primary'));

    const labels = [...res.text.matchAll(/class="bottom-nav__label"/g)];
    assert.equal(labels.length, 3);
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

// SPECIFICATION.md L1 (v2.7): the header becomes three zones so the wordmark
// centres on the screen; the theme toggle is no longer a header control.
test('the header renders exactly one .site-header__brand, and the theme toggle is not inside .site-header', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);

    const brandMatches = [...res.text.matchAll(/class="site-header__brand"/g)];
    assert.equal(brandMatches.length, 1);

    // The burger menu (which now carries the theme toggle) is included inside
    // .site-header's markup, so a rendered-HTML substring check can't tell
    // "toggle in the header row" from "toggle in the off-canvas menu panel".
    // Check the header partial's own source instead: it must define no
    // theme toggle of its own any more.
    const headerSrc = fs.readFileSync(headerPartialPath, 'utf8');
    assert.ok(!headerSrc.includes('theme-toggle'), 'header.ejs must not define the theme toggle any more');
  });
});

// SPECIFICATION.md L2 (v2.7): the theme toggle moves into the burger menu,
// as a menu row beside Account and Privacy.
test('a logged-in page\'s burger menu markup contains the theme toggle as a menu__item row with both sun and moon icons', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');

    const res = await agent.get('/');
    assert.equal(res.status, 200);

    assert.match(res.text, /<button type="button" class="menu__item" data-theme-toggle>/);
    assert.match(res.text, /class="icon theme-toggle__sun"><use href="#i-sun">/);
    assert.match(res.text, /class="icon theme-toggle__moon"><use href="#i-moon">/);
  });
});

// SPECIFICATION.md L2 (v2.7), stated consequence: the menu only renders for
// a logged-in user, so the login page has no manual theme control any more.
test('the login page (logged out) renders the header without any theme toggle — L2 accepted consequence', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('data-theme-toggle'));
  });
});
