// Прилага запазената тема веднага (преди рисуване), за да няма „мигане“.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('spark.theme') || 'null');
    if (!t) return;
    var r = document.documentElement.style;
    var map = { text: '--text', heading: '--heading', accent: '--accent', border: '--border', surface: '--surface', bg: '--bg' };
    for (var k in map) if (/^#[0-9a-f]{6}$/i.test(t[k] || '')) r.setProperty(map[k], t[k]);
    if (typeof t.fontScale === 'number') r.setProperty('--font-scale', String(t.fontScale / 100));
    if (typeof t.radius === 'number') r.setProperty('--radius', t.radius + 'px');
    if (typeof t.borderWidth === 'number') r.setProperty('--bw', t.borderWidth + 'px');
    if (typeof t.glow === 'number') r.setProperty('--glow', String(t.glow / 100));
    if (t.animations === false) document.documentElement.classList.add('no-anim');
  } catch (e) { /* localStorage недостъпен – ползват се стандартните цветове */ }
})();
