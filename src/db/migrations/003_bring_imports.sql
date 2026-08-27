ALTER TABLE recipes ADD COLUMN bring_import_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE bring_imports (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (recipe_id, device_id, day)
);
