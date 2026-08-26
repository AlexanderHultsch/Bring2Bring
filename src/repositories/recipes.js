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

const READ_PREDICATE = `
  (owner_id = ? OR EXISTS (
    SELECT 1 FROM recipe_shares s WHERE s.recipe_id = recipes.id AND s.user_id = ?
  ))
`;

const WRITE_PREDICATE = `
  (owner_id = ? OR EXISTS (
    SELECT 1 FROM recipe_shares s WHERE s.recipe_id = recipes.id AND s.user_id = ? AND s.can_edit = 1
  ))
`;

export function findRecipeForRead(db, recipeId, actingUserId) {
  return db
    .prepare(`SELECT * FROM recipes WHERE id = ? AND ${READ_PREDICATE}`)
    .get(recipeId, actingUserId, actingUserId);
}

export function findRecipeForWrite(db, recipeId, actingUserId) {
  return db
    .prepare(`SELECT * FROM recipes WHERE id = ? AND ${WRITE_PREDICATE}`)
    .get(recipeId, actingUserId, actingUserId);
}

export function listRecipesForUser(db, actingUserId, options = {}) {
  const { includeArchived = false } = options;
  const archivedClause = includeArchived ? '' : 'AND is_archived = 0';

  return db
    .prepare(
      `SELECT * FROM recipes WHERE ${READ_PREDICATE} ${archivedClause} ORDER BY created_at DESC, id DESC`
    )
    .all(actingUserId, actingUserId);
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

  values.push(recipeId, actingUserId, actingUserId);

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
    .run(isArchived ? 1 : 0, recipeId, actingUserId, actingUserId);

  return changes;
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
