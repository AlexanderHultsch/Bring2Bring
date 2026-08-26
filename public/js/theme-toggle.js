(function () {
  var toggle = document.querySelector('[data-theme-toggle]');
  if (!toggle) return;

  function currentTheme() {
    var explicit = document.documentElement.dataset.theme;
    if (explicit === 'dark' || explicit === 'light') {
      return explicit;
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  toggle.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('dishlist-theme', next);
    } catch {
      // localStorage unavailable (private mode) — theme still applies for this load
    }
  });
})();
