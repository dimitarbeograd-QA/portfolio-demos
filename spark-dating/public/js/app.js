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
// Мобилен вид (≤700px): долна лента за навигация, цял екран за чата, компактни карти. Функционалността е същата.
const mobileQuery = window.matchMedia('(max-width: 700px)');
const isMobile = () => mobileQuery.matches;
const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(method, url, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); } catch { throw Object.assign(new Error('Няма връзка със сървъра.'), { status: 0 }); }
  let data = {};
  try { data = await res.json(); } catch { /* празен отговор */ }
  if (!res.ok) {
    // Профилът е станал непотвърден/суспендиран → обновяваме състоянието, за да се покаже екранът или банерът.
    if (data.code === 'email_unverified' && state.me && state.me.emailVerified) { state.me.emailVerified = false; queueMicrotask(route); }
    if (data.code === 'suspended') queueMicrotask(refreshMe);
    throw Object.assign(new Error(data.error || 'Нещо се обърка.'), { status: res.status, code: data.code, data });
  }
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

/* ═══════════ Избор на област и населено място ═══════════ */
const placeText = p => p.label + (p.kind !== 'гр.' && p.obshtina ? ` (общ. ${p.obshtina})` : '');
let pickerSeq = 0;
// Област + търсене на град/село в нея. initial = профил (region, placeId, city, obshtina) или null.
function placePicker({ initial, onChange }) {
  const uid = 'pp' + (++pickerSeq);
  let region = (initial && initial.region) || '';
  let place = initial && initial.placeId ? { id: initial.placeId, label: initial.city, kind: initial.city.startsWith('с.') ? 'с.' : 'гр.', obshtina: initial.obshtina, region } : null;
  let items = [], active = -1, token = 0;

  const regionSel = h('select', { id: uid + '-region', 'aria-label': 'Област', onchange: e => {
    region = e.target.value; place = null; input.value = ''; input.disabled = !region; closeList(); summary(); onChange(null);
    if (region) { input.focus(); search(''); }
  } }, h('option', { value: '', text: 'Избери област…' }), state.meta.regions.map(r => h('option', { value: r.code, text: r.name, selected: r.code === region })));
  const input = h('input', { id: uid + '-place', type: 'text', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': uid + '-list', 'aria-autocomplete': 'list', maxlength: '40',
    placeholder: region ? 'Започни да пишеш: град или село…' : 'Първо избери област', disabled: !region });
  const list = h('ul', { id: uid + '-list', class: 'combo-list', role: 'listbox', hidden: true });
  const sum = h('p', { class: 'hint', 'aria-live': 'polite' });
  if (place) input.value = placeText(place);

  function summary() {
    const rn = region ? (state.meta.regions.find(r => r.code === region) || {}).name : '';
    sum.textContent = place ? `📍 ${place.label}${place.obshtina && place.kind !== 'гр.' ? ' · общ. ' + place.obshtina : ''} · обл. ${rn}` : region ? 'Избери населено място от списъка (хиляди градове и села).' : '';
  }
  function closeList() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
  function renderList() {
    clear(list);
    if (!items.length) { list.append(h('li', { class: 'combo-empty', role: 'presentation', text: 'Няма такова населено място в тази област.' })); }
    items.forEach((p, i) => list.append(h('li', { id: `${uid}-o${i}`, role: 'option', 'aria-selected': String(i === active), class: i === active ? 'on' : '',
      onmousedown: e => { e.preventDefault(); choose(p); } },
      h('b', { text: p.label }), h('small', { text: `общ. ${p.obshtina}` }))));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function choose(p) {
    place = p; input.value = placeText(p); closeList(); summary(); onChange(p);
  }
  async function search(q) {
    if (!region) return;
    const mine = ++token;
    try {
      const r = await api('GET', `/api/places?region=${encodeURIComponent(region)}&limit=40&q=${encodeURIComponent(q)}`);
      if (mine !== token) return;
      items = r.places; active = -1; renderList();
    } catch (x) { if (mine === token) toast(x.message, true); }
  }
  const lazy = debounce(q => search(q), 150);
  input.addEventListener('input', () => { if (place) { place = null; summary(); onChange(null); } lazy(input.value); });
  input.addEventListener('focus', () => { if (region && !place) search(input.value); });
  input.addEventListener('blur', () => setTimeout(closeList, 120));
  input.addEventListener('keydown', e => {
    if (list.hidden && (e.key === 'ArrowDown') && region) { search(input.value); return; }
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); }
    else if (e.key === 'Enter') { if (active >= 0 && items[active]) { e.preventDefault(); choose(items[active]); } return; }
    else if (e.key === 'Escape') { e.stopPropagation(); closeList(); return; }
    else return;
    renderList();
    input.setAttribute('aria-activedescendant', `${uid}-o${active}`);
    const el = $(`#${uid}-o${active}`); if (el) el.scrollIntoView({ block: 'nearest' });
  });
  summary();
  const el = h('div', { class: 'placepick' },
    h('div', { class: 'row' }, h('div', {}, h('label', { for: uid + '-region', text: 'Област' }), regionSel), h('div', { class: 'combo' }, h('label', { for: uid + '-place', text: 'Град или село' }), input, list)),
    sum);
  return { el, get place() { return place; } };
}

/* ═══════════ Състояние ═══════════ */
const state = { me: null, meta: null, unread: 0, openReports: 0, openAppeals: 0, devMail: null };
const dock = { open: false, view: 'list', with: null, chats: [], timer: null, root: null, panel: null, btn: null, pane: null };
let chatWith = null;                 // id на отворения разговор (страница „Съобщения“)
let viewTimer = null, badgeTimer = null;
const stopViewTimer = () => { if (viewTimer) { clearInterval(viewTimer); viewTimer = null; } };
let unreadKnown = false;
const applyTitleBadge = () => { const base = document.title.replace(/^\(\d+\) /, ''); document.title = state.unread > 0 ? `(${state.unread}) ${base}` : base; };
async function refreshBadges() {
  if (!state.me || !state.me.emailVerified) return;
  try {
    const r = await api('GET', '/api/chats/unread');
    const grew = unreadKnown && r.unread > state.unread;
    const changed = r.unread !== state.unread || r.openReports !== state.openReports || (r.openAppeals || 0) !== state.openAppeals;
    state.unread = r.unread; state.openReports = r.openReports; state.openAppeals = r.openAppeals || 0; unreadKnown = true;
    if (changed) { renderChrome(); applyTitleBadge(); }
    if (grew) announceNewMessage();
  } catch { /* следващият опит ще мине */ }
}
// Ново съобщение: тост + (ако мини чатът е отворен) обновяване на списъка.
async function announceNewMessage() {
  try {
    const { chats } = await api('GET', '/api/chats');
    const fresh = chats.find(c => c.unread > 0);
    dock.chats = chats; if (dock.open && dock.view === 'list') renderDockList();
    if (fresh && !(dock.open && dock.view === 'thread' && dock.with === fresh.id)) {
      toast(fresh.kind === 'group' ? `💬 ${fresh.last.senderNick || 'Ново съобщение'} в „${fresh.title}“` : `💬 Ново съобщение от ${fresh.title}`);
    }
  } catch { /* ignore */ }
}
function startBadges() { if (badgeTimer) return; refreshBadges(); badgeTimer = setInterval(refreshBadges, 8000); }
function stopBadges() { if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; } state.unread = 0; state.openReports = 0; state.openAppeals = 0; unreadKnown = false; }
const fmtTime = at => new Date(at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
const fmtDate = at => new Date(at).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
const fmtWhen = at => (new Date(at).toDateString() === new Date().toDateString() ? fmtTime(at) : `${fmtDate(at)}, ${fmtTime(at)}`);
const badge = n => (n > 0 ? h('span', { class: 'badge', 'aria-label': `${n} нови`, text: n > 99 ? '99+' : String(n) }) : null);
const disc = {
  region: '', place: '', placeLabel: '', stage: 'region', q: '', gender: '', ageMin: '', ageMax: '', interests: new Set(), withPhoto: false,
  online: false, lookingForMe: false, goal: '', sort: 'active', profiles: [], total: 0, loading: false,
  pickerOpen: !window.matchMedia('(max-width: 700px)').matches, filtersOpen: (() => { if (window.innerWidth <= 700) return false; try { const v = localStorage.getItem('spark.filtersOpen'); if (v !== null) return v === '1'; } catch { /* ignore */ } return window.innerWidth > 900; })(), token: 0,
};

/* ═══════════ Горна лента ═══════════ */
function renderChrome() {
  const route = currentRoute();
  const nav = clear($('#nav'));
  if (state.me && state.me.emailVerified) {
    const isAdmin = state.me.role === 'admin';
    [['#/discover', 'Открий хора', 'discover', 0]]
      .concat(isAdmin ? [] : [['#/messages', '💬 Съобщения', 'messages', state.unread], ['#/activity', '💙 Активност', 'activity', 0]])
      .concat([['#/profile', 'Моят профил', 'profile', 0], ['#/settings', 'Дизайн и настройки', 'settings', 0]])
      .concat(isAdmin ? [['#/admin', '🛡️ Админ', 'admin', state.openReports + state.openAppeals]] : [])
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
  renderBanners();
  renderTabbar(route);
  syncDock();
}

// Празнуване при взаимно харесване (като в Bumble и Boo): силен момент и ясно следващо действие.
function matchDialog(p) {
  const confetti = Array.from({ length: 16 }, (_, i) => { const c = h('i', { 'aria-hidden': 'true' }); c.style.setProperty('--x', `${(i * 37) % 100}%`); c.style.setProperty('--d', `${(i % 5) * 0.12}s`); c.style.setProperty('--h', `${(i * 47) % 360}`); return c; });
  openModal(h('div', { class: 'match' }, h('div', { class: 'confetti' }, ...confetti),
    h('div', { class: 'matchpics' }, h('img', { src: mainPhoto(state.me), alt: '', width: '96', height: '96' }), h('span', { class: 'matchheart', 'aria-hidden': 'true', text: '💙' }), h('img', { src: mainPhoto(p), alt: '', width: '96', height: '96' })),
    h('h2', { text: 'Взаимно харесване!' }), h('p', { class: 'dim', text: `Ти и ${p.nickname} се харесахте. Кажи здравей!` }),
    h('div', { class: 'actions', style: 'justify-content:center' }, h('button', { class: 'btn', type: 'button', text: `💬 Пиши на ${p.nickname}`, onclick: () => openChat(p.id) }), h('button', { class: 'btn ghost', type: 'button', text: 'Продължи', onclick: closeModal }))),
  { narrow: true, title: 'Съвпадение' });
}

// Долна лента за навигация (само на телефон; на компютър навигацията е горе).
function renderTabbar(routeKey) {
  let bar = $('#tabbar');
  if (!bar) { bar = h('nav', { id: 'tabbar', class: 'tabbar', 'aria-label': 'Навигация' }); document.body.append(bar); }
  clear(bar);
  const show = !!(state.me && state.me.emailVerified);
  document.body.classList.toggle('has-tabbar', show);
  if (!show) return;
  const admin = state.me.role === 'admin';
  const tabs = admin
    ? [['#/discover', '🧭', 'Открий', 'discover', 0], ['#/admin', '🛡️', 'Админ', 'admin', state.openReports + state.openAppeals], ['#/profile', '👤', 'Профил', 'profile', 0]]
    : [['#/discover', '🧭', 'Открий', 'discover', 0], ['#/activity', '💙', 'Активност', 'activity', 0], ['#/messages', '💬', 'Чат', 'messages', state.unread], ['#/profile', '👤', 'Профил', 'profile', 0]];
  tabs.forEach(([href, ico, label, key, n]) => bar.append(h('a', { href, class: 'tab' + (routeKey === key ? ' on' : ''), 'aria-current': routeKey === key ? 'page' : null },
    h('span', { class: 'ti', 'aria-hidden': 'true', text: ico }), h('span', { class: 'tl2', text: label }), badge(n))));
  bar.append(h('button', { class: 'tab', type: 'button', onclick: openMenuSheet }, h('span', { class: 'ti', 'aria-hidden': 'true', text: '☰' }), h('span', { class: 'tl2', text: 'Още' })));
}
function openMenuSheet() {
  const me = state.me; if (!me) return;
  const admin = me.role === 'admin';
  const link = (href, ico, text) => h('a', { class: 'menuitem', href, onclick: closeModal }, h('span', { 'aria-hidden': 'true', text: ico }), text);
  openModal(h('div', { class: 'menulist' },
    h('div', { class: 'menuhead' }, h('img', { src: mainPhoto(me), alt: '', width: '48', height: '48' }), h('div', {}, h('b', { text: me.nickname }), h('small', { class: 'dim', text: admin ? 'Администратор' : me.city }))),
    link('#/settings', '🎨', 'Дизайн и настройки'), admin ? link('#/admin', '🛡️', 'Админ панел') : link('#/activity', '💙', 'Активност'),
    h('div', { class: 'fontrow' }, h('span', { text: 'Размер на шрифта' }), h('div', { class: 'fontctl' },
      h('button', { class: 'chip-btn', type: 'button', 'aria-label': 'По-малък шрифт', text: 'A−', onclick: () => changeTheme({ fontScale: Math.max(80, theme.fontScale - 10) }) }),
      h('button', { class: 'chip-btn', type: 'button', 'aria-label': 'Нормален шрифт', text: 'A', onclick: () => changeTheme({ fontScale: 100 }) }),
      h('button', { class: 'chip-btn', type: 'button', 'aria-label': 'По-голям шрифт', text: 'A+', onclick: () => changeTheme({ fontScale: Math.min(150, theme.fontScale + 10) }) }))),
    h('button', { class: 'btn danger block', type: 'button', text: 'Изход', onclick: () => { closeModal(); logout(); } })), { title: 'Меню' });
}
mobileQuery.addEventListener('change', () => { if (state.meta) route(); });

// Филтрите на „Открий хора“ не трябва да „преминават“ към следващия акаунт в същия таб.
function resetDisc() {
  Object.assign(disc, { region: '', place: '', placeLabel: '', stage: 'region', q: '', gender: '', goal: '', ageMin: '', ageMax: '', withPhoto: false, online: false, lookingForMe: false,
    sort: 'active', profiles: [], total: 0, loading: false, pickerOpen: !isMobile(), token: disc.token + 1 });
  disc.interests.clear();
}
async function logout() {
  try { await api('POST', '/api/logout'); } catch { /* ignore */ }
  if (callRt.call) await hangup();
  state.me = null; resetDisc(); chatWith = null; stopBadges(); stopCallWatch();
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
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#modalRoot').firstChild) closeModal(); else if (dock.open) toggleDock(false);
});

/* ═══════════ Начална страница + вход ═══════════ */
function viewLanding() {
  const meta = state.meta;
  const withPeople = meta.regions.filter(c => c.count > 0).sort((a, b) => b.count - a.count);
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
        h('p', { class: 'lead', text: 'Създай профил с никнейм, снимки и био, посочи къде живееш (област, град или село) и разгледай хора близо до теб. Филтрирай по възраст, интереси и още. Оформи сайта със свои цветове.' }),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', { text: String(meta.total) }), h('span', { text: 'профила' })),
          h('div', { class: 'stat' }, h('b', { text: String(withPeople.length) }), h('span', { text: 'области с хора' })),
          h('div', { class: 'stat' }, h('b', { text: '18+' }), h('span', { text: 'само пълнолетни' }))),
        h('div', { class: 'cityline', 'aria-label': 'Най-активни области' },
          withPeople.slice(0, 8).map(c => h('span', { class: 'tag', text: `${c.name} · ${c.count}` })))),
      h('div', { class: 'win enter', style: '--i:2' },
        h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: 'Добре дошъл' })),
        h('div', { class: 'win-body' }, h('div', { class: 'tabs', role: 'tablist' }, tabs.map(t => t[1])), authBody))),
    h('section', { class: 'feat' },
      [['📍', 'Хора по градове и села', 'Избери област, после град или село, и виж кой е наблизо.'],
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
      state.meta.demoAdmin ? h('div', { class: 'demologin' },
        h('button', { class: 'btn ghost block', type: 'button', text: '👤 Вход като тестов потребител (без парола)', onclick: async e => {
          const btn = e.currentTarget; btn.disabled = true; err.textContent = '';
          try { const r = await api('POST', '/api/demo-user'); await afterAuth(r.user); }
          catch (x) { err.textContent = x.message; btn.disabled = false; }
        } }),
        h('button', { class: 'btn ghost block', type: 'button', text: '🔑 Вход като администратор (без парола)', onclick: async e => {
          const btn = e.currentTarget; btn.disabled = true; err.textContent = '';
          try { const r = await api('POST', '/api/demo-admin'); await afterAuth(r.user); location.hash = '#/admin'; route(); }
          catch (x) { err.textContent = x.message; btn.disabled = false; }
        } })) : null,
      h('p', { class: 'hint', text: state.meta.demoAdmin ? 'Демо режим: входът е без парола. Тестовият потребител има готови разговори; администраторът вижда сайта отвътре.' : 'Нямаш профил? Натисни „Регистрация“ по-горе.' }));
  }

  function registerForm() {
    const err = h('div', { class: 'err', role: 'alert' });
    const f = {
      username: h('input', { id: 'r-user', autocomplete: 'username', required: true, maxlength: '30', placeholder: 'само за вход, не се показва' }),
      nickname: h('input', { id: 'r-nick', autocomplete: 'nickname', required: true, maxlength: '20', placeholder: 'виждат го другите' }),
      email: h('input', { id: 'r-email', type: 'email', autocomplete: 'email', required: true, maxlength: '254', placeholder: 'за потвърждение и известия' }),
      password: h('input', { id: 'r-pass', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', maxlength: '72' }),
      birthDate: h('input', { id: 'r-birth', type: 'date', required: true, max: new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10) }),
      gender: h('select', { id: 'r-gender' }, h('option', { value: '', text: 'Избери…' }), Object.entries(GENDER).map(([k, t]) => h('option', { value: k, text: t }))),
      lookingFor: h('select', { id: 'r-look' }, Object.entries(LOOKING).map(([k, t]) => h('option', { value: k, text: t, selected: k === 'any' }))),
    };
    const picker = placePicker({ onChange: () => {} });
    // Капан за ботове: скрито поле, което човек не вижда и не попълва.
    const hp = h('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'hp' });
    const btn = h('button', { class: 'btn block', type: 'submit', text: 'Създай профил' });
    return h('form', { novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (!picker.place) { err.textContent = 'Избери област и населено място от списъка.'; return; }
      const body = { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), placeId: picker.place.id, website: hp.value };
      btn.disabled = true;
      try { const r = await api('POST', '/api/register', body); state.devMail = r.mail; await afterAuth(r.user, true); }
      catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
    } },
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'r-nick', text: 'Никнейм' }), f.nickname),
        h('div', { class: 'field' }, h('label', { for: 'r-user', text: 'Потребителско име' }), f.username)),
      h('div', { class: 'field' }, h('label', { for: 'r-email', text: 'Имейл' }), f.email, h('p', { class: 'hint', text: 'Ще ти пратим код за потвърждение. Без него профилът остава ограничен.' })),
      h('div', { class: 'field' }, h('label', { for: 'r-pass', text: 'Парола (мин. 8 символа)' }), f.password),
      h('div', { class: 'field' }, h('label', { for: 'r-birth', text: 'Дата на раждане' }), f.birthDate),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Къде живееш' }), picker.el),
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
  resetDisc();
  state.me = user;
  adoptServerTheme(user);
  location.hash = isNew ? '#/profile' : '#/discover';
  route();
  toast(isNew ? `Добре дошъл, ${user.nickname}! Добави снимки и био.` : `Здравей отново, ${user.nickname}!`);
}

/* ═══════════ Открий хора ═══════════ */
function viewDiscover() {
  const v = clear($('#view'));
  const total = state.meta.regions.reduce((n, c) => n + c.count, 0);

  const citiesWin = h('section', { class: 'win enter', id: 'citiesWin', 'aria-label': 'Избор на област и населено място' });
  const results = h('section', { 'aria-label': 'Резултати' });
  const sidebar = h('aside', { class: 'sidebar win enter', id: 'filtersPanel', style: '--i:1', 'aria-label': 'Филтри' });

  if (state.me.role !== 'admin' && state.me.completeness && state.me.completeness.pct < 80) {
    v.append(h('div', { class: 'nudge' }, h('span', { text: `Профилът ти е ${state.me.completeness.pct}% попълнен – допълни го, за да те забелязват повече хора.` }), h('a', { class: 'btn sm', href: '#/profile', text: 'Допълни' })));
  }
  const toggle = h('button', { class: 'btn ghost sm filter-toggle', type: 'button', 'aria-controls': 'filtersPanel', onclick: () => {
    disc.filtersOpen = !disc.filtersOpen;
    if (!isMobile()) { try { localStorage.setItem('spark.filtersOpen', disc.filtersOpen ? '1' : '0'); } catch { /* ignore */ } }
    syncFilters();
  } });
  const layout = h('div', { class: 'layout' }, sidebar, h('div', { class: 'stack' }, citiesWin, results));
  v.append(h('div', { class: 'filterbar' }, toggle), layout);
  // Колко филтъра са включени (показва се на бутона, когато панелът е скрит, за да не се забравят).
  const activeFilters = () => [disc.q.trim(), disc.gender, disc.goal, disc.ageMin, disc.ageMax, disc.withPhoto, disc.online, disc.lookingForMe].filter(Boolean).length + (disc.interests.size ? 1 : 0);
  function syncFilters() {
    const n = activeFilters();
    sidebar.classList.toggle('closed', !disc.filtersOpen);
    layout.classList.toggle('nofilters', !disc.filtersOpen);
    toggle.setAttribute('aria-expanded', String(disc.filtersOpen));
    clear(toggle).append(...[disc.filtersOpen ? '◀ Скрий филтрите' : '🎛️ Покажи филтрите', !disc.filtersOpen && n ? h('span', { class: 'badge', 'aria-label': `${n} активни филтъра`, text: String(n) }) : null].filter(Boolean)); // native append(null) би написало „null“
  }
  syncFilters();

  const regionName = () => (state.meta.regions.find(r => r.code === disc.region) || {}).name || '';
  const placeTitle = () => disc.place ? `${disc.placeLabel}, обл. ${regionName()}` : disc.region ? `област ${regionName()}` : '';
  let placeToken = 0;

  function renderCities() {
    clear(citiesWin);
    const head = h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')),
      h('h2', { text: disc.place ? `📍 ${disc.placeLabel}` : disc.region ? `📍 Област ${regionName()}` : disc.pickerOpen ? '📍 Избери област' : '📍 Цяла България' }));
    head.append(h('button', { class: 'btn ghost sm', style: 'margin-left:auto', type: 'button', text: disc.pickerOpen ? 'Скрий' : (disc.region || disc.place ? 'Смени' : 'Избери област'),
      'aria-expanded': String(disc.pickerOpen), onclick: () => { disc.pickerOpen = !disc.pickerOpen; disc.stage = disc.region ? 'place' : 'region'; renderCities(); } }));
    citiesWin.append(head);
    if (disc.place) citiesWin.append(h('div', { class: 'crumbs' }, `обл. ${regionName()}`));
    if (!disc.pickerOpen) return;
    const body = h('div', { class: 'win-body' });
    citiesWin.append(body);
    if (disc.stage === 'region' || !disc.region) renderRegionGrid(body); else renderPlaceStage(body);
  }

  function renderRegionGrid(body) {
    body.append(h('p', { class: 'dim', style: 'margin-top:0', text: 'Избери област, после ще можеш да стесниш до конкретен град или село.' }),
      h('div', { class: 'cities' },
        h('button', { class: 'city', type: 'button', 'aria-pressed': String(!disc.region), onclick: () => pickRegion('') }, h('span', { text: 'Цяла България' }), h('small', { text: String(total) })),
        state.meta.regions.map(c => h('button', { class: 'city' + (c.count ? '' : ' empty'), type: 'button', 'aria-pressed': String(disc.region === c.code), onclick: () => pickRegion(c.code) },
          h('span', { text: c.name }), h('small', { text: String(c.count) })))));
  }

  function renderPlaceStage(body) {
    const rc = state.meta.regions.find(r => r.code === disc.region);
    const popBox = h('div', { class: 'cities', 'aria-label': 'Населени места с хора' });
    const found = h('div', { class: 'chips', style: 'margin-top:.6rem' });
    const q = h('input', { type: 'search', placeholder: `Търси друг град или село в област ${rc.name}…`, 'aria-label': 'Търсене на населено място', value: '', maxlength: '40',
      oninput: debounce(e => searchPlaces(e.target.value), 200) });
    body.append(
      h('div', { class: 'actions', style: 'margin:0 0 .8rem' }, h('button', { class: 'btn ghost sm', type: 'button', text: '‹ Всички области', onclick: () => { disc.stage = 'region'; renderCities(); } })),
      h('div', { class: 'cities' },
        h('button', { class: 'city', type: 'button', 'aria-pressed': String(!disc.place), onclick: () => pickPlace(null) }, h('span', { text: `Цялата област ${rc.name}` }), h('small', { text: String(rc.count) }))),
      h('h3', { style: 'margin:1rem 0 .5rem', text: 'Населени места с хора' }), popBox,
      h('h3', { style: 'margin:1rem 0 .5rem', text: 'Търси град или село' }), q, found);
    const mine = ++placeToken;
    api('GET', `/api/places?region=${disc.region}&populated=1&limit=60`).then(r => {
      if (mine !== placeToken) return;
      if (!r.places.length) popBox.replaceWith(h('p', { class: 'dim', text: 'Още няма хора в тази област. Потърси населено място по-долу.' }));
      else popBox.append(...r.places.map(p => placeTile(p)));
    }).catch(x => toast(x.message, true));
    function placeTile(p) {
      return h('button', { class: 'city', type: 'button', 'aria-pressed': String(disc.place === p.id), onclick: () => pickPlace(p) },
        h('span', {}, p.label, p.kind !== 'гр.' ? h('em', { class: 'sub', text: `общ. ${p.obshtina}` }) : null), h('small', { text: String(p.count) }));
    }
    async function searchPlaces(text) {
      clear(found);
      if (!text.trim()) return;
      try {
        const r = await api('GET', `/api/places?region=${disc.region}&limit=40&q=${encodeURIComponent(text.trim())}`);
        if (!r.places.length) found.append(h('p', { class: 'dim', text: 'Няма такова населено място в тази област.' }));
        r.places.forEach(p => found.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(disc.place === p.id), onclick: () => pickPlace(p),
          title: `общ. ${p.obshtina}`, text: `${p.label}${p.kind !== 'гр.' ? ` · общ. ${p.obshtina}` : ''}${p.count ? ` · ${p.count}` : ''}` })));
      } catch (x) { toast(x.message, true); }
    }
  }

  function pickRegion(code) {
    disc.region = code; disc.place = ''; disc.placeLabel = '';
    disc.stage = code ? 'place' : 'region'; disc.pickerOpen = !!code;
    renderCities(); load(true);
  }
  function pickPlace(p) {
    disc.place = p ? p.id : ''; disc.placeLabel = p ? p.label : '';
    disc.pickerOpen = false; renderCities(); load(true);
  }

  function renderFilters() {
    clear(sidebar);
    const upd = debounce(() => load(true), 300);
    const num = (key, ph, min, max) => h('input', { type: 'number', inputmode: 'numeric', min, max, placeholder: ph, value: disc[key], 'aria-label': ph === 'от' ? 'Възраст от' : 'Възраст до',
      oninput: e => { disc[key] = e.target.value; upd(); } });
    const chk = (key, label) => h('div', { class: 'checkline' }, h('input', { type: 'checkbox', id: 'f-' + key, checked: disc[key], onchange: e => { disc[key] = e.target.checked; load(true); } }), h('label', { for: 'f-' + key, text: label }));
    const genderChips = [['', 'Всички'], ...Object.entries(GENDER)].map(([k, t]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(disc.gender === k), text: t, onclick: () => { disc.gender = k; renderFilters(); load(true); } }));

    sidebar.append(
      h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h3', { text: '🎛️ Филтри' }), h('button', { class: 'btn sm sheetclose', type: 'button', text: 'Готово ✓', onclick: () => { disc.filtersOpen = false; syncFilters(); window.scrollTo(0, 0); } })),
      h('div', { class: 'win-body' },
        h('div', { class: 'fgroup' }, h('label', { for: 'f-q', text: 'Търси по никнейм' }), h('input', { id: 'f-q', value: disc.q, maxlength: '30', placeholder: 'напр. Мила', oninput: e => { disc.q = e.target.value; upd(); } })),
        h('div', { class: 'fgroup' }, h('label', { text: 'Пол' }), h('div', { class: 'chips' }, genderChips)),
        h('div', { class: 'fgroup' }, h('label', { text: 'Какво търсят' }), h('div', { class: 'chips' }, [['', 'Всички'], ...Object.entries(state.meta.goals)].map(([k, t]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(disc.goal === k), text: t, onclick: () => { disc.goal = k; renderFilters(); load(true); } })))),
        h('div', { class: 'fgroup' }, h('label', { text: 'Възраст' }), h('div', { class: 'agepair' }, num('ageMin', 'от', 18, 99), h('span', { text: '–' }), num('ageMax', 'до', 18, 99))),
        h('div', { class: 'fgroup' }, h('label', { text: 'Интереси (поне един)' }),
          h('div', { class: 'chips' }, state.meta.interests.map(i => h('button', { class: 'chip', type: 'button', text: i, 'aria-pressed': String(disc.interests.has(i)),
            onclick: e => { disc.interests.has(i) ? disc.interests.delete(i) : disc.interests.add(i); e.currentTarget.setAttribute('aria-pressed', String(disc.interests.has(i))); upd(); } })))),
        h('div', { class: 'fgroup' }, chk('withPhoto', 'Само със снимка'), chk('online', 'Онлайн сега'), chk('lookingForMe', 'Търсят хора като мен')),
        h('button', { class: 'btn ghost block', type: 'button', text: 'Изчисти филтрите', onclick: () => {
          Object.assign(disc, { q: '', gender: '', goal: '', ageMin: '', ageMax: '', withPhoto: false, online: false, lookingForMe: false }); disc.interests.clear(); renderFilters(); load(true); } })));
  }

  function renderResults() {
    clear(results);
    const sort = h('select', { 'aria-label': 'Подреждане', style: 'width:auto', onchange: e => { disc.sort = e.target.value; load(true); } },
      [['active', 'Последно активни'], ['new', 'Най-нови'], ['young', 'Най-млади'], ['old', 'Най-възрастни']].map(([k, t]) => h('option', { value: k, text: t, selected: disc.sort === k })));
    results.append(h('div', { class: 'citybar' },
      h('h2', { text: disc.loading && !disc.profiles.length ? 'Зареждане…' : `${disc.total} ${disc.total === 1 ? 'човек' : 'души'}${placeTitle() ? ' в ' + placeTitle() : ''}` }), sort));
    if (disc.loading && !disc.profiles.length) { results.append(h('div', { class: 'grid', role: 'progressbar', 'aria-label': 'Зареждане' }, Array.from({ length: 8 }, () => h('div', { class: 'win card skel' }, h('div', { class: 'ph' }), h('div', { class: 'meta' }, h('p'), h('p')))))); return; }
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
    syncFilters();
    const token = ++disc.token;
    disc.loading = true;
    if (reset) { disc.profiles = []; }
    renderResults();
    const p = new URLSearchParams();
    if (disc.region) p.set('region', disc.region);
    if (disc.place) p.set('place', disc.place);
    if (disc.q.trim()) p.set('q', disc.q.trim());
    if (disc.gender) p.set('gender', disc.gender);
    if (disc.ageMin) p.set('ageMin', disc.ageMin);
    if (disc.ageMax) p.set('ageMax', disc.ageMax);
    if (disc.withPhoto) p.set('withPhoto', '1');
    if (disc.online) p.set('online', '1');
    if (disc.lookingForMe) p.set('lookingForMe', '1');
    if (disc.goal) p.set('goal', disc.goal);
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

function profileCard(p, i, extra) {
  const canChat = state.me && state.me.role !== 'admin';
  return h('article', { class: 'win card enter', style: `--i:${Math.min(i, 8)}` },
    h('button', { class: 'cardmain', type: 'button', 'aria-label': `Профил на ${p.nickname}, ${p.age} г., ${p.city}`, onclick: () => openProfile(p) },
      h('div', { class: 'ph' },
        h('img', { src: mainPhoto(p), alt: '', loading: 'lazy', width: '400', height: '500' }),
        p.isDemo ? h('span', { class: 'tag demo badge-tr', text: 'демо' }) : null,
        h('div', { class: 'over' }, h('b', { text: `${p.nickname}, ${p.age}` }), h('span', {}, p.online ? h('span', { class: 'dot', 'aria-label': 'онлайн' }) : null, `📍 ${p.city}`, p.regionName && p.regionName !== p.city ? h('small', { class: 'obl', text: ` · ${p.regionName}` }) : null))),
      h('div', { class: 'meta' }, extra ? h('p', { class: 'extra', text: extra }) : null, h('p', { text: p.bio || 'Още няма био.' }),
        h('div', { class: 'chips' }, p.goalLabel ? h('span', { class: 'tag goal', text: '🎯 ' + p.goalLabel }) : null, p.interests.slice(0, 3).map(t => h('span', { class: 'tag', text: t }))))),
    canChat ? h('div', { class: 'cardact' },
      h('button', { class: 'btn sm', type: 'button', text: '💬 Пиши', 'aria-label': `Пиши на ${p.nickname}`, onclick: () => openChat(p.id) }),
      p.likedMe ? h('span', { class: 'tag', text: '💙 Харесва те' }) : null) : null);
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
      const likeEl = e.currentTarget; likeEl.disabled = true;
      try { cur = (await api('POST', `/api/profiles/${cur.id}/like`)).profile; const i = disc.profiles.findIndex(x => x.id === cur.id); if (i >= 0) disc.profiles[i] = cur; if (cur.liked && cur.likedMe) { render(); matchDialog(cur); return; } render(); }
      catch (x) { toast(x.message, true); likeEl.disabled = false; }
    } });
    body.append(h('div', { class: 'pview' },
      h('div', { class: 'gallery' }, main, thumbs),
      h('div', {},
        h('h2', {}, `${cur.nickname}, ${cur.age} `, cur.isDemo ? h('span', { class: 'tag demo', text: 'демо' }) : null),
        h('p', { class: 'dim' }, cur.online ? h('span', { class: 'dot' }) : null, cur.online ? 'Онлайн сега' : 'Не е онлайн'),
        h('dl', { class: 'facts' },
          h('dt', { text: 'Населено място' }), h('dd', { text: cur.city }),
          cur.obshtina && cur.obshtina !== cur.city ? [h('dt', { text: 'Община' }), h('dd', { text: cur.obshtina })] : null,
          cur.regionName ? [h('dt', { text: 'Област' }), h('dd', { text: cur.regionName })] : null,
          h('dt', { text: 'Пол' }), h('dd', { text: GENDER[cur.gender] }),
          h('dt', { text: 'Търси' }), h('dd', { text: LOOKING[cur.lookingFor] }),
          cur.goalLabel ? [h('dt', { text: 'Цел' }), h('dd', { text: cur.goalLabel })] : null,
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

// Смалява голяма снимка до Blob (без fetch на data: – CSP го забранява). Връща null, ако не е нужно смаляване.
function resizeToBlob(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      if (k === 1 && file.size < 1.5 * 1048576) return resolve(null);
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('resize'))), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}

// Индикатор „Профил N% попълнен“ със следващи стъпки.
function completenessBar(me) {
  const c = me.completeness, todo = c.steps.filter(x => !x.done);
  const bar = h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(c.pct), 'aria-label': 'Попълненост на профила' }, h('i'));
  bar.firstChild.style.setProperty('width', c.pct + '%');
  return h('section', { class: 'win enter completeness' }, h('div', { class: 'win-body' },
    h('div', { class: 'cmeta' }, h('b', { text: `Профилът ти е ${c.pct}% попълнен` }), h('span', { class: 'dim', text: c.pct >= 100 ? 'Страхотно! 🎉' : 'Попълнените профили получават повече харесвания и съобщения.' })), bar,
    todo.length ? h('div', { class: 'chips', style: 'margin-top:.6rem' }, todo.map(t => h('span', { class: 'tag', text: `＋ ${t.label} (+${t.points}%)` }))) : null));
}

function viewProfile() {
  const v = clear($('#view'));
  const me = state.me;
  const draft = { nickname: me.nickname, gender: me.gender, lookingFor: me.lookingFor, placeId: me.placeId, goal: me.goal || '', bio: me.bio, interests: new Set(me.interests) };

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

  const picker = placePicker({ initial: me, onChange: p => { draft.placeId = p ? p.id : ''; } });
  const err = h('div', { class: 'err', role: 'alert' });
  const bio = h('textarea', { id: 'p-bio', maxlength: '600', placeholder: 'Разкажи нещо за себе си – какво обичаш, какво търсиш…', oninput: e => { draft.bio = e.target.value; counter.textContent = `${draft.bio.length}/600`; } });
  bio.value = draft.bio;
  const counter = h('div', { class: 'counter', text: `${draft.bio.length}/600` });
  const save = h('button', { class: 'btn', type: 'submit', text: 'Запази профила' });

  const form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    if (!draft.placeId) { err.textContent = 'Избери област и населено място от списъка.'; return; }
    save.disabled = true;
    try {
      state.me = (await api('PUT', '/api/me', { nickname: draft.nickname, gender: draft.gender, lookingFor: draft.lookingFor, placeId: draft.placeId, goal: draft.goal, bio: draft.bio, interests: [...draft.interests] })).user;
      refreshMeta();
      renderChrome();
      toast('Профилът е запазен ✔');
    } catch (x) { err.textContent = x.message; } finally { save.disabled = false; }
  } },
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'p-nick', text: 'Никнейм' }), h('input', { id: 'p-nick', value: draft.nickname, maxlength: '20', oninput: e => { draft.nickname = e.target.value; } })),
      h('div', { class: 'field' }, h('label', { text: 'Възраст' }), h('input', { value: `${me.age} г.`, disabled: true, 'aria-label': 'Възраст' }))),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Къде живееш' }), picker.el),
    h('div', { class: 'field' }, h('label', { for: 'p-goal', text: 'Какво търся' }), h('select', { id: 'p-goal', onchange: e => { draft.goal = e.target.value; } }, h('option', { value: '', text: 'Не искам да казвам' }), Object.entries(state.meta.goals).map(([k, t]) => h('option', { value: k, text: t, selected: k === draft.goal })))),
    h('div', { class: 'row' },
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

  v.append(h('h1', { text: 'Моят профил' }), completenessBar(state.me),
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
        state.me && state.me.role !== 'admin' ? h('section', { class: 'win enter', style: '--i:2' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '🕶️ Поверителност' })),
          h('div', { class: 'win-body' },
            h('div', { class: 'checkline' }, h('input', { type: 'checkbox', id: 'pv-pause', checked: state.me.paused, onchange: async e => { try { state.me = (await api('PUT', '/api/me/settings', { paused: e.target.checked })).user; renderChrome(); toast(state.me.paused ? 'Профилът е на пауза.' : 'Профилът отново се вижда.'); } catch (x) { toast(x.message, true); e.target.checked = !e.target.checked; } } }), h('label', { for: 'pv-pause', text: 'Пауза: скрий профила ми от търсенето (разговорите ми остават)' })),
            h('div', { class: 'checkline' }, h('input', { type: 'checkbox', id: 'pv-visits', checked: state.me.hideVisits, onchange: async e => { try { state.me = (await api('PUT', '/api/me/settings', { hideVisits: e.target.checked })).user; toast(state.me.hideVisits ? 'Посещенията ти вече не се записват.' : 'Посещенията ти се записват.'); } catch (x) { toast(x.message, true); e.target.checked = !e.target.checked; } } }), h('label', { for: 'pv-visits', text: 'Не записвай кога разглеждам чужди профили' })),
            h('p', { class: 'hint', text: `Имейл: ${state.me.email || '—'}${state.me.emailVerified ? ' ✓ потвърден' : ''}. Виден е само на теб.` }))) : null,
        state.me ? h('section', { class: 'win enter', style: '--i:3' }, h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '🔐 Акаунт' })),
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

/* ═══════════ Чат: общ компонент, групи, файлове, емотиконки ═══════════ */
const MAX_FILE_MB = 10;
const fmtSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const nickColor = nick => { let x = 7; for (const c of nick) x = (x * 31 + c.codePointAt(0)) >>> 0; return `hsl(${(x % 300) + 20} 85% 74%)`; };
const fileIcon = name => {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (e === 'pdf') return '📕';
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(e)) return '📝';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return '📊';
  if (['ppt', 'pptx', 'odp'].includes(e)) return '📽️';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(e)) return '🗜️';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(e)) return '🎵';
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(e)) return '🎬';
  return '📎';
};
// Групова аватарка: до 3 инициала върху градиент.
function groupAvatar(title, size = 44) {
  let x = 3; for (const c of title) x = (x * 31 + c.codePointAt(0)) >>> 0;
  const hue = 190 + (x % 80);
  const el = h('span', { class: 'gav', 'aria-hidden': 'true', text: [...title.trim()][0] ? [...title.trim()][0].toUpperCase() : '👥' });
  el.style.setProperty('--gh', String(hue)); el.style.setProperty('--gs', size + 'px');
  return el;
}
const chatAvatar = (c, size = 44) => (c.kind === 'group' ? groupAvatar(c.title, size) : h('img', { src: mainPhoto(c.peer), alt: '', width: String(size), height: String(size) }));
const lastLine = c => {
  const l = c.last, who = l.system ? '' : l.mine ? 'Ти: ' : c.kind === 'group' && l.senderNick ? l.senderNick + ': ' : '';
  return who + l.body.replace(/:([a-z]+):/g, (m, n) => (SparkEmo.labels[n] ? '🙂' : m));
};

// Преглед на снимка на цял екран.
function openLightbox(att) {
  openModal(h('div', { class: 'lightbox' }, h('img', { src: att.url, alt: att.name }), h('p', { class: 'dim', text: `${att.name} · ${fmtSize(att.size)}` }),
    h('a', { class: 'btn sm', href: att.url, download: att.name, text: '⬇ Свали' })), { title: att.name });
}
function attachmentNode(a) {
  if (a.kind === 'image') return h('button', { class: 'att-img', type: 'button', 'aria-label': `Отвори снимка ${a.name}`, onclick: () => openLightbox(a) }, h('img', { src: a.url, alt: a.name, loading: 'lazy' }));
  return h('a', { class: 'att-file', href: a.url, download: a.name, title: 'Свали' }, h('span', { class: 'ficon', 'aria-hidden': 'true', text: fileIcon(a.name) }),
    h('span', { class: 'finfo' }, h('b', { text: a.name }), h('small', { text: fmtSize(a.size) })), h('span', { class: 'fdl', 'aria-hidden': 'true', text: '⬇' }));
}

// Прозорче с емотиконки: „Spark“ (наши) и „Емоджи“ (системни).
function emojiPopover(onPick, onClose) {
  let tab = 'spark';
  const box = h('div', { class: 'emopop', role: 'dialog', 'aria-label': 'Емотиконки' });
  function paint() {
    clear(box);
    const tabs = h('div', { class: 'tabs', role: 'tablist', style: 'margin:.4rem' },
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'spark'), text: '✨ Spark', onclick: () => { tab = 'spark'; paint(); } }),
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'uni'), text: '😊 Емоджи', onclick: () => { tab = 'uni'; paint(); } }));
    const grid = h('div', { class: 'emogrid' });
    if (tab === 'spark') {
      SparkEmo.names.forEach(n => grid.append(h('button', { class: 'emobtn', type: 'button', title: SparkEmo.labels[n], 'aria-label': SparkEmo.labels[n], onclick: () => onPick(` :${n}: `) }, h('img', { src: SparkEmo.url(n), alt: '', width: '34', height: '34' }))));
    } else {
      SparkEmo.unicode.forEach(g => { grid.append(h('div', { class: 'emogrp', text: g.title })); g.items.forEach(c => grid.append(h('button', { class: 'emobtn uni', type: 'button', 'aria-label': c, text: c, onclick: () => onPick(c) }))); });
    }
    box.append(tabs, grid);
  }
  paint();
  const off = e => { if (!box.contains(e.target) && !e.target.closest('[data-emotoggle]')) { onClose(); } };
  setTimeout(() => document.addEventListener('mousedown', off), 0);
  box.close = () => document.removeEventListener('mousedown', off);
  return box;
}

// Общият чат панел (за кръгчето и за страницата „Съобщения“).
function createChatPane({ compact, onBack, onFull, onCollapse, onChanged }) {
  const root = h('div', { class: 'chatpane' });
  const headEl = h('div', { class: 'win-head' });
  const listEl = h('div', { class: 'msgs', 'aria-live': 'polite' });
  const noteEl = h('p', { class: 'hint notice' });
  const pendEl = h('div', { class: 'pendingatt', hidden: true });
  const input = h('textarea', { rows: '2', maxlength: '1000', placeholder: 'Напиши съобщение…', 'aria-label': 'Съобщение',
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
    onpaste: e => { const f = e.clipboardData && [...e.clipboardData.files].find(x => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f); } } });
  const fileIn = h('input', { type: 'file', class: 'sr', 'aria-label': 'Избери файл', onchange: e => { if (e.target.files[0]) attach(e.target.files[0]); e.target.value = ''; } });
  const sendBtn = h('button', { class: 'btn sm', type: 'button', text: 'Изпрати', onclick: () => send() });
  const attBtn = h('button', { class: 'xbtn', type: 'button', title: 'Прикачи снимка или файл', 'aria-label': 'Прикачи снимка или файл', text: '📎', onclick: () => fileIn.click() });
  const emoBtn = h('button', { class: 'xbtn emotoggle', type: 'button', 'data-emotoggle': '1', title: 'Емотиконки', 'aria-label': 'Емотиконки', onclick: () => togglePop() }, SparkEmo.img('smile', 'emo-btn'));
  const composer = h('div', { class: 'composer' }, attBtn, emoBtn, input, sendBtn, fileIn);
  root.append(headEl, listEl, noteEl, pendEl, composer);

  let convId = null, data = null, sig = '', pending = null, uploading = false, pop = null, token = 0;
  const conv = () => (data ? data.conversation : null);

  function togglePop() {
    if (pop) { closePop(); return; }
    pop = emojiPopover(txt => { insertAtCursor(txt); }, closePop);
    composer.append(pop);
  }
  function closePop() { if (pop) { pop.close(); pop.remove(); pop = null; } }
  function insertAtCursor(txt) {
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
    input.value = input.value.slice(0, s) + txt + input.value.slice(e);
    input.focus(); const pos = s + txt.length; input.setSelectionRange(pos, pos);
  }

  function setPending(p) {
    pending = p; clear(pendEl); pendEl.hidden = !p;
    if (!p) return;
    pendEl.append(p.previewUrl ? h('img', { src: p.previewUrl, alt: '' }) : h('span', { class: 'ficon', text: fileIcon(p.name) }),
      h('span', { class: 'finfo' }, h('b', { text: p.name }), h('small', { text: p.uploading ? 'Качва се…' : fmtSize(p.size) })),
      h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Махни файла', text: '✕', onclick: () => setPending(null) }));
  }

  async function attach(file) {
    if (!convId) return;
    if (file.size > MAX_FILE_MB * 1048576) { toast(`Файлът е твърде голям (макс. ${MAX_FILE_MB} MB).`, true); return; }
    let body = file, name = file.name || 'снимка.png', previewUrl = null;
    try {
      if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
        const small = await resizeToBlob(file, 1600);
        if (small) { body = small; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
        previewUrl = URL.createObjectURL(body);
      } else if (file.type === 'image/gif') previewUrl = URL.createObjectURL(file);
    } catch { /* ако не може да се смали, качваме оригинала */ }
    setPending({ name, size: body.size, previewUrl, uploading: true }); uploading = true; sendBtn.disabled = true;
    const mine = convId;
    try {
      const res = await fetch(`/api/chats/${mine}/attachments`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name) }, body });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Файлът не беше качен.');
      if (mine !== convId) return;
      setPending({ id: j.attachment.id, name: j.attachment.name, size: j.attachment.size, previewUrl });
    } catch (x) { setPending(null); toast(x.message, true); }
    finally { uploading = false; sendBtn.disabled = false; }
  }

  async function send() {
    const body = input.value.trim();
    if ((!body && !(pending && pending.id)) || uploading || !convId) return;
    sendBtn.disabled = true;
    try {
      const r = await api('POST', `/api/chats/${convId}/messages`, { body, attachmentId: pending && pending.id });
      data.messages.push(r.message); input.value = ''; setPending(null); closePop();
      renderList(true); onChanged && onChanged();
    } catch (x) { toast(x.message, true); } finally { sendBtn.disabled = uploading; }
  }

  function bubble(m) {
    if (m.kind === 'system') return h('div', { class: 'sysmsg', text: m.body });
    const group = conv().kind === 'group', r = m.body ? SparkEmo.render(m.body) : null;
    const el = h('div', { class: 'bubble ' + (m.mine ? 'mine' : 'theirs') + (r && r.big && !m.attachment ? ' emobig' : '') });
    if (group && !m.mine) el.append(h('small', { class: 'from', style: `color:${nickColor(m.senderNick || '?')}`, text: m.senderNick || 'Изтрит профил' }));
    if (m.attachment) el.append(attachmentNode(m.attachment));
    if (r) el.append(h('span', { class: 'txt' }, ...r.nodes));
    el.append(h('time', { datetime: m.at, text: fmtTime(m.at) }));
    return el;
  }
  function renderList(force) {
    const msgs = data ? data.messages : [];
    const next = `${convId}:${msgs.length}:${msgs.length ? msgs[msgs.length - 1].id : 0}`;
    if (!force && next === sig) return;
    const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80 || sig === '';
    sig = next; clear(listEl);
    if (!data) { listEl.append(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Зареждане' })); return; }
    if (!msgs.length) listEl.append(h('p', { class: 'dim', style: 'text-align:center;margin:auto', text: 'Напиши първото съобщение.' }));
    let day = '';
    for (const m of msgs) {
      const d = fmtDate(m.at);
      if (d !== day) { day = d; listEl.append(h('div', { class: 'daysep', text: d })); }
      listEl.append(bubble(m));
    }
    if (nearBottom) {
      listEl.scrollTop = listEl.scrollHeight;
      // снимките се зареждат по-късно и променят височината → пак до дъното
      listEl.querySelectorAll('.att-img img').forEach(im => { if (!im.complete) im.addEventListener('load', () => { listEl.scrollTop = listEl.scrollHeight; }, { once: true }); });
    }
  }
  function renderHead() {
    clear(headEl);
    const c = conv();
    if (!c) { headEl.append(h('h2', { text: 'Зареждане…' })); return; }
    const group = c.kind === 'group';
    const peer = c.peer;
    headEl.append(...[
      onBack ? h('button', { class: 'xbtn' + (compact ? '' : ' backbtn'), type: 'button', 'aria-label': 'Към разговорите', title: 'Към списъка', text: '←', onclick: onBack }) : null,
      group ? groupAvatar(c.title, 32) : h('img', { class: 'mini', src: peer ? mainPhoto(peer) : avatar('?', ''), alt: '', width: '32', height: '32' }),
      h('h2', {}, group
        ? [h('button', { class: 'linkbtn', type: 'button', text: c.title, title: 'Информация за групата', onclick: () => groupInfoDialog(c, reload) }), h('small', { class: 'dim', text: ` · ${c.members.length} души` })]
        : [peer ? h('a', { href: '#/discover', text: peer.nickname, onclick: e => { e.preventDefault(); openProfile(peer); } }) : c.title, peer ? h('small', { class: 'dim', text: ` · ${peer.city}` }) : null]),
      ...(group ? [h('button', { class: 'xbtn', style: 'margin-left:auto', type: 'button', 'aria-label': 'Информация за групата', title: 'Група', text: '👥', onclick: () => groupInfoDialog(c, reload) })]
            : peer ? [h('button', { class: 'xbtn callbtn', style: 'margin-left:auto', type: 'button', 'aria-label': 'Гласово обаждане', title: 'Гласово обаждане', text: '📞', onclick: () => startCall(c, 'audio') }),
                      h('button', { class: 'xbtn callbtn', type: 'button', 'aria-label': 'Видео обаждане', title: 'Видео обаждане', text: '🎥', onclick: () => startCall(c, 'video') }),
                      h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Докладвай', title: 'Докладвай', text: '🚩', onclick: () => reportDialog(peer, c.id) })] : []),
      onFull ? h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Отвори на цял екран', title: 'Цял екран', text: '⤢', onclick: onFull }) : null,
      onCollapse ? h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Скрий', title: 'Скрий (Esc)', text: '▾', onclick: onCollapse }) : null].filter(Boolean)); // native append(null) би написало „null“
    noteEl.textContent = group
      ? '🔒 Лична група. При доклад администратор вижда последните съобщения и файлове в нея.'
      : '🔒 Личен разговор. При доклад администратор може да прегледа размяната ви и файловете.';
  }

  async function reload(force) {
    if (!convId) return;
    const mine = ++token;
    try {
      const r = await api('GET', `/api/chats/${convId}`);
      if (mine !== token) return;
      const grew = !data || r.messages.length !== data.messages.length;
      data = r;
      renderHead(); renderList(force);
      if (grew) onChanged && onChanged(true);
      if (state.unread > 0) refreshBadges();
    } catch (x) {
      if (mine !== token) return;
      if (x.status === 404) { convId = null; data = null; onChanged && onChanged(true, true); } else if (x.status) toast(x.message, true);
    }
  }
  function open(id) {
    if (id === convId) { reload(false); return; }
    convId = id; data = null; sig = ''; closePop(); setPending(null); input.value = '';
    renderHead(); renderList(true); reload(true);
  }
  // Влачене на файл върху панела
  root.addEventListener('dragover', e => { if (convId && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('dropping'); } });
  root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('dropping'); });
  root.addEventListener('drop', e => { root.classList.remove('dropping'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f && convId) { e.preventDefault(); attach(f); } });
  return { el: root, open, reload, get id() { return convId; }, closePop, focus: () => input.focus() };
}

// ── Групи ──
function contactRow(p, cb) {
  return h('label', { class: 'contact' }, cb, h('img', { src: mainPhoto(p), alt: '', width: '36', height: '36' }), h('span', { class: 'ci' }, h('b', { text: p.nickname }), h('small', { class: 'dim', text: p.city })));
}
async function groupCreateDialog(onCreated) {
  let contacts = [];
  try { contacts = (await api('GET', '/api/chats/contacts')).contacts; } catch (x) { toast(x.message, true); return; }
  const err = h('div', { class: 'err', role: 'alert' });
  const title = h('input', { id: 'grp-title', maxlength: '40', placeholder: 'напр. Приятели от Пловдив' });
  const boxes = contacts.map(p => ({ p, cb: h('input', { type: 'checkbox', 'aria-label': p.nickname }) }));
  const count = h('span', { class: 'dim' });
  const upd = () => { const n = boxes.filter(b => b.cb.checked).length; count.textContent = `Избрани: ${n} от 11`; };
  boxes.forEach(b => b.cb.addEventListener('change', upd)); upd();
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Създай групата' });
  openModal(h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    const ids = boxes.filter(b => b.cb.checked).map(b => b.p.id);
    if (title.value.trim().length < 2) { err.textContent = 'Дай име на групата (поне 2 символа).'; return; }
    if (!ids.length) { err.textContent = 'Избери поне един човек.'; return; }
    btn.disabled = true;
    try { const r = await api('POST', '/api/chats/groups', { title: title.value, memberIds: ids }); closeModal(); toast('Групата е създадена 🎉'); onCreated(r.id); }
    catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('div', { class: 'field' }, h('label', { for: 'grp-title', text: 'Име на групата' }), title),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Кого да добавиш?' }), h('p', { class: 'hint', style: 'margin:0 0 .5rem', text: 'Можеш да добавяш само хора, с които вече си писал.' }),
      contacts.length ? h('div', { class: 'contacts' }, boxes.map(b => contactRow(b.p, b.cb)))
        : h('div', { class: 'empty-state', style: 'padding:1rem' }, h('p', { text: 'Още не си писал на никого.' }), h('a', { class: 'btn sm', href: '#/discover', text: 'Открий хора', onclick: closeModal })), count),
    err, h('div', { class: 'actions' }, btn, h('button', { class: 'btn ghost', type: 'button', text: 'Отказ', onclick: closeModal }))),
  { narrow: true, title: 'Нова група' });
}

async function groupInfoDialog(c, changed) {
  const me = state.me.id, owner = c.isOwner;
  const err = h('div', { class: 'err', role: 'alert' });
  const members = h('div', { class: 'contacts' });
  c.members.forEach(m => {
    const row = h('div', { class: 'contact' }, h('img', { src: mainPhoto(m), alt: '', width: '36', height: '36' }),
      h('span', { class: 'ci' }, h('b', { text: m.nickname + (m.id === me ? ' (ти)' : '') }), h('small', { class: 'dim', text: m.role === 'owner' ? 'създател · ' + m.city : m.city })));
    if (m.id !== me) {
      row.append(h('button', { class: 'xbtn', type: 'button', title: 'Докладвай', 'aria-label': `Докладвай ${m.nickname}`, text: '🚩', onclick: () => reportDialog(m, c.id) }));
      if (owner) {
        const rm = h('button', { class: 'xbtn', type: 'button', title: 'Премахни от групата', 'aria-label': `Премахни ${m.nickname}`, text: '✕' });
        let armed = false;
        rm.addEventListener('click', async () => {
          if (!armed) { armed = true; rm.textContent = 'Да?'; setTimeout(() => { armed = false; rm.textContent = '✕'; }, 3000); return; }
          try { await api('DELETE', `/api/chats/${c.id}/members/${m.id}`); closeModal(); toast(`${m.nickname} е премахнат.`); changed(true); } catch (x) { err.textContent = x.message; }
        });
        row.append(rm);
      }
    }
    members.append(row);
  });
  const body = h('div', {}, h('h3', { style: 'margin-top:0', text: `Членове (${c.members.length}/12)` }), members);

  if (owner) {
    const name = h('input', { id: 'grp-rename', value: c.title, maxlength: '40' });
    body.append(h('div', { class: 'field', style: 'margin-top:1rem' }, h('label', { for: 'grp-rename', text: 'Име на групата' }),
      h('div', { class: 'composer', style: 'padding:0;border:0' }, name, h('button', { class: 'btn sm', type: 'button', text: 'Запази', onclick: async () => {
        err.textContent = '';
        try { await api('PUT', `/api/chats/${c.id}`, { title: name.value }); closeModal(); toast('Името е променено.'); changed(true); } catch (x) { err.textContent = x.message; }
      } }))));
    try {
      const have = new Set(c.members.map(m => m.id));
      const cand = (await api('GET', '/api/chats/contacts')).contacts.filter(p => !have.has(p.id));
      if (c.members.length < 12) {
        const boxes = cand.map(p => ({ p, cb: h('input', { type: 'checkbox', 'aria-label': p.nickname }) }));
        body.append(h('h3', { text: 'Добави хора' }), cand.length ? h('div', { class: 'contacts' }, boxes.map(b => contactRow(b.p, b.cb))) : h('p', { class: 'dim', text: 'Няма други познати, които да добавиш. Пиши на още хора, за да ги добавиш тук.' }),
          cand.length ? h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', text: 'Добави избраните', onclick: async () => {
            err.textContent = '';
            const ids = boxes.filter(b => b.cb.checked).map(b => b.p.id);
            if (!ids.length) { err.textContent = 'Избери поне един човек.'; return; }
            try { await api('POST', `/api/chats/${c.id}/members`, { userIds: ids }); closeModal(); toast('Хората са добавени.'); changed(true); } catch (x) { err.textContent = x.message; }
          } })) : null);
      }
    } catch { /* без списък за добавяне */ }
  }
  let armed = false;
  const leave = h('button', { class: 'btn danger', type: 'button', text: 'Напусни групата' });
  leave.addEventListener('click', async () => {
    if (!armed) { armed = true; leave.textContent = 'Сигурен ли си? Натисни пак'; setTimeout(() => { armed = false; leave.textContent = 'Напусни групата'; }, 3500); return; }
    try { await api('DELETE', `/api/chats/${c.id}/members/${me}`); closeModal(); toast('Напусна групата.'); changed(true, true); } catch (x) { err.textContent = x.message; }
  });
  body.append(err, h('hr', { style: 'border:0;border-top:1px solid var(--border);margin:1.2rem 0' }), h('div', { class: 'actions' }, leave));
  openModal(body, { narrow: true, title: c.title });
}

async function newGroupFlow() { await groupCreateDialog(id => openConversation(id)); }

/* ═══════════ Гласови и видео обаждания ═══════════ */
// Сървърът само предава сигналите (offer/answer/ICE) чрез кратки заявки; звукът и образът вървят директно между двамата (WebRTC).
const callRt = { call: null, pc: null, local: null, remote: null, after: 0, poll: null, watch: null, ui: null, els: {}, muted: false, camOff: false, ice: [], remoteSet: false, demo: false,
  tick: null, startedAt: 0, ringer: null, ac: null, sendQ: Promise.resolve(), busyPoll: false, savedTitle: '' };
const callTimer = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

async function getMedia(kind, optional) {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { if (optional) return null; throw new Error('Този браузър не поддържа обаждания.'); }
  try { return await md.getUserMedia({ audio: true, video: kind === 'video' ? { facingMode: 'user' } : false }); }
  catch (e) {
    if (optional) return null;
    throw new Error(e && e.name === 'NotAllowedError' ? `Разреши достъп до микрофона${kind === 'video' ? ' и камерата' : ''} от настройките на браузъра.`
      : e && e.name === 'NotFoundError' ? `Не е намерен микрофон${kind === 'video' ? ' или камера' : ''}.` : 'Микрофонът или камерата не могат да бъдат стартирани.');
  }
}
function ringtone(on) {
  if (!on) { clearInterval(callRt.ringer); callRt.ringer = null; return; }
  try {
    const ac = callRt.ac || (callRt.ac = new (window.AudioContext || window.webkitAudioContext)());
    const tone = (f, at) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = 0.04; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.3); };
    const ring = () => { tone(520, 0); tone(660, 0.4); };
    ring(); callRt.ringer = setInterval(ring, 2400);
  } catch { /* браузърът може да блокира звука преди първо докосване */ }
}

function makePc() {
  const pc = new RTCPeerConnection({ iceServers: (state.meta && state.meta.iceServers) || [] });
  callRt.pc = pc; callRt.remote = new MediaStream(); callRt.remoteSet = false; callRt.ice = [];
  pc.ontrack = e => { e.track && !callRt.remote.getTracks().includes(e.track) && callRt.remote.addTrack(e.track); attachMedia(); };
  pc.onicecandidate = e => { if (e.candidate) sendSignal('ice', JSON.stringify(e.candidate)); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { toast('Връзката се разпадна. Опитай пак.', true); hangup(); } else updateCallUI(); };
  if (callRt.local) callRt.local.getTracks().forEach(t => pc.addTrack(t, callRt.local));
  return pc;
}
function sendSignal(type, payload) {
  const c = callRt.call; if (!c || callRt.demo) return;
  callRt.sendQ = callRt.sendQ.then(() => api('POST', `/api/calls/${c.id}/signal`, { type, payload }).catch(() => {}));
}
async function flushIce() { for (const c of callRt.ice.splice(0)) { try { await callRt.pc.addIceCandidate(c); } catch { /* ignore */ } } }
async function handleSignal(sg) {
  const pc = callRt.pc; if (!pc) return;
  try {
    if (sg.type === 'offer') {
      await pc.setRemoteDescription(JSON.parse(sg.payload)); callRt.remoteSet = true; await flushIce();
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); sendSignal('answer', JSON.stringify(pc.localDescription));
    } else if (sg.type === 'answer') { await pc.setRemoteDescription(JSON.parse(sg.payload)); callRt.remoteSet = true; await flushIce(); }
    else if (sg.type === 'ice') { const c = JSON.parse(sg.payload); if (callRt.remoteSet) await pc.addIceCandidate(c).catch(() => {}); else callRt.ice.push(c); }
  } catch { /* отделен кандидат може да не е валиден */ }
}

// Звънене от чата (само личен разговор).
async function startCall(conv, kind) {
  if (callRt.call) { toast('Вече си в обаждане.', true); return; }
  if (!conv || !conv.peer) return;
  const demo = !!(state.meta && state.meta.callsDemo);
  try {
    callRt.local = await getMedia(kind, demo);
    const r = await api('POST', '/api/calls', { conversationId: conv.id, kind });
    Object.assign(callRt, { call: r.call, demo, after: 0, muted: false, camOff: false, startedAt: 0 });
    if (!demo) { const pc = makePc(); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal('offer', JSON.stringify(pc.localDescription)); }
    renderCallUI(); startCallPoll();
  } catch (x) { cleanupCall(); toast(x.message || 'Обаждането не започна.', true); }
}
async function acceptCall() {
  const c = callRt.call; if (!c) return;
  try {
    callRt.local = await getMedia(c.kind, callRt.demo);
    const r = await api('POST', `/api/calls/${c.id}/answer`);
    callRt.call = { ...c, ...r.call };
    if (!callRt.demo) makePc();
    ringtone(false); onActive(); startCallPoll(); updateCallUI();
  } catch (x) { toast(x.message, true); declineCall(); }
}
async function declineCall() {
  const c = callRt.call; ringtone(false);
  if (c) { try { await api('POST', `/api/calls/${c.id}/decline`); } catch { /* ignore */ } }
  cleanupCall();
}
async function hangup() {
  const c = callRt.call;
  if (c) { try { await api('POST', `/api/calls/${c.id}/end`); } catch { /* ignore */ } }
  cleanupCall();
}
function onActive() { if (!callRt.startedAt) { callRt.startedAt = Date.now(); ringtone(false); clearInterval(callRt.tick); callRt.tick = setInterval(updateCallUI, 1000); } }
function startCallPoll() { clearInterval(callRt.poll); callRt.poll = setInterval(pollCall, 800); pollCall(); }
async function pollCall() {
  const c = callRt.call; if (!c || callRt.busyPoll) return;
  callRt.busyPoll = true;
  try {
    const r = await api('GET', `/api/calls/poll?callId=${c.id}&after=${callRt.after}`);
    if (!callRt.call || callRt.call.id !== c.id) return;
    // Сигналите се приемат чак когато има връзка (pc): докато входящото звъни, offer-ът трябва да остане непрочетен.
    if (callRt.pc) for (const sg of r.signals) { callRt.after = Math.max(callRt.after, sg.id); await handleSignal(sg); }
    if (r.call) {
      const was = callRt.call.status; callRt.demo = callRt.demo || !!r.call.demo;
      callRt.call = { ...callRt.call, ...r.call };
      if (r.call.status === 'active' && was !== 'active') onActive();
      if (!['ringing', 'active'].includes(r.call.status)) { finishCall(r.call.status); return; }
      updateCallUI();
    }
  } catch { /* временна грешка в мрежата */ } finally { callRt.busyPoll = false; }
}
function finishCall(status) {
  const c = callRt.call, name = c && c.peer ? c.peer.nickname : 'Събеседникът', mine = c && !c.incoming;
  const msg = { declined: `${name} отказа обаждането.`, canceled: 'Обаждането е отменено.', missed: mine ? `${name} не вдигна.` : 'Пропуснато обаждане.', ended: callRt.startedAt ? `Обаждането приключи · ${callTimer(Date.now() - callRt.startedAt)}` : 'Обаждането приключи.' }[status];
  cleanupCall(); if (msg) toast(msg);
}
function cleanupCall() {
  ringtone(false);
  clearInterval(callRt.poll); clearInterval(callRt.tick);
  if (callRt.local) callRt.local.getTracks().forEach(t => t.stop());
  if (callRt.pc) { try { callRt.pc.close(); } catch { /* ignore */ } }
  if (callRt.ui) { callRt.ui.remove(); }
  if (callRt.savedTitle) { document.title = callRt.savedTitle; callRt.savedTitle = ''; }
  Object.assign(callRt, { call: null, pc: null, local: null, remote: null, poll: null, tick: null, ui: null, els: {}, after: 0, startedAt: 0, demo: false, busyPoll: false, ice: [], remoteSet: false, sendQ: Promise.resolve() });
  document.body.classList.remove('in-call');
}

// Входящи обаждания: проверяваме на всеки 3 сек., докато няма текущо.
function startCallWatch() {
  if (callRt.watch) return;
  callRt.watch = setInterval(async () => {
    if (callRt.call || !state.me || !state.me.emailVerified || state.me.role === 'admin' || document.hidden) return;
    try {
      const r = await api('GET', '/api/calls/poll');
      if (callRt.call || !r.call || !r.call.incoming || r.call.status !== 'ringing') return;
      Object.assign(callRt, { call: r.call, demo: !!r.call.demo, after: 0, muted: false, camOff: false, startedAt: 0 });
      callRt.savedTitle = document.title; document.title = '📞 Входящо обаждане · Spark';
      renderCallUI(); ringtone(true); startCallPoll();
    } catch { /* ignore */ }
  }, 3000);
}
function stopCallWatch() { if (callRt.watch) { clearInterval(callRt.watch); callRt.watch = null; } if (callRt.call) cleanupCall(); }

function attachMedia() {
  const e = callRt.els; if (!e.remote) return;
  if (callRt.remote && e.remote.srcObject !== callRt.remote) e.remote.srcObject = callRt.remote;
  if (callRt.local && e.local && e.local.srcObject !== callRt.local) e.local.srcObject = callRt.local;
}
function renderCallUI() {
  if (callRt.ui) return;
  const c = callRt.call, video = c.kind === 'video';
  const remote = h('video', { class: 'cremote', autoplay: true, playsinline: true }), local = h('video', { class: 'clocal', autoplay: true, playsinline: true, muted: true });
  local.muted = true;
  const status = h('div', { class: 'cstatus', 'aria-live': 'polite' }), name = h('h2', { class: 'cname', text: c.peer ? c.peer.nickname : 'Обаждане' });
  const ctl = h('div', { class: 'cctl' }), demoNote = h('p', { class: 'cdemo', hidden: true, text: 'Демо: няма реален събеседник. Връзката е симулирана.' });
  const stage = h('div', { class: 'cstage' + (video ? ' video' : '') }, remote, h('div', { class: 'cavatar' }, h('img', { src: c.peer ? mainPhoto(c.peer) : '', alt: '', width: '120', height: '120' })), local);
  callRt.ui = h('div', { class: 'callui', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Обаждане' }, h('div', { class: 'callwin' }, stage, h('div', { class: 'cinfo' }, name, status, demoNote), ctl,
    h('p', { class: 'chint', text: '🔒 Директна връзка между вас двамата. Събеседникът вижда IP адреса ти.' })));
  callRt.els = { remote, local, status, ctl, stage, demoNote };
  document.body.append(callRt.ui); document.body.classList.add('in-call');
  attachMedia(); updateCallUI();
}
function updateCallUI() {
  const c = callRt.call, e = callRt.els; if (!c || !callRt.ui) return;
  const incoming = c.incoming && c.status === 'ringing', live = c.status === 'active';
  const connected = callRt.demo || (callRt.pc && ['connected', 'completed'].includes(callRt.pc.connectionState)) || (callRt.pc && callRt.pc.iceConnectionState === 'connected');
  e.status.textContent = incoming ? `Входящо ${c.kind === 'video' ? 'видео' : 'гласово'} обаждане…` : !live ? 'Звъни…' : !connected ? 'Свързване…' : callTimer(Date.now() - callRt.startedAt);
  e.stage.classList.toggle('live', live && connected);
  e.stage.classList.toggle('ringing', !live);
  e.demoNote.hidden = !callRt.demo;
  e.local.hidden = c.kind !== 'video' || !callRt.local || callRt.camOff;
  clear(e.ctl);
  const btn = (cls, label, text, fn, pressed) => h('button', { class: `cbtn ${cls}`, type: 'button', 'aria-label': label, title: label, 'aria-pressed': pressed === undefined ? null : String(pressed), onclick: fn }, h('span', { 'aria-hidden': 'true', text }), h('small', { text: label }));
  if (incoming) e.ctl.append(btn('bad', 'Откажи', '✕', declineCall), btn('good', 'Приеми', c.kind === 'video' ? '🎥' : '📞', acceptCall));
  else {
    e.ctl.append(btn('', callRt.muted ? 'Включи микрофона' : 'Заглуши', callRt.muted ? '🔇' : '🎙️', () => { callRt.muted = !callRt.muted; if (callRt.local) callRt.local.getAudioTracks().forEach(t => { t.enabled = !callRt.muted; }); updateCallUI(); }, callRt.muted));
    if (c.kind === 'video') e.ctl.append(btn('', callRt.camOff ? 'Включи камерата' : 'Изключи камерата', callRt.camOff ? '🚫' : '📷', () => { callRt.camOff = !callRt.camOff; if (callRt.local) callRt.local.getVideoTracks().forEach(t => { t.enabled = !callRt.camOff; }); updateCallUI(); }, callRt.camOff));
    e.ctl.append(btn('bad', live ? 'Затвори' : 'Откажи', '📞', hangup));
  }
}

/* ═══════════ Плаващо кръгче със съобщения ═══════════ */
const SVG_NS = 'http://www.w3.org/2000/svg';
function chatIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9.5L5 21v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}
const dockVisible = () => !!state.me && state.me.emailVerified && state.me.role !== 'admin' && currentRoute() !== 'messages' && !isMobile();

function syncDock() {
  if (!dockVisible()) {
    if (dock.root) { dock.root.remove(); dock.root = dock.panel = dock.btn = dock.pane = null; }
    dockStop();
    if (!state.me) Object.assign(dock, { open: false, view: 'list', with: null, chats: [] });
    return;
  }
  if (!dock.root) {
    dock.panel = h('section', { class: 'win dockpanel', 'aria-label': 'Мини чат', hidden: !dock.open });
    dock.btn = h('button', { class: 'dockbtn', type: 'button', onclick: () => toggleDock() });
    dock.root = h('div', { class: 'dock', id: 'dock' }, dock.panel, dock.btn);
    dock.pane = createChatPane({ compact: true, onBack: () => dockBack(), onFull: () => { chatWith = dock.with; toggleDock(false); location.hash = '#/messages'; }, onCollapse: () => toggleDock(false),
      onChanged: (grew, gone) => { if (gone) dockBack(); else dockLoadList(); } });
    document.body.append(dock.root);
    if (dock.open) { dockStart(); renderDock(); }
  }
  renderDockButton();
}
function renderDockButton() {
  if (!dock.btn) return;
  const n = state.unread;
  dock.btn.className = 'dockbtn' + (n > 0 ? ' alert' : '');
  dock.btn.setAttribute('aria-expanded', String(dock.open));
  dock.btn.setAttribute('aria-label', (dock.open ? 'Скрий съобщенията' : 'Покажи съобщенията') + (n > 0 ? `, ${n} нови` : ''));
  clear(dock.btn).append(...[chatIcon(), badge(n)].filter(Boolean)); // native append(null) би написало „null“
}
function toggleDock(force) {
  if (!dock.root) return;
  dock.open = force === undefined ? !dock.open : force;
  dock.panel.hidden = !dock.open;
  renderDockButton();
  if (dock.open) { dockStart(); renderDock(); } else { dockStop(); dock.pane.closePop(); }
}
const dockStart = () => { if (!dock.timer) dock.timer = setInterval(() => { if (dock.view === 'thread') dock.pane.reload(false); else dockLoadList(); }, 5000); };
function dockStop() { if (dock.timer) { clearInterval(dock.timer); dock.timer = null; } }
function dockBack() { dock.view = 'list'; dock.with = null; renderDock(); }
function dockOpenWith(id) {
  if (!dock.root) return;
  dock.with = id; dock.view = 'thread';
  if (!dock.open) { dock.open = true; dock.panel.hidden = false; renderDockButton(); dockStart(); }
  renderDock();
}
async function dockLoadList() {
  try { dock.chats = (await api('GET', '/api/chats')).chats; } catch { return; }
  if (dock.view === 'list') renderDockList();
}
function renderDock() {
  if (!dock.panel || !dock.open) return;
  clear(dock.panel);
  if (dock.view === 'thread' && dock.with) { dock.panel.append(dock.pane.el); dock.pane.open(dock.with); return; }
  dock.panel.append(h('div', { class: 'win-head' }, h('h2', { text: '💬 Съобщения' }),
    h('button', { class: 'xbtn', style: 'margin-left:auto', type: 'button', 'aria-label': 'Нова група', title: 'Нова група', text: '👥', onclick: () => newGroupFlow() }),
    h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Отвори на цял екран', title: 'Цял екран', text: '⤢', onclick: () => { toggleDock(false); location.hash = '#/messages'; } }),
    h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Скрий', title: 'Скрий (Esc)', text: '▾', onclick: () => toggleDock(false) })),
    h('div', { class: 'chatlist', role: 'list', id: 'dockList' }));
  renderDockList(); dockLoadList();
}
function chatItem(c, onclick, on) {
  return h('button', { class: 'chatitem' + (on ? ' on' : ''), type: 'button', role: 'listitem', onclick },
    chatAvatar(c), h('span', { class: 'ci' }, h('b', { text: c.title }), h('small', { text: lastLine(c) })), badge(c.unread));
}
function renderDockList() {
  const box = $('#dockList'); if (!box) return;
  clear(box);
  if (!dock.chats.length) { box.append(h('div', { class: 'empty-state', style: 'padding:1.5rem 1rem' }, h('p', { text: 'Още нямаш разговори.' }), h('p', { class: 'dim', text: 'Натисни „💬 Пиши“ на нечия карта или създай група с 👥.' }))); return; }
  dock.chats.forEach(c => box.append(chatItem(c, () => dockOpenWith(c.id))));
}

/* ═══════════ Съобщения и докладване ═══════════ */
// „Пиши“ отваря личен разговор в мини чата (за да останеш на страницата, на която си).
async function openChat(userId) {
  closeModal();
  if (!state.me || state.me.role === 'admin') return;
  try { const r = await api('POST', '/api/chats/direct', { userId }); openConversation(r.id); } catch (x) { toast(x.message, true); }
}
function openConversation(id) {
  if (currentRoute() === 'messages') { chatWith = id; route(); return; }
  if (isMobile()) { chatWith = id; location.hash = '#/messages'; return; }   // на телефон разговорът е на цял екран
  syncDock(); dockOpenWith(id);
}

function reportDialog(p, convId) {
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
      const r = await api('POST', `/api/profiles/${p.id}/report`, { reason: reason.value, details: details.value, block: block.checked, conversationId: convId });
      closeModal();
      if (r.blocked) { disc.profiles = disc.profiles.filter(x => x.id !== p.id); chatWith = null; if (dock.view === 'thread') { dock.view = 'list'; dock.with = null; } }
      toast(r.blocked ? 'Докладът е изпратен и профилът е блокиран.' : 'Докладът е изпратен. Благодарим ти!');
      if (r.blocked) route();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('p', {}, 'Докладваш ', h('b', { text: p.nickname }), '. Администратор ще прегледа случая.'),
    h('div', { class: 'field' }, h('label', { for: 'rp-reason', text: 'Причина' }), reason),
    h('div', { class: 'field' }, h('label', { for: 'rp-details', text: 'Подробности' }), details),
    h('div', { class: 'checkline' }, block, h('label', { for: 'rp-block', text: 'Блокирай този човек (няма да можете да си пишете и да се виждате)' })),
    h('p', { class: 'hint notice', text: convId ? '🔒 С подаването на доклада позволяваш на администратор да прегледа последните съобщения и файлове в този разговор (при група – от всички в нея), за да прецени доклада. Другите ти разговори остават лични.' : '🔒 С подаването на доклада позволяваш на администратор да прегледа вашата размяна на съобщения с този човек, за да прецени дали докладът е основателен. Другите ти разговори остават лични.' }),
    err, h('div', { class: 'actions' }, btn, h('button', { class: 'btn ghost', type: 'button', text: 'Отказ', onclick: closeModal }))),
  { narrow: true, title: 'Докладване на профил' });
}

function viewMessages() {
  const v = clear($('#view'));
  v.classList.add('msgview');
  const thread = on => document.body.classList.toggle('thread-open', !!on);
  const listBox = h('div', { class: 'chatlist', role: 'list' });
  let chats = [];
  const pane = createChatPane({ compact: false,
    onBack: () => { chatWith = null; layout.classList.remove('open'); thread(false); renderList(); showEmpty(); },
    onChanged: (grew, gone) => { if (gone) { chatWith = null; layout.classList.remove('open'); thread(false); showEmpty(); } loadList(); } });
  const threadBox = h('section', { class: 'win chatthread', 'aria-label': 'Разговор' });
  const layout = h('div', { class: 'chatlayout' + (chatWith ? ' open' : '') },
    h('aside', { class: 'win chatside', 'aria-label': 'Разговори' },
      h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: 'Разговори' }),
        h('button', { class: 'btn sm', style: 'margin-left:auto', type: 'button', text: '👥 Група', title: 'Нова група', onclick: () => newGroupFlow() }),
        h('a', { class: 'btn ghost sm', href: '#/discover', text: '＋ Чат', title: 'Намери човек, на когото да пишеш' })), listBox),
    threadBox);
  v.append(h('h1', { text: 'Съобщения' }), layout);

  function showEmpty() {
    clear(threadBox).append(h('div', { class: 'empty-state' }, h('div', { class: 'big', text: '💬' }), h('h3', { text: 'Избери разговор' }), h('p', { text: 'Или започни нов: избери човек и натисни „Пиши“, или създай група.' }),
      h('div', { class: 'actions', style: 'justify-content:center' }, h('a', { class: 'btn', href: '#/discover', text: '＋ Нов чат' }), h('button', { class: 'btn ghost', type: 'button', text: '👥 Нова група', onclick: () => newGroupFlow() }))));
  }
  function select(id) { chatWith = id; layout.classList.add('open'); thread(true); clear(threadBox).append(pane.el); pane.open(id); renderList(); }
  function renderList() {
    clear(listBox);
    if (!chats.length) { listBox.append(h('div', { class: 'empty-state', style: 'padding:1.5rem 1rem' }, h('p', { text: 'Още нямаш разговори.' }), h('p', { class: 'dim', text: 'Намери човек в „Открий хора“ и натисни „💬 Пиши“ на неговата карта.' }), h('a', { class: 'btn', href: '#/discover', text: 'Открий хора' }))); return; }
    chats.forEach(c => listBox.append(chatItem(c, () => select(c.id), c.id === chatWith)));
  }
  async function loadList() { try { chats = (await api('GET', '/api/chats')).chats; renderList(); } catch (x) { if (x.status) toast(x.message, true); } }

  if (chatWith) { thread(true); clear(threadBox).append(pane.el); pane.open(chatWith); } else showEmpty();
  loadList();
  viewTimer = setInterval(() => { loadList(); if (chatWith) pane.reload(false); }, 5000);
}

/* ═══════════ Потвърждение на имейл, банери, обжалване ═══════════ */
async function refreshMe() {
  try { const r = await api('GET', '/api/me'); if (r.user) { state.me = r.user; renderChrome(); } } catch { /* ignore */ }
}
const fmtUntil = at => new Date(at).toLocaleString('bg-BG', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const APPEAL = { pending: 'Обжалването ти се разглежда.', accepted: 'Обжалването е уважено.', rejected: 'Обжалването е отхвърлено.' };

// Ленти най-горе: суспензия, предупреждение, пауза.
function renderBanners() {
  const box = $('#banners'); if (!box) return;
  clear(box);
  const me = state.me;
  if (!me || !me.emailVerified) return;
  const appealBtn = p => (p.appealStatus === 'none' ? h('button', { class: 'btn sm', type: 'button', text: 'Обжалвай', onclick: () => appealDialog(p) }) : h('span', { class: 'tag', text: APPEAL[p.appealStatus] }));
  if (me.suspension) {
    const s = me.suspension;
    box.append(h('div', { class: 'banner danger', role: 'alert' }, h('span', { class: 'bico', 'aria-hidden': 'true', text: '⏸' }),
      h('div', { class: 'btxt' }, h('b', { text: `Профилът ти е временно спрян до ${fmtUntil(s.until)}` }), h('span', { text: `Причина: ${s.reason}. Можеш да четеш, но не можеш да пишеш, харесваш и качваш. Не се показваш в търсенето.` }), s.appealNote ? h('span', { class: 'dim', text: `Коментар по обжалването: ${s.appealNote}` }) : null),
      appealBtn(s)));
  }
  if (me.warning) {
    const w = me.warning;
    box.append(h('div', { class: 'banner warn', role: 'alert' }, h('span', { class: 'bico', 'aria-hidden': 'true', text: '⚠️' }),
      h('div', { class: 'btxt' }, h('b', { text: 'Получи предупреждение от администратор' }), h('span', { text: `Причина: ${w.reason}. При повторни нарушения профилът може да бъде спрян или дерегистриран.` })),
      appealBtn(w), h('button', { class: 'btn ghost sm', type: 'button', text: 'Разбрах', onclick: async () => { try { state.me = (await api('POST', `/api/me/penalties/${w.id}/ack`)).user; renderBanners(); } catch (x) { toast(x.message, true); } } })));
  }
  if (me.paused) {
    box.append(h('div', { class: 'banner info' }, h('span', { class: 'bico', 'aria-hidden': 'true', text: '😴' }),
      h('div', { class: 'btxt' }, h('b', { text: 'Профилът ти е на пауза' }), h('span', { text: 'Не се показваш в търсенето, но разговорите ти работят нормално.' })),
      h('button', { class: 'btn sm', type: 'button', text: 'Покажи профила', onclick: async () => { try { state.me = (await api('PUT', '/api/me/settings', { paused: false })).user; renderChrome(); toast('Профилът ти отново се вижда.'); } catch (x) { toast(x.message, true); } } })));
  }
}

function appealDialog(p) {
  const err = h('div', { class: 'err', role: 'alert' });
  const text = h('textarea', { id: 'ap-text', maxlength: '500', placeholder: 'Опиши защо смяташ, че наказанието е неправилно…', style: 'min-height:7rem' });
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Изпрати обжалване' });
  openModal(h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { state.me = (await api('POST', `/api/me/penalties/${p.id}/appeal`, { text: text.value })).user; closeModal(); renderBanners(); toast('Обжалването е изпратено. Администратор ще го прегледа.'); }
    catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('p', {}, h('b', { text: p.kind === 'suspension' ? 'Суспензия' : 'Предупреждение' }), `: ${p.reason}`),
    h('div', { class: 'field' }, h('label', { for: 'ap-text', text: 'Твоето обяснение' }), text),
    h('p', { class: 'hint', text: 'Можеш да обжалваш всяко наказание веднъж. Решението е на администратор и ти ще го видиш тук.' }),
    err, h('div', { class: 'actions' }, btn, h('button', { class: 'btn ghost', type: 'button', text: 'Отказ', onclick: closeModal }))),
  { narrow: true, title: 'Обжалване' });
}

// Екран, докато имейлът не е потвърден.
function viewVerify() {
  const v = clear($('#view')), me = state.me;
  const err = h('div', { class: 'err', role: 'alert' }), info = h('div', { class: 'ok', role: 'status' });
  const code = h('input', { id: 'vf-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', placeholder: '______', class: 'codeinput', 'aria-label': 'Код за потвърждение' });
  const btn = h('button', { class: 'btn block', type: 'submit', text: 'Потвърди' });
  const resend = h('button', { class: 'btn ghost sm', type: 'button', text: 'Изпрати нов код' });
  const mailBox = h('div');
  let timer = null, left = 0;
  const tick = () => { left = Math.max(0, left - 1); resend.disabled = left > 0; resend.textContent = left > 0 ? `Нов код след ${left} с.` : 'Изпрати нов код'; if (!left) { clearInterval(timer); timer = null; } };
  const cool = sec => { left = sec; resend.disabled = true; clearInterval(timer); timer = setInterval(tick, 1000); tick(); };
  const showDev = () => {
    clear(mailBox);
    const dm = state.devMail;
    if (dm && dm.mode === 'dev' && dm.devCode) {
      mailBox.append(h('div', { class: 'devmail' }, h('b', { text: '📬 Демо поща' }), h('p', { class: 'dim', text: 'Този сайт е в демо режим и не праща истински имейли. Ето писмото, което щеше да получиш:' }),
        h('div', { class: 'mailcard' }, h('small', { class: 'dim', text: `До: ${me.email}` }), h('b', { text: 'Spark: код за потвърждение' }), h('span', {}, 'Твоят код е: ', h('b', { class: 'bigcode', text: dm.devCode }))),
        h('button', { class: 'btn ghost sm', type: 'button', text: 'Попълни кода', onclick: () => { code.value = dm.devCode; code.focus(); } })));
    }
  };
  showDev();
  cool(60);

  const change = h('form', { novalidate: true, class: 'changemail', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { const r = await api('POST', '/api/verify/change-email', { email: nem.value, password: npw.value }); state.me = r.user; state.devMail = r.mail; toast('Имейлът е сменен. Пратихме нов код.'); route(); }
    catch (x) { err.textContent = x.message; }
  } });
  const nem = h('input', { id: 'vf-new', type: 'email', autocomplete: 'email', placeholder: 'правилния имейл', 'aria-label': 'Нов имейл' });
  const npw = h('input', { id: 'vf-pass', type: 'password', autocomplete: 'current-password', placeholder: 'паролата ти (за сигурност)', 'aria-label': 'Парола' });
  change.append(h('div', { class: 'row' }, nem, npw), h('button', { class: 'btn ghost sm', type: 'submit', text: 'Смени имейла' }));

  resend.addEventListener('click', async () => {
    err.textContent = ''; info.textContent = '';
    try { const r = await api('POST', '/api/verify/resend'); state.devMail = r.mail; showDev(); info.textContent = 'Изпратихме нов код.'; cool(60); }
    catch (x) { err.textContent = x.message; if (x.data && x.data.retryAfter) cool(Math.min(x.data.retryAfter, 3600)); }
  });
  v.append(h('div', { class: 'verifywrap' }, h('section', { class: 'win enter' },
    h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: '✉️ Потвърди имейла си' })),
    h('div', { class: 'win-body' },
      h('p', {}, 'Пратихме 6-цифрен код на ', h('b', { text: me.emailMasked || me.email }), '. Въведи го, за да отключиш сайта. Така пазим профилите от ботове и спам.'),
      mailBox,
      h('form', { novalidate: true, onsubmit: async e => {
        e.preventDefault(); err.textContent = ''; info.textContent = ''; btn.disabled = true;
        try { const r = await api('POST', '/api/verify/email', { code: code.value }); state.me = r.user; state.devMail = null; toast('Имейлът е потвърден ✔'); location.hash = '#/profile'; route(); }
        catch (x) { err.textContent = x.message; if (x.code === 'too_many_attempts' || x.code === 'code_expired') info.textContent = 'Поискай нов код.'; } finally { btn.disabled = false; }
      } }, h('div', { class: 'field' }, h('label', { for: 'vf-code', text: 'Код' }), code), err, info, btn),
      h('div', { class: 'actions', style: 'margin-top:1rem' }, resend, h('button', { class: 'btn ghost sm', type: 'button', text: 'Изход', onclick: logout })),
      h('details', { class: 'wrongmail' }, h('summary', { text: 'Грешен имейл?' }), h('p', { class: 'hint', text: 'Въведи правилния имейл и паролата си. Непотвърдените профили се изтриват след 7 дни.' }), change)))));
  code.focus();
}

/* ═══════════ Активност: харесали те, взаимни, посетители ═══════════ */
function viewActivity() {
  const v = clear($('#view'));
  let tab = 'likedMe', data = null;
  const body = h('div', { class: 'stack' }), tabs = h('div', { class: 'tabs', role: 'tablist', style: 'max-width:34rem' });
  v.append(h('h1', { text: 'Активност' }), h('p', { class: 'dim', text: 'Кой те е харесал, с кого се харесвате взаимно и кой е разглеждал профила ти през последните 30 дни.' }), tabs, body);
  function paint() {
    clear(tabs).append(...[['likedMe', '💙 Харесват те'], ['mutual', '✨ Взаимни'], ['visitors', '👀 Посетители']].map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), text: `${t}${data ? ` (${data[k].length})` : ''}`, onclick: () => { tab = k; paint(); } })));
    clear(body);
    if (!data) { body.append(h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Зареждане' })); return; }
    const list = data[tab], empty = { likedMe: ['💙', 'Още никой не те е харесал', 'Допълни профила си и качи снимки – така те забелязват по-лесно.'], mutual: ['✨', 'Още нямаш взаимни харесвания', 'Харесай хора от „Открий хора“. Когато те харесат обратно, ще ги видиш тук.'], visitors: ['👀', 'Още никой не е гледал профила ти', 'Посетителите се показват тук. Ако ти не искаш да се записваш в чужди профили, изключи го от настройките.'] }[tab];
    if (!list.length) { body.append(h('div', { class: 'win' }, h('div', { class: 'empty-state' }, h('div', { class: 'big', text: empty[0] }), h('h3', { text: empty[1] }), h('p', { text: empty[2] }), h('a', { class: 'btn', href: '#/discover', text: 'Открий хора' })))); return; }
    body.append(h('div', { class: 'grid' }, list.map((p, i) => profileCard(p, i, tab === 'visitors' ? `Гледа те: ${fmtDate(p.at)}` : tab === 'likedMe' ? `Хареса те: ${fmtDate(p.at)}` : ''))));
  }
  paint();
  api('GET', '/api/activity').then(r => { data = r; paint(); }).catch(x => toast(x.message, true));
}

/* ═══════════ Администрация ═══════════ */
let adminRefresh = () => {};
function viewAdmin() {
  const v = clear($('#view'));
  const head = t => h('div', { class: 'win-head' }, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), h('h2', { text: t }));
  const tiles = h('div', { class: 'tiles' });
  const bars = h('div', { class: 'bars' });
  const repBox = h('div', { class: 'replist' });
  const dosBox = h('div', { class: 'replist' });
  const dosFilters = h('div', { class: 'chips', style: 'margin-bottom:.7rem', role: 'group', 'aria-label': 'Филтър на досиетата' });
  let dosFilter = 'all', dosQuery = '';
  const repFilters = h('div', { class: 'chips', style: 'margin-bottom:.9rem', role: 'group', 'aria-label': 'Филтър на докладите' });
  let repFilter = 'open';
  const tbody = h('tbody');
  const count = h('span', { class: 'dim' });
  v.append(h('h1', { text: 'Админ панел' }),
    h('p', { class: 'dim', text: 'Преглед на сайта отвътре: статистика, потребители и модерация. Виждаш и обикновения сайт през менюто горе.' }),
    h('div', { class: 'stack' },
    h('section', { class: 'win enter' }, head('📊 Накратко'), h('div', { class: 'win-body' }, tiles)),
    h('div', { class: 'two' },
      h('section', { class: 'win enter', style: '--i:1' }, head('📍 Профили по области'), h('div', { class: 'win-body' }, bars)),
      h('section', { class: 'win enter', style: '--i:2' }, head('🧭 Бърз достъп'), h('div', { class: 'win-body' },
        h('p', { class: 'dim', text: 'Разгледай сайта като потребител:' }),
        h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/discover', text: 'Открий хора' }), h('a', { class: 'btn ghost', href: '#/profile', text: 'Моят профил' }), h('a', { class: 'btn ghost', href: '#/settings', text: 'Дизайн' }))))),
    h('section', { class: 'win enter', style: '--i:3', id: 'reportsWin' }, head('🚩 Доклади'), h('div', { class: 'win-body' },
      h('p', { class: 'dim', text: 'Разговорът се вижда само към доклад (снимка от момента на докладването). Всяко отваряне се записва в журнал.' }),
      repFilters, repBox)),
    h('section', { class: 'win enter', style: '--i:4', id: 'dossiersWin' }, head('📁 Досиета'), h('div', { class: 'win-body' },
      h('p', { class: 'dim', text: 'Досие има само за докладван профил. Тук са историята му, наказанията и бележките. Наказания и дерегистрация се налагат от досието.' }),
      dosFilters, h('input', { type: 'search', placeholder: 'Търси по никнейм', 'aria-label': 'Търсене в досиетата', style: 'max-width:22rem;margin:.2rem 0 .9rem', oninput: debounce(e => { dosQuery = e.target.value; loadDossiers(); }, 250) }), dosBox)),
    h('section', { class: 'win enter', style: '--i:5' }, head('👥 Потребители'), h('div', { class: 'win-body' },
      h('div', { class: 'citybar' }, h('input', { type: 'search', placeholder: 'Търси по никнейм или потребителско име', 'aria-label': 'Търсене на потребители', style: 'max-width:26rem',
        oninput: debounce(e => loadUsers(e.target.value), 250) }), count),
      h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Никнейм', 'Потребител', 'Възраст', 'Място', 'Снимки', '♥', 'Тип', ''].map(t => h('th', { scope: 'col', text: t })))), tbody))))));

  async function loadStats() {
    try {
      const st = await api('GET', '/api/admin/stats');
      clear(tiles).append(...[['Профили', st.users], ['Реални', st.real], ['Демо', st.demo], ['Снимки', st.photos], ['Харесвания', st.likes], ['Отворени доклади', st.openReports], ['Обжалвания', st.openAppeals], ['Спрени профили', st.suspended], ['Досиета', st.dossiers], ['Онлайн', st.online], ['Нови за 24ч', st.newToday]]
        .map(([l, n]) => h('div', { class: 'tile' }, h('b', { text: String(n) }), h('span', { text: l }))));
      const max = Math.max(1, ...st.byRegion.map(c => c.count));
      clear(bars).append(...st.byRegion.slice(0, 12).map(c => h('div', { class: 'bar' },
        h('span', { text: c.region }), h('div', { class: 'track', role: 'img', 'aria-label': `${c.region}: ${c.count}` }, h('i', { style: `width:${Math.round(c.count / max * 100)}%` })), h('b', { text: String(c.count) }))));
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
          h('td', {}, h('b', { text: u.nickname })), h('td', { class: 'dim', text: u.isDemo ? '—' : u.username }), h('td', { text: String(u.age) }), h('td', { text: u.regionName && u.regionName !== u.city ? `${u.city}, ${u.regionName}` : u.city }),
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
          h('button', { class: 'btn sm', type: 'button', text: 'Разгледай', onclick: () => openCase(x.id, () => { loadReports(); loadStats(); loadDossiers(); refreshBadges(); }) })));
      }
    } catch (x) { toast(x.message, true); }
  }

  async function loadDossiers() {
    try {
      const { dossiers } = await api('GET', `/api/admin/dossiers?status=${dosFilter}&q=${encodeURIComponent(dosQuery.trim())}`);
      clear(dosFilters).append(...[['all', 'Всички'], ['active', 'Активни'], ['suspended', 'Спрени'], ['appeals', 'С обжалване'], ['deregistered', 'Дерегистрирани']]
        .map(([k, t]) => h('button', { class: 'chip', type: 'button', text: t, 'aria-pressed': String(dosFilter === k), onclick: () => { dosFilter = k; loadDossiers(); } })));
      clear(dosBox);
      if (!dossiers.length) dosBox.append(h('p', { class: 'dim', text: 'Няма досиета в тази група.' }));
      for (const d of dossiers) {
        const st = d.status === 'deregistered' ? h('span', { class: 'pill bad', text: 'Дерегистриран' }) : d.suspendedUntil ? h('span', { class: 'pill warn', text: `Спрян до ${fmtUntil(d.suspendedUntil)}` }) : d.status === 'closed' ? h('span', { class: 'pill muted', text: 'Затворено' }) : h('span', { class: 'pill good', text: 'Активен' });
        dosBox.append(h('div', { class: 'rep' },
          h('div', { class: 'who' }, h('b', { text: d.nickname }), h('span', { class: 'dim', text: ` · ${d.reports} ${d.reports === 1 ? 'доклад' : 'доклада'}${d.openReports ? ` (${d.openReports} отворен${d.openReports === 1 ? '' : 'и'})` : ''}` })),
          st,
          h('span', { class: 'pill ' + (d.strikes >= d.strikeLimit ? 'bad' : d.strikes ? 'warn' : 'muted'), title: 'Предупреждения и суспензии', text: `Страйкове ${d.strikes}/${d.strikeLimit}` }),
          d.appeals ? h('span', { class: 'pill warn', text: `⚖️ ${d.appeals} обжалване` }) : null,
          h('button', { class: 'btn sm', type: 'button', text: 'Отвори досие', onclick: () => openDossier(d.id, refreshAll) })));
      }
    } catch (x) { toast(x.message, true); }
  }
  const refreshAll = () => { loadStats(); loadReports(); loadDossiers(); refreshBadges(); };
  adminRefresh = refreshAll;
  loadStats(); loadReports(); loadDossiers(); loadUsers();
}

// ── Досие: история, наказания, бележки ──
const KIND = { warning: ['⚠️ Предупреждение', 'warn'], suspension: ['⏸ Суспензия', 'warn'], deregistration: ['⛔ Дерегистрация', 'bad'] };
async function openDossier(id, changed) {
  let d;
  try { d = await api('GET', `/api/admin/dossiers/${id}`); } catch (x) { toast(x.message, true); return; }
  const sub = d.subject, alive = sub.alive && d.dossier.status === 'active';
  const reload = () => { closeModal(); openDossier(id, changed); changed && changed(); };
  const err = h('div', { class: 'err', role: 'alert' });

  const facts = h('dl', { class: 'facts' },
    h('dt', { text: 'Статус' }), h('dd', {}, d.dossier.status === 'deregistered' ? h('span', { class: 'pill bad', text: 'Дерегистриран' }) : d.dossier.status === 'closed' ? h('span', { class: 'pill muted', text: 'Затворено (профилът е изтрит от потребителя)' }) : h('span', { class: 'pill good', text: 'Активен' })),
    h('dt', { text: 'Страйкове' }), h('dd', {}, h('span', { class: 'pill ' + (d.strikes >= d.strikeLimit ? 'bad' : d.strikes ? 'warn' : 'muted'), text: `${d.strikes} от ${d.strikeLimit}` })),
    sub.age ? [h('dt', { text: 'Профил' }), h('dd', { text: `${sub.age} г. · ${sub.city || ''}${sub.regionName && sub.regionName !== sub.city ? ', обл. ' + sub.regionName : ''}` })] : null,
    sub.joinedAt ? [h('dt', { text: 'Регистриран' }), h('dd', { text: fmtDate(sub.joinedAt) })] : null,
    sub.emailMasked ? [h('dt', { text: 'Имейл' }), h('dd', { text: `${sub.emailMasked}${sub.emailVerified === false ? ' (непотвърден)' : sub.emailVerified ? ' ✓' : ''}` })] : null,
    h('dt', { text: 'Заведено' }), h('dd', { text: fmtWhen(d.dossier.createdAt) }),
    d.dossier.closedAt ? [h('dt', { text: 'Закрито' }), h('dd', { text: `${fmtWhen(d.dossier.closedAt)} · ${d.dossier.closedReason}` })] : null,
    d.emailBanned ? [h('dt', { text: 'Имейл' }), h('dd', { text: '🚫 Забранен за нова регистрация' })] : null);

  const pens = h('div', { class: 'timeline' });
  if (!d.penalties.length) pens.append(h('p', { class: 'dim', text: 'Още няма наказания.' }));
  for (const p of d.penalties) {
    const [label, tone] = KIND[p.kind];
    const row = h('div', { class: 'tl' },
      h('div', { class: 'tlhead' }, h('span', { class: 'pill ' + tone, text: label + (p.days ? ` · ${p.days} дни` : '') }),
        p.kind === 'suspension' ? h('span', { class: 'pill ' + (p.active ? 'warn' : 'muted'), text: p.liftedAt ? 'вдигната' : p.active ? `до ${fmtUntil(p.until)}` : 'изтекла' }) : null,
        h('small', { class: 'dim', text: `${fmtWhen(p.at)} · ${p.issuedNick}` })),
      h('p', { class: 'bio', text: p.reason }), p.note ? h('p', { class: 'hint', text: `🔒 Вътрешна бележка: ${p.note}` }) : null,
      p.liftedNote && p.liftedAt ? h('p', { class: 'hint', text: `Вдигната: ${p.liftedNote}` }) : null);
    if (p.appealStatus !== 'none') {
      const box = h('div', { class: 'appeal' }, h('b', { text: `⚖️ Обжалване (${p.appealStatus === 'pending' ? 'чака решение' : p.appealStatus === 'accepted' ? 'уважено' : 'отхвърлено'})` }), h('p', { class: 'bio', text: p.appealText }), p.appealNote ? h('p', { class: 'hint', text: `Решение: ${p.appealNote}` }) : null);
      if (p.appealStatus === 'pending') {
        const note = h('input', { 'aria-label': 'Коментар към решението', placeholder: 'Коментар към решението (по желание)', maxlength: '300' });
        const decide = async dec => { try { await api('POST', `/api/admin/penalties/${p.id}/appeal`, { decision: dec, note: note.value }); toast(dec === 'accepted' ? 'Обжалването е уважено, наказанието е отменено.' : 'Обжалването е отхвърлено.'); reload(); } catch (x) { err.textContent = x.message; } };
        box.append(note, h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', text: '✔ Уважи (отмени наказанието)', onclick: () => decide('accepted') }), h('button', { class: 'btn ghost sm', type: 'button', text: '✖ Отхвърли', onclick: () => decide('rejected') })));
      }
      row.append(box);
    }
    if (p.kind === 'suspension' && p.active) row.append(h('div', { class: 'actions' }, h('button', { class: 'btn ghost sm', type: 'button', text: 'Вдигни суспензията', onclick: async () => { try { await api('POST', `/api/admin/penalties/${p.id}/lift`, { note: 'Вдигната ръчно' }); toast('Суспензията е вдигната.'); reload(); } catch (x) { err.textContent = x.message; } } })));
    pens.append(row);
  }

  const reps = h('div', { class: 'timeline' });
  if (!d.reports.length) reps.append(h('p', { class: 'dim', text: 'Няма доклади.' }));
  for (const r of d.reports) reps.append(h('div', { class: 'tl' }, h('div', { class: 'tlhead' }, h('span', { class: 'tag', text: r.reasonLabel }), h('span', { class: 'pill ' + (r.status === 'open' ? 'warn' : r.status === 'upheld' ? 'bad' : 'good'), text: r.status === 'open' ? 'Отворен' : r.status === 'upheld' ? 'Основателен' : 'Неоснователен' }),
      h('small', { class: 'dim', text: `${fmtWhen(r.createdAt)} · от ${r.reporterNick}${r.convTitle ? ` · група „${r.convTitle}“` : ''}` })),
    r.details ? h('p', { class: 'bio', text: r.details }) : null,
    h('button', { class: 'btn ghost sm', type: 'button', text: 'Отвори казуса', onclick: () => { closeModal(); openCase(r.id, changed); } })));

  const noteIn = h('textarea', { id: 'dos-note', maxlength: '1000', placeholder: 'Вътрешна бележка (виждат я само администратори)…', style: 'min-height:4.5rem' });
  const notes = h('div', { class: 'timeline' }, d.notes.length ? d.notes.map(n => h('div', { class: 'tl' }, h('small', { class: 'dim', text: `${fmtWhen(n.at)} · ${n.admin}` }), h('p', { class: 'bio', text: n.note }))) : h('p', { class: 'dim', text: 'Няма бележки.' }));

  const actions = h('div', { class: 'actions' });
  if (alive) {
    actions.append(h('button', { class: 'btn', type: 'button', text: '⚖️ Наложи наказание…', onclick: () => penaltyDialog(d, reload) }),
      h('button', { class: 'btn danger', type: 'button', text: '⛔ Дерегистрирай…', onclick: () => deregisterDialog(d, reload) }));
  }
  openModal(h('div', {},
    d.recommendDeregister ? h('div', { class: 'banner danger', style: 'margin-bottom:1rem' }, h('span', { class: 'bico', text: '⚠️' }), h('div', { class: 'btxt' }, h('b', { text: `Достигнат е лимитът от ${d.strikeLimit} наказания` }), h('span', { text: 'При повторни нарушения се препоръчва дерегистрация. Решението е твое.' }))) : null,
    h('div', { class: 'two' }, h('div', {}, facts, sub.bio ? [h('h3', { text: 'Био' }), h('p', { class: 'bio', text: sub.bio })] : null, actions, err),
      h('div', {}, h('h3', { style: 'margin-top:0', text: 'Наказания' }), pens)),
    h('div', { class: 'two', style: 'margin-top:1.2rem' }, h('div', {}, h('h3', { text: `Доклади (${d.reports.length})` }), reps),
      h('div', {}, h('h3', { text: 'Бележки' }), notes, h('div', { class: 'field', style: 'margin-top:.6rem' }, noteIn, h('div', { class: 'actions' }, h('button', { class: 'btn ghost sm', type: 'button', text: 'Добави бележка', onclick: async () => {
        if (noteIn.value.trim().length < 2) { err.textContent = 'Напиши бележка.'; return; }
        try { await api('POST', `/api/admin/dossiers/${d.dossier.id}/notes`, { note: noteIn.value }); reload(); } catch (x) { err.textContent = x.message; } } }))))),
    h('p', { class: 'hint', text: 'Отварянето на досие и всяко действие в него се записват в журнала.' })),
  { title: `Досие: ${d.dossier.nickname}` });
}

function penaltyDialog(d, done) {
  const err = h('div', { class: 'err', role: 'alert' });
  const kind = h('select', { id: 'pn-kind', onchange: () => { daysField.hidden = kind.value !== 'suspension'; } }, h('option', { value: 'warning', text: '⚠️ Предупреждение (без ограничения)' }), h('option', { value: 'suspension', text: '⏸ Временна суспензия' }));
  const days = h('select', { id: 'pn-days' }, d.suspendDays.map(n => h('option', { value: String(n), text: `${n} ${n === 1 ? 'ден' : 'дни'}` })));
  const daysField = h('div', { class: 'field', hidden: true }, h('label', { for: 'pn-days', text: 'За колко време' }), days);
  const reason = h('textarea', { id: 'pn-reason', maxlength: '300', placeholder: 'Напр.: Тормоз на други потребители в лични съобщения.', style: 'min-height:5rem' });
  const note = h('input', { id: 'pn-note', maxlength: '500', placeholder: 'Вътрешна бележка (по желание)' });
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Наложи наказанието' });
  const next = d.strikes + 1;
  openModal(h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try {
      const r = await api('POST', `/api/admin/dossiers/${d.dossier.id}/penalties`, { kind: kind.value, days: Number(days.value), reason: reason.value, note: note.value });
      closeModal(); toast(r.recommendDeregister ? `Наложено. Страйкове: ${r.strikes}/${r.strikeLimit} – обмисли дерегистрация.` : 'Наказанието е наложено. Потребителят е уведомен.'); done();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('p', {}, 'Към ', h('b', { text: d.dossier.nickname }), `. Това ще е наказание № ${next} от ${d.strikeLimit}.`),
    h('div', { class: 'field' }, h('label', { for: 'pn-kind', text: 'Вид' }), kind), daysField,
    h('div', { class: 'field' }, h('label', { for: 'pn-reason', text: 'Причина (показва се на потребителя)' }), reason),
    h('div', { class: 'field' }, h('label', { for: 'pn-note', text: 'Вътрешна бележка' }), note),
    h('p', { class: 'hint notice', text: 'Потребителят получава известие с причината и може да обжалва. При суспензия не може да пише, харесва и качва и се скрива от търсенето.' }),
    err, h('div', { class: 'actions' }, btn, h('button', { class: 'btn ghost', type: 'button', text: 'Отказ', onclick: closeModal }))),
  { narrow: true, title: 'Налагане на наказание' });
}

function deregisterDialog(d, done) {
  const err = h('div', { class: 'err', role: 'alert' });
  const reason = h('textarea', { id: 'dr-reason', maxlength: '300', placeholder: 'Причина (изпраща се на потребителя): напр. Системен тормоз и заплахи.', style: 'min-height:5rem' });
  const note = h('input', { id: 'dr-note', maxlength: '500', placeholder: 'Вътрешна бележка (по желание)' });
  const btn = h('button', { class: 'btn danger', type: 'submit', text: 'Дерегистрирай завинаги' });
  let armed = false;
  openModal(h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    if (reason.value.trim().length < 5) { err.textContent = 'Напиши причина (поне 5 символа).'; return; }
    if (!armed) { armed = true; btn.textContent = 'Сигурен ли си? Натисни пак'; setTimeout(() => { armed = false; btn.textContent = 'Дерегистрирай завинаги'; }, 4000); return; }
    btn.disabled = true;
    try { await api('POST', `/api/admin/dossiers/${d.dossier.id}/deregister`, { reason: reason.value, note: note.value }); closeModal(); toast(`${d.dossier.nickname} е дерегистриран. Имейлът му е забранен.`); done(); }
    catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('div', { class: 'banner danger', style: 'margin-bottom:1rem' }, h('span', { class: 'bico', text: '⛔' }), h('div', { class: 'btxt' }, h('b', { text: 'Необратимо действие' }),
      h('span', { text: 'Профилът, снимките и личните му разговори се изтриват. С неговия имейл (и негови варианти с точки и +етикет) няма да може да се регистрира отново. Досието и доказателствата в докладите остават.' }))),
    h('div', { class: 'field' }, h('label', { for: 'dr-reason', text: 'Причина' }), reason),
    h('div', { class: 'field' }, h('label', { for: 'dr-note', text: 'Вътрешна бележка' }), note),
    err, h('div', { class: 'actions' }, btn, h('button', { class: 'btn ghost', type: 'button', text: 'Отказ', onclick: closeModal }))),
  { narrow: true, title: `Дерегистрация: ${d.dossier.nickname}` });
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
    if (m.role === 'system') { transcript.append(h('div', { class: 'sysmsg', text: m.body })); continue; }
    const r = m.body ? SparkEmo.render(m.body) : null;
    const label = m.from + (m.role === 'reporter' ? ' (докладва)' : m.role === 'reported' ? ' (докладван)' : '');
    transcript.append(h('div', { class: 'bubble ' + (m.role === 'reporter' ? 'mine' : m.role === 'reported' ? 'accused' : 'theirs') },
      h('small', { class: 'from', text: label }), m.attachment ? attachmentNode(m.attachment) : null, r ? h('span', { class: 'txt' }, ...r.nodes) : null, h('time', { datetime: m.at, text: fmtTime(m.at) })));
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
          h('p', { class: 'dim', text: `${rep.age} г. · ${rep.city}${rep.regionName && rep.regionName !== rep.city ? ', обл. ' + rep.regionName : ''} · ${rep.photos} снимки · в сайта от ${fmtDate(rep.createdAt)}` }),
          h('p', { class: 'bio', text: rep.bio || 'Няма био.' }),
          rep.otherReports ? h('p', {}, h('span', { class: 'tag st-upheld', text: `⚠️ Още ${rep.otherReports} доклада срещу този профил` })) : null] : null),
      h('div', {},
        h('h3', { text: d.conversation && d.conversation.group ? `Групов чат „${d.conversation.title}“ (снимка към момента на доклада)` : 'Разговор (снимка към момента на доклада)' }),
        h('p', { class: 'hint', text: d.conversation && d.conversation.group ? 'Показани са последните съобщения и файлове в тази група. Останалите чатове не са достъпни.' : 'Показан е само разговорът между тези двама души. Останалите чатове не са достъпни.' }),
        transcript)),
    h('div', { class: 'field', style: 'margin-top:1rem' }, h('label', { for: 'case-note', text: 'Бележка на администратора' }), note),
    h('div', { class: 'actions' },
      r.status !== 'upheld' ? h('button', { class: 'btn', type: 'button', text: '✔ Основателен', onclick: () => decide('upheld') }) : null,
      r.status !== 'dismissed' ? h('button', { class: 'btn ghost', type: 'button', text: '✖ Неоснователен', onclick: () => decide('dismissed') }) : null,
      r.status !== 'open' ? h('button', { class: 'btn ghost', type: 'button', text: '↺ Върни като отворен', onclick: () => decide('open') }) : null,
      r.dossierId ? h('button', { class: 'btn ghost', type: 'button', text: '📁 Досие и наказания', onclick: () => { closeModal(); openDossier(r.dossierId, changed); } }) : null,
      rep && d.reported ? delBtn : null),
    h('p', { class: 'hint', text: 'Отварянето на този доклад е записано в журнала.' })),
  { title: `Доклад #${r.id}` });
}

/* ═══════════ Маршрутизация ═══════════ */
function currentRoute() {
  const r = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0];
  return ['discover', 'profile', 'settings', 'admin', 'messages', 'activity'].includes(r) ? r : '';
}
function route() {
  closeModal();
  stopViewTimer();
  document.body.classList.remove('thread-open');
  { const vEl = $('#view'); if (vEl) vEl.className = ''; }
  let r = currentRoute();
  if (!state.me && r !== 'settings') r = '';
  if (r === 'admin' && !(state.me && state.me.role === 'admin')) r = state.me ? 'discover' : '';
  if (r === 'messages' && !(state.me && state.me.role !== 'admin')) r = state.me ? 'discover' : '';
  if (r === 'activity' && !(state.me && state.me.role !== 'admin')) r = state.me ? 'discover' : '';
  // Непотвърден имейл → само екранът за потвърждение (и изход).
  if (state.me && !state.me.emailVerified) { stopBadges(); stopCallWatch(); renderChrome(); if (state.meta) { viewVerify(); document.title = 'Потвърди имейла · Spark'; } return; }
  if (state.me) { startBadges(); startCallWatch(); } else { stopBadges(); stopCallWatch(); }
  if (state.me && r === '') { r = 'discover'; history.replaceState(null, '', '#/discover'); }
  renderChrome();
  if (!state.meta) return;
  ({ '': viewLanding, discover: viewDiscover, profile: viewProfile, settings: viewSettings, admin: viewAdmin, messages: viewMessages, activity: viewActivity })[r]();
  window.scrollTo(0, 0);
  const main = $('#view'); if (main) main.focus({ preventScroll: true });
  document.title = ({ '': 'Spark — запознанства', discover: 'Открий хора · Spark', profile: 'Моят профил · Spark', settings: 'Дизайн и настройки · Spark', admin: 'Админ · Spark', messages: 'Съобщения · Spark', activity: 'Активност · Spark' })[r];
  applyTitleBadge();
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
