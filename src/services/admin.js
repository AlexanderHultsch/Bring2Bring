import { findUserById } from '../repositories/users.js';
import {
  adminDeleteUser,
  adminUnpublishRecipe,
  adminDeleteRecipe,
  countAdmins,
} from '../repositories/admin.js';

function isAdmin(actingUser) {
  return actingUser?.role === 'admin';
}

// SPECIFICATION.md section 6.4 (v2.0, D3): refuses rather than throws when
// the acting user is not an admin, the target does not exist, or the target
// is the last remaining admin account. Deleting a normal user cascades to
// their recipes via the schema's existing ON DELETE CASCADE (section 5).
export function deleteUser(db, actingUser, targetUserId) {
  if (!isAdmin(actingUser)) return { success: false };

  const target = findUserById(db, targetUserId);
  if (!target) return { success: false };

  if (target.role === 'admin' && countAdmins(db) <= 1) return { success: false };

  const changes = adminDeleteUser(db, targetUserId);
  return { success: changes > 0 };
}

export function unpublishRecipeAsAdmin(db, actingUser, recipeId) {
  if (!isAdmin(actingUser)) return { success: false };

  const changes = adminUnpublishRecipe(db, recipeId);
  return { success: changes > 0 };
}

export function deleteRecipeAsAdmin(db, actingUser, recipeId) {
  if (!isAdmin(actingUser)) return { success: false };

  const changes = adminDeleteRecipe(db, recipeId);
  return { success: changes > 0 };
}
