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

    // SPECIFICATION.md P1/P2 (v2.11): N.A. (unit 'piece') carries no
    // quantity at all, so its amount field is disabled and cleared;
    // selecting any other unit re-enables it. Clearing on load/restore is
    // deliberate — a legacy or drafted N.A. row may hold a stored amount,
    // and showing it greyed out would mean it silently vanishes on the
    // next save.
    function syncAmountField(row) {
      var unitField = row.querySelector('.ingredient-row__unit');
      var amountField = row.querySelector('.ingredient-row__amount');
      if (!unitField || !amountField) return;
      if (unitField.value === 'piece') {
        amountField.value = '';
        amountField.disabled = true;
      } else {
        amountField.disabled = false;
      }
    }

    function syncAllAmountFields() {
      ingredientsContainer.querySelectorAll('[data-ingredient]').forEach(syncAmountField);
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
      if (target.closest('[data-cancel-edit]')) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // localStorage unavailable (private mode, quota, etc.) — nothing to clear
        }
        return;
      }
    });

    function focusIngredientName(row) {
      var nameField = row.querySelector('[data-ingredient-name]');
      if (nameField) nameField.focus();
    }

    form.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;

      var target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-remove-ingredient]')) return;

      var row = target.closest('[data-ingredient]');
      if (!row) return;

      event.preventDefault();

      var rows = ingredientsContainer.querySelectorAll('[data-ingredient]');
      var rowIndex = -1;
      rows.forEach(function (candidate, index) {
        if (candidate === row) rowIndex = index;
      });

      var nextRow;
      if (rowIndex === rows.length - 1) {
        nextRow = addIngredientRow();
        renumber();
        saveDraft();
      } else {
        nextRow = rows[rowIndex + 1];
      }

      focusIngredientName(nextRow);
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
    syncAllAmountFields();

    form.addEventListener('change', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.matches('.ingredient-row__unit')) return;
      var row = target.closest('[data-ingredient]');
      if (row) syncAmountField(row);
    });

    // How long to wait, after the last keystroke, before writing the draft.
    // Typing fires an 'input' event per keystroke; we only write once, when
    // it stops, so a long method text on a phone doesn't hit localStorage
    // on every letter.
    var DRAFT_SAVE_DEBOUNCE_MS = 400;
    var draftSaveTimer = null;

    function scheduleSaveDraft() {
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(function () {
        draftSaveTimer = null;
        saveDraft();
      }, DRAFT_SAVE_DEBOUNCE_MS);
    }

    window.addEventListener('pagehide', function () {
      if (draftSaveTimer) {
        clearTimeout(draftSaveTimer);
        saveDraft();
      }
    });

    form.addEventListener('input', scheduleSaveDraft);
    form.addEventListener('change', saveDraft);
  });
})();
