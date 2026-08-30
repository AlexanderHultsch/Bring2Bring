import crypto from 'node:crypto';
import { z } from 'zod';
import { findRecipeForWrite, setRecipeShareState } from '../repositories/recipes.js';

export const ShareActionSchema = z.object({
  action: z.enum(['enable', 'rotate', 'disable']),
});

// SPECIFICATION.md section 8.2: 32 bytes from crypto.randomBytes, base64url-encoded.
function generateShareToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// The three actions of SPECIFICATION.md §8.2: enable reuses an existing
// token, rotate replaces it immediately, disable turns the link off without
// clearing the token.
// All three require write access to the recipe, enforced by findRecipeForWrite
// exactly as every other mutation in this app; an unauthorized caller sees
// { success: false } and the route above turns that into a 404.
export function applyShareAction(db, recipeId, actingUserId, action) {
  const recipe = findRecipeForWrite(db, recipeId, actingUserId);
  if (!recipe) return { success: false };

  if (action === 'enable') {
    const token = recipe.share_token ?? generateShareToken();
    const createdAt = recipe.share_token ? recipe.share_created_at : new Date().toISOString();
    setRecipeShareState(db, recipeId, actingUserId, { token, enabled: true, createdAt });
    return { success: true };
  }

  if (action === 'rotate') {
    const token = generateShareToken();
    setRecipeShareState(db, recipeId, actingUserId, {
      token,
      enabled: recipe.share_enabled === 1,
      createdAt: recipe.share_created_at,
    });
    return { success: true };
  }

  setRecipeShareState(db, recipeId, actingUserId, {
    token: recipe.share_token,
    enabled: false,
    createdAt: recipe.share_created_at,
  });
  return { success: true };
}
