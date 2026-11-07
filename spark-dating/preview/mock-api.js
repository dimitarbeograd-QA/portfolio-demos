// Статичен преглед: имитира /api/* в браузъра (без сървър). Данните са само в този браузър.
(() => {
  'use strict';
  const D = window.__SPARK_PREVIEW__; // { cities, interests, people:[{...}] }
  const KEY = 'spark.preview.v1';
  window.confirm = () => true; // в прегледа диалозите са недостъпни
  const MIN_AGE = 18, MAX_PHOTOS = 6;
  let db = { users: [], likes: [], seq: 1000, session: null };
  try { const raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw); } catch { /* без storage */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };

  let demo = D.people.map((p, i) => ({ ...p, id: i + 1, isDemo: true, photos: [], lastMin: (i * 37) % 600, likesBase: (i * 5) % 7, created: i }));
  db.gone = db.gone || [];
  demo = demo.filter(d => !db.gone.includes(d.id));
  const all = () => demo.concat(db.users);
  const people = () => all().filter(u => u.role !== 'admin'); // админът не е в публичните списъци
  const ageFrom = b => { const d = new Date(b), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
  const hash = s => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return String(h); };
  const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,18}[\p{L}\p{N}]$/u, USER = /^[A-Za-z0-9_.-]{3,30}$/;
  const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const bad = (msg, status = 400) => ok({ error: msg }, status);
  const meUser = () => db.users.find(u => u.id === db.session);

  function pub(u, viewer) {
    const likes = db.likes.filter(l => l.to === u.id).length + (u.likesBase || 0);
    return {
      id: u.id, nickname: u.nickname, age: u.isDemo ? u.age : ageFrom(u.birthDate), gender: u.gender, lookingFor: u.lookingFor, city: u.city,
      bio: u.bio, interests: [...u.interests].sort(), photos: u.photos.map(p => ({ id: p.id, url: p.url })), isDemo: !!u.isDemo,
      online: u.isDemo ? u.lastMin < 5 : true, liked: db.likes.some(l => l.from === viewer && l.to === u.id),
      likedMe: db.likes.some(l => l.from === u.id && l.to === viewer), likes, isMe: u.id === viewer,
    };
  }
  const full = u => ({ ...pub(u, u.id), username: u.username, birthDate: u.birthDate, theme: u.theme || null, role: u.role || 'user' });

  const routes = [];
  const route = (m, re, fn) => routes.push([m, re, fn]);

  route('GET', /^\/api\/meta$/, () => ok({
    cities: D.cities.map(name => ({ name, count: people().filter(u => u.city === name).length })),
    interests: D.interests, minAge: MIN_AGE, maxPhotos: MAX_PHOTOS, total: people().length, demoAdmin: true,
  }));
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
    if (!D.cities.includes(b.city)) return bad('Изберете град от списъка.');
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return bad('Това потребителско име е заето.', 409);
    if (all().some(u => u.nickname.toLowerCase() === nickname.toLowerCase())) return bad('Този никнейм е зает.', 409);
    const u = { id: ++db.seq, username, pw: hash(password), nickname, birthDate: b.birthDate, gender: b.gender, lookingFor: ['male', 'female', 'any'].includes(b.lookingFor) ? b.lookingFor : 'any',
      city: b.city, bio: '', interests: [], photos: [], theme: null, created: 1000 + db.seq };
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
    if (D.cities.includes(b.city)) me.city = b.city;
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
    let list = people().filter(u => u.id !== me.id);
    if (q.get('city')) list = list.filter(u => u.city === q.get('city'));
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
    const u = people().find(x => x.id === Number(m[1])); return u ? ok({ profile: pub(u, me.id) }) : bad('Профилът не е намерен.', 404);
  }));
  route('POST', /^\/api\/profiles\/(\d+)\/like$/, authed(({ m, me }) => {
    const id = Number(m[1]), u = people().find(x => x.id === id);
    if (!u) return bad('Профилът не е намерен.', 404);
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
    if (!a) { a = { id: ADMIN_ID, username: 'admin', pw: hash(Math.random() + ''), nickname: 'Админ', birthDate: '1990-01-01', gender: 'other', lookingFor: 'any', city: 'София', bio: 'Администратор на Spark.', interests: [], photos: [], theme: null, role: 'admin', created: 0 }; db.users.push(a); }
    db.session = ADMIN_ID; save(); return ok({ user: full(a) });
  });
  const adminOnly = fn => authed(args => (args.me.role === 'admin' ? fn(args) : bad('Нямате достъп.', 403)));
  const ageOf = u => (u.isDemo ? u.age : ageFrom(u.birthDate));
  route('GET', /^\/api\/admin\/stats$/, adminOnly(() => {
    const ps = people(), real = ps.filter(u => !u.isDemo), by = {};
    ps.forEach(u => { by[u.city] = (by[u.city] || 0) + 1; });
    const g = {}; ps.forEach(u => { g[u.gender] = (g[u.gender] || 0) + 1; });
    return ok({ users: ps.length, real: real.length, demo: ps.length - real.length, photos: ps.reduce((n, u) => n + u.photos.length, 0), likes: db.likes.length,
      online: ps.filter(u => !u.isDemo || u.lastMin < 5).length, newToday: real.length,
      byCity: Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([city, count]) => ({ city, count })), byGender: g });
  }));
  route('GET', /^\/api\/admin\/users$/, adminOnly(({ q }) => {
    const term = (q.get('q') || '').trim().toLowerCase();
    const list = all().filter(u => !term || u.nickname.toLowerCase().includes(term) || (u.username || '').toLowerCase().includes(term)).sort((a, b) => b.id - a.id).slice(0, 200);
    return ok({ users: list.map(u => ({ id: u.id, username: u.username || '', nickname: u.nickname, age: ageOf(u), gender: u.gender, city: u.city, isDemo: !!u.isDemo, role: u.role || 'user',
      createdAt: '', lastSeen: '', photos: u.photos.length, likes: db.likes.filter(l => l.to === u.id).length + (u.likesBase || 0) })) });
  }));
  route('DELETE', /^\/api\/admin\/users\/(\d+)$/, adminOnly(({ m }) => {
    const id = Number(m[1]), u = all().find(x => x.id === id);
    if (!u) return bad('Потребителят не е намерен.', 404);
    if (u.role === 'admin') return bad('Администраторски акаунт не може да се изтрива.', 403);
    if (u.isDemo) { demo.splice(demo.indexOf(u), 1); db.gone.push(id); } else db.users = db.users.filter(x => x.id !== id);
    db.likes = db.likes.filter(l => l.from !== id && l.to !== id); save(); return ok({ ok: true });
  }));

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opt = {}) => {
    const u = new URL(String(url), 'http://x');
    if (!u.pathname.startsWith('/api/')) return realFetch(url, opt);
    const method = (opt.method || 'GET').toUpperCase();
    let body = {}; try { body = opt.body ? JSON.parse(opt.body) : {}; } catch { /* ignore */ }
    for (const [m, re, fn] of routes) {
      const match = re.exec(u.pathname);
      if (m === method && match) { await new Promise(r => setTimeout(r, 60)); return fn({ body, q: u.searchParams, m: match }); }
    }
    return bad('Няма такъв маршрут.', 404);
  };

  // Бележка в долния ред
  document.addEventListener('DOMContentLoaded', () => {
    const f = document.querySelector('.foot');
    if (f) { const s = document.createElement('span'); s.className = 'dim'; s.textContent = 'Преглед: данните ти остават само в този браузър.'; f.append(s); }
  });
})();
