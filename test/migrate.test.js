import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

const EXPECTED_TABLES = [
  'bring_imports',
  'ingredient_groups',
  'ingredients',
  'invites',
  'recipe_shares',
  'recipe_tags',
  'recipes',
  'schema_migrations',
  'steps',
  'tags',
  'users',
].sort();

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bring2bring-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('openDatabase creates a missing parent directory', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'nested', 'deeper', 'bring2bring.db');
    const db = openDatabase(dbPath);
    assert.ok(fs.existsSync(path.dirname(dbPath)));
    db.close();
  });
});

test('pragma foreign_keys is 1 and journal_mode is wal after openDatabase', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    db.close();
  });
});

test('runMigrations on a fresh db returns 001 through 006 in order and creates every table', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    const applied = runMigrations(db);
    assert.deepEqual(applied, [
      '001_init.sql',
      '002_public_shelf.sql',
      '003_bring_imports.sql',
      '004_unit_preferences.sql',
      '005_security_question.sql',
      '006_recipes_owner_archived_index.sql',
    ]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)
      .sort();
    assert.deepEqual(tables, EXPECTED_TABLES);
    db.close();
  });
});

test('runMigrations called a second time returns [] and leaves schema_migrations with six rows', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);
    const secondRun = runMigrations(db);
    assert.deepEqual(secondRun, []);

    const count = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
    assert.equal(count, 6);
    db.close();
  });
});

test('migration 002 adds recipes.is_public NOT NULL DEFAULT 0, indexed', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    const ownerId = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('owner', 'hash').lastInsertRowid;
    const recipeId = db
      .prepare('INSERT INTO recipes (owner_id, title) VALUES (?, ?)')
      .run(ownerId, 'Soup').lastInsertRowid;

    assert.equal(db.prepare('SELECT is_public FROM recipes WHERE id = ?').get(recipeId).is_public, 0);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'recipes'")
      .all()
      .map((row) => row.name);
    assert.ok(indexes.some((name) => name.includes('is_public')));
    db.close();
  });
});

test('migration 003 adds recipes.bring_import_count and the bring_imports table with its composite primary key', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    const ownerId = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('owner', 'hash').lastInsertRowid;
    const recipeId = db
      .prepare('INSERT INTO recipes (owner_id, title) VALUES (?, ?)')
      .run(ownerId, 'Soup').lastInsertRowid;

    assert.equal(
      db.prepare('SELECT bring_import_count FROM recipes WHERE id = ?').get(recipeId)
        .bring_import_count,
      0
    );

    db.prepare(
      'INSERT INTO bring_imports (recipe_id, device_id, day) VALUES (?, ?, ?)'
    ).run(recipeId, 'device-a', '2026-08-27');

    assert.throws(() => {
      db.prepare(
        'INSERT INTO bring_imports (recipe_id, device_id, day) VALUES (?, ?, ?)'
      ).run(recipeId, 'device-a', '2026-08-27');
    });
    db.close();
  });
});

test('migration 004 adds users.unit_language and users.measurement_system, defaulted and constrained', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    const userId = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('owner', 'hash').lastInsertRowid;

    const row = db
      .prepare('SELECT unit_language, measurement_system FROM users WHERE id = ?')
      .get(userId);
    assert.equal(row.unit_language, 'de');
    assert.equal(row.measurement_system, 'metric');

    assert.throws(() => {
      db.prepare('UPDATE users SET unit_language = ? WHERE id = ?').run('fr', userId);
    });
    assert.throws(() => {
      db.prepare('UPDATE users SET measurement_system = ? WHERE id = ?').run('cubits', userId);
    });
    db.close();
  });
});

test('migration 005 adds users.security_question and users.security_answer_hash, both nullable', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    const userId = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('owner', 'hash').lastInsertRowid;

    const row = db
      .prepare('SELECT security_question, security_answer_hash FROM users WHERE id = ?')
      .get(userId);
    assert.equal(row.security_question, null);
    assert.equal(row.security_answer_hash, null);

    assert.doesNotThrow(() => {
      db.prepare('UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?').run(
        'City you were born in?',
        'some-hash',
        userId
      );
    });
    db.close();
  });
});

test('migration 006 replaces idx_recipes_is_archived with a composite idx_recipes_owner_archived used by the "My Dishes" query', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'recipes'")
      .all()
      .map((row) => row.name);
    assert.ok(indexes.includes('idx_recipes_owner_archived'));
    assert.ok(!indexes.includes('idx_recipes_is_archived'));

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM recipes WHERE owner_id = ? AND is_archived = 0
         ORDER BY created_at DESC, id DESC`
      )
      .all(1)
      .map((row) => row.detail)
      .join(' ');
    assert.ok(plan.includes('idx_recipes_owner_archived'));
    db.close();
  });
});

test('migrations 002 and 003 are idempotent: applying them twice leaves the schema unchanged', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);
    assert.doesNotThrow(() => runMigrations(db));

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)
      .sort();
    assert.deepEqual(tables, EXPECTED_TABLES);
    db.close();
  });
});

test('deleting a recipe cascades to its ingredient_groups, ingredients, steps, recipe_tags and recipe_shares', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    const ownerId = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('owner', 'hash').lastInsertRowid;
    const otherUserId = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('other', 'hash').lastInsertRowid;
    const recipeId = db
      .prepare('INSERT INTO recipes (owner_id, title) VALUES (?, ?)')
      .run(ownerId, 'Test recipe').lastInsertRowid;
    const groupId = db
      .prepare('INSERT INTO ingredient_groups (recipe_id, position) VALUES (?, ?)')
      .run(recipeId, 0).lastInsertRowid;
    db.prepare(
      'INSERT INTO ingredients (group_id, name, position) VALUES (?, ?, ?)'
    ).run(groupId, 'Flour', 0);
    db.prepare('INSERT INTO steps (recipe_id, position, text) VALUES (?, ?, ?)').run(
      recipeId,
      0,
      'Mix it'
    );
    const tagId = db.prepare('INSERT INTO tags (name) VALUES (?)').run('quick').lastInsertRowid;
    db.prepare('INSERT INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)').run(recipeId, tagId);
    db.prepare('INSERT INTO recipe_shares (recipe_id, user_id) VALUES (?, ?)').run(
      recipeId,
      otherUserId
    );

    db.prepare('DELETE FROM recipes WHERE id = ?').run(recipeId);

    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM ingredient_groups WHERE recipe_id = ?').get(recipeId)
        .count,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM ingredients WHERE group_id = ?').get(groupId).count,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM steps WHERE recipe_id = ?').get(recipeId).count,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM recipe_tags WHERE recipe_id = ?').get(recipeId)
        .count,
      0
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM recipe_shares WHERE recipe_id = ?').get(recipeId)
        .count,
      0
    );
    db.close();
  });
});

test("inserting a user with role 'superuser' throws", () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    assert.throws(() => {
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
        'baduser',
        'hash',
        'superuser'
      );
    });
    db.close();
  });
});

test('inserting two users with the same username throws', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dupe', 'hash');
    assert.throws(() => {
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('dupe', 'hash');
    });
    db.close();
  });
});

test('inserting two recipes with the same share_token throws', () => {
  withTempDir((dir) => {
    const dbPath = path.join(dir, 'bring2bring.db');
    const db = openDatabase(dbPath);
    runMigrations(db);

    const ownerId = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run('owner', 'hash').lastInsertRowid;
    db.prepare('INSERT INTO recipes (owner_id, title, share_token) VALUES (?, ?, ?)').run(
      ownerId,
      'Recipe one',
      'shared-token'
    );
    assert.throws(() => {
      db.prepare('INSERT INTO recipes (owner_id, title, share_token) VALUES (?, ?, ?)').run(
        ownerId,
        'Recipe two',
        'shared-token'
      );
    });
    db.close();
  });
});
