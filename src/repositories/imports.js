// SPECIFICATION.md section 8.5 / 5 (v2.0, D4): at most one counted import per
// (recipe, device, day). The INSERT OR IGNORE and the counter increment run
// in one better-sqlite3 transaction so the exact bring_imports row and the
// denormalised recipes.bring_import_count can never disagree.
export function recordBringImport(db, recipeId, deviceId, day) {
  const run = db.transaction(() => {
    const { changes } = db
      .prepare('INSERT OR IGNORE INTO bring_imports (recipe_id, device_id, day) VALUES (?, ?, ?)')
      .run(recipeId, deviceId, day);

    if (changes > 0) {
      db.prepare('UPDATE recipes SET bring_import_count = bring_import_count + 1 WHERE id = ?').run(
        recipeId
      );
    }

    return changes > 0;
  });

  return run();
}
