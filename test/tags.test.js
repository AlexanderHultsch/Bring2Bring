import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/db.js';
import { insertUser } from '../src/repositories/users.js';
import { insertRecipe, replaceRecipeContent } from '../src/repositories/recipes.js';
import {
  findTagByName,
  insertTag,
  findOrCreateTag,
  listTagsVisibleToUser,
  findTagsForRecipe,
} from '../src/repositories/tags.js';

function makeUser(db, username) {
  return insertUser(db, { username, passwordHash: 'not-a-real-hash' });
}

test('findOrCreateTag creates once and resolves case-insensitive variants to the same row', () => {
  const { db, cleanup } = createTestDb();
  try {
    const user = makeUser(db, 'owner');

    const first = findOrCreateTag(db, 'Pasta', user.id);
    const second = findOrCreateTag(db, 'pasta', user.id);
    const third = findOrCreateTag(db, 'PASTA', user.id);

    assert.equal(first.id, second.id);
    assert.equal(first.id, third.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM tags').get().c, 1);
  } finally {
    cleanup();
  }
});

test('a newly created tag records created_by', () => {
  const { db, cleanup } = createTestDb();
  try {
    const user = makeUser(db, 'owner');

    const tag = insertTag(db, 'quick', user.id);
    assert.equal(tag.created_by, user.id);

    const found = findTagByName(db, 'QUICK');
    assert.equal(found.created_by, user.id);
  } finally {
    cleanup();
  }
});

test('listTagsVisibleToUser returns tags on own and shared recipes, not a third user\'s private recipe', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const sharedWith = makeUser(db, 'shared-with');
    const stranger = makeUser(db, 'stranger');

    const ownRecipe = insertRecipe(db, owner.id, { title: 'Own' });
    const sharedRecipe = insertRecipe(db, owner.id, { title: 'Shared' });
    const strangerRecipe = insertRecipe(db, stranger.id, { title: 'Private to stranger' });
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id, can_edit) VALUES (?, ?, 0)').run(
      sharedRecipe.id,
      sharedWith.id
    );

    const ownTag = findOrCreateTag(db, 'own-tag', owner.id);
    const sharedTag = findOrCreateTag(db, 'shared-tag', owner.id);
    const strangerTag = findOrCreateTag(db, 'stranger-tag', stranger.id);

    replaceRecipeContent(db, ownRecipe.id, owner.id, { groups: [], steps: [], tagIds: [ownTag.id] });
    replaceRecipeContent(db, sharedRecipe.id, owner.id, {
      groups: [],
      steps: [],
      tagIds: [sharedTag.id],
    });
    replaceRecipeContent(db, strangerRecipe.id, stranger.id, {
      groups: [],
      steps: [],
      tagIds: [strangerTag.id],
    });

    const visibleToSharedUser = listTagsVisibleToUser(db, sharedWith.id).map((t) => t.name);
    assert.ok(visibleToSharedUser.includes('shared-tag'));
    assert.ok(!visibleToSharedUser.includes('own-tag'));
    assert.ok(!visibleToSharedUser.includes('stranger-tag'));

    const visibleToOwner = listTagsVisibleToUser(db, owner.id).map((t) => t.name);
    assert.ok(visibleToOwner.includes('own-tag'));
    assert.ok(visibleToOwner.includes('shared-tag'));
    assert.ok(!visibleToOwner.includes('stranger-tag'));
  } finally {
    cleanup();
  }
});

test('findTagsForRecipe returns tags ordered by name', () => {
  const { db, cleanup } = createTestDb();
  try {
    const owner = makeUser(db, 'owner');
    const recipe = insertRecipe(db, owner.id, { title: 'Soup' });

    const zTag = findOrCreateTag(db, 'zucchini', owner.id);
    const aTag = findOrCreateTag(db, 'apple', owner.id);
    const mTag = findOrCreateTag(db, 'melon', owner.id);

    replaceRecipeContent(db, recipe.id, owner.id, {
      groups: [],
      steps: [],
      tagIds: [zTag.id, aTag.id, mTag.id],
    });

    const tags = findTagsForRecipe(db, recipe.id).map((t) => t.name);
    assert.deepEqual(tags, ['apple', 'melon', 'zucchini']);
  } finally {
    cleanup();
  }
});
