// Pure, dependency-free ES module. Runs unchanged in Node and in the browser
// (loaded as <script type="module"> from the editor's quick-add line) — see
// SPECIFICATION.md section 2.1 (A1) and 4.1.
// No imports except from ./units.js are permitted here.

import { UNITS } from './units.js';

// Explicit aliases beyond each unit's canonical key and German label
// (section A1 / editor quick-add — see the parser's binding rules).
const UNIT_ALIASES = {
  gramm: 'g',
  gr: 'g',
  kilo: 'kg',
  kilogramm: 'kg',
  milliliter: 'ml',
  liter: 'l',
  tl: 'tsp',
  teel: 'tsp',
  teeloeffel: 'tsp',
  teelöffel: 'tsp',
  el: 'tbsp',
  essl: 'tbsp',
  essloeffel: 'tbsp',
  esslöffel: 'tbsp',
  prise: 'pinch',
  prisen: 'pinch',
  zehe: 'clove',
  zehen: 'clove',
  scheibe: 'slice',
  scheiben: 'slice',
  dose: 'can',
  dosen: 'can',
  bund: 'bunch',
  packung: 'pack',
  pck: 'pack',
  pkg: 'pack',
  stueck: 'piece',
  stück: 'piece',
  stk: 'piece',
};

const UNIT_LOOKUP = (() => {
  const lookup = {};
  for (const entry of Object.values(UNITS)) {
    lookup[entry.key.toLowerCase()] = entry.key;
    if (entry.label) lookup[entry.label.toLowerCase()] = entry.key;
  }
  for (const [alias, key] of Object.entries(UNIT_ALIASES)) {
    lookup[alias] = key;
  }
  return lookup;
})();

const UNICODE_FRACTIONS = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
};
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

const ASCII_MIXED_RE = new RegExp(`^(\\d+)\\s+(\\d+)\\/(\\d+)`);
const UNICODE_MIXED_RE = new RegExp(`^(\\d+)[ \\t]?([${UNICODE_FRACTION_CHARS}])`);
const ASCII_FRACTION_RE = new RegExp(`^(\\d+)\\/(\\d+)`);
const UNICODE_SINGLE_RE = new RegExp(`^([${UNICODE_FRACTION_CHARS}])`);
const PLAIN_NUMBER_RE = /^(\d+(?:[.,]\d+)?)/;

const DASH_SEP_RE = /^\s*[-–]\s*/;
const BIS_SEP_RE = /^\s+bis\s+/i;

function parsePlainNumber(text) {
  return parseFloat(text.replace(',', '.'));
}

// Matches a single (non-range) quantity at the start of `s`. Returns
// { value, length } or null.
function matchSingleQuantity(s) {
  let m = ASCII_MIXED_RE.exec(s);
  if (m) {
    const den = parseInt(m[3], 10);
    if (den !== 0) {
      return { value: parseInt(m[1], 10) + parseInt(m[2], 10) / den, length: m[0].length };
    }
  }
  m = UNICODE_MIXED_RE.exec(s);
  if (m) {
    return { value: parseInt(m[1], 10) + UNICODE_FRACTIONS[m[2]], length: m[0].length };
  }
  m = ASCII_FRACTION_RE.exec(s);
  if (m) {
    const den = parseInt(m[2], 10);
    if (den !== 0) {
      return { value: parseInt(m[1], 10) / den, length: m[0].length };
    }
  }
  m = UNICODE_SINGLE_RE.exec(s);
  if (m) {
    return { value: UNICODE_FRACTIONS[m[1]], length: m[0].length };
  }
  m = PLAIN_NUMBER_RE.exec(s);
  if (m) {
    return { value: parsePlainNumber(m[1]), length: m[0].length };
  }
  return null;
}

// Matches a leading quantity, plain or a range, at the start of `s`. Returns
// { amount, amount_max, length } or null when `s` has no leading quantity.
function parseLeadingQuantity(s) {
  const first = matchSingleQuantity(s);
  if (!first) return null;

  const afterFirst = s.slice(first.length);
  const dashMatch = DASH_SEP_RE.exec(afterFirst);
  const bisMatch = !dashMatch ? BIS_SEP_RE.exec(afterFirst) : null;
  const sep = dashMatch || bisMatch;

  if (sep) {
    const afterSep = afterFirst.slice(sep[0].length);
    const second = matchSingleQuantity(afterSep);
    if (second) {
      return {
        amount: first.value,
        amount_max: second.value,
        length: first.length + sep[0].length + second.length,
      };
    }
  }

  return { amount: first.value, amount_max: null, length: first.length };
}

function matchUnit(token) {
  if (!token) return null;
  let t = token.toLowerCase();
  if (t.endsWith('.')) t = t.slice(0, -1);
  if (!t) return null;
  return UNIT_LOOKUP[t] ?? null;
}

function collapseWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

export function parseIngredientLine(line) {
  const raw = typeof line === 'string' ? line : line == null ? '' : String(line);
  const trimmed = raw.trim();

  if (trimmed === '') {
    return { amount: null, amount_max: null, unit: null, name: '', note: null };
  }

  // P4: find the note-splitting comma, skipping over one that is part of the
  // leading quantity itself (the German decimal separator, e.g. "1,5 EL Öl").
  const leadingQty = parseLeadingQuantity(trimmed);
  const quantityEnd = leadingQty ? leadingQty.length : 0;
  const commaIdx = trimmed.indexOf(',', quantityEnd);

  let mainPart;
  let note;
  if (commaIdx === -1) {
    mainPart = trimmed;
    note = null;
  } else {
    mainPart = trimmed.slice(0, commaIdx).trim();
    const noteRaw = trimmed.slice(commaIdx + 1).trim();
    note = noteRaw === '' ? null : noteRaw;
  }

  const qty = parseLeadingQuantity(mainPart);
  let amount = null;
  let amount_max = null;
  let rest = mainPart;

  if (qty) {
    amount = qty.amount;
    amount_max = qty.amount_max;
    rest = mainPart.slice(qty.length).replace(/^\s+/, '');
  }

  let unit = null;
  if (qty) {
    const tokenMatch = /^(\S+)/.exec(rest);
    if (tokenMatch) {
      const canonical = matchUnit(tokenMatch[1]);
      if (canonical) {
        unit = canonical;
        rest = rest.slice(tokenMatch[1].length);
      }
    }
  }

  const name = collapseWhitespace(rest);

  return { amount, amount_max, unit, name, note };
}
