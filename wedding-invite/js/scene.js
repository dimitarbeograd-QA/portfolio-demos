/* Сцената: плик, 3D картичка, венец от листа, появяване при скрол */
(function () {
  const $ = id => document.getElementById(id);
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  let timers = [];
  const root = document.documentElement;
  function lock() { root.classList.add('locked'); document.body.classList.remove('opened'); }
  function unlock() { root.classList.remove('locked'); document.body.classList.add('opened'); }

  function buildLeaves() {
    const g = $('leaves');
    if (!g) return;
    g.textContent = '';
    const cs = getComputedStyle(document.documentElement);
    const c1 = cs.getPropertyValue('--lf1').trim() || '#4A62A8';
    const c2 = cs.getPropertyValue('--lf2').trim() || '#7F97CC';
    const c3 = cs.getPropertyValue('--lf3').trim() || '#9FB0DA';
    const N = 34, R = 160;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = 200 + Math.cos(a) * R;
      const y = 200 + Math.sin(a) * R;
      const deg = (a * 180) / Math.PI + 90;
      const out = i % 2 ? 1 : -1;
      const grp = document.createElementNS(NS, 'g');
      grp.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + (deg + out * 58).toFixed(1) + ')');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M0 0 C 7 -8 7 -22 0 -32 C -7 -22 -7 -8 0 0Z');
      p.setAttribute('class', 'lf');
      p.setAttribute('fill', i % 5 === 0 ? c3 : (i % 2 ? c1 : c2));
      p.style.animationDelay = (0.3 + i * 0.06) + 's';
      grp.appendChild(p);
      g.appendChild(grp);
    }
  }

  function buildSparks() {
    const stage = $('stage');
    if (!stage || stage.querySelector('.spark')) return;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 90 + Math.random() * 130;
      const sp = document.createElement('i');
      sp.className = 'spark';
      sp.style.setProperty('--dx', (Math.cos(a) * r).toFixed(0) + 'px');
      sp.style.setProperty('--dy', (Math.sin(a) * r * 0.9 + 30).toFixed(0) + 'px');
      sp.style.setProperty('--d', (Math.random() * 0.5).toFixed(2) + 's');
      sp.style.setProperty('--s', (0.6 + Math.random() * 1.1).toFixed(2));
      stage.appendChild(sp);
    }
    const sh = document.createElement('div');
    sh.className = 'shine';
    $('paper').appendChild(sh);
  }

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  const params = new URLSearchParams(location.search);
  const skipIntro = reduced || window.Cypress || params.get('intro') === '0';

  function finish() {
    const cover = $('cover');
    if (cover) cover.classList.add('done');
    unlock();
  }

  function open() {
    const cover = $('cover'), stage = $('stage');
    if (!cover || cover.classList.contains('open')) return;
    timers.forEach(clearTimeout);
    timers = [];
    cover.classList.add('open');
    later(() => stage.classList.add('go'), 3200);
    later(finish, 3400);
  }

  function play() {
    const cover = $('cover'), stage = $('stage');
    if (skipIntro || !cover) {
      if (cover) cover.classList.add('done');
      stage.classList.add('go');
      unlock();
      return;
    }
    lock();
    // блясък и дълбочина, които следват пръста или курсора
    const glare = cover.querySelector('.cglare');
    let raf = 0, ev = null;
    const apply = () => {
      raf = 0;
      const x = ev.clientX, y = ev.clientY;
      if (glare) glare.style.transform = 'translate3d(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px,0)';
      cover.style.setProperty('--px', ((x / innerWidth - 0.5) * 2).toFixed(2));
      cover.style.setProperty('--py', ((y / innerHeight - 0.5) * 2).toFixed(2));
    };
    const mv = e => { ev = e; if (!raf) raf = requestAnimationFrame(apply); };
    cover.addEventListener('pointermove', mv);
    cover.addEventListener('pointerdown', mv);
    const st = $('cstars');
    if (st && !st.childNodes.length) {
      for (let i = 0; i < 9; i++) {
        const t = document.createElement('i');
        t.style.left = (6 + Math.random() * 88).toFixed(1) + '%';
        t.style.top = (6 + Math.random() * 88).toFixed(1) + '%';
        t.style.setProperty('--d', (Math.random() * 3.5).toFixed(2) + 's');
        t.style.setProperty('--t', (2.6 + Math.random() * 2).toFixed(2) + 's');
        t.style.transformOrigin = 'center';
        st.appendChild(t);
      }
    }
    cover.addEventListener('click', open);
    cover.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    later(open, 5200);
  }

  function replay() {
    const cover = $('cover'), stage = $('stage');
    if (!cover) return;
    timers.forEach(clearTimeout);
    timers = [];
    stage.classList.remove('go');
    window.scrollTo(0, 0);
    lock();
    cover.classList.remove('open', 'done');
    void cover.offsetWidth;
    later(open, 5200);
  }

  function tilt(box, el, paper, needGo) {
    if (!box || !el || reduced) return;
    box.style.touchAction = 'pan-y';
    const rest = () => {
      el.style.transform = '';
      if (paper) { paper.style.setProperty('--gx', '50%'); paper.style.setProperty('--gy', '30%'); }
    };
    box.addEventListener('pointermove', e => {
      if (needGo && !$('stage').classList.contains('go')) return;
      const r = box.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = 'perspective(800px) rotateY(' + (px * 18).toFixed(2) + 'deg) rotateX(' + (-py * 14).toFixed(2) + 'deg)';
      if (paper) {
        paper.style.setProperty('--gx', ((px + 0.5) * 100).toFixed(0) + '%');
        paper.style.setProperty('--gy', ((py + 0.5) * 100).toFixed(0) + '%');
      }
    });
    box.addEventListener('pointerleave', rest);
    box.addEventListener('pointercancel', rest);
    box.addEventListener('pointerup', e => { if (e.pointerType === 'touch') rest(); });
  }

  function reveal() {
    const els = document.querySelectorAll('.shift');
    if (reduced || !('IntersectionObserver' in window)) {
      els.forEach(e => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.15 });
    els.forEach((e, k) => { e.style.transitionDelay = (k % 5) * 0.1 + 's'; io.observe(e); });
  }

  function parallax() {
    if (reduced) return;
    const a = $('pa'), b = $('pb'), c = $('pc');
    let ticking = false;
    function update() {
      const y = window.scrollY;
      a.style.transform = 'translateY(' + (-y * 0.12) + 'px) rotate(' + (20 + y * 0.01) + 'deg)';
      b.style.transform = 'translateY(' + (-y * 0.22) + 'px) rotate(' + (-30 - y * 0.012) + 'deg)';
      c.style.transform = 'translateY(' + (-y * 0.35) + 'px) rotate(' + (10 + y * 0.02) + 'deg)';
      ticking = false;
    }
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  window.Scene = {
    init() {
      buildLeaves();
      document.addEventListener('lookchange', () => { buildLeaves(); replay(); });
      buildSparks();
      play();
      $('replay').addEventListener('click', replay);
      tilt($('stage').parentNode, $('tilt'), $('paper'), true);
      tilt($('photo-box'), $('photo-tilt'), null, false);
      reveal();
      parallax();
    },
    reveal
  };
})();
