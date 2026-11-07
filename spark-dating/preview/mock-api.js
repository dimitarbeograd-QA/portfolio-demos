// Статичен преглед: имитира /api/* в браузъра (без сървър). Данните са само в този браузър.
(() => {
  'use strict';
  const D = window.__SPARK_PREVIEW__; // { places, interests, people, ... }
  const KEY = 'spark.preview.v3', FKEY = 'spark.preview.files.v2';
  window.confirm = () => true; // в прегледа диалозите са недостъпни
  const MIN_AGE = 18, MAX_PHOTOS = 6;
  // ── Области и населени места (ЕКАТТЕ на НСИ) ──
  const REGIONS = D.places.regions;
  const REGION_NAME = new Map(REGIONS.map(r => [r.code, r.name]));
  const PLACES = D.places.places.map(([id, kind, name, region, ob]) => ({ id, kind, name, region, obshtina: D.places.obshtini[ob] || '', label: kind === 'гр.' ? name : `${kind} ${name}`, key: name.toLowerCase() }));
  const BY_ID = new Map(PLACES.map(p => [p.id, p]));
  // ── Наблизо: същата логика като на сървъра (центрове на населените места от GeoNames, CC BY 4.0) ──
  const GEO = D.geo || {};
  const dKm = (a, b) => { if (!a || !b) return null; const r = x => x * Math.PI / 180, h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const bucket = km => (km === null ? null : km < 5 ? 5 : km < 50 ? Math.round(km / 5) * 5 : Math.round(km / 10) * 10);
  const locOk = u => !!u.locAt && Date.now() - u.locAt < 30 * 864e5;
  const BY_REGION = new Map(REGIONS.map(r => [r.code, PLACES.filter(p => p.region === r.code)]));
  const describe = p => ({ id: p.id, label: p.label, kind: p.kind, name: p.name, obshtina: p.obshtina, region: p.region, regionName: REGION_NAME.get(p.region) });
  const placeFields = u => { const p = BY_ID.get(u.placeId); return p ? { city: p.label, placeId: p.id, region: p.region, regionName: REGION_NAME.get(p.region), obshtina: p.obshtina } : { city: u.city || '', placeId: '', region: '', regionName: '', obshtina: '' }; };
  function searchPlaces(code, q, limit) {
    const list = BY_REGION.get(code) || [];
    const term = String(q || '').toLowerCase().replace(/^(гр\.|с\.|ман\.)\s*/, '').trim();
    if (!term) return list.slice(0, limit);
    const a = [], b = []; for (const p of list) { const i = p.key.indexOf(term); if (i === 0) a.push(p); else if (i > 0) b.push(p); }
    return a.concat(b).slice(0, limit);
  }
  let db = { users: [], likes: [], seq: 1000, session: null, convs: [], messages: [], blocks: [], calls: [], reports: null, rseq: 0, dossiers: [], penalties: [], notes: [], visits: [], banned: [], dereg: [], verif: {} };
  let files = {}; // id -> { id, name, size, kind, url (data URL) } – пазят се отделно, защото са големи
  try { const raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw); } catch { /* без storage */ }
  db.messages = db.messages || []; db.blocks = db.blocks || []; db.convs = db.convs || [];
  for (const k of ['dossiers', 'penalties', 'notes', 'visits', 'banned', 'dereg', 'calls']) db[k] = db[k] || []; db.verif = db.verif || {};
  try { files = JSON.parse(localStorage.getItem(FKEY) || '{}'); } catch { files = {}; }
  const saveFiles = () => { try { localStorage.setItem(FKEY, JSON.stringify(files)); } catch { /* квотата е пълна – файловете остават само в тази сесия */ } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };

  let demo = D.people.map((p, i) => ({ ...p, id: i + 1, isDemo: true, photos: [], lastMin: (i * 37) % 600, likesBase: (i * 5) % 7, created: i }));
  db.gone = db.gone || [];
  demo = demo.filter(d => !db.gone.includes(d.id));
  const all = () => demo.concat(db.users);
  const people = () => all().filter(u => u.role !== 'admin'); // админът не е в публичните списъци
  const blocked = (a, b) => db.blocks.some(x => (x.from === a && x.to === b) || (x.from === b && x.to === a));
  const iso = ms => new Date(ms).toISOString();
  const visibleMsg = m => m.at <= Date.now();
  const ageFrom = b => { const d = new Date(b), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
  const hash = s => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return String(h); };
  const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,18}[\p{L}\p{N}]$/u, USER = /^[A-Za-z0-9_.-]{3,30}$/;
  const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const bad = (msg, status = 400) => ok({ error: msg }, status);
  const meUser = () => db.users.find(u => u.id === db.session);
  const errc = (msg, status, code, extra = {}) => ok({ error: msg, code, ...extra }, status);

  // ── Имейл (същите правила като на сървъра) ──
  const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'sharklasers.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com']);
  function parseEmail(raw) {
    const email = String(raw || '').trim();
    if (!email || email.length > 254 || !/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/.test(email)) return { ok: false, reason: 'invalid' };
    let [local, domain] = email.toLowerCase().split('@');
    if (domain === 'googlemail.com') domain = 'gmail.com';
    if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable' };
    local = local.split('+')[0]; if (domain === 'gmail.com') local = local.replace(/\./g, '');
    return local ? { ok: true, email, key: `${local}@${domain}` } : { ok: false, reason: 'invalid' };
  }
  const maskEmail = e => { const [l, d] = String(e || '').split('@'); if (!d) return ''; const dot = d.lastIndexOf('.'); return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(l.length - 2, 5)))}@${d[0]}${'*'.repeat(Math.max(1, Math.min(dot - 1, 5)))}${d.slice(dot)}`; };
  const isVerified = u => !!(u.isDemo || u.role === 'admin' || u.verified);
  const activeSusp = uid => db.penalties.filter(p => p.userId === uid && p.kind === 'suspension' && !p.liftedAt && p.endsAt > Date.now()).sort((a, b) => b.endsAt - a.endsAt)[0] || null;
  const visible = u => !u.paused && isVerified(u) && !activeSusp(u.id);
  const penView = p => (p ? { id: p.id, kind: p.kind, reason: p.reason, days: p.days || null, at: iso(p.at), until: p.endsAt ? iso(p.endsAt) : null, appealStatus: p.appealStatus, appealText: p.appealText, appealNote: p.appealNote } : null);
  const GOALS = D.goals;
  const completeness = u => {
    const steps = [['photo', 'Добави основна снимка', 25, u.photos.length >= 1], ['photos3', 'Добави поне 3 снимки', 15, u.photos.length >= 3], ['bio', 'Напиши био (поне 40 символа)', 20, (u.bio || '').length >= 40],
      ['interests', 'Избери поне 3 интереса', 15, u.interests.length >= 3], ['goal', 'Кажи какво търсиш', 10, !!u.goal], ['email', 'Потвърди имейла си', 15, isVerified(u)]];
    return { pct: steps.reduce((n, x) => n + (x[3] ? x[2] : 0), 0), steps: steps.map(([key, label, points, done]) => ({ key, label, points, done })) };
  };

  function pub(u, viewer) {
    const likes = db.likes.filter(l => l.to === u.id).length + (u.likesBase || 0);
    return {
      id: u.id, nickname: u.nickname, age: u.isDemo ? u.age : ageFrom(u.birthDate), gender: u.gender, lookingFor: u.lookingFor, ...placeFields(u),
      bio: u.bio, goal: u.goal || '', goalLabel: GOALS[u.goal] || '', interests: [...u.interests].sort(), photos: u.photos.map(p => ({ id: p.id, url: p.url })), isDemo: !!u.isDemo,
      online: u.isDemo ? u.lastMin < 5 : true, liked: db.likes.some(l => l.from === viewer && l.to === u.id),
      likedMe: db.likes.some(l => l.from === u.id && l.to === viewer), likes, isMe: u.id === viewer,
      distanceKm: (() => { const v = all().find(x => x.id === viewer); return u.id === viewer || u.hideDistance || !v || v.hideDistance ? null : bucket(dKm(GEO[v.placeId], GEO[u.placeId])); })(),
      locVerified: locOk(u),
    };
  }
  const full = u => ({ ...pub(u, u.id), username: u.username, birthDate: u.birthDate, theme: u.theme || null, role: u.role || 'user',
    email: u.email || '', emailMasked: maskEmail(u.email), emailVerified: isVerified(u), paused: !!u.paused, hideVisits: !!u.hideVisits, hideDistance: !!u.hideDistance, placeChangeAt: u.placeChangedAt ? new Date(u.placeChangedAt + 7 * 864e5).toISOString() : null,
    suspension: penView(activeSusp(u.id)), warning: penView(db.penalties.filter(p => p.userId === u.id && p.kind === 'warning' && !p.ackedAt && !p.liftedAt).sort((a, b) => b.id - a.id)[0]),
    completeness: completeness(u) });

  const routes = [];
  const route = (m, re, fn) => routes.push([m, re, fn]);

  route('GET', /^\/api\/meta$/, () => ok({
    regions: REGIONS.map(r => ({ code: r.code, name: r.name, count: people().filter(u => visible(u) && u.placeId && BY_ID.get(u.placeId).region === r.code).length })),
    interests: D.interests, minAge: MIN_AGE, maxPhotos: MAX_PHOTOS, total: people().filter(visible).length, demoAdmin: true, goals: GOALS, mailDev: true, callsDemo: true, iceServers: [], reportReasons: D.reportReasons,
  }));
  route('GET', /^\/api\/places$/, ({ q }) => {
    const region = q.get('region') || ''; if (!REGION_NAME.has(region)) return bad('Изберете област.');
    const limit = Math.min(60, Math.max(1, parseInt(q.get('limit'), 10) || 30));
    const counts = new Map(); people().filter(visible).forEach(u => { if (u.placeId && BY_ID.get(u.placeId).region === region) counts.set(u.placeId, (counts.get(u.placeId) || 0) + 1); });
    const list = q.get('populated') === '1'
      ? [...counts.keys()].map(id => BY_ID.get(id)).sort((a, b) => counts.get(b.id) - counts.get(a.id) || a.name.localeCompare(b.name, 'bg'))
      : searchPlaces(region, q.get('q'), limit);
    return ok({ places: list.slice(0, limit).map(p => ({ ...describe(p), count: counts.get(p.id) || 0 })), total: list.length });
  });
  route('GET', /^\/api\/me$/, () => ok({ user: meUser() ? full(meUser()) : null }));

  // ── Потвърждаване на имейл (демо поща: кодът се връща на интерфейса) ──
  const newCode = () => String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  function issueCode(u) {
    const v = db.verif[u.id] || { hourStart: Date.now(), hourCount: 0 };
    if (Date.now() - v.hourStart > 3600e3) { v.hourStart = Date.now(); v.hourCount = 0; }
    const code = newCode();
    db.verif[u.id] = { ...v, code, expires: Date.now() + 15 * 60e3, attempts: 0, sentAt: Date.now(), hourCount: v.hourCount + 1 };
    return { mode: 'dev', devCode: code };
  }
  function checkEmail(raw, exceptId) {
    const pe = parseEmail(raw);
    if (!pe.ok) return { err: bad(pe.reason === 'disposable' ? 'Не се приемат временни имейл адреси. Използвай личен имейл.' : 'Въведи валиден имейл адрес.') };
    if (db.banned.includes(pe.key)) return { err: bad('Този имейл не може да се използва за регистрация.', 403) };
    const taken = db.users.find(u => u.emailKey === pe.key);
    if (taken && taken.id !== exceptId) return { err: bad('Този имейл вече е регистриран.', 409) };
    return { pe };
  }
  route('POST', /^\/api\/register$/, ({ body: b }) => {
    if (b.website) return bad('Невалидна заявка.');
    const username = String(b.username || '').trim(), nickname = String(b.nickname || '').trim().replace(/\s+/g, ' '), password = String(b.password || '');
    if (!USER.test(username)) return bad('Потребителското име трябва да е 3–30 символа: латински букви, цифри, . _ -');
    if (!NICK.test(nickname)) return bad('Никнеймът трябва да е 3–20 символа (букви, цифри, интервал, . _ -).');
    const em = checkEmail(b.email); if (em.err) return em.err;
    if (password.length < 8) return bad('Паролата трябва да е поне 8 символа.');
    if (!b.birthDate || isNaN(new Date(b.birthDate))) return bad('Невалидна дата на раждане.');
    const age = ageFrom(b.birthDate);
    if (age < MIN_AGE) return bad('Сайтът е само за пълнолетни (18+).');
    if (age > 99) return bad('Невалидна дата на раждане.');
    if (!['male', 'female', 'other'].includes(b.gender)) return bad('Изберете пол.');
    const place = BY_ID.get(String(b.placeId || '')); if (!place) return bad('Изберете област и населено място от списъка.');
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return bad('Това потребителско име е заето.', 409);
    if (db.dereg.includes(username.toLowerCase())) return bad('Това потребителско име не е достъпно.', 409);
    if (all().some(u => u.nickname.toLowerCase() === nickname.toLowerCase())) return bad('Този никнейм е зает.', 409);
    const u = { id: ++db.seq, username, pw: hash(password), nickname, birthDate: b.birthDate, gender: b.gender, lookingFor: ['male', 'female', 'any'].includes(b.lookingFor) ? b.lookingFor : 'any',
      placeId: place.id, bio: '', interests: [], photos: [], theme: null, goal: '', email: em.pe.email, emailKey: em.pe.key, verified: false, paused: false, hideVisits: false, created: 1000 + db.seq };
    db.users.push(u); db.session = u.id; const mail = issueCode(u); save();
    return ok({ user: full(u), mail }, 201);
  });
  const sessionOnly = fn => args => (meUser() ? fn({ ...args, me: meUser() }) : bad('Трябва да влезете в профила си.', 401));
  route('POST', /^\/api\/verify\/email$/, sessionOnly(({ body: b, me }) => {
    if (isVerified(me)) return ok({ user: full(me) });
    const v = db.verif[me.id]; if (!v) return bad('Няма изпратен код. Поискай нов.');
    if (v.expires < Date.now()) return errc('Кодът е изтекъл. Поискай нов.', 400, 'code_expired');
    if (v.attempts >= 5) return errc('Твърде много грешни опити. Поискай нов код.', 429, 'too_many_attempts');
    if (String(b.code || '').replace(/\s/g, '') !== v.code) { v.attempts++; save(); return bad(`Грешен код. Остават ${Math.max(0, 5 - v.attempts)} опита.`); }
    me.verified = true; delete db.verif[me.id]; save(); return ok({ user: full(me) });
  }));
  const resendWait = id => { const v = db.verif[id]; if (!v) return 0; const since = (Date.now() - v.sentAt) / 1000; if (since < 60) return Math.ceil(60 - since); return v.hourCount >= 5 && Date.now() - v.hourStart < 3600e3 ? 3600 : 0; };
  route('POST', /^\/api\/verify\/resend$/, sessionOnly(({ me }) => {
    if (isVerified(me)) return bad('Имейлът вече е потвърден.');
    const w = resendWait(me.id); if (w) return errc(w >= 3600 ? 'Достигнахте лимита за кодове. Опитайте след час.' : `Изчакай ${w} сек. преди нов код.`, 429, 'wait', { retryAfter: w });
    const mail = issueCode(me); save(); return ok({ mail });
  }));
  route('POST', /^\/api\/verify\/change-email$/, sessionOnly(({ body: b, me }) => {
    if (isVerified(me)) return bad('Имейлът вече е потвърден.');
    if (me.pw !== hash(String(b.password || ''))) return bad('Паролата е грешна.', 403);
    const em = checkEmail(b.email, me.id); if (em.err) return em.err;
    const w = resendWait(me.id); if (w) return errc(`Изчакай ${Math.min(w, 3600)} сек. преди нов код.`, 429, 'wait', { retryAfter: w });
    me.email = em.pe.email; me.emailKey = em.pe.key; const mail = issueCode(me); save(); return ok({ user: full(me), mail });
  }));
  route('POST', /^\/api\/login$/, ({ body: b }) => {
    const u = db.users.find(x => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
    if (!u && db.dereg.includes(String(b.username || '').trim().toLowerCase())) return errc('Този профил е дерегистриран заради нарушение на правилата на сайта.', 403, 'deregistered');
    if (!u || u.pw !== hash(String(b.password || ''))) return bad('Грешно потребителско име или парола.', 401);
    db.session = u.id; save(); return ok({ user: full(u) });
  });
  route('POST', /^\/api\/logout$/, () => { db.session = null; save(); return ok({ ok: true }); });

  // Нива: sessionOnly (само вход) → authed (+потвърден имейл) → active (+без суспензия)
  const authed = fn => sessionOnly(args => (isVerified(args.me) ? fn(args) : errc('Потвърди имейла си, за да продължиш.', 403, 'email_unverified')));
  const fmtBg = ms => new Date(ms).toLocaleString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const active = fn => authed(args => { const sp = activeSusp(args.me.id); return sp ? errc(`Профилът ти е временно спрян до ${fmtBg(sp.endsAt)}. Причина: ${sp.reason}`, 403, 'suspended', { until: iso(sp.endsAt), penaltyId: sp.id }) : fn(args); });

  route('PUT', /^\/api\/me$/, active(({ body: b, me }) => {
    if (b.nickname !== undefined) {
      const n = String(b.nickname).trim().replace(/\s+/g, ' ');
      if (!NICK.test(n)) return bad('Никнеймът трябва да е 3–20 символа (букви, цифри, интервал, . _ -).');
      if (all().some(u => u.id !== me.id && u.nickname.toLowerCase() === n.toLowerCase())) return bad('Този никнейм е зает.', 409);
      me.nickname = n;
    }
    if (['male', 'female', 'other'].includes(b.gender)) me.gender = b.gender;
    if (['male', 'female', 'any'].includes(b.lookingFor)) me.lookingFor = b.lookingFor;
    if (b.placeId !== undefined) { if (!BY_ID.has(String(b.placeId))) return bad('Изберете област и населено място от списъка.'); if (String(b.placeId) !== me.placeId) { if (me.placeChangedAt && Date.now() - me.placeChangedAt < 7 * 864e5) return bad('Населеното място може да се сменя веднъж на 7 дни.', 429); me.placeId = String(b.placeId); me.placeChangedAt = Date.now(); me.locAt = null; } }
    if (b.goal !== undefined) { if (b.goal !== '' && !GOALS[b.goal]) return bad('Невалидна стойност за „Какво търся“.'); me.goal = b.goal; }
    if (b.bio !== undefined) { if (String(b.bio).length > 600) return bad('Биото може да е до 600 символа.'); me.bio = String(b.bio).trim(); }
    if (Array.isArray(b.interests)) me.interests = [...new Set(b.interests.filter(x => D.interests.includes(x)))].slice(0, 8);
    save(); return ok({ user: full(me) });
  }));
  route('PUT', /^\/api\/me\/settings$/, authed(({ body: b, me }) => { if (b.paused !== undefined) me.paused = !!b.paused; if (b.hideVisits !== undefined) me.hideVisits = !!b.hideVisits; if (b.hideDistance !== undefined) me.hideDistance = !!b.hideDistance; save(); return ok({ user: full(me) }); }));
  route('PUT', /^\/api\/me\/password$/, sessionOnly(({ body: b, me }) => {
    if (me.pw !== hash(String(b.current || ''))) return bad('Текущата парола е грешна.', 403);
    if (String(b.next || '').length < 8) return bad('Новата парола трябва да е 8–72 символа.');
    me.pw = hash(b.next); save(); return ok({ ok: true });
  }));
  route('PUT', /^\/api\/me\/theme$/, sessionOnly(({ body: b, me }) => { me.theme = b.theme || null; save(); return ok({ theme: me.theme }); }));
  route('DELETE', /^\/api\/me$/, sessionOnly(({ body: b, me }) => {
    if (me.pw !== hash(String(b.password || ''))) return bad('Паролата е грешна.', 403);
    db.users = db.users.filter(u => u.id !== me.id); db.likes = db.likes.filter(l => l.from !== me.id && l.to !== me.id); db.session = null; save(); return ok({ ok: true });
  }));

  route('POST', /^\/api\/me\/photos$/, active(({ body: b, me }) => {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(b.dataUrl || ''))) return bad('Невалиден файл. Позволени са JPG, PNG и WebP.');
    if (me.photos.length >= MAX_PHOTOS) return bad(`Можете да качите най-много ${MAX_PHOTOS} снимки.`);
    me.photos.push({ id: ++db.seq, url: b.dataUrl }); save(); return ok({ user: full(me) }, 201);
  }));
  route('DELETE', /^\/api\/me\/photos\/(\d+)$/, active(({ m, me }) => {
    const i = me.photos.findIndex(p => p.id === Number(m[1])); if (i < 0) return bad('Снимката не е намерена.', 404);
    me.photos.splice(i, 1); save(); return ok({ user: full(me) });
  }));
  route('PUT', /^\/api\/me\/photos\/(\d+)\/main$/, active(({ m, me }) => {
    const i = me.photos.findIndex(p => p.id === Number(m[1])); if (i < 0) return bad('Снимката не е намерена.', 404);
    me.photos.unshift(me.photos.splice(i, 1)[0]); save(); return ok({ user: full(me) });
  }));

  route('POST', /^\/api\/me\/location\/verify$/, active(({ body: b, me }) => {
    const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracy);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return bad('Невалидно местоположение.');
    if (Number.isFinite(acc) && acc > 5000) return bad('Сигналът е твърде неточен. Опитайте на открито или с включен GPS.');
    const km = dKm([lat, lng], GEO[me.placeId]);
    if (km === null) return bad('Няма координати за избраното населено място.');
    if (km > 30) return bad(`Изглежда си на около ${Math.round(km / 5) * 5} км от избраното населено място. Сменете мястото в профила или опитайте отново от там.`, 409);
    me.locAt = Date.now(); save(); return ok({ user: full(me) });
  }));
  route('GET', /^\/api\/profiles$/, authed(({ q, me }) => {
    let list = people().filter(u => u.id !== me.id && !blocked(u.id, me.id) && visible(u));
    let near = null;
    if (q.get('nearby')) {
      const km = Number(q.get('nearby'));
      if (![10, 25, 50, 100, 200].includes(km)) return bad('Невалиден радиус.');
      if (me.hideDistance) return bad('Търсенето „Наблизо“ е изключено, защото си скрил разстоянието си (Дизайн и настройки → Поверителност).', 409);
      near = new Map(); for (const pl of PLACES) { const d = dKm(GEO[me.placeId], GEO[pl.id]); if (d !== null && d <= km) near.set(pl.id, d); }
      list = list.filter(u => !u.hideDistance && near.has(u.placeId));
    }
    if (q.get('goal')) { if (!GOALS[q.get('goal')]) return bad('Непозната цел.'); list = list.filter(u => u.goal === q.get('goal')); }
    if (q.get('region') && !near) { if (!REGION_NAME.has(q.get('region'))) return bad('Непозната област.'); list = list.filter(u => (BY_ID.get(u.placeId) || {}).region === q.get('region')); }
    if (q.get('place') && !near) { if (!BY_ID.has(q.get('place'))) return bad('Непознато населено място.'); list = list.filter(u => u.placeId === q.get('place')); }
    if (q.get('gender')) list = list.filter(u => u.gender === q.get('gender'));
    const age = u => (u.isDemo ? u.age : ageFrom(u.birthDate));
    if (q.get('ageMin')) list = list.filter(u => age(u) >= Number(q.get('ageMin')));
    if (q.get('ageMax')) list = list.filter(u => age(u) <= Number(q.get('ageMax')));
    if (q.get('withPhoto') === '1') list = list.filter(u => u.photos.length);
    if (q.get('online') === '1') list = list.filter(u => !u.isDemo || u.lastMin < 5);
    if (q.get('lookingForMe') === '1') list = list.filter(u => u.lookingFor === 'any' || u.lookingFor === (me.gender === 'other' ? 'any' : me.gender));
    const ints = q.getAll('interest'); if (ints.length) list = list.filter(u => u.interests.some(i => ints.includes(i)));
    const term = (q.get('q') || '').trim().toLowerCase(); if (term) list = list.filter(u => u.nickname.toLowerCase().includes(term));
    const sorts = { active: (a, b) => (a.lastMin ?? 0) - (b.lastMin ?? 0), new: (a, b) => b.created - a.created, young: (a, b) => age(a) - age(b), old: (a, b) => age(b) - age(a) };
    sorts.nearest = (a, b) => near.get(a.placeId) - near.get(b.placeId);
    list.sort(near && (!q.get('sort') || q.get('sort') === 'nearest') ? sorts.nearest : (sorts[q.get('sort')] || sorts.active));
    const limit = Math.min(48, Number(q.get('limit')) || 12), offset = Number(q.get('offset')) || 0;
    return ok({ total: list.length, offset, profiles: list.slice(offset, offset + limit).map(u => pub(u, me.id)) });
  }));
  route('GET', /^\/api\/profiles\/(\d+)$/, authed(({ m, me }) => {
    const u = people().find(x => x.id === Number(m[1]));
    if (u && u.id !== me.id && !blocked(u.id, me.id) && !me.hideVisits) { const day = new Date().toISOString().slice(0, 10); if (!db.visits.some(v => v.v === me.id && v.t === u.id && v.day === day)) { db.visits.push({ v: me.id, t: u.id, day }); save(); } }
    return u && !blocked(u.id, me.id) ? ok({ profile: pub(u, me.id) }) : bad('Профилът не е намерен.', 404);
  }));
  route('GET', /^\/api\/activity$/, authed(({ me }) => {
    const okU = id => { const u = people().find(x => x.id === id); return u && visible(u) && !blocked(u.id, me.id) ? u : null; };
    const mine = new Set(db.likes.filter(l => l.from === me.id).map(l => l.to));
    const liked = db.likes.filter(l => l.to === me.id).map(l => ({ u: okU(l.from), at: l.at })).filter(x => x.u).reverse().map(x => ({ ...pub(x.u, me.id), at: x.at || new Date().toISOString() }));
    const cut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), seen = new Map();
    db.visits.filter(v => v.t === me.id && v.day >= cut && okU(v.v)).forEach(v => { if (!seen.has(v.v) || seen.get(v.v) < v.day) seen.set(v.v, v.day); });
    const visitors = [...seen].sort((a, b) => b[1].localeCompare(a[1])).map(([id, day]) => ({ ...pub(okU(id), me.id), at: day }));
    return ok({ likedMe: liked.filter(p => !mine.has(p.id)), mutual: liked.filter(p => mine.has(p.id)), visitors });
  }));
  route('POST', /^\/api\/profiles\/(\d+)\/like$/, active(({ m, me }) => {
    const id = Number(m[1]), u = people().find(x => x.id === id);
    if (!u || blocked(id, me.id)) return bad('Профилът не е намерен.', 404);
    if (id === me.id) return bad('Не можете да харесате себе си.');
    const i = db.likes.findIndex(l => l.from === me.id && l.to === id);
    if (i >= 0) db.likes.splice(i, 1); else db.likes.push({ from: me.id, to: id, at: new Date().toISOString() });
    // Демо профил „отвръща“ на харесване, за да се види взаимността.
    if (u.isDemo && i < 0 && id % 3 === 0 && !db.likes.some(l => l.from === id && l.to === me.id)) db.likes.push({ from: id, to: me.id });
    save(); return ok({ profile: pub(u, me.id) });
  }));

  // ── Админ (в прегледа: вход без парола, данните са само в този браузър) ──
  const ADMIN_ID = 999;
  route('POST', /^\/api\/demo-admin$/, () => {
    let a = db.users.find(u => u.id === ADMIN_ID);
    if (!a) { a = { id: ADMIN_ID, username: 'admin', pw: hash(Math.random() + ''), nickname: 'Админ', birthDate: '1990-01-01', gender: 'other', lookingFor: 'any', placeId: D.adminPlaceId, bio: 'Администратор на Spark.', interests: [], photos: [], theme: null, role: 'admin', created: 0 }; db.users.push(a); }
    db.session = ADMIN_ID; save(); return ok({ user: full(a) });
  });
  const adminOnly = fn => authed(args => (args.me.role === 'admin' ? fn(args) : bad('Нямате достъп.', 403)));
  const ageOf = u => (u.isDemo ? u.age : ageFrom(u.birthDate));
  route('GET', /^\/api\/admin\/stats$/, adminOnly(() => {
    const ps = people(), real = ps.filter(u => !u.isDemo), by = {};
    ps.forEach(u => { const n = REGION_NAME.get((BY_ID.get(u.placeId) || {}).region) || '—'; by[n] = (by[n] || 0) + 1; });
    const g = {}; ps.forEach(u => { g[u.gender] = (g[u.gender] || 0) + 1; });
    return ok({ users: ps.length, real: real.length, demo: ps.length - real.length, openReports: (db.reports || []).filter(r => r.status === 'open').length, openAppeals: db.penalties.filter(p => p.appealStatus === 'pending').length, suspended: new Set(db.penalties.filter(p => p.kind === 'suspension' && !p.liftedAt && p.endsAt > Date.now()).map(p => p.userId)).size, dossiers: db.dossiers.length, photos: ps.reduce((n, u) => n + u.photos.length, 0), likes: db.likes.length,
      online: ps.filter(u => !u.isDemo || u.lastMin < 5).length, newToday: real.length,
      byRegion: Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([region, count]) => ({ region, count })), byGender: g });
  }));
  route('GET', /^\/api\/admin\/users$/, adminOnly(({ q }) => {
    const term = (q.get('q') || '').trim().toLowerCase();
    const list = all().filter(u => !term || u.nickname.toLowerCase().includes(term) || (u.username || '').toLowerCase().includes(term)).sort((a, b) => b.id - a.id).slice(0, 200);
    return ok({ users: list.map(u => ({ id: u.id, username: u.username || '', nickname: u.nickname, age: ageOf(u), gender: u.gender, ...placeFields(u), isDemo: !!u.isDemo, role: u.role || 'user',
      createdAt: '', lastSeen: '', photos: u.photos.length, likes: db.likes.filter(l => l.to === u.id).length + (u.likesBase || 0) })) });
  }));
  route('DELETE', /^\/api\/admin\/users\/(\d+)$/, adminOnly(({ m }) => {
    const id = Number(m[1]), u = all().find(x => x.id === id);
    if (!u) return bad('Потребителят не е намерен.', 404);
    if (u.role === 'admin') return bad('Администраторски акаунт не може да се изтрива.', 403);
    if (u.isDemo) { demo.splice(demo.indexOf(u), 1); db.gone.push(id); } else db.users = db.users.filter(x => x.id !== id);
    db.likes = db.likes.filter(l => l.from !== id && l.to !== id); save(); return ok({ ok: true });
  }));

  // ── Разговори: помощни функции ──
  const userById = id => all().find(u => u.id === id);
  const nickOf = id => (userById(id) || {}).nickname || 'Изтрит профил';
  const convById = id => db.convs.find(c => c.id === id);
  const memberOf = (c, uid) => c && c.members.find(m => m.id === uid);
  const dkey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  const msgsOf = c => db.messages.filter(m => m.cid === c.id && visibleMsg(m)).sort((x, y) => x.id - y.id);
  const lastId = c => db.messages.reduce((n, m) => (m.cid === c.id ? Math.max(n, m.id) : n), 0);
  const attView = id => { const f = files[id]; return f ? { id: f.id, name: f.name, size: f.size, kind: f.kind, variant: f.variant || '', url: f.url } : null; };
  const msgView = (m, me) => ({ id: m.id, kind: m.kind, senderId: m.from || null, senderNick: m.from ? nickOf(m.from) : '', mine: m.from === me.id, body: m.body, at: iso(m.at), attachment: attView(m.att) });
  const peerUser = (c, me) => { const o = c.members.find(m => m.id !== me.id); const u = o && people().find(x => x.id === o.id); return u && !blocked(me.id, u.id) ? u : null; };
  const addSystem = (c, actor, text, at = Date.now()) => { const m = { id: ++db.seq, cid: c.id, from: actor, kind: 'system', body: text, att: null, at }; db.messages.push(m); return m.id; };
  const addMsg = (c, from, body, att, at = Date.now()) => { const m = { id: ++db.seq, cid: c.id, from, kind: 'user', body, att: att || null, at }; db.messages.push(m); if (att && files[att]) files[att].mid = m.id; return m; };
  function directConv(a, b) {
    let c = db.convs.find(x => x.kind === 'direct' && x.key === dkey(a, b));
    if (!c) { c = { id: ++db.seq, kind: 'direct', title: '', key: dkey(a, b), members: [{ id: a, role: 'member', from: 0, read: 0 }, { id: b, role: 'member', from: 0, read: 0 }] }; db.convs.push(c); }
    return c;
  }
  const unreadOf = (c, uid) => { const mm = memberOf(c, uid); return msgsOf(c).filter(m => m.id > mm.read && m.id >= mm.from && m.kind === 'user' && m.from !== uid).length; };
  const contactsOf = me => {
    const ids = new Set();
    db.convs.filter(c => c.kind === 'direct' && memberOf(c, me.id) && db.messages.some(m => m.cid === c.id && m.kind === 'user')).forEach(c => { const o = c.members.find(m => m.id !== me.id); if (o) ids.add(o.id); });
    return [...ids].map(id => people().find(u => u.id === id)).filter(u => u && !blocked(me.id, u.id));
  };

  // ── Примерни доклади (от демо данните) ──
  if (!db.reports) {
    const idOf = nick => demo.find(d => d.nickname === nick).id;
    db.reports = D.sampleReports.map((r, i) => ({
      id: i + 1, reporterId: idOf(r.reporter), reportedId: idOf(r.reported), reporterNick: r.reporter, reportedNick: r.reported, reason: r.reason, details: r.details,
      status: 'open', note: '', created: Date.now() - r.ago * 60000, resolvedAt: null, views: 0, convTitle: '',
      msgs: r.msgs.map(([who, body, ago]) => ({ role: who === 'r' ? 'reporter' : 'reported', from: who === 'r' ? r.reporter : r.reported, body, at: Date.now() - ago * 60000, att: null })),
    }));
    db.rseq = db.reports.length; save();
  }
  const ensureDossier = (uid, nick) => {
    let d = db.dossiers.find(x => x.userId === uid);
    if (!d) { d = { id: ++db.seq, userId: uid, nickname: nick, status: 'active', snapshot: null, closedReason: '', createdAt: Date.now(), closedAt: null }; db.dossiers.push(d); }
    return d;
  };
  // Досие за всеки докладван профил + примерни наказания (веднъж)
  if (!db.dossiersSeeded) {
    db.reports.forEach(r => { r.dossierId = ensureDossier(r.reportedId, r.reportedNick).id; });
    for (const p of D.samplePenalties) {
      const d = db.dossiers.find(x => x.nickname === p.target); if (!d) continue;
      const at = Date.now() - p.ago * 60000;
      const pen = { id: ++db.seq, dossierId: d.id, userId: d.userId, kind: p.kind, reason: p.reason, note: p.note, days: p.days || null, reportId: null, issuedNick: 'Админ', at, endsAt: p.days ? at + p.days * 864e5 : null,
        liftedAt: null, liftedNote: '', ackedAt: p.kind === 'warning' ? Date.now() : null, appealText: '', appealAt: null, appealStatus: 'none', appealNote: '', appealDecidedAt: null };
      if (p.appeal) { pen.appealText = p.appeal.text; pen.appealStatus = 'pending'; pen.appealAt = Date.now() - p.appeal.ago * 60000; }
      db.penalties.push(pen);
    }
    db.dossiersSeeded = true; save();
  }
  const STRIKE_LIMIT = D.strikeLimit;
  const strikesOf = did => db.penalties.filter(p => p.dossierId === did && ['warning', 'suspension'].includes(p.kind) && p.appealStatus !== 'accepted').length;

  // ── Тестов обикновен потребител с готови разговори и група ──
  const TEST_ID = 998;
  route('POST', /^\/api\/demo-user$/, () => {
    let t = db.users.find(u => u.id === TEST_ID);
    if (!t) {
      const T = D.testUser, born = new Date(); born.setFullYear(born.getFullYear() - T.age); born.setMonth(5, 15);
      t = { id: TEST_ID, username: T.username, pw: hash(Math.random() + ''), nickname: T.nickname, birthDate: born.toISOString().slice(0, 10), gender: T.gender, lookingFor: T.lookingFor, placeId: T.placeId,
        bio: T.bio, interests: [...T.interests], photos: [], theme: null, role: 'user', verified: true, created: 1000 };
      db.users.push(t);
      const demoId = nick => (demo.find(d => d.nickname === nick) || {}).id;
      for (const c of D.testChats) {
        const peer = demoId(c.peer); if (!peer) continue;
        const conv = directConv(t.id, peer); let lastPeer = 0;
        c.msgs.forEach(([who, text, ago]) => { const m = addMsg(conv, who === 'p' ? peer : t.id, text, null, Date.now() - ago * 60000); if (who === 'p') lastPeer = m.id; });
        memberOf(conv, t.id).read = c.unread ? lastPeer - 1 : lastId(conv); memberOf(conv, peer).read = lastId(conv);
      }
      for (const g of D.testGroups) {
        const ppl = g.members.map(demoId).filter(Boolean);
        const conv = { id: ++db.seq, kind: 'group', title: g.title, key: null, members: [{ id: t.id, role: 'owner', from: 0, read: 0 }, ...ppl.map(id => ({ id, role: 'member', from: 0, read: 0 }))] };
        db.convs.push(conv); let lastOther = 0;
        g.msgs.forEach(([who, text, ago]) => {
          const at = Date.now() - ago * 60000;
          if (who === 'sys') addSystem(conv, t.id, text, at);
          else { const m = addMsg(conv, who === 'me' ? t.id : demoId(who), text, null, at); if (who !== 'me') lastOther = m.id; }
        });
        memberOf(conv, t.id).read = g.unread ? lastOther - 1 : lastId(conv); conv.members.forEach(m => { if (m.id !== t.id) m.read = lastId(conv); });
      }
    }
    db.session = TEST_ID; save(); return ok({ user: full(t) });
  });

  // ── Разговори (лични и групови) ──
  const CANNED = ['Здравей! Радвам се, че ми писа :smile:', 'Звучи интересно, разкажи ми повече.', 'Хаха, добре :laugh: Какво обичаш да правиш през свободното си време?', 'Може би. Как мина денят ти?', 'Супер, и аз мисля така! :heart:'];
  const rate = {};
  const canSend = me => { const now = Date.now(); rate[me.id] = (rate[me.id] || []).filter(t => now - t < 60000); if (rate[me.id].length >= 20) return false; rate[me.id].push(now); return true; };
  route('GET', /^\/api\/chats\/unread$/, authed(({ me }) => ok({
    unread: db.convs.filter(c => memberOf(c, me.id)).reduce((n, c) => n + unreadOf(c, me.id), 0),
    openReports: me.role === 'admin' ? db.reports.filter(r => r.status === 'open').length : 0,
    openAppeals: me.role === 'admin' ? db.penalties.filter(p => p.appealStatus === 'pending').length : 0 })));
  route('GET', /^\/api\/chats\/contacts$/, authed(({ me }) => ok({ contacts: contactsOf(me).map(u => pub(u, me.id)) })));
  route('GET', /^\/api\/chats$/, authed(({ me }) => {
    const chats = [];
    for (const c of db.convs.filter(x => memberOf(x, me.id))) {
      const mm = memberOf(c, me.id), ms = msgsOf(c).filter(m => m.id >= mm.from); if (!ms.length) continue;
      const last = ms[ms.length - 1];
      const lp = { body: last.body || (attView(last.att) || {}).kind === 'image' ? (last.body || ((attView(last.att) || {}).variant ? '🏷️ Стикер' : '📷 Снимка')) : (last.body || '📎 Файл'), mine: last.from === me.id, senderNick: last.from ? nickOf(last.from) : '', system: last.kind === 'system', at: iso(last.at) };
      if (c.kind === 'direct') { const pr = peerUser(c, me); if (!pr) continue; chats.push({ id: c.id, kind: 'direct', title: pr.nickname, peer: pub(pr, me.id), unread: unreadOf(c, me.id), last: lp, _t: last.id }); }
      else chats.push({ id: c.id, kind: 'group', title: c.title, members: c.members.length, preview: c.members.slice(0, 3).map(m => ({ id: m.id, nickname: nickOf(m.id) })), unread: unreadOf(c, me.id), last: lp, _t: last.id });
    }
    chats.sort((a, b) => b._t - a._t); chats.forEach(c => delete c._t);
    return ok({ chats });
  }));
  route('POST', /^\/api\/chats\/direct$/, authed(({ body: b, me }) => {
    if (me.role === 'admin') return bad('Администраторът не води разговори.', 403);
    const id = Number(b.userId);
    if (id === me.id || !people().some(u => u.id === id) || blocked(me.id, id)) return bad('Не можете да пишете на този профил.', 403);
    const c = directConv(me.id, id); save(); return ok({ id: c.id });
  }));
  const cleanTitle = t => String(t || '').trim().replace(/\s+/g, ' ');
  const pickMembers = (me, raw, existing = []) => {
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== me.id))];
    const allowed = new Set(contactsOf(me).map(u => u.id));
    return { ids: ids.filter(i => !existing.includes(i)), invalid: ids.some(i => !allowed.has(i)) };
  };
  route('POST', /^\/api\/chats\/groups$/, active(({ body: b, me }) => {
    if (me.role === 'admin') return bad('Администраторът не води разговори.', 403);
    const title = cleanTitle(b.title); if (title.length < 2 || title.length > 40) return bad('Името на групата трябва да е 2–40 символа.');
    const { ids, invalid } = pickMembers(me, b.memberIds);
    if (invalid) return bad('В група може да добавяш само хора, с които си писал.');
    if (!ids.length) return bad('Избери поне един човек за групата.');
    if (ids.length + 1 > 12) return bad('В група има най-много 12 души.');
    const c = { id: ++db.seq, kind: 'group', title, key: null, members: [{ id: me.id, role: 'owner', from: 0, read: 0 }, ...ids.map(id => ({ id, role: 'member', from: 0, read: 0 }))] };
    db.convs.push(c); addSystem(c, me.id, `${me.nickname} създаде групата „${title}“`); save(); return ok({ id: c.id }, 201);
  }));
  const threadOf = (c, me) => {
    const mm = memberOf(c, me.id), ms = msgsOf(c).filter(m => m.id >= mm.from).slice(-200);
    const conversation = { id: c.id, kind: c.kind, title: c.title, isOwner: mm.role === 'owner', createdAt: iso(Date.now()) };
    if (c.kind === 'direct') { const pr = peerUser(c, me); conversation.peer = pr ? pub(pr, me.id) : null; conversation.title = pr ? pr.nickname : 'Недостъпен профил'; }
    else conversation.members = c.members.map(m => userById(m.id)).filter(Boolean).map(u => ({ ...pub(u, me.id), role: memberOf(c, u.id).role }));
    return { conversation, messages: ms.map(m => msgView(m, me)) };
  };
  route('GET', /^\/api\/chats\/(\d+)$/, authed(({ m, me }) => {
    const c = convById(Number(m[1])); if (!memberOf(c, me.id)) return bad('Разговорът не е намерен.', 404);
    if (c.kind === 'direct' && !peerUser(c, me)) return bad('Разговорът не е намерен.', 404);
    const t = threadOf(c, me); memberOf(c, me.id).read = lastId(c); save(); return ok(t);
  }));
  route('POST', /^\/api\/chats\/(\d+)\/messages$/, active(({ m, body: b, me }) => {
    const c = convById(Number(m[1])); if (!memberOf(c, me.id)) return bad('Разговорът не е намерен.', 404);
    if (c.kind === 'direct' && !peerUser(c, me)) return bad('Не можете да пишете на този профил.', 403);
    const text = String(b.body || '').trim(); if (text.length > 1000) return bad('Съобщението може да е до 1000 символа.');
    let att = null;
    if (b.attachmentId) { att = files[b.attachmentId]; if (!att || att.uploader !== me.id || att.mid) return bad('Файлът не е наличен. Качи го отново.'); }
    if (b.stickerId && !att) {
      const st = (stk[me.id] || []).find(x => x.id === Number(b.stickerId)); if (!st) return bad('Стикерът не е намерен.', 404);
      if (!canSend(me)) return bad('Изпращате твърде бързо. Изчакайте малко.', 429);
      att = { id: ++db.seq, name: st.kind === 'icon' ? 'икона' : 'стикер', size: st.url.length, kind: 'image', variant: st.kind, url: st.url, uploader: me.id, mid: null }; files[att.id] = att;
    }
    if (!text && !att) return bad('Съобщението е празно.');
    if (!canSend(me)) return bad('Изпращате твърде бързо. Изчакайте малко.', 429);
    const msg = addMsg(c, me.id, text, att && att.id);
    if (att) saveFiles();
    // Демо профилите отговарят (един член на групата, след малко)
    const bots = c.members.filter(x => x.id !== me.id && demo.some(d => d.id === x.id));
    if (bots.length) { const bot = bots[db.messages.length % bots.length]; addMsg(c, bot.id, CANNED[db.messages.length % CANNED.length], null, Date.now() + 2500); }
    save(); return ok({ message: msgView(msg, me) }, 201);
  }));
  // ── Лични стикери и икони (в демото – в браузъра) ──
  const SKEY = 'spark.preview.stickers.v1'; let stk = {};
  try { stk = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { stk = {}; }
  const saveStk = () => { try { localStorage.setItem(SKEY, JSON.stringify(stk)); } catch { /* квотата е пълна */ } };
  const MAXSTK = { sticker: 40, icon: 60 };
  route('GET', /^\/api\/stickers$/, authed(({ me }) => { const l = stk[me.id] || []; return ok({ stickers: l.filter(x => x.kind === 'sticker').map(x => ({ id: x.id, kind: x.kind, url: x.url })).reverse(), icons: l.filter(x => x.kind === 'icon').map(x => ({ id: x.id, kind: x.kind, url: x.url })).reverse(), max: MAXSTK }); }));
  route('POST', /^\/api\/stickers$/, active(async ({ blob, headers, me }) => {
    const kind = headers['X-Kind']; if (!MAXSTK[kind]) return bad('Невалиден вид (стикер или икона).');
    if (!blob || !blob.size) return bad('Празен файл.');
    if (blob.size > 400 * 1024) return bad('Изображението е твърде голямо (макс. 400 KB след смаляване).', 413);
    const url = await readBlob(blob); if (!/^data:image\/(jpeg|png|webp|gif);/.test(url)) return bad('Позволени са само снимки: JPG, PNG, WebP или GIF.');
    const l = stk[me.id] = stk[me.id] || [];
    if (l.filter(x => x.kind === kind).length >= MAXSTK[kind]) return bad(`Достигнат е лимитът от ${MAXSTK[kind]} ${kind === 'icon' ? 'икони' : 'стикера'}. Изтрий някой.`, 409);
    const st = { id: ++db.seq, kind, url }; l.push(st); saveStk(); save();
    return ok({ sticker: { id: st.id, kind, url } }, 201);
  }));
  route('DELETE', /^\/api\/stickers\/(\d+)$/, authed(({ m, me }) => { const l = stk[me.id] || [], i = l.findIndex(x => x.id === Number(m[1])); if (i < 0) return bad('Не е намерен.', 404); l.splice(i, 1); saveStk(); return ok({ ok: true }); }));
  const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'vbs', 'js', 'mjs', 'jar', 'sh', 'app', 'apk', 'dll', 'lnk', 'html', 'htm', 'xhtml', 'svg', 'hta', 'reg']);
  const readBlob = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  route('POST', /^\/api\/chats\/(\d+)\/attachments$/, active(async ({ m, blob, headers, me }) => {
    const c = convById(Number(m[1])); if (!memberOf(c, me.id)) return bad('Разговорът не е намерен.', 404);
    if (c.kind === 'direct' && !peerUser(c, me)) return bad('Не можете да пишете на този профил.', 403);
    if (!blob || !blob.size) return bad('Празен файл.');
    if (blob.size > 10 * 1024 * 1024) return bad('Файлът е твърде голям (макс. 10 MB).', 413);
    let name = ''; try { name = decodeURIComponent(headers['X-Filename'] || ''); } catch { name = headers['X-Filename'] || ''; }
    name = name.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(-120) || 'файл';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (name.includes('.') && BLOCKED_EXT.has(ext)) return bad(`Файлове от тип .${ext} не са позволени.`);
    if (!canSend(me)) return bad('Изпращате твърде бързо. Изчакайте малко.', 429);
    const url = await readBlob(blob);
    const kind = /^data:image\/(jpeg|png|webp|gif);/.test(url) ? 'image' : 'file';
    const f = { id: ++db.seq, name, size: blob.size, kind, url, uploader: me.id, mid: null }; files[f.id] = f; saveFiles();
    return ok({ attachment: { id: f.id, name, size: f.size, kind, url } }, 201);
  }));
  const ownerOnly = (m, me) => { const c = convById(Number(m[1])); if (!c || c.kind !== 'group' || !memberOf(c, me.id)) return [null, bad('Групата не е намерена.', 404)]; if (memberOf(c, me.id).role !== 'owner') return [null, bad('Само създателят на групата може да прави това.', 403)]; return [c, null]; };
  route('PUT', /^\/api\/chats\/(\d+)$/, active(({ m, body: b, me }) => {
    const [c, err] = ownerOnly(m, me); if (err) return err;
    const title = cleanTitle(b.title); if (title.length < 2 || title.length > 40) return bad('Името на групата трябва да е 2–40 символа.');
    c.title = title; addSystem(c, me.id, `Групата беше преименувана на „${title}“`); save(); return ok({ ok: true });
  }));
  route('POST', /^\/api\/chats\/(\d+)\/members$/, active(({ m, body: b, me }) => {
    const [c, err] = ownerOnly(m, me); if (err) return err;
    const { ids, invalid } = pickMembers(me, b.userIds, c.members.map(x => x.id));
    if (invalid) return bad('Може да добавяш само хора, с които си писал.');
    if (!ids.length) return bad('Няма кого да добавиш.');
    if (c.members.length + ids.length > 12) return bad('В група има най-много 12 души.');
    for (const u of ids) { const sid = addSystem(c, me.id, `${me.nickname} добави ${nickOf(u)}`); c.members.push({ id: u, role: 'member', from: sid, read: sid }); }
    save(); return ok({ ok: true }, 201);
  }));
  route('DELETE', /^\/api\/chats\/(\d+)\/members\/(\d+)$/, authed(({ m, me }) => {
    const c = convById(Number(m[1])), uid = Number(m[2]);
    if (!c || c.kind !== 'group' || !memberOf(c, me.id) || !memberOf(c, uid)) return bad('Групата не е намерена.', 404);
    if (uid !== me.id && memberOf(c, me.id).role !== 'owner') return bad('Само създателят на групата може да премахва хора.', 403);
    const wasOwner = memberOf(c, uid).role === 'owner';
    c.members = c.members.filter(x => x.id !== uid);
    if (!c.members.length) { db.convs = db.convs.filter(x => x !== c); db.messages = db.messages.filter(x => x.cid !== c.id); }
    else { if (wasOwner) c.members[0].role = 'owner'; addSystem(c, me.id, uid === me.id ? `${nickOf(uid)} напусна групата` : `${nickOf(uid)} беше премахнат от групата`); }
    save(); return ok({ ok: true });
  }));

  // ── Обаждания (демо: профилите „вдигат“ и няма реален събеседник) ──
  const lbl = c => (c.kind === 'video' ? 'видео' : 'гласово');
  const openCall = uid => db.calls.find(c => ['ringing', 'active'].includes(c.status) && (c.caller === uid || c.callee === uid));
  const callLog = (c, text) => { const conv = convById(c.cid); if (conv) addSystem(conv, c.caller, text); };
  const callEnd = (c, status) => {
    c.status = status; c.ended = Date.now();
    if (status === 'ended' && c.answered) { const sec = Math.round((c.ended - c.answered) / 1000); callLog(c, `📞 ${lbl(c)[0].toUpperCase() + lbl(c).slice(1)} обаждане · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`); }
    else if (status === 'canceled' || status === 'missed') callLog(c, `📞 Пропуснато ${lbl(c)} обаждане`);
    else if (status === 'declined') callLog(c, `📞 Отказано ${lbl(c)} обаждане`);
  };
  const callTick = () => {
    for (const c of db.calls) {
      if (c.status !== 'ringing') continue;
      const demoCallee = demo.some(d => d.id === c.callee), age = Date.now() - c.created;
      if (demoCallee && age > 2500) { c.status = 'active'; c.answered = Date.now(); }          // демо профилът вдига след малко
      else if (age > 45000) callEnd(c, 'missed');
    }
  };
  const callView = (c, me) => { const otherId = c.caller === me.id ? c.callee : c.caller; const o = all().find(u => u.id === otherId);
    return { id: c.id, kind: c.kind, status: c.status, conversationId: c.cid, incoming: c.callee === me.id, peer: o ? pub(o, me.id) : null, answeredAt: c.answered ? iso(c.answered) : null, createdAt: iso(c.created), demo: true }; };
  route('POST', /^\/api\/calls$/, active(({ body: b, me }) => {
    if (!['audio', 'video'].includes(b.kind)) return bad('Невалиден вид обаждане.');
    const conv = convById(Number(b.conversationId)); if (!conv || conv.kind !== 'direct' || !memberOf(conv, me.id)) return bad('Обаждания има само в лични разговори.', 404);
    const peer = peerUser(conv, me); if (!peer) return bad('Не можете да се обадите на този профил.', 403);
    callTick(); if (openCall(me.id)) return errc('Вече си в обаждане.', 409, 'busy_self');
    if (openCall(peer.id)) return errc(`${peer.nickname} е в друго обаждане. Опитай по-късно.`, 409, 'busy');
    const c = { id: ++db.seq, cid: conv.id, caller: me.id, callee: peer.id, kind: b.kind, status: 'ringing', created: Date.now(), answered: null, ended: null }; db.calls.push(c); save();
    return ok({ call: callView(c, me) }, 201);
  }));
  route('GET', /^\/api\/calls\/poll$/, authed(({ q, me }) => {
    // Демо: след ~20 сек. „Теди“ се обажда на тестовия потребител (веднъж), за да се види входящо обаждане.
    if (me.id === 998 && !db.demoRang) {
      db.firstPoll = db.firstPoll || Date.now();
      const teddy = demo.find(d => d.nickname === 'Теди'), conv = teddy && db.convs.find(c => c.kind === 'direct' && memberOf(c, me.id) && memberOf(c, teddy.id));
      if (conv && Date.now() - db.firstPoll > 20000 && !openCall(me.id)) { db.calls.push({ id: ++db.seq, cid: conv.id, caller: teddy.id, callee: me.id, kind: 'video', status: 'ringing', created: Date.now(), answered: null, ended: null }); db.demoRang = true; }
      save();
    }
    callTick();
    const id = Number(q.get('callId')) || 0;
    const c = id ? db.calls.find(x => x.id === id && (x.caller === me.id || x.callee === me.id)) : openCall(me.id);
    return ok({ call: c ? callView(c, me) : null, signals: [] });
  }));
  const myCall = (m, me) => db.calls.find(x => x.id === Number(m[1]) && (x.caller === me.id || x.callee === me.id));
  route('POST', /^\/api\/calls\/(\d+)\/signal$/, authed(({ m, me }) => (myCall(m, me) ? ok({ id: 0 }, 201) : bad('Обаждането не е намерено.', 404))));
  route('POST', /^\/api\/calls\/(\d+)\/answer$/, authed(({ m, me }) => { const c = myCall(m, me); if (!c) return bad('Обаждането не е намерено.', 404);
    if (c.callee !== me.id || c.status !== 'ringing') return bad('Не можеш да вдигнеш това обаждане.', 403); c.status = 'active'; c.answered = Date.now(); save(); return ok({ call: callView(c, me) }); }));
  route('POST', /^\/api\/calls\/(\d+)\/decline$/, authed(({ m, me }) => { const c = myCall(m, me); if (!c) return bad('Обаждането не е намерено.', 404);
    if (c.callee !== me.id || c.status !== 'ringing') return bad('Не можеш да откажеш това обаждане.', 403); callEnd(c, 'declined'); save(); return ok({ ok: true }); }));
  route('POST', /^\/api\/calls\/(\d+)\/end$/, authed(({ m, me }) => { const c = myCall(m, me); if (!c) return bad('Обаждането не е намерено.', 404);
    if (['ringing', 'active'].includes(c.status)) callEnd(c, c.status === 'ringing' ? (c.caller === me.id ? 'canceled' : 'declined') : 'ended'); save(); return ok({ ok: true }); }));

  // ── Доклади ──
  route('POST', /^\/api\/profiles\/(\d+)\/report$/, active(({ m, body: b, me }) => {
    const id = Number(m[1]);
    if (id === me.id) return bad('Не можете да докладвате себе си.');
    const target = people().find(u => u.id === id); if (!target) return bad('Профилът не е намерен.', 404);
    if (!Object.hasOwn(D.reportReasons, b.reason)) return bad('Изберете причина за доклада.');
    const details = String(b.details || '').trim(); if (details.length > 500) return bad('Описанието може да е до 500 символа.');
    if (db.reports.some(r => r.reporterId === me.id && r.reportedId === id && r.status === 'open')) return bad('Вече сте докладвали този профил. Администраторите разглеждат доклада.', 409);
    let c = null;
    if (b.conversationId) { c = convById(Number(b.conversationId)); if (!memberOf(c, me.id) || !memberOf(c, id)) return bad('Разговорът не е намерен.', 404); }
    else c = db.convs.find(x => x.kind === 'direct' && x.key === dkey(me.id, id)) || null;
    const msgs = c ? msgsOf(c).filter(x => x.id >= memberOf(c, me.id).from).slice(-200).map(x => ({
      role: x.kind === 'system' ? 'system' : x.from === me.id ? 'reporter' : x.from === id ? 'reported' : 'other', from: x.kind === 'system' ? '' : nickOf(x.from), body: x.body, at: x.at, att: x.att })) : [];
    db.reports.push({ id: ++db.rseq, reporterId: me.id, reportedId: id, reporterNick: me.nickname, reportedNick: target.nickname, reason: b.reason, details, status: 'open', note: '', created: Date.now(), resolvedAt: null, views: 0,
      convTitle: c && c.kind === 'group' ? c.title : '', msgs, dossierId: ensureDossier(id, target.nickname).id });
    if (b.block && !blocked(me.id, id)) db.blocks.push({ from: me.id, to: id });
    save(); return ok({ ok: true, blocked: !!b.block }, 201);
  }));
  const LABEL = k => D.reportReasons[k] || k;
  const rrow = r => ({ id: r.id, dossierId: r.dossierId, reporterNick: r.reporterNick, reportedNick: r.reportedNick, reason: r.reason, reasonLabel: LABEL(r.reason), status: r.status, createdAt: iso(r.created), resolvedAt: r.resolvedAt ? iso(r.resolvedAt) : null });
  route('GET', /^\/api\/admin\/reports$/, adminOnly(({ q }) => {
    const st = ['open', 'upheld', 'dismissed'].includes(q.get('status')) ? q.get('status') : null;
    const counts = { open: 0, upheld: 0, dismissed: 0 }; db.reports.forEach(r => counts[r.status]++);
    const list = db.reports.filter(r => !st || r.status === st).sort((a, b) => (b.status === 'open') - (a.status === 'open') || b.id - a.id);
    return ok({ counts, reports: list.map(r => ({ ...rrow(r), messages: r.msgs.length })) });
  }));
  route('GET', /^\/api\/admin\/reports\/(\d+)$/, adminOnly(({ m }) => {
    const r = db.reports.find(x => x.id === Number(m[1])); if (!r) return bad('Докладът не е намерен.', 404);
    r.views++; save();
    const u = all().find(x => x.id === r.reportedId);
    const reported = u ? { id: u.id, nickname: u.nickname, age: ageOf(u), ...placeFields(u), gender: u.gender, bio: u.bio, isDemo: !!u.isDemo, createdAt: iso(Date.now() - (u.created || 0) * 1000), photos: u.photos.length,
      otherReports: db.reports.filter(x => x.reportedId === u.id && x.id !== r.id).length } : null;
    return ok({ report: { ...rrow(r), details: r.details, adminNote: r.note, reporterStillExists: !!all().find(x => x.id === r.reporterId), reportedStillExists: !!u }, reported,
      messages: r.msgs.map((x, i) => ({ id: i + 1, fromReporter: x.role === 'reporter', role: x.role, from: x.from, body: x.body, at: iso(x.at), attachment: attView(x.att) })),
      conversation: r.convTitle ? { title: r.convTitle, group: true } : null, views: r.views });
  }));
  route('PUT', /^\/api\/admin\/reports\/(\d+)$/, adminOnly(({ m, body: b }) => {
    const r = db.reports.find(x => x.id === Number(m[1])); if (!r) return bad('Докладът не е намерен.', 404);
    if (!['open', 'upheld', 'dismissed'].includes(b.status)) return bad('Невалиден статус.');
    const note = String(b.note || '').trim(); if (note.length > 500) return bad('Бележката може да е до 500 символа.');
    r.status = b.status; r.note = note; r.resolvedAt = b.status === 'open' ? null : Date.now(); save(); return ok({ ok: true });
  }));

  // ── Досиета, наказания, обжалвания (същата логика като на сървъра) ──
  const adminPen = p => ({ ...penView(p), note: p.note, issuedNick: p.issuedNick, liftedAt: p.liftedAt ? iso(p.liftedAt) : null, liftedNote: p.liftedNote,
    appealAt: p.appealAt ? iso(p.appealAt) : null, appealDecidedAt: p.appealDecidedAt ? iso(p.appealDecidedAt) : null, reportId: p.reportId, active: p.kind === 'suspension' && !p.liftedAt && p.endsAt > Date.now() });
  const clean = (v, max) => String(v || '').trim().slice(0, max);
  const eraseUser = id => {
    db.users = db.users.filter(u => u.id !== id); db.likes = db.likes.filter(l => l.from !== id && l.to !== id); db.blocks = db.blocks.filter(b => b.from !== id && b.to !== id); delete db.verif[id];
    for (const c of db.convs.slice()) {
      if (!memberOf(c, id)) continue;
      if (c.kind === 'direct') { db.convs = db.convs.filter(x => x !== c); db.messages = db.messages.filter(m => m.cid !== c.id); }
      else { c.members = c.members.filter(m => m.id !== id); if (!c.members.length) { db.convs = db.convs.filter(x => x !== c); db.messages = db.messages.filter(m => m.cid !== c.id); } else if (!c.members.some(m => m.role === 'owner')) c.members[0].role = 'owner'; }
    }
    if (db.session === id) db.session = null;
  };
  route('GET', /^\/api\/admin\/dossiers$/, adminOnly(({ q }) => {
    const status = q.get('status') || 'all', term = (q.get('q') || '').trim().toLowerCase();
    let list = db.dossiers.slice().map(d => {
      const reps = db.reports.filter(r => r.dossierId === d.id), sp = d.userId ? activeSusp(d.userId) : null;
      return { id: d.id, nickname: d.nickname, status: d.status, reports: reps.length, openReports: reps.filter(r => r.status === 'open').length, strikes: strikesOf(d.id), strikeLimit: STRIKE_LIMIT,
        suspendedUntil: sp ? iso(sp.endsAt) : null, appeals: db.penalties.filter(p => p.dossierId === d.id && p.appealStatus === 'pending').length,
        lastReportAt: reps.length ? iso(Math.max(...reps.map(r => r.created))) : null, createdAt: iso(d.createdAt), _t: reps.length ? Math.max(...reps.map(r => r.created)) : 0 };
    }).sort((a, b) => (b.openReports > 0) - (a.openReports > 0) || b._t - a._t);
    list.forEach(d => delete d._t);
    if (term) list = list.filter(d => d.nickname.toLowerCase().includes(term));
    if (status === 'suspended') list = list.filter(d => d.suspendedUntil); else if (status === 'deregistered') list = list.filter(d => d.status === 'deregistered');
    else if (status === 'appeals') list = list.filter(d => d.appeals > 0); else if (status === 'active') list = list.filter(d => d.status === 'active');
    return ok({ dossiers: list });
  }));
  route('GET', /^\/api\/admin\/dossiers\/(\d+)$/, adminOnly(({ m }) => {
    const d = db.dossiers.find(x => x.id === Number(m[1])); if (!d) return bad('Досието не е намерено.', 404);
    const u = d.userId ? all().find(x => x.id === d.userId) : null;
    const subject = u ? { alive: true, id: u.id, nickname: u.nickname, age: ageOf(u), ...placeFields(u), gender: u.gender, bio: u.bio, goal: u.goal || '', isDemo: !!u.isDemo, paused: !!u.paused, joinedAt: iso(Date.now() - (u.created || 0) * 1000),
      lastSeen: iso(Date.now()), emailMasked: maskEmail(u.email), emailVerified: isVerified(u), photos: u.photos.length } : { alive: false, nickname: d.nickname, ...(d.snapshot || {}) };
    const strikes = strikesOf(d.id);
    return ok({
      dossier: { id: d.id, nickname: d.nickname, status: d.status, createdAt: iso(d.createdAt), closedAt: d.closedAt ? iso(d.closedAt) : null, closedReason: d.closedReason }, subject,
      reports: db.reports.filter(r => r.dossierId === d.id).sort((a, b) => b.id - a.id).map(r => ({ ...rrow(r), details: r.details, adminNote: r.note, convTitle: r.convTitle })),
      penalties: db.penalties.filter(p => p.dossierId === d.id).sort((a, b) => b.id - a.id).map(adminPen),
      notes: db.notes.filter(n => n.dossierId === d.id).sort((a, b) => b.id - a.id).map(n => ({ id: n.id, note: n.note, admin: n.admin, at: iso(n.at) })),
      strikes, strikeLimit: STRIKE_LIMIT, recommendDeregister: strikes >= STRIKE_LIMIT && d.status === 'active', suspendDays: D.suspendDays, emailBanned: d.status === 'deregistered' });
  }));
  route('POST', /^\/api\/admin\/dossiers\/(\d+)\/notes$/, adminOnly(({ m, body: b }) => {
    const d = db.dossiers.find(x => x.id === Number(m[1])); if (!d) return bad('Досието не е намерено.', 404);
    const note = clean(b.note, 1000); if (note.length < 2) return bad('Напиши бележка.');
    db.notes.push({ id: ++db.seq, dossierId: d.id, note, admin: 'Админ', at: Date.now() }); save(); return ok({ ok: true }, 201);
  }));
  route('POST', /^\/api\/admin\/dossiers\/(\d+)\/penalties$/, adminOnly(({ m, body: b }) => {
    const d = db.dossiers.find(x => x.id === Number(m[1])); if (!d) return bad('Досието не е намерено.', 404);
    if (!d.userId || d.status !== 'active') return bad('Профилът вече не е активен.', 409);
    if (!['warning', 'suspension'].includes(b.kind)) return bad('Избери вид наказание.');
    const days = b.kind === 'suspension' ? Number(b.days) : null;
    if (b.kind === 'suspension' && !D.suspendDays.includes(days)) return bad(`Суспензията е ${D.suspendDays.join(', ')} дни.`);
    const reason = clean(b.reason, 300); if (reason.length < 5) return bad('Напиши причина (поне 5 символа) – показва се на потребителя.');
    const now = Date.now();
    const pen = { id: ++db.seq, dossierId: d.id, userId: d.userId, kind: b.kind, reason, note: clean(b.note, 500), days, reportId: null, issuedNick: 'Админ', at: now, endsAt: days ? now + days * 864e5 : null,
      liftedAt: null, liftedNote: '', ackedAt: null, appealText: '', appealAt: null, appealStatus: 'none', appealNote: '', appealDecidedAt: null };
    db.penalties.push(pen); save();
    const strikes = strikesOf(d.id);
    return ok({ penalty: adminPen(pen), strikes, strikeLimit: STRIKE_LIMIT, recommendDeregister: strikes >= STRIKE_LIMIT }, 201);
  }));
  route('POST', /^\/api\/admin\/penalties\/(\d+)\/lift$/, adminOnly(({ m, body: b }) => {
    const p = db.penalties.find(x => x.id === Number(m[1])); if (!p || p.kind === 'deregistration') return bad('Наказанието не е намерено.', 404);
    if (p.liftedAt) return bad('Наказанието вече е вдигнато.', 409);
    p.liftedAt = Date.now(); p.liftedNote = clean(b.note, 300); save(); return ok({ ok: true });
  }));
  route('POST', /^\/api\/admin\/penalties\/(\d+)\/appeal$/, adminOnly(({ m, body: b }) => {
    const p = db.penalties.find(x => x.id === Number(m[1])); if (!p || p.appealStatus !== 'pending') return bad('Няма чакащо обжалване.', 404);
    if (!['accepted', 'rejected'].includes(b.decision)) return bad('Невалидно решение.');
    p.appealStatus = b.decision; p.appealNote = clean(b.note, 300); p.appealDecidedAt = Date.now();
    if (b.decision === 'accepted' && !p.liftedAt) { p.liftedAt = Date.now(); p.liftedNote = 'Уважено обжалване'; }
    save(); return ok({ ok: true });
  }));
  route('POST', /^\/api\/admin\/dossiers\/(\d+)\/deregister$/, adminOnly(({ m, body: b }) => {
    const d = db.dossiers.find(x => x.id === Number(m[1])); if (!d) return bad('Досието не е намерено.', 404);
    if (!d.userId || d.status !== 'active') return bad('Профилът вече не е активен.', 409);
    const reason = clean(b.reason, 300); if (reason.length < 5) return bad('Напиши причина (поне 5 символа).');
    const u = all().find(x => x.id === d.userId); if (!u || u.role === 'admin') return bad('Администраторски акаунт не може да се дерегистрира.', 403);
    d.snapshot = { age: ageOf(u), ...placeFields(u), gender: u.gender, joinedAt: iso(Date.now() - (u.created || 0) * 1000), lastSeen: iso(Date.now()), isDemo: !!u.isDemo, emailMasked: maskEmail(u.email) };
    if (u.emailKey && !db.banned.includes(u.emailKey)) db.banned.push(u.emailKey);
    if (u.username) db.dereg.push(u.username.toLowerCase());
    db.penalties.push({ id: ++db.seq, dossierId: d.id, userId: null, kind: 'deregistration', reason, note: clean(b.note, 500), days: null, reportId: null, issuedNick: 'Админ', at: Date.now(), endsAt: null, liftedAt: null, liftedNote: '', ackedAt: null, appealText: '', appealAt: null, appealStatus: 'none', appealNote: '', appealDecidedAt: null });
    d.status = 'deregistered'; d.closedReason = reason; d.closedAt = Date.now(); d.userId = null;
    if (u.isDemo) { demo.splice(demo.indexOf(u), 1); db.gone.push(u.id); db.likes = db.likes.filter(l => l.from !== u.id && l.to !== u.id); } else eraseUser(u.id);
    save(); return ok({ ok: true });
  }));
  // За самия потребител: прочитане и обжалване
  route('POST', /^\/api\/me\/penalties\/(\d+)\/ack$/, authed(({ m, me }) => {
    const p = db.penalties.find(x => x.id === Number(m[1]) && x.userId === me.id && x.kind === 'warning'); if (!p) return bad('Не е намерено.', 404);
    p.ackedAt = Date.now(); save(); return ok({ user: full(me) });
  }));
  route('POST', /^\/api\/me\/penalties\/(\d+)\/appeal$/, authed(({ m, body: b, me }) => {
    const p = db.penalties.find(x => x.id === Number(m[1]) && x.userId === me.id && ['warning', 'suspension'].includes(x.kind)); if (!p) return bad('Не е намерено.', 404);
    if (p.appealStatus !== 'none') return bad('Вече си обжалвал това наказание.', 409);
    const text = clean(b.text, 500); if (text.length < 10) return bad('Опиши защо смяташ, че е грешка (поне 10 символа).');
    p.appealText = text; p.appealAt = Date.now(); p.appealStatus = 'pending'; save(); return ok({ user: full(me) });
  }));

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opt = {}) => {
    const u = new URL(String(url), 'http://x');
    if (!u.pathname.startsWith('/api/')) return realFetch(url, opt);
    const method = (opt.method || 'GET').toUpperCase();
    const isBlob = typeof Blob !== 'undefined' && opt.body instanceof Blob;
    let body = {}; try { body = opt.body && !isBlob ? JSON.parse(opt.body) : {}; } catch { /* ignore */ }
    for (const [m, re, fn] of routes) {
      const match = re.exec(u.pathname);
      if (m === method && match) { await new Promise(r => setTimeout(r, 60)); return fn({ body, blob: isBlob ? opt.body : null, headers: opt.headers || {}, q: u.searchParams, m: match }); }
    }
    return bad('Няма такъв маршрут.', 404);
  };

  // Бележка в долния ред
  document.addEventListener('DOMContentLoaded', () => {
    const f = document.querySelector('.foot');
    if (f) { const s = document.createElement('span'); s.className = 'dim'; s.textContent = 'Преглед: данните ти остават само в този браузър.'; f.append(s); }
  });
})();
