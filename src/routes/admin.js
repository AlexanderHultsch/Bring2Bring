import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { findUserById } from '../repositories/users.js';
import { adminListRecipes, adminListUsers } from '../repositories/admin.js';
import { deleteUser, unpublishRecipeAsAdmin, deleteRecipeAsAdmin } from '../services/admin.js';
import { notFoundError, parseId } from './helpers.js';

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function usersWithAdminCount(db) {
  const users = adminListUsers(db);
  const adminCount = users.filter((user) => user.role === 'admin').length;
  return { users, adminCount };
}

// SPECIFICATION.md section 6.4 / 9 (v2.0, D3): "admin acts without reading".
// Every route below is requireAuth() then requireAdmin(), in that order, so
// an anonymous visitor gets the usual 302 to /login while a logged-in
// non-admin gets 404 — the admin area is not confirmed to exist to someone
// who is not one. All mutations go through src/services/admin.js, which
// already refuses a non-admin caller and refuses to delete the last admin;
// this router only calls those services and renders their outcome.
export function adminRouter(db) {
  const router = express.Router();

  router.get('/admin/recipes', requireAuth(), requireAdmin(), (req, res) => {
    const search = asString(req.query.q);
    const recipes = adminListRecipes(db, { search });
    res.render('admin/recipes', { recipes, search });
  });

  router.post('/admin/recipes/:id/unpublish', requireAuth(), requireAdmin(), (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const result = unpublishRecipeAsAdmin(db, req.currentUser, id);
    if (!result.success) {
      next(notFoundError());
      return;
    }
    res.redirect('/admin/recipes');
  });

  router.post('/admin/recipes/:id/delete', requireAuth(), requireAdmin(), (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const result = deleteRecipeAsAdmin(db, req.currentUser, id);
    if (!result.success) {
      next(notFoundError());
      return;
    }
    res.redirect('/admin/recipes');
  });

  router.get('/admin/users', requireAuth(), requireAdmin(), (req, res) => {
    res.render('admin/users', { ...usersWithAdminCount(db), deleteError: null });
  });

  // SPECIFICATION.md section 6.4 (v2.0, D3): deleteUser refuses a target that
  // does not exist or is the last remaining admin. The existence check here
  // picks 404 vs. a rendered error message; it does not re-decide anything
  // the service already decided — a target that still exists after a refusal
  // was refused for the one other reason the service has: last admin.
  router.post('/admin/users/:id/delete', requireAuth(), requireAdmin(), (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const target = findUserById(db, id);
    if (!target) {
      next(notFoundError());
      return;
    }

    const result = deleteUser(db, req.currentUser, id);
    if (!result.success) {
      res.status(422).render('admin/users', {
        ...usersWithAdminCount(db),
        deleteError: 'The last remaining admin account cannot be deleted.',
      });
      return;
    }
    res.redirect('/admin/users');
  });

  return router;
}
