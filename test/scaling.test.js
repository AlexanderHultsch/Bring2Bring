import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeFactor, scaleIngredient, scaleGroups } from '../src/domain/scaling.js';
import { EDITOR_UNITS } from '../src/domain/units.js';

const domainDir = fileURLToPath(new URL('../src/domain/', import.meta.url));

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

// Reference implementation of the section 7.3 general rounding bands, kept
// separate from src/domain/scaling.js so these tests do not just restate the
// implementation under test.
function expectedBandRound(value) {
  if (value >= 100) return Math.round(value / 5) * 5;
  if (value >= 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

test('[acceptance] base yield 4, requested 6, ingredient 250 g -> 375 g', () => {
  const factor = computeFactor(6, 4);
  const result = scaleIngredient(ingredient({ amount: 250, unit: 'g', name: 'Mehl' }), factor);
  assert.equal(result.amount, 375);
  assert.equal(result.unit, 'g');
  assert.equal(result.scaled, true);
});

test('[acceptance] the same recipe\'s ingredient with scales = 0 is completely unchanged', () => {
  const factor = computeFactor(6, 4);
  const result = scaleIngredient(
    ingredient({ amount: 250, unit: 'g', name: 'Salz', scales: 0 }),
    factor
  );
  assert.equal(result.amount, 250);
  assert.equal(result.unit, 'g');
  assert.equal(result.scaled, false);
  assert.equal(result.exactAmount, 250);
  assert.equal(result.wasRounded, false);
});

test('7.2: 1500 g -> 1.5 kg', () => {
  const result = scaleIngredient(ingredient({ amount: 1500, unit: 'g' }), 1);
  assert.equal(result.amount, 1.5);
  assert.equal(result.unit, 'kg');
});

test('7.2: 2000 ml -> 2 l', () => {
  const result = scaleIngredient(ingredient({ amount: 2000, unit: 'ml' }), 1);
  assert.equal(result.amount, 2);
  assert.equal(result.unit, 'l');
});

test('7.2: 0.25 kg -> 250 g', () => {
  const result = scaleIngredient(ingredient({ amount: 0.25, unit: 'kg' }), 1);
  assert.equal(result.amount, 250);
  assert.equal(result.unit, 'g');
});

test('7.2: 0.5 l -> 500 ml', () => {
  const result = scaleIngredient(ingredient({ amount: 0.5, unit: 'l' }), 1);
  assert.equal(result.amount, 500);
  assert.equal(result.unit, 'ml');
});

test('7.2: 3.5 tbsp stays 3.5 with unit tbsp and label EL', () => {
  const result = scaleIngredient(ingredient({ amount: 3.5, unit: 'tbsp' }), 1);
  assert.equal(result.amount, 3.5);
  assert.equal(result.unit, 'tbsp');
  assert.equal(result.unitLabel, 'EL');
});

test('7.2: an unknown unit "Schuss" passes through untouched', () => {
  const result = scaleIngredient(ingredient({ amount: 2, unit: 'Schuss' }), 1);
  assert.equal(result.unit, 'Schuss');
  assert.equal(result.unitLabel, 'Schuss');
});

test('7.2: no input ever produces a unit from a different dimension', () => {
  const allowedByDimension = {
    mass: new Set(['g', 'kg']),
    volume: new Set(['ml', 'l']),
    spoon: new Set(['tsp', 'tbsp']),
    count: new Set(['piece', 'clove', 'slice', 'can', 'bunch', 'pack']),
  };
  const startingUnits = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'piece', 'clove'];
  const factors = [0.1, 0.5, 1, 1.5, 2, 3.7, 12];
  const amounts = [0.01, 1, 5, 50, 500, 5000];

  for (const unit of startingUnits) {
    const dimension = Object.keys(allowedByDimension).find((dim) =>
      allowedByDimension[dim].has(unit)
    );
    for (const factor of factors) {
      for (const amount of amounts) {
        const result = scaleIngredient(ingredient({ amount, unit }), factor);
        assert.ok(
          allowedByDimension[dimension].has(result.unit),
          `${unit} x${factor} @${amount} produced ${result.unit}, outside dimension ${dimension}`
        );
      }
    }
  }
});

test('[double-rounding guard] 1250 g stays exactly 1.25 kg, not 1.3 kg', () => {
  const result = scaleIngredient(ingredient({ amount: 1250, unit: 'g' }), 1);
  assert.equal(result.amount, 1.25);
  assert.notEqual(result.amount, 1.3);
  assert.equal(result.unit, 'kg');
});

test('[double-rounding guard] 1235 g stays 1235 g and is not converted to kg', () => {
  const result = scaleIngredient(ingredient({ amount: 1235, unit: 'g' }), 1);
  assert.equal(result.amount, 1235);
  assert.equal(result.unit, 'g');
});

test('[double-rounding guard] displayed quantity converted back to base equals the rounded base value exactly', () => {
  const grams = [3, 7, 15, 47, 88, 99, 100, 101, 150, 999, 1000, 1001, 1234, 1250, 1500, 2500, 7777, 12345];
  for (const value of grams) {
    const result = scaleIngredient(ingredient({ amount: value, unit: 'g' }), 1);
    const actualBase = result.unit === 'kg' ? result.amount * 1000 : result.amount;
    assert.equal(actualBase, expectedBandRound(value), `mismatch for ${value} g -> ${result.amount} ${result.unit}`);
  }
});

test('7.3 rounding bands: values within and at the boundaries of each band', () => {
  const cases = [
    [0.4, 0.4],
    [0.99, 0.99],
    [1, 1],
    [1.06, 1.1],
    [9.94, 9.9],
    [9.99, 10],
    [10, 10],
    [10.6, 11],
    [99, 99],
    [99.4, 99],
    [100, 100],
    [103, 105],
  ];
  for (const [input, expected] of cases) {
    const result = scaleIngredient(ingredient({ amount: input, unit: 'g' }), 1);
    assert.equal(result.amount, expected, `${input} g expected ${expected}, got ${result.amount}`);
    assert.equal(result.unit, 'g');
  }
});

test('count dimension: 2 eggs x1.5 -> 3', () => {
  const result = scaleIngredient(ingredient({ amount: 2, unit: 'piece', name: 'Eier' }), 1.5);
  assert.equal(result.amount, 3);
});

test('count dimension: 1 egg x0.5 -> 1', () => {
  const result = scaleIngredient(ingredient({ amount: 1, unit: 'piece', name: 'Ei' }), 0.5);
  assert.equal(result.amount, 1);
});

test('count dimension: an egg x0.1 -> 1, never below 1 and never 0', () => {
  const result = scaleIngredient(ingredient({ amount: 1, unit: 'piece', name: 'Ei' }), 0.1);
  assert.equal(result.amount, 1);
  assert.ok(result.amount >= 1);
  assert.notEqual(result.amount, 0);
});

test('REGRESSION (owner report): 1 egg at base yield 4 scales to a whole number across servings 1-8, never below 1', () => {
  const base = 4;
  const expected = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2 };
  for (const servings of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const factor = computeFactor(servings, base);
    const result = scaleIngredient(ingredient({ amount: 1, unit: 'piece', name: 'Ei' }), factor);
    assert.equal(Number.isInteger(result.amount), true, `${servings} servings gave ${result.amount}, not a whole number`);
    assert.ok(result.amount >= 1, `${servings} servings gave ${result.amount}, below the floor of 1`);
    assert.equal(result.amount, expected[servings], `${servings} servings expected ${expected[servings]}, got ${result.amount}`);
  }
});

test('count dimension: scaled far down, the raw value floors at 1 rather than 0 or a fraction', () => {
  const result = scaleIngredient(ingredient({ amount: 1, unit: 'piece', name: 'Ei' }), 0.01);
  assert.equal(result.amount, 1);
  assert.equal(Number.isInteger(result.amount), true);
});

test('count change is scoped to count: a gram amount still rounds by the mass thresholds, unaffected', () => {
  const result = scaleIngredient(ingredient({ amount: 1250, unit: 'g', name: 'Mehl' }), 1);
  assert.equal(result.amount, 1.25);
  assert.equal(result.unit, 'kg');
});

test('flags: isOptional and excludeFromShopping pass through as booleans, true when 1 and false when 0', () => {
  const factor = computeFactor(6, 4);
  const trueResult = scaleIngredient(
    ingredient({ amount: 250, unit: 'g', is_optional: 1, exclude_from_shopping: 1 }),
    factor
  );
  assert.equal(trueResult.isOptional, true);
  assert.equal(trueResult.excludeFromShopping, true);

  const falseResult = scaleIngredient(
    ingredient({ amount: 250, unit: 'g', is_optional: 0, exclude_from_shopping: 0 }),
    factor
  );
  assert.equal(falseResult.isOptional, false);
  assert.equal(falseResult.excludeFromShopping, false);
});

test('flags: isOptional and excludeFromShopping are present and correct on the no-amount branch', () => {
  const result = scaleIngredient(
    ingredient({ amount: null, name: 'Salz nach Geschmack', is_optional: 1, exclude_from_shopping: 1 }),
    2
  );
  assert.equal(result.isOptional, true);
  assert.equal(result.excludeFromShopping, true);
});

test('flags: isOptional and excludeFromShopping are present and correct on the pinch branch', () => {
  const result = scaleIngredient(
    ingredient({ amount: 1, unit: 'pinch', name: 'Salz', is_optional: 1, exclude_from_shopping: 1 }),
    5
  );
  assert.equal(result.isOptional, true);
  assert.equal(result.excludeFromShopping, true);
});

test('nulls: amount null stays null', () => {
  const result = scaleIngredient(ingredient({ amount: null, name: 'Salz nach Geschmack' }), 2);
  assert.equal(result.amount, null);
  assert.equal(result.amountMax, null);
  assert.equal(result.exactAmount, null);
  assert.equal(result.text, 'Salz nach Geschmack');
});

test('nulls: computeFactor falls back to 1 for factor-breaking inputs and never yields NaN', () => {
  const badPairs = [
    [0, 4],
    [-3, 4],
    [NaN, 4],
    [Infinity, 4],
    [6, 0],
    [6, -4],
    [6, NaN],
    [6, Infinity],
    [undefined, 4],
    [6, undefined],
  ];
  for (const [requested, base] of badPairs) {
    const factor = computeFactor(requested, base);
    assert.equal(factor, 1, `computeFactor(${requested}, ${base}) should fall back to 1`);
    const result = scaleIngredient(ingredient({ amount: 250, unit: 'g' }), factor);
    assert.ok(Number.isFinite(result.amount));
    assert.notEqual(Number.isNaN(result.amount), true);
  }
});

test('nulls: a pinch never gets a number', () => {
  const result = scaleIngredient(ingredient({ amount: 1, unit: 'pinch', name: 'Salz' }), 5);
  assert.equal(result.amount, null);
  assert.equal(result.unit, 'pinch');
  assert.equal(result.unitLabel, 'Prise');
  assert.equal(result.text, 'Prise Salz');
});

test('ranges: 2-3 apples x2 -> 4-6', () => {
  const result = scaleIngredient(
    ingredient({ amount: 2, amount_max: 3, unit: 'piece', name: 'Äpfel' }),
    2
  );
  assert.equal(result.amount, 4);
  assert.equal(result.amountMax, 6);
  assert.equal(result.text, '4-6 Äpfel');
});

test('ranges: a range that would split units ends in one unit', () => {
  const result = scaleIngredient(
    ingredient({ amount: 500, amount_max: 999, unit: 'g', name: 'Butter' }),
    1
  );
  assert.equal(result.amount, 500);
  assert.equal(result.amountMax, 1000);
  assert.equal(result.unit, 'g');
  assert.equal(result.text, '500-1000 g Butter');
});

test('D6: wasRounded is true when only the upper bound of a range differs after rounding', () => {
  const result = scaleIngredient(
    ingredient({ amount: 5, amount_max: 13.4, unit: 'g', name: 'Möhren' }),
    1
  );
  assert.equal(result.amount, 5);
  assert.equal(result.exactAmount, 5);
  assert.equal(result.amountMax, 13);
  assert.equal(result.exactAmountMax, 13.4);
  assert.equal(result.wasRounded, true);
});

test('text: no double spaces, no leading space, piece contributes no label', () => {
  const result = scaleIngredient(ingredient({ amount: 2, unit: 'piece', name: 'Eier' }), 1);
  assert.equal(result.text, '2 Eier');
  assert.doesNotMatch(result.text, /  /);
  assert.doesNotMatch(result.text, /^ /);
});

test('text: the note is appended after a comma', () => {
  const result = scaleIngredient(
    ingredient({ amount: 200, unit: 'g', name: 'Zucker', note: 'fein' }),
    1
  );
  assert.equal(result.text, '200 g Zucker, fein');
});

test('text: a range uses the unit once', () => {
  const result = scaleIngredient(
    ingredient({ amount: 2, amount_max: 3, unit: 'piece', name: 'Zwiebeln' }),
    1
  );
  assert.equal((result.text.match(/piece|Zwiebeln/g) || []).length, 1);
  assert.equal(result.text, '2-3 Zwiebeln');
});

test('scaleGroups maps scaleIngredient over the nested groups shape without mutating input', () => {
  const groups = [
    {
      id: 1,
      name: 'Teig',
      ingredients: [ingredient({ amount: 100, unit: 'g', name: 'Mehl' })],
    },
  ];
  const frozenIngredient = groups[0].ingredients[0];
  const result = scaleGroups(groups, 2);

  assert.equal(result[0].ingredients[0].amount, 200);
  assert.equal(result[0].name, 'Teig');
  assert.equal(groups[0].ingredients[0], frozenIngredient);
  assert.equal(groups[0].ingredients[0].amount, 100);
});

test('amountText: 1500 g scaled by 1 is "1,5 kg" under the default locale', () => {
  const result = scaleIngredient(ingredient({ amount: 1500, unit: 'g' }), 1);
  assert.equal(result.amountText, '1,5 kg');
});

test('amountText: 375 g is "375 g"', () => {
  const factor = computeFactor(6, 4);
  const result = scaleIngredient(ingredient({ amount: 250, unit: 'g' }), factor);
  assert.equal(result.amountText, '375 g');
});

test('amountText: a 2-3 range is "2-3" with no unit label duplication', () => {
  const result = scaleIngredient(
    ingredient({ amount: 2, amount_max: 3, unit: 'piece', name: 'Äpfel' }),
    1
  );
  assert.equal(result.amountText, '2-3');
});

test('amountText: locale "en-US" is "1.5 kg", proving the locale is honoured and not hard-coded', () => {
  const result = scaleIngredient(ingredient({ amount: 1500, unit: 'g' }), 1, { locale: 'en-US' });
  assert.equal(result.amountText, '1.5 kg');
});

test('amountText: null when the amount is null, and for a pinch', () => {
  const nullAmount = scaleIngredient(ingredient({ amount: null, name: 'Salz nach Geschmack' }), 2);
  assert.equal(nullAmount.amountText, null);

  const pinch = scaleIngredient(ingredient({ amount: 1, unit: 'pinch', name: 'Salz' }), 5);
  assert.equal(pinch.amountText, null);
});

test('exactText: null when wasRounded is false, and non-null when it is true', () => {
  const notRounded = scaleIngredient(ingredient({ amount: 3.5, unit: 'tbsp' }), 1);
  assert.equal(notRounded.wasRounded, false);
  assert.equal(notRounded.exactText, null);

  const rounded = scaleIngredient(ingredient({ amount: 5, amount_max: 13.4, unit: 'g', name: 'Möhren' }), 1);
  assert.equal(rounded.wasRounded, true);
  assert.notEqual(rounded.exactText, null);
});

test('text: still starts with amountText for a numeric ingredient, proving it is built from it', () => {
  const result = scaleIngredient(ingredient({ amount: 200, unit: 'g', name: 'Zucker' }), 1);
  assert.ok(result.text.startsWith(result.amountText));
});

test('V1: EDITOR_UNITS is exactly the nine keys/labels from section 7.2, in order', () => {
  assert.deepEqual(
    EDITOR_UNITS.map((unit) => unit.key),
    ['piece', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pinch', 'stueck']
  );
  assert.deepEqual(
    EDITOR_UNITS.map((unit) => unit.label),
    ['no unit', 'g', 'kg', 'ml', 'l', 'TL', 'EL', 'Prise', 'Stück']
  );
});

test('V1: stueck is a count-dimension unit that never converts and shows its own label', () => {
  const result = scaleIngredient(ingredient({ amount: 2, unit: 'stueck', name: 'Butter' }), 1.5);
  assert.equal(result.amount, 3);
  assert.equal(result.unit, 'stueck');
  assert.equal(result.unitLabel, 'Stück');
  assert.equal(result.text, '3 Stück Butter');
});

test('V1: stueck rounds like the other count unit, never below 1', () => {
  const result = scaleIngredient(ingredient({ amount: 1, unit: 'stueck', name: 'Zwiebel' }), 0.1);
  assert.equal(result.amount, 1);
});

test('PURITY: units.js, scaling.js and recipe-jsonld.js import nothing outside src/domain', () => {
  for (const file of ['units.js', 'scaling.js', 'recipe-jsonld.js']) {
    const src = fs.readFileSync(domainDir + file, 'utf8');
    const importSpecifiers = [...src.matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(importSpecifiers.every((spec) => spec.startsWith('./')), `${file} imports: ${importSpecifiers}`);
    assert.doesNotMatch(src, /\brequire\s*\(/, `${file} must not use require()`);
    assert.doesNotMatch(src, /\bnode:/, `${file} must not reference node: builtins`);
    assert.doesNotMatch(src, /\bprocess\b/, `${file} must not reference process`);
    assert.doesNotMatch(src, /\bwindow\b/, `${file} must not reference window`);
    assert.doesNotMatch(src, /\bdocument\b/, `${file} must not reference document`);
    assert.doesNotMatch(src, /\bfs\./, `${file} must not reference fs`);
  }
});
