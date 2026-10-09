/* Поканата: зарежда data/couple.json и пълни страницата */
(function () {
  const $ = id => document.getElementById(id);
  const PLACEHOLDER = 'img/couple-placeholder.svg';
  const params = new URLSearchParams(location.search);
  const guestParam = params.get('g');

  const dayFmt = new Intl.DateTimeFormat('bg-BG', { dateStyle: 'long', timeZone: 'Europe/Sofia' });
  const dateOnly = new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Sofia' });
  const weekdayFmt = new Intl.DateTimeFormat('bg-BG', { weekday: 'long', timeZone: 'Europe/Sofia' });
  const timeFmt = new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Sofia' });

  const pad = n => String(n).padStart(2, '0');

  function setNum(el, text) {
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('f');
    void el.offsetWidth;
    el.classList.add('f');
  }

  function startCountdown(target) {
    function tick() {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) {
        $('countdown').hidden = true;
        $('cd-done').hidden = false;
        return false;
      }
      setNum($('cd-days'), String(Math.floor(diff / 86400000)));
      setNum($('cd-hours'), pad(Math.floor((diff % 86400000) / 3600000)));
      setNum($('cd-minutes'), pad(Math.floor((diff % 3600000) / 60000)));
      setNum($('cd-seconds'), pad(Math.floor((diff % 60000) / 1000)));
      return true;
    }
    if (tick()) {
      const t = setInterval(() => { if (!tick()) clearInterval(t); }, 1000);
    }
  }

  function renderProgram(items) {
    const list = $('program-list');
    (items || []).forEach(item => {
      const li = document.createElement('li');
      li.className = 'shift';
      const time = document.createElement('time');
      time.textContent = item.time;
      const box = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = item.title;
      box.appendChild(h);
      if (item.text) {
        const p = document.createElement('p');
        p.textContent = item.text;
        box.appendChild(p);
      }
      li.append(time, box);
      list.appendChild(li);
    });
  }

  function renderDress(dress) {
    if (!dress || !Array.isArray(dress.colors) || !dress.colors.length) return;
    const wrap = $('dress-colors');
    dress.colors.forEach(c => {
      if (!/^#[0-9a-fA-F]{6}$/.test(c.hex || '')) return;
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = c.hex;
      sw.title = c.title || '';
      sw.setAttribute('role', 'img');
      sw.setAttribute('aria-label', c.title || c.hex);
      wrap.appendChild(sw);
    });
    $('dress-note').textContent = dress.note || '';
    $('dress-section').hidden = false;
  }

  let DATA = null;
  function applyLookText() {
    if (!DATA) return;
    const look = window.WeddingLook ? WeddingLook.name : 'garden';
    const t = (DATA.looks && DATA.looks[look]) || {};
    const k = document.querySelector('.kicker'); if (k) k.textContent = t.kicker || 'Каним ви на нашата сватба';
    const h = document.querySelector('.chint'); if (h) h.textContent = t.hint || 'Докоснете, за да отворите';
    $('welcome').textContent = t.welcome || DATA.welcome || '';
    document.querySelectorAll('.looks button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.look === look)));
  }
  function buildSwitcher() {
    if (!DATA.demo || !DATA.looks || !window.WeddingLook || document.querySelector('.looks')) return;
    const dots = { garden: '#4A62A8', emerald: '#14392E', blush: '#E8A2B2', noir: '#161616', gold: '#D4AE58' };
    const bar = document.createElement('div');
    bar.className = 'looks';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Вариант на дизайна');
    bar.setAttribute('data-testid', 'looks');
    WeddingLook.all.forEach(name => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.look = name;
      const dot = document.createElement('i');
      dot.style.background = dots[name];
      b.append(dot, document.createTextNode((DATA.looks[name] && DATA.looks[name].label) || name));
      b.addEventListener('click', () => WeddingLook.set(name));
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  async function main() {
    let data;
    try {
      const res = await fetch('data/couple.json');
      if (!res.ok) throw new Error('load');
      data = await res.json();
    } catch (e) {
      $('couple-names').textContent = 'Поканата не може да се зареди.';
      $('couple-names').classList.remove('sr-only');
      const cv = $('cover'); if (cv) cv.remove();
      document.documentElement.classList.remove('locked');
      return;
    }

    DATA = data;
    const first = data.couple.first, second = data.couple.second;
    const names = first + ' и ' + second;
    $('couple-names').textContent = names;
    document.title = names + ' – покана за сватба';
    $('name1').textContent = first;
    $('name2').textContent = second;
    document.querySelectorAll('.seal-t').forEach(t => { t.textContent = first.charAt(0) + '&' + second.charAt(0); });

    if (data.demo) {
      $('demo-badge').hidden = false;
      $('footer-promo').hidden = false;
    }

    const when = new Date(data.wedding.datetime);
    $('date-line').textContent = dateOnly.format(when).replace(/\s*г\.$/, '');
    const place = data.wedding.placeLine ? ' · ' + data.wedding.placeLine : '';
    $('place-line').textContent = weekdayFmt.format(when) + ' · ' + timeFmt.format(when) + place;
    startCountdown(when);
    applyLookText();
    buildSwitcher();
    applyLookText();
    document.addEventListener('lookchange', applyLookText);

    const img = $('couple-photo');
    img.alt = 'Снимка на ' + names;
    img.addEventListener('error', () => {
      if (!img.src.endsWith(PLACEHOLDER)) img.src = PLACEHOLDER;
    });
    img.src = data.photo || PLACEHOLDER;

    renderProgram(data.program);

    $('venue-name').textContent = data.venue.name;
    $('venue-text').textContent = [data.venue.address, data.venue.note].filter(Boolean).join(' · ');
    $('directions').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(data.venue.mapsQuery);

    renderDress(data.dresscode);

    if (data.rsvpDeadline) {
      $('rsvp-deadline').textContent = 'Моля, отговорете до ' + dayFmt.format(new Date(data.rsvpDeadline)) + '.';
    }

    const guest = (data.guests || []).find(g => g.code === guestParam) || null;
    if (guest) {
      $('greeting').textContent = 'Здравейте, ' + guest.name + '!';
      $('greeting').hidden = false;
    }

    if (data.gallery) {
      const opens = new Date(data.gallery.opensAt);
      const link = $('gallery-link');
      link.href = 'gallery.html' + (guest ? '?g=' + encodeURIComponent(guest.code) : '');
      if (Date.now() >= opens.getTime()) {
        $('gallery-note').textContent = 'Разгледайте снимките и видеата от празника и добавете свои.';
      } else {
        link.classList.add('soon');
        $('gallery-note').textContent =
          'От ' + dayFmt.format(opens) + ' тук ще можете да разглеждате и качвате снимки и видео от празника.';
      }
    }

    RSVP.init({
      guestCode: guest ? guest.code : null,
      maxSeats: guest ? guest.seats : data.defaultSeats,
      defaultName: guest ? guest.name : ''
    });

    Scene.init();
    Petals.start();
  }

  main();
})();
