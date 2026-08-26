// Client-side recalculation for the recipe page (SPECIFICATION.md section 7.4).
// Imports the byte-identical file the server renders with — see D1 in the
// step-15 task and src/app.js's /js/domain static mount. Degrades silently
// when the page has none of the elements below (e.g. any other page).
import { computeFactor, scaleGroups } from '/js/domain/scaling.js';

const container = document.querySelector('[data-base-yield]');

if (container) {
  const baseYield = Number(container.dataset.baseYield);
  const locale = container.dataset.locale || 'de-DE';

  if (Number.isFinite(baseYield) && baseYield > 0) {
    const yieldInput = document.querySelector('[data-yield-input]');
    const yieldForm = document.querySelector('[data-yield-form]');

    const emptyToNull = (raw) => {
      if (raw === undefined || raw === '') return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };

    function readBaseIngredient(el) {
      return {
        amount: emptyToNull(el.dataset.amount),
        amount_max: emptyToNull(el.dataset.amountMax),
        unit: el.dataset.unit === '' ? null : el.dataset.unit,
        name: el.dataset.name || '',
        note: el.dataset.note === '' ? null : el.dataset.note,
        scales: el.dataset.scales === '1',
      };
    }

    function applyToElement(el, scaledIngredient) {
      const amountSpan = el.querySelector('[data-amount-display]');
      if (!amountSpan) return;

      amountSpan.textContent = scaledIngredient.amountText;

      if (scaledIngredient.exactText) {
        amountSpan.setAttribute('title', scaledIngredient.exactText);
      } else {
        amountSpan.removeAttribute('title');
      }
    }

    function applyYield(requestedYield) {
      const factor = computeFactor(requestedYield, baseYield);

      container.querySelectorAll('[data-ingredient-list]').forEach((list) => {
        const itemEls = Array.from(list.querySelectorAll('[data-ingredient]'));
        const baseIngredients = itemEls.map(readBaseIngredient);
        const scaledIngredients = scaleGroups([{ ingredients: baseIngredients }], factor, { locale })[0]
          .ingredients;
        itemEls.forEach((el, index) => applyToElement(el, scaledIngredients[index]));
      });

      if (yieldInput) yieldInput.value = String(requestedYield);
      updateUrl(requestedYield);
    }

    function updateUrl(requestedYield) {
      const url = new URL(window.location.href);
      url.searchParams.set('yield', String(requestedYield));
      window.history.replaceState(window.history.state, '', url.toString());
    }

    function currentYield() {
      const value = yieldInput ? Number(yieldInput.value) : NaN;
      return Number.isFinite(value) && value > 0 ? value : baseYield;
    }

    function clampYield(value) {
      if (!Number.isFinite(value) || value <= 0) return null;
      return Math.min(Math.round(value * 100) / 100, 1000);
    }

    if (yieldForm) {
      yieldForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const next = clampYield(currentYield());
        if (next !== null) applyYield(next);
      });

      yieldForm.addEventListener('click', (event) => {
        const stepLink = event.target.closest('[data-yield-step]');
        const presetLink = event.target.closest('[data-yield-preset]');

        if (stepLink) {
          event.preventDefault();
          const next = clampYield(currentYield() + Number(stepLink.dataset.yieldStep));
          if (next !== null) applyYield(next);
          return;
        }

        if (presetLink) {
          event.preventDefault();
          const next = clampYield(currentYield() * Number(presetLink.dataset.yieldPreset));
          if (next !== null) applyYield(next);
        }
      });
    }
  }
}
