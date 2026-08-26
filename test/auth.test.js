import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import { hashPassword, verifyPassword, authenticate } from '../src/services/auth.js';
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
    const changes = updateUserPasswordHash(db, user.id, newHash);
    assert.equal(changes, 1);

    assert.equal(await authenticate(db, 'alex', 'old-password'), null);
    const authenticated = await authenticate(db, 'alex', 'new-password');
    assert.ok(authenticated);
  } finally {
    cleanup();
  }
});
