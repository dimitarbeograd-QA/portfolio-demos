/* СУ „Димитър Маринов“ – общ скрипт. Без външни библиотеки. */
(function () {
  var root = document.documentElement;
  var ROOT = root.getAttribute('data-root') || '';
  root.classList.add('js');
  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }

  /* Хедър: сянка при скрол */
  var bar = $('#bar');
  function onScroll() { if (bar) bar.classList.toggle('stuck', window.pageYOffset > 8); }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* Мобилно меню */
  var mb = $('#menuBtn'), nav = $('#nav');
  function setMenu(o) { nav.classList.toggle('open', o); mb.setAttribute('aria-expanded', o); mb.textContent = o ? 'Затвори' : 'Меню'; }
  if (mb && nav) mb.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });

  /* Падащи менюта */
  var items = $$('nav.main li.has'), timer;
  function closeAll(except) { items.forEach(function (li) { if (li !== except) { li.classList.remove('open'); $('.nl', li).setAttribute('aria-expanded', 'false'); } }); }
  function open(li) { closeAll(li); li.classList.add('open'); $('.nl', li).setAttribute('aria-expanded', 'true'); }
  function close(li) { li.classList.remove('open'); $('.nl', li).setAttribute('aria-expanded', 'false'); }
  var hoverOk = window.matchMedia && window.matchMedia('(hover:hover) and (min-width:1181px)');
  items.forEach(function (li) {
    var btn = $('.nl', li);
    btn.addEventListener('click', function (e) {
      /* мишка при посочване: менюто вече е отворено, затова само го държим отворено; клавиатура и допир превключват */
      if (hoverOk && hoverOk.matches && e.detail > 0) { clearTimeout(timer); open(li); }
      else { li.classList.contains('open') ? close(li) : open(li); }
    });
    li.addEventListener('mouseenter', function () { if (hoverOk && hoverOk.matches) { clearTimeout(timer); open(li); } });
    li.addEventListener('mouseleave', function () { if (hoverOk && hoverOk.matches) { timer = setTimeout(function () { close(li); }, 160); } });
    li.addEventListener('focusout', function (e) { if (hoverOk && hoverOk.matches && !li.contains(e.relatedTarget)) close(li); });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('nav.main')) closeAll(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var o = items.filter(function (l) { return l.classList.contains('open'); })[0];
      if (o) { close(o); $('.nl', o).focus(); }
      else if (nav && nav.classList.contains('open')) { setMenu(false); mb.focus(); }
    }
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
      e.preventDefault(); if (nav) setMenu(false); openD(d);
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
  function openSearch() { var d = $('#dlgSearch'); if (!d) return; render(); openD(d); q.focus(); }
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
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.08 });
    rv.forEach(function (el) { io.observe(el); });
    setTimeout(function () { rv.forEach(function (el) { el.classList.add('in'); }); }, 2500);
  } else { rv.forEach(function (el) { el.classList.add('in'); }); }
})();
