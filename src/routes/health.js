import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';

const packageJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'package.json'
);
const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

export function healthRouter(db) {
  const router = express.Router();

  router.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', version });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  return router;
}
