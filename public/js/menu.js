(function () {
  var menu = document.querySelector('[data-menu]');
  if (!menu) return;

  document.addEventListener('click', function (event) {
    if (!menu.open) return;
    var toggle = menu.querySelector('.menu__toggle');
    if (toggle && toggle.contains(event.target)) return;
    var panel = menu.querySelector('.menu__panel');
    if (panel && panel.contains(event.target)) return;
    menu.open = false;
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
    }
  });
})();
