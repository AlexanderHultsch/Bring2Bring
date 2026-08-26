import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { findRecipeForWrite, loadRecipeAggregate, listRecipesForUser } from '../repositories/recipes.js';
import {
  YIELD_UNITS,
  createRecipe,
  updateRecipeFromForm,
  duplicateRecipe,
  archiveRecipe,
  hardDeleteRecipe,
  emptyFormValues,
  formValuesFromAggregate,
} from '../services/recipes.js';

function notFoundError() {
  const error = new Error('Not found');
  error.status = 404;
  return error;
}

function parseRecipeId(raw) {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function recipesRouter(db) {
  const router = express.Router();

  router.get('/', requireAuth(), (req, res) => {
    const showArchived = req.query.archived === '1';
    const recipes = showArchived
      ? listRecipesForUser(db, req.currentUser.id, { includeArchived: true }).filter(
          (recipe) => recipe.is_archived === 1
        )
      : listRecipesForUser(db, req.currentUser.id);

    res.render('recipes/list', { recipes, archived: showArchived });
  });

  router.get('/recipes/new', requireAuth(), (req, res) => {
    res.render('recipes/form', {
      mode: 'new',
      recipeId: null,
      values: emptyFormValues(),
      errors: [],
      yieldUnits: YIELD_UNITS,
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
        yieldUnits: YIELD_UNITS,
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

    res.render('recipes/show', {
      recipe: aggregate.recipe,
      groups: aggregate.groups,
      steps: aggregate.steps,
      saved,
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
      yieldUnits: YIELD_UNITS,
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
        yieldUnits: YIELD_UNITS,
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
