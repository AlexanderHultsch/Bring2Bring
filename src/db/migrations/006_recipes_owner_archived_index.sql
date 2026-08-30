-- The "My Dishes" query (src/repositories/recipes.js, listRecipesForUser)
-- filters WHERE owner_id = ? AND is_archived = 0. Without a composite index,
-- SQLite picks idx_recipes_is_archived (near-boolean, almost no selectivity)
-- and the plan's cost scales with the total number of recipes in the
-- database rather than the caller's own. A composite index on
-- (owner_id, is_archived) fixes that; the old single-column index on
-- is_archived is no longer used by any query (every filter on is_archived
-- also filters on owner_id) and is dropped.
CREATE INDEX idx_recipes_owner_archived ON recipes(owner_id, is_archived);

DROP INDEX idx_recipes_is_archived;
