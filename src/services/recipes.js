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

const MAX_YIELD = 1000;

// SPECIFICATION.md section 7.4: the server render must honour ?yield=N so the
// page is correct with JavaScript disabled. Anything invalid — missing, zero,
// negative, NaN, text, out of range — falls back to the recipe's own yield,
// never a 400.
export function parseYieldParam(query, baseYield) {
  const raw = query?.yield;
  if (typeof raw !== 'string') return baseYield;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0 || value > MAX_YIELD) return baseYield;
  return value;
}

export function parseListOptions(query) {
  const sort = LIST_SORTS.includes(query?.sort) ? query.sort : 'recent';

  return {
    includeArchived: query?.archived === '1',
    search: asString(query?.q),
    sort,
  };
}

function emptyIngredientRow() {
  return { amount: '', unit: '', name: '' };
}

// SPECIFICATION.md section 2.1 A3: a recipe has a numeric servings count and
// nothing else. Stored in the existing yield_amount column; yield_unit is
// always the constant 'servings' (section 5 schema note).
const requiredYieldAmount = z.string().transform((raw, ctx) => {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(value) || value <= 0 || value > 10000) {
    ctx.addIssue({ code: 'custom', message: 'must be a positive number up to 10000' });
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

const RecipeFieldsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: 'Title is required' })
    .max(200, { message: 'Title must be at most 200 characters' }),
  yield_amount: requiredYieldAmount,
});

// SPECIFICATION.md section 2.1 A1 / this task's V2: a row counts only if its
// name is non-blank after trimming; blank-name rows are dropped silently. A
// non-blank row's amount (blank -> NULL) and unit (must be one of
// EDITOR_UNITS) are validated — reject rather than coerce (section 11).
function parseIngredientsForm(rawIngredients, issues) {
  const parsed = [];

  toArray(rawIngredients).forEach((raw, index) => {
    const name = trimmedOrNull(raw?.name);
    if (name === null) return;

    const amountResult = optionalNonNegativeAmount.safeParse(asString(raw?.amount));
    if (!amountResult.success) {
      issues.push(`ingredient ${index + 1} amount: ${amountResult.error.issues[0].message}`);
    }

    const unit = trimmedOrNull(raw?.unit);
    if (unit === null || !EDITOR_UNIT_KEYS.has(unit)) {
      issues.push(`ingredient ${index + 1} unit: must be a valid unit`);
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
      issues.push(`${issue.path.join('.')}: ${issue.message}`);
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
    ingredients: [emptyIngredientRow()],
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

export function hardDeleteRecipe(db, recipeId, actingUserId) {
  return deleteRecipe(db, recipeId, actingUserId) > 0;
}
