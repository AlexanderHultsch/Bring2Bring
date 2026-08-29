// Pure, dependency-free ES module. Runs unchanged in Node and in the browser
// (loaded as <script type="module">) — see SPECIFICATION.md section 4.1 and 7.
// No imports except from ./scaling.js are permitted here.

// UNITS is an object keyed by canonical unit key. Each entry:
//   key         canonical key (lowercase)
//   labels      { de, en } display labels ('' for 'piece' — "2 Eier", not
//               "2 Stück Eier") — K3, section 7.5
//   dimension   'mass' | 'volume' | 'spoon' | 'count' | 'pinch'
//   base        factor to express one of this unit in its dimension's base unit
//               (mass base is 'g', volume base is 'ml'; other dimensions have no
//               separate base unit, so base is always 1 there)
//   convertible whether scaling.js may auto-convert this unit to the dimension's
//               other unit (only mass <-> and volume <-> ever do)
//   numeric     whether this unit ever carries a displayed number (false only
//               for 'pinch', section 7.3 last row)
export const UNITS = {
  g: { key: 'g', labels: { de: 'g', en: 'g' }, dimension: 'mass', base: 1, convertible: true, numeric: true },
  kg: { key: 'kg', labels: { de: 'kg', en: 'kg' }, dimension: 'mass', base: 1000, convertible: true, numeric: true },
  ml: { key: 'ml', labels: { de: 'ml', en: 'ml' }, dimension: 'volume', base: 1, convertible: true, numeric: true },
  l: { key: 'l', labels: { de: 'l', en: 'l' }, dimension: 'volume', base: 1000, convertible: true, numeric: true },
  tsp: { key: 'tsp', labels: { de: 'TL', en: 'tsp' }, dimension: 'spoon', base: 1, convertible: false, numeric: true },
  tbsp: { key: 'tbsp', labels: { de: 'EL', en: 'tbsp' }, dimension: 'spoon', base: 1, convertible: false, numeric: true },
  piece: { key: 'piece', labels: { de: '', en: '' }, dimension: 'count', base: 1, convertible: false, numeric: true },
  clove: { key: 'clove', labels: { de: 'Zehe', en: 'clove' }, dimension: 'count', base: 1, convertible: false, numeric: true },
  slice: { key: 'slice', labels: { de: 'Scheibe', en: 'slice' }, dimension: 'count', base: 1, convertible: false, numeric: true },
  can: { key: 'can', labels: { de: 'Dose', en: 'can' }, dimension: 'count', base: 1, convertible: false, numeric: true },
  bunch: { key: 'bunch', labels: { de: 'Bund', en: 'bunch' }, dimension: 'count', base: 1, convertible: false, numeric: true },
  pack: { key: 'pack', labels: { de: 'Packung', en: 'pack' }, dimension: 'count', base: 1, convertible: false, numeric: true },
  pinch: { key: 'pinch', labels: { de: 'Prise', en: 'pinch' }, dimension: 'pinch', base: 1, convertible: false, numeric: false },
  stueck: { key: 'stueck', labels: { de: 'Stück', en: 'pcs' }, dimension: 'count', base: 1, convertible: false, numeric: true },

  // Imperial display family (SPECIFICATION.md §7.6, K4, since v2.6):
  // display-only units, never stored in ingredients.unit and never offered
  // by EDITOR_UNITS — a recipe is always entered in metric. `base` is the
  // exact legal definition, grams per unit for mass / millilitres per unit
  // for volume, not an approximation.
  oz: { key: 'oz', labels: { de: 'oz', en: 'oz' }, dimension: 'mass', base: 28.349523125, convertible: true, numeric: true },
  lb: { key: 'lb', labels: { de: 'lb', en: 'lb' }, dimension: 'mass', base: 453.59237, convertible: true, numeric: true },
  floz: { key: 'floz', labels: { de: 'fl oz', en: 'fl oz' }, dimension: 'volume', base: 29.5735295625, convertible: true, numeric: true },
  qt: { key: 'qt', labels: { de: 'qt', en: 'qt' }, dimension: 'volume', base: 946.352946, convertible: true, numeric: true },
};

// Closed dropdown for the editor (SPECIFICATION.md section 7.2, v1.1): exactly
// these nine units, in this order. 'labels' here are the dropdown's own
// labels for the option — for 'piece' that is "no unit" / "ohne Einheit",
// distinct from the unit's own display label (UNITS.piece.labels ===
// { de: '', en: '' }), which is what renders next to the ingredient amount
// ("2 Eier", not "2 no unit Eier").
export const EDITOR_UNITS = [
  { key: 'piece', labels: { de: 'ohne Einheit', en: 'no unit' } },
  { key: 'g', labels: { de: 'g', en: 'g' } },
  { key: 'kg', labels: { de: 'kg', en: 'kg' } },
  { key: 'ml', labels: { de: 'ml', en: 'ml' } },
  { key: 'l', labels: { de: 'l', en: 'l' } },
  { key: 'tsp', labels: { de: 'TL', en: 'tsp' } },
  { key: 'tbsp', labels: { de: 'EL', en: 'tbsp' } },
  { key: 'pinch', labels: { de: 'Prise', en: 'pinch' } },
  { key: 'stueck', labels: { de: 'Stück', en: 'pcs' } },
];

// Display families for §7.6: metric's own family is included so callers do
// not need a separate branch for the default system. `ratio` is written as
// a literal integer rather than derived from large.base / small.base. Both
// divisions happen to be exact in IEEE-754 today — that was measured, not
// assumed — but scaling.js tests the result for exact representability, so
// the literal keeps that check safe from any future edit to a base factor.
const DISPLAY_FAMILIES = {
  metric: {
    mass: { small: UNITS.g, large: UNITS.kg, ratio: 1000 },
    volume: { small: UNITS.ml, large: UNITS.l, ratio: 1000 },
  },
  imperial: {
    mass: { small: UNITS.oz, large: UNITS.lb, ratio: 16 },
    volume: { small: UNITS.floz, large: UNITS.qt, ratio: 32 },
  },
};

export function findUnit(key) {
  if (key === null || key === undefined) return undefined;
  return UNITS[String(key).toLowerCase()];
}

export function unitLabel(key, language = 'de') {
  if (key === null || key === undefined) return '';
  const unit = findUnit(key);
  if (!unit) return key;
  const lang = language === 'en' ? 'en' : 'de';
  return unit.labels[lang];
}

// SPECIFICATION.md §7.6: the display unit family for a dimension under a
// given measurement system. Returns undefined for dimensions with no
// imperial/metric family (spoon, count, pinch, and anything unknown).
export function displayFamily(dimension, system = 'metric') {
  const families = DISPLAY_FAMILIES[system] ?? DISPLAY_FAMILIES.metric;
  return families[dimension];
}

// SPECIFICATION.md §7.3/§7.5, K6: the decimal separator follows the reader's
// unit language, not a fixed default — 'en' always gets 'en-US' (period);
// every other language resolves to `fallback` rather than a literal 'de-DE'
// because NUMBER_LOCALE (§3) stays configurable, and the German default is
// whatever that config resolves to, so the caller supplies it.
export function numberLocaleFor(language, fallback = 'de-DE') {
  return language === 'en' ? 'en-US' : fallback;
}

export function formatAmount(value, locale = 'de-DE') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(
    value
  );
}
