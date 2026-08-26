import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import { insertUser } from '../src/repositories/users.js';
import {
  findRecipeForRead,
  findRecipeForWrite,
  listRecipesForUser,
  loadRecipeAggregate,
  insertRecipe,
  updateRecipe,
  setRecipeArchived,
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

test('a read-only share (can_edit 0) grants read but not write', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const viewer = makeUser(db, 'viewer');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 0)').run(
      recipe.id,
      viewer.id
    );

    assert.ok(findRecipeForRead(db, recipe.id, viewer.id));
    assert.equal(findRecipeForWrite(db, recipe.id, viewer.id), undefined);
  } finally {
    cleanup();
  }
});

test('an editable share (can_edit 1) grants write', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const editor = makeUser(db, 'editor');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 1)').run(
      recipe.id,
      editor.id
    );

    assert.ok(findRecipeForWrite(db, recipe.id, editor.id));
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

test('listRecipesForUser returns own + shared, excludes others, and hides archived by default', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const other = makeUser(db, 'other');

    const own = insertRecipe(db, owner.id, { title: 'Mine' });
    const shared = insertRecipe(db, other.id, { title: 'Shared with me' });
    const notShared = insertRecipe(db, other.id, { title: 'Not shared' });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 0)').run(
      shared.id,
      owner.id
    );

    const visible = listRecipesForUser(db, owner.id);
    const visibleIds = visible.map((r) => r.id).sort();
    assert.deepEqual(visibleIds, [own.id, shared.id].sort());
    assert.ok(!visibleIds.includes(notShared.id));

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
