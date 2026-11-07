// Статичен преглед: имитира /api/* в браузъра (без сървър). Данните са само в този браузър.
(() => {
  'use strict';
  const D = window.__SPARK_PREVIEW__; // { places, interests, people, ... }
  const KEY = 'spark.preview.v2', FKEY = 'spark.preview.files.v2';
  window.confirm = () => true; // в прегледа диалозите са недостъпни
  const MIN_AGE = 18, MAX_PHOTOS = 6;
  // ── Области и населени места (ЕКАТТЕ на НСИ) ──
  const REGIONS = D.places.regions;
  const REGION_NAME = new Map(REGIONS.map(r => [r.code, r.name]));
  const PLACES = D.places.places.map(([id, kind, name, region, ob]) => ({ id, kind, name, region, obshtina: D.places.obshtini[ob] || '', label: kind === 'гр.' ? name : `${kind} ${name}`, key: name.toLowerCase() }));
  const BY_ID = new Map(PLACES.map(p => [p.id, p]));
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
  let db = { users: [], likes: [], seq: 1000, session: null, convs: [], messages: [], blocks: [], reports: null, rseq: 0 };
  let files = {}; // id -> { id, name, size, kind, url (data URL) } – пазят се отделно, защото са големи
  try { const raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw); } catch { /* без storage */ }
  db.messages = db.messages || []; db.blocks = db.blocks || []; db.convs = db.convs || [];
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

  function pub(u, viewer) {
    const likes = db.likes.filter(l => l.to === u.id).length + (u.likesBase || 0);
    return {
      id: u.id, nickname: u.nickname, age: u.isDemo ? u.age : ageFrom(u.birthDate), gender: u.gender, lookingFor: u.lookingFor, ...placeFields(u),
      bio: u.bio, interests: [...u.interests].sort(), photos: u.photos.map(p => ({ id: p.id, url: p.url })), isDemo: !!u.isDemo,
      online: u.isDemo ? u.lastMin < 5 : true, liked: db.likes.some(l => l.from === viewer && l.to === u.id),
      likedMe: db.likes.some(l => l.from === u.id && l.to === viewer), likes, isMe: u.id === viewer,
    };
  }
  const full = u => ({ ...pub(u, u.id), username: u.username, birthDate: u.birthDate, theme: u.theme || null, role: u.role || 'user' });

  const routes = [];
  const route = (m, re, fn) => routes.push([m, re, fn]);

  route('GET', /^\/api\/meta$/, () => ok({
    regions: REGIONS.map(r => ({ code: r.code, name: r.name, count: people().filter(u => u.placeId && BY_ID.get(u.placeId).region === r.code).length })),
    interests: D.interests, minAge: MIN_AGE, maxPhotos: MAX_PHOTOS, total: people().length, demoAdmin: true, reportReasons: D.reportReasons,
  }));
  route('GET', /^\/api\/places$/, ({ q }) => {
    const region = q.get('region') || ''; if (!REGION_NAME.has(region)) return bad('Изберете област.');
    const limit = Math.min(60, Math.max(1, parseInt(q.get('limit'), 10) || 30));
    const counts = new Map(); people().forEach(u => { if (u.placeId && BY_ID.get(u.placeId).region === region) counts.set(u.placeId, (counts.get(u.placeId) || 0) + 1); });
    const list = q.get('populated') === '1'
      ? [...counts.keys()].map(id => BY_ID.get(id)).sort((a, b) => counts.get(b.id) - counts.get(a.id) || a.name.localeCompare(b.name, 'bg'))
      : searchPlaces(region, q.get('q'), limit);
    return ok({ places: list.slice(0, limit).map(p => ({ ...describe(p), count: counts.get(p.id) || 0 })), total: list.length });
  });
  route('GET', /^\/api\/me$/, () => ok({ user: meUser() ? full(meUser()) : null }));

  route('POST', /^\/api\/register$/, ({ body: b }) => {
    const username = String(b.username || '').trim(), nickname = String(b.nickname || '').trim().replace(/\s+/g, ' '), password = String(b.password || '');
    if (!USER.test(username)) return bad('Потребителското име трябва да е 3–30 символа: латински букви, цифри, . _ -');
    if (!NICK.test(nickname)) return bad('Никнеймът трябва да е 3–20 символа (букви, цифри, интервал, . _ -).');
    if (password.length < 8) return bad('Паролата трябва да е поне 8 символа.');
    if (!b.birthDate || isNaN(new Date(b.birthDate))) return bad('Невалидна дата на раждане.');
    const age = ageFrom(b.birthDate);
    if (age < MIN_AGE) return bad('Сайтът е само за пълнолетни (18+).');
    if (age > 99) return bad('Невалидна дата на раждане.');
    if (!['male', 'female', 'other'].includes(b.gender)) return bad('Изберете пол.');
    const place = BY_ID.get(String(b.placeId || '')); if (!place) return bad('Изберете област и населено място от списъка.');
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return bad('Това потребителско име е заето.', 409);
    if (all().some(u => u.nickname.toLowerCase() === nickname.toLowerCase())) return bad('Този никнейм е зает.', 409);
    const u = { id: ++db.seq, username, pw: hash(password), nickname, birthDate: b.birthDate, gender: b.gender, lookingFor: ['male', 'female', 'any'].includes(b.lookingFor) ? b.lookingFor : 'any',
      placeId: place.id, bio: '', interests: [], photos: [], theme: null, created: 1000 + db.seq };
    db.users.push(u); db.session = u.id; save();
    return ok({ user: full(u) }, 201);
  });
  route('POST', /^\/api\/login$/, ({ body: b }) => {
    const u = db.users.find(x => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
    if (!u || u.pw !== hash(String(b.password || ''))) return bad('Грешно потребителско име или парола.', 401);
    db.session = u.id; save(); return ok({ user: full(u) });
  });
  route('POST', /^\/api\/logout$/, () => { db.session = null; save(); return ok({ ok: true }); });

  const authed = fn => args => meUser() ? fn({ ...args, me: meUser() }) : bad('Трябва да влезете в профила си.', 401);

  route('PUT', /^\/api\/me$/, authed(({ body: b, me }) => {
    if (b.nickname !== undefined) {
      const n = String(b.nickname).trim().replace(/\s+/g, ' ');
      if (!NICK.test(n)) return bad('Никнеймът трябва да е 3–20 символа (букви, цифри, интервал, . _ -).');
      if (all().some(u => u.id !== me.id && u.nickname.toLowerCase() === n.toLowerCase())) return bad('Този никнейм е зает.', 409);
      me.nickname = n;
    }
    if (['male', 'female', 'other'].includes(b.gender)) me.gender = b.gender;
    if (['male', 'female', 'any'].includes(b.lookingFor)) me.lookingFor = b.lookingFor;
    if (b.placeId !== undefined) { if (!BY_ID.has(String(b.placeId))) return bad('Изберете област и населено място от списъка.'); me.placeId = String(b.placeId); }
    if (b.bio !== undefined) { if (String(b.bio).length > 600) return bad('Биото може да е до 600 символа.'); me.bio = String(b.bio).trim(); }
    if (Array.isArray(b.interests)) me.interests = [...new Set(b.interests.filter(x => D.interests.includes(x)))].slice(0, 8);
    save(); return ok({ user: full(me) });
  }));
  route('PUT', /^\/api\/me\/password$/, authed(({ body: b, me }) => {
    if (me.pw !== hash(String(b.current || ''))) return bad('Текущата парола е грешна.', 403);
    if (String(b.next || '').length < 8) return bad('Новата парола трябва да е 8–72 символа.');
    me.pw = hash(b.next); save(); return ok({ ok: true });
  }));
  route('PUT', /^\/api\/me\/theme$/, authed(({ body: b, me }) => { me.theme = b.theme || null; save(); return ok({ theme: me.theme }); }));
  route('DELETE', /^\/api\/me$/, authed(({ body: b, me }) => {
    if (me.pw !== hash(String(b.password || ''))) return bad('Паролата е грешна.', 403);
    db.users = db.users.filter(u => u.id !== me.id); db.likes = db.likes.filter(l => l.from !== me.id && l.to !== me.id); db.session = null; save(); return ok({ ok: true });
  }));

  route('POST', /^\/api\/me\/photos$/, authed(({ body: b, me }) => {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(b.dataUrl || ''))) return bad('Невалиден файл. Позволени са JPG, PNG и WebP.');
    if (me.photos.length >= MAX_PHOTOS) return bad(`Можете да качите най-много ${MAX_PHOTOS} снимки.`);
    me.photos.push({ id: ++db.seq, url: b.dataUrl }); save(); return ok({ user: full(me) }, 201);
  }));
  route('DELETE', /^\/api\/me\/photos\/(\d+)$/, authed(({ m, me }) => {
    const i = me.photos.findIndex(p => p.id === Number(m[1])); if (i < 0) return bad('Снимката не е намерена.', 404);
    me.photos.splice(i, 1); save(); return ok({ user: full(me) });
  }));
  route('PUT', /^\/api\/me\/photos\/(\d+)\/main$/, authed(({ m, me }) => {
    const i = me.photos.findIndex(p => p.id === Number(m[1])); if (i < 0) return bad('Снимката не е намерена.', 404);
    me.photos.unshift(me.photos.splice(i, 1)[0]); save(); return ok({ user: full(me) });
  }));

  route('GET', /^\/api\/profiles$/, authed(({ q, me }) => {
    let list = people().filter(u => u.id !== me.id && !blocked(u.id, me.id));
    if (q.get('region')) { if (!REGION_NAME.has(q.get('region'))) return bad('Непозната област.'); list = list.filter(u => (BY_ID.get(u.placeId) || {}).region === q.get('region')); }
    if (q.get('place')) { if (!BY_ID.has(q.get('place'))) return bad('Непознато населено място.'); list = list.filter(u => u.placeId === q.get('place')); }
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
    list.sort(sorts[q.get('sort')] || sorts.active);
    const limit = Math.min(48, Number(q.get('limit')) || 12), offset = Number(q.get('offset')) || 0;
    return ok({ total: list.length, offset, profiles: list.slice(offset, offset + limit).map(u => pub(u, me.id)) });
  }));
  route('GET', /^\/api\/profiles\/(\d+)$/, authed(({ m, me }) => {
    const u = people().find(x => x.id === Number(m[1])); return u && !blocked(u.id, me.id) ? ok({ profile: pub(u, me.id) }) : bad('Профилът не е намерен.', 404);
  }));
  route('POST', /^\/api\/profiles\/(\d+)\/like$/, authed(({ m, me }) => {
    const id = Number(m[1]), u = people().find(x => x.id === id);
    if (!u || blocked(id, me.id)) return bad('Профилът не е намерен.', 404);
    if (id === me.id) return bad('Не можете да харесате себе си.');
    const i = db.likes.findIndex(l => l.from === me.id && l.to === id);
    if (i >= 0) db.likes.splice(i, 1); else db.likes.push({ from: me.id, to: id });
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
    return ok({ users: ps.length, real: real.length, demo: ps.length - real.length, openReports: (db.reports || []).filter(r => r.status === 'open').length, photos: ps.reduce((n, u) => n + u.photos.length, 0), likes: db.likes.length,
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
  const attView = id => { const f = files[id]; return f ? { id: f.id, name: f.name, size: f.size, kind: f.kind, url: f.url } : null; };
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

  // ── Тестов обикновен потребител с готови разговори и група ──
  const TEST_ID = 998;
  route('POST', /^\/api\/demo-user$/, () => {
    let t = db.users.find(u => u.id === TEST_ID);
    if (!t) {
      const T = D.testUser, born = new Date(); born.setFullYear(born.getFullYear() - T.age); born.setMonth(5, 15);
      t = { id: TEST_ID, username: T.username, pw: hash(Math.random() + ''), nickname: T.nickname, birthDate: born.toISOString().slice(0, 10), gender: T.gender, lookingFor: T.lookingFor, placeId: T.placeId,
        bio: T.bio, interests: [...T.interests], photos: [], theme: null, role: 'user', created: 1000 };
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
    openReports: me.role === 'admin' ? db.reports.filter(r => r.status === 'open').length : 0 })));
  route('GET', /^\/api\/chats\/contacts$/, authed(({ me }) => ok({ contacts: contactsOf(me).map(u => pub(u, me.id)) })));
  route('GET', /^\/api\/chats$/, authed(({ me }) => {
    const chats = [];
    for (const c of db.convs.filter(x => memberOf(x, me.id))) {
      const mm = memberOf(c, me.id), ms = msgsOf(c).filter(m => m.id >= mm.from); if (!ms.length) continue;
      const last = ms[ms.length - 1];
      const lp = { body: last.body || (attView(last.att) || {}).kind === 'image' ? (last.body || '📷 Снимка') : (last.body || '📎 Файл'), mine: last.from === me.id, senderNick: last.from ? nickOf(last.from) : '', system: last.kind === 'system', at: iso(last.at) };
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
  route('POST', /^\/api\/chats\/groups$/, authed(({ body: b, me }) => {
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
  route('POST', /^\/api\/chats\/(\d+)\/messages$/, authed(({ m, body: b, me }) => {
    const c = convById(Number(m[1])); if (!memberOf(c, me.id)) return bad('Разговорът не е намерен.', 404);
    if (c.kind === 'direct' && !peerUser(c, me)) return bad('Не можете да пишете на този профил.', 403);
    const text = String(b.body || '').trim(); if (text.length > 1000) return bad('Съобщението може да е до 1000 символа.');
    let att = null;
    if (b.attachmentId) { att = files[b.attachmentId]; if (!att || att.uploader !== me.id || att.mid) return bad('Файлът не е наличен. Качи го отново.'); }
    if (!text && !att) return bad('Съобщението е празно.');
    if (!canSend(me)) return bad('Изпращате твърде бързо. Изчакайте малко.', 429);
    const msg = addMsg(c, me.id, text, att && att.id);
    if (att) saveFiles();
    // Демо профилите отговарят (един член на групата, след малко)
    const bots = c.members.filter(x => x.id !== me.id && demo.some(d => d.id === x.id));
    if (bots.length) { const bot = bots[db.messages.length % bots.length]; addMsg(c, bot.id, CANNED[db.messages.length % CANNED.length], null, Date.now() + 2500); }
    save(); return ok({ message: msgView(msg, me) }, 201);
  }));
  const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'vbs', 'js', 'mjs', 'jar', 'sh', 'app', 'apk', 'dll', 'lnk', 'html', 'htm', 'xhtml', 'svg', 'hta', 'reg']);
  const readBlob = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  route('POST', /^\/api\/chats\/(\d+)\/attachments$/, authed(async ({ m, blob, headers, me }) => {
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
  route('PUT', /^\/api\/chats\/(\d+)$/, authed(({ m, body: b, me }) => {
    const [c, err] = ownerOnly(m, me); if (err) return err;
    const title = cleanTitle(b.title); if (title.length < 2 || title.length > 40) return bad('Името на групата трябва да е 2–40 символа.');
    c.title = title; addSystem(c, me.id, `Групата беше преименувана на „${title}“`); save(); return ok({ ok: true });
  }));
  route('POST', /^\/api\/chats\/(\d+)\/members$/, authed(({ m, body: b, me }) => {
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

  // ── Доклади ──
  route('POST', /^\/api\/profiles\/(\d+)\/report$/, authed(({ m, body: b, me }) => {
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
      convTitle: c && c.kind === 'group' ? c.title : '', msgs });
    if (b.block && !blocked(me.id, id)) db.blocks.push({ from: me.id, to: id });
    save(); return ok({ ok: true, blocked: !!b.block }, 201);
  }));
  const LABEL = k => D.reportReasons[k] || k;
  const rrow = r => ({ id: r.id, reporterNick: r.reporterNick, reportedNick: r.reportedNick, reason: r.reason, reasonLabel: LABEL(r.reason), status: r.status, createdAt: iso(r.created), resolvedAt: r.resolvedAt ? iso(r.resolvedAt) : null });
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
