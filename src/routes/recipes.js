import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  findRecipeForRead,
  findRecipeForWrite,
  loadRecipeAggregate,
  listRecipesForUser,
  listPublicRecipes,
} from '../repositories/recipes.js';
import { computeFactor, scaleGroups } from '../domain/scaling.js';
import { EDITOR_UNITS } from '../domain/units.js';
import { buildBringDeeplinkUrl } from '../domain/recipe-jsonld.js';
import {
  createRecipe,
  updateRecipeFromForm,
  duplicateRecipe,
  archiveRecipe,
  hardDeleteRecipe,
  emptyFormValues,
  formValuesFromAggregate,
  parseListOptions,
  parsePublicListOptions,
  parseYieldParam,
  groupRecipesByInitial,
} from '../services/recipes.js';
import { applyShareAction, ShareActionSchema } from '../services/sharing.js';
import { publishRecipe, unpublishRecipe, PublishActionSchema } from '../services/publishing.js';

function notFoundError() {
  const error = new Error('Not found');
  error.status = 404;
  return error;
}

function badRequestError() {
  const error = new Error('Bad request');
  error.status = 400;
  return error;
}

function parseRecipeId(raw) {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function recipesRouter(db, config) {
  const router = express.Router();

  router.get('/', requireAuth(), (req, res) => {
    const options = parseListOptions(req.query);
    const found = listRecipesForUser(db, req.currentUser.id, options);
    const recipes = options.includeArchived
      ? found.filter((recipe) => recipe.is_archived === 1)
      : found;
    // SPECIFICATION.md section 10.1/10.E: the A-Z rail and its sticky section
    // headers only make sense when the list is actually sorted A-Z — a
    // 'recent'/'updated' sort renders a flat list instead.
    const groups = options.sort === 'title' ? groupRecipesByInitial(recipes) : [];

    res.render('recipes/list', {
      recipes,
      groups,
      archived: options.includeArchived,
      sort: options.sort,
      search: options.search,
      matchIngredients: options.matchIngredients,
    });
  });

  // SPECIFICATION.md section 9 / 10.1 (v2.0, D1): the Public shelf — every
  // is_public recipe from every user, no ownership check beyond is_public = 1.
  router.get('/public', requireAuth(), (req, res) => {
    const options = parsePublicListOptions(req.query);
    const recipes = listPublicRecipes(db, options);
    const groups = options.sort === 'title' ? groupRecipesByInitial(recipes) : [];

    res.render('recipes/public', {
      recipes,
      groups,
      sort: options.sort,
      search: options.search,
    });
  });

  router.get('/recipes/new', requireAuth(), (req, res) => {
    res.render('recipes/form', {
      mode: 'new',
      recipeId: null,
      values: emptyFormValues(),
      errors: [],
      EDITOR_UNITS,
    });
  });

  router.post('/recipes', requireAuth(), (req, res) => {
    const result = createRecipe(db, req.currentUser.id, req.body);
    if (!result.success) {
      res.status(422).render('recipes/form', {
        mode: 'new',
        recipeId: null,
        values: result.values,
        errors: result.errors,
        EDITOR_UNITS,
      });
      return;
    }
    res.redirect(`/recipes/${result.recipeId}?saved=new`);
  });

  router.get('/recipes/:id', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const aggregate = loadRecipeAggregate(db, id, req.currentUser.id);
    if (!aggregate) {
      next(notFoundError());
      return;
    }

    const saved = req.query.saved === 'new' ? 'new' : req.query.saved === '1' ? '1' : '';
    const requestedYield = parseYieldParam(req.query, aggregate.recipe.yield_amount);
    const factor = computeFactor(requestedYield, aggregate.recipe.yield_amount);
    const scaledGroups = scaleGroups(aggregate.groups, factor, { locale: config.numberLocale });

    res.render('recipes/show', {
      recipe: aggregate.recipe,
      groups: aggregate.groups,
      scaledGroups,
      steps: aggregate.steps,
      saved,
      requestedYield,
      locale: config.numberLocale,
      publicBaseUrl: config.publicBaseUrl,
      isOwner: aggregate.recipe.owner_id === req.currentUser.id,
    });
  });

  router.get('/recipes/:id/edit', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const recipe = findRecipeForWrite(db, id, req.currentUser.id);
    if (!recipe) {
      next(notFoundError());
      return;
    }

    const aggregate = loadRecipeAggregate(db, id, req.currentUser.id);
    res.render('recipes/form', {
      mode: 'edit',
      recipeId: id,
      values: formValuesFromAggregate(aggregate),
      errors: [],
      EDITOR_UNITS,
    });
  });

  router.post('/recipes/:id', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const recipe = findRecipeForWrite(db, id, req.currentUser.id);
    if (!recipe) {
      next(notFoundError());
      return;
    }

    const result = updateRecipeFromForm(db, id, req.currentUser.id, req.body);
    if (!result.success) {
      res.status(422).render('recipes/form', {
        mode: 'edit',
        recipeId: id,
        values: result.values,
        errors: result.errors,
        EDITOR_UNITS,
      });
      return;
    }
    res.redirect(`/recipes/${id}?saved=1`);
  });

  router.post('/recipes/:id/duplicate', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const result = duplicateRecipe(db, id, req.currentUser.id);
    if (!result.success) {
      next(notFoundError());
      return;
    }
    res.redirect(`/recipes/${result.recipeId}`);
  });

  // SPECIFICATION.md section 9 / 5.1 (v2.0, D1): owner-only, exactly like
  // every other mutation in this file — findRecipeForWrite, 404 when it
  // returns undefined, no second access rule. publishRecipe/unpublishRecipe
  // do the actual write (and, for publish, also enable the share token —
  // §8.2, §10.1).
  router.post('/recipes/:id/publish', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const recipe = findRecipeForWrite(db, id, req.currentUser.id);
    if (!recipe) {
      next(notFoundError());
      return;
    }

    const parsed = PublishActionSchema.safeParse(req.body);
    if (!parsed.success) {
      next(badRequestError());
      return;
    }

    const result =
      parsed.data.action === 'publish'
        ? publishRecipe(db, id, req.currentUser.id)
        : unpublishRecipe(db, id, req.currentUser.id);
    if (!result.success) {
      next(notFoundError());
      return;
    }

    res.redirect(`/recipes/${id}`);
  });

  router.post('/recipes/:id/share/link', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const parsed = ShareActionSchema.safeParse(req.body);
    if (!parsed.success) {
      next(badRequestError());
      return;
    }

    const result = applyShareAction(db, id, req.currentUser.id, parsed.data.action);
    if (!result.success) {
      next(notFoundError());
      return;
    }

    res.redirect(`/recipes/${id}`);
  });

  // SPECIFICATION.md section 8.5 (v2.0, D4/D6): the Bring! deeplink is built
  // here, server-side, from a single ?yield=N — never client-side — so the
  // servings wheel and the exported quantities can never drift apart (the
  // double-scaling trap). Same read access as viewing the recipe (section
  // 5.1): findRecipeForRead, 404 when it returns undefined, no second rule.
  router.get('/recipes/:id/bring', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const recipe = findRecipeForRead(db, id, req.currentUser.id);
    if (!recipe) {
      next(notFoundError());
      return;
    }

    if (!recipe.share_enabled) {
      res.redirect(`/recipes/${id}`);
      return;
    }

    const requestedYield = parseYieldParam(req.query, recipe.yield_amount);
    const bringDeeplinkUrl = buildBringDeeplinkUrl({
      baseUrl: config.publicBaseUrl,
      token: recipe.share_token,
      requestedYield,
    });

    res.redirect(bringDeeplinkUrl);
  });

  router.post('/recipes/:id/delete', requireAuth(), (req, res, next) => {
    const id = parseRecipeId(req.params.id);
    if (id === null) {
      next(notFoundError());
      return;
    }

    const recipe = findRecipeForWrite(db, id, req.currentUser.id);
    if (!recipe) {
      next(notFoundError());
      return;
    }

    if (!recipe.is_archived) {
      archiveRecipe(db, id, req.currentUser.id);
      res.redirect(`/recipes/${id}`);
      return;
    }

    const deleted = hardDeleteRecipe(db, id, req.currentUser.id);
    if (!deleted) {
      next(notFoundError());
      return;
    }
    res.redirect('/');
  });

  return router;
}
