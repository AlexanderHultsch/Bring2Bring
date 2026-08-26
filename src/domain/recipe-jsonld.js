// Pure, dependency-free ES module. Runs unchanged in Node and in the browser
// (loaded as <script type="module">) — see SPECIFICATION.md section 4.1 and 7.
// No imports except from ./scaling.js and ./units.js are permitted here.
//
// SPECIFICATION.md section 8.4: the machine-readable markup for the public
// share page. The `groups` passed to buildRecipeJsonLd are ALREADY SCALED
// (the direct output of scaling.js's scaleGroups, which carries each
// ingredient's excludeFromShopping flag through) — this module never scales
// anything itself, so there is exactly one scaling implementation.

import { formatAmount } from './units.js';

function absoluteUrl(baseUrl, relativePath) {
  if (!baseUrl || !relativePath) return undefined;
  const trimmedBase = String(baseUrl).replace(/\/+$/, '');
  const trimmedPath = String(relativePath).replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

function toIsoDuration(minutes) {
  return `PT${minutes}M`;
}

export function buildRecipeJsonLd({ recipe, groups, steps, tags, requestedYield, baseUrl, locale }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title,
  };

  if (recipe.description) {
    jsonLd.description = recipe.description;
  }

  const image = absoluteUrl(baseUrl, recipe.image_path);
  if (image) {
    jsonLd.image = image;
  }

  const yieldUnitLabel = recipe.yield_label || recipe.yield_unit;
  jsonLd.recipeYield = [formatAmount(requestedYield, locale), yieldUnitLabel].filter(Boolean).join(' ');

  if (recipe.total_minutes != null) {
    jsonLd.totalTime = toIsoDuration(recipe.total_minutes);
  }
  if (recipe.prep_minutes != null) {
    jsonLd.prepTime = toIsoDuration(recipe.prep_minutes);
  }
  if (recipe.cook_minutes != null) {
    jsonLd.cookTime = toIsoDuration(recipe.cook_minutes);
  }

  if (tags && tags.length > 0) {
    jsonLd.recipeCategory = tags.map((tag) => tag.name).join(', ');
  }

  jsonLd.recipeIngredient = (groups ?? [])
    .flatMap((group) => group.ingredients ?? [])
    .filter((ingredient) => !ingredient.excludeFromShopping)
    .map((ingredient) => ingredient.text);

  jsonLd.recipeInstructions = (steps ?? []).map((step) => ({
    '@type': 'HowToStep',
    text: step.text,
  }));

  return jsonLd;
}

// D5: application/ld+json is a data block, not executable script, so the
// strict CSP does not block it and no nonce is needed — but a recipe title
// containing `</script>` could still break out of the surrounding tag, so
// the `</` sequence is escaped here, once, rather than inline in the
// template (which would need to use unescaped `<%- %>` on raw JSON).
export function serializeJsonLdForScriptTag(data) {
  return JSON.stringify(data).replace(/<\//g, '<\\/');
}

// SPECIFICATION.md section 8.5: the Bring! deeplink, built as a plain,
// directly-testable URL string — never fetched with JavaScript, since the
// endpoint answers 307 to an app deeplink. baseQuantity and requestedQuantity
// are always set to the SAME requestedYield the share page renders with, so
// Bring's requestedQuantity/baseQuantity multiplier is always exactly 1.0 —
// our page already delivers scaled amounts (the double-scaling trap).
export function buildBringDeeplinkUrl({ baseUrl, token, requestedYield }) {
  const shareUrl = `${String(baseUrl).replace(/\/+$/, '')}/r/${token}?yield=${requestedYield}`;
  const quantity = String(requestedYield);
  return (
    'https://api.getbring.com/rest/bringrecipes/deeplink' +
    `?url=${encodeURIComponent(shareUrl)}` +
    '&source=web' +
    `&baseQuantity=${encodeURIComponent(quantity)}` +
    `&requestedQuantity=${encodeURIComponent(quantity)}`
  );
}
