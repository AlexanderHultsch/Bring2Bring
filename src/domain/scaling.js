// Pure, dependency-free ES module. Runs unchanged in Node and in the browser
// (loaded as <script type="module">) — see SPECIFICATION.md section 4.1 and 7.
// No imports except from ./units.js are permitted here.

import { findUnit, unitLabel, formatAmount, displayFamily } from './units.js';

export function computeFactor(requestedYield, baseYield) {
  if (typeof requestedYield !== 'number' || typeof baseYield !== 'number') return 1;
  if (!Number.isFinite(requestedYield) || !Number.isFinite(baseYield)) return 1;
  if (requestedYield <= 0 || baseYield <= 0) return 1;
  return requestedYield / baseYield;
}

// Section 7.3/7.6: round once, in the unit the reader will actually see —
// g/ml under metric, oz/fl oz under imperial (whichever displayFamily
// resolved to `small`). Never called for a non-numeric unit ('pinch',
// 'piece' since P1, v2.11) — those return early in scaleIngredient, above.
function roundOnce(value, dimension) {
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
  const language = options.language ?? 'de';
  const system = options.system ?? 'metric';
  const name = ingredient?.name ?? '';
  const note = ingredient?.note ?? null;
  const rawUnit = ingredient?.unit ?? null;
  const unitEntry = findUnit(rawUnit);
  const dimension = unitEntry?.dimension;
  const scaled = Boolean(ingredient?.scales);
  const isOptional = Boolean(ingredient?.is_optional);
  const excludeFromShopping = Boolean(ingredient?.exclude_from_shopping);
  const hasAmount = ingredient?.amount !== null && ingredient?.amount !== undefined;
  // P1 (v2.11): re-keyed on the unit's own numeric flag rather than naming
  // the pinch dimension — this unit never carries a number, whichever one
  // it is. Supersedes N2 (v2.9)'s 'fixed' mechanism, which special-cased
  // 'piece' to carry a number that refused to scale or round; a unit with
  // no number has nothing to scale or round, so that special case is gone.
  const isNonNumeric = unitEntry?.numeric === false;

  if (!hasAmount || isNonNumeric) {
    const finalUnitKey = unitEntry ? unitEntry.key : rawUnit;
    const finalUnitLabel = unitLabel(rawUnit, language);
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
      isOptional,
      excludeFromShopping,
      text,
      amountText: null,
      exactText: null,
    };
  }

  const toBase = (value) => (unitEntry ? value * unitEntry.base : value);

  const family = unitEntry && unitEntry.convertible ? displayFamily(dimension, system) : undefined;

  const roundInDisplayUnit = (amount) => {
    const scaledAmount = amount * (scaled ? factor : 1);
    const baseAmount = toBase(scaledAmount);
    const roundingAmount = family ? baseAmount / family.small.base : baseAmount;
    const rounded = roundOnce(roundingAmount, dimension);
    return { roundingAmount, rounded };
  };

  const primary = roundInDisplayUnit(ingredient.amount);

  // The large-vs-small decision is made once, from the primary amount, and
  // reused for amount_max below — a range never splits across two units.
  let displayEntry = unitEntry;
  let useLarge = false;
  if (family) {
    const converted = primary.rounded / family.ratio;
    const exactlyRepresentable = Math.round(converted * 100) / 100 === converted;
    useLarge = primary.rounded >= family.ratio && exactlyRepresentable;
    displayEntry = useLarge ? family.large : family.small;
  }

  const finalizeAmount = ({ roundingAmount, rounded }) =>
    useLarge
      ? { finalAmount: rounded / family.ratio, exactAmount: roundingAmount / family.ratio }
      : { finalAmount: rounded, exactAmount: roundingAmount };

  const { finalAmount, exactAmount } = finalizeAmount(primary);

  const hasMax = ingredient.amount_max !== null && ingredient.amount_max !== undefined;
  let finalMax = null;
  let exactMax = null;
  if (hasMax) {
    const maxResult = finalizeAmount(roundInDisplayUnit(ingredient.amount_max));
    finalMax = maxResult.finalAmount;
    exactMax = maxResult.exactAmount;
  }

  const finalUnitKey = displayEntry ? displayEntry.key : rawUnit;
  const finalUnitLabel = displayEntry ? unitLabel(displayEntry.key, language) : unitLabel(rawUnit, language);
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
    isOptional,
    excludeFromShopping,
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
