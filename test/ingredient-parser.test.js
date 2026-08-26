import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseIngredientLine } from '../src/domain/ingredient-parser.js';

const domainDir = fileURLToPath(new URL('../src/domain/', import.meta.url));

// [input, amount, amount_max, unit, name, note]
const CASES = [
  ['250 g Mehl', 250, null, 'g', 'Mehl', null],
  ['2 Eier', 2, null, null, 'Eier', null],
  ['1,5 EL Öl', 1.5, null, 'tbsp', 'Öl', null],
  ['1.5 EL Öl', 1.5, null, 'tbsp', 'Öl', null],
  ['1/2 TL Zucker', 0.5, null, 'tsp', 'Zucker', null],
  ['1 1/2 TL Zucker', 1.5, null, 'tsp', 'Zucker', null],
  ['½ TL Zucker', 0.5, null, 'tsp', 'Zucker', null],
  ['2-3 Äpfel', 2, 3, null, 'Äpfel', null],
  ['2 – 3 Äpfel', 2, 3, null, 'Äpfel', null],
  ['2 bis 3 Äpfel', 2, 3, null, 'Äpfel', null],
  ['200 g Mehl, gesiebt', 200, null, 'g', 'Mehl', 'gesiebt'],
  ['1,5 EL Öl, kalt', 1.5, null, 'tbsp', 'Öl', 'kalt'],
  ['Salz', null, null, null, 'Salz', null],
  ['Prise Salz', null, null, null, 'Prise Salz', null],
  ['1 Prise Salz', 1, null, 'pinch', 'Salz', null],
  ['2 Zehen Knoblauch', 2, null, 'clove', 'Knoblauch', null],
  ['1 Packung Hefe', 1, null, 'pack', 'Hefe', null],
  ['2 EL. Zucker', 2, null, 'tbsp', 'Zucker', null],
  ['250g Mehl', 250, null, 'g', 'Mehl', null],
  ['', null, null, null, '', null],
  ['   ', null, null, null, '', null],
  ['2 Schuss Milch', 2, null, null, 'Schuss Milch', null],
];

test('parseIngredientLine: field-by-field table', () => {
  for (const [input, amount, amount_max, unit, name, note] of CASES) {
    const result = parseIngredientLine(input);
    assert.equal(result.amount, amount, `${JSON.stringify(input)} .amount`);
    assert.equal(result.amount_max, amount_max, `${JSON.stringify(input)} .amount_max`);
    assert.equal(result.unit, unit, `${JSON.stringify(input)} .unit`);
    assert.equal(result.name, name, `${JSON.stringify(input)} .name`);
    assert.equal(result.note, note, `${JSON.stringify(input)} .note`);
  }
});

// Reference used only by the P6 property check below, kept independent of
// src/domain/ingredient-parser.js so this test does not just restate the
// implementation under test (same approach as scaling.test.js's
// expectedBandRound).
const KNOWN_UNIT_WORDS = new Set([
  'g', 'gramm', 'gr',
  'kg', 'kilo', 'kilogramm',
  'ml', 'milliliter',
  'l', 'liter',
  'tl', 'teel', 'teeloeffel', 'teelöffel', 'tsp',
  'el', 'essl', 'essloeffel', 'esslöffel', 'tbsp',
  'prise', 'prisen',
  'zehe', 'zehen',
  'scheibe', 'scheiben',
  'dose', 'dosen',
  'bund',
  'packung', 'pck', 'pkg',
  'stueck', 'stück', 'stk', 'piece',
  'can', 'clove', 'slice', 'bunch', 'pack', 'pinch',
]);

const QTY_PATTERNS = [
  /^\d+\s+\d+\/\d+/,
  /^\d+[ \t]?[½¼¾⅓⅔⅛]/,
  /^\d+\/\d+/,
  /^[½¼¾⅓⅔⅛]/,
  /^\d+(?:[.,]\d+)?/,
];

function stripOneQuantity(s) {
  for (const p of QTY_PATTERNS) {
    const m = p.exec(s);
    if (m) return s.slice(m[0].length);
  }
  return null;
}

function stripLeadingQuantity(s) {
  let rest = stripOneQuantity(s);
  if (rest === null) return s;
  const sepMatch = /^\s*[-–]\s*/.exec(rest) || /^\s+bis\s+/i.exec(rest);
  if (sepMatch) {
    const afterSep = rest.slice(sepMatch[0].length);
    const rest2 = stripOneQuantity(afterSep);
    if (rest2 !== null) rest = rest2;
  }
  return rest;
}

function wordsOf(s) {
  return (s.match(/[\p{L}\p{N}]+/gu) || []).map((w) => w.toLowerCase());
}

function expectedLeftoverWords(input) {
  const trimmed = input.trim();
  const afterQty = stripLeadingQuantity(trimmed);
  const commaIdx = afterQty.indexOf(',');
  let head = commaIdx === -1 ? afterQty : afterQty.slice(0, commaIdx);
  const tail = commaIdx === -1 ? '' : afterQty.slice(commaIdx + 1);
  head = head.trim();
  const tokenMatch = /^(\S+)/.exec(head);
  if (tokenMatch) {
    let t = tokenMatch[1].toLowerCase();
    if (t.endsWith('.')) t = t.slice(0, -1);
    if (KNOWN_UNIT_WORDS.has(t)) head = head.slice(tokenMatch[1].length);
  }
  return new Set([...wordsOf(head), ...wordsOf(tail)]);
}

test('[P6] no text is lost: name + note account for every non-quantity, non-unit word', () => {
  for (const [input] of CASES) {
    const result = parseIngredientLine(input);
    const actual = new Set([...wordsOf(result.name), ...wordsOf(result.note || '')]);
    const expected = expectedLeftoverWords(input);
    for (const word of expected) {
      assert.ok(
        actual.has(word),
        `${JSON.stringify(input)}: word "${word}" missing from name/note (got name=${JSON.stringify(result.name)}, note=${JSON.stringify(result.note)})`
      );
    }
  }
});

const HOSTILE_INPUTS = [
  '-',
  ',',
  '1/',
  '/2',
  '1,,2',
  '--',
  '1-',
  'bis',
  '½½',
  'a'.repeat(5000),
  '!@#$%^&*()_+=<>?',
];

test('[never throws] hostile inputs are handled without throwing', () => {
  for (const input of HOSTILE_INPUTS) {
    assert.doesNotThrow(() => parseIngredientLine(input), `input: ${JSON.stringify(input)}`);
    const result = parseIngredientLine(input);
    assert.equal(typeof result.name, 'string');
    assert.ok('amount' in result && 'amount_max' in result && 'unit' in result && 'note' in result);
  }
});

test('PURITY: ingredient-parser.js imports nothing outside ./units.js', () => {
  const src = fs.readFileSync(domainDir + 'ingredient-parser.js', 'utf8');
  const importSpecifiers = [...src.matchAll(/import\s[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(importSpecifiers, ['./units.js'], `ingredient-parser.js imports: ${importSpecifiers}`);
  assert.doesNotMatch(src, /\brequire\s*\(/, 'must not use require()');
  assert.doesNotMatch(src, /\bnode:/, 'must not reference node: builtins');
  assert.doesNotMatch(src, /\bprocess\b/, 'must not reference process');
  assert.doesNotMatch(src, /\bwindow\b/, 'must not reference window');
  assert.doesNotMatch(src, /\bdocument\b/, 'must not reference document');
  assert.doesNotMatch(src, /\bfs\./, 'must not reference fs');
});
