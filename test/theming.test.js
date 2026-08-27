import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createTestDb } from './helpers/db.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

const viewsDir = fileURLToPath(new URL('../src/views/', import.meta.url));
const iconsPath = path.join(viewsDir, 'partials', 'icons.ejs');
const tokensPath = fileURLToPath(new URL('../public/css/tokens.css', import.meta.url));
const stylePath = fileURLToPath(new URL('../public/css/style.css', import.meta.url));

const testEnv = () => ({
  SESSION_SECRET: 'a'.repeat(16),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'super-secret-password',
  PUBLIC_BASE_URL: 'https://dishlist.example.com',
  NODE_ENV: 'test',
});

async function withApp(fn) {
  const { db, cleanup } = createTestDb();
  try {
    const config = loadConfig(testEnv());
    const app = createApp({ db, config });
    await fn(app);
  } finally {
    cleanup();
  }
}

test('GET /login renders the icon sprite', async () => {
  await withApp(async (app) => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
    assert.match(res.text, /<symbol id="i-search"/);
  });
});

test('GUARD: every icon referenced in a template is defined as a symbol in icons.ejs', () => {
  const iconsSrc = fs.readFileSync(iconsPath, 'utf8');
  const definedIds = new Set(
    [...iconsSrc.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1])
  );
  assert.ok(definedIds.size > 0, 'expected icons.ejs to define at least one symbol');

  const referencedIds = new Set();
  for (const entry of fs.readdirSync(viewsDir, { recursive: true })) {
    if (!entry.endsWith('.ejs')) continue;
    const src = fs.readFileSync(path.join(viewsDir, entry), 'utf8');
    for (const m of src.matchAll(/href="#(i-[a-z-]+)"/g)) {
      referencedIds.add(m[1]);
    }
  }

  for (const id of referencedIds) {
    assert.ok(definedIds.has(id), `template references #${id} but icons.ejs defines no <symbol id="${id}">`);
  }
});

test('tokens.css contains only custom properties: every opening brace belongs to a :root or @media block', () => {
  const css = fs.readFileSync(tokensPath, 'utf8');
  const lines = css.split('\n');
  for (const line of lines) {
    if (!line.includes('{')) continue;
    const trimmed = line.trim();
    assert.match(
      trimmed,
      /^(:root|@media)/,
      `unexpected selector opening a rule in tokens.css: "${trimmed}"`
    );
  }
});

test('style.css has no literal hex colours or literal font-family names', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'style.css must reference colours only via var(--…)');

  const fontFamilyValues = [...css.matchAll(/font-family:\s*([^;]+);/gi)].map((m) => m[1].trim());
  assert.ok(fontFamilyValues.length > 0, 'expected at least one font-family declaration in style.css');
  for (const value of fontFamilyValues) {
    assert.match(value, /^var\(--[a-z-]+\)$/, `style.css must reference font families only via var(--…): "${value}"`);
  }
});
