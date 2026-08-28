(function () {
  var rail = document.querySelector('[data-az-rail]');
  if (!rail) return;

  var bubble = rail.querySelector('[data-az-bubble]');
  if (!bubble) return;

  var letterEls = Array.prototype.slice.call(rail.querySelectorAll('[data-az-letter]'));
  if (!letterEls.length) return;

  var MAGNIFY_RANGE = 60;
  var MAX_SCALE = 1.8;

  var dragging = false;
  var activeLetter = null;

  function applyMagnification(clientY) {
    var nearest = null;
    var nearestDist = Infinity;
    for (var i = 0; i < letterEls.length; i++) {
      var el = letterEls[i];
      var rect = el.getBoundingClientRect();
      var center = rect.top + rect.height / 2;
      var dist = Math.abs(clientY - center);
      var scale = dist < MAGNIFY_RANGE ? 1 + (MAX_SCALE - 1) * (1 - dist / MAGNIFY_RANGE) : 1;
      el.style.transform = 'scale(' + scale.toFixed(2) + ')';
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = el;
      }
    }
    return nearest;
  }

  function positionBubble(clientY) {
    var railRect = rail.getBoundingClientRect();
    var half = bubble.offsetHeight / 2;
    var top = clientY - railRect.top - half;
    var maxTop = rail.offsetHeight - bubble.offsetHeight;
    if (top < 0) top = 0;
    if (top > maxTop) top = maxTop;
    bubble.style.top = top + 'px';
  }

  function handlePointer(clientY) {
    var nearest = applyMagnification(clientY);
    if (!nearest) return;
    var letter = nearest.getAttribute('data-az-letter');
    bubble.textContent = letter;
    bubble.setAttribute('data-visible', '');
    positionBubble(clientY);
    activeLetter = letter;
  }

  function release() {
    for (var i = 0; i < letterEls.length; i++) {
      letterEls[i].style.transform = '';
    }
    bubble.removeAttribute('data-visible');
    dragging = false;
    activeLetter = null;
  }

  function onPointerUp() {
    if (activeLetter) {
      var target = document.getElementById('sect-' + activeLetter);
      if (target) {
        target.scrollIntoView({ block: 'start' });
      }
    }
    release();
  }

  function onPointerDown(event) {
    dragging = true;
    activeLetter = null;
    if (rail.setPointerCapture) rail.setPointerCapture(event.pointerId);
    handlePointer(event.clientY);
  }

  function onPointerMove(event) {
    if (!dragging) return;
    handlePointer(event.clientY);
  }

  rail.addEventListener('pointerdown', onPointerDown);
  rail.addEventListener('pointermove', onPointerMove);
  rail.addEventListener('pointerup', onPointerUp);
  rail.addEventListener('pointercancel', release);
  rail.addEventListener('lostpointercapture', release);

  var sectionHeadings = Array.prototype.slice.call(document.querySelectorAll('[id^="sect-"]'));

  function updateCurrentLetter() {
    if (!sectionHeadings.length) return;
    var current = sectionHeadings[0];
    for (var i = 0; i < sectionHeadings.length; i++) {
      if (sectionHeadings[i].getBoundingClientRect().top <= 0) {
        current = sectionHeadings[i];
      }
    }
    var letter = current.id.slice('sect-'.length);
    for (var j = 0; j < letterEls.length; j++) {
      var el = letterEls[j];
      if (el.getAttribute('data-az-letter') === letter) {
        el.classList.add('az-rail__letter--current');
      } else {
        el.classList.remove('az-rail__letter--current');
      }
    }
  }

  var scrollTicking = false;

  window.addEventListener('scroll', function () {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(function () {
      updateCurrentLetter();
      scrollTicking = false;
    });
  }, { passive: true });

  updateCurrentLetter();
})();
