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
    description: null,
    image_path: null,
    yield_amount: 4,
    yield_unit: 'servings',
    yield_label: null,
    prep_minutes: null,
    cook_minutes: null,
    total_minutes: null,
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
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(jsonLd['@context'], 'https://schema.org');
  assert.equal(jsonLd['@type'], 'Recipe');
});

test('recipeYield reflects the REQUESTED yield, not the stored base yield', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe({ yield_amount: 4, yield_unit: 'servings' }),
    groups: scaledGroupsForJsonLd(groups, 6, 4),
    steps: [],
    tags: [],
    requestedYield: 6,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.recipeYield, '6 servings');
});

test('recipeYield uses yield_label when set, in place of yield_unit', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe({ yield_amount: 4, yield_unit: 'servings', yield_label: 'muffins' }),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.recipeYield, '4 muffins');
});

test('totalTime, prepTime and cookTime render as ISO 8601 durations', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe({ total_minutes: 45, prep_minutes: 15, cook_minutes: 30 }),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.totalTime, 'PT45M');
  assert.equal(jsonLd.prepTime, 'PT15M');
  assert.equal(jsonLd.cookTime, 'PT30M');
});

test('totalTime, prepTime and cookTime are OMITTED (key absent, not null) when the column is null', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe({ total_minutes: null, prep_minutes: null, cook_minutes: null }),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal('totalTime' in jsonLd, false);
  assert.equal('prepTime' in jsonLd, false);
  assert.equal('cookTime' in jsonLd, false);
});

test('description and image are OMITTED when absent, description present when set', () => {
  const groups = [{ name: null, ingredients: [] }];
  const withoutThem = buildRecipeJsonLd({
    recipe: recipe(),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal('description' in withoutThem, false);
  assert.equal('image' in withoutThem, false);

  const withDescription = buildRecipeJsonLd({
    recipe: recipe({ description: 'Ein Klassiker.' }),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(withDescription.description, 'Ein Klassiker.');
});

test('image is built as an ABSOLUTE url from baseUrl + recipe.image_path', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe({ image_path: '/uploads/abc123.jpg' }),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.image, 'https://dishlist.example.com/uploads/abc123.jpg');
});

test('recipeCategory joins tag names with ", " and is omitted when there are none', () => {
  const groups = [{ name: null, ingredients: [] }];
  const withTags = buildRecipeJsonLd({
    recipe: recipe(),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [{ name: 'Dessert' }, { name: 'Vegetarian' }],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(withTags.recipeCategory, 'Dessert, Vegetarian');

  const withoutTags = buildRecipeJsonLd({
    recipe: recipe(),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal('recipeCategory' in withoutTags, false);
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
    steps: [],
    tags: [],
    requestedYield: 6,
    baseUrl: BASE_URL,
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
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
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
    steps: [],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.equal(jsonLd.recipeIngredient[0], 'Salz nach Geschmack');
});

test('recipeInstructions are HowToStep objects in order', () => {
  const groups = [{ name: null, ingredients: [] }];
  const jsonLd = buildRecipeJsonLd({
    recipe: recipe(),
    groups: scaledGroupsForJsonLd(groups, 4, 4),
    steps: [{ text: 'Ofen vorheizen.' }, { text: 'Teig mischen.' }],
    tags: [],
    requestedYield: 4,
    baseUrl: BASE_URL,
    locale: 'de-DE',
  });
  assert.deepEqual(jsonLd.recipeInstructions, [
    { '@type': 'HowToStep', text: 'Ofen vorheizen.' },
    { '@type': 'HowToStep', text: 'Teig mischen.' },
  ]);
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
