import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { redactPath, redactTokens } from '../src/middleware/request-logger.js';
import { insertUser } from '../src/repositories/users.js';
import { createRecipe } from '../src/services/recipes.js';
import { applyShareAction } from '../src/services/sharing.js';

const testEnv = (overrides = {}) => ({
  SESSION_SECRET: 'a'.repeat(16),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'super-secret-password',
  PUBLIC_BASE_URL: 'https://dishlist.example.com',
  NODE_ENV: 'test',
  ...overrides,
});

function scalingRecipeBody() {
  return {
    title: 'Scalable Soup',
    servings: '4',
    ingredients: [{ name: 'Flour', amount: '250', unit: 'g' }],
    method: 'Mix.',
  };
}

function shareTokenFor(db, recipeId) {
  return db.prepare('SELECT share_token FROM recipes WHERE id = ?').get(recipeId).share_token;
}

test('redactPath redacts /r/:token in its various shapes and leaves everything else untouched', () => {
  assert.equal(redactPath('/r/AbC123-_xyz'), '/r/[redacted]');
  assert.equal(redactPath('/r/AbC123-_xyz/'), '/r/[redacted]/');
  assert.equal(redactPath('/recipes/12'), '/recipes/12');
  assert.equal(redactPath('/'), '/');
  assert.equal(redactPath('/r'), '/r');
  assert.equal(redactPath('/r/'), '/r/');
});

test('redactTokens removes the token from an absolute share URL but leaves the origin and surrounding text readable', () => {
  const token = 'AbC123-_tokenValueXYZ';
  const text = `Failed to reach https://dishlist.example.com/r/${token}?yield=6 after 3 retries`;
  const redacted = redactTokens(text);
  assert.ok(!redacted.includes(token));
  assert.equal(
    redacted,
    'Failed to reach https://dishlist.example.com/r/[redacted]?yield=6 after 3 retries'
  );
});

test('redactTokens redacts every share URL in a string containing several of them', () => {
  const tokenA = 'firstTokenAAA111';
  const tokenB = 'secondTokenBBB222';
  const text = `see https://dishlist.example.com/r/${tokenA} and also https://dishlist.example.com/r/${tokenB}`;
  const redacted = redactTokens(text);
  assert.ok(!redacted.includes(tokenA));
  assert.ok(!redacted.includes(tokenB));
  assert.equal(
    redacted,
    'see https://dishlist.example.com/r/[redacted] and also https://dishlist.example.com/r/[redacted]'
  );
});

test('redactTokens leaves a string with no token completely unchanged', () => {
  const text = 'Database connection failed: ECONNREFUSED 127.0.0.1:5432';
  assert.equal(redactTokens(text), text);
});

test('END-TO-END: a real share token never appears anywhere written to console.log or console.error, including via a 500 whose Error message embeds the full share URL', async () => {
  const { db, cleanup } = createTestDb();
  try {
    // NODE_ENV: 'development' rather than the usual test-suite 'test' —
    // requestLogger is a deliberate no-op under 'test' (see
    // src/middleware/request-logger.js), so proving the redaction guarantee
    // requires the real access-log line to actually be written.
    const config = loadConfig(testEnv({ NODE_ENV: 'development' }));
    const app = createApp({ db, config });

    const owner = insertUser(db, { username: 'alex', passwordHash: 'irrelevant-hash' });
    const created = createRecipe(db, owner.id, scalingRecipeBody());
    assert.ok(created.success, 'recipe creation must succeed');
    applyShareAction(db, created.recipeId, owner.id, 'enable');
    const shareToken = shareTokenFor(db, created.recipeId);
    assert.ok(shareToken, 'expected a real share token');

    const logLines = [];
    const errorLines = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => {
      logLines.push(args.join(' '));
    };
    console.error = (...args) => {
      errorLines.push(args.join(' '));
    };

    try {
      const shareRes = await request(app).get(`/r/${shareToken}`);
      assert.equal(shareRes.status, 200);

      const shareUrl = `${config.publicBaseUrl}/r/${shareToken}?yield=6`;
      const throwawayApp = express();
      throwawayApp.get('/boom', (req, res, next) => {
        next(new Error(`Failed to notify Bring! about share link ${shareUrl}`));
      });
      throwawayApp.use(errorHandler({ isProduction: false }));

      const boomRes = await request(throwawayApp).get('/boom').set('Accept', 'application/json');
      assert.equal(boomRes.status, 500);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.ok(logLines.length > 0, 'expected the access log to have written at least one line');
    assert.ok(errorLines.length > 0, 'expected the error handler to have written to console.error');

    const everythingWritten = [...logLines, ...errorLines].join('\n');
    assert.ok(
      !everythingWritten.includes(shareToken),
      'the real share token must not appear anywhere in console.log or console.error output'
    );
  } finally {
    cleanup();
  }
});
