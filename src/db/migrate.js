import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { openDatabase } from './index.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations').all().map((row) => row.filename)
  );

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .filter((filename) => !applied.has(filename));

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)'
  );

  const appliedNow = [];
  for (const filename of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(filename, new Date().toISOString());
    });
    applyMigration();
    appliedNow.push(filename);
  }

  return appliedNow;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const applied = runMigrations(db);

  if (applied.length === 0) {
    console.log('No pending migrations.');
  } else {
    for (const filename of applied) {
      console.log(`Applied ${filename}`);
    }
  }
}
