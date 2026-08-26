import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { requestLogger } from './middleware/request-logger.js';
import { notFoundHandler, errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, 'views');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

  app.use(healthRouter(db));

  // -- later: public share routes /r/:token and /uploads/:file --

  // -- later: session, CSRF, authenticated routes --

  app.use(notFoundHandler());
  app.use(errorHandler(config));

  return app;
}
