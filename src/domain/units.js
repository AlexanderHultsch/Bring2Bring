// Pure, dependency-free ES module. Runs unchanged in Node and in the browser
// (loaded as <script type="module">) — see SPECIFICATION.md section 4.1 and 7.
// No imports except from ./scaling.js are permitted here.

// UNITS is an object keyed by canonical unit key. Each entry:
//   key         canonical key (lowercase)
//   label       German display label ('' for 'piece' — "2 Eier", not "2 Stück Eier")
//   dimension   'mass' | 'volume' | 'spoon' | 'count' | 'pinch'
//   base        factor to express one of this unit in its dimension's base unit
//               (mass base is 'g', volume base is 'ml'; other dimensions have no
//               separate base unit, so base is always 1 there)
//   convertible whether scaling.js may auto-convert this unit to the dimension's
//               other unit (only mass <-> and volume <-> ever do)
//   numeric     whether this unit ever carries a displayed number (false only
//               for 'pinch', section 7.3 last row)
export const UNITS = {
  g: { key: 'g', label: 'g', dimension: 'mass', base: 1, convertible: true, numeric: true },
  kg: { key: 'kg', label: 'kg', dimension: 'mass', base: 1000, convertible: true, numeric: true },
  ml: { key: 'ml', label: 'ml', dimension: 'volume', base: 1, convertible: true, numeric: true },
  l: { key: 'l', label: 'l', dimension: 'volume', base: 1000, convertible: true, numeric: true },
  tsp: { key: 'tsp', label: 'TL', dimension: 'spoon', base: 1, convertible: false, numeric: true },
  tbsp: { key: 'tbsp', label: 'EL', dimension: 'spoon', base: 1, convertible: false, numeric: true },
  piece: { key: 'piece', label: '', dimension: 'count', base: 1, convertible: false, numeric: true },
  clove: { key: 'clove', label: 'Zehe', dimension: 'count', base: 1, convertible: false, numeric: true },
  slice: { key: 'slice', label: 'Scheibe', dimension: 'count', base: 1, convertible: false, numeric: true },
  can: { key: 'can', label: 'Dose', dimension: 'count', base: 1, convertible: false, numeric: true },
  bunch: { key: 'bunch', label: 'Bund', dimension: 'count', base: 1, convertible: false, numeric: true },
  pack: { key: 'pack', label: 'Packung', dimension: 'count', base: 1, convertible: false, numeric: true },
  pinch: { key: 'pinch', label: 'Prise', dimension: 'pinch', base: 1, convertible: false, numeric: false },
};

export function findUnit(key) {
  if (key === null || key === undefined) return undefined;
  return UNITS[String(key).toLowerCase()];
}

export function unitLabel(key) {
  if (key === null || key === undefined) return '';
  const unit = findUnit(key);
  return unit ? unit.label : key;
}

export function formatAmount(value, locale = 'de-DE') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(
    value
  );
}
