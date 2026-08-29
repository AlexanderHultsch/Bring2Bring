import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { findRecipeByShareToken, loadRecipeContentById } from '../repositories/recipes.js';
import { findUnitPreferencesByUserId } from '../repositories/users.js';
import { computeFactor, scaleGroups } from '../domain/scaling.js';
import { numberLocaleFor } from '../domain/units.js';
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

    // §7.5/§7.6: no logged-in viewer reaches this route (mounted before the
    // session middleware), so it renders in the recipe author's own
    // preferences, falling back to de/metric if the author was deleted —
    // never a share-page 500 over a missing user row.
    const authorPreferences = findUnitPreferencesByUserId(db, recipe.owner_id);
    const language = authorPreferences?.unit_language ?? 'de';
    const system = authorPreferences?.measurement_system ?? 'metric';
    const locale = numberLocaleFor(language, config.numberLocale);

    const scaledGroups = scaleGroups(groups, factor, { locale, language, system });

    // D3: the JSON-LD builder reads excludeFromShopping straight off the
    // already-scaled ingredients (D1) — scaleIngredient carries it through.
    // The same `locale` that produced the on-screen text goes into the
    // JSON-LD Bring! fetches, so the two can never disagree (§7.5/§7.6).
    const jsonLd = buildRecipeJsonLd({
      recipe,
      groups: scaledGroups,
      requestedYield,
      locale,
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
