import session from 'express-session';
import createSqliteStore from 'better-sqlite3-session-store';

const SESSION_COOKIE_NAME = 'dishlist.sid';
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
