import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeFactor, scaleGroups } from '../src/domain/scaling.js';
import { buildRecipeJsonLd, buildBringDeeplinkUrl } from '../src/domain/recipe-jsonld.js';

const domainDir = fileURLToPath(new URL('../src/domain/', import.meta.url));
const BASE_URL = 'https://dishlist.example.com';

function ingredient(overrides = {}) {
  return {
    amount: null,
    amount_max: null,
    unit: null,
    name: 'Zutat',
    note: null,
    scales: 1,
    is_optional: 0,
    exclude_from_shopping: 0,
    ...overrides,
  };
}

function recipe(overrides = {}) {
  return {
    title: 'Testkuchen',
    yield_amount: 4,
    yield_unit: 'servings',
    yield_label: null,
    ...overrides,
  };
}

// scaleGroups' output already carries excludeFromShopping (scaling.js passes
// it through from each ingredient's exclude_from_shopping) — the same input
// src/routes/share.js now passes straight to buildRecipeJsonLd.
function scaledGroupsForJsonLd(groups, requestedYield, baseYield) {
  const factor = computeFactor(requestedYield, baseYield);
  return scaleGroups(groups, factor);
}

test('has @context https://schema.org and @type Recipe', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe(),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    requestedYield: 4,
    locale: 'de-DE',
  });
  assert.equal(jsonLd['@context'], 'https://schema.org');
  assert.equal(jsonLd['@type'], 'Recipe');
});

test('SPECIFICATION.md §8.4: the built object has EXACTLY these five keys, no more', () => {
  const groups = [
    {
      name: 'Base',
      ingredients: [ingredient({ amount: 250, unit: 'g', name: 'Mehl' })],
    },
  ];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe(),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    requestedYield: 4,
    locale: 'de-DE',
  });
  assert.deepEqual(
    Object.keys(jsonLd).sort(),
    ['@context', '@type', 'name', 'recipeIngredient', 'recipeYield'].sort()
  );
});

test('recipeYield reflects the REQUESTED yield, not the stored base yield', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe({ yield_amount: 4, yield_unit: 'servings' }),
    groups: scaledGroupsForJsonLd(groups, 6, 4),
    requestedYield: 6,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.recipeYield, '6 servings');
});

test('recipeYield uses yield_label when set, in place of yield_unit', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe({ yield_amount: 4, yield_unit: 'servings', yield_label: 'muffins' }),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    requestedYield: 4,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.recipeYield, '4 muffins');
});

test('description, image, recipeCategory, totalTime, prepTime, cookTime and recipeInstructions are not keys of the built object', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe(),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    requestedYield: 4,
    locale: 'de-DE',
  });
  assert.equal('description' in jsonLd, false);
  assert.equal('image' in jsonLd, false);
  assert.equal('recipeCategory' in jsonLd, false);
  assert.equal('totalTime' in jsonLd, false);
  assert.equal('prepTime' in jsonLd, false);
  assert.equal('cookTime' in jsonLd, false);
  assert.equal('recipeInstructions' in jsonLd, false);
});

test('recipeIngredient entries are flat strings equal to the `text` field of the corresponding scaled ingredient', () => {
  const groups = [
    {
      name: 'Base',
      ingredients: [
        ingredient({ amount: 250, unit: 'g', name: 'Mehl' }),
        ingredient({ amount: 2, unit: 'piece', name: 'Eier' }),
      ],
    },
  ];
  const factor = computeFactor(6, 4);
  const scaled = scaleGroups(groups, factor);
  const jsonLdGroups = scaledGroupsForJsonLd(groups, 6, 4);

  const jsonLd = buildRecipeJsonLd({
    recipe: recipe(),
    groups: jsonLdGroups,
    requestedYield: 6,
    locale: 'de-DE',
  });

  assert.deepEqual(
    jsonLd.recipeIngredient,
    scaled[0].ingredients.map((scaledIngredient) => scaledIngredient.text)
  );
  assert.ok(jsonLd.recipeIngredient.every((entry) => typeof entry === 'string'));
});

test('ACCEPTANCE 6: an ingredient with exclude_from_shopping = 1 is absent from recipeIngredient while still present in the input groups', () => {
  const groups = [
    {
      name: 'Base',
      ingredients: [
        ingredient({ amount: 250, unit: 'g', name: 'Mehl' }),
        ingredient({ amount: 1, unit: 'piece', name: 'Salz', exclude_from_shopping: 1 }),
      ],
    },
  ];
  const jsonLdGroups = scaledGroupsForJsonLd(groups, 4, 4);

  assert.equal(jsonLdGroups[0].ingredients.length, 2, 'the excluded ingredient is still present in the input groups');

  const jsonLd = buildRecipeJsonLd({
    recipe: recipe(),
    groups: jsonLdGroups,
    requestedYield: 4,
    locale: 'de-DE',
  });

  assert.equal(jsonLd.recipeIngredient.length, 1);
  assert.ok(!jsonLd.recipeIngredient.some((entry) => entry.includes('Salz')));
});

test('an ingredient with a null amount appears as just its name', () => {
  const groups = [
    {
      name: 'Base',
      ingredients: [ingredient({ amount: null, unit: null, name: 'Salz nach Geschmack' })],
    },
  ];
  const jsonLdGroups = scaledGroupsForJsonLd(groups, 4, 4);
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe(),
    groups: jsonLdGroups,
    requestedYield: 4,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.recipeIngredient[0], 'Salz nach Geschmack');
});

test('PURITY: recipe-jsonld.js imports nothing outside src/domain', () => {
  const src = fs.readFileSync(domainDir + 'recipe-jsonld.js', 'utf8');
  const importSpecifiers = [...src.matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(importSpecifiers.every((spec) => spec.startsWith('./')), `recipe-jsonld.js imports: ${importSpecifiers}`);
  assert.doesNotMatch(src, /\brequire\s*\(/, 'recipe-jsonld.js must not use require()');
  assert.doesNotMatch(src, /\bnode:/, 'recipe-jsonld.js must not reference node: builtins');
  assert.doesNotMatch(src, /\bprocess\b/, 'recipe-jsonld.js must not reference process');
  assert.doesNotMatch(src, /\bwindow\b/, 'recipe-jsonld.js must not reference window');
  assert.doesNotMatch(src, /\bdocument\b/, 'recipe-jsonld.js must not reference document');
  assert.doesNotMatch(src, /\bfs\./, 'recipe-jsonld.js must not reference fs');
});

test('ACCEPTANCE 5: the deeplink built for yield 6 carries baseQuantity=6, requestedQuantity=6 and a URL-encoded url parameter containing yield=6', () => {
  const deeplink = buildBringDeeplinkUrl({
    baseUrl: BASE_URL,
    token: 'the-token',
    requestedYield: 6,
  });

  const parsed = new URL(deeplink);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.getbring.com/rest/bringrecipes/deeplink');
  assert.equal(parsed.searchParams.get('baseQuantity'), '6');
  assert.equal(parsed.searchParams.get('requestedQuantity'), '6');
  // The single most important assertion in this task: the double-scaling
  // trap can never silently return.
  assert.equal(
    parsed.searchParams.get('baseQuantity'),
    parsed.searchParams.get('requestedQuantity')
  );

  const shareUrl = parsed.searchParams.get('url');
  assert.ok(shareUrl.includes('yield=6'));
  // The url parameter must be URL-encoded in the raw deeplink string, not
  // embedded as a literal, unescaped URL.
  assert.ok(deeplink.includes(`url=${encodeURIComponent(shareUrl)}`));
});

test("the deeplink's url parameter is absolute and starts with the configured PUBLIC_BASE_URL", () => {
  const deeplink = buildBringDeeplinkUrl({
    baseUrl: BASE_URL,
    token: 'the-token',
    requestedYield: 6,
  });
  const parsed = new URL(deeplink);
  const shareUrl = parsed.searchParams.get('url');
  assert.ok(shareUrl.startsWith(BASE_URL), `expected ${shareUrl} to start with ${BASE_URL}`);
  assert.equal(shareUrl, `${BASE_URL}/r/the-token?yield=6`);
});
