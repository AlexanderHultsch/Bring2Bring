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
const LOGIN_ERROR_MESSAGE = 'Invalid username or password.';

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

test('GET /login returns 200 and the HTML contains a hidden CSRF input', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
    assert.match(res.text, /type="hidden"\s+name="_csrf"/);
  });
});

test('POST /login with correct credentials redirects (302) to /', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    const loginPage = await agent.get('/login');
    const csrfToken = csrfFieldFrom(loginPage.text);

    const res = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });

    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
  });
});

test('after logging in, GET / returns 200 and contains the username', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    const loginPage = await agent.get('/login');
    const csrfToken = csrfFieldFrom(loginPage.text);

    await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });

    const res = await agent.get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, new RegExp(KNOWN_USERNAME));
  });
});

test('GET / without a session redirects 302 to /login', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
  });
});

test('POST /login with a wrong password re-renders with exactly the generic error and does not set a logged-in session', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    const loginPage = await agent.get('/login');
    const csrfToken = csrfFieldFrom(loginPage.text);

    const res = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: 'wrong-password' });

    assert.equal(res.status, 401);
    assert.match(res.text, /Invalid username or password\./);

    const home = await agent.get('/');
    assert.equal(home.status, 302);
    assert.equal(home.headers.location, '/login');
  });
});

test('POST /login with an unknown username produces the identical error text as a wrong password', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);

    const wrongPasswordAgent = request.agent(app);
    const wrongPasswordLoginPage = await wrongPasswordAgent.get('/login');
    const wrongPasswordCsrf = csrfFieldFrom(wrongPasswordLoginPage.text);
    const wrongPasswordRes = await wrongPasswordAgent
      .post('/login')
      .type('form')
      .send({ _csrf: wrongPasswordCsrf, username: KNOWN_USERNAME, password: 'wrong-password' });

    const unknownUserAgent = request.agent(app);
    const unknownUserLoginPage = await unknownUserAgent.get('/login');
    const unknownUserCsrf = csrfFieldFrom(unknownUserLoginPage.text);
    const unknownUserRes = await unknownUserAgent
      .post('/login')
      .type('form')
      .send({ _csrf: unknownUserCsrf, username: 'ghost', password: 'anything' });

    assert.equal(wrongPasswordRes.status, 401);
    assert.equal(unknownUserRes.status, 401);

    const wrongPasswordError = wrongPasswordRes.text.match(/<p class="form-error">([^<]+)<\/p>/)[1];
    const unknownUserError = unknownUserRes.text.match(/<p class="form-error">([^<]+)<\/p>/)[1];

    assert.equal(wrongPasswordError, LOGIN_ERROR_MESSAGE);
    assert.equal(unknownUserError, LOGIN_ERROR_MESSAGE);
    assert.equal(wrongPasswordError, unknownUserError);
  });
});

test('the session cookie is HttpOnly and SameSite=Lax', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    const loginPage = await agent.get('/login');
    const csrfToken = csrfFieldFrom(loginPage.text);

    const res = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });

    const setCookie = res.headers['set-cookie'].find((c) => c.startsWith('dishlist.sid='));
    assert.ok(setCookie, 'expected a dishlist.sid cookie to be set once a session holds data');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/i);
  });
});

test('POST /login without a CSRF token is rejected with 403', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);
    await agent.get('/login');

    const res = await agent
      .post('/login')
      .type('form')
      .send({ username: KNOWN_USERNAME, password: KNOWN_PASSWORD });

    assert.equal(res.status, 403);
  });
});

test('POST /logout with a valid CSRF token destroys the session: a subsequent GET / redirects to /login', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    const loginPage = await agent.get('/login');
    const loginCsrf = csrfFieldFrom(loginPage.text);
    await agent
      .post('/login')
      .type('form')
      .send({ _csrf: loginCsrf, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });

    const homePage = await agent.get('/');
    const logoutCsrf = csrfFieldFrom(homePage.text);

    const logoutRes = await agent.post('/logout').type('form').send({ _csrf: logoutCsrf });
    assert.equal(logoutRes.status, 302);
    assert.equal(logoutRes.headers.location, '/login');

    const home = await agent.get('/');
    assert.equal(home.status, 302);
    assert.equal(home.headers.location, '/login');
  });
});

test('the session id changes between the pre-login request and the post-login request', async () => {
  // With saveUninitialized false (D1), an anonymous GET /login never gets a
  // persisted session, so there is no pre-login session id to capture and
  // compare directly. Logging in twice (with a logout in between) instead
  // shows that session.regenerate() hands out a fresh id each time (D3),
  // which is the externally observable effect of the fixation defence.
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    const firstLoginPage = await agent.get('/login');
    const firstCsrf = csrfFieldFrom(firstLoginPage.text);
    const firstLoginRes = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: firstCsrf, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });
    const firstSessionCookie = firstLoginRes.headers['set-cookie'].find((c) =>
      c.startsWith('dishlist.sid=')
    );

    const homePage = await agent.get('/');
    const logoutCsrf = csrfFieldFrom(homePage.text);
    await agent.post('/logout').type('form').send({ _csrf: logoutCsrf });

    const secondLoginPage = await agent.get('/login');
    const secondCsrf = csrfFieldFrom(secondLoginPage.text);
    const secondLoginRes = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: secondCsrf, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });
    const secondSessionCookie = secondLoginRes.headers['set-cookie'].find((c) =>
      c.startsWith('dishlist.sid=')
    );

    assert.ok(firstSessionCookie);
    assert.ok(secondSessionCookie);
    assert.notEqual(firstSessionCookie.split(';')[0], secondSessionCookie.split(';')[0]);
  });
});

test('last_login_at is non-null in the database after a successful login', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    const loginPage = await agent.get('/login');
    const csrfToken = csrfFieldFrom(loginPage.text);

    assert.equal(findUserByUsername(db, KNOWN_USERNAME).last_login_at, null);

    await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });

    assert.notEqual(findUserByUsername(db, KNOWN_USERNAME).last_login_at, null);
  });
});

test('the 11th login attempt from the same client within the window returns 429', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = request.agent(app);

    for (let i = 0; i < 10; i += 1) {
      const loginPage = await agent.get('/login');
      const csrfToken = csrfFieldFrom(loginPage.text);
      const res = await agent
        .post('/login')
        .type('form')
        .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: 'wrong-password' });
      assert.equal(res.status, 401);
    }

    const loginPage = await agent.get('/login');
    const csrfToken = csrfFieldFrom(loginPage.text);
    const res = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, username: KNOWN_USERNAME, password: 'wrong-password' });

    assert.equal(res.status, 429);
  });
});
