const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const SqliteStore = require('./session-store');
const { CITIES, INTERESTS, GENDERS, LOOKING, MIN_AGE, MAX_PHOTOS, REPORT_REASONS } = require('./constants');

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET е задължителен в production.');
}
// Вход като администратор БЕЗ парола – само за демо/преглед. Никога в production.
if (isProd && process.env.DEMO_ADMIN === '1') {
  throw new Error('DEMO_ADMIN=1 (вход без парола) е забранен в production.');
}
const demoAdminOn = () => process.env.DEMO_ADMIN === '1' && !isProd;

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// ── Защитни хедъри ──
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(express.json({ limit: '64kb' }));
// Снимките идват като data URL в JSON → по-голям лимит само за този маршрут.
const bigJson = express.json({ limit: '5mb' });

app.use(session({
  name: 'spark.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  store: new SqliteStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 3600 * 1000,
  },
}));

// ── Помощни функции ──
const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

function ageFrom(birth) {
  const b = new Date(birth + 'T00:00:00Z');
  const n = new Date();
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  const m = n.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}
function dateYearsAgo(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}
function validBirth(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const isOnline = lastSeen => Date.now() - new Date(lastSeen.replace(' ', 'T') + 'Z').getTime() < 5 * 60 * 1000;

const nickKey = n => n.toLowerCase();
const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,18}[\p{L}\p{N}]$/u;
const USER_RE = /^[A-Za-z0-9_.-]{3,30}$/;

function cleanInterests(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(x => INTERESTS.includes(x)))].slice(0, 8);
}

// ── Серилизация ──
function photosOf(ids) {
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) return out;
  const rows = db.prepare(
    `SELECT id, user_id, filename FROM photos WHERE user_id IN (${ids.map(() => '?').join(',')}) ORDER BY position, id`
  ).all(...ids);
  for (const r of rows) out.get(r.user_id).push({ id: r.id, url: '/uploads/' + r.filename });
  return out;
}
function interestsOf(ids) {
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) return out;
  const rows = db.prepare(
    `SELECT user_id, interest FROM user_interests WHERE user_id IN (${ids.map(() => '?').join(',')}) ORDER BY interest`
  ).all(...ids);
  for (const r of rows) out.get(r.user_id).push(r.interest);
  return out;
}
function publicProfiles(rows, viewerId) {
  const ids = rows.map(r => r.id);
  const photos = photosOf(ids);
  const ints = interestsOf(ids);
  const liked = new Set(
    ids.length
      ? db.prepare(`SELECT to_id FROM likes WHERE from_id = ? AND to_id IN (${ids.map(() => '?').join(',')})`)
          .all(viewerId, ...ids).map(r => r.to_id)
      : []
  );
  const likedMe = new Set(
    ids.length
      ? db.prepare(`SELECT from_id FROM likes WHERE to_id = ? AND from_id IN (${ids.map(() => '?').join(',')})`)
          .all(viewerId, ...ids).map(r => r.from_id)
      : []
  );
  const counts = new Map(
    ids.length
      ? db.prepare(`SELECT to_id, COUNT(*) c FROM likes WHERE to_id IN (${ids.map(() => '?').join(',')}) GROUP BY to_id`)
          .all(...ids).map(r => [r.to_id, r.c])
      : []
  );
  return rows.map(r => ({
    id: r.id,
    nickname: r.nickname,
    age: ageFrom(r.birth_date),
    gender: r.gender,
    lookingFor: r.looking_for,
    city: r.city,
    bio: r.bio,
    interests: ints.get(r.id),
    photos: photos.get(r.id),
    isDemo: !!r.is_demo,
    online: isOnline(r.last_seen),
    liked: liked.has(r.id),
    likedMe: likedMe.has(r.id),
    likes: counts.get(r.id) || 0,
    isMe: r.id === viewerId,
  }));
}
function meOf(id) {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!r) return null;
  const p = publicProfiles([r], id)[0];
  let theme = null;
  try { theme = r.theme ? JSON.parse(r.theme) : null; } catch { /* повреден JSON → игнорира се */ }
  return { ...p, username: r.username, birthDate: r.birth_date, theme, role: r.role };
}

// ── Auth middleware ──
const touch = db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?");
function requireAuth(req, res, next) {
  const id = req.session.userId;
  if (!id) return bad(res, 'Трябва да влезете в профила си.', 401);
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
  if (!exists) { req.session.destroy(() => bad(res, 'Сесията е невалидна.', 401)); return; }
  const now = Date.now();
  if (!req.session.touched || now - req.session.touched > 60000) {
    req.session.touched = now;
    touch.run(id);
  }
  next();
}

// ── Ограничаване на опитите за вход ──
const attempts = new Map(); // key -> {n, first}
const WINDOW = 15 * 60 * 1000, MAX_FAILS = 8;
function failKey(req, name) { return req.ip + '|' + String(name || '').toLowerCase(); }
function tooMany(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.n >= MAX_FAILS;
}
function noteFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { n: 1, first: Date.now() });
  else a.n++;
}
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

// ── Публични маршрути ──
app.get('/api/meta', (req, res) => {
  const counts = new Map(
    db.prepare("SELECT city, COUNT(*) c FROM users WHERE role <> 'admin' GROUP BY city").all().map(r => [r.city, r.c])
  );
  res.json({
    cities: CITIES.map(name => ({ name, count: counts.get(name) || 0 })),
    interests: INTERESTS,
    minAge: MIN_AGE,
    maxPhotos: MAX_PHOTOS,
    total: db.prepare("SELECT COUNT(*) c FROM users WHERE role <> 'admin'").get().c,
    demoAdmin: demoAdminOn(),
    reportReasons: REPORT_REASONS,
  });
});

app.post('/api/register', wrap((req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const nickname = String(b.nickname || '').trim().replace(/\s+/g, ' ');
  const password = String(b.password || '');
  if (!USER_RE.test(username)) return bad(res, 'Потребителското име трябва да е 3–30 символа: латински букви, цифри, . _ -');
  if (!NICK_RE.test(nickname)) return bad(res, 'Никнеймът трябва да е 3–20 символа (букви, цифри, интервал, . _ -).');
  if (password.length < 8) return bad(res, 'Паролата трябва да е поне 8 символа.');
  if (Buffer.byteLength(password) > 72) return bad(res, 'Паролата е твърде дълга (макс. 72 байта).');
  if (!validBirth(b.birthDate)) return bad(res, 'Невалидна дата на раждане.');
  const age = ageFrom(b.birthDate);
  if (age < MIN_AGE) return bad(res, `Сайтът е само за пълнолетни (${MIN_AGE}+).`);
  if (age > 99) return bad(res, 'Невалидна дата на раждане.');
  if (!GENDERS.includes(b.gender)) return bad(res, 'Изберете пол.');
  const looking = LOOKING.includes(b.lookingFor) ? b.lookingFor : 'any';
  if (!CITIES.includes(b.city)) return bad(res, 'Изберете град от списъка.');

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'Това потребителско име е заето.', 409);
  if (db.prepare('SELECT 1 FROM users WHERE nickname_key = ?').get(nickKey(nickname))) return bad(res, 'Този никнейм е зает.', 409);

  const id = db.prepare(
    'INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city) VALUES (?,?,?,?,?,?,?,?)'
  ).run(username, bcrypt.hashSync(password, 10), nickname, nickKey(nickname), b.birthDate, b.gender, looking, b.city).lastInsertRowid;

  req.session.regenerate(err => {
    if (err) return bad(res, 'Грешка при създаване на сесия.', 500);
    req.session.userId = id;
    res.status(201).json({ user: meOf(id) });
  });
}));

app.post('/api/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return bad(res, 'Въведете потребителско име и парола.');
  }
  const key = failKey(req, username);
  if (tooMany(key)) return bad(res, 'Твърде много неуспешни опити. Опитайте отново след 15 минути.', 429);
  const row = db.prepare('SELECT id, password_hash, is_demo FROM users WHERE username = ?').get(username.trim());
  // Винаги правим bcrypt сравнение – не издаваме дали името съществува по време на отговора.
  const ok = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH) && row && !row.is_demo;
  if (!ok) { noteFail(key); return bad(res, 'Грешно потребителско име или парола.', 401); }
  attempts.delete(key);
  req.session.regenerate(err => {
    if (err) return bad(res, 'Грешка при създаване на сесия.', 500);
    req.session.userId = row.id;
    touch.run(row.id);
    res.json({ user: meOf(row.id) });
  });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('spark.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.userId ? meOf(req.session.userId) : null });
});

// ── Профил ──
app.put('/api/me', requireAuth, wrap((req, res) => {
  const b = req.body || {};
  const id = req.session.userId;
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const next = { ...cur };

  if (b.nickname !== undefined) {
    const nick = String(b.nickname).trim().replace(/\s+/g, ' ');
    if (!NICK_RE.test(nick)) return bad(res, 'Никнеймът трябва да е 3–20 символа (букви, цифри, интервал, . _ -).');
    const taken = db.prepare('SELECT id FROM users WHERE nickname_key = ? AND id <> ?').get(nickKey(nick), id);
    if (taken) return bad(res, 'Този никнейм е зает.', 409);
    next.nickname = nick;
  }
  if (b.gender !== undefined) {
    if (!GENDERS.includes(b.gender)) return bad(res, 'Невалиден пол.');
    next.gender = b.gender;
  }
  if (b.lookingFor !== undefined) {
    if (!LOOKING.includes(b.lookingFor)) return bad(res, 'Невалидна стойност за „Търся“.');
    next.looking_for = b.lookingFor;
  }
  if (b.city !== undefined) {
    if (!CITIES.includes(b.city)) return bad(res, 'Изберете град от списъка.');
    next.city = b.city;
  }
  if (b.bio !== undefined) {
    const bio = String(b.bio).trim();
    if (bio.length > 600) return bad(res, 'Биото може да е до 600 символа.');
    next.bio = bio;
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET nickname=?, nickname_key=?, gender=?, looking_for=?, city=?, bio=? WHERE id=?')
      .run(next.nickname, nickKey(next.nickname), next.gender, next.looking_for, next.city, next.bio, id);
    if (b.interests !== undefined) {
      db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(id);
      const ins = db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)');
      cleanInterests(b.interests).forEach(x => ins.run(id, x));
    }
  })();
  res.json({ user: meOf(id) });
}));

app.put('/api/me/password', requireAuth, wrap((req, res) => {
  const { current, next } = req.body || {};
  const id = req.session.userId;
  if (typeof current !== 'string' || typeof next !== 'string') return bad(res, 'Липсват данни.');
  if (next.length < 8 || Buffer.byteLength(next) > 72) return bad(res, 'Новата парола трябва да е 8–72 символа.');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  if (!bcrypt.compareSync(current, row.password_hash)) return bad(res, 'Текущата парола е грешна.', 403);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), id);
  res.json({ ok: true });
}));

// Тема: валидираме строго – само известни ключове, hex цветове и числа в граници.
const HEX = /^#[0-9a-fA-F]{6}$/;
const THEME_COLORS = ['text', 'heading', 'accent', 'border', 'surface', 'bg'];
const THEME_NUMS = { fontScale: [80, 150], radius: [0, 32], borderWidth: [0, 4], glow: [0, 100] };
function cleanTheme(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  for (const k of THEME_COLORS) if (typeof t[k] === 'string' && HEX.test(t[k])) out[k] = t[k].toLowerCase();
  for (const [k, [lo, hi]] of Object.entries(THEME_NUMS)) {
    const v = Number(t[k]);
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, Math.round(v)));
  }
  if (typeof t.animations === 'boolean') out.animations = t.animations;
  return out;
}
app.put('/api/me/theme', requireAuth, wrap((req, res) => {
  const theme = cleanTheme(req.body && req.body.theme);
  db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme ? JSON.stringify(theme) : null, req.session.userId);
  res.json({ theme });
}));

app.delete('/api/me', requireAuth, wrap((req, res) => {
  const id = req.session.userId;
  const files = db.prepare('SELECT filename FROM photos WHERE user_id = ?').all(id);
  const { password } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  if (typeof password !== 'string' || !bcrypt.compareSync(password, row.password_hash)) {
    return bad(res, 'Паролата е грешна.', 403);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  files.forEach(f => fs.rm(path.join(db.UPLOAD_DIR, f.filename), { force: true }, () => {}));
  req.session.destroy(() => { res.clearCookie('spark.sid'); res.json({ ok: true }); });
}));

// ── Снимки ──
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
app.post('/api/me/photos', requireAuth, bigJson, wrap((req, res) => {
  const id = req.session.userId;
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).dataUrl || ''));
  if (!m) return bad(res, 'Невалиден файл. Позволени са JPG, PNG и WebP.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 3 * 1024 * 1024) return bad(res, 'Снимката е твърде голяма (макс. 3 MB).', 413);
  const ext = sniff(buf);
  if (!ext) return bad(res, 'Файлът не е валидно изображение.');
  const count = db.prepare('SELECT COUNT(*) c FROM photos WHERE user_id = ?').get(id).c;
  if (count >= MAX_PHOTOS) return bad(res, `Можете да качите най-много ${MAX_PHOTOS} снимки.`);
  const filename = crypto.randomBytes(16).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(db.UPLOAD_DIR, filename), buf, { flag: 'wx' });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 p FROM photos WHERE user_id = ?').get(id).p;
  db.prepare('INSERT INTO photos (user_id, filename, position) VALUES (?, ?, ?)').run(id, filename, pos);
  res.status(201).json({ user: meOf(id) });
}));

app.delete('/api/me/photos/:pid', requireAuth, wrap((req, res) => {
  const id = req.session.userId;
  const row = db.prepare('SELECT id, filename FROM photos WHERE id = ? AND user_id = ?').get(Number(req.params.pid), id);
  if (!row) return bad(res, 'Снимката не е намерена.', 404);
  db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);
  fs.rm(path.join(db.UPLOAD_DIR, row.filename), { force: true }, () => {});
  res.json({ user: meOf(id) });
}));

app.put('/api/me/photos/:pid/main', requireAuth, wrap((req, res) => {
  const id = req.session.userId;
  const row = db.prepare('SELECT id FROM photos WHERE id = ? AND user_id = ?').get(Number(req.params.pid), id);
  if (!row) return bad(res, 'Снимката не е намерена.', 404);
  db.transaction(() => {
    db.prepare('UPDATE photos SET position = position + 1 WHERE user_id = ?').run(id);
    db.prepare('UPDATE photos SET position = 0 WHERE id = ?').run(row.id);
  })();
  res.json({ user: meOf(id) });
}));

// ── Разглеждане на хора ──
const SORTS = {
  active: 'u.last_seen DESC, u.id DESC',
  new: 'u.id DESC',
  young: 'u.birth_date DESC, u.id DESC',
  old: 'u.birth_date ASC, u.id DESC',
};
app.get('/api/profiles', requireAuth, wrap((req, res) => {
  const q = req.query;
  const where = ['u.id <> ?', "u.role <> 'admin'",
    'NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))'];
  const args = [req.session.userId, req.session.userId, req.session.userId];

  if (q.city) {
    if (!CITIES.includes(q.city)) return bad(res, 'Непознат град.');
    where.push('u.city = ?'); args.push(q.city);
  }
  if (q.gender) {
    if (!GENDERS.includes(q.gender)) return bad(res, 'Невалиден пол.');
    where.push('u.gender = ?'); args.push(q.gender);
  }
  const aMin = q.ageMin ? Math.max(MIN_AGE, parseInt(q.ageMin, 10) || MIN_AGE) : null;
  const aMax = q.ageMax ? Math.min(99, parseInt(q.ageMax, 10) || 99) : null;
  if (aMin) { where.push('u.birth_date <= ?'); args.push(dateYearsAgo(aMin)); }
  if (aMax) { where.push('u.birth_date > ?'); args.push(dateYearsAgo(aMax + 1)); }
  if (q.withPhoto === '1') where.push('EXISTS (SELECT 1 FROM photos p WHERE p.user_id = u.id)');
  if (q.online === '1') where.push("u.last_seen >= datetime('now', '-5 minutes')");
  if (q.lookingForMe === '1') {
    const me = db.prepare('SELECT gender FROM users WHERE id = ?').get(req.session.userId);
    where.push("(u.looking_for = 'any' OR u.looking_for = ?)"); args.push(me.gender === 'other' ? 'any' : me.gender);
  }
  const ints = cleanInterests([].concat(q.interest || []));
  if (ints.length) {
    where.push(`EXISTS (SELECT 1 FROM user_interests i WHERE i.user_id = u.id AND i.interest IN (${ints.map(() => '?').join(',')}))`);
    args.push(...ints);
  }
  if (q.q) {
    const term = nickKey(String(q.q).trim().slice(0, 30)).replace(/[\\%_]/g, c => '\\' + c);
    if (term) { where.push("u.nickname_key LIKE ? ESCAPE '\\'"); args.push('%' + term + '%'); }
  }
  const order = SORTS[q.sort] || SORTS.active;
  const limit = Math.min(48, Math.max(1, parseInt(q.limit, 10) || 12));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  const sqlWhere = 'WHERE ' + where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) c FROM users u ${sqlWhere}`).get(...args).c;
  const rows = db.prepare(`SELECT u.* FROM users u ${sqlWhere} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ total, offset, profiles: publicProfiles(rows, req.session.userId) });
}));

app.get('/api/profiles/:id', requireAuth, wrap((req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ? AND role <> 'admin'").get(Number(req.params.id));
  if (!row || blockedBetween(req.session.userId, row.id)) return bad(res, 'Профилът не е намерен.', 404);
  res.json({ profile: publicProfiles([row], req.session.userId)[0] });
}));

app.post('/api/profiles/:id/like', requireAuth, wrap((req, res) => {
  const to = Number(req.params.id), from = req.session.userId;
  if (to === from) return bad(res, 'Не можете да харесате себе си.');
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role <> 'admin'").get(to) || blockedBetween(from, to)) return bad(res, 'Профилът не е намерен.', 404);
  const had = db.prepare('DELETE FROM likes WHERE from_id = ? AND to_id = ?').run(from, to).changes > 0;
  if (!had) db.prepare('INSERT INTO likes (from_id, to_id) VALUES (?, ?)').run(from, to);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(to);
  res.json({ profile: publicProfiles([row], from)[0] });
}));

// ── Съобщения, блокиране, доклади ──
const isBlockedStmt = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)');
function blockedBetween(a, b) { return !!isBlockedStmt.get(a, b, b, a); }
const iso = t => t.replace(' ', 'T') + 'Z';
const findPeer = id => db.prepare("SELECT * FROM users WHERE id = ? AND role <> 'admin'").get(id);

// Най-много 20 съобщения в минута на потребител.
const sendLog = new Map();
function canSend(uid) {
  const now = Date.now();
  const arr = (sendLog.get(uid) || []).filter(t => now - t < 60000);
  if (arr.length >= 20) { sendLog.set(uid, arr); return false; }
  arr.push(now); sendLog.set(uid, arr); return true;
}

app.get('/api/chats/unread', requireAuth, wrap((req, res) => {
  const id = req.session.userId;
  const unread = db.prepare('SELECT COUNT(*) c FROM messages WHERE to_id = ? AND read_at IS NULL').get(id).c;
  const isAdmin = db.prepare('SELECT role FROM users WHERE id = ?').get(id).role === 'admin';
  const openReports = isAdmin ? db.prepare("SELECT COUNT(*) c FROM reports WHERE status = 'open'").get().c : 0;
  res.json({ unread, openReports });
}));

app.get('/api/chats', requireAuth, wrap((req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other, MAX(id) AS last_id,
           SUM(CASE WHEN to_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
    FROM messages WHERE from_id = ? OR to_id = ? GROUP BY other ORDER BY last_id DESC LIMIT 100`).all(me, me, me, me);
  const items = [];
  for (const r of rows) {
    const u = findPeer(r.other);
    if (!u || blockedBetween(me, u.id)) continue;
    const last = db.prepare('SELECT from_id, body, created_at FROM messages WHERE id = ?').get(r.last_id);
    items.push({ u, unread: r.unread, last });
  }
  const profiles = publicProfiles(items.map(i => i.u), me);
  res.json({ chats: items.map((i, n) => ({ profile: profiles[n], unread: i.unread, last: { body: i.last.body, mine: i.last.from_id === me, at: iso(i.last.created_at) } })) });
}));

app.get('/api/chats/:id', requireAuth, wrap((req, res) => {
  const me = req.session.userId, id = Number(req.params.id);
  const peer = id === me ? null : findPeer(id);
  if (!peer || blockedBetween(me, id)) return bad(res, 'Разговорът не е намерен.', 404);
  const msgs = db.prepare(`SELECT id, from_id, body, created_at FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 200`).all(me, id, id, me).reverse();
  db.prepare("UPDATE messages SET read_at = datetime('now') WHERE to_id = ? AND from_id = ? AND read_at IS NULL").run(me, id);
  res.json({ profile: publicProfiles([peer], me)[0], messages: msgs.map(m => ({ id: m.id, mine: m.from_id === me, body: m.body, at: iso(m.created_at) })) });
}));

app.post('/api/chats/:id', requireAuth, wrap((req, res) => {
  const me = req.session.userId, id = Number(req.params.id);
  const peer = id === me ? null : findPeer(id);
  if (!peer || blockedBetween(me, id)) return bad(res, 'Не можете да пишете на този профил.', 403);
  const body = String((req.body || {}).body || '').trim();
  if (!body) return bad(res, 'Съобщението е празно.');
  if (body.length > 1000) return bad(res, 'Съобщението може да е до 1000 символа.');
  if (!canSend(me)) return bad(res, 'Изпращате твърде бързо. Изчакайте малко.', 429);
  const r = db.prepare('INSERT INTO messages (from_id, to_id, body) VALUES (?, ?, ?)').run(me, id, body);
  const m = db.prepare('SELECT id, body, created_at FROM messages WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json({ message: { id: m.id, mine: true, body: m.body, at: iso(m.created_at) } });
}));

// Доклад за профил. Към него се прикача снимка на разговора между двамата, за да може администраторът да прецени казуса.
app.post('/api/profiles/:id/report', requireAuth, wrap((req, res) => {
  const me = req.session.userId, id = Number(req.params.id), b = req.body || {};
  if (id === me) return bad(res, 'Не можете да докладвате себе си.');
  const target = findPeer(id);
  if (!target) return bad(res, 'Профилът не е намерен.', 404);
  if (!Object.hasOwn(REPORT_REASONS, b.reason)) return bad(res, 'Изберете причина за доклада.');
  const details = String(b.details || '').trim();
  if (details.length > 500) return bad(res, 'Описанието може да е до 500 символа.');
  if (db.prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND reported_id = ? AND status = 'open'").get(me, id)) {
    return bad(res, 'Вече сте докладвали този профил. Администраторите разглеждат доклада.', 409);
  }
  if (db.prepare("SELECT COUNT(*) c FROM reports WHERE reporter_id = ? AND created_at >= datetime('now', '-1 day')").get(me).c >= 10) {
    return bad(res, 'Достигнахте дневния лимит за доклади.', 429);
  }
  const reporter = db.prepare('SELECT nickname FROM users WHERE id = ?').get(me);
  db.transaction(() => {
    const rid = db.prepare('INSERT INTO reports (reporter_id, reported_id, reporter_nick, reported_nick, reason, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(me, id, reporter.nickname, target.nickname, b.reason, details).lastInsertRowid;
    const msgs = db.prepare(`SELECT from_id, body, created_at FROM messages
      WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 200`).all(me, id, id, me).reverse();
    const ins = db.prepare('INSERT INTO report_messages (report_id, from_reporter, body, sent_at) VALUES (?, ?, ?, ?)');
    msgs.forEach(m => ins.run(rid, m.from_id === me ? 1 : 0, m.body, m.created_at));
    if (b.block) db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(me, id);
  })();
  res.status(201).json({ ok: true, blocked: !!b.block });
}));

// ── Администрация ──
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const r = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!r || r.role !== 'admin') return bad(res, 'Нямате достъп.', 403);
    next();
  });
}

// Вход без парола – включва се само с DEMO_ADMIN=1 (и никога в production).
app.post('/api/demo-admin', wrap((req, res) => {
  if (!demoAdminOn()) return bad(res, 'Няма такъв маршрут.', 404);
  const row = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!row) return bad(res, 'Няма администраторски акаунт.', 404);
  req.session.regenerate(err => {
    if (err) return bad(res, 'Грешка при създаване на сесия.', 500);
    req.session.userId = row.id;
    touch.run(row.id);
    res.json({ user: meOf(row.id) });
  });
}));

// Вход като тестов обикновен потребител (без парола) – със същата защита като админския.
app.post('/api/demo-user', wrap((req, res) => {
  if (!demoAdminOn()) return bad(res, 'Няма такъв маршрут.', 404);
  const row = db.prepare("SELECT id FROM users WHERE username = 'tester' AND role = 'user'").get();
  if (!row) return bad(res, 'Няма тестов потребител.', 404);
  req.session.regenerate(err => {
    if (err) return bad(res, 'Грешка при създаване на сесия.', 500);
    req.session.userId = row.id;
    touch.run(row.id);
    res.json({ user: meOf(row.id) });
  });
}));

app.get('/api/admin/stats', requireAdmin, wrap((req, res) => {
  const one = sql => db.prepare(sql).get().c;
  const byCity = db.prepare("SELECT city, COUNT(*) c FROM users WHERE role <> 'admin' GROUP BY city ORDER BY c DESC, city").all();
  const byGender = db.prepare("SELECT gender, COUNT(*) c FROM users WHERE role <> 'admin' GROUP BY gender").all();
  res.json({
    users: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin'"),
    real: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin' AND is_demo = 0"),
    demo: one('SELECT COUNT(*) c FROM users WHERE is_demo = 1'),
    photos: one('SELECT COUNT(*) c FROM photos'),
    likes: one('SELECT COUNT(*) c FROM likes'),
    online: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin' AND last_seen >= datetime('now', '-5 minutes')"),
    openReports: one("SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
    newToday: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin' AND is_demo = 0 AND created_at >= datetime('now', '-1 day')"),
    byCity: byCity.map(r => ({ city: r.city, count: r.c })),
    byGender: Object.fromEntries(byGender.map(r => [r.gender, r.c])),
  });
}));

app.get('/api/admin/users', requireAdmin, wrap((req, res) => {
  const term = nickKey(String(req.query.q || '').trim().slice(0, 30)).replace(/[\\%_]/g, c => '\\' + c);
  const rows = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.birth_date, u.gender, u.city, u.is_demo, u.role, u.created_at, u.last_seen,
           (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id) AS photos,
           (SELECT COUNT(*) FROM likes l WHERE l.to_id = u.id) AS likes
    FROM users u WHERE (u.nickname_key LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')
    ORDER BY u.id DESC LIMIT 200`).all('%' + term + '%', '%' + term + '%');
  res.json({ users: rows.map(r => ({
    id: r.id, username: r.username, nickname: r.nickname, age: ageFrom(r.birth_date), gender: r.gender, city: r.city,
    isDemo: !!r.is_demo, role: r.role, createdAt: r.created_at, lastSeen: r.last_seen, photos: r.photos, likes: r.likes,
  })) });
}));

app.delete('/api/admin/users/:id', requireAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!row) return bad(res, 'Потребителят не е намерен.', 404);
  if (row.role === 'admin') return bad(res, 'Администраторски акаунт не може да се изтрива.', 403);
  const files = db.prepare('SELECT filename FROM photos WHERE user_id = ?').all(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  files.forEach(f => fs.rm(path.join(db.UPLOAD_DIR, f.filename), { force: true }, () => {}));
  res.json({ ok: true });
}));

// ── Доклади (админ) ──
// Администраторът вижда разговор САМО като част от доклад (снимка от момента на докладването),
// не може да разглежда произволни чатове. Всяко отваряне се записва в журнала.
const REPORT_STATUSES = ['open', 'upheld', 'dismissed'];
const reportRow = r => ({
  id: r.id, reporterNick: r.reporter_nick, reportedNick: r.reported_nick, reason: r.reason, reasonLabel: REPORT_REASONS[r.reason] || r.reason,
  status: r.status, createdAt: iso(r.created_at), resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
});

app.get('/api/admin/reports', requireAdmin, wrap((req, res) => {
  const st = REPORT_STATUSES.includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM report_messages m WHERE m.report_id = r.id) AS msgs
    FROM reports r ${st ? 'WHERE r.status = ?' : ''} ORDER BY (r.status = 'open') DESC, r.id DESC LIMIT 200`).all(...(st ? [st] : []));
  const counts = Object.fromEntries(REPORT_STATUSES.map(k => [k, 0]));
  db.prepare('SELECT status, COUNT(*) c FROM reports GROUP BY status').all().forEach(r => { counts[r.status] = r.c; });
  res.json({ counts, reports: rows.map(r => ({ ...reportRow(r), messages: r.msgs })) });
}));

app.get('/api/admin/reports/:id', requireAdmin, wrap((req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!r) return bad(res, 'Докладът не е намерен.', 404);
  db.prepare("INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, 'view_report', ?)").run(req.session.userId, r.id);
  const views = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'view_report' AND report_id = ?").get(r.id).c;
  const msgs = db.prepare('SELECT id, from_reporter, body, sent_at FROM report_messages WHERE report_id = ? ORDER BY id').all(r.id);
  let reported = null;
  if (r.reported_id) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.reported_id);
    if (u) {
      reported = { id: u.id, nickname: u.nickname, age: ageFrom(u.birth_date), city: u.city, gender: u.gender, bio: u.bio, isDemo: !!u.is_demo, createdAt: iso(u.created_at),
        photos: db.prepare('SELECT COUNT(*) c FROM photos WHERE user_id = ?').get(u.id).c,
        otherReports: db.prepare('SELECT COUNT(*) c FROM reports WHERE reported_id = ? AND id <> ?').get(u.id, r.id).c };
    }
  }
  res.json({
    report: { ...reportRow(r), details: r.details, adminNote: r.admin_note, reporterStillExists: !!r.reporter_id, reportedStillExists: !!reported },
    reported,
    messages: msgs.map(m => ({ id: m.id, fromReporter: !!m.from_reporter, from: m.from_reporter ? r.reporter_nick : r.reported_nick, body: m.body, at: iso(m.sent_at) })),
    views,
  });
}));

app.put('/api/admin/reports/:id', requireAdmin, wrap((req, res) => {
  const id = Number(req.params.id), b = req.body || {};
  const r = db.prepare('SELECT id FROM reports WHERE id = ?').get(id);
  if (!r) return bad(res, 'Докладът не е намерен.', 404);
  if (!REPORT_STATUSES.includes(b.status)) return bad(res, 'Невалиден статус.');
  const note = String(b.note || '').trim();
  if (note.length > 500) return bad(res, 'Бележката може да е до 500 символа.');
  if (b.status === 'open') db.prepare("UPDATE reports SET status = 'open', admin_note = ?, resolved_by = NULL, resolved_at = NULL WHERE id = ?").run(note, id);
  else db.prepare("UPDATE reports SET status = ?, admin_note = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?").run(b.status, note, req.session.userId, id);
  db.prepare('INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, ?, ?)').run(req.session.userId, 'report_' + b.status, id);
  res.json({ ok: true });
}));

// ── Статика ──
app.use('/uploads', express.static(db.UPLOAD_DIR, {
  index: false, dotfiles: 'deny', maxAge: '7d', immutable: true,
  setHeaders: res => res.setHeader('Content-Disposition', 'inline'),
}));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: isProd ? '1h' : 0 }));

app.use('/api', (req, res) => bad(res, 'Няма такъв маршрут.', 404));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, 'Заявката е твърде голяма.', 413);
  if (err.type === 'entity.parse.failed') return bad(res, 'Невалиден JSON.');
  console.error(err);
  bad(res, 'Вътрешна грешка на сървъра.', 500);
});

module.exports = app;
