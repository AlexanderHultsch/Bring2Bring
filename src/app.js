import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { requestLogger } from './middleware/request-logger.js';
import { notFoundHandler, errorHandler } from './middleware/error-handler.js';
import { sessionMiddleware } from './middleware/session.js';
import { csrfProtection, csrfTokenLocals } from './middleware/csrf.js';
import { loadCurrentUser } from './middleware/auth.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { recipesRouter } from './routes/recipes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, 'views');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DOMAIN_DIR = path.join(__dirname, 'domain');

export function createApp({ db, config }) {
  const app = express();

  app.set('views', VIEWS_DIR);
  app.set('view engine', 'ejs');

  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    })
  );

  app.use(requestLogger(config));

  app.use(express.static(PUBLIC_DIR));
  // Served so the browser can `import` the exact same domain code the server
  // renders with (SPECIFICATION.md section 4.1) — never copy these into public/.
  app.use('/js/domain', express.static(DOMAIN_DIR));

  app.use(healthRouter(db));

  // -- later: public share routes /r/:token and /uploads/:file --

  app.use(express.urlencoded({ extended: true, parameterLimit: 5000 }));
  app.use(cookieParser(config.sessionSecret));
  app.use(sessionMiddleware(db, config));
  app.use(loadCurrentUser(db));
  app.use(csrfProtection(config));
  app.use(csrfTokenLocals());

  app.use(authRouter(db, config));
  app.use(recipesRouter(db, config));

  app.use(notFoundHandler());
  app.use(errorHandler(config));

  return app;
}
