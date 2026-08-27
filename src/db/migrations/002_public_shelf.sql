ALTER TABLE recipes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_recipes_is_public ON recipes(is_public);
