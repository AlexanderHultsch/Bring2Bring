import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRecipesByInitial } from '../src/services/recipes.js';

function recipe(title) {
  return { title };
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
