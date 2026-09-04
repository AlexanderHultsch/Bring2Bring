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

const PASSWORD = 'correct-horse-battery';

const viewsDir = fileURLToPath(new URL('../src/views/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const headSrc = fs.readFileSync(path.join(viewsDir, 'partials', 'head.ejs'), 'utf8');
const shareSrc = fs.readFileSync(path.join(viewsDir, 'share.ejs'), 'utf8');
const manifestSrc = fs.readFileSync(path.join(publicDir, 'site.webmanifest'), 'utf8');

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

async function createRecipe(agent) {
  const newPage = await agent.get('/recipes/new');
  const csrfToken = csrfFieldFrom(newPage.text);
  const createRes = await agent
    .post('/recipes')
    .type('form')
    .send(
      encodeForm({
        _csrf: csrfToken,
        title: 'Iconic Soup',
        servings: '4',
        ingredients: [{ name: 'Flour', amount: '250', unit: 'g' }],
        method: 'Mix.',
      })
    );
  return Number(createRes.headers.location.split('?')[0].split('/').filter(Boolean).pop());
}

async function enableShare(agent, recipeId, db) {
  const showPage = await agent.get(`/recipes/${recipeId}`);
  const csrfToken = csrfFieldFrom(showPage.text);
  await agent
    .post(`/recipes/${recipeId}/share/link`)
    .type('form')
    .send({ _csrf: csrfToken, action: 'enable' });
  return db.prepare('SELECT share_token FROM recipes WHERE id = ?').get(recipeId).share_token;
}

// Icon `<link>` tags reference /path?v=<assetVersion>; extract the path only.
function iconHrefsFrom(templateSrc) {
  return [...templateSrc.matchAll(/<link\s+rel="(?:icon|apple-touch-icon)"[^>]*href="([^"?]+)/g)].map(
    (m) => m[1]
  );
}

function manifestIconSrcs() {
  const manifest = JSON.parse(manifestSrc);
  return manifest.icons.map((icon) => icon.src);
}

test('GUARD: every icon file referenced by head.ejs, share.ejs and site.webmanifest exists in public/', () => {
  const referenced = new Set([...iconHrefsFrom(headSrc), ...iconHrefsFrom(shareSrc), ...manifestIconSrcs()]);
  assert.ok(referenced.size >= 4, `expected several icon files referenced, found ${referenced.size}`);
  for (const href of referenced) {
    const filePath = path.join(publicDir, href);
    assert.ok(fs.existsSync(filePath), `${href} is referenced but does not exist in public/`);
  }
});

test('site.webmanifest parses as JSON and every icons[].src resolves to a real file', () => {
  const manifest = JSON.parse(manifestSrc);
  assert.equal(manifest.name, 'Bring2Bring!');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    const filePath = path.join(publicDir, icon.src);
    assert.ok(fs.existsSync(filePath), `manifest icon ${icon.src} does not exist in public/`);
  }
});

test('GET /login carries the icon links, the manifest link and both theme-color metas', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
    assert.match(res.text, /<link rel="icon" href="\/img\/logo\.svg\?v=[^"]+" type="image\/svg\+xml">/);
    assert.match(res.text, /<link rel="icon" href="\/favicon\.ico\?v=[^"]+" sizes="16x16 32x32 48x48">/);
    assert.match(res.text, /<link rel="apple-touch-icon" href="\/img\/apple-touch-icon\.png\?v=[^"]+">/);
    assert.match(res.text, /<link rel="manifest" href="\/site\.webmanifest\?v=[^"]+">/);
    assert.match(
      res.text,
      /<meta name="theme-color" content="#fafaf8" media="\(prefers-color-scheme: light\)">/
    );
    assert.match(
      res.text,
      /<meta name="theme-color" content="#0f1113" media="\(prefers-color-scheme: dark\)">/
    );
  });
});

test('GET /r/:token (share page) carries the icon links but no rel="manifest"', async () => {
  await withApp(async (app, db) => {
    await seedUser(db, 'alex');
    const agent = await loginAgent(app, 'alex');
    const recipeId = await createRecipe(agent);
    const shareToken = await enableShare(agent, recipeId, db);

    const res = await request(app).get(`/r/${shareToken}`);
    assert.equal(res.status, 200);
    assert.match(res.text, /<link rel="icon" href="\/img\/logo\.svg\?v=[^"]+" type="image\/svg\+xml">/);
    assert.match(res.text, /<link rel="icon" href="\/favicon\.ico\?v=[^"]+" sizes="16x16 32x32 48x48">/);
    assert.match(res.text, /<link rel="apple-touch-icon" href="\/img\/apple-touch-icon\.png\?v=[^"]+">/);
    assert.ok(!res.text.includes('rel="manifest"'), 'share page must not be installable');
  });
});
