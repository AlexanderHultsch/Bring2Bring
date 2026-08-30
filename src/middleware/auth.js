import { findUserById } from '../repositories/users.js';

// Local, deliberately: the same tiny wrapper already exists once in
// src/routes/helpers.js (regenerateSession) and once in src/routes/auth.js
// (destroySession) — middleware/ has never imported from routes/, and this
// keeps that direction intact rather than being the first to invert it.
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function loadCurrentUser(db) {
  return async function (req, res, next) {
    const userId = req.session?.userId;
    const user = userId ? findUserById(db, userId) ?? null : null;

    // SPECIFICATION.md section 6.3: a password change or security-question
    // reset exists precisely so another party holding this account's
    // session gets evicted — that's the whole point of resetting a password
    // you believe someone else can use. password_changed_at is stamped on
    // the user row by changePassword/resetPasswordWithAnswer and mirrored
    // into the session at login/registration/password-change; comparing by
    // exact string equality (no date parsing, no clock skew) means any
    // session issued before the most recent change no longer matches and
    // must not authenticate this or any later request on it.
    if (user && user.password_changed_at !== req.session.passwordChangedAt) {
      await regenerateSession(req);
      req.currentUser = null;
      res.locals.currentUser = null;
      next();
      return;
    }

    req.currentUser = user;
    res.locals.currentUser = user;
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

// SPECIFICATION.md section 6.1/6.2: a signed-in visitor already has an
// account, so /login, /register and /reset-password are not for them.
export function redirectIfAuthenticated() {
  return function (req, res, next) {
    if (req.currentUser) {
      res.redirect('/');
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
