import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { findRecipeByShareToken, loadRecipeContentById } from '../repositories/recipes.js';
import { computeFactor, scaleGroups } from '../domain/scaling.js';
import { buildRecipeJsonLd, serializeJsonLdForScriptTag } from '../domain/recipe-jsonld.js';
import { parseYieldParam } from '../services/recipes.js';

function notFoundError() {
  const error = new Error('Not found');
  error.status = 404;
  return error;
}

// SPECIFICATION.md section 8.3: generous on purpose — it protects the Pi's
// CPU, not the token, and must never block Bring's own fetchers.
const shareRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// The public share route (section 8). Mounted in src/app.js before
// express.urlencoded, cookieParser, session and csrf, so this router never
// sees a cookie and never has req.session — no session middleware runs on
// this route at all.
export function shareRouter(db, config) {
  const router = express.Router();

  router.get('/r/:token', shareRateLimiter, (req, res, next) => {
    const recipe = findRecipeByShareToken(db, req.params.token);
    if (!recipe) {
      next(notFoundError());
      return;
    }

    const { groups } = loadRecipeContentById(db, recipe.id);
    const requestedYield = parseYieldParam(req.query, recipe.yield_amount);
    const factor = computeFactor(requestedYield, recipe.yield_amount);
    const scaledGroups = scaleGroups(groups, factor, { locale: config.numberLocale });

    // D3: the JSON-LD builder reads excludeFromShopping straight off the
    // already-scaled ingredients (D1) — scaleIngredient carries it through.
    const jsonLd = buildRecipeJsonLd({
      recipe,
      groups: scaledGroups,
      requestedYield,
      locale: config.numberLocale,
    });
    const jsonLdScript = serializeJsonLdForScriptTag(jsonLd);

    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'public, max-age=300',
    });

    res.render('share', {
      recipe,
      groups,
      scaledGroups,
      requestedYield,
      jsonLdScript,
    });
  });

  return router;
}
