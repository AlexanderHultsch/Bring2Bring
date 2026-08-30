(function () {
  var el = document.querySelector('[data-recipe-id]');
  if (!el) return;

  var saved = el.dataset.saved;
  if (saved !== '1' && saved !== 'new') return;

  var recipeId = el.dataset.recipeId;

  var keys = ['bring2bring-draft-' + recipeId];
  if (saved === 'new') {
    keys.push('bring2bring-draft-new');
  }

  try {
    keys.forEach(function (key) {
      localStorage.removeItem(key);
    });
  } catch {
    // localStorage unavailable — nothing to clear
  }
})();
