import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser } from '../src/repositories/users.js';

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

test('GET /reset-password returns 200 and the HTML contains a hidden CSRF input', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/reset-password');
    assert.equal(res.status, 200);
    assert.match(res.text, /type="hidden"\s+name="_csrf"/);
  });
});

test('a signed-in user visiting GET /reset-password is redirected to /', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/reset-password');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
  });
});

test('the full reset journey: register, log out, look up the question, answer it with different capitalisation, set a new password, log in with it, and the old password fails', async () => {
  await withApp(async (app) => {
    const NEW_PASSWORD = 'brand-new-long-password';
    const agent = request.agent(app);

    const registerPage = await agent.get('/register');
    const registerCsrf = csrfFieldFrom(registerPage.text);
    const registerRes = await agent.post('/register').type('form').send({
      _csrf: registerCsrf,
      username: 'newbie',
      password: KNOWN_PASSWORD,
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(registerRes.status, 302);
    assert.equal(registerRes.headers.location, '/');

    const logoutCsrf = csrfFieldFrom((await agent.get('/')).text);
    const logoutRes = await agent.post('/logout').type('form').send({ _csrf: logoutCsrf });
    assert.equal(logoutRes.status, 302);

    const lookupPage = await agent.get('/reset-password');
    const lookupCsrf = csrfFieldFrom(lookupPage.text);
    const lookupRes = await agent
      .post('/reset-password')
      .type('form')
      .send({ _csrf: lookupCsrf, username: 'newbie' });
    assert.equal(lookupRes.status, 200);
    assert.match(lookupRes.text, /What city were you born in\?/);

    const answerCsrf = csrfFieldFrom(lookupRes.text);
    const answerRes = await agent.post('/reset-password').type('form').send({
      _csrf: answerCsrf,
      username: 'newbie',
      securityAnswer: 'BERLIN',
      newPassword: NEW_PASSWORD,
    });
    assert.equal(answerRes.status, 302);
    assert.equal(answerRes.headers.location, '/login?passwordReset=1');

    const loginPageAfter = await agent.get(answerRes.headers.location);
    assert.match(loginPageAfter.text, /Password changed/);

    const oldPasswordAgent = request.agent(app);
    const oldCsrf = csrfFieldFrom((await oldPasswordAgent.get('/login')).text);
    const oldLoginRes = await oldPasswordAgent
      .post('/login')
      .type('form')
      .send({ _csrf: oldCsrf, username: 'newbie', password: KNOWN_PASSWORD });
    assert.equal(oldLoginRes.status, 401);

    const newPasswordAgent = request.agent(app);
    const newCsrf = csrfFieldFrom((await newPasswordAgent.get('/login')).text);
    const newLoginRes = await newPasswordAgent
      .post('/login')
      .type('form')
      .send({ _csrf: newCsrf, username: 'newbie', password: NEW_PASSWORD });
    assert.equal(newLoginRes.status, 302);
    assert.equal(newLoginRes.headers.location, '/');
  });
});

test('POST /reset-password with an unknown username re-renders phase one with a generic error', async () => {
  await withApp(async (app) => {
    const agent = request.agent(app);
    const page = await agent.get('/reset-password');
    const csrfToken = csrfFieldFrom(page.text);

    const res = await agent
      .post('/reset-password')
      .type('form')
      .send({ _csrf: csrfToken, username: 'ghost' });
    assert.equal(res.status, 422);
    assert.doesNotMatch(res.text, /Security question:/);
  });
});

test('POST /reset-password phase two with a wrong answer fails and does not change the password', async () => {
  await withApp(async (app) => {
    const agent = request.agent(app);
    const registerPage = await agent.get('/register');
    const registerCsrf = csrfFieldFrom(registerPage.text);
    await agent.post('/register').type('form').send({
      _csrf: registerCsrf,
      username: 'newbie',
      password: KNOWN_PASSWORD,
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    const logoutCsrf = csrfFieldFrom((await agent.get('/')).text);
    await agent.post('/logout').type('form').send({ _csrf: logoutCsrf });

    const lookupPage = await agent.get('/reset-password');
    const lookupCsrf = csrfFieldFrom(lookupPage.text);
    const lookupRes = await agent
      .post('/reset-password')
      .type('form')
      .send({ _csrf: lookupCsrf, username: 'newbie' });

    const wrongAnswerCsrf = csrfFieldFrom(lookupRes.text);
    const wrongAnswerRes = await agent.post('/reset-password').type('form').send({
      _csrf: wrongAnswerCsrf,
      username: 'newbie',
      securityAnswer: 'Paris',
      newPassword: 'irrelevant-new-password',
    });
    assert.equal(wrongAnswerRes.status, 422);

    const stillOldPasswordAgent = request.agent(app);
    const oldCsrf = csrfFieldFrom((await stillOldPasswordAgent.get('/login')).text);
    const stillWorks = await stillOldPasswordAgent
      .post('/login')
      .type('form')
      .send({ _csrf: oldCsrf, username: 'newbie', password: KNOWN_PASSWORD });
    assert.equal(stillWorks.status, 302);
  });
});
