import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/services/auth.js';
import { setSecurityQuestion } from '../src/services/account.js';
import { insertUser, findUserByUsername } from '../src/repositories/users.js';
import { createRecipe } from '../src/services/recipes.js';

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

// SPECIFICATION.md "Changes in v2.8" (M10): the About Bring! disclosure page.
test('GET /about-bring returns 200 logged in, 302 to /login otherwise', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);

    const anon = await request(app).get('/about-bring');
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.location, '/login');

    const agent = await loginAgent(app);
    const res = await agent.get('/about-bring');
    assert.equal(res.status, 200);
  });
});

test('GET /about-bring states no affiliation, no payment, no advertisement, and the trademark disclaimer', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/about-bring');
    assert.equal(res.status, 200);
    assert.match(res.text, /not affiliated/);
    assert.match(res.text, /Bring! Labs AG/);
    assert.match(res.text, /not an advertisement/);
    assert.match(res.text, /"Bring!" is a trademark of its respective owner\./);
  });
});

// SPECIFICATION.md "Changes in v2.8" (M10): the disclosure is reachable from
// exactly one place — a single burger-menu entry between Privacy and Report
// a bug, and appears nowhere else in the interface.
test('the burger menu has exactly one About Bring! entry, between Privacy and Report a bug', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);

    const res = await agent.get('/');
    assert.equal(res.status, 200);

    const matches = res.text.match(/About Bring!/g) || [];
    assert.equal(matches.length, 1);

    const privacyIndex = res.text.indexOf('href="/privacy"');
    const aboutBringIndex = res.text.indexOf('href="/about-bring"');
    const bugIndex = res.text.indexOf('Report a bug');
    assert.ok(privacyIndex !== -1 && aboutBringIndex !== -1 && bugIndex !== -1);
    assert.ok(privacyIndex < aboutBringIndex, 'expected About Bring! after Privacy');
    assert.ok(aboutBringIndex < bugIndex, 'expected About Bring! before Report a bug');
  });
});

// The disclosure appears in exactly one place (SPECIFICATION.md M10): no
// footer note, no link near "Send to Bring!", no banner, and no mention on
// the Account or Privacy pages.
test('the disclosure text appears nowhere but the About Bring! page itself', async () => {
  await withApp(async (app, db) => {
    const owner = await seedKnownUser(db);
    const result = createRecipe(db, owner.id, {
      title: 'Soup',
      servings: '4',
      ingredients: [{ name: 'Salt', unit: 'piece' }],
    });
    const agent = await loginAgent(app);

    const recipePage = await agent.get(`/recipes/${result.recipeId}`);
    assert.equal(recipePage.status, 200);
    assert.doesNotMatch(recipePage.text, /not affiliated/);

    const listPage = await agent.get('/');
    assert.equal(listPage.status, 200);
    assert.doesNotMatch(listPage.text, /not affiliated/);

    const accountPage = await agent.get('/account');
    assert.equal(accountPage.status, 200);
    assert.doesNotMatch(accountPage.text, /not affiliated/);
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
// (memberSince, passwordChanged, passwordError, unitsSaved, unitsError,
// securityQuestionSaved, securityQuestionError) or EJS throws on an
// undefined local — exercise all four paths.
test('all four render(\'account\', ...) call sites render successfully', async () => {
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

    const securityQuestionCsrf = await csrfFor(agent, '/account');
    const failedSecurityQuestion = await agent.post('/account/security-question').type('form').send({
      _csrf: securityQuestionCsrf,
      currentPassword: 'totally-wrong-password',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(failedSecurityQuestion.status, 422);
  });
});

test('POST /account/security-question with the correct current password saves the question, and GET /account?securityQuestionSaved=1 shows the success message', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    const res = await agent.post('/account/security-question').type('form').send({
      _csrf: csrfToken,
      currentPassword: KNOWN_PASSWORD,
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/account?securityQuestionSaved=1');

    const stored = findUserByUsername(db, KNOWN_USERNAME);
    assert.equal(stored.security_question, 'What city were you born in?');
    assert.ok(stored.security_answer_hash.startsWith('$argon2id$'));

    const confirmPage = await agent.get(res.headers.location);
    assert.match(confirmPage.text, /Security question saved\./);
  });
});

test('POST /account/security-question with a wrong current password returns 422 and does not change the stored question', async () => {
  await withApp(async (app, db) => {
    await seedKnownUser(db);
    const agent = await loginAgent(app);
    const csrfToken = await csrfFor(agent, '/account');

    const res = await agent.post('/account/security-question').type('form').send({
      _csrf: csrfToken,
      currentPassword: 'totally-wrong-password',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(res.status, 422);
    assert.match(res.text, /Current password is incorrect\./);

    const stored = findUserByUsername(db, KNOWN_USERNAME);
    assert.equal(stored.security_question, null);
    assert.equal(stored.security_answer_hash, null);
  });
});

test('setSecurityQuestion refuses a wrong current password and leaves the stored question unchanged', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const user = await seedKnownUser(db);

    const result = await setSecurityQuestion(db, user, {
      currentPassword: 'totally-wrong-password',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'Current password is incorrect.');

    const stored = findUserByUsername(db, KNOWN_USERNAME);
    assert.equal(stored.security_question, null);
    assert.equal(stored.security_answer_hash, null);
  } finally {
    cleanup();
  }
});

test('setSecurityQuestion with the correct current password stores the question and a hashed answer', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const user = await seedKnownUser(db);

    const result = await setSecurityQuestion(db, user, {
      currentPassword: KNOWN_PASSWORD,
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(result.success, true);

    const stored = findUserByUsername(db, KNOWN_USERNAME);
    assert.equal(stored.security_question, 'What city were you born in?');
    assert.ok(stored.security_answer_hash.startsWith('$argon2id$'));
    assert.notEqual(stored.security_answer_hash, 'Berlin');
  } finally {
    cleanup();
  }
});
