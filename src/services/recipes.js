import { z } from 'zod';
import {
  insertRecipe,
  updateRecipe,
  replaceRecipeContent,
  setRecipeArchived,
  deleteRecipe,
  loadRecipeAggregate,
} from '../repositories/recipes.js';

export const YIELD_UNITS = ['servings', 'pieces', 'portions', 'glasses', 'liters'];

const COPYABLE_RECIPE_FIELDS = [
  'subtitle',
  'description',
  'yield_amount',
  'yield_unit',
  'yield_label',
  'prep_minutes',
  'cook_minutes',
  'total_minutes',
  'source_name',
  'source_url',
  'notes',
  'image_path',
];

const SCALAR_FIELD_KEYS = [
  'title',
  'subtitle',
  'description',
  'yield_amount',
  'yield_unit',
  'yield_label',
  'prep_minutes',
  'cook_minutes',
  'total_minutes',
  'source_name',
  'source_url',
  'notes',
];

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

function isChecked(value) {
  return value !== undefined && value !== null;
}

function emptyIngredientRow() {
  return {
    amount: '',
    amount_max: '',
    unit: '',
    name: '',
    note: '',
    scales: true,
    is_optional: false,
    exclude_from_shopping: false,
  };
}

const trimToNull = z.string().trim().transform((value) => (value === '' ? null : value));

const requiredYieldAmount = z.string().transform((raw, ctx) => {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(value) || value <= 0 || value > 10000) {
    ctx.addIssue({ code: 'custom', message: 'must be a positive number up to 10000' });
    return z.NEVER;
  }
  return value;
});

const optionalNonNegativeInteger = z.string().transform((raw, ctx) => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) {
    ctx.addIssue({ code: 'custom', message: 'must be a whole number' });
    return z.NEVER;
  }
  return Number(trimmed);
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
  subtitle: trimToNull,
  description: trimToNull,
  yield_amount: requiredYieldAmount,
  yield_unit: z.enum(YIELD_UNITS),
  yield_label: trimToNull,
  prep_minutes: optionalNonNegativeInteger,
  cook_minutes: optionalNonNegativeInteger,
  total_minutes: optionalNonNegativeInteger,
  source_name: trimToNull,
  source_url: trimToNull,
  notes: trimToNull,
});

function normalizeScalarFields(body) {
  const out = {};
  for (const key of SCALAR_FIELD_KEYS) {
    out[key] = asString(body?.[key]);
  }
  return out;
}

function parseIngredientRow(raw, context, issues) {
  const name = trimmedOrNull(raw?.name);
  if (name === null) return null;

  const amountResult = optionalNonNegativeAmount.safeParse(asString(raw?.amount));
  const amountMaxResult = optionalNonNegativeAmount.safeParse(asString(raw?.amount_max));

  if (!amountResult.success) {
    issues.push(`${context} amount: ${amountResult.error.issues[0].message}`);
  }
  if (!amountMaxResult.success) {
    issues.push(`${context} amount_max: ${amountMaxResult.error.issues[0].message}`);
  }

  return {
    name,
    amount: amountResult.success ? amountResult.data : null,
    amount_max: amountMaxResult.success ? amountMaxResult.data : null,
    unit: trimmedOrNull(raw?.unit),
    note: trimmedOrNull(raw?.note),
    scales: isChecked(raw?.scales) ? 1 : 0,
    is_optional: isChecked(raw?.is_optional) ? 1 : 0,
    exclude_from_shopping: isChecked(raw?.exclude_from_shopping) ? 1 : 0,
  };
}

function parseGroup(raw, groupIndex, issues) {
  const name = trimmedOrNull(raw?.name);
  const ingredients = toArray(raw?.ingredients)
    .map((row, ingredientIndex) =>
      parseIngredientRow(row, `Group ${groupIndex + 1}, ingredient ${ingredientIndex + 1}:`, issues)
    )
    .filter((row) => row !== null);

  if (name === null && ingredients.length === 0) return null;
  return { name, ingredients };
}

function parseStep(raw) {
  const text = trimmedOrNull(raw?.text);
  if (text === null) return null;
  return { text, section_title: trimmedOrNull(raw?.section_title) };
}

export function parseRecipeForm(body) {
  const issues = [];

  const scalarResult = RecipeFieldsSchema.safeParse(normalizeScalarFields(body));
  if (!scalarResult.success) {
    for (const issue of scalarResult.error.issues) {
      issues.push(`${issue.path.join('.')}: ${issue.message}`);
    }
  }

  const groups = toArray(body?.groups)
    .map((group, groupIndex) => parseGroup(group, groupIndex, issues))
    .filter((group) => group !== null);

  const steps = toArray(body?.steps)
    .map((step) => parseStep(step))
    .filter((step) => step !== null);

  if (issues.length > 0) {
    return { success: false, errors: issues };
  }

  return {
    success: true,
    fields: scalarResult.data,
    content: { groups, steps, tagIds: [] },
  };
}

export function rawFormValues(body) {
  const scalars = normalizeScalarFields(body);
  const groups = toArray(body?.groups).map((group) => ({
    name: asString(group?.name),
    ingredients: toArray(group?.ingredients).map((row) => ({
      amount: asString(row?.amount),
      amount_max: asString(row?.amount_max),
      unit: asString(row?.unit),
      name: asString(row?.name),
      note: asString(row?.note),
      scales: isChecked(row?.scales),
      is_optional: isChecked(row?.is_optional),
      exclude_from_shopping: isChecked(row?.exclude_from_shopping),
    })),
  }));
  const steps = toArray(body?.steps).map((step) => ({
    section_title: asString(step?.section_title),
    text: asString(step?.text),
  }));

  return {
    ...scalars,
    groups: groups.length > 0 ? groups : [{ name: '', ingredients: [emptyIngredientRow()] }],
    steps: steps.length > 0 ? steps : [{ section_title: '', text: '' }],
  };
}

export function emptyFormValues() {
  return {
    title: '',
    subtitle: '',
    description: '',
    yield_amount: '4',
    yield_unit: 'servings',
    yield_label: '',
    prep_minutes: '',
    cook_minutes: '',
    total_minutes: '',
    source_name: '',
    source_url: '',
    notes: '',
    groups: [{ name: '', ingredients: [emptyIngredientRow()] }],
    steps: [{ section_title: '', text: '' }],
  };
}

export function formValuesFromAggregate(aggregate) {
  const { recipe, groups, steps } = aggregate;

  return {
    title: recipe.title ?? '',
    subtitle: recipe.subtitle ?? '',
    description: recipe.description ?? '',
    yield_amount: recipe.yield_amount != null ? String(recipe.yield_amount) : '',
    yield_unit: recipe.yield_unit ?? 'servings',
    yield_label: recipe.yield_label ?? '',
    prep_minutes: recipe.prep_minutes != null ? String(recipe.prep_minutes) : '',
    cook_minutes: recipe.cook_minutes != null ? String(recipe.cook_minutes) : '',
    total_minutes: recipe.total_minutes != null ? String(recipe.total_minutes) : '',
    source_name: recipe.source_name ?? '',
    source_url: recipe.source_url ?? '',
    notes: recipe.notes ?? '',
    groups:
      groups.length > 0
        ? groups.map((group) => ({
            name: group.name ?? '',
            ingredients:
              group.ingredients.length > 0
                ? group.ingredients.map((ingredient) => ({
                    amount: ingredient.amount != null ? String(ingredient.amount) : '',
                    amount_max: ingredient.amount_max != null ? String(ingredient.amount_max) : '',
                    unit: ingredient.unit ?? '',
                    name: ingredient.name ?? '',
                    note: ingredient.note ?? '',
                    scales: !!ingredient.scales,
                    is_optional: !!ingredient.is_optional,
                    exclude_from_shopping: !!ingredient.exclude_from_shopping,
                  }))
                : [emptyIngredientRow()],
          }))
        : [{ name: '', ingredients: [emptyIngredientRow()] }],
    steps:
      steps.length > 0
        ? steps.map((step) => ({ section_title: step.section_title ?? '', text: step.text ?? '' }))
        : [{ section_title: '', text: '' }],
  };
}

export function createRecipe(db, ownerId, body) {
  const parsed = parseRecipeForm(body);
  if (!parsed.success) {
    return { success: false, errors: parsed.errors, values: rawFormValues(body) };
  }

  const recipe = insertRecipe(db, ownerId, parsed.fields);
  replaceRecipeContent(db, recipe.id, ownerId, parsed.content);
  return { success: true, recipeId: recipe.id };
}

export function updateRecipeFromForm(db, recipeId, actingUserId, body) {
  const parsed = parseRecipeForm(body);
  if (!parsed.success) {
    return { success: false, errors: parsed.errors, values: rawFormValues(body) };
  }

  updateRecipe(db, recipeId, actingUserId, parsed.fields);
  replaceRecipeContent(db, recipeId, actingUserId, parsed.content);
  return { success: true, recipeId };
}

export function duplicateRecipe(db, recipeId, actingUserId) {
  const aggregate = loadRecipeAggregate(db, recipeId, actingUserId);
  if (!aggregate) return { success: false };

  const { recipe, groups, steps } = aggregate;
  const fields = { title: `${recipe.title} (Copy)` };
  for (const column of COPYABLE_RECIPE_FIELDS) {
    fields[column] = recipe[column];
  }

  const created = insertRecipe(db, actingUserId, fields);
  replaceRecipeContent(db, created.id, actingUserId, {
    groups: groups.map((group) => ({
      name: group.name,
      ingredients: group.ingredients.map((ingredient) => ({
        amount: ingredient.amount,
        amount_max: ingredient.amount_max,
        unit: ingredient.unit,
        name: ingredient.name,
        note: ingredient.note,
        scales: ingredient.scales,
        is_optional: ingredient.is_optional,
        exclude_from_shopping: ingredient.exclude_from_shopping,
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
