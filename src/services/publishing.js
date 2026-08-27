import { z } from 'zod';
import { setRecipePublic } from '../repositories/recipes.js';
import { applyShareAction } from './sharing.js';

export const PublishActionSchema = z.object({
  action: z.enum(['publish', 'unpublish']),
});

// SPECIFICATION.md section 8.5 / D1: Bring!'s servers can only import from a
// URL they themselves can fetch, so publishing to the Public shelf must also
// turn on the recipe's /r/<token> link — otherwise "Send to Bring!" would
// 404 for a recipe visible on the shelf. Reuses applyShareAction('enable')
// rather than generating a second token.
export function publishRecipe(db, recipeId, actingUserId) {
  const published = setRecipePublic(db, recipeId, actingUserId, true);
  if (published === 0) return { success: false };

  applyShareAction(db, recipeId, actingUserId, 'enable');
  return { success: true };
}

// SPECIFICATION.md section 5.1 / 11 (v2.0, D1): unpublishing deliberately
// does NOT disable or rotate the share token. Someone may already hold that
// link, and silently rotating it out from under them would break their
// existing Bring! entries without telling them — disabling or rotating stays
// a separate, explicit action via POST /recipes/:id/share/link.
export function unpublishRecipe(db, recipeId, actingUserId) {
  const changed = setRecipePublic(db, recipeId, actingUserId, false);
  return { success: changed > 0 };
}
