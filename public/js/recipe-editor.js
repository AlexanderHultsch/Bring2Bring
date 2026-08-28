(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  ready(function () {
    var form = document.querySelector('[data-recipe-editor]');
    if (!form) return;

    var ingredientsContainer = form.querySelector('[data-ingredients]');
    var ingredientTemplate = form.querySelector('[data-ingredient-row-template]');
    var draftKey = 'bring2bring-draft-' + (form.dataset.recipeId || 'new');

    function setName(el, name) {
      if (el) el.name = name;
    }

    function renumber() {
      var ingredients = ingredientsContainer.querySelectorAll('[data-ingredient]');
      ingredients.forEach(function (row, index) {
        var prefix = 'ingredients[' + index + ']';
        setName(row.querySelector('.ingredient-row__amount'), prefix + '[amount]');
        setName(row.querySelector('.ingredient-row__unit'), prefix + '[unit]');
        setName(row.querySelector('[data-ingredient-name]'), prefix + '[name]');
      });
    }

    function cloneTemplate(template) {
      return template.content.firstElementChild.cloneNode(true);
    }

    function addIngredientRow() {
      var row = cloneTemplate(ingredientTemplate);
      ingredientsContainer.appendChild(row);
      return row;
    }

    form.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest('[data-add-ingredient]')) {
        event.preventDefault();
        addIngredientRow();
        renumber();
        saveDraft();
        return;
      }
      if (target.closest('[data-remove-ingredient]')) {
        event.preventDefault();
        var ingredientRow = target.closest('[data-ingredient]');
        var siblingRows = ingredientsContainer.querySelectorAll('[data-ingredient]');
        if (ingredientRow && siblingRows.length > 1) {
          ingredientRow.remove();
          renumber();
          saveDraft();
        }
        return;
      }
    });

    function saveDraft() {
      try {
        var formData = new FormData(form);
        var entries = [];
        formData.forEach(function (value, key) {
          if (key === '_csrf') return;
          entries.push([key, value]);
        });
        localStorage.setItem(draftKey, JSON.stringify(entries));
      } catch {
        // localStorage unavailable (private mode, quota, etc.) — autosave skipped
      }
    }

    function ensureCapacity(entries) {
      var maxIngredientIndex = -1;

      entries.forEach(function (entry) {
        var name = entry[0];
        var match = name.match(/^ingredients\[(\d+)\]/);
        if (match) {
          var index = Number(match[1]);
          if (index > maxIngredientIndex) maxIngredientIndex = index;
        }
      });

      while (ingredientsContainer.querySelectorAll('[data-ingredient]').length <= maxIngredientIndex) {
        addIngredientRow();
      }
    }

    function restoreDraft() {
      var raw;
      try {
        raw = localStorage.getItem(draftKey);
      } catch {
        return;
      }
      if (!raw) return;

      var entries;
      try {
        entries = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(entries)) return;

      ensureCapacity(entries);
      renumber();

      entries.forEach(function (entry) {
        var name = entry[0];
        var value = entry[1];
        var field = form.elements.namedItem(name);
        if (!field) return;
        if (field instanceof RadioNodeList) {
          field = field[0];
        }
        field.value = value;
      });
    }

    restoreDraft();
    renumber();

    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
  });
})();
