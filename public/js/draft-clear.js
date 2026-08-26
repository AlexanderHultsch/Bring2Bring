(function () {
  var el = document.querySelector('[data-recipe-id]');
  if (!el) return;

  var saved = el.dataset.saved;
  if (saved !== '1' && saved !== 'new') return;

  var recipeId = el.dataset.recipeId;

  try {
    localStorage.removeItem('dishlist-draft-' + recipeId);
  } catch {
    // localStorage unavailable — nothing to clear
  }

  if (saved === 'new') {
    try {
      localStorage.removeItem('dishlist-draft-new');
    } catch {
      // localStorage unavailable — nothing to clear
    }
  }
})();
