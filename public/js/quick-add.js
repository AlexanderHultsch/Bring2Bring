// Quick-add line for the recipe editor (SPECIFICATION.md section 2.1 A1).
// Parses a free-text line with the same code the server would use, then fills
// a new ingredient row created via recipe-editor.js's own row-creation so the
// markup never drifts out of two places.
import { parseIngredientLine } from '/js/domain/ingredient-parser.js';

// recipe-editor.js is a later, deferred classic script: it sets
// window.dishlistEditor synchronously while it executes, which happens after
// this module runs but before DOMContentLoaded fires. Waiting for that event
// (rather than acting at module-evaluation time) guarantees the editor has
// already initialized. Degrades silently if the editor form isn't on the page.
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-recipe-editor]');
  const editor = window.dishlistEditor;
  if (!form || !editor) return;

  const setValue = (el, value) => {
    if (!el) return;
    el.value = value === null || value === undefined ? '' : String(value);
  };

  function fillRow(row, parsed) {
    setValue(row.querySelector('.ingredient-row__amount'), parsed.amount);
    setValue(row.querySelector('.ingredient-row__amount-max'), parsed.amount_max);
    setValue(row.querySelector('.ingredient-row__unit'), parsed.unit);
    setValue(row.querySelector('[data-ingredient-name]'), parsed.name);
    setValue(row.querySelector('.ingredient-row__note'), parsed.note);
  }

  function addFromInput(input) {
    const value = input.value.trim();
    if (value === '') return;
    const group = input.closest('[data-group]');
    if (!group) return;

    const parsed = parseIngredientLine(value);
    const row = editor.addIngredientRow(group);
    fillRow(row, parsed);
    editor.renumber();
    editor.saveDraft();

    input.value = '';
    input.focus();
  }

  form.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick-add-button]');
    if (!button) return;
    event.preventDefault();
    const quickAdd = button.closest('[data-quick-add]');
    const input = quickAdd ? quickAdd.querySelector('[data-quick-add-input]') : null;
    if (input) addFromInput(input);
  });

  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('[data-quick-add-input]');
    if (!input) return;
    event.preventDefault();
    addFromInput(input);
  });
});
