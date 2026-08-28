import { doubleCsrf } from 'csrf-csrf';

const CSRF_COOKIE_NAME = 'bring2bring.csrf';

export function csrfProtection(config) {
  const { doubleCsrfProtection } = doubleCsrf({
    getSecret: () => config.sessionSecret,
    // req.session.id is unusable here: with saveUninitialized false (D1) an
    // anonymous session is never persisted until something is written to it,
    // so it gets a fresh id on every request and never round-trips via
    // cookie. Binding to req.session.userId instead — the one field D2
    // permits in the session — needs no extra session write, is stable for
    // the whole anonymous phase, and still changes (invalidating old tokens)
    // exactly when D3's session regenerate on login takes effect.
    getSessionIdentifier: (req) => String(req.session.userId ?? 'anonymous'),
    cookieName: CSRF_COOKIE_NAME,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/',
    },
    getCsrfTokenFromRequest: (req) => req.body?._csrf,
  });

  return doubleCsrfProtection;
}

export function csrfTokenLocals() {
  return function (req, res, next) {
    res.locals.csrfToken = req.csrfToken();
    next();
  };
}
