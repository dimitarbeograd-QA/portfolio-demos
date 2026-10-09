/* Вариант на дизайна: градина | изумруд | пудра | нощ.
   Избира се с ?look=... или от превключвателя (запазва се в сесията). */
(function () {
  var ALL = ['garden', 'emerald', 'blush', 'noir', 'gold'];
  var SUF = { garden: '', emerald: '-e', blush: '-b', noir: '-n', gold: '-g' };
  var look = null;
  try {
    var q = new URLSearchParams(location.search).get('look');
    if (q && ALL.indexOf(q) > -1) { sessionStorage.setItem('wedding-look', q); look = q; }
    else look = sessionStorage.getItem('wedding-look');
  } catch (e) { /* без хранилище */ }
  if (ALL.indexOf(look) < 0) look = 'garden';

  function swapRoses() {
    var uses = document.querySelectorAll('use');
    for (var i = 0; i < uses.length; i++) {
      var u = uses[i];
      var base = u.getAttribute('data-base');
      if (!base) {
        var h = u.getAttribute('href') || '';
        if (h === '#rose' || h === '#rose2') { base = h.slice(1); u.setAttribute('data-base', base); } else continue;
      }
      u.setAttribute('href', '#' + base + SUF[look]);
    }
  }
  function apply() {
    document.documentElement.setAttribute('data-look', look);
    swapRoses();
  }
  apply();
  document.addEventListener('DOMContentLoaded', swapRoses);

  window.WeddingLook = {
    all: ALL,
    get name() { return look; },
    set: function (name) {
      if (ALL.indexOf(name) < 0 || name === look) return;
      look = name;
      try { sessionStorage.setItem('wedding-look', name); } catch (e) { /* ok */ }
      apply();
      document.dispatchEvent(new CustomEvent('lookchange', { detail: name }));
    }
  };
})();
