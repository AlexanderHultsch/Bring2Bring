import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import {
  hashPassword,
  verifyPassword,
  authenticate,
  registerUser,
  readResetChallenge,
  resetPasswordWithAnswer,
} from '../src/services/auth.js';
import { insertUser, findUserByUsername, countUsers, updateUserPasswordHash } from '../src/repositories/users.js';

test('hashPassword produces a $argon2id$ hash, salted differently each time', async () => {
  const hashA = await hashPassword('correct-horse-battery');
  const hashB = await hashPassword('correct-horse-battery');
  assert.ok(hashA.startsWith('$argon2id$'));
  assert.notEqual(hashA, hashB);
});

test('verifyPassword returns true for the right password, false for a wrong one', async () => {
  const hash = await hashPassword('correct-horse-battery');
  assert.equal(await verifyPassword(hash, 'correct-horse-battery'), true);
  assert.equal(await verifyPassword(hash, 'wrong-password'), false);
});

test('verifyPassword returns false, not a throw, for a malformed stored hash', async () => {
  assert.equal(await verifyPassword('not-a-real-hash', 'anything'), false);
});

test('authenticate returns the user row for correct credentials', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const passwordHash = await hashPassword('correct-horse-battery');
    insertUser(db, { username: 'alex', passwordHash });

    const user = await authenticate(db, 'alex', 'correct-horse-battery');
    assert.ok(user);
    assert.equal(user.username, 'alex');
  } finally {
    cleanup();
  }
});

test('authenticate returns null for a wrong password', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const passwordHash = await hashPassword('correct-horse-battery');
    insertUser(db, { username: 'alex', passwordHash });

    const user = await authenticate(db, 'alex', 'wrong-password');
    assert.equal(user, null);
  } finally {
    cleanup();
  }
});

test('authenticate returns null for a username that does not exist', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const user = await authenticate(db, 'ghost', 'anything');
    assert.equal(user, null);
  } finally {
    cleanup();
  }
});

test('insertUser defaults role to user; findUserByUsername finds it; countUsers reflects inserts', async () => {
  const { db, cleanup } = createTestDb();
  try {
    assert.equal(countUsers(db), 0);

    const passwordHash = await hashPassword('correct-horse-battery');
    insertUser(db, { username: 'alex', passwordHash });

    const found = findUserByUsername(db, 'alex');
    assert.equal(found.role, 'user');
    assert.equal(countUsers(db), 1);

    insertUser(db, { username: 'sam', passwordHash: await hashPassword('other-password') });
    assert.equal(countUsers(db), 2);
  } finally {
    cleanup();
  }
});

test('updateUserPasswordHash changes the stored hash so the old password fails and the new one succeeds', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const oldHash = await hashPassword('old-password');
    const user = insertUser(db, { username: 'alex', passwordHash: oldHash });

    const newHash = await hashPassword('new-password');
    const changes = updateUserPasswordHash(db, user.id, newHash, new Date().toISOString());
    assert.equal(changes, 1);

    assert.equal(await authenticate(db, 'alex', 'old-password'), null);
    const authenticated = await authenticate(db, 'alex', 'new-password');
    assert.ok(authenticated);
  } finally {
    cleanup();
  }
});

test('registerUser succeeds and stores a security_answer_hash that is not the plaintext answer', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const result = await registerUser(db, {
      username: 'alex',
      password: 'correct-horse-battery',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(result.success, true);
    assert.equal(result.user.username, 'alex');
    assert.equal(result.user.role, 'user');

    const stored = findUserByUsername(db, 'alex');
    assert.equal(stored.security_question, 'What city were you born in?');
    assert.ok(stored.security_answer_hash.startsWith('$argon2id$'));
    assert.notEqual(stored.security_answer_hash, 'Berlin');
  } finally {
    cleanup();
  }
});

test('the security answer verifies case-insensitively and with surrounding whitespace', async () => {
  const { db, cleanup } = createTestDb();
  try {
    await registerUser(db, {
      username: 'alex',
      password: 'correct-horse-battery',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });

    const result = await resetPasswordWithAnswer(db, {
      username: 'alex',
      securityAnswer: '  berlin  ',
      newPassword: 'brand-new-password',
    });
    assert.equal(result.success, true);

    assert.equal(await authenticate(db, 'alex', 'brand-new-password') !== null, true);
  } finally {
    cleanup();
  }
});

test('registerUser refuses a duplicate username', async () => {
  const { db, cleanup } = createTestDb();
  try {
    await registerUser(db, {
      username: 'alex',
      password: 'correct-horse-battery',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });

    const result = await registerUser(db, {
      username: 'alex',
      password: 'another-long-password',
      securityQuestion: 'What is your pet?',
      securityAnswer: 'Cat',
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'That username is already taken.');
    assert.equal(countUsers(db), 1);
  } finally {
    cleanup();
  }
});

test('registerUser refuses a password under 12 characters', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const result = await registerUser(db, {
      username: 'alex',
      password: 'short1234',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(result.success, false);
    assert.match(result.error, /at least 12 characters/);
    assert.equal(countUsers(db), 0);
  } finally {
    cleanup();
  }
});

test('registerUser refuses a username with a disallowed character', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const result = await registerUser(db, {
      username: 'alex the great',
      password: 'correct-horse-battery',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    assert.equal(result.success, false);
    assert.equal(countUsers(db), 0);
  } finally {
    cleanup();
  }
});

test('readResetChallenge returns null identically for an unknown username and a known user with no question set', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const passwordHash = await hashPassword('correct-horse-battery');
    insertUser(db, { username: 'alex', passwordHash });

    assert.equal(readResetChallenge(db, 'ghost'), null);
    assert.equal(readResetChallenge(db, 'alex'), null);
  } finally {
    cleanup();
  }
});

test('readResetChallenge returns the stored question for a user who has one', async () => {
  const { db, cleanup } = createTestDb();
  try {
    await registerUser(db, {
      username: 'alex',
      password: 'correct-horse-battery',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });

    assert.equal(readResetChallenge(db, 'alex'), 'What city were you born in?');
  } finally {
    cleanup();
  }
});

test('resetPasswordWithAnswer with a wrong answer fails and leaves the stored password hash unchanged', async () => {
  const { db, cleanup } = createTestDb();
  try {
    await registerUser(db, {
      username: 'alex',
      password: 'correct-horse-battery',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });
    const hashBefore = findUserByUsername(db, 'alex').password_hash;

    const result = await resetPasswordWithAnswer(db, {
      username: 'alex',
      securityAnswer: 'Paris',
      newPassword: 'brand-new-password',
    });
    assert.equal(result.success, false);
    assert.equal(findUserByUsername(db, 'alex').password_hash, hashBefore);
  } finally {
    cleanup();
  }
});

test('resetPasswordWithAnswer with the right answer changes the password: old fails and new succeeds via authenticate', async () => {
  const { db, cleanup } = createTestDb();
  try {
    await registerUser(db, {
      username: 'alex',
      password: 'correct-horse-battery',
      securityQuestion: 'What city were you born in?',
      securityAnswer: 'Berlin',
    });

    const result = await resetPasswordWithAnswer(db, {
      username: 'alex',
      securityAnswer: 'Berlin',
      newPassword: 'brand-new-password',
    });
    assert.equal(result.success, true);

    assert.equal(await authenticate(db, 'alex', 'correct-horse-battery'), null);
    const authenticated = await authenticate(db, 'alex', 'brand-new-password');
    assert.ok(authenticated);
  } finally {
    cleanup();
  }
});

test('resetPasswordWithAnswer fails identically for an unknown username, giving the same generic error', async () => {
  const { db, cleanup } = createTestDb();
  try {
    const result = await resetPasswordWithAnswer(db, {
      username: 'ghost',
      securityAnswer: 'Berlin',
      newPassword: 'brand-new-password',
    });
    assert.equal(result.success, false);
  } finally {
    cleanup();
  }
});
