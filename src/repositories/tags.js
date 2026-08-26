import { READ_PREDICATE } from './recipes.js';

export function findTagByName(db, name) {
  return db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(name);
}

export function insertTag(db, name, createdBy) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO tags (name, created_by) VALUES (?, ?)')
    .run(name, createdBy);

  return db.prepare('SELECT * FROM tags WHERE id = ?').get(lastInsertRowid);
}

export function findOrCreateTag(db, name, createdBy) {
  const existing = findTagByName(db, name);
  if (existing) return existing;
  return insertTag(db, name, createdBy);
}

export function listTagsVisibleToUser(db, actingUserId) {
  return db
    .prepare(
      `SELECT DISTINCT t.* FROM tags t
       JOIN recipe_tags rt ON rt.tag_id = t.id
       JOIN recipes ON recipes.id = rt.recipe_id
       WHERE ${READ_PREDICATE}
       ORDER BY t.name`
    )
    .all(actingUserId, actingUserId);
}

export function findTagsForRecipe(db, recipeId) {
  return db
    .prepare(
      `SELECT t.* FROM tags t
       JOIN recipe_tags rt ON rt.tag_id = t.id
       WHERE rt.recipe_id = ?
       ORDER BY t.name`
    )
    .all(recipeId);
}
