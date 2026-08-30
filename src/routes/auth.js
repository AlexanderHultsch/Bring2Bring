import express from 'express';
import { authenticate, registerUser, readResetChallenge, resetPasswordWithAnswer } from '../services/auth.js';
import { updateUserLastLoginAt } from '../repositories/users.js';
import {
  loginIpLimiter,
  loginUsernameLimiter,
  registerIpLimiter,
  registerUsernameLimiter,
  resetPasswordIpLimiter,
  resetPasswordUsernameLimiter,
} from '../middleware/rate-limits.js';
import { redirectIfAuthenticated } from '../middleware/auth.js';
import { SESSION_COOKIE_NAME } from '../middleware/session.js';

const LOGIN_ERROR_MESSAGE = 'Invalid username or password.';
// §6.2: readResetChallenge returns null identically for an unknown username
// and a known user with no question set, so this message covers both cases
// without distinguishing them.
const RESET_LOOKUP_FAILURE = "We couldn't find a security question for that username.";

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
    res.render('login', {
      error: null,
      username: '',
      passwordReset: req.query.passwordReset === '1',
    });
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
          res
            .status(401)
            .render('login', { error: LOGIN_ERROR_MESSAGE, username, passwordReset: false });
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

  router.get('/register', redirectIfAuthenticated(), (req, res) => {
    res.render('register', { error: null, username: '' });
  });

  router.post(
    '/register',
    redirectIfAuthenticated(),
    registerIpLimiter(),
    registerUsernameLimiter(),
    async (req, res, next) => {
      const username = typeof req.body.username === 'string' ? req.body.username : '';

      try {
        const result = await registerUser(db, req.body);

        if (!result.success) {
          res.status(422).render('register', { error: result.error, username });
          return;
        }

        // SPECIFICATION.md section 6.2: registering logs you in — exactly
        // what POST /login does after a successful authenticate.
        await regenerateSession(req);
        req.session.userId = result.user.id;
        updateUserLastLoginAt(db, result.user.id, new Date().toISOString());

        res.redirect('/');
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/reset-password', redirectIfAuthenticated(), (req, res) => {
    res.render('reset-password', { error: null, username: '', question: null });
  });

  router.post(
    '/reset-password',
    redirectIfAuthenticated(),
    resetPasswordIpLimiter(),
    resetPasswordUsernameLimiter(),
    async (req, res, next) => {
      const username = typeof req.body.username === 'string' ? req.body.username : '';
      const hasAnswer =
        typeof req.body.securityAnswer === 'string' && req.body.securityAnswer.trim() !== '';

      try {
        if (!hasAnswer) {
          const question = readResetChallenge(db, username);
          if (!question) {
            res
              .status(422)
              .render('reset-password', { error: RESET_LOOKUP_FAILURE, username, question: null });
            return;
          }
          res.render('reset-password', { error: null, username, question });
          return;
        }

        const result = await resetPasswordWithAnswer(db, req.body);
        if (!result.success) {
          const question = readResetChallenge(db, username);
          res.status(422).render('reset-password', { error: result.error, username, question });
          return;
        }

        res.redirect('/login?passwordReset=1');
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
      res.clearCookie(SESSION_COOKIE_NAME);
      res.redirect('/login');
    } catch (err) {
      next(err);
    }
  });

  return router;
}
