import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import { insertUser } from '../src/repositories/users.js';
import { insertRecipe, setRecipePublic } from '../src/repositories/recipes.js';
import { duplicateRecipe } from '../src/services/recipes.js';
import { publishRecipe, unpublishRecipe } from '../src/services/publishing.js';

function makeUser(db, username) {
  return insertUser(db, { username, passwordHash: 'not-a-real-hash' });
}

function storedRecipe(db, recipeId) {
  return db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
}

test('publishRecipe sets is_public and leaves the recipe with an enabled share token', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const result = publishRecipe(db, recipe.id, owner.id);
    assert.equal(result.success, true);

    const stored = storedRecipe(db, recipe.id);
    assert.equal(stored.is_public, 1);
    assert.equal(stored.share_enabled, 1);
    assert.ok(stored.share_token);
  } finally {
    cleanup();
  }
});

test('publishRecipe refuses for a non-owner and changes nothing', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const stranger = makeUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const result = publishRecipe(db, recipe.id, stranger.id);
    assert.equal(result.success, false);

    const stored = storedRecipe(db, recipe.id);
    assert.equal(stored.is_public, 0);
    assert.equal(stored.share_enabled, 0);
  } finally {
    cleanup();
  }
});

test('unpublishRecipe clears is_public and leaves the share token enabled', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    publishRecipe(db, recipe.id, owner.id);
    const publishedToken = storedRecipe(db, recipe.id).share_token;

    const result = unpublishRecipe(db, recipe.id, owner.id);
    assert.equal(result.success, true);

    const stored = storedRecipe(db, recipe.id);
    assert.equal(stored.is_public, 0);
    assert.equal(stored.share_enabled, 1);
    assert.equal(stored.share_token, publishedToken);
  } finally {
    cleanup();
  }
});

test('ACCEPTANCE 10 (second half): a second user can duplicate a public recipe; the copy is private, has no share token, and a zero import count', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const other = makeUser(db, 'other');
    const recipe = insertRecipe(db, owner.id, { title: 'Public Soup' });
    publishRecipe(db, recipe.id, owner.id);
    db.prepare('UPDATE recipes SET bring_import_count = 7 WHERE id = ?').run(recipe.id);

    const result = duplicateRecipe(db, recipe.id, other.id);
    assert.equal(result.success, true);

    const copy = storedRecipe(db, result.recipeId);
    assert.equal(copy.owner_id, other.id);
    assert.equal(copy.is_public, 0);
    assert.equal(copy.share_token, null);
    assert.equal(copy.share_enabled, 0);
    assert.equal(copy.bring_import_count, 0);
  } finally {
    cleanup();
  }
});
