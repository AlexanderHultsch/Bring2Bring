(function () {
  var menu = document.querySelector('[data-menu]');
  if (!menu) return;

  document.addEventListener('click', function (event) {
    if (!menu.open) return;
    if (menu.contains(event.target)) return;
    menu.open = false;
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
    }
  });
})();
