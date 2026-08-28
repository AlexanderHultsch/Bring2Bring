(function () {
  try {
    var theme = localStorage.getItem('bring2bring-theme');
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // localStorage unavailable (private mode) — prefers-color-scheme decides
  }
})();
