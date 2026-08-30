import { z } from 'zod';
import {
  insertRecipe,
  updateRecipe,
  replaceRecipeContent,
  setRecipeArchived,
  deleteRecipe,
  loadRecipeAggregate,
} from '../repositories/recipes.js';
import { EDITOR_UNITS } from '../domain/units.js';

export const LIST_SORTS = ['recent', 'title', 'updated'];
export const PUBLIC_LIST_SORTS = ['title', 'imports', 'recent'];

const EDITOR_UNIT_KEYS = new Set(EDITOR_UNITS.map((unit) => unit.key));

export function toArray(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    return Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => value[key]);
  }
  return [];
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function trimmedOrNull(value) {
  const trimmed = asString(value).trim();
  return trimmed === '' ? null : trimmed;
}

const MIN_YIELD = 1;
const MAX_YIELD = 10;

// SPECIFICATION.md section 7.4 (v2.0, D6): the servings control is a wheel of
// INTEGERS 1..10, so the server render must honour only that range — anything
// invalid (missing, zero, negative, non-integer, out of range, non-numeric)
// falls back to the recipe's own yield, never a 400. Shared by the recipe
// route and the public share route (section 8.5: the deeplink only ever
// carries a value from this same 1..10 wheel).
export function parseYieldParam(query, baseYield) {
  const raw = query?.yield;
  if (typeof raw !== 'string') return baseYield;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < MIN_YIELD || value > MAX_YIELD) return baseYield;
  return value;
}

// SPECIFICATION.md section 10.1: "Default sort is alphabetical" holds for
// My Dishes too now (v2.0, D5) — the A-Z rail and letter sections only make
// sense against that default, so an omitted/invalid ?sort= falls back to
// 'title', not 'recent'. 'recent' and 'updated' remain valid explicit sorts.
export function parseListOptions(query) {
  const sort = LIST_SORTS.includes(query?.sort) ? query.sort : 'title';

  return {
    includeArchived: query?.archived === '1',
    search: asString(query?.q),
    sort,
    // SPECIFICATION.md section 10.1/10.E: "Search box is title-first;
    // ingredient search is a secondary toggle beside it, not the default."
    matchIngredients: query?.ingredients === '1',
  };
}

// SPECIFICATION.md section 9 / 10.1 (v2.0, D1): the Public shelf's own sort
// options ('imports' | 'title' | 'recent') and query-param convention, kept
// separate from parseListOptions since the Public shelf has no archive state
// and its default sort is alphabetical, not recency.
export function parsePublicListOptions(query) {
  const sort = PUBLIC_LIST_SORTS.includes(query?.sort) ? query.sort : 'title';

  return {
    search: asString(query?.q),
    sort,
  };
}

const GERMAN_INITIAL_MAP = {
  Ä: 'A', ä: 'A',
  Ö: 'O', ö: 'O',
  Ü: 'U', ü: 'U',
  ß: 'S', ẞ: 'S',
};

function initialLetter(title) {
  const trimmed = (title ?? '').trim();
  if (trimmed === '') return '#';
  const first = [...trimmed][0];
  const mapped = GERMAN_INITIAL_MAP[first];
  if (mapped) return mapped;
  const stripped = first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return /^[A-Z]$/.test(stripped) ? stripped : '#';
}

// SPECIFICATION.md section 10.1/10.E: buckets recipes by the title's first
// letter for the A-Z rail and its sticky section headers, German-normalised
// (Ä/Ö/Ü/ß, and any other diacritic via NFD, fold to a base Latin letter) so
// the grouping matches how a German speaker expects it to sort. Anything
// left that isn't A-Z (digits, punctuation, emoji) groups under '#', which
// sorts first. `recipes` is assumed already sorted by title — this only
// buckets it into that order, it never re-sorts or mutates the input.
export function groupRecipesByInitial(recipes) {
  const buckets = new Map();
  for (const recipe of recipes) {
    const letter = initialLetter(recipe.title);
    if (!buckets.has(letter)) buckets.set(letter, []);
    buckets.get(letter).push(recipe);
  }

  const order = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];
  return order
    .filter((letter) => buckets.has(letter))
    .map((letter) => ({ letter, recipes: buckets.get(letter) }));
}

function emptyIngredientRow() {
  return { amount: '', unit: '', name: '' };
}

// SPECIFICATION.md section 2.1 A3 / 7.4 (E7, v2.1): a recipe has a numeric
// servings count and nothing else. Stored in the existing yield_amount
// column; yield_unit is always the constant 'servings' (section 5 schema
// note). Since v2.1, that count is bounded to the same MIN_YIELD..MAX_YIELD
// range as the ?yield= control (parseYieldParam above) — one source of truth
// for the range, not two — and must be a whole number.
const requiredYieldAmount = z.string().transform((raw, ctx) => {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (
    trimmed === '' ||
    !Number.isInteger(value) ||
    value < MIN_YIELD ||
    value > MAX_YIELD
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `must be a whole number between ${MIN_YIELD} and ${MAX_YIELD}`,
    });
    return z.NEVER;
  }
  return value;
});

const optionalNonNegativeAmount = z.string().transform((raw, ctx) => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    ctx.addIssue({ code: 'custom', message: 'must be a number' });
    return z.NEVER;
  }
  return value;
});

// The schema's field names are database column names (yield_amount); the
// form the user sees calls them Title and Servings, so validation errors
// must speak that language, not the column's.
const FIELD_LABELS = {
  title: 'Title',
  yield_amount: 'Servings',
};

const RecipeFieldsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: 'is required' })
    .max(200, { message: 'must be at most 200 characters' }),
  yield_amount: requiredYieldAmount,
});

// SPECIFICATION.md section 2.1 A1: a row counts only if its
// name is non-blank after trimming; blank-name rows are dropped silently. A
// non-blank row's amount (blank -> NULL) and unit (must be one of
// EDITOR_UNITS) are validated — reject rather than coerce (section 11).
// P1/P2 (v2.11): 'piece' (N.A.) carries no quantity at all — a submitted
// amount against it is discarded and stored as NULL, whatever was
// submitted, so a crafted POST cannot put one back (the editor's disabled
// field is the convenience, this is the rule).
function parseIngredientsForm(rawIngredients, issues) {
  const parsed = [];

  toArray(rawIngredients).forEach((raw, index) => {
    const name = trimmedOrNull(raw?.name);
    if (name === null) return;

    const unit = trimmedOrNull(raw?.unit);
    if (unit === null || !EDITOR_UNIT_KEYS.has(unit)) {
      issues.push(`ingredient ${index + 1} unit: must be a valid unit`);
    }

    if (unit === 'piece') {
      parsed.push({ name, amount: null, unit });
      return;
    }

    const amountResult = optionalNonNegativeAmount.safeParse(asString(raw?.amount));
    if (!amountResult.success) {
      issues.push(`ingredient ${index + 1} amount: ${amountResult.error.issues[0].message}`);
    }

    parsed.push({
      name,
      amount: amountResult.success ? amountResult.data : null,
      unit,
    });
  });

  if (parsed.length === 0) {
    issues.push('Add at least one ingredient.');
  }

  return parsed;
}

// Stored and shown exactly as typed: only the leading/trailing whitespace of
// the whole block is trimmed, internal line breaks and spacing survive.
function parseMethod(raw) {
  const trimmed = asString(raw).trim();
  return trimmed === '' ? null : trimmed;
}

export function parseRecipeForm(body) {
  const issues = [];

  const scalarResult = RecipeFieldsSchema.safeParse({
    title: asString(body?.title),
    yield_amount: asString(body?.servings),
  });
  if (!scalarResult.success) {
    for (const issue of scalarResult.error.issues) {
      const label = FIELD_LABELS[issue.path.join('.')] ?? issue.path.join('.');
      issues.push(`${label} ${issue.message}`);
    }
  }

  const ingredients = parseIngredientsForm(body?.ingredients, issues);
  const method = parseMethod(body?.method);

  if (issues.length > 0) {
    return { success: false, errors: issues };
  }

  return {
    success: true,
    fields: scalarResult.data,
    content: { ingredients, method },
  };
}

export function rawFormValues(body) {
  const ingredients = toArray(body?.ingredients).map((row) => ({
    amount: asString(row?.amount),
    unit: asString(row?.unit),
    name: asString(row?.name),
  }));

  return {
    title: asString(body?.title),
    servings: asString(body?.servings),
    ingredients: ingredients.length > 0 ? ingredients : [emptyIngredientRow()],
    method: asString(body?.method),
  };
}

export function emptyFormValues() {
  return {
    title: '',
    servings: '4',
    ingredients: [{ ...emptyIngredientRow(), unit: 'g' }],
    method: '',
  };
}

export function formValuesFromAggregate(aggregate) {
  const { recipe, groups, steps } = aggregate;
  const ingredients = (groups[0]?.ingredients ?? []).map((ingredient) => ({
    amount: ingredient.amount != null ? String(ingredient.amount) : '',
    unit: ingredient.unit ?? '',
    name: ingredient.name ?? '',
  }));

  return {
    title: recipe.title ?? '',
    servings: recipe.yield_amount != null ? String(recipe.yield_amount) : '',
    ingredients: ingredients.length > 0 ? ingredients : [emptyIngredientRow()],
    method: steps[0]?.text ?? '',
  };
}

export function createRecipe(db, ownerId, body) {
  const parsed = parseRecipeForm(body);
  if (!parsed.success) {
    return { success: false, errors: parsed.errors, values: rawFormValues(body) };
  }

  const { ingredients, method } = parsed.content;
  const fields = { title: parsed.fields.title, yield_amount: parsed.fields.yield_amount, yield_unit: 'servings' };

  const recipe = insertRecipe(db, ownerId, fields);
  replaceRecipeContent(db, recipe.id, ownerId, {
    groups: [{ name: null, ingredients }],
    steps: method !== null ? [{ text: method, section_title: null }] : [],
    tagIds: [],
  });
  return { success: true, recipeId: recipe.id };
}

export function updateRecipeFromForm(db, recipeId, actingUserId, body) {
  const parsed = parseRecipeForm(body);
  if (!parsed.success) {
    return { success: false, errors: parsed.errors, values: rawFormValues(body) };
  }

  const { ingredients, method } = parsed.content;
  const fields = { title: parsed.fields.title, yield_amount: parsed.fields.yield_amount, yield_unit: 'servings' };

  updateRecipe(db, recipeId, actingUserId, fields);
  replaceRecipeContent(db, recipeId, actingUserId, {
    groups: [{ name: null, ingredients }],
    steps: method !== null ? [{ text: method, section_title: null }] : [],
    tagIds: [],
  });
  return { success: true, recipeId };
}

export function duplicateRecipe(db, recipeId, actingUserId) {
  const aggregate = loadRecipeAggregate(db, recipeId, actingUserId);
  if (!aggregate) return { success: false };

  const { recipe, groups, steps } = aggregate;
  // Explicit allow-list, not a copy of `recipe`: this is also how the share
  // columns already stay off a duplicate (section 5.1, D2) — since v2.0 the
  // same reasoning excludes is_public and bring_import_count. A copy is
  // private and starts at zero imports.
  const fields = {
    title: `${recipe.title} (Copy)`,
    yield_amount: recipe.yield_amount,
    yield_unit: recipe.yield_unit,
  };

  const created = insertRecipe(db, actingUserId, fields);
  replaceRecipeContent(db, created.id, actingUserId, {
    groups: groups.map((group) => ({
      name: group.name,
      ingredients: group.ingredients.map((ingredient) => ({
        amount: ingredient.amount,
        unit: ingredient.unit,
        name: ingredient.name,
      })),
    })),
    steps: steps.map((step) => ({ text: step.text, section_title: step.section_title })),
    tagIds: [],
  });

  return { success: true, recipeId: created.id };
}

export function archiveRecipe(db, recipeId, actingUserId) {
  return setRecipeArchived(db, recipeId, actingUserId, true) > 0;
}

export function restoreRecipe(db, recipeId, actingUserId) {
  return setRecipeArchived(db, recipeId, actingUserId, false) > 0;
}

export function hardDeleteRecipe(db, recipeId, actingUserId) {
  return deleteRecipe(db, recipeId, actingUserId) > 0;
}
