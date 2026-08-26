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

    var groupsContainer = form.querySelector('[data-groups]');
    var stepsContainer = form.querySelector('[data-steps]');
    var ingredientTemplate = form.querySelector('[data-ingredient-row-template]');
    var groupTemplate = form.querySelector('[data-group-template]');
    var stepTemplate = form.querySelector('[data-step-row-template]');
    var draftKey = 'dishlist-draft-' + (form.dataset.recipeId || 'new');

    function setName(el, name) {
      if (el) el.name = name;
    }

    function renumber() {
      var groups = groupsContainer.querySelectorAll(':scope > [data-group]');
      groups.forEach(function (group, groupIndex) {
        setName(group.querySelector('[data-group-name]'), 'groups[' + groupIndex + '][name]');

        var ingredients = group.querySelectorAll('[data-ingredient]');
        ingredients.forEach(function (row, ingredientIndex) {
          var prefix = 'groups[' + groupIndex + '][ingredients][' + ingredientIndex + ']';
          setName(row.querySelector('.ingredient-row__amount'), prefix + '[amount]');
          setName(row.querySelector('.ingredient-row__amount-max'), prefix + '[amount_max]');
          setName(row.querySelector('.ingredient-row__unit'), prefix + '[unit]');
          setName(row.querySelector('[data-ingredient-name]'), prefix + '[name]');
          setName(row.querySelector('.ingredient-row__note'), prefix + '[note]');
          var checkboxes = row.querySelectorAll('input[type="checkbox"]');
          setName(checkboxes[0], prefix + '[scales]');
          setName(checkboxes[1], prefix + '[is_optional]');
          setName(checkboxes[2], prefix + '[exclude_from_shopping]');
        });
      });

      var steps = stepsContainer.querySelectorAll('[data-step]');
      steps.forEach(function (step, stepIndex) {
        setName(step.querySelector('.step-row__section'), 'steps[' + stepIndex + '][section_title]');
        setName(step.querySelector('[data-step-text]'), 'steps[' + stepIndex + '][text]');
      });
    }

    function cloneTemplate(template) {
      return template.content.firstElementChild.cloneNode(true);
    }

    function addIngredientRow(group) {
      var row = cloneTemplate(ingredientTemplate);
      group.querySelector('[data-ingredients]').appendChild(row);
      return row;
    }

    function addGroup() {
      var group = cloneTemplate(groupTemplate);
      groupsContainer.appendChild(group);
      addIngredientRow(group);
      return group;
    }

    function addStep() {
      var step = cloneTemplate(stepTemplate);
      stepsContainer.appendChild(step);
      return step;
    }

    function moveRow(row, direction) {
      if (!row) return;
      var sibling = direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return;
      if (direction === 'up') {
        row.parentNode.insertBefore(row, sibling);
      } else {
        row.parentNode.insertBefore(sibling, row);
      }
    }

    form.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest('[data-add-group]')) {
        event.preventDefault();
        addGroup();
        renumber();
        saveDraft();
        return;
      }
      if (target.closest('[data-remove-group]')) {
        event.preventDefault();
        var group = target.closest('[data-group]');
        if (group && groupsContainer.querySelectorAll(':scope > [data-group]').length > 1) {
          group.remove();
          renumber();
          saveDraft();
        }
        return;
      }
      if (target.closest('[data-add-ingredient]')) {
        event.preventDefault();
        addIngredientRow(target.closest('[data-group]'));
        renumber();
        saveDraft();
        return;
      }
      if (target.closest('[data-remove-ingredient]')) {
        event.preventDefault();
        var ingredientRow = target.closest('[data-ingredient]');
        var siblingRows = ingredientRow ? ingredientRow.parentNode.querySelectorAll('[data-ingredient]') : [];
        if (ingredientRow && siblingRows.length > 1) {
          ingredientRow.remove();
          renumber();
          saveDraft();
        }
        return;
      }
      if (target.closest('[data-add-step]')) {
        event.preventDefault();
        addStep();
        renumber();
        saveDraft();
        return;
      }
      if (target.closest('[data-remove-step]')) {
        event.preventDefault();
        var stepRow = target.closest('[data-step]');
        var siblingSteps = stepsContainer.querySelectorAll('[data-step]');
        if (stepRow && siblingSteps.length > 1) {
          stepRow.remove();
          renumber();
          saveDraft();
        }
        return;
      }
      if (target.closest('[data-move-up]')) {
        event.preventDefault();
        moveRow(target.closest('[data-ingredient], [data-step]'), 'up');
        renumber();
        saveDraft();
        return;
      }
      if (target.closest('[data-move-down]')) {
        event.preventDefault();
        moveRow(target.closest('[data-ingredient], [data-step]'), 'down');
        renumber();
        saveDraft();
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

    function clearDraft() {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // localStorage unavailable — nothing to clear
      }
    }

    function ensureCapacity(entries) {
      var maxGroupIndex = -1;
      var maxIngredientIndexByGroup = {};
      var maxStepIndex = -1;

      entries.forEach(function (entry) {
        var name = entry[0];
        var groupMatch = name.match(/^groups\[(\d+)\]/);
        if (groupMatch) {
          var groupIndex = Number(groupMatch[1]);
          if (groupIndex > maxGroupIndex) maxGroupIndex = groupIndex;

          var ingredientMatch = name.match(/^groups\[(\d+)\]\[ingredients\]\[(\d+)\]/);
          if (ingredientMatch) {
            var gi = Number(ingredientMatch[1]);
            var ii = Number(ingredientMatch[2]);
            if (!(gi in maxIngredientIndexByGroup) || ii > maxIngredientIndexByGroup[gi]) {
              maxIngredientIndexByGroup[gi] = ii;
            }
          }
        }

        var stepMatch = name.match(/^steps\[(\d+)\]/);
        if (stepMatch) {
          var stepIndex = Number(stepMatch[1]);
          if (stepIndex > maxStepIndex) maxStepIndex = stepIndex;
        }
      });

      while (groupsContainer.querySelectorAll(':scope > [data-group]').length <= maxGroupIndex) {
        addGroup();
      }

      var groups = groupsContainer.querySelectorAll(':scope > [data-group]');
      Object.keys(maxIngredientIndexByGroup).forEach(function (key) {
        var group = groups[Number(key)];
        if (!group) return;
        var needed = maxIngredientIndexByGroup[key];
        while (group.querySelectorAll('[data-ingredient]').length <= needed) {
          addIngredientRow(group);
        }
      });

      while (stepsContainer.querySelectorAll('[data-step]').length <= maxStepIndex) {
        addStep();
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

      form.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) {
        checkbox.checked = false;
      });

      entries.forEach(function (entry) {
        var name = entry[0];
        var value = entry[1];
        var field = form.elements.namedItem(name);
        if (!field) return;
        if (field instanceof RadioNodeList) {
          field = field[0];
        }
        if (field.type === 'checkbox') {
          field.checked = true;
        } else {
          field.value = value;
        }
      });
    }

    restoreDraft();
    renumber();

    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
  });
})();
