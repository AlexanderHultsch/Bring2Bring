// SPECIFICATION.md section 6.4 / 5.1 (v2.0, D3): "admin acts without
// reading". These functions bypass the owner/public read predicate on
// purpose — they are privileged by definition, take no acting user id, and
// the services layer (src/services/admin.js) is what checks the caller is
// actually an admin before calling any of them.

// This SELECT lists only id, title, author_username, is_public, created_at
// and bring_import_count — never ingredients, never steps, never SELECT *.
// A future admin template cannot leak recipe contents it was never given:
// don't add columns here.
export function adminListRecipes(db, options = {}) {
  const { search = '' } = options;
  const params = [];

  let searchClause = '';
  const trimmed = search.trim();
  if (trimmed !== '') {
    const likeTerm = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`;
    searchClause = `WHERE recipes.title LIKE ? ESCAPE '\\'`;
    params.push(likeTerm);
  }

  return db
    .prepare(
      `SELECT
         recipes.id,
         recipes.title,
         users.username AS author_username,
         recipes.is_public,
         recipes.created_at,
         recipes.bring_import_count
       FROM recipes
       JOIN users ON users.id = recipes.owner_id
       ${searchClause}
       ORDER BY recipes.title COLLATE NOCASE ASC, recipes.id ASC`
    )
    .all(...params);
}

export function adminUnpublishRecipe(db, recipeId) {
  const { changes } = db
    .prepare('UPDATE recipes SET is_public = 0 WHERE id = ?')
    .run(recipeId);
  return changes;
}

export function adminDeleteRecipe(db, recipeId) {
  const { changes } = db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);
  return changes;
}

// No password_hash — this list is for identity and existence, not login.
export function adminListUsers(db) {
  return db
    .prepare(
      `SELECT
         users.id,
         users.username,
         users.role,
         users.created_at,
         users.last_login_at,
         (SELECT COUNT(*) FROM recipes WHERE recipes.owner_id = users.id) AS recipe_count
       FROM users
       ORDER BY users.username COLLATE NOCASE ASC`
    )
    .all();
}

export function adminDeleteUser(db, userId) {
  const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return changes;
}

export function countAdmins(db) {
  return db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`).get().count;
}
