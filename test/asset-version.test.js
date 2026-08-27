import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { insertRecipe, setRecipeShareState } from '../src/repositories/recipes.js';
import { insertUser } from '../src/repositories/users.js';

const assetVersionUrl = pathToFileURL(
  fileURLToPath(new URL('../src/asset-version.js', import.meta.url))
).href;
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

// asset-version.js computes its hash once at module load (task requirement:
// it must never run per request), so picking up a filesystem change here
// means re-importing it as a distinct module instance each time.
let importCounter = 0;
async function freshComputeAssetVersion() {
  importCounter += 1;
  const mod = await import(`${assetVersionUrl}?t=${Date.now()}-${importCounter}`);
  return mod.computeAssetVersion();
}

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

test('computeAssetVersion returns a non-empty short hex string, stable across calls', async () => {
  const first = await freshComputeAssetVersion();
  assert.match(first, /^[0-9a-f]+$/);
  assert.ok(first.length >= 10 && first.length <= 12, `expected 10-12 hex chars, got "${first}"`);

  const second = await freshComputeAssetVersion();
  assert.equal(second, first);
});

test('computeAssetVersion changes when a served file changes, and reverts once it is removed', async () => {
  const original = await freshComputeAssetVersion();
  const tmpFile = path.join(publicDir, '__asset-version-test-tmp.txt');
  try {
    fs.writeFileSync(tmpFile, 'temporary content for the asset-version test');
    const changed = await freshComputeAssetVersion();
    assert.notEqual(changed, original);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }

  const restored = await freshComputeAssetVersion();
  assert.equal(restored, original);
});

test('GET /login links its stylesheets with a non-empty ?v= query', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);

    const tokensMatch = res.text.match(/\/css\/tokens\.css\?v=([^"]+)"/);
    assert.ok(tokensMatch, 'expected tokens.css link to carry ?v=');
    assert.ok(tokensMatch[1].length > 0);

    const styleMatch = res.text.match(/\/css\/style\.css\?v=([^"]+)"/);
    assert.ok(styleMatch, 'expected style.css link to carry ?v=');
    assert.ok(styleMatch[1].length > 0);
  });
});

test('GET /r/:token (the share page) carries a non-empty ?v= on its stylesheets', async () => {
  await withApp(async (app, db) => {
    const owner = insertUser(db, { username: 'alex', passwordHash: 'unused-hash' });
    const recipe = insertRecipe(db, owner.id, {
      title: 'Versioned Soup',
      yield_amount: 4,
      yield_unit: 'servings',
    });
    const token = 'test-share-token-asset-version';
    setRecipeShareState(db, recipe.id, owner.id, {
      token,
      enabled: 1,
      createdAt: new Date().toISOString(),
    });

    const res = await request(app).get(`/r/${token}`);
    assert.equal(res.status, 200);

    const shareMatch = res.text.match(/\/css\/share\.css\?v=([^"]+)"/);
    assert.ok(shareMatch, 'expected share.css link to carry ?v=');
    assert.ok(shareMatch[1].length > 0);

    const tokensMatch = res.text.match(/\/css\/tokens\.css\?v=([^"]+)"/);
    assert.ok(tokensMatch, 'expected tokens.css link to carry ?v=');
    assert.ok(tokensMatch[1].length > 0);
  });
});

test('a static asset responds with a long-lived, immutable Cache-Control', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/css/tokens.css');
    assert.equal(res.status, 200);
    const cacheControl = res.headers['cache-control'];
    assert.ok(cacheControl, 'expected a Cache-Control header');
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
    assert.ok(maxAgeMatch, `expected a max-age in "${cacheControl}"`);
    assert.ok(Number(maxAgeMatch[1]) >= 31536000, `expected a ~1 year max-age, got "${cacheControl}"`);
    assert.match(cacheControl, /immutable/);
  });
});

test('GUARD: no rendered page references a versioned asset with an empty version', async () => {
  await withApp(async (app, db) => {
    const owner = insertUser(db, { username: 'alex', passwordHash: 'unused-hash' });
    const recipe = insertRecipe(db, owner.id, {
      title: 'Versioned Soup',
      yield_amount: 4,
      yield_unit: 'servings',
    });
    const token = 'test-share-token-asset-version-2';
    setRecipeShareState(db, recipe.id, owner.id, {
      token,
      enabled: 1,
      createdAt: new Date().toISOString(),
    });

    const loginRes = await request(app).get('/login');
    assert.doesNotMatch(loginRes.text, /\?v="/);

    const shareRes = await request(app).get(`/r/${token}`);
    assert.doesNotMatch(shareRes.text, /\?v="/);
  });
});
