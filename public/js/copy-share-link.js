(function () {
  var button = document.querySelector('[data-copy-share-link]');
  if (!button) return;

  var original = button.textContent;

  function selectShareUrlText() {
    var urlEl = document.querySelector('[data-share-url]');
    if (!urlEl || !window.getSelection) return;
    var range = document.createRange();
    range.selectNodeContents(urlEl);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function showCopied() {
    button.textContent = 'Copied';
    setTimeout(function () {
      button.textContent = original;
    }, 2000);
  }

  button.addEventListener('click', function () {
    var url = button.dataset.shareUrl;

    // navigator.clipboard requires a secure context and is unavailable on
    // plain http (which matters for local testing) — fall back to selecting
    // the URL text so the user can copy it manually.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(showCopied, selectShareUrlText);
    } else {
      selectShareUrlText();
    }
  });
})();
