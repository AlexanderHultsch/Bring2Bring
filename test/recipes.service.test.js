import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRecipesByInitial, parseRecipeForm } from '../src/services/recipes.js';

function recipe(title) {
  return { title };
}

function validRecipeBody(servings) {
  return {
    title: 'Tomato Soup',
    servings,
    ingredients: [{ name: 'Tomatoes', amount: '500', unit: 'g' }],
    method: 'Cook it.',
  };
}

// SPECIFICATION.md section 10.1/10.E: the A-Z rail groups by the title's
// first letter, German-normalised (Ä/Ö/Ü/ß fold to their base Latin letter,
// any other diacritic folds via NFD), with '#' first for anything that
// isn't A-Z after that.
test('groupRecipesByInitial groups Apfelküchle and Äpfel both under A', () => {
  const groups = groupRecipesByInitial([recipe('Apfelküchle'), recipe('Äpfel')]);
  assert.deepEqual(groups.map((g) => g.letter), ['A']);
  assert.deepEqual(
    groups[0].recipes.map((r) => r.title),
    ['Apfelküchle', 'Äpfel']
  );
});

test('groupRecipesByInitial groups Ölsardinen under O, Überbackenes under U, Straße under S', () => {
  const groups = groupRecipesByInitial([recipe('Ölsardinen'), recipe('Straße'), recipe('Überbackenes')]);
  assert.deepEqual(groups.map((g) => g.letter), ['O', 'S', 'U']);
});

test("groupRecipesByInitial groups '3-Käse-Nudeln' and '\"Nudeln\"' under '#', and '#' sorts first", () => {
  const groups = groupRecipesByInitial([recipe('"Nudeln"'), recipe('3-Käse-Nudeln'), recipe('Apfelküchle')]);
  assert.equal(groups[0].letter, '#');
  assert.deepEqual(
    groups[0].recipes.map((r) => r.title),
    ['"Nudeln"', '3-Käse-Nudeln']
  );
  assert.deepEqual(groups.map((g) => g.letter), ['#', 'A']);
});

test('groupRecipesByInitial returns an empty array for empty input, and omits letters with no recipes', () => {
  assert.deepEqual(groupRecipesByInitial([]), []);

  const groups = groupRecipesByInitial([recipe('Banana'), recipe('Zebra')]);
  assert.deepEqual(groups.map((g) => g.letter), ['B', 'Z']);
});

test('groupRecipesByInitial does not mutate the input array', () => {
  const recipes = [recipe('Banana'), recipe('Apple')];
  const snapshot = recipes.map((r) => ({ ...r }));

  groupRecipesByInitial(recipes);

  assert.deepEqual(recipes, snapshot);
  assert.equal(recipes[0].title, 'Banana');
  assert.equal(recipes[1].title, 'Apple');
});

test('groupRecipesByInitial preserves the input order within a group and does not re-sort it', () => {
  const groups = groupRecipesByInitial([recipe('Zitronenkuchen'), recipe('Zwiebelsuppe')]);
  assert.deepEqual(
    groups[0].recipes.map((r) => r.title),
    ['Zitronenkuchen', 'Zwiebelsuppe']
  );
});

// SPECIFICATION.md section 2.1 A3 / 7.4 (E7, v2.1): a recipe's own servings
// are validated as an integer in 1..10, the same bound the ?yield= control
// uses — one source of truth for the range, not two.
test('parseRecipeForm accepts servings 4 and stores it as the number 4', () => {
  const result = parseRecipeForm(validRecipeBody('4'));
  assert.equal(result.success, true);
  assert.equal(result.fields.yield_amount, 4);
});

test('parseRecipeForm accepts the inclusive bounds servings 1 and 10', () => {
  for (const servings of ['1', '10']) {
    const result = parseRecipeForm(validRecipeBody(servings));
    assert.equal(result.success, true, `servings ${servings}`);
    assert.equal(result.fields.yield_amount, Number(servings), `servings ${servings}`);
  }
});

test('parseRecipeForm rejects servings 11, above the bound', () => {
  const result = parseRecipeForm(validRecipeBody('11'));
  assert.equal(result.success, false);
});

test('parseRecipeForm rejects servings 0', () => {
  const result = parseRecipeForm(validRecipeBody('0'));
  assert.equal(result.success, false);
});

test('parseRecipeForm rejects a negative servings value', () => {
  const result = parseRecipeForm(validRecipeBody('-2'));
  assert.equal(result.success, false);
});

test('parseRecipeForm rejects a non-integer servings value inside the range', () => {
  const result = parseRecipeForm(validRecipeBody('4.5'));
  assert.equal(result.success, false);
});

test('parseRecipeForm rejects a non-numeric servings value', () => {
  const result = parseRecipeForm(validRecipeBody('abc'));
  assert.equal(result.success, false);
});

test('parseRecipeForm rejects an empty servings value', () => {
  const result = parseRecipeForm(validRecipeBody(''));
  assert.equal(result.success, false);
});

test('parseRecipeForm reports the servings bound in the error message, so a future bound change cannot silently pass', () => {
  const result = parseRecipeForm(validRecipeBody('11'));
  assert.equal(result.success, false);
  assert.ok(
    result.errors.some((message) => message.includes('between 1 and 10')),
    `expected an error mentioning "between 1 and 10", got: ${result.errors.join(', ')}`
  );
});

test('parseRecipeForm labels an out-of-range servings error with the form field name, not the database column', () => {
  const result = parseRecipeForm(validRecipeBody('11'));
  assert.equal(result.success, false);
  assert.ok(
    result.errors.some((message) => message === 'Servings must be a whole number between 1 and 10'),
    `expected an error equal to "Servings must be a whole number between 1 and 10", got: ${result.errors.join(', ')}`
  );
  assert.ok(
    !result.errors.some((message) => message.includes('yield_amount')),
    `expected no error mentioning "yield_amount", got: ${result.errors.join(', ')}`
  );
});
