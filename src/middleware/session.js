import session from 'express-session';
import createSqliteStore from 'better-sqlite3-session-store';

export const SESSION_COOKIE_NAME = 'bring2bring.sid';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionMiddleware(db, config) {
  const SqliteStore = createSqliteStore(session);

  // better-sqlite3-session-store always starts a setInterval to purge expired
  // sessions and never exposes the timer, so an un-unref'd handle would keep
  // the process (and `npm test`) alive after the last test finishes. There is
  // no option to disable the interval either (the store's own `clear` option
  // is broken by a `|| true` in its constructor), so the only way to stop it
  // from blocking process exit is to override the method that creates it.
  class UnrefSqliteStore extends SqliteStore {
    startInterval() {
      const timer = setInterval(this.clearExpiredSessions.bind(this), this.expired.intervalMs);
      timer.unref?.();
    }
  }

  const store = new UnrefSqliteStore({ client: db });

  return session({
    name: SESSION_COOKIE_NAME,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: THIRTY_DAYS_MS,
    },
  });
}

// session() above is called without a `proxy` option, so express-session's own
// issecure(req, trustProxy) receives trustProxy === undefined: that's neither
// `=== false` nor `=== true`, so it falls through to `return req.secure === true`
// — Express's own getter, which honours the numeric `trust proxy` app.js sets
// from config.trustProxy (app.js: `app.set('trust proxy', config.trustProxy)`)
// and reads X-Forwarded-Proto accordingly. When the cookie is `secure` and that
// comes back false, express-session drops Set-Cookie silently (index.js:242) —
// no throw, no log unless DEBUG happens to be set. Mirroring that exact branch
// here means checking `req.secure` directly, the same value express-session
// itself falls back to in this app's configuration.
let warned = false;

export function warnIfSessionCookieSuppressed(config) {
  return function (req, res, next) {
    if (config.nodeEnv !== 'test' && config.isProduction && !req.secure && !warned) {
      warned = true;
      console.warn(
        'Session cookie is configured `secure: true` (NODE_ENV=production) but this request was ' +
          'not seen as secure (req.secure is false): express-session will silently withhold ' +
          'Set-Cookie, so logins will appear to do nothing. Make the reverse proxy in front of ' +
          'Bring2Bring! send "X-Forwarded-Proto: https" on every request.'
      );
    }
    next();
  };
}

// Test-only: the once-per-process warning above is deliberately a module-level
// flag (same shape as the cached dummy hash in src/services/auth.js), which
// would make tests order-dependent if they shared it — this lets each test
// start from a clean slate.
export function resetSessionCookieWarning() {
  warned = false;
}
