// Pure, dependency-free ES module. Runs unchanged in Node and in the browser
// (loaded as <script type="module">) — see SPECIFICATION.md section 4.1 and 7.
// No imports except from ./units.js are permitted here.

import { UNITS, findUnit, unitLabel, formatAmount } from './units.js';

export function computeFactor(requestedYield, baseYield) {
  if (typeof requestedYield !== 'number' || typeof baseYield !== 'number') return 1;
  if (!Number.isFinite(requestedYield) || !Number.isFinite(baseYield)) return 1;
  if (requestedYield <= 0 || baseYield <= 0) return 1;
  return requestedYield / baseYield;
}

function baseUnitKeyForDimension(dimension) {
  for (const entry of Object.values(UNITS)) {
    if (entry.dimension === dimension && entry.base === 1) return entry.key;
  }
  return undefined;
}

function largeUnitKeyForDimension(dimension) {
  for (const entry of Object.values(UNITS)) {
    if (entry.dimension === dimension && entry.convertible && entry.base !== 1) return entry.key;
  }
  return undefined;
}

// Section 7.3: round once, in the dimension's base unit. Never called for 'pinch'.
function roundInBase(value, dimension) {
  if (dimension === 'count') {
    return Math.max(Math.round(value * 2) / 2, 0.5);
  }
  if (value >= 100) return Math.round(value / 5) * 5;
  if (value >= 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function buildText({ amountAndUnit, name, note }) {
  const parts = [];
  if (amountAndUnit) parts.push(amountAndUnit);
  if (name) parts.push(name);
  const base = parts.join(' ');
  if (!note) return base;
  return base === '' ? note : `${base}, ${note}`;
}

export function scaleIngredient(ingredient, factor, options = {}) {
  const locale = options.locale ?? 'de-DE';
  const name = ingredient?.name ?? '';
  const note = ingredient?.note ?? null;
  const rawUnit = ingredient?.unit ?? null;
  const unitEntry = findUnit(rawUnit);
  const dimension = unitEntry?.dimension;
  const scaled = Boolean(ingredient?.scales);
  const effectiveFactor = scaled ? factor : 1;

  const hasAmount = ingredient?.amount !== null && ingredient?.amount !== undefined;
  const isPinch = dimension === 'pinch';

  if (!hasAmount || isPinch) {
    const finalUnitKey = unitEntry ? unitEntry.key : rawUnit;
    const finalUnitLabel = unitLabel(rawUnit);
    const text = buildText({ amountAndUnit: finalUnitLabel, name, note });
    return {
      amount: null,
      amountMax: null,
      unit: finalUnitKey,
      unitLabel: finalUnitLabel,
      exactAmount: null,
      exactAmountMax: null,
      wasRounded: false,
      scaled,
      text,
      amountText: null,
      exactText: null,
    };
  }

  const toBase = (value) => (unitEntry ? value * unitEntry.base : value);
  const fromBase = (value, entry) => (entry ? value / entry.base : value);

  const scaledAmount = ingredient.amount * effectiveFactor;
  const baseAmount = toBase(scaledAmount);
  const roundedBaseAmount = roundInBase(baseAmount, dimension);

  let displayEntry = unitEntry;
  if (unitEntry && unitEntry.convertible) {
    const largeEntry = UNITS[largeUnitKeyForDimension(dimension)];
    const converted = roundedBaseAmount / largeEntry.base;
    const exactlyRepresentable = Math.round(converted * 100) / 100 === converted;
    displayEntry =
      roundedBaseAmount >= 1000 && exactlyRepresentable
        ? largeEntry
        : UNITS[baseUnitKeyForDimension(dimension)];
  }

  const finalAmount = fromBase(roundedBaseAmount, displayEntry);
  const exactAmount = fromBase(baseAmount, displayEntry);

  const hasMax = ingredient.amount_max !== null && ingredient.amount_max !== undefined;
  let finalMax = null;
  let exactMax = null;
  if (hasMax) {
    const scaledMax = ingredient.amount_max * effectiveFactor;
    const baseMax = toBase(scaledMax);
    const roundedBaseMax = roundInBase(baseMax, dimension);
    finalMax = fromBase(roundedBaseMax, displayEntry);
    exactMax = fromBase(baseMax, displayEntry);
  }

  const finalUnitKey = displayEntry ? displayEntry.key : rawUnit;
  const finalUnitLabel = displayEntry ? displayEntry.label : unitLabel(rawUnit);
  const wasRounded = finalAmount !== exactAmount || (hasMax && finalMax !== exactMax);

  const amountPart =
    hasMax && finalMax !== null
      ? `${formatAmount(finalAmount, locale)}-${formatAmount(finalMax, locale)}`
      : formatAmount(finalAmount, locale);
  const amountText = [amountPart, finalUnitLabel].filter(Boolean).join(' ');

  const exactAmountPart =
    hasMax && exactMax !== null
      ? `${formatAmount(exactAmount, locale)}-${formatAmount(exactMax, locale)}`
      : formatAmount(exactAmount, locale);
  const exactText = wasRounded ? [exactAmountPart, finalUnitLabel].filter(Boolean).join(' ') : null;

  const text = buildText({ amountAndUnit: amountText, name, note });

  return {
    amount: finalAmount,
    amountMax: finalMax,
    unit: finalUnitKey,
    unitLabel: finalUnitLabel,
    exactAmount,
    exactAmountMax: hasMax ? exactMax : null,
    wasRounded,
    scaled,
    text,
    amountText,
    exactText,
  };
}

export function scaleGroups(groups, factor, options = {}) {
  return (groups ?? []).map((group) => ({
    ...group,
    ingredients: (group.ingredients ?? []).map((ingredient) =>
      scaleIngredient(ingredient, factor, options)
    ),
  }));
}
