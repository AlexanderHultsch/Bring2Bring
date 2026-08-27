import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import { insertUser, findUserById } from '../src/repositories/users.js';
import { insertRecipe, replaceRecipeContent, setRecipePublic } from '../src/repositories/recipes.js';
import {
  adminListRecipes,
  adminListUsers,
  adminUnpublishRecipe,
  adminDeleteRecipe,
  adminDeleteUser,
  countAdmins,
} from '../src/repositories/admin.js';
import { deleteUser, unpublishRecipeAsAdmin, deleteRecipeAsAdmin } from '../src/services/admin.js';

function makeUser(db, username, role) {
  return insertUser(db, { username, passwordHash: 'not-a-real-hash', role });
}

test('countAdmins reflects the seeded admin account', () => {
  const { db, cleanup } = createTestDb();
  try {
    assert.equal(countAdmins(db), 0);
    makeUser(db, 'root', 'admin');
    assert.equal(countAdmins(db), 1);
  } finally {
    cleanup();
  }
});

test('deleteUser (service): refuses when the acting user is not an admin', () => {
  const { db, cleanup } = createTestDb();
  try {
    const admin = makeUser(db, 'root', 'admin');
    const target = makeUser(db, 'someone');
    const notAdmin = makeUser(db, 'notadmin');

    const result = deleteUser(db, notAdmin, target.id);
    assert.equal(result.success, false);
    assert.ok(findUserById(db, target.id));
  } finally {
    cleanup();
  }
});

test('deleteUser (service): refuses to delete the last remaining admin', () => {
  const { db, cleanup } = createTestDb();
  try {
    const admin = makeUser(db, 'root', 'admin');

    const result = deleteUser(db, admin, admin.id);
    assert.equal(result.success, false);
    assert.ok(findUserById(db, admin.id));
  } finally {
    cleanup();
  }
});

test('deleteUser (service): deleting a normal user removes their recipes via cascade', () => {
  const { db, cleanup } = createTestDb();
  try {
    const admin = makeUser(db, 'root', 'admin');
    const target = makeUser(db, 'someone');
    const recipe = insertRecipe(db, target.id, { title: 'Soup' });

    const result = deleteUser(db, admin, target.id);
    assert.equal(result.success, true);
    assert.equal(findUserById(db, target.id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipe.id), undefined);
  } finally {
    cleanup();
  }
});

test('deleteUser (service): with a second admin present, deleting one admin succeeds', () => {
  const { db, cleanup } = createTestDb();
  try {
    const admin = makeUser(db, 'root', 'admin');
    const secondAdmin = makeUser(db, 'second', 'admin');

    const result = deleteUser(db, admin, secondAdmin.id);
    assert.equal(result.success, true);
    assert.equal(findUserById(db, secondAdmin.id), undefined);
  } finally {
    cleanup();
  }
});

test('unpublishRecipeAsAdmin / deleteRecipeAsAdmin refuse a non-admin caller', () => {
  const { db, cleanup } = createTestDb();
  try {
    const notAdmin = makeUser(db, 'notadmin');
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    setRecipePublic(db, recipe.id, owner.id, true);

    assert.equal(unpublishRecipeAsAdmin(db, notAdmin, recipe.id).success, false);
    assert.equal(deleteRecipeAsAdmin(db, notAdmin, recipe.id).success, false);
    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id).is_public, 1);
  } finally {
    cleanup();
  }
});

test('unpublishRecipeAsAdmin sets is_public to 0 for an admin caller, regardless of ownership', () => {
  const { db, cleanup } = createTestDb();
  try {
    const admin = makeUser(db, 'root', 'admin');
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    setRecipePublic(db, recipe.id, owner.id, true);

    const result = unpublishRecipeAsAdmin(db, admin, recipe.id);
    assert.equal(result.success, true);
    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id).is_public, 0);
  } finally {
    cleanup();
  }
});

test('deleteRecipeAsAdmin deletes any recipe for an admin caller, regardless of ownership', () => {
  const { db, cleanup } = createTestDb();
  try {
    const admin = makeUser(db, 'root', 'admin');
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const result = deleteRecipeAsAdmin(db, admin, recipe.id);
    assert.equal(result.success, true);
    assert.equal(db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipe.id), undefined);
  } finally {
    cleanup();
  }
});

test('adminListUsers lists identity fields and a recipe count, never a password hash', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    insertRecipe(db, owner.id, { title: 'One' });
    insertRecipe(db, owner.id, { title: 'Two' });

    const rows = adminListUsers(db);
    const ownerRow = rows.find((r) => r.username === 'owner');
    assert.equal(ownerRow.recipe_count, 2);
    assert.ok(!('password_hash' in ownerRow));
    assert.ok(!JSON.stringify(rows).includes('not-a-real-hash'));
  } finally {
    cleanup();
  }
});

// ACCEPTANCE 14 (SPECIFICATION.md section 13): no admin screen response may
// contain any ingredient name or method text of a recipe the admin does not
// own. adminListRecipes' SELECT never touches ingredients/steps at all — this
// asserts that guarantee holds end to end, not just that the SQL looks right.
test('ACCEPTANCE 14: adminListRecipes leaks no ingredient name or method text', () => {
  const { db, cleanup } = createTestDb();
  try {
    const admin = makeUser(db, 'root', 'admin');
    const owner = makeUser(db, 'someoneelse');
    const recipe = insertRecipe(db, owner.id, { title: "Someone Else's Recipe" });
    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [{ name: null, ingredients: [{ name: 'Zimtstange' }] }],
      steps: [{ text: 'GEHEIM' }],
      tagIds: [],
    });
    setRecipePublic(db, recipe.id, owner.id, true);
    db.prepare('UPDATE recipes SET bring_import_count = 3 WHERE id = ?').run(recipe.id);

    const rows = adminListRecipes(db);
    const serialized = JSON.stringify(rows);

    assert.ok(!serialized.includes('Zimtstange'));
    assert.ok(!serialized.includes('GEHEIM'));

    const recipeRow = rows.find((r) => r.id === recipe.id);
    assert.ok(recipeRow);
    assert.equal(recipeRow.author_username, 'someoneelse');
    assert.equal(recipeRow.is_public, 1);
    assert.equal(recipeRow.bring_import_count, 3);
    assert.equal(Object.keys(recipeRow).sort().join(','), [
      'author_username',
      'bring_import_count',
      'created_at',
      'id',
      'is_public',
      'title',
    ].sort().join(','));
  } finally {
    cleanup();
  }
});
