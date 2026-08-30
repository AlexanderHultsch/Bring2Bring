import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { insertUser, findUserByUsername } from '../src/repositories/users.js';

function extractSelected(html, selectName) {
  const selectMatch = html.match(new RegExp(`<select[^>]*name="${selectName}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(selectMatch, `expected a <select name="${selectName}"> in the response HTML`);
  const optionMatch = selectMatch[1].match(/<option value="([^"]+)"\s+selected/);
  assert.ok(optionMatch, `expected a selected option in <select name="${selectName}">`);
  return optionMatch[1];
}

const KNOWN_USERNAME = 'alex';
const KNOWN_PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'even-more-correct-horse';

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

async function csrfFor(agent, path) {
  const page = await agent.get(path);
  return csrfFieldFrom(page.text);
}

test('GET /account and GET /privacy return 200 logged in, 302 to /login otherwise', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);

    for (const path of ['/account', '/privacy']) {
      const anon = await request(app).get(path);
      assert.equal(anon.status, 302, path);
      assert.equal(anon.headers.location, '/login', path);
    }

    const agent = await loginAgent(app);
    for (const path of ['/account', '/privacy']) {
      const res = await agent.get(path);
      assert.equal(res.status, 200, path);
    }
  });
});

// SPECIFICATION.md section 8.5 / 11 (v2.0, D4): the device cookie exists now
// and must be documented on the Privacy page, by name.
test('GET /privacy mentions the bring2bring.did device cookie by name', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/privacy');
    assert.equal(res.status, 200);
    assert.match(res.text, /bring2bring\.did/);
  });
});

// SPECIFICATION.md "Changes in v2.5" (J6): the app-specific privacy page
// also links to the site-wide policy, opened the same way as the codebase's
// other external link (menu.ejs "Report a bug").
test('GET /privacy links to the site-wide privacy policy with the same rel as the "Report a bug" link', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/privacy');
    assert.equal(res.status, 200);
    assert.ok(
      res.text.includes(
        'href="https://ahultsch.com/privacy.html" target="_blank" rel="noopener noreferrer"'
      )
    );
  });
});

test('POST /account/password with the correct current password changes it: the old password no longer authenticates and the new one does', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    const res = await agent.post('/account/password').type('form').send({
      _csrf: csrfToken,
      currentPassword: KNOWN_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/account?passwordChanged=1');

    const confirmPage = await agent.get(res.headers.location);
    assert.match(confirmPage.text, /Password changed\./);

    const oldPasswordAgent = request.agent(app);
    const oldPasswordCsrf = await csrfFor(oldPasswordAgent, '/login');
    const loginOld = await oldPasswordAgent
      .post('/login')
      .type('form')
      .send({ _csrf: oldPasswordCsrf, username: KNOWN_USERNAME, password: KNOWN_PASSWORD });
    assert.equal(loginOld.status, 401);

    const freshAgent = request.agent(app);
    const freshCsrf = await csrfFor(freshAgent, '/login');
    const loginNew = await freshAgent
      .post('/login')
      .type('form')
      .send({ _csrf: freshCsrf, username: KNOWN_USERNAME, password: NEW_PASSWORD });
    assert.equal(loginNew.status, 302);
    assert.equal(loginNew.headers.location, '/');
  });
});

test('POST /account/password stays logged in after a successful change (session regenerated, not destroyed)', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    await agent.post('/account/password').type('form').send({
      _csrf: csrfToken,
      currentPassword: KNOWN_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    const home = await agent.get('/');
    assert.equal(home.status, 200);
  });
});

test('POST /account/password with a wrong current password returns 422 and does not change the stored hash', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');
    const hashBefore = findUserByUsername(db, KNOWN_USERNAME).password_hash;

    const res = await agent.post('/account/password').type('form').send({
      _csrf: csrfToken,
      currentPassword: 'totally-wrong-password',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 422);
    assert.match(res.text, /Current password is incorrect\./);
    assert.equal(findUserByUsername(db, KNOWN_USERNAME).password_hash, hashBefore);
  });
});

test('a new password shorter than 12 characters returns 422', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    const res = await agent.post('/account/password').type('form').send({
      _csrf: csrfToken,
      currentPassword: KNOWN_PASSWORD,
      newPassword: 'short1234',
      confirmPassword: 'short1234',
    });
    assert.equal(res.status, 422);
    assert.match(res.text, /at least 12 characters/);
  });
});

test('a mismatched confirmation returns 422', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    const res = await agent.post('/account/password').type('form').send({
      _csrf: csrfToken,
      currentPassword: KNOWN_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: 'does-not-match-1234',
    });
    assert.equal(res.status, 422);
    assert.match(res.text, /do not match/);
  });
});

test('no response from /account ever contains the submitted password string', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const getRes = await agent.get('/account');
    assert.ok(!getRes.text.includes(KNOWN_PASSWORD));

    const csrfToken = await csrfFor(agent, '/account');
    const failRes = await agent.post('/account/password').type('form').send({
      _csrf: csrfToken,
      currentPassword: 'totally-wrong-password',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.ok(!failRes.text.includes('totally-wrong-password'));
    assert.ok(!failRes.text.includes(NEW_PASSWORD));

    const csrfToken2 = await csrfFor(agent, '/account');
    const okRes = await agent.post('/account/password').type('form').send({
      _csrf: csrfToken2,
      currentPassword: KNOWN_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    const confirmRes = await agent.get(okRes.headers.location);
    assert.ok(!confirmRes.text.includes(KNOWN_PASSWORD));
    assert.ok(!confirmRes.text.includes(NEW_PASSWORD));
  });
});

test('GET /account renders both unit selects with de and metric selected for a freshly seeded user', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/account');
    assert.equal(res.status, 200);
    assert.equal(extractSelected(res.text, 'unitLanguage'), 'de');
    assert.equal(extractSelected(res.text, 'measurementSystem'), 'metric');
  });
});

test('POST /account/units with valid values redirects to /account?unitsSaved=1, stores them and a following GET shows them selected', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    const res = await agent.post('/account/units').type('form').send({
      _csrf: csrfToken,
      unitLanguage: 'en',
      measurementSystem: 'imperial',
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/account?unitsSaved=1');

    const stored = findUserByUsername(db, KNOWN_USERNAME);
    assert.equal(stored.unit_language, 'en');
    assert.equal(stored.measurement_system, 'imperial');

    const confirmPage = await agent.get(res.headers.location);
    assert.equal(extractSelected(confirmPage.text, 'unitLanguage'), 'en');
    assert.equal(extractSelected(confirmPage.text, 'measurementSystem'), 'imperial');
  });
});

test('POST /account/units with an invalid value returns 422 and leaves the stored row unchanged', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    const res = await agent.post('/account/units').type('form').send({
      _csrf: csrfToken,
      unitLanguage: 'fr',
      measurementSystem: 'metric',
    });
    assert.equal(res.status, 422);

    const stored = findUserByUsername(db, KNOWN_USERNAME);
    assert.equal(stored.unit_language, 'de');
    assert.equal(stored.measurement_system, 'metric');
  });
});

test('GET /account?unitsSaved=1 renders the success message', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/account?unitsSaved=1');
    assert.equal(res.status, 200);
    assert.match(res.text, /Units saved\./);
  });
});

// M4 (v2.8): the units hint used to sit after the closing </form>, where its
// negative top margin overlapped the "Save units" button. It now sits inside
// the form, between the last <select> and the button.
test('M4: the units field-hint is inside the auth-form, between the measurementSystem select and the Save units button', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/account');
    assert.equal(res.status, 200);

    const formMatch = res.text.match(
      /<form method="post" action="\/account\/units" class="auth-form">([\s\S]*?)<\/form>/
    );
    assert.ok(formMatch, 'expected the units auth-form');
    const formBody = formMatch[1];

    const selectIndex = formBody.lastIndexOf('name="measurementSystem"');
    const hintIndex = formBody.indexOf('class="field-hint"');
    const buttonIndex = formBody.indexOf('Save units');

    assert.ok(hintIndex > selectIndex, 'expected the field-hint after the measurementSystem select');
    assert.ok(hintIndex < buttonIndex, 'expected the field-hint before the Save units button');
  });
});

// Every render('account', ...) call site must pass the full set of locals
// (memberSince, passwordChanged, passwordError, unitsSaved, unitsError) or
// EJS throws on an undefined local — exercise all three paths.
test('all three render(\'account\', ...) call sites render successfully', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const getRes = await agent.get('/account');
    assert.equal(getRes.status, 200);

    const passwordCsrf = await csrfFor(agent, '/account');
    const failedPassword = await agent.post('/account/password').type('form').send({
      _csrf: passwordCsrf,
      currentPassword: 'totally-wrong-password',
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    assert.equal(failedPassword.status, 422);

    const unitsCsrf = await csrfFor(agent, '/account');
    const failedUnits = await agent.post('/account/units').type('form').send({
      _csrf: unitsCsrf,
      unitLanguage: 'fr',
      measurementSystem: 'metric',
    });
    assert.equal(failedUnits.status, 422);
  });
});
