CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT
);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at TEXT
);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  yield_amount REAL NOT NULL DEFAULT 4,
  yield_unit TEXT NOT NULL DEFAULT 'servings',
  yield_label TEXT,
  prep_minutes INTEGER,
  cook_minutes INTEGER,
  total_minutes INTEGER,
  source_name TEXT,
  source_url TEXT,
  notes TEXT,
  image_path TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  share_token TEXT UNIQUE,
  share_enabled INTEGER NOT NULL DEFAULT 0,
  share_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE ingredient_groups (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES ingredient_groups(id) ON DELETE CASCADE,
  amount REAL,
  amount_max REAL,
  unit TEXT,
  name TEXT NOT NULL,
  note TEXT,
  scales INTEGER NOT NULL DEFAULT 1,
  is_optional INTEGER NOT NULL DEFAULT 0,
  exclude_from_shopping INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);

CREATE TABLE steps (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  section_title TEXT
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);

CREATE TABLE recipe_shares (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (recipe_id, user_id)
);

CREATE INDEX idx_recipes_owner_id ON recipes(owner_id);
CREATE INDEX idx_recipes_is_archived ON recipes(is_archived);
CREATE INDEX idx_ingredient_groups_recipe ON ingredient_groups(recipe_id, position);
CREATE INDEX idx_ingredients_group ON ingredients(group_id, position);
CREATE INDEX idx_steps_recipe ON steps(recipe_id, position);
CREATE INDEX idx_recipe_tags_tag_id ON recipe_tags(tag_id);
CREATE INDEX idx_recipe_shares_user_id ON recipe_shares(user_id);
