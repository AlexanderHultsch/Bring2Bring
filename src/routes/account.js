import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { changePassword, updateUnitPreferences, setSecurityQuestion } from '../services/account.js';
import { regenerateSession } from './helpers.js';

function formatMemberSince(isoTimestamp, locale) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

// EJS throws at render time on a missing local, so every 'account' render
// goes through this one place that supplies all of them.
function accountLocals(req, config, overrides = {}) {
  return {
    memberSince: formatMemberSince(req.currentUser.created_at, config.numberLocale),
    passwordChanged: false,
    passwordError: null,
    unitsSaved: false,
    unitsError: null,
    securityQuestionSaved: false,
    securityQuestionError: null,
    ...overrides,
  };
}

export function accountRouter(db, config) {
  const router = express.Router();

  router.get('/account', requireAuth(), (req, res) => {
    res.render('account', accountLocals(req, config, {
      passwordChanged: req.query.passwordChanged === '1',
      unitsSaved: req.query.unitsSaved === '1',
      securityQuestionSaved: req.query.securityQuestionSaved === '1',
    }));
  });

  router.post('/account/password', requireAuth(), async (req, res, next) => {
    try {
      const result = await changePassword(db, req.currentUser, req.body);
      if (!result.success) {
        res.status(422).render('account', accountLocals(req, config, { passwordError: result.error }));
        return;
      }

      // SPECIFICATION.md section 6.3 / 6.1: a password change is exactly when
      // you want the old session id gone, same fixation defence login uses
      // (src/routes/auth.js). The user stays logged in.
      const userId = req.currentUser.id;
      await regenerateSession(req);
      req.session.userId = userId;
      req.session.passwordChangedAt = result.passwordChangedAt;

      res.redirect('/account?passwordChanged=1');
    } catch (err) {
      next(err);
    }
  });

  router.post('/account/units', requireAuth(), (req, res) => {
    const result = updateUnitPreferences(db, req.currentUser, req.body);
    if (!result.success) {
      res.status(422).render('account', accountLocals(req, config, { unitsError: result.error }));
      return;
    }

    res.redirect('/account?unitsSaved=1');
  });

  router.post('/account/security-question', requireAuth(), async (req, res, next) => {
    try {
      const result = await setSecurityQuestion(db, req.currentUser, req.body);
      if (!result.success) {
        res.status(422).render('account', accountLocals(req, config, { securityQuestionError: result.error }));
        return;
      }

      res.redirect('/account?securityQuestionSaved=1');
    } catch (err) {
      next(err);
    }
  });

  router.get('/privacy', requireAuth(), (req, res) => {
    res.render('privacy');
  });

  router.get('/about-bring', requireAuth(), (req, res) => {
    res.render('about-bring');
  });

  return router;
}
