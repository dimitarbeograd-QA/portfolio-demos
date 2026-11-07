(() => {
'use strict';

/* ═══════════ Помощни ═══════════ */
const $ = (sel, root = document) => root.querySelector(sel);

// Безопасно създаване на DOM: текстът винаги минава през textContent (без innerHTML → без XSS).
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') {
      // CSP забранява style="" атрибути → задаваме свойствата през CSSOM.
      for (const decl of String(v).split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(method, url, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); } catch { throw Object.assign(new Error('Няма връзка със сървъра.'), { status: 0 }); }
  let data = {};
  try { data = await res.json(); } catch { /* празен отговор */ }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Нещо се обърка.'), { status: res.status });
  return data;
}

function toast(msg, isError) {
  const t = h('div', { class: 'toast' + (isError ? ' error' : ''), text: msg });
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 450); }, isError ? 5000 : 2800);
}

const GENDER = { male: 'Мъж', female: 'Жена', other: 'Друго' };
const LOOKING = { male: 'Мъже', female: 'Жени', any: 'Всички' };

// Аватар по подразбиране (когато няма снимка) – SVG с градиент и инициал.
function avatar(nick, gender) {
  let hash = 0;
  for (const c of nick) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  const hue = 190 + (hash % 70);
  const hue2 = (hue + 40) % 360;
  const letter = [...nick][0].toUpperCase().replace(/[<>&"']/g, '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 32%)"/><stop offset="1" stop-color="hsl(${hue2} 75% 16%)"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><circle cx="200" cy="190" r="70" fill="hsl(${hue} 80% 75% / .18)"/><path d="M60 500c0-95 60-150 140-150s140 55 140 150z" fill="hsl(${hue} 80% 75% / .14)"/><text x="200" y="228" font-family="Segoe UI,Arial,sans-serif" font-size="110" font-weight="700" text-anchor="middle" fill="hsl(${hue} 90% 88%)">${letter}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const mainPhoto = p => (p.photos[0] ? p.photos[0].url : avatar(p.nickname, p.gender));

/* ═══════════ Тема / персонализация ═══════════ */
const DEFAULT_THEME = {
  text: '#bfe3ff', heading: '#ffffff', accent: '#5cc8ff', border: '#24477a',
  surface: '#0f1626', bg: '#070b14',
  fontScale: 100, radius: 16, borderWidth: 1, glow: 40, animations: true,
};
const PRESETS = [
  { name: 'Ледено синьо', c: { ...DEFAULT_THEME } },
  { name: 'Нощен океан', c: { text: '#a8d0ff', heading: '#f2f8ff', accent: '#4aa3ff', border: '#1f3f73', surface: '#0b1220', bg: '#050810' } },
  { name: 'Неонов циан', c: { text: '#b6fff6', heading: '#ffffff', accent: '#19f0d8', border: '#0f6f6a', surface: '#07151a', bg: '#03090c', glow: 70 } },
  { name: 'Синьо-лилаво', c: { text: '#cfd8ff', heading: '#ffffff', accent: '#8f9bff', border: '#3b3f8f', surface: '#0f1130', bg: '#08091c' } },
  { name: 'Сребро и лед', c: { text: '#e3f2ff', heading: '#ffffff', accent: '#c9e8ff', border: '#5b7a99', surface: '#101820', bg: '#0a0f14', glow: 25 } },
];
const COLOR_FIELDS = [
  ['text', 'Цвят на текста'], ['heading', 'Заглавия и бял текст'], ['accent', 'Акцент / бутони'],
  ['border', 'Рамка на прозорците'], ['surface', 'Фон на прозорците'], ['bg', 'Фон на сайта'],
];
let theme = { ...DEFAULT_THEME };

function applyTheme(t) {
  theme = { ...DEFAULT_THEME, ...t };
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches && t && t.animations === undefined) theme.animations = false;
  const r = document.documentElement.style;
  r.setProperty('--text', theme.text); r.setProperty('--heading', theme.heading);
  r.setProperty('--accent', theme.accent); r.setProperty('--border', theme.border);
  r.setProperty('--surface', theme.surface); r.setProperty('--bg', theme.bg);
  r.setProperty('--font-scale', String(theme.fontScale / 100));
  r.setProperty('--radius', theme.radius + 'px'); r.setProperty('--bw', theme.borderWidth + 'px');
  r.setProperty('--glow', String(theme.glow / 100));
  document.documentElement.classList.toggle('no-anim', !theme.animations);
  const meta = $('meta[name=theme-color]'); if (meta) meta.content = theme.bg;
}
const saveLocal = () => { try { localStorage.setItem('spark.theme', JSON.stringify(theme)); } catch { /* ignore */ } };
// „dirty“ = има локална промяна, която още не е стигнала до сървъра → при старт тя печели над сървърната.
const setDirty = v => { try { v ? localStorage.setItem('spark.themeDirty', '1') : localStorage.removeItem('spark.themeDirty'); } catch { /* ignore */ } };
const isDirty = () => { try { return localStorage.getItem('spark.themeDirty') === '1'; } catch { return false; } };
let pendingRemote = false;
async function pushTheme(keepalive) {
  if (!state.me || !pendingRemote) return;
  pendingRemote = false;
  try {
    await fetch('/api/me/theme', { method: 'PUT', credentials: 'same-origin', keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) }).then(r => { if (!r.ok) throw new Error(); });
    setDirty(false);
  } catch { pendingRemote = true; }
}
const saveRemote = debounce(() => pushTheme(false), 700);
function changeTheme(patch) { applyTheme({ ...theme, ...patch }); saveLocal(); setDirty(true); pendingRemote = true; saveRemote(); }
window.addEventListener('pagehide', () => pushTheme(true));
function loadLocalTheme() {
  try { const t = JSON.parse(localStorage.getItem('spark.theme') || 'null'); if (t) applyTheme(t); else applyTheme({}); } catch { applyTheme({}); }
}

/* ═══════════ Състояние ═══════════ */
const state = { me: null, meta: null, unread: 0, openReports: 0 };
let chatWith = null;                 // с кого е отворен чатът
let viewTimer = null, badgeTimer = null;
const stopViewTimer = () => { if (viewTimer) { clearInterval(viewTimer); viewTimer = null; } };
async function refreshBadges() {
  if (!state.me) return;
  try {
    const r = await api('GET', '/api/chats/unread');
    if (r.unread !== state.unread || r.openReports !== state.openReports) { state.unread = r.unread; state.openReports = r.openReports; renderChrome(); }
  } catch { /* следващият опит ще мине */ }
}
function startBadges() { if (badgeTimer) return; refreshBadges(); badgeTimer = setInterval(refreshBadges, 20000); }
function stopBadges() { if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; } state.unread = 0; state.openReports = 0; }
const fmtTime = at => new Date(at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
const fmtDate = at => new Date(at).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
const fmtWhen = at => (new Date(at).toDateString() === new Date().toDateString() ? fmtTime(at) : `${fmtDate(at)}, ${fmtTime(at)}`);
const badge = n => (n > 0 ? h('span', { class: 'badge', 'aria-label': `${n} нови`, text: n > 99 ? '99+' : String(n) }) : null);
const disc = {
  city: '', q: '', gender: '', ageMin: '', ageMax: '', interests: new Set(), withPhoto: false,
  online: false, lookingForMe: false, sort: 'active', profiles: [], total: 0, loading: false,
  cityOpen: true, filtersOpen: false, token: 0,
};

/* ═══════════ Горна лента ═══════════ */
function renderChrome() {
  const route = currentRoute();
  const nav = clear($('#nav'));
  if (state.me) {
    const isAdmin = state.me.role === 'admin';
    [['#/discover', 'Открий хора', 'discover', 0]]
      .concat(isAdmin ? [] : [['#/messages', '💬 Съобщения', 'messages', state.unread]])
      .concat([['#/profile', 'Моят профил', 'profile', 0], ['#/settings', 'Дизайн и настройки', 'settings', 0]])
      .concat(isAdmin ? [['#/admin', '🛡️ Админ', 'admin', state.openReports]] : [])
      .forEach(([href, label, key, n]) => nav.append(h('a', { href, class: route === key ? 'on' : '', 'aria-current': route === key ? 'page' : null }, label, badge(n))));
  }
  const box = clear($('#userbox'));
  box.className = 'userbox';
  if (state.me) {
    box.append(
      h('span', { class: 'who', text: state.me.nickname, title: state.me.nickname }),
      h('button', { class: 'btn ghost sm', type: 'button', text: 'Изход', onclick: logout }),
    );
  } else {
    box.append(h('a', { class: 'btn sm', href: '#/', text: 'Вход / Регистрация' }));
  }
}

async function logout() {
  try { await api('POST', '/api/logout'); } catch { /* ignore */ }
  state.me = null; disc.profiles = []; chatWith = null; stopBadges();
  location.hash = '#/';
  route();
  toast('Излязохте от профила си.');
}

/* ═══════════ Модални прозорци ═══════════ */
let lastFocus = null;
function openModal(content, { narrow = false, title = '' } = {}) {
  closeModal();
  lastFocus = document.activeElement;
  const root = $('#modalRoot');
  const win = h('div', { class: 'win modal' + (narrow ? ' narrow' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Прозорец', tabindex: '-1' },
    h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h3', { text: title }),
      h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Затвори', text: '✕', onclick: closeModal })),
    h('div', { class: 'win-body' }, content));
  const ov = h('div', { class: 'overlay', onmousedown: e => { if (e.target === ov) closeModal(); } }, win);
  root.append(ov);
  document.body.style.overflow = 'hidden';
  win.focus();
}
function closeModal() {
  const root = $('#modalRoot');
  if (!root.firstChild) return;
  clear(root);
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ═══════════ Начална страница + вход ═══════════ */
function viewLanding() {
  const meta = state.meta;
  const withPeople = meta.cities.filter(c => c.count > 0).sort((a, b) => b.count - a.count);
  const v = clear($('#view'));

  const authBody = h('div');
  let mode = 'login';
  const showMode = m => { mode = m; clear(authBody).append(m === 'login' ? loginForm() : registerForm()); tabs.forEach(([k, b]) => b.setAttribute('aria-selected', String(k === m))); };
  const tabs = [['login', h('button', { type: 'button', role: 'tab', text: 'Вход', onclick: () => showMode('login') })],
                ['register', h('button', { type: 'button', role: 'tab', text: 'Регистрация', onclick: () => showMode('register') })]];

  v.append(
    h('section', { class: 'hero' },
      h('div', { class: 'enter' },
        h('h1', {}, 'Намери своя ', h('span', { text: 'искра' }), ' в твоя град'),
        h('p', { class: 'lead', text: 'Създай профил с никнейм, снимки и био, избери град и разгледай хора близо до теб. Филтрирай по възраст, интереси и още. Оформи сайта със свои цветове.' }),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', { text: String(meta.total) }), h('span', { text: 'профила' })),
          h('div', { class: 'stat' }, h('b', { text: String(withPeople.length) }), h('span', { text: 'града с хора' })),
          h('div', { class: 'stat' }, h('b', { text: '18+' }), h('span', { text: 'само пълнолетни' }))),
        h('div', { class: 'cityline', 'aria-label': 'Най-активни градове' },
          withPeople.slice(0, 8).map(c => h('span', { class: 'tag', text: `${c.name} · ${c.count}` })))),
      h('div', { class: 'win enter', style: '--i:2' },
        h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: 'Добре дошъл' })),
        h('div', { class: 'win-body' }, h('div', { class: 'tabs', role: 'tablist' }, tabs.map(t => t[1])), authBody))),
    h('section', { class: 'feat' },
      [['📍', 'Хора по градове', 'Избери град от списъка и виж кой е наблизо.'],
       ['🎛️', 'Умни филтри', 'Възраст, пол, интереси, онлайн сега, само със снимка.'],
       ['🖼️', 'Профил със снимки', 'До 6 снимки, никнейм, био и интереси.'],
       ['🎨', 'Твой собствен дизайн', 'Цветове на текста, рамките, размер на шрифта и още.']]
        .map(([i, t, d], n) => h('div', { class: 'win enter', style: `--i:${n + 3}` }, h('div', { class: 'win-body' }, h('h3', {}, h('span', { class: 'ico', text: i }), t), h('p', { class: 'dim', text: d }))))));
  showMode('login');

  function loginForm() {
    const err = h('div', { class: 'err', role: 'alert' });
    const u = h('input', { id: 'l-user', autocomplete: 'username', required: true, maxlength: '30' });
    const p = h('input', { id: 'l-pass', type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn block', type: 'submit', text: 'Влез' });
    return h('form', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      try { const r = await api('POST', '/api/login', { username: u.value, password: p.value }); await afterAuth(r.user); }
      catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
    } },
      h('div', { class: 'field' }, h('label', { for: 'l-user', text: 'Потребителско име' }), u),
      h('div', { class: 'field' }, h('label', { for: 'l-pass', text: 'Парола' }), p),
      err, btn,
      state.meta.demoAdmin ? h('button', { class: 'btn ghost block', type: 'button', style: 'margin-top:.7rem', text: '🔑 Вход като администратор (без парола)', onclick: async e => {
        e.currentTarget.disabled = true; err.textContent = '';
        try { const r = await api('POST', '/api/demo-admin'); await afterAuth(r.user); location.hash = '#/admin'; route(); }
        catch (x) { err.textContent = x.message; e.currentTarget.disabled = false; }
      } }) : null,
      h('p', { class: 'hint', text: state.meta.demoAdmin ? 'Демо режим: администраторският вход е без парола и показва сайта отвътре.' : 'Нямаш профил? Натисни „Регистрация“ по-горе.' }));
  }

  function registerForm() {
    const err = h('div', { class: 'err', role: 'alert' });
    const f = {
      username: h('input', { id: 'r-user', autocomplete: 'username', required: true, maxlength: '30', placeholder: 'само за вход, не се показва' }),
      nickname: h('input', { id: 'r-nick', autocomplete: 'nickname', required: true, maxlength: '20', placeholder: 'виждат го другите' }),
      password: h('input', { id: 'r-pass', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', maxlength: '72' }),
      birthDate: h('input', { id: 'r-birth', type: 'date', required: true, max: new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10) }),
      gender: h('select', { id: 'r-gender' }, h('option', { value: '', text: 'Избери…' }), Object.entries(GENDER).map(([k, t]) => h('option', { value: k, text: t }))),
      lookingFor: h('select', { id: 'r-look' }, Object.entries(LOOKING).map(([k, t]) => h('option', { value: k, text: t, selected: k === 'any' }))),
      city: h('select', { id: 'r-city' }, h('option', { value: '', text: 'Избери град…' }), state.meta.cities.map(c => h('option', { value: c.name, text: c.name }))),
    };
    const btn = h('button', { class: 'btn block', type: 'submit', text: 'Създай профил' });
    return h('form', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      btn.disabled = true;
      try { const r = await api('POST', '/api/register', body); await afterAuth(r.user, true); }
      catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
    } },
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'r-nick', text: 'Никнейм' }), f.nickname),
        h('div', { class: 'field' }, h('label', { for: 'r-user', text: 'Потребителско име' }), f.username)),
      h('div', { class: 'field' }, h('label', { for: 'r-pass', text: 'Парола (мин. 8 символа)' }), f.password),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'r-birth', text: 'Дата на раждане' }), f.birthDate),
        h('div', { class: 'field' }, h('label', { for: 'r-city', text: 'Град' }), f.city)),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'r-gender', text: 'Аз съм' }), f.gender),
        h('div', { class: 'field' }, h('label', { for: 'r-look', text: 'Търся' }), f.lookingFor)),
      h('p', { class: 'hint', text: 'С регистрацията потвърждаваш, че си навършил 18 години. Възрастта ти се показва, датата на раждане – не.' }),
      err, btn);
  }
}

// Сървърната тема печели, освен ако локално има по-нова, още неизпратена промяна.
function adoptServerTheme(user) {
  if (!user) return;
  const server = user.theme && Object.keys(user.theme).length ? user.theme : null;
  if (isDirty() || !server) { pendingRemote = true; pushTheme(false); }
  else { applyTheme(server); saveLocal(); }
}

async function afterAuth(user, isNew) {
  state.me = user;
  adoptServerTheme(user);
  location.hash = isNew ? '#/profile' : '#/discover';
  route();
  toast(isNew ? `Добре дошъл, ${user.nickname}! Добави снимки и био.` : `Здравей отново, ${user.nickname}!`);
}

/* ═══════════ Открий хора ═══════════ */
function viewDiscover() {
  const v = clear($('#view'));
  const total = state.meta.cities.reduce((s, c) => s + c.count, 0);

  const citiesWin = h('section', { class: 'win enter', id: 'citiesWin', 'aria-label': 'Избор на град' });
  const results = h('section', { 'aria-label': 'Резултати' });
  const sidebar = h('aside', { class: 'sidebar win enter' + (disc.filtersOpen ? '' : ' closed'), style: '--i:1', 'aria-label': 'Филтри' });

  v.append(
    h('button', { class: 'btn ghost sm filter-toggle', type: 'button', text: '🎛️ Филтри', onclick: () => { disc.filtersOpen = !disc.filtersOpen; sidebar.classList.toggle('closed', !disc.filtersOpen); } }),
    h('div', { class: 'layout' }, sidebar, h('div', { class: 'stack' }, citiesWin, results)));

  function renderCities() {
    clear(citiesWin);
    const head = h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')),
      h('h2', { text: disc.city ? `📍 ${disc.city}` : '📍 Избери град' }));
    if (disc.city) head.append(h('button', { class: 'btn ghost sm', style: 'margin-left:auto', type: 'button', text: disc.cityOpen ? 'Скрий' : 'Смени града', 'aria-expanded': String(disc.cityOpen), onclick: () => { disc.cityOpen = !disc.cityOpen; renderCities(); } }));
    citiesWin.append(head);
    if (disc.cityOpen) {
      const grid = h('div', { class: 'cities' },
        h('button', { class: 'city', type: 'button', 'aria-pressed': String(!disc.city), onclick: () => pickCity('') }, h('span', { text: 'Всички градове' }), h('small', { text: String(total) })),
        state.meta.cities.map(c => h('button', { class: 'city' + (c.count ? '' : ' empty'), type: 'button', 'aria-pressed': String(disc.city === c.name), onclick: () => pickCity(c.name) },
          h('span', { text: c.name }), h('small', { text: String(c.count) }))));
      citiesWin.append(h('div', { class: 'win-body' }, grid));
    }
  }
  function pickCity(name) { disc.city = name; disc.cityOpen = !name; renderCities(); load(true); }

  function renderFilters() {
    clear(sidebar);
    const upd = debounce(() => load(true), 300);
    const num = (key, ph, min, max) => h('input', { type: 'number', inputmode: 'numeric', min, max, placeholder: ph, value: disc[key], 'aria-label': ph === 'от' ? 'Възраст от' : 'Възраст до',
      oninput: e => { disc[key] = e.target.value; upd(); } });
    const chk = (key, label) => h('div', { class: 'checkline' }, h('input', { type: 'checkbox', id: 'f-' + key, checked: disc[key], onchange: e => { disc[key] = e.target.checked; load(true); } }), h('label', { for: 'f-' + key, text: label }));
    const genderChips = [['', 'Всички'], ...Object.entries(GENDER)].map(([k, t]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(disc.gender === k), text: t, onclick: () => { disc.gender = k; renderFilters(); load(true); } }));

    sidebar.append(
      h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h3', { text: '🎛️ Филтри' })),
      h('div', { class: 'win-body' },
        h('div', { class: 'fgroup' }, h('label', { for: 'f-q', text: 'Търси по никнейм' }), h('input', { id: 'f-q', value: disc.q, maxlength: '30', placeholder: 'напр. Мила', oninput: e => { disc.q = e.target.value; upd(); } })),
        h('div', { class: 'fgroup' }, h('label', { text: 'Пол' }), h('div', { class: 'chips' }, genderChips)),
        h('div', { class: 'fgroup' }, h('label', { text: 'Възраст' }), h('div', { class: 'agepair' }, num('ageMin', 'от', 18, 99), h('span', { text: '–' }), num('ageMax', 'до', 18, 99))),
        h('div', { class: 'fgroup' }, h('label', { text: 'Интереси (поне един)' }),
          h('div', { class: 'chips' }, state.meta.interests.map(i => h('button', { class: 'chip', type: 'button', text: i, 'aria-pressed': String(disc.interests.has(i)),
            onclick: e => { disc.interests.has(i) ? disc.interests.delete(i) : disc.interests.add(i); e.currentTarget.setAttribute('aria-pressed', String(disc.interests.has(i))); upd(); } })))),
        h('div', { class: 'fgroup' }, chk('withPhoto', 'Само със снимка'), chk('online', 'Онлайн сега'), chk('lookingForMe', 'Търсят хора като мен')),
        h('button', { class: 'btn ghost block', type: 'button', text: 'Изчисти филтрите', onclick: () => {
          Object.assign(disc, { q: '', gender: '', ageMin: '', ageMax: '', withPhoto: false, online: false, lookingForMe: false }); disc.interests.clear(); renderFilters(); load(true); } })));
  }

  function renderResults() {
    clear(results);
    const sort = h('select', { 'aria-label': 'Подреждане', style: 'width:auto', onchange: e => { disc.sort = e.target.value; load(true); } },
      [['active', 'Последно активни'], ['new', 'Най-нови'], ['young', 'Най-млади'], ['old', 'Най-възрастни']].map(([k, t]) => h('option', { value: k, text: t, selected: disc.sort === k })));
    results.append(h('div', { class: 'citybar' },
      h('h2', { text: disc.loading && !disc.profiles.length ? 'Зареждане…' : `${disc.total} ${disc.total === 1 ? 'човек' : 'души'}${disc.city ? ' в ' + disc.city : ''}` }), sort));
    if (disc.loading && !disc.profiles.length) { results.append(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Зареждане' })); return; }
    if (!disc.profiles.length) {
      results.append(h('div', { class: 'win' }, h('div', { class: 'empty-state' }, h('div', { class: 'big', text: '🔍' }), h('h3', { text: 'Няма намерени профили' }), h('p', { text: 'Опитай с друг град или махни някои филтри.' }))));
      return;
    }
    results.append(h('div', { class: 'grid' }, disc.profiles.map((p, i) => profileCard(p, i))));
    if (disc.profiles.length < disc.total) {
      results.append(h('div', { style: 'text-align:center;margin-top:1.2rem' }, h('button', { class: 'btn ghost', type: 'button', text: `Покажи още (${disc.total - disc.profiles.length})`, onclick: () => load(false) })));
    }
  }

  async function load(reset) {
    const token = ++disc.token;
    disc.loading = true;
    if (reset) { disc.profiles = []; }
    renderResults();
    const p = new URLSearchParams();
    if (disc.city) p.set('city', disc.city);
    if (disc.q.trim()) p.set('q', disc.q.trim());
    if (disc.gender) p.set('gender', disc.gender);
    if (disc.ageMin) p.set('ageMin', disc.ageMin);
    if (disc.ageMax) p.set('ageMax', disc.ageMax);
    if (disc.withPhoto) p.set('withPhoto', '1');
    if (disc.online) p.set('online', '1');
    if (disc.lookingForMe) p.set('lookingForMe', '1');
    disc.interests.forEach(i => p.append('interest', i));
    p.set('sort', disc.sort); p.set('limit', '12'); p.set('offset', String(reset ? 0 : disc.profiles.length));
    try {
      const r = await api('GET', '/api/profiles?' + p);
      if (token !== disc.token) return; // по-нова заявка е изпреварила тази
      disc.profiles = reset ? r.profiles : disc.profiles.concat(r.profiles);
      disc.total = r.total;
    } catch (x) {
      if (token !== disc.token) return;
      if (x.status === 401) { state.me = null; route(); return; }
      toast(x.message, true);
    }
    disc.loading = false;
    renderResults();
  }

  renderCities(); renderFilters(); load(true);
}

function profileCard(p, i) {
  return h('button', { class: 'win card enter', type: 'button', style: `--i:${Math.min(i, 8)}`, 'aria-label': `Профил на ${p.nickname}, ${p.age} г., ${p.city}`, onclick: () => openProfile(p) },
    h('div', { class: 'ph' },
      h('img', { src: mainPhoto(p), alt: '', loading: 'lazy', width: '400', height: '500' }),
      p.isDemo ? h('span', { class: 'tag demo badge-tr', text: 'демо' }) : null,
      h('div', { class: 'over' }, h('b', { text: `${p.nickname}, ${p.age}` }), h('span', {}, p.online ? h('span', { class: 'dot', 'aria-label': 'онлайн' }) : null, `📍 ${p.city}`))),
    h('div', { class: 'meta' }, h('p', { text: p.bio || 'Още няма био.' }),
      h('div', { class: 'chips' }, p.interests.slice(0, 3).map(t => h('span', { class: 'tag', text: t })))));
}

function openProfile(p) {
  let cur = p, idx = 0;
  const body = h('div');
  const render = () => {
    clear(body);
    const photos = cur.photos.length ? cur.photos.map(x => x.url) : [avatar(cur.nickname, cur.gender)];
    if (idx >= photos.length) idx = 0;
    const main = h('div', { class: 'main' }, h('img', { src: photos[idx], alt: `Снимка на ${cur.nickname}` }));
    const thumbs = photos.length > 1 ? h('div', { class: 'thumbs' }, photos.map((u, n) => h('button', { type: 'button', 'aria-label': `Снимка ${n + 1}`, 'aria-current': String(n === idx), onclick: () => { idx = n; render(); } }, h('img', { src: u, alt: '' })))) : null;
    const likeBtn = cur.isMe ? null : h('button', { class: cur.liked ? 'btn' : 'btn ghost', type: 'button', 'aria-pressed': String(cur.liked), text: cur.liked ? '💙 Харесан' : '🤍 Харесай', onclick: async e => {
      e.currentTarget.disabled = true;
      try { cur = (await api('POST', `/api/profiles/${cur.id}/like`)).profile; const i = disc.profiles.findIndex(x => x.id === cur.id); if (i >= 0) disc.profiles[i] = cur; if (cur.liked && cur.likedMe) toast(`Взаимно харесване с ${cur.nickname}! 🎉`); render(); }
      catch (x) { toast(x.message, true); e.currentTarget.disabled = false; }
    } });
    body.append(h('div', { class: 'pview' },
      h('div', { class: 'gallery' }, main, thumbs),
      h('div', {},
        h('h2', {}, `${cur.nickname}, ${cur.age} `, cur.isDemo ? h('span', { class: 'tag demo', text: 'демо' }) : null),
        h('p', { class: 'dim' }, cur.online ? h('span', { class: 'dot' }) : null, cur.online ? 'Онлайн сега' : 'Не е онлайн'),
        h('dl', { class: 'facts' },
          h('dt', { text: 'Град' }), h('dd', { text: cur.city }),
          h('dt', { text: 'Пол' }), h('dd', { text: GENDER[cur.gender] }),
          h('dt', { text: 'Търси' }), h('dd', { text: LOOKING[cur.lookingFor] }),
          h('dt', { text: 'Харесвания' }), h('dd', { text: String(cur.likes) })),
        cur.likedMe && !cur.isMe ? h('p', {}, h('span', { class: 'tag', text: '💙 Харесва те' })) : null,
        h('h3', { text: 'За мен' }), h('p', { class: 'bio', text: cur.bio || 'Още няма био.' }),
        cur.interests.length ? [h('h3', { text: 'Интереси' }), h('div', { class: 'chips' }, cur.interests.map(t => h('span', { class: 'tag', text: t })))] : null,
        h('div', { class: 'actions' }, likeBtn,
          cur.isMe || state.me.role === 'admin' ? null : h('button', { class: 'btn ghost', type: 'button', text: '💬 Пиши', onclick: () => openChat(cur.id) }),
          cur.isMe || state.me.role === 'admin' ? null : h('button', { class: 'btn danger', type: 'button', text: '🚩 Докладвай', onclick: () => reportDialog(cur) }),
          cur.isMe ? h('a', { class: 'btn ghost', href: '#/profile', text: 'Редактирай профила', onclick: closeModal }) : null))));
  };
  render();
  openModal(body, { title: 'Профил' });
}

/* ═══════════ Моят профил ═══════════ */
function resizeImage(file, maxSide = 1100) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Позволени са само JPG, PNG и WebP.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Файлът не може да бъде прочетен като снимка.')); };
    img.src = url;
  });
}

function viewProfile() {
  const v = clear($('#view'));
  const me = state.me;
  const draft = { nickname: me.nickname, gender: me.gender, lookingFor: me.lookingFor, city: me.city, bio: me.bio, interests: new Set(me.interests) };

  const photosBox = h('div', { class: 'photos' });
  function renderPhotos() {
    clear(photosBox);
    state.me.photos.forEach((ph, i) => photosBox.append(h('div', { class: 'ph-item' },
      h('img', { src: ph.url, alt: `Моя снимка ${i + 1}` }),
      i === 0 ? h('span', { class: 'main-tag', text: 'Основна' }) : null,
      h('div', { class: 'ctl' },
        i !== 0 ? h('button', { type: 'button', text: 'Основна', onclick: () => photoAction('PUT', `/api/me/photos/${ph.id}/main`) }) : null,
        h('button', { type: 'button', text: 'Изтрий', onclick: () => { if (confirm('Да изтрия ли тази снимка?')) photoAction('DELETE', `/api/me/photos/${ph.id}`); } })))));
    if (state.me.photos.length < state.meta.maxPhotos) {
      const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'sr', 'aria-label': 'Избери снимки', onchange: e => upload([...e.target.files]) });
      const dz = h('button', { class: 'dropzone', type: 'button', onclick: () => input.click(),
        ondragover: e => { e.preventDefault(); dz.classList.add('over'); }, ondragleave: () => dz.classList.remove('over'),
        ondrop: e => { e.preventDefault(); dz.classList.remove('over'); upload([...e.dataTransfer.files]); } },
        h('span', {}, h('b', { text: '＋ Добави снимка' }), h('br'), h('small', { text: 'или я пусни тук' })));
      photosBox.append(dz, input);
    }
  }
  async function photoAction(method, url) {
    try { state.me = (await api(method, url)).user; renderPhotos(); } catch (x) { toast(x.message, true); }
  }
  async function upload(files) {
    for (const f of files) {
      if (state.me.photos.length >= state.meta.maxPhotos) { toast(`Максимум ${state.meta.maxPhotos} снимки.`, true); break; }
      try {
        const dataUrl = await resizeImage(f);
        state.me = (await api('POST', '/api/me/photos', { dataUrl })).user;
        renderPhotos();
        toast('Снимката е качена.');
      } catch (x) { toast(x.message, true); }
    }
  }

  const err = h('div', { class: 'err', role: 'alert' });
  const bio = h('textarea', { id: 'p-bio', maxlength: '600', placeholder: 'Разкажи нещо за себе си – какво обичаш, какво търсиш…', oninput: e => { draft.bio = e.target.value; counter.textContent = `${draft.bio.length}/600`; } });
  bio.value = draft.bio;
  const counter = h('div', { class: 'counter', text: `${draft.bio.length}/600` });
  const save = h('button', { class: 'btn', type: 'submit', text: 'Запази профила' });

  const form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; save.disabled = true;
    try {
      state.me = (await api('PUT', '/api/me', { nickname: draft.nickname, gender: draft.gender, lookingFor: draft.lookingFor, city: draft.city, bio: draft.bio, interests: [...draft.interests] })).user;
      refreshMeta();
      renderChrome();
      toast('Профилът е запазен ✔');
    } catch (x) { err.textContent = x.message; } finally { save.disabled = false; }
  } },
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'p-nick', text: 'Никнейм' }), h('input', { id: 'p-nick', value: draft.nickname, maxlength: '20', oninput: e => { draft.nickname = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { text: 'Възраст' }), h('input', { value: `${me.age} г.`, disabled: true, 'aria-label': 'Възраст' }))),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'p-city', text: 'Град' }), h('select', { id: 'p-city', onchange: e => { draft.city = e.target.value; } }, state.meta.cities.map(c => h('option', { value: c.name, text: c.name, selected: c.name === draft.city })))),
      h('div', { class: 'field' }, h('label', { for: 'p-gender', text: 'Аз съм' }), h('select', { id: 'p-gender', onchange: e => { draft.gender = e.target.value; } }, Object.entries(GENDER).map(([k, t]) => h('option', { value: k, text: t, selected: k === draft.gender })))),
      h('div', { class: 'field' }, h('label', { for: 'p-look', text: 'Търся' }), h('select', { id: 'p-look', onchange: e => { draft.lookingFor = e.target.value; } }, Object.entries(LOOKING).map(([k, t]) => h('option', { value: k, text: t, selected: k === draft.lookingFor }))))),
    h('div', { class: 'field' }, h('label', { for: 'p-bio', text: 'Био' }), bio, counter),
    h('div', { class: 'field' }, h('label', { text: 'Интереси (до 8)' }),
      h('div', { class: 'chips' }, state.meta.interests.map(i => h('button', { class: 'chip', type: 'button', text: i, 'aria-pressed': String(draft.interests.has(i)), onclick: e => {
        if (draft.interests.has(i)) draft.interests.delete(i);
        else if (draft.interests.size >= 8) return toast('Най-много 8 интереса.', true);
        else draft.interests.add(i);
        e.currentTarget.setAttribute('aria-pressed', String(draft.interests.has(i)));
      } })))),
    err,
    h('div', { class: 'actions' }, save, h('button', { class: 'btn ghost', type: 'button', text: 'Как ме виждат другите', onclick: () => openProfile(state.me) })));

  v.append(h('h1', { text: 'Моят профил' }),
    h('div', { class: 'two' },
      h('section', { class: 'win enter' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '🖼️ Снимки' })),
        h('div', { class: 'win-body' }, photosBox, h('p', { class: 'hint', text: `До ${state.meta.maxPhotos} снимки · JPG, PNG или WebP · първата е основна.` }))),
      h('section', { class: 'win enter', style: '--i:1' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '✏️ Информация' })),
        h('div', { class: 'win-body' }, form))));
  renderPhotos();
}

async function refreshMeta() { try { state.meta = await api('GET', '/api/meta'); } catch { /* запазва се старото */ } }

/* ═══════════ Дизайн и настройки ═══════════ */
function viewSettings() {
  const v = clear($('#view'));
  const colorRows = COLOR_FIELDS.map(([k, label]) => {
    const code = h('code', { text: theme[k] });
    const input = h('input', { type: 'color', id: 't-' + k, value: theme[k], 'aria-label': label, oninput: e => { code.textContent = e.target.value; changeTheme({ [k]: e.target.value }); } });
    return { k, code, input, el: h('div', { class: 'swatch' }, h('label', { for: 't-' + k, text: label }), code, input) };
  });
  const slider = (k, label, min, max, unit, step = 1) => {
    const out = h('output', { text: theme[k] + unit });
    return h('div', { class: 'slider' }, h('label', { for: 's-' + k }, label, out),
      h('input', { id: 's-' + k, type: 'range', min, max, step, value: theme[k], oninput: e => { out.textContent = e.target.value + unit; changeTheme({ [k]: Number(e.target.value) }); } }));
  };
  const sliders = [slider('fontScale', 'Размер на шрифта', 80, 150, '%', 5), slider('radius', 'Заобленост на прозорците', 0, 32, 'px'), slider('borderWidth', 'Дебелина на рамката', 0, 4, 'px'), slider('glow', 'Сияние (glow)', 0, 100, '%', 5)];

  const anim = h('input', { type: 'checkbox', id: 't-anim', checked: theme.animations, onchange: e => changeTheme({ animations: e.target.checked }) });

  const pErr = h('div', { class: 'err', role: 'alert' });
  const cur = h('input', { id: 'pw-cur', type: 'password', autocomplete: 'current-password' });
  const nxt = h('input', { id: 'pw-new', type: 'password', autocomplete: 'new-password', minlength: '8', maxlength: '72' });

  v.append(h('h1', { text: 'Дизайн и настройки' }),
    h('div', { class: 'two' },
      h('div', { class: 'stack' },
        h('section', { class: 'win enter' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '🎨 Готови теми' })),
          h('div', { class: 'win-body' }, h('div', { class: 'presets' }, PRESETS.map(p => h('button', { class: 'preset', type: 'button', onclick: () => { changeTheme({ ...DEFAULT_THEME, ...p.c, fontScale: theme.fontScale, animations: theme.animations }); viewSettings(); toast(`Тема „${p.name}“ е приложена.`); } },
            h('i', { style: `background:${p.c.accent}` }), p.name))))),
        h('section', { class: 'win enter', style: '--i:1' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '🖌️ Цветове' })),
          h('div', { class: 'win-body' }, h('div', { class: 'swatches' }, colorRows.map(r => r.el)))),
        h('section', { class: 'win enter', style: '--i:2' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '🔠 Шрифт, рамки, ефекти' })),
          h('div', { class: 'win-body' }, sliders, h('div', { class: 'checkline' }, anim, h('label', { for: 't-anim', text: 'Анимации и плавни преходи' })),
            h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', text: 'Върни стандартния дизайн', onclick: () => { changeTheme({ ...DEFAULT_THEME }); viewSettings(); toast('Върнат е стандартният дизайн.'); } }))))),
      h('div', { class: 'stack' },
        h('section', { class: 'win enter', style: '--i:1' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '👁️ Преглед на живо' })),
          h('div', { class: 'win-body' }, h('div', { class: 'live' }, h('h3', { text: 'Примерен прозорец' }), h('p', { text: 'Така изглеждат текстът, рамките и бутоните с твоите настройки.' }), h('div', { class: 'chips' }, h('span', { class: 'tag', text: 'Пътуване' }), h('span', { class: 'tag', text: 'Музика' })), h('br'), h('button', { class: 'btn sm', type: 'button', text: 'Бутон' })),
            h('p', { class: 'hint', text: state.me ? 'Настройките се пазят в профила ти и те следват на всяко устройство.' : 'Настройките се пазят в този браузър.' }))),
        state.me ? h('section', { class: 'win enter', style: '--i:2' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '🔐 Акаунт' })),
          h('div', { class: 'win-body' },
            h('form', { novalidate: true, onsubmit: async e => {
              e.preventDefault(); pErr.textContent = '';
              try { await api('PUT', '/api/me/password', { current: cur.value, next: nxt.value }); cur.value = nxt.value = ''; toast('Паролата е сменена.'); }
              catch (x) { pErr.textContent = x.message; }
            } },
              h('h3', { text: 'Смяна на парола' }),
              h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { for: 'pw-cur', text: 'Текуща парола' }), cur), h('div', { class: 'field' }, h('label', { for: 'pw-new', text: 'Нова парола' }), nxt)),
              pErr, h('button', { class: 'btn sm', type: 'submit', text: 'Смени паролата' })),
            h('hr', { style: 'border:0;border-top:1px solid var(--border);margin:1.4rem 0' }),
            h('h3', { text: 'Изтриване на профила' }),
            h('p', { class: 'dim', text: 'Профилът, снимките и харесванията ти се изтриват завинаги.' }),
            h('button', { class: 'btn danger sm', type: 'button', text: 'Изтрий профила ми…', onclick: deleteAccountDialog }))) : null)));
}

function deleteAccountDialog() {
  const err = h('div', { class: 'err', role: 'alert' });
  const pw = h('input', { id: 'del-pw', type: 'password', autocomplete: 'current-password' });
  openModal(h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { await api('DELETE', '/api/me', { password: pw.value }); closeModal(); state.me = null; await refreshMeta(); location.hash = '#/'; route(); toast('Профилът е изтрит.'); }
    catch (x) { err.textContent = x.message; }
  } },
    h('p', { text: 'Това действие е необратимо. Въведи паролата си, за да потвърдиш.' }),
    h('div', { class: 'field' }, h('label', { for: 'del-pw', text: 'Парола' }), pw), err,
    h('div', { class: 'actions' }, h('button', { class: 'btn danger', type: 'submit', text: 'Изтрий завинаги' }), h('button', { class: 'btn ghost', type: 'button', text: 'Отказ', onclick: closeModal }))),
  { narrow: true, title: 'Изтриване на профил' });
}

/* ═══════════ Съобщения и докладване ═══════════ */
function openChat(id) {
  chatWith = id;
  closeModal();
  if (location.hash === '#/messages') route(); else location.hash = '#/messages';
}

function reportDialog(p) {
  const reasons = state.meta.reportReasons;
  const err = h('div', { class: 'err', role: 'alert' });
  const reason = h('select', { id: 'rp-reason' }, h('option', { value: '', text: 'Избери причина…' }), Object.entries(reasons).map(([k, t]) => h('option', { value: k, text: t })));
  const details = h('textarea', { id: 'rp-details', maxlength: '500', placeholder: 'Какво се случи? (по желание, до 500 символа)', style: 'min-height:6rem' });
  const block = h('input', { type: 'checkbox', id: 'rp-block', checked: true });
  const btn = h('button', { class: 'btn danger', type: 'submit', text: 'Изпрати доклада' });
  openModal(h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    if (!reason.value) { err.textContent = 'Изберете причина за доклада.'; return; }
    btn.disabled = true;
    try {
      const r = await api('POST', `/api/profiles/${p.id}/report`, { reason: reason.value, details: details.value, block: block.checked });
      closeModal();
      if (r.blocked) { disc.profiles = disc.profiles.filter(x => x.id !== p.id); if (chatWith === p.id) chatWith = null; }
      toast(r.blocked ? 'Докладът е изпратен и профилът е блокиран.' : 'Докладът е изпратен. Благодарим ти!');
      if (r.blocked) route();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('p', {}, 'Докладваш ', h('b', { text: p.nickname }), '. Администратор ще прегледа случая.'),
    h('div', { class: 'field' }, h('label', { for: 'rp-reason', text: 'Причина' }), reason),
    h('div', { class: 'field' }, h('label', { for: 'rp-details', text: 'Подробности' }), details),
    h('div', { class: 'checkline' }, block, h('label', { for: 'rp-block', text: 'Блокирай този човек (няма да можете да си пишете и да се виждате)' })),
    h('p', { class: 'hint notice', text: '🔒 С подаването на доклада позволяваш на администратор да прегледа вашата размяна на съобщения с този човек, за да прецени дали докладът е основателен. Другите ти разговори остават лични.' }),
    err, h('div', { class: 'actions' }, btn, h('button', { class: 'btn ghost', type: 'button', text: 'Отказ', onclick: closeModal }))),
  { narrow: true, title: 'Докладване на профил' });
}

function viewMessages() {
  const v = clear($('#view'));
  const listBox = h('div', { class: 'chatlist', role: 'list' });
  const threadBox = h('section', { class: 'win chatthread', 'aria-label': 'Разговор' });
  const layout = h('div', { class: 'chatlayout' + (chatWith ? ' open' : '') },
    h('aside', { class: 'win chatside', 'aria-label': 'Разговори' },
      h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: 'Разговори' })), listBox),
    threadBox);
  v.append(h('h1', { text: 'Съобщения' }), layout);

  let chats = [], sig = '', peer = null, msgs = [];
  const toBottom = () => { const m = $('.msgs', threadBox); if (m) m.scrollTop = m.scrollHeight; };

  function renderList() {
    clear(listBox);
    if (!chats.length) { listBox.append(h('p', { class: 'dim', style: 'padding:1rem', text: 'Още нямаш разговори. Отвори профил от „Открий хора“ и натисни „Пиши“.' })); return; }
    chats.forEach(c => listBox.append(h('button', { class: 'chatitem' + (c.profile.id === chatWith ? ' on' : ''), type: 'button', role: 'listitem', onclick: () => { chatWith = c.profile.id; layout.classList.add('open'); renderList(); loadThread(true); } },
      h('img', { src: mainPhoto(c.profile), alt: '', width: '44', height: '44' }),
      h('span', { class: 'ci' }, h('b', { text: c.profile.nickname }), h('small', { text: (c.last.mine ? 'Ти: ' : '') + c.last.body })),
      badge(c.unread))));
  }
  async function loadList() {
    try { chats = (await api('GET', '/api/chats')).chats; renderList(); } catch (x) { if (x.status !== 0) toast(x.message, true); }
  }

  function renderThread(force) {
    if (!chatWith) {
      clear(threadBox).append(h('div', { class: 'empty-state' }, h('div', { class: 'big', text: '💬' }), h('h3', { text: 'Избери разговор' }), h('p', { text: 'Или отвори нечий профил и натисни „Пиши“.' })));
      return;
    }
    if (!peer || peer.id !== chatWith) { clear(threadBox).append(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Зареждане' })); sig = ''; return; }
    const nextSig = msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].id : 0) + ':' + (peer ? peer.id : 0);
    if (!force && nextSig === sig) return;
    sig = nextSig;
    const keep = $('textarea', threadBox);
    const draft = keep ? keep.value : '';
    const list = h('div', { class: 'msgs', 'aria-live': 'polite' });
    let day = '';
    if (!msgs.length) list.append(h('p', { class: 'dim', style: 'text-align:center;margin:auto', text: `Напиши първото съобщение на ${peer.nickname}.` }));
    for (const m of msgs) {
      const d = fmtDate(m.at);
      if (d !== day) { day = d; list.append(h('div', { class: 'daysep', text: d })); }
      list.append(h('div', { class: 'bubble ' + (m.mine ? 'mine' : 'theirs') }, h('span', { text: m.body }), h('time', { datetime: m.at, text: fmtTime(m.at) })));
    }
    const input = h('textarea', { id: 'chat-input', rows: '2', maxlength: '1000', placeholder: 'Напиши съобщение…', 'aria-label': 'Съобщение',
      onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } });
    input.value = draft;
    const sendBtn = h('button', { class: 'btn', type: 'button', text: 'Изпрати', onclick: send });
    async function send() {
      const body = input.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try {
        const r = await api('POST', `/api/chats/${peer.id}`, { body });
        msgs.push(r.message); input.value = ''; renderThread(true); toBottom(); loadList();
      } catch (x) { toast(x.message, true); } finally { sendBtn.disabled = false; }
    }
    clear(threadBox).append(
      h('div', { class: 'win-head' },
        h('button', { class: 'xbtn backbtn', type: 'button', 'aria-label': 'Към разговорите', text: '←', onclick: () => { chatWith = null; layout.classList.remove('open'); renderList(); renderThread(true); } }),
        h('img', { class: 'mini', src: mainPhoto(peer), alt: '', width: '32', height: '32' }),
        h('h2', {}, h('a', { href: '#/messages', text: peer.nickname, onclick: e => { e.preventDefault(); openProfile(peer); } }), ` · ${peer.city}`),
        h('button', { class: 'btn danger sm', style: 'margin-left:auto', type: 'button', text: '🚩 Докладвай', onclick: () => reportDialog(peer) })),
      list,
      h('p', { class: 'hint notice', text: '🔒 Разговорът е личен. При подаден доклад администратор може да прегледа размяната ви с докладвания човек.' }),
      h('div', { class: 'composer' }, input, sendBtn));
    toBottom();
    if (draft) input.focus();
  }

  async function loadThread(initial) {
    if (!chatWith) { renderThread(true); return; }
    try {
      const r = await api('GET', `/api/chats/${chatWith}`);
      const grew = r.messages.length !== msgs.length;
      peer = r.profile; msgs = r.messages;
      renderThread(initial);
      if (initial || grew) toBottom();
      if (initial || grew) loadList();
      refreshBadges();
    } catch (x) {
      if (x.status === 404) { chatWith = null; layout.classList.remove('open'); renderThread(true); loadList(); } else if (x.status !== 0) toast(x.message, true);
    }
  }

  renderThread(true);
  loadList();
  if (chatWith) loadThread(true);
  viewTimer = setInterval(() => { loadList(); if (chatWith) loadThread(false); }, 5000);
}

/* ═══════════ Администрация ═══════════ */
function viewAdmin() {
  const v = clear($('#view'));
  const head = t => h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: t }));
  const tiles = h('div', { class: 'tiles' });
  const bars = h('div', { class: 'bars' });
  const repBox = h('div', { class: 'replist' });
  const repFilters = h('div', { class: 'chips', style: 'margin-bottom:.9rem', role: 'group', 'aria-label': 'Филтър на докладите' });
  let repFilter = 'open';
  const tbody = h('tbody');
  const count = h('span', { class: 'dim' });
  v.append(h('h1', { text: 'Админ панел' }),
    h('p', { class: 'dim', text: 'Преглед на сайта отвътре: статистика, потребители и модерация. Виждаш и обикновения сайт през менюто горе.' }),
    h('div', { class: 'stack' },
    h('section', { class: 'win enter' }, head('📊 Накратко'), h('div', { class: 'win-body' }, tiles)),
    h('div', { class: 'two' },
      h('section', { class: 'win enter', style: '--i:1' }, head('📍 Профили по градове'), h('div', { class: 'win-body' }, bars)),
      h('section', { class: 'win enter', style: '--i:2' }, head('🧭 Бърз достъп'), h('div', { class: 'win-body' },
        h('p', { class: 'dim', text: 'Разгледай сайта като потребител:' }),
        h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/discover', text: 'Открий хора' }), h('a', { class: 'btn ghost', href: '#/profile', text: 'Моят профил' }), h('a', { class: 'btn ghost', href: '#/settings', text: 'Дизайн' }))))),
    h('section', { class: 'win enter', style: '--i:3', id: 'reportsWin' }, head('🚩 Доклади'), h('div', { class: 'win-body' },
      h('p', { class: 'dim', text: 'Разговорът се вижда само към доклад (снимка от момента на докладването). Всяко отваряне се записва в журнал.' }),
      repFilters, repBox)),
    h('section', { class: 'win enter', style: '--i:4' }, head('👥 Потребители'), h('div', { class: 'win-body' },
      h('div', { class: 'citybar' }, h('input', { type: 'search', placeholder: 'Търси по никнейм или потребителско име', 'aria-label': 'Търсене на потребители', style: 'max-width:26rem',
        oninput: debounce(e => loadUsers(e.target.value), 250) }), count),
      h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Никнейм', 'Потребител', 'Възраст', 'Град', 'Снимки', '♥', 'Тип', ''].map(t => h('th', { scope: 'col', text: t })))), tbody))))));

  async function loadStats() {
    try {
      const st = await api('GET', '/api/admin/stats');
      clear(tiles).append(...[['Профили', st.users], ['Реални', st.real], ['Демо', st.demo], ['Снимки', st.photos], ['Харесвания', st.likes], ['Отворени доклади', st.openReports], ['Онлайн', st.online], ['Нови за 24ч', st.newToday]]
        .map(([l, n]) => h('div', { class: 'tile' }, h('b', { text: String(n) }), h('span', { text: l }))));
      const max = Math.max(1, ...st.byCity.map(c => c.count));
      clear(bars).append(...st.byCity.slice(0, 12).map(c => h('div', { class: 'bar' },
        h('span', { text: c.city }), h('div', { class: 'track', role: 'img', 'aria-label': `${c.city}: ${c.count}` }, h('i', { style: `width:${Math.round(c.count / max * 100)}%` })), h('b', { text: String(c.count) }))));
    } catch (x) { toast(x.message, true); }
  }
  async function loadUsers(q = '') {
    try {
      const { users } = await api('GET', '/api/admin/users?q=' + encodeURIComponent(q.trim()));
      count.textContent = `${users.length} ${users.length === 1 ? 'резултат' : 'резултата'}`;
      clear(tbody);
      for (const u of users) {
        const del = h('button', { class: 'btn danger sm', type: 'button', text: 'Изтрий' });
        let armed = false;
        del.addEventListener('click', async () => {
          if (!armed) { armed = true; del.textContent = 'Сигурен ли си?'; setTimeout(() => { armed = false; del.textContent = 'Изтрий'; }, 3500); return; }
          try { await api('DELETE', `/api/admin/users/${u.id}`); toast(`Изтрит: ${u.nickname}`); loadStats(); loadUsers(q); } catch (x) { toast(x.message, true); }
        });
        tbody.append(h('tr', {},
          h('td', {}, h('b', { text: u.nickname })), h('td', { class: 'dim', text: u.isDemo ? '—' : u.username }), h('td', { text: String(u.age) }), h('td', { text: u.city }),
          h('td', { text: String(u.photos) }), h('td', { text: String(u.likes) }),
          h('td', {}, h('span', { class: 'tag' + (u.isDemo ? ' demo' : ''), text: u.role === 'admin' ? 'админ' : u.isDemo ? 'демо' : 'потребител' })),
          h('td', {}, u.role === 'admin' ? null : del)));
      }
    } catch (x) { toast(x.message, true); }
  }
  const STATUS = { open: 'Отворен', upheld: 'Основателен', dismissed: 'Неоснователен' };
  async function loadReports() {
    try {
      const r = await api('GET', '/api/admin/reports?status=' + repFilter);
      const total = r.counts.open + r.counts.upheld + r.counts.dismissed;
      clear(repFilters).append(...[['open', `Отворени (${r.counts.open})`], ['upheld', `Основателни (${r.counts.upheld})`], ['dismissed', `Неоснователни (${r.counts.dismissed})`], ['all', `Всички (${total})`]]
        .map(([k, t]) => h('button', { class: 'chip', type: 'button', text: t, 'aria-pressed': String(repFilter === k), onclick: () => { repFilter = k; loadReports(); } })));
      clear(repBox);
      if (!r.reports.length) { repBox.append(h('p', { class: 'dim', text: repFilter === 'open' ? 'Няма отворени доклади. 🎉' : 'Няма доклади в тази група.' })); }
      for (const x of r.reports) {
        repBox.append(h('div', { class: 'rep' },
          h('div', { class: 'who' }, h('b', { text: x.reportedNick }), h('span', { class: 'dim', text: ` докладван от ${x.reporterNick}` })),
          h('span', { class: 'tag', text: x.reasonLabel }),
          h('span', { class: 'dim', text: `${fmtWhen(x.createdAt)} · 💬 ${x.messages}` }),
          h('span', { class: 'tag st-' + x.status, text: STATUS[x.status] }),
          h('button', { class: 'btn sm', type: 'button', text: 'Разгледай', onclick: () => openCase(x.id, () => { loadReports(); loadStats(); refreshBadges(); }) })));
      }
    } catch (x) { toast(x.message, true); }
  }

  loadStats(); loadReports(); loadUsers();
}

// Казус: данни за доклада + снимка на разговора + решение на администратора.
async function openCase(id, changed) {
  let d;
  try { d = await api('GET', `/api/admin/reports/${id}`); } catch (x) { toast(x.message, true); return; }
  const r = d.report, STATUS = { open: 'Отворен', upheld: 'Основателен', dismissed: 'Неоснователен' };
  const note = h('textarea', { id: 'case-note', maxlength: '500', placeholder: 'Бележка към решението (по желание)', style: 'min-height:5rem' });
  note.value = r.adminNote || '';
  const decide = async status => {
    try { await api('PUT', `/api/admin/reports/${id}`, { status, note: note.value }); toast(status === 'open' ? 'Докладът е върнат като отворен.' : 'Решението е записано.'); closeModal(); changed && changed(); }
    catch (x) { toast(x.message, true); }
  };
  let armed = false;
  const delBtn = h('button', { class: 'btn danger', type: 'button', text: 'Изтрий профила на докладвания' });
  delBtn.addEventListener('click', async () => {
    if (!armed) { armed = true; delBtn.textContent = 'Сигурен ли си? Натисни пак'; setTimeout(() => { armed = false; delBtn.textContent = 'Изтрий профила на докладвания'; }, 3500); return; }
    try { await api('DELETE', `/api/admin/users/${d.reported.id}`); toast('Профилът е изтрит. Доказателствата в доклада остават.'); closeModal(); changed && changed(); }
    catch (x) { toast(x.message, true); }
  });

  const transcript = h('div', { class: 'transcript', tabindex: '0', 'aria-label': 'Разговор към момента на доклада' });
  if (!d.messages.length) transcript.append(h('p', { class: 'dim', style: 'margin:auto;text-align:center', text: 'Към момента на доклада няма разменени съобщения между двамата.' }));
  let day = '';
  for (const m of d.messages) {
    const dd = fmtDate(m.at);
    if (dd !== day) { day = dd; transcript.append(h('div', { class: 'daysep', text: dd })); }
    transcript.append(h('div', { class: 'bubble ' + (m.fromReporter ? 'mine' : 'accused') }, h('small', { class: 'from', text: m.from + (m.fromReporter ? ' (докладва)' : ' (докладван)') }), h('span', { text: m.body }), h('time', { datetime: m.at, text: fmtTime(m.at) })));
  }

  const rep = d.reported;
  openModal(h('div', {},
    h('div', { class: 'two' },
      h('div', {},
        h('dl', { class: 'facts' },
          h('dt', { text: 'Статус' }), h('dd', {}, h('span', { class: 'tag st-' + r.status, text: STATUS[r.status] })),
          h('dt', { text: 'Причина' }), h('dd', { text: r.reasonLabel }),
          h('dt', { text: 'Подаден' }), h('dd', { text: fmtWhen(r.createdAt) }),
          h('dt', { text: 'Докладва' }), h('dd', { text: r.reporterNick + (r.reporterStillExists ? '' : ' (акаунтът е изтрит)') }),
          h('dt', { text: 'Докладван' }), h('dd', { text: r.reportedNick + (rep ? '' : ' (акаунтът е изтрит)') }),
          h('dt', { text: 'Прегледи' }), h('dd', { text: `${d.views}× от администратори` })),
        h('h3', { text: 'Описание от докладващия' }),
        h('p', { class: 'bio', text: r.details || 'Без описание.' }),
        rep ? [h('h3', { text: 'Докладваният профил' }),
          h('p', { class: 'dim', text: `${rep.age} г. · ${rep.city} · ${rep.photos} снимки · в сайта от ${fmtDate(rep.createdAt)}` }),
          h('p', { class: 'bio', text: rep.bio || 'Няма био.' }),
          rep.otherReports ? h('p', {}, h('span', { class: 'tag st-upheld', text: `⚠️ Още ${rep.otherReports} доклада срещу този профил` })) : null] : null),
      h('div', {},
        h('h3', { text: 'Разговор (снимка към момента на доклада)' }),
        h('p', { class: 'hint', text: 'Показан е само разговорът между тези двама души. Останалите чатове не са достъпни.' }),
        transcript)),
    h('div', { class: 'field', style: 'margin-top:1rem' }, h('label', { for: 'case-note', text: 'Бележка на администратора' }), note),
    h('div', { class: 'actions' },
      r.status !== 'upheld' ? h('button', { class: 'btn', type: 'button', text: '✔ Основателен', onclick: () => decide('upheld') }) : null,
      r.status !== 'dismissed' ? h('button', { class: 'btn ghost', type: 'button', text: '✖ Неоснователен', onclick: () => decide('dismissed') }) : null,
      r.status !== 'open' ? h('button', { class: 'btn ghost', type: 'button', text: '↺ Върни като отворен', onclick: () => decide('open') }) : null,
      rep && d.reported ? delBtn : null),
    h('p', { class: 'hint', text: 'Отварянето на този доклад е записано в журнала.' })),
  { title: `Доклад #${r.id}` });
}

/* ═══════════ Маршрутизация ═══════════ */
function currentRoute() {
  const r = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0];
  return ['discover', 'profile', 'settings', 'admin', 'messages'].includes(r) ? r : '';
}
function route() {
  closeModal();
  stopViewTimer();
  let r = currentRoute();
  if (!state.me && r !== 'settings') r = '';
  if (r === 'admin' && !(state.me && state.me.role === 'admin')) r = state.me ? 'discover' : '';
  if (r === 'messages' && !(state.me && state.me.role !== 'admin')) r = state.me ? 'discover' : '';
  if (state.me) startBadges(); else stopBadges();
  if (state.me && r === '') { r = 'discover'; history.replaceState(null, '', '#/discover'); }
  renderChrome();
  if (!state.meta) return;
  ({ '': viewLanding, discover: viewDiscover, profile: viewProfile, settings: viewSettings, admin: viewAdmin, messages: viewMessages })[r]();
  window.scrollTo(0, 0);
  const main = $('#view'); if (main) main.focus({ preventScroll: true });
  document.title = ({ '': 'Spark — запознанства', discover: 'Открий хора · Spark', profile: 'Моят профил · Spark', settings: 'Дизайн и настройки · Spark', admin: 'Админ · Spark', messages: 'Съобщения · Spark' })[r];
}

/* ═══════════ Старт ═══════════ */
async function init() {
  loadLocalTheme();
  $('#fontUp').addEventListener('click', () => changeTheme({ fontScale: Math.min(150, theme.fontScale + 10) }));
  $('#fontDown').addEventListener('click', () => changeTheme({ fontScale: Math.max(80, theme.fontScale - 10) }));
  $('#fontReset').addEventListener('click', () => changeTheme({ fontScale: 100 }));
  window.addEventListener('hashchange', route);
  clear($('#view')).append(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Зареждане' }));
  try {
    const [meta, me] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/me')]);
    state.meta = meta; state.me = me.user;
    adoptServerTheme(me.user);
  } catch (x) {
    clear($('#view')).append(h('div', { class: 'win' }, h('div', { class: 'win-body empty-state' }, h('div', { class: 'big', text: '⚠️' }), h('h2', { text: 'Сървърът не отговаря' }), h('p', { text: x.message }), h('button', { class: 'btn', type: 'button', text: 'Опитай пак', onclick: () => location.reload() }))));
    return;
  }
  route();
}
init();
})();
