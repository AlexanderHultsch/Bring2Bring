import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { redactPath } from '../src/middleware/request-logger.js';

const packageJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'package.json'
);
const { version: expectedVersion } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

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
    await fn(app);
  } finally {
    cleanup();
  }
}

test('GET /healthz returns 200 JSON with status ok and the package version', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/healthz');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.version, 'string');
    assert.ok(res.body.version.length > 0);
    assert.equal(res.body.version, expectedVersion);
  });
});

test('GET /healthz response body has no keys other than status and version', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/healthz');
    assert.deepEqual(Object.keys(res.body).sort(), ['status', 'version']);
  });
});

test('GET /healthz sets no Set-Cookie header', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/healthz');
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

test('the CSP header locks scripts and styles to self and forbids unsafe-inline', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/healthz');
    const csp = res.headers['content-security-policy'];
    assert.ok(csp);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.ok(!csp.includes('unsafe-inline'));
  });
});

test('X-Content-Type-Options is nosniff', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/healthz');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });
});

test('an unknown path returns 404 and the HTML body mentions Not found', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/this-does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.text, /Not found/);
  });
});

test('an unknown path with Accept: application/json returns 404 with a JSON body', async () => {
  await withApp(async (app) => {
    const res = await request(app)
      .get('/this-does-not-exist')
      .set('Accept', 'application/json');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not found');
  });
});

test('a request well under the global ceiling succeeds', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
  });
});

test('the 301st request from the same client within the window returns 429 (SPECIFICATION.md section 11 global ceiling)', async () => {
  await withApp(async (app) => {
    const agent = request.agent(app);
    for (let i = 0; i < 300; i += 1) {
      const res = await agent.get('/login');
      assert.equal(res.status, 200);
    }

    const res = await agent.get('/login');
    assert.equal(res.status, 429);
  });
});

test('the global ceiling does not leak across app instances: a fresh app starts with a clean count', async () => {
  await withApp(async (firstApp) => {
    const firstAgent = request.agent(firstApp);
    for (let i = 0; i < 300; i += 1) {
      await firstAgent.get('/login');
    }
    const exhausted = await firstAgent.get('/login');
    assert.equal(exhausted.status, 429);
  });

  await withApp(async (secondApp) => {
    const res = await request(secondApp).get('/login');
    assert.equal(res.status, 200);
  });
});

test('static assets are exempt from the global ceiling (mounted before it in src/app.js)', async () => {
  await withApp(async (app) => {
    const agent = request.agent(app);
    for (let i = 0; i < 300; i += 1) {
      const res = await agent.get('/login');
      assert.equal(res.status, 200);
    }
    await agent.get('/login').expect(429);

    const cssRes = await agent.get('/css/style.css');
    assert.notEqual(cssRes.status, 429);
  });
});

test('redactPath redacts share tokens and leaves other paths untouched', () => {
  assert.equal(redactPath('/r/AbC123-token_xyz'), '/r/[redacted]');
  assert.equal(redactPath('/recipes/12'), '/recipes/12');
  assert.equal(redactPath('/'), '/');
});
