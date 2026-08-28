import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import { insertUser } from '../src/repositories/users.js';
import {
  findRecipeForRead,
  findRecipeForWrite,
  listRecipesForUser,
  listPublicRecipes,
  loadRecipeAggregate,
  insertRecipe,
  updateRecipe,
  setRecipeArchived,
  setRecipePublic,
  deleteRecipe,
  replaceRecipeContent,
} from '../src/repositories/recipes.js';

function makeUser(db, username, role) {
  return insertUser(db, { username, passwordHash: 'not-a-real-hash', role });
}

test('owner can read and write their own recipe', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    assert.ok(findRecipeForRead(db, recipe.id, owner.id));
    assert.ok(findRecipeForWrite(db, recipe.id, owner.id));
  } finally {
    cleanup();
  }
});

test('a third user with no share row cannot read the recipe', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const stranger = makeUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    assert.equal(findRecipeForRead(db, recipe.id, stranger.id), undefined);
  } finally {
    cleanup();
  }
});

test('SPECIFICATION.md 5.1 (v2.0, D2): a recipe_shares row (read-only) is dormant and grants no read access', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const viewer = makeUser(db, 'viewer');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 0)').run(
      recipe.id,
      viewer.id
    );

    assert.equal(findRecipeForRead(db, recipe.id, viewer.id), undefined);
    assert.equal(findRecipeForWrite(db, recipe.id, viewer.id), undefined);
  } finally {
    cleanup();
  }
});

test('SPECIFICATION.md 5.1 (v2.0, D2): a recipe_shares row with can_edit = 1 is dormant and grants no write access', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const editor = makeUser(db, 'editor');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 1)').run(
      recipe.id,
      editor.id
    );

    assert.equal(findRecipeForWrite(db, recipe.id, editor.id), undefined);
  } finally {
    cleanup();
  }
});

test('an admin with no share row still cannot read the recipe', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const admin = makeUser(db, 'admin', 'admin');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    assert.equal(findRecipeForRead(db, recipe.id, admin.id), undefined);
  } finally {
    cleanup();
  }
});

test('updateRecipe by an unauthorised user changes nothing', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const stranger = makeUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const changes = updateRecipe(db, recipe.id, stranger.id, { title: 'Hijacked' });
    assert.equal(changes, 0);

    const stored = db.prepare('SELECT title FROM recipes WHERE id = ?').get(recipe.id);
    assert.equal(stored.title, 'Soup');
  } finally {
    cleanup();
  }
});

test('deleteRecipe: a can_edit=1 sharer cannot delete, only the owner can', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const editor = makeUser(db, 'editor');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 1)').run(
      recipe.id,
      editor.id
    );

    const sharerChanges = deleteRecipe(db, recipe.id, editor.id);
    assert.equal(sharerChanges, 0);
    assert.ok(db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipe.id));

    const ownerChanges = deleteRecipe(db, recipe.id, owner.id);
    assert.equal(ownerChanges, 1);
    assert.equal(db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipe.id), undefined);
  } finally {
    cleanup();
  }
});

test('deleting a recipe cascades to groups, ingredients, steps and tag links', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    const tag = db.prepare('INSERT INTO tags (name) VALUES (?)').run('quick');

    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [{ name: 'Base', ingredients: [{ name: 'Water' }] }],
      steps: [{ text: 'Boil it' }],
      tagIds: [tag.lastInsertRowid],
    });

    deleteRecipe(db, recipe.id, owner.id);

    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM ingredient_groups WHERE recipe_id = ?').get(recipe.id)
        .c,
      0
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ingredients').get().c, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM steps WHERE recipe_id = ?').get(recipe.id).c,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS c FROM recipe_tags WHERE recipe_id = ?').get(recipe.id).c,
      0
    );
  } finally {
    cleanup();
  }
});

test('insertRecipe ignores attempts to smuggle owner_id or is_archived through fields', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const intruder = makeUser(db, 'intruder');

    const recipe = insertRecipe(db, owner.id, {
      title: 'Soup',
      owner_id: intruder.id,
      is_archived: 1,
    });

    assert.equal(recipe.owner_id, owner.id);
    assert.equal(recipe.is_archived, 0);
  } finally {
    cleanup();
  }
});

test('loadRecipeAggregate returns groups, ingredients and steps in position order', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [
        { name: 'Broth', ingredients: [{ name: 'Salt' }, { name: 'Pepper' }] },
        { name: 'Toppings', ingredients: [{ name: 'Chives' }] },
      ],
      steps: [{ text: 'First' }, { text: 'Second' }],
      tagIds: [],
    });

    const aggregate = loadRecipeAggregate(db, recipe.id, owner.id);

    assert.equal(aggregate.groups.length, 2);
    assert.equal(aggregate.groups[0].name, 'Broth');
    assert.equal(aggregate.groups[1].name, 'Toppings');
    assert.deepEqual(
      aggregate.groups[0].ingredients.map((i) => i.name),
      ['Salt', 'Pepper']
    );
    assert.deepEqual(
      aggregate.groups[1].ingredients.map((i) => i.name),
      ['Chives']
    );
    assert.deepEqual(
      aggregate.steps.map((s) => s.text),
      ['First', 'Second']
    );
  } finally {
    cleanup();
  }
});

test('loadRecipeAggregate returns undefined for an unauthorised user', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const stranger = makeUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    assert.equal(loadRecipeAggregate(db, recipe.id, stranger.id), undefined);
  } finally {
    cleanup();
  }
});

test('replaceRecipeContent replaces children wholesale', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [{ name: 'Old', ingredients: [{ name: 'Old ingredient' }] }],
      steps: [{ text: 'Old step' }],
      tagIds: [],
    });

    const ok = replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [{ name: 'New', ingredients: [{ name: 'New ingredient' }] }],
      steps: [{ text: 'New step' }],
      tagIds: [],
    });

    assert.equal(ok, true);

    const aggregate = loadRecipeAggregate(db, recipe.id, owner.id);
    assert.equal(aggregate.groups.length, 1);
    assert.equal(aggregate.groups[0].name, 'New');
    assert.deepEqual(
      aggregate.groups[0].ingredients.map((i) => i.name),
      ['New ingredient']
    );
    assert.deepEqual(
      aggregate.steps.map((s) => s.text),
      ['New step']
    );
  } finally {
    cleanup();
  }
});

test('replaceRecipeContent returns false and changes nothing for an unauthorised user', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const stranger = makeUser(db, 'stranger');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [{ name: 'Base', ingredients: [{ name: 'Water' }] }],
      steps: [{ text: 'Boil it' }],
      tagIds: [],
    });

    const groupsBefore = db.prepare('SELECT COUNT(*) AS c FROM ingredient_groups').get().c;
    const ingredientsBefore = db.prepare('SELECT COUNT(*) AS c FROM ingredients').get().c;
    const stepsBefore = db.prepare('SELECT COUNT(*) AS c FROM steps').get().c;

    const ok = replaceRecipeContent(db, recipe.id, stranger.id, {
      groups: [{ name: 'Hijacked', ingredients: [] }],
      steps: [],
      tagIds: [],
    });

    assert.equal(ok, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ingredient_groups').get().c, groupsBefore);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ingredients').get().c, ingredientsBefore);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM steps').get().c, stepsBefore);
  } finally {
    cleanup();
  }
});

test('replaceRecipeContent is atomic: a failing insert leaves the original content intact', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [{ name: 'Base', ingredients: [{ name: 'Water' }] }],
      steps: [{ text: 'Boil it' }],
      tagIds: [],
    });

    assert.throws(() => {
      replaceRecipeContent(db, recipe.id, owner.id, {
        groups: [],
        steps: [{ text: 'Fine' }, { text: null }],
        tagIds: [],
      });
    });

    const aggregate = loadRecipeAggregate(db, recipe.id, owner.id);
    assert.equal(aggregate.groups.length, 1);
    assert.equal(aggregate.groups[0].ingredients.length, 1);
    assert.deepEqual(
      aggregate.steps.map((s) => s.text),
      ['Boil it']
    );
  } finally {
    cleanup();
  }
});

test('SPECIFICATION.md 5.1/9 (v2.0, D2): listRecipesForUser ("My Recipes") returns only the acting user\'s own recipes — not recipes shared with them, not other users\' public recipes — and hides archived by default', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const other = makeUser(db, 'other');

    const own = insertRecipe(db, owner.id, { title: 'Mine' });
    const sharedWithMe = insertRecipe(db, other.id, { title: 'Shared with me' });
    const othersPublic = insertRecipe(db, other.id, { title: "Other's public recipe" });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 0)').run(
      sharedWithMe.id,
      owner.id
    );
    setRecipePublic(db, othersPublic.id, other.id, true);

    const visible = listRecipesForUser(db, owner.id);
    const visibleIds = visible.map((r) => r.id);
    assert.deepEqual(visibleIds, [own.id]);
    assert.ok(!visibleIds.includes(sharedWithMe.id));
    assert.ok(!visibleIds.includes(othersPublic.id));

    setRecipeArchived(db, own.id, owner.id, true);

    const withoutArchived = listRecipesForUser(db, owner.id).map((r) => r.id);
    assert.ok(!withoutArchived.includes(own.id));

    const withArchived = listRecipesForUser(db, owner.id, { includeArchived: true }).map(
      (r) => r.id
    );
    assert.ok(withArchived.includes(own.id));
  } finally {
    cleanup();
  }
});

test('ACCEPTANCE 9: a private recipe is invisible to a second user via findRecipeForRead', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const other = makeUser(db, 'other');
    const recipe = insertRecipe(db, owner.id, { title: 'Private Soup' });

    assert.equal(findRecipeForRead(db, recipe.id, other.id), undefined);
  } finally {
    cleanup();
  }
});

test('ACCEPTANCE 10 (read half): a public recipe is visible to a second user via findRecipeForRead', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const other = makeUser(db, 'other');
    const recipe = insertRecipe(db, owner.id, { title: 'Public Soup' });
    setRecipePublic(db, recipe.id, owner.id, true);

    const found = findRecipeForRead(db, recipe.id, other.id);
    assert.ok(found);
    assert.equal(found.id, recipe.id);
  } finally {
    cleanup();
  }
});

test('ACCEPTANCE 11: a second user cannot write a public recipe they do not own', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const other = makeUser(db, 'other');
    const recipe = insertRecipe(db, owner.id, { title: 'Public Soup' });
    setRecipePublic(db, recipe.id, owner.id, true);

    assert.equal(findRecipeForWrite(db, recipe.id, other.id), undefined);

    const changes = updateRecipe(db, recipe.id, other.id, { title: 'Hijacked' });
    assert.equal(changes, 0);
    assert.equal(db.prepare('SELECT title FROM recipes WHERE id = ?').get(recipe.id).title, 'Public Soup');
  } finally {
    cleanup();
  }
});

test('setRecipePublic: only the owner can publish or unpublish; a non-owner changes 0 rows', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const other = makeUser(db, 'other');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const strangerChanges = setRecipePublic(db, recipe.id, other.id, true);
    assert.equal(strangerChanges, 0);
    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id).is_public, 0);

    const ownerChanges = setRecipePublic(db, recipe.id, owner.id, true);
    assert.equal(ownerChanges, 1);
    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id).is_public, 1);

    setRecipePublic(db, recipe.id, owner.id, false);
    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipe.id).is_public, 0);
  } finally {
    cleanup();
  }
});

test('listPublicRecipes returns the author username, excludes private recipes, and sorts by title / imports / recent', () => {
  const { db, cleanup } = createTestDb();
  try {
    const alice = makeUser(db, 'alice');
    const bob = makeUser(db, 'bob');

    const zebra = insertRecipe(db, alice.id, { title: 'Zebra Stew' });
    const apple = insertRecipe(db, bob.id, { title: 'Apple Pie' });
    const mango = insertRecipe(db, alice.id, { title: 'Mango Salad' });
    const secret = insertRecipe(db, alice.id, { title: 'Secret Recipe' });

    setRecipePublic(db, zebra.id, alice.id, true);
    setRecipePublic(db, apple.id, bob.id, true);
    setRecipePublic(db, mango.id, alice.id, true);
    // secret stays private

    db.prepare('UPDATE recipes SET bring_import_count = 5 WHERE id = ?').run(zebra.id);
    db.prepare('UPDATE recipes SET bring_import_count = 1 WHERE id = ?').run(apple.id);
    db.prepare("UPDATE recipes SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(apple.id);
    db.prepare("UPDATE recipes SET created_at = '2024-01-01T00:00:00.000Z' WHERE id = ?").run(mango.id);
    db.prepare("UPDATE recipes SET created_at = '2022-01-01T00:00:00.000Z' WHERE id = ?").run(zebra.id);

    const byTitle = listPublicRecipes(db);
    assert.deepEqual(byTitle.map((r) => r.title), ['Apple Pie', 'Mango Salad', 'Zebra Stew']);
    assert.ok(!byTitle.some((r) => r.id === secret.id));
    const appleRow = byTitle.find((r) => r.id === apple.id);
    assert.equal(appleRow.author_username, 'bob');

    const byImports = listPublicRecipes(db, { sort: 'imports' });
    assert.deepEqual(byImports.map((r) => r.id), [zebra.id, apple.id, mango.id]);

    const byRecent = listPublicRecipes(db, { sort: 'recent' });
    assert.deepEqual(byRecent.map((r) => r.id), [mango.id, zebra.id, apple.id]);

    const searched = listPublicRecipes(db, { search: 'zebra' });
    assert.deepEqual(searched.map((r) => r.id), [zebra.id]);
  } finally {
    cleanup();
  }
});
