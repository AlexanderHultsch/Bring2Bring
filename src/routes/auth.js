import express from 'express';
import { authenticate } from '../services/auth.js';
import { updateUserLastLoginAt } from '../repositories/users.js';
import { loginIpLimiter, loginUsernameLimiter } from '../middleware/rate-limits.js';

const LOGIN_ERROR_MESSAGE = 'Invalid username or password.';

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

export function authRouter(db, config) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    res.render('login', { error: null, username: '' });
  });

  router.post(
    '/login',
    loginIpLimiter(),
    loginUsernameLimiter(),
    async (req, res, next) => {
      const username = typeof req.body.username === 'string' ? req.body.username : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';

      try {
        const user = username && password ? await authenticate(db, username, password) : null;

        if (!user) {
          res.status(401).render('login', { error: LOGIN_ERROR_MESSAGE, username });
          return;
        }

        await regenerateSession(req);
        req.session.userId = user.id;
        updateUserLastLoginAt(db, user.id, new Date().toISOString());

        res.redirect('/');
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/logout', async (req, res, next) => {
    try {
      if (req.session) {
        await destroySession(req);
      }
      res.clearCookie('dishlist.sid');
      res.redirect('/login');
    } catch (err) {
      next(err);
    }
  });

  return router;
}
