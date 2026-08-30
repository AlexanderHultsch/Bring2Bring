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
const recipeViewPath = fileURLToPath(new URL('../public/js/recipe-view.js', import.meta.url));

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

  assert.ok(
    referencedIds.size >= 8,
    `expected at least 8 distinct icons referenced across the templates, found ${referencedIds.size}`
  );
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

test('GUARD: the pinned menu toggle sits above the menu overlay in the stacking order', () => {
  const css = fs.readFileSync(stylePath, 'utf8');

  const overlayMatch = css.match(/\.menu__overlay\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(overlayMatch, 'expected .menu__overlay to declare a z-index in style.css');

  const toggleMatch = css.match(/\.menu\[open\]\s*>\s*\.menu__toggle\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(toggleMatch, 'expected .menu[open] > .menu__toggle to declare a z-index in style.css');

  const overlayZIndex = Number(overlayMatch[1]);
  const toggleZIndex = Number(toggleMatch[1]);
  assert.ok(
    toggleZIndex > overlayZIndex,
    `the close control (z-index ${toggleZIndex}) must be painted above its own scrim (z-index ${overlayZIndex}), or it becomes unclickable`
  );
});

// SPECIFICATION.md L11 (v2.7): the arrow used to be a single diagonal
// straight through the leaf body (M4 20 20 4), which at icon size read as
// a leaf with a line through it — the universal "not allowed" symbol, on
// the button whose entire job is to invite a tap. This is a blunt check
// (it only proves the exact old strike path is gone, not that the new
// artwork is good — that was verified by rendering it), but it is honest
// about what it protects: a regression back to a shaft that spans the
// full diagonal of the viewBox and re-crosses the leaf.
test('GUARD: #i-bring no longer contains the old full-diagonal strike path', () => {
  const iconsSrc = fs.readFileSync(iconsPath, 'utf8');
  const symbolMatch = iconsSrc.match(/<symbol id="i-bring"[\s\S]*?<\/symbol>/);
  assert.ok(symbolMatch, 'expected an i-bring symbol in icons.ejs');
  assert.ok(
    !symbolMatch[0].includes('M4 20 20 4'),
    'i-bring must not draw its arrow as a single diagonal straight through the leaf body'
  );
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

// The servings drum's renderCylinder() runs on every animation frame
// scheduled from the scroll container's own 'scroll' handler. If it writes
// a layout-affecting style property (margin, width, height, top/left,
// padding, inset...), that write changes layout *inside the scroll
// container*, which fires another 'scroll' event, which schedules another
// frame, which writes it again — an infinite feedback loop. The symptom is
// invisible: scrollTop does not change and nothing visibly moves, so it
// looks fine on a desktop; on a phone it pins the CPU at one frame per
// frame forever. Only `transform` and `opacity` are compositor-only and
// safe to write from this handler; the taper that makes the drum read as a
// cylinder must be expressed as a transform (e.g. a horizontal scale), not
// a margin.
// M6 (v2.8): the accent is a light green in dark theme, so an accent-on-accent
// pill (the old .az-rail__letter--current just recoloured the text) would
// vanish. --color-accent-contrast exists precisely for text on an accent
// fill (the primary button already uses it) — named here so nobody
// "simplifies" the pill back to plain accent-on-accent and loses legibility
// in dark mode.
test('GUARD: the A-Z rail\'s current-letter pill uses --color-accent-contrast for text on a --color-accent background, for dark-mode legibility', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const currentMatch = css.match(/\.az-rail__letter--current\s*\{([^}]*)\}/);
  assert.ok(currentMatch, 'expected a .az-rail__letter--current rule in style.css');
  const rule = currentMatch[1];
  assert.match(rule, /color:\s*var\(--color-accent-contrast\)/, '.az-rail__letter--current must colour its text with var(--color-accent-contrast), not the accent itself');
  assert.match(rule, /background(?:-color)?:\s*var\(--color-accent\)\s*;/, '.az-rail__letter--current must fill its background with var(--color-accent)');
});

// M6 (v2.8): the rail's top offset is derived from the same tokens the
// header is built from (J5, v2.5) plus a spacing-scale gap. A
// --header-height token would be a second source of truth for a number the
// header already defines, which is how the rail and the header drifted
// apart in the first place.
test('GUARD: the A-Z rail\'s top stays a derived calc() of existing tokens, and no --header-height token exists', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const railMatch = css.match(/\.az-rail\s*\{([^}]*)\}/);
  assert.ok(railMatch, 'expected a .az-rail rule in style.css');
  const topMatch = railMatch[1].match(/top:\s*(calc\([^;]*\))\s*;/);
  assert.ok(topMatch, '.az-rail must position its top with a calc(...) expression');
  assert.match(topMatch[1], /var\(--space-4\)/);
  assert.match(topMatch[1], /var\(--min-tap-target\)/);
  assert.match(topMatch[1], /var\(--space-3\)/);
  assert.doesNotMatch(topMatch[1], /--header-height/);

  const tokensCss = fs.readFileSync(tokensPath, 'utf8');
  assert.doesNotMatch(tokensCss, /--header-height/, 'tokens.css must not gain a --header-height token');
});

test('GUARD: recipe-view.js never writes a layout-affecting style property from the per-frame drum render', () => {
  const src = fs.readFileSync(recipeViewPath, 'utf8');
  assert.doesNotMatch(
    src,
    /\.style\.(margin\w*|width|height|top|left|padding\w*|inset\w*)\s*=/,
    'recipe-view.js must not assign to a layout-affecting style property (it can re-trigger the scroll handler that scheduled it, looping forever)'
  );
});
