import { findUserById } from '../repositories/users.js';

export function loadCurrentUser(db) {
  return function (req, res, next) {
    const userId = req.session?.userId;
    const currentUser = userId ? findUserById(db, userId) ?? null : null;
    req.currentUser = currentUser;
    res.locals.currentUser = currentUser;
    next();
  };
}

export function requireAuth() {
  return function (req, res, next) {
    if (!req.currentUser) {
      res.redirect('/login');
      return;
    }
    next();
  };
}

export function requireAdmin() {
  return function (req, res, next) {
    if (!req.currentUser || req.currentUser.role !== 'admin') {
      const error = new Error('Not found');
      error.status = 404;
      next(error);
      return;
    }
    next();
  };
}
