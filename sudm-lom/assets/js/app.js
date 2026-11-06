/* СУ „Димитър Маринов“ – общ скрипт. Без външни библиотеки. */
(function () {
  var root = document.documentElement;
  var ROOT = root.getAttribute('data-root') || '';
  root.classList.add('js');
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);

  /* Лента за напредък и лек паралакс на героя при скрол */
  var prog = $('#progress'), hero = $('#hero'), heroImg = hero ? $('.hero-media img', hero) : null, ticking = false;
  function frame() {
    ticking = false;
    var y = window.pageYOffset, h = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (prog) prog.style.setProperty('--sp', Math.min(1, y / h).toFixed(4));
    if (heroImg && !reduce && y < window.innerHeight * 1.5) {
      var p = Math.min(1, y / Math.max(1, hero.offsetHeight));
      heroImg.style.setProperty('--ty', (p * 70).toFixed(1) + 'px');
      heroImg.style.setProperty('--zoom', (1.08 + p * 0.05).toFixed(4));
    }
  }
  function onScroll() { if (!ticking) { ticking = true; window.requestAnimationFrame(frame); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll); frame();

  /* Мобилно чекмедже (страничният панел на тесни екрани) */
  var mb = $('#menuBtn'), rail = $('#rail'), nav = $('#nav'), scrim = $('#scrim'), rc = $('#railClose');
  var mq = window.matchMedia ? window.matchMedia('(max-width:1099px)') : { matches: false };
  function setMenu(o) {
    if (!rail || !mb) return;
    rail.classList.toggle('open', o); if (nav) nav.classList.toggle('open', o);
    mb.setAttribute('aria-expanded', o ? 'true' : 'false');
    mb.lastElementChild.textContent = o ? 'Затвори' : 'Меню';
    if (scrim) scrim.hidden = !o;
    if (mq.matches) document.body.style.overflow = o ? 'hidden' : '';
    if (o && mq.matches) { var f = $('.nl', rail); if (f) f.focus(); }
  }
  if (mb && rail) {
    mb.addEventListener('click', function () { setMenu(!rail.classList.contains('open')); });
    if (scrim) scrim.addEventListener('click', function () { setMenu(false); mb.focus(); });
    if (rc) rc.addEventListener('click', function () { setMenu(false); mb.focus(); });
    if (mq.addEventListener) mq.addEventListener('change', function () { setMenu(false); });
    $$('a[href]', rail).forEach(function (a) { a.addEventListener('click', function () { if (mq.matches && !a.hasAttribute('data-open')) setMenu(false); }); });
    /* фокусът не излиза от чекмеджето, докато е отворено */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !mq.matches || !rail.classList.contains('open')) return;
      var f = $$('a[href],button', rail).filter(function (x) { return x.offsetParent !== null && getComputedStyle(x).visibility !== 'hidden'; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* Раздели като акордеон: мишка, допир и клавиатура */
  var items = $$('nav.main li.has');
  function setOpen(li, o) { li.classList.toggle('open', o); $('.nl', li).setAttribute('aria-expanded', o ? 'true' : 'false'); }
  items.forEach(function (li) {
    var btn = $('.nl', li);
    btn.addEventListener('click', function () {
      var o = !li.classList.contains('open');
      if (o) items.forEach(function (x) { if (x !== li) setOpen(x, false); });
      setOpen(li, o);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($$('dialog').some(function (d) { return d.open; })) return;
    if (rail && rail.classList.contains('open') && mq.matches) { setMenu(false); mb.focus(); return; }
    var o = items.filter(function (l) { return l.classList.contains('open') && l.contains(document.activeElement); })[0];
    if (o) { setOpen(o, false); $('.nl', o).focus(); }
  });

  /* Тема: започва светла */
  var tb = $('#themeBtn');
  if (tb) { tb.setAttribute('aria-pressed', 'false'); tb.addEventListener('click', function () { var d = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; root.setAttribute('data-theme', d); tb.setAttribute('aria-pressed', d === 'dark' ? 'true' : 'false'); }); }

  /* Прозорци (с резервен вариант за стари браузъри) */
  function openD(d) { if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else { d.classList.add('nomodal'); d.setAttribute('open', ''); } document.body.style.overflow = 'hidden'; }
  function closeD(d) { if (typeof d.close === 'function') { d.close(); } else { d.removeAttribute('open'); } document.body.style.overflow = ''; }
  $$('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) closeD(d); });
    d.addEventListener('close', function () { document.body.style.overflow = ''; });
    $$('[data-close]', d).forEach(function (b) { b.addEventListener('click', function () { closeD(d); }); });
  });
  $$('[data-open]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var d = $('#' + a.getAttribute('data-open')); if (!d) return;
      e.preventDefault(); if (rail && mq.matches) setMenu(false); openD(d);
    });
  });

  /* Копиране */
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-copy'), old = b.textContent;
      function ok() { b.textContent = 'Копирано'; setTimeout(function () { b.textContent = old; }, 1600); }
      function sel() { var r = document.createRange(), el = b.parentNode.querySelector('b'); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      function fb() {
        var ta = document.createElement('textarea'), done = false;
        ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
        try { done = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        if (done) ok(); else sel();
      }
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(t).then(ok, fb); } else { fb(); }
    });
  });

  /* Търсене в сайта (данните са в search-data.js) */
  var q = $('#q'), res = $('#res'), none = $('#none');
  function render() {
    if (!q || !window.SEARCH) return;
    var t = q.value.trim().toLowerCase();
    var list = t ? window.SEARCH.filter(function (p) { return (p[0] + ' ' + p[1]).toLowerCase().indexOf(t) > -1; }) : window.SEARCH.slice(0, 8);
    list = list.slice(0, 40);
    res.innerHTML = ''; none.hidden = list.length > 0;
    var sc = $('#sCount'); if (sc) sc.textContent = list.length ? list.length + ' резултата' : 'Няма резултати';
    list.forEach(function (p) {
      var li = document.createElement('li'), a = document.createElement('a'), s = document.createElement('span');
      a.href = ROOT + p[2]; a.appendChild(document.createTextNode(p[0])); s.textContent = p[1]; a.appendChild(s); li.appendChild(a); res.appendChild(li);
    });
  }
  function openSearch() { var d = $('#dlgSearch'); if (!d) return; if (rail && mq.matches) setMenu(false); render(); openD(d); q.focus(); }
  if (q) {
    q.addEventListener('input', render);
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var a = $('#res a'); if (a) window.location.href = a.href; }
      else if (e.key === 'Escape') { e.preventDefault(); closeD($('#dlgSearch')); } /* в поле за търсене първото Esc само изчиства текста */
    });
  }
  $$('[data-search]').forEach(function (b) { b.addEventListener('click', openSearch); });
  document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'k') { e.preventDefault(); openSearch(); } });

  /* Филтър на документи */
  var df = $('#docFilter');
  if (df) {
    var rows = $$('ul.docs li'), cnt = $('#docCount');
    var upd = function () {
      var t = df.value.trim().toLowerCase(), n = 0;
      rows.forEach(function (li) { var m = !t || li.textContent.toLowerCase().indexOf(t) > -1; li.hidden = !m; if (m) n++; });
      if (cnt) cnt.textContent = n ? n + ' от ' + rows.length + ' документа' : 'Няма съвпадения';
    };
    df.addEventListener('input', upd); upd();
  }

  /* Филтър на новини */
  var nf = $('#newsFilter');
  if (nf) {
    var cards = $$('.ncard'), cat = '', ncount = $('#newsCount'), showAll = false, LIMIT = 24, more = $('#moreNews');
    var firstGrid = $$('.ngrid')[0] ? $$('.ncard', $$('.ngrid')[0]) : [];
    var run = function () {
      var t = nf.value.trim().toLowerCase(), n = 0, limited = !t && !cat && !showAll;
      cards.forEach(function (c) {
        var m = (!t || c.textContent.toLowerCase().indexOf(t) > -1) && (!cat || (c.getAttribute('data-cats') || '').indexOf('|' + cat + '|') > -1);
        if (m && limited && firstGrid.indexOf(c) >= LIMIT) m = false;
        c.hidden = !m; if (m) n++;
      });
      if (more) more.hidden = !(limited && firstGrid.length > LIMIT);
      if (ncount) ncount.textContent = n + ' новини';
    };
    nf.addEventListener('input', run);
    if (more) more.addEventListener('click', function () { showAll = true; run(); });
    $$('.chip[data-cat]').forEach(function (ch) {
      ch.addEventListener('click', function () {
        cat = ch.getAttribute('data-cat');
        $$('.chip[data-cat]').forEach(function (x) { x.setAttribute('aria-pressed', x === ch ? 'true' : 'false'); });
        run();
      });
    });
    run();
  }

  /* Ефект при показване: само движение, текстът остава видим */
  var rv = $$('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    rv.forEach(function (el) { io.observe(el); });
    setTimeout(function () { rv.forEach(function (el) { el.classList.add('in'); }); }, 8000);
  } else { rv.forEach(function (el) { el.classList.add('in'); }); }

  /* Светлинен лъч, който следва показалеца върху плочките */
  if (!reduce && window.matchMedia && window.matchMedia('(hover:hover)').matches) {
    $$('.tile').forEach(function (t) {
      t.addEventListener('pointermove', function (e) {
        var r = t.getBoundingClientRect();
        t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }
})();
