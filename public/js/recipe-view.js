// Client-side recalculation for the recipe page (SPECIFICATION.md section 7.4).
// Imports the byte-identical file the server renders with — see D1 in the
// step-15 task and src/app.js's /js/domain static mount. Degrades silently
// when the page has none of the elements below (e.g. any other page).
import { computeFactor, scaleGroups } from '/js/domain/scaling.js';

const container = document.querySelector('[data-base-yield]');

if (container) {
  const baseYield = Number(container.dataset.baseYield);
  const locale = container.dataset.locale || 'de-DE';
  const unitLanguage = container.dataset.unitLanguage || 'de';
  const measurementSystem = container.dataset.measurementSystem || 'metric';

  if (Number.isFinite(baseYield) && baseYield > 0) {
    const yieldWheel = document.querySelector('[data-yield-wheel]');
    const yieldScroll = document.querySelector('[data-yield-scroll]');
    const yieldInput = document.querySelector('[data-yield-input]');
    const bringLink = document.querySelector('[data-bring-link]');

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // How long to wait, after the last scroll event, before treating the
    // drum as settled (F5). A flick fires many scroll events; we only act
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

    function applyYield(requestedYield, { tick = false } = {}) {
      const factor = computeFactor(requestedYield, baseYield);

      container.querySelectorAll('[data-ingredient-list]').forEach((list) => {
        const itemEls = Array.from(list.querySelectorAll('[data-ingredient]'));
        const baseIngredients = itemEls.map(readBaseIngredient);
        const scaledIngredients = scaleGroups([{ ingredients: baseIngredients }], factor, {
          locale,
          language: unitLanguage,
          system: measurementSystem,
        })[0].ingredients;
        itemEls.forEach((el, index) => applyToElement(el, scaledIngredients[index]));
      });

      if (yieldInput && Number(yieldInput.value) !== requestedYield) {
        yieldInput.value = String(requestedYield);
      }
      markSelected(requestedYield);
      updateUrl(requestedYield);
      updateBringLink(requestedYield);

      if (tick) {
        try {
          navigator.vibrate?.(8);
        } catch {
          // navigator.vibrate is absent or throws on some platforms (iOS
          // Safari); a haptic tick is a nicety, never worth failing over.
        }
      }
    }

    // SPECIFICATION.md section 8.5: what the drum shows and what the Bring!
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
        el.classList.toggle('servings-drum__item--selected', selected);
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

    // Scrolls the drum's own container so `option` sits under the centre
    // band. Uses the container's scrollTo, never scrollIntoView, so this can
    // never also scroll the page.
    function centerYieldOption(option, behavior) {
      if (!yieldScroll || !option) return;
      const target = option.offsetTop + option.offsetHeight / 2 - yieldScroll.clientHeight / 2;
      yieldScroll.scrollTo({ top: target, behavior: reducedMotion.matches ? 'auto' : behavior });
    }

    function nearestYieldOption() {
      if (!yieldWheel || !yieldScroll) return null;
      const center = yieldScroll.scrollTop + yieldScroll.clientHeight / 2;
      let nearest = null;
      let nearestDistance = Infinity;
      yieldWheel.querySelectorAll('[data-yield-option]').forEach((el) => {
        const elCenter = el.offsetTop + el.offsetHeight / 2;
        const distance = Math.abs(elCenter - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = el;
        }
      });
      return nearest;
    }

    // Per-frame 3D transform (SPECIFICATION.md M1/M3, since v2.8): each item
    // is rotated and scaled by its signed distance from the container's
    // centre, so the column reads as a cylinder rather than a flat list.
    // Throttled to at most one pending animation frame — never an
    // unthrottled scroll handler. No blur (M3): recomputed every frame, on
    // an app served from a Raspberry Pi to a phone, a blur is the most
    // expensive thing on the list and the size/opacity/rotation already
    // carry the depth.
    let framePending = false;

    function renderCylinder() {
      framePending = false;
      if (!yieldWheel || !yieldScroll) return;
      const items = yieldWheel.querySelectorAll('[data-yield-option]');
      const itemHeight = items[0] ? items[0].offsetHeight : 48; // .servings-drum__item height (3rem)
      const center = yieldScroll.scrollTop + yieldScroll.clientHeight / 2;
      const motionOff = reducedMotion.matches;

      items.forEach((el) => {
        const elCenter = el.offsetTop + el.offsetHeight / 2;
        const d = (elCenter - center) / itemHeight;
        const absD = Math.min(Math.abs(d), 3);
        const scale = Math.max(0.6, 1 - 0.12 * absD);
        const opacity = Math.max(0.2, 1 - 0.38 * absD);
        const hScale = Math.max(0.5, scale - 0.08 * absD);
        // Written on the inner .servings-drum__value span, not on `el`
        // itself: `el` carries scroll-snap-align, and writing a per-frame
        // rotateX+translateZ transform directly onto a mandatory
        // scroll-snap target makes Chromium re-run its snap correction on
        // every frame (measured: ~60-72 synthetic 'scroll' events/sec,
        // scrollTop unchanged) — the same invisible, CPU-pinning infinite
        // loop a layout write causes, just reached through the snap
        // machinery instead of layout. The inner span is not a snap
        // target, so it can carry the same transform with no such loop.
        const inner = el.querySelector('.servings-drum__value') || el;

        if (motionOff) {
          inner.style.transform = `scale(${hScale}, ${scale})`;
        } else {
          const rotateX = Math.max(-60, Math.min(60, -20 * d));
          inner.style.transform = `rotateX(${rotateX}deg) scale(${hScale}, ${scale})`;
        }
        el.style.opacity = String(opacity);
      });
    }

    function scheduleRenderCylinder() {
      if (framePending) return;
      framePending = true;
      requestAnimationFrame(renderCylinder);
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
          applyYield(next, { tick: true });
          programmaticScroll = true;
          centerYieldOption(option, 'smooth');
        }
      });

      const initialSelected = yieldWheel.querySelector('[data-yield-option].servings-drum__item--selected');
      centerYieldOption(initialSelected, 'auto');
      scheduleRenderCylinder();
    }

    // markSelected only toggles classes/attributes and never scrolls, so
    // settling here cannot re-trigger this handler (no feedback loop).
    let scrollSettleTimer = null;
    if (yieldScroll) {
      yieldScroll.addEventListener(
        'scroll',
        () => {
          scheduleRenderCylinder();

          if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
          scrollSettleTimer = setTimeout(() => {
            if (programmaticScroll) {
              programmaticScroll = false;
              const selected = yieldWheel && yieldWheel.querySelector('[data-yield-option].servings-drum__item--selected');
              centerYieldOption(selected, 'auto');
              return;
            }
            const nearest = nearestYieldOption();
            if (!nearest || nearest.classList.contains('servings-drum__item--selected')) return;
            const next = Number(nearest.dataset.yieldOption);
            if (Number.isInteger(next) && next >= 1 && next <= 10) applyYield(next, { tick: true });
          }, SCROLL_SETTLE_MS);
        },
        { passive: true }
      );
    }

    // The hidden number input is the keyboard and assistive-technology path
    // (arrow keys and typing already work natively on <input type="number">
    // — see the NOTES on role="spinbutton" in the task write-up).
    if (yieldInput) {
      yieldInput.addEventListener('input', () => {
        const next = Number(yieldInput.value);
        if (!Number.isInteger(next) || next < 1 || next > 10) return;
        applyYield(next, { tick: true });
        const option = yieldWheel && yieldWheel.querySelector(`[data-yield-option="${next}"]`);
        programmaticScroll = true;
        centerYieldOption(option, 'smooth');
      });
    }
  }
}
