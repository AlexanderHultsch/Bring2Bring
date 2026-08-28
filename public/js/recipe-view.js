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
    const yieldWheel = document.querySelector('[data-yield-wheel]');
    const yieldScroll = document.querySelector('[data-yield-scroll]');
    const servingsCount = document.querySelector('[data-servings-count]');
    const bringLink = document.querySelector('[data-bring-link]');

    // How long to wait, after the last scroll event, before treating the
    // wheel as settled (F5). A flick fires many scroll events; we only act
    // once, when it stops.
    const SCROLL_SETTLE_MS = 100;

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

      if (servingsCount) servingsCount.textContent = String(requestedYield);
      markSelected(requestedYield);
      updateUrl(requestedYield);
      updateBringLink(requestedYield);
    }

    // SPECIFICATION.md section 8.5: what the wheel shows and what the Bring!
    // button sends must be the same number, or the export scales twice (the
    // double-scaling trap) — the button's href is our own /recipes/:id/bring
    // route, so this only ever has to rewrite the one yield query param.
    function updateBringLink(requestedYield) {
      if (!bringLink) return;
      const url = new URL(bringLink.href, window.location.origin);
      url.searchParams.set('yield', String(requestedYield));
      bringLink.href = url.pathname + url.search;
    }

    function markSelected(requestedYield) {
      if (!yieldWheel) return;
      yieldWheel.querySelectorAll('[data-yield-option]').forEach((el) => {
        const selected = Number(el.dataset.yieldOption) === requestedYield;
        el.classList.toggle('servings-wheel__item--selected', selected);
        if (selected) {
          el.setAttribute('aria-current', 'true');
        } else {
          el.removeAttribute('aria-current');
        }
      });
    }

    function updateUrl(requestedYield) {
      const url = new URL(window.location.href);
      url.searchParams.set('yield', String(requestedYield));
      window.history.replaceState(window.history.state, '', url.toString());
    }

    // Scrolls the wheel's own container so `option` sits under the lens.
    // Uses the container's scrollTo, never scrollIntoView, so this can never
    // also scroll the page vertically.
    function centerYieldOption(option, behavior) {
      if (!yieldScroll || !option) return;
      const target = option.offsetLeft + option.offsetWidth / 2 - yieldScroll.clientWidth / 2;
      yieldScroll.scrollTo({ left: target, behavior });
    }

    function nearestYieldOption() {
      if (!yieldWheel || !yieldScroll) return null;
      const center = yieldScroll.scrollLeft + yieldScroll.clientWidth / 2;
      let nearest = null;
      let nearestDistance = Infinity;
      yieldWheel.querySelectorAll('[data-yield-option]').forEach((el) => {
        const elCenter = el.offsetLeft + el.offsetWidth / 2;
        const distance = Math.abs(elCenter - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = el;
        }
      });
      return nearest;
    }

    // Set by the click handler right before it starts a programmatic scroll,
    // so the settle handler below can tell that scroll apart from a genuine
    // finger-drag instead of racing it.
    let programmaticScroll = false;

    if (yieldWheel) {
      yieldWheel.addEventListener('click', (event) => {
        const option = event.target.closest('[data-yield-option]');
        if (!option) return;

        event.preventDefault();
        const next = Number(option.dataset.yieldOption);
        if (Number.isInteger(next) && next >= 1 && next <= 10) {
          applyYield(next);
          programmaticScroll = true;
          centerYieldOption(option, 'smooth');
        }
      });

      const initialSelected = yieldWheel.querySelector('[data-yield-option].servings-wheel__item--selected');
      centerYieldOption(initialSelected, 'auto');
    }

    // markSelected only toggles classes/attributes and never scrolls, so
    // settling here cannot re-trigger this handler (no feedback loop).
    let scrollSettleTimer = null;
    if (yieldScroll) {
      yieldScroll.addEventListener(
        'scroll',
        () => {
          if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
          scrollSettleTimer = setTimeout(() => {
            if (programmaticScroll) {
              programmaticScroll = false;
              const selected = yieldWheel && yieldWheel.querySelector('[data-yield-option].servings-wheel__item--selected');
              centerYieldOption(selected, 'auto');
              return;
            }
            const nearest = nearestYieldOption();
            if (!nearest || nearest.classList.contains('servings-wheel__item--selected')) return;
            const next = Number(nearest.dataset.yieldOption);
            if (Number.isInteger(next) && next >= 1 && next <= 10) applyYield(next);
          }, SCROLL_SETTLE_MS);
        },
        { passive: true }
      );
    }
  }
}
