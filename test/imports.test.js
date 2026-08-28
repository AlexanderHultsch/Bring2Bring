import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import { insertUser } from '../src/repositories/users.js';
import { insertRecipe } from '../src/repositories/recipes.js';
import { recordImport, localImportDay } from '../src/services/imports.js';

function makeUser(db, username) {
  return insertUser(db, { username, passwordHash: 'not-a-real-hash' });
}

function storedRecipe(db, recipeId) {
  return db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
}

function importRowCount(db, recipeId) {
  return db.prepare('SELECT COUNT(*) AS c FROM bring_imports WHERE recipe_id = ?').get(recipeId).c;
}

// SPECIFICATION.md section 8.5 / 5 (v2.0, D4): a repeat import from the same
// device on the same day is a no-op — the row is not written twice and the
// counter does not move.
test('recordImport increments bring_import_count once for the same (recipe, device, day), and a repeat is a no-op', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const first = recordImport(db, recipe.id, 'device-a', '2026-08-27');
    assert.equal(first, true);
    const second = recordImport(db, recipe.id, 'device-a', '2026-08-27');
    assert.equal(second, false);

    assert.equal(storedRecipe(db, recipe.id).bring_import_count, 1);
    assert.equal(importRowCount(db, recipe.id), 1);
  } finally {
    cleanup();
  }
});

// This is why the service takes the day as a parameter rather than reading
// the clock itself: a test can drive two different days directly.
test('recordImport for the same device on a different day increments again', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    recordImport(db, recipe.id, 'device-a', '2026-08-27');
    const result = recordImport(db, recipe.id, 'device-a', '2026-08-28');
    assert.equal(result, true);

    assert.equal(storedRecipe(db, recipe.id).bring_import_count, 2);
    assert.equal(importRowCount(db, recipe.id), 2);
  } finally {
    cleanup();
  }
});

test('recordImport for a different device on the same day increments again', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    recordImport(db, recipe.id, 'device-a', '2026-08-27');
    const result = recordImport(db, recipe.id, 'device-b', '2026-08-27');
    assert.equal(result, true);

    assert.equal(storedRecipe(db, recipe.id).bring_import_count, 2);
    assert.equal(importRowCount(db, recipe.id), 2);
  } finally {
    cleanup();
  }
});

// SPECIFICATION.md section 5 (migration 003): the row and the counter can
// never disagree, since both are written in one transaction.
test('after several mixed recordImport calls, bring_import_count equals the number of bring_imports rows for that recipe', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    recordImport(db, recipe.id, 'device-a', '2026-08-27');
    recordImport(db, recipe.id, 'device-a', '2026-08-27'); // no-op
    recordImport(db, recipe.id, 'device-b', '2026-08-27');
    recordImport(db, recipe.id, 'device-a', '2026-08-28');
    recordImport(db, recipe.id, 'device-b', '2026-08-27'); // no-op

    assert.equal(storedRecipe(db, recipe.id).bring_import_count, importRowCount(db, recipe.id));
    assert.equal(importRowCount(db, recipe.id), 3);
  } finally {
    cleanup();
  }
});

// SPECIFICATION.md section 3.1 / 5 (H2): the import day boundary follows the
// configured local timezone, not UTC — these two instants fall on different
// calendar days in Europe/Berlin than they do in UTC, in both DST states.
test('localImportDay: 2026-08-27T23:30:00Z is 2026-08-28 in Europe/Berlin (summer) and 2026-08-27 in UTC', () => {
  const instant = new Date('2026-08-27T23:30:00Z');
  assert.equal(localImportDay('Europe/Berlin', instant), '2026-08-28');
  assert.equal(localImportDay('UTC', instant), '2026-08-27');
});

test('localImportDay: 2026-01-27T23:30:00Z is 2026-01-28 in Europe/Berlin (winter) and 2026-01-27 in UTC', () => {
  const instant = new Date('2026-01-27T23:30:00Z');
  assert.equal(localImportDay('Europe/Berlin', instant), '2026-01-28');
  assert.equal(localImportDay('UTC', instant), '2026-01-27');
});

test('recordImport only ever touches the given recipe, never another one', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipeA = insertRecipe(db, owner.id, { title: 'Soup' });
    const recipeB = insertRecipe(db, owner.id, { title: 'Stew' });

    recordImport(db, recipeA.id, 'device-a', '2026-08-27');

    assert.equal(storedRecipe(db, recipeA.id).bring_import_count, 1);
    assert.equal(storedRecipe(db, recipeB.id).bring_import_count, 0);
  } finally {
    cleanup();
  }
});
