const RECIPE_COLUMNS = [
  'title',
  'subtitle',
  'description',
  'yield_amount',
  'yield_unit',
  'yield_label',
  'prep_minutes',
  'cook_minutes',
  'total_minutes',
  'source_name',
  'source_url',
  'notes',
  'image_path',
];

// SPECIFICATION.md section 5.1 (v2.0, D2): per-user sharing (recipe_shares)
// is dormant. Read = owner or public; write = owner, full stop.
export const READ_PREDICATE = `(owner_id = ? OR is_public = 1)`;

const WRITE_PREDICATE = `(owner_id = ?)`;

export function findRecipeForRead(db, recipeId, actingUserId) {
  return db
    .prepare(`SELECT * FROM recipes WHERE id = ? AND ${READ_PREDICATE}`)
    .get(recipeId, actingUserId);
}

export function findRecipeForWrite(db, recipeId, actingUserId) {
  return db
    .prepare(`SELECT * FROM recipes WHERE id = ? AND ${WRITE_PREDICATE}`)
    .get(recipeId, actingUserId);
}

// SPECIFICATION.md section 8: the public share page (GET /r/:token) has no
// session and no acting user by design — Bring!'s own servers fetch it, not
// a logged-in browser. Token lookup is therefore the one deliberate exception
// to section 5.1's owner/write-share authorization pattern used everywhere
// else in this file. share_enabled is checked in SQL so a disabled share is
// indistinguishable from an unknown token to the caller.
export function findRecipeByShareToken(db, token) {
  return db.prepare('SELECT * FROM recipes WHERE share_token = ? AND share_enabled = 1').get(token);
}

const LIST_SORT_CLAUSES = {
  title: 'title COLLATE NOCASE ASC, id ASC',
  updated: 'updated_at DESC, id DESC',
};

function escapeLikeTerm(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

// SPECIFICATION.md section 5.1 / 9 (v2.0, D2): "My Dishes" — the acting
// user's own recipes only, never recipes shared with them (recipe_shares is
// dormant) and never other users' public recipes (that's /public instead).
export function listRecipesForUser(db, actingUserId, options = {}) {
  const { includeArchived = false, search = '', sort = 'recent' } = options;
  const archivedClause = includeArchived ? '' : 'AND is_archived = 0';
  const params = [actingUserId];

  let searchClause = '';
  const trimmedSearch = search.trim();
  if (trimmedSearch !== '') {
    const likeTerm = `%${escapeLikeTerm(trimmedSearch)}%`;
    searchClause = `
      AND (
        title LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM ingredients i
          JOIN ingredient_groups g ON g.id = i.group_id
          WHERE g.recipe_id = recipes.id AND i.name LIKE ? ESCAPE '\\'
        )
      )
    `;
    params.push(likeTerm, likeTerm);
  }

  const orderClause = LIST_SORT_CLAUSES[sort] || 'created_at DESC, id DESC';

  return db
    .prepare(
      `SELECT * FROM recipes WHERE owner_id = ? ${archivedClause} ${searchClause} ORDER BY ${orderClause}`
    )
    .all(...params);
}

const PUBLIC_SORT_CLAUSES = {
  title: 'recipes.title COLLATE NOCASE ASC, recipes.id ASC',
  imports: 'recipes.bring_import_count DESC, recipes.title COLLATE NOCASE ASC, recipes.id ASC',
  recent: 'recipes.created_at DESC, recipes.id DESC',
};

// SPECIFICATION.md section 9 / 10.1 (v2.0, D1): the Public shelf — every
// is_public recipe, for every logged-in user, with the author's username.
export function listPublicRecipes(db, options = {}) {
  const { search = '', sort = 'title' } = options;
  const params = [];

  let searchClause = '';
  const trimmedSearch = search.trim();
  if (trimmedSearch !== '') {
    const likeTerm = `%${escapeLikeTerm(trimmedSearch)}%`;
    searchClause = `
      AND (
        recipes.title LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM ingredients i
          JOIN ingredient_groups g ON g.id = i.group_id
          WHERE g.recipe_id = recipes.id AND i.name LIKE ? ESCAPE '\\'
        )
      )
    `;
    params.push(likeTerm, likeTerm);
  }

  const orderClause = PUBLIC_SORT_CLAUSES[sort] || PUBLIC_SORT_CLAUSES.title;

  return db
    .prepare(
      `SELECT recipes.*, users.username AS author_username
       FROM recipes
       JOIN users ON users.id = recipes.owner_id
       WHERE recipes.is_public = 1 ${searchClause}
       ORDER BY ${orderClause}`
    )
    .all(...params);
}

export function loadRecipeAggregate(db, recipeId, actingUserId) {
  const recipe = findRecipeForRead(db, recipeId, actingUserId);
  if (!recipe) return undefined;

  const groupRows = db
    .prepare('SELECT * FROM ingredient_groups WHERE recipe_id = ? ORDER BY position')
    .all(recipeId);
  const ingredientsStmt = db.prepare(
    'SELECT * FROM ingredients WHERE group_id = ? ORDER BY position'
  );
  const groups = groupRows.map((group) => ({
    ...group,
    ingredients: ingredientsStmt.all(group.id),
  }));

  const steps = db
    .prepare('SELECT * FROM steps WHERE recipe_id = ? ORDER BY position')
    .all(recipeId);

  const tags = db
    .prepare(
      `SELECT t.* FROM tags t
       JOIN recipe_tags rt ON rt.tag_id = t.id
       WHERE rt.recipe_id = ?
       ORDER BY t.name`
    )
    .all(recipeId);

  return { recipe, groups, steps, tags };
}

// Companion to findRecipeByShareToken: loads the same groups/ingredients/
// steps/tags shape as loadRecipeAggregate, but by recipeId alone, since the
// share route has no acting user to check read access with — the caller has
// already established access via the token itself.
export function loadRecipeContentById(db, recipeId) {
  const groupRows = db
    .prepare('SELECT * FROM ingredient_groups WHERE recipe_id = ? ORDER BY position')
    .all(recipeId);
  const ingredientsStmt = db.prepare(
    'SELECT * FROM ingredients WHERE group_id = ? ORDER BY position'
  );
  const groups = groupRows.map((group) => ({
    ...group,
    ingredients: ingredientsStmt.all(group.id),
  }));

  const steps = db
    .prepare('SELECT * FROM steps WHERE recipe_id = ? ORDER BY position')
    .all(recipeId);

  const tags = db
    .prepare(
      `SELECT t.* FROM tags t
       JOIN recipe_tags rt ON rt.tag_id = t.id
       WHERE rt.recipe_id = ?
       ORDER BY t.name`
    )
    .all(recipeId);

  return { groups, steps, tags };
}

export function insertRecipe(db, ownerId, fields) {
  const columns = ['owner_id'];
  const values = [ownerId];

  for (const column of RECIPE_COLUMNS) {
    if (fields[column] !== undefined) {
      columns.push(column);
      values.push(fields[column]);
    }
  }

  const placeholders = columns.map(() => '?').join(', ');
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO recipes (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...values);

  return db.prepare('SELECT * FROM recipes WHERE id = ?').get(lastInsertRowid);
}

export function updateRecipe(db, recipeId, actingUserId, fields) {
  const setClauses = ['updated_at = ?'];
  const values = [new Date().toISOString()];

  for (const column of RECIPE_COLUMNS) {
    if (fields[column] !== undefined) {
      setClauses.push(`${column} = ?`);
      values.push(fields[column]);
    }
  }

  values.push(recipeId, actingUserId);

  const { changes } = db
    .prepare(
      `UPDATE recipes SET ${setClauses.join(', ')} WHERE id = ? AND ${WRITE_PREDICATE}`
    )
    .run(...values);

  return changes;
}

export function setRecipeArchived(db, recipeId, actingUserId, isArchived) {
  const { changes } = db
    .prepare(`UPDATE recipes SET is_archived = ? WHERE id = ? AND ${WRITE_PREDICATE}`)
    .run(isArchived ? 1 : 0, recipeId, actingUserId);

  return changes;
}

export function setRecipeShareState(db, recipeId, actingUserId, { token, enabled, createdAt }) {
  const { changes } = db
    .prepare(
      `UPDATE recipes SET share_token = ?, share_enabled = ?, share_created_at = ? WHERE id = ? AND ${WRITE_PREDICATE}`
    )
    .run(token, enabled ? 1 : 0, createdAt, recipeId, actingUserId);

  return changes;
}

// SPECIFICATION.md section 9 (v2.0, D1): only the owner may publish or
// unpublish — write-scoped like every other mutation in this file.
export function setRecipePublic(db, recipeId, actingUserId, isPublic) {
  const { changes } = db
    .prepare(`UPDATE recipes SET is_public = ? WHERE id = ? AND ${WRITE_PREDICATE}`)
    .run(isPublic ? 1 : 0, recipeId, actingUserId);

  return changes;
}

export function countRecipesByOwner(db, userId) {
  return db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE owner_id = ?').get(userId).count;
}

export function deleteRecipe(db, recipeId, actingUserId) {
  const { changes } = db
    .prepare('DELETE FROM recipes WHERE id = ? AND owner_id = ?')
    .run(recipeId, actingUserId);

  return changes;
}

export function replaceRecipeContent(db, recipeId, actingUserId, content) {
  const recipe = findRecipeForWrite(db, recipeId, actingUserId);
  if (!recipe) return false;

  const { groups = [], steps = [], tagIds = [] } = content;

  const run = db.transaction(() => {
    db.prepare('DELETE FROM ingredient_groups WHERE recipe_id = ?').run(recipeId);
    db.prepare('DELETE FROM steps WHERE recipe_id = ?').run(recipeId);
    db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(recipeId);

    const insertGroup = db.prepare(
      'INSERT INTO ingredient_groups (recipe_id, name, position) VALUES (?, ?, ?)'
    );
    const insertIngredient = db.prepare(`
      INSERT INTO ingredients
        (group_id, amount, amount_max, unit, name, note, scales, is_optional, exclude_from_shopping, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertStep = db.prepare(
      'INSERT INTO steps (recipe_id, position, text, section_title) VALUES (?, ?, ?, ?)'
    );
    const insertTag = db.prepare('INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)');

    groups.forEach((group, groupIndex) => {
      const { lastInsertRowid: groupId } = insertGroup.run(
        recipeId,
        group.name ?? null,
        groupIndex
      );

      (group.ingredients ?? []).forEach((ingredient, ingredientIndex) => {
        insertIngredient.run(
          groupId,
          ingredient.amount ?? null,
          ingredient.amount_max ?? null,
          ingredient.unit ?? null,
          ingredient.name,
          ingredient.note ?? null,
          ingredient.scales === undefined ? 1 : ingredient.scales ? 1 : 0,
          ingredient.is_optional ? 1 : 0,
          ingredient.exclude_from_shopping ? 1 : 0,
          ingredientIndex
        );
      });
    });

    steps.forEach((step, index) => {
      insertStep.run(recipeId, index, step.text, step.section_title ?? null);
    });

    tagIds.forEach((tagId) => {
      insertTag.run(recipeId, tagId);
    });
  });

  run();
  return true;
}
