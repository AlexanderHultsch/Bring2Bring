import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';

export function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dishlist-'));
  const dbPath = path.join(dir, 'test.db');
  const db = openDatabase(dbPath);
  runMigrations(db);

  return {
    db,
    dbPath,
    cleanup() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
