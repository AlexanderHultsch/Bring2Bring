import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser, findUserByUsername } from '../src/repositories/users.js';

const KNOWN_USERNAME = 'alex';
const KNOWN_PASSWORD = 'correct-horse-battery';

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

async function seedKnownUser(db) {
  const passwordHash = await hashPassword(KNOWN_PASSWORD);
  return insertUser(db, { username: KNOWN_USERNAME, passwordHash });
}

async function loginAgent(app) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/login');
  const csrfToken = csrfFieldFrom(loginPage.text);
  await agent
    .post('/login')
    .type('form')
    .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });
  return agent;
}

function registrationBody(overrides = {}) {
  return {
    username: 'newbie',
    password: 'a-brand-new-password',
    securityQuestion: 'What city were you born in?',
    securityAnswer: 'Berlin',
    ...overrides,
  };
}

test('GET /register returns 200 and the HTML contains a hidden CSRF input', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/register');
    assert.equal(res.status, 200);
    assert.match(res.text, /type="hidden"\s+name="_csrf"/);
  });
});

test('registering creates an account and signs the user in: redirects to /, and the next request is authenticated', async () => {
  await withApp(async (app, db) => {
    const agent = request.agent(app);
    const page = await agent.get('/register');
    const csrfToken = csrfFieldFrom(page.text);

    const res = await agent
      .post('/register')
      .type('form')
      .send({ _csrf: csrfToken, ...registrationBody() });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');

    assert.ok(findUserByUsername(db, 'newbie'));

    const home = await agent.get('/');
    assert.equal(home.status, 200);
  });
});

test('a registered account is an ordinary user: posting role=admin in the form body still produces role user', async () => {
  await withApp(async (app, db) => {
    const agent = request.agent(app);
    const page = await agent.get('/register');
    const csrfToken = csrfFieldFrom(page.text);

    await agent
      .post('/register')
      .type('form')
      .send({ _csrf: csrfToken, ...registrationBody(), role: 'admin' });

    const stored = findUserByUsername(db, 'newbie');
    assert.equal(stored.role, 'user');
  });
});

test('registration failures re-render with the error, preserve the username, and never echo the password anywhere in the response body', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);
    const page = await agent.get('/register');
    const csrfToken = csrfFieldFrom(page.text);

    const res = await agent
      .post('/register')
      .type('form')
      .send({ _csrf: csrfToken, ...registrationBody({ username: KNOWN_USERNAME }) });
    assert.equal(res.status, 422);
    assert.match(res.text, /already taken/);
    assert.match(res.text, new RegExp(`value="${KNOWN_USERNAME}"`));
    assert.ok(!res.text.includes(registrationBody().password));
  });
});

test('a signed-in user visiting GET /register is redirected to /', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/register');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
  });
});

test('exceeding the rate limit on POST /register returns 429 and renders the register page, not the login page', async () => {
  await withApp(async (app) => {
    const agent = request.agent(app);

    for (let i = 0; i < 10; i += 1) {
      const page = await agent.get('/register');
      const csrfToken = csrfFieldFrom(page.text);
      const res = await agent
        .post('/register')
        .type('form')
        .send({ _csrf: csrfToken, username: 'newbie', password: 'too-short', securityQuestion: 'Q?', securityAnswer: 'A' });
      assert.equal(res.status, 422);
    }

    const page = await agent.get('/register');
    const csrfToken = csrfFieldFrom(page.text);
    const res = await agent
      .post('/register')
      .type('form')
      .send({ _csrf: csrfToken, username: 'newbie', password: 'too-short', securityQuestion: 'Q?', securityAnswer: 'A' });

    assert.equal(res.status, 429);
    assert.match(res.text, /<h1>Register<\/h1>/);
  });
});

test('GET /login links to /register and /reset-password', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
    assert.match(res.text, /href="\/register"/);
    assert.match(res.text, /href="\/reset-password"/);
  });
});
