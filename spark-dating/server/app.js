const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const SqliteStore = require('./session-store');
const places = require('./places');
const emailutil = require('./emailutil');
const mailer = require('./mailer');
// STUN/TURN за обажданията. За връзка зад строги мрежи добави TURN чрез ICE_SERVERS (JSON масив).
const ICE_SERVERS = (() => { try { const v = JSON.parse(process.env.ICE_SERVERS || ''); if (Array.isArray(v) && v.length) return v; } catch { /* ignore */ } return [{ urls: 'stun:stun.l.google.com:19302' }]; })();
const STRIKE_LIMIT = Number(process.env.STRIKE_LIMIT) || 3;   // при толкова наказания се препоръчва дерегистрация

const { GOALS, SUSPEND_DAYS, INTERESTS, GENDERS, LOOKING, MIN_AGE, MAX_PHOTOS, REPORT_REASONS } = require('./constants');

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
const badc = (res, msg, status, code, extra = {}) => res.status(status).json({ error: msg, code, ...extra });

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
// Населено място на профил: етикет за показване + код на областта и общината.
function placeFields(r) {
  const d = places.describe(places.BY_ID.get(r.place_id));
  return d
    ? { city: d.label, placeId: d.id, region: d.region, regionName: d.regionName, obshtina: d.obshtina }
    : { city: r.city, placeId: '', region: '', regionName: '', obshtina: '' };
}
const LOC_VERIFY_DAYS = 30, LOC_VERIFY_KM = 30, PLACE_CHANGE_DAYS = 7;
const locVerified = r => !!r.loc_verified_at && Date.now() - Date.parse(r.loc_verified_at.replace(' ', 'T') + 'Z') < LOC_VERIFY_DAYS * 864e5;
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
  const vrow = db.prepare('SELECT place_id, hide_distance FROM users WHERE id = ?').get(viewerId) || {};
  const vc = vrow.hide_distance ? null : places.coordsOf(vrow.place_id);
  return rows.map(r => ({
    id: r.id,
    nickname: r.nickname,
    age: ageFrom(r.birth_date),
    gender: r.gender,
    lookingFor: r.looking_for,
    ...placeFields(r),
    bio: r.bio,
    interests: ints.get(r.id),
    photos: photos.get(r.id),
    goal: r.goal || '',
    goalLabel: GOALS[r.goal] || '',
    isDemo: !!r.is_demo,
    online: isOnline(r.last_seen),
    liked: liked.has(r.id),
    likedMe: likedMe.has(r.id),
    likes: counts.get(r.id) || 0,
    isMe: r.id === viewerId,
    // Разстоянието е между центровете на населените места и е закръглено; скрито е, ако някой от двамата е изключил това.
    distanceKm: r.id === viewerId || r.hide_distance || !vc ? null : places.distanceBucket(places.distanceKm(vc, places.coordsOf(r.place_id))),
    locVerified: locVerified(r),
  }));
}
const penaltyView = p => !p ? null : ({ id: p.id, kind: p.kind, reason: p.reason, days: p.days, at: iso(p.created_at), until: p.ends_at ? iso(p.ends_at) : null,
  appealStatus: p.appeal_status, appealText: p.appeal_text, appealNote: p.appeal_note });
// Колко е попълнен профилът (за малкия индикатор „Профил 70%“).
function completenessOf(r, photos, interests) {
  const steps = [
    ['photo', 'Добави основна снимка', 25, photos >= 1],
    ['photos3', 'Добави поне 3 снимки', 15, photos >= 3],
    ['bio', 'Напиши био (поне 40 символа)', 20, (r.bio || '').length >= 40],
    ['interests', 'Избери поне 3 интереса', 15, interests >= 3],
    ['goal', 'Кажи какво търсиш', 10, !!r.goal],
    ['email', 'Потвърди имейла си', 15, !!r.email_verified_at],
  ];
  return { pct: steps.reduce((n, x) => n + (x[3] ? x[2] : 0), 0), steps: steps.map(([key, label, points, done]) => ({ key, label, points, done })) };
}
function meOf(id) {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!r) return null;
  const p = publicProfiles([r], id)[0];
  let theme = null;
  try { theme = r.theme ? JSON.parse(r.theme) : null; } catch { /* повреден JSON → игнорира се */ }
  const susp = activeSuspension(id);
  // Последно непотвърдено предупреждение, или суспензия с нерешено/решено обжалване – показва се на потребителя.
  const warn = db.prepare("SELECT * FROM penalties WHERE user_id = ? AND kind = 'warning' AND acked_at IS NULL AND lifted_at IS NULL ORDER BY id DESC LIMIT 1").get(id);
  return { ...p, username: r.username, birthDate: r.birth_date, theme, role: r.role,
    email: r.email || '', emailMasked: emailutil.maskEmail(r.email), emailVerified: !!r.email_verified_at,
    paused: !!r.paused, hideVisits: !!r.hide_visits, hideDistance: !!r.hide_distance, live: liveStatus(id),
    placeChangeAt: r.place_changed_at ? new Date(Date.parse(r.place_changed_at.replace(' ', 'T') + 'Z') + PLACE_CHANGE_DAYS * 864e5).toISOString() : null,
    suspension: penaltyView(susp), warning: penaltyView(warn),
    completeness: completenessOf(r, p.photos.length, p.interests.length) };
}

// ── Auth middleware ──
const touch = db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?");
// Три нива на достъп:
//  requireAny    – само вход (потвърждаване на имейл, настройки на акаунта)
//  requireAuth   – вход + потвърден имейл (по подразбиране)
//  requireActive – + без активна суспензия (за всичко, което „пише“: съобщения, харесвания, снимки, доклади)
const bgDate = new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sofia' });
const fmtBg = t => bgDate.format(new Date(t.replace(' ', 'T') + 'Z'));
function activeSuspension(uid) {
  return db.prepare("SELECT * FROM penalties WHERE user_id = ? AND kind = 'suspension' AND lifted_at IS NULL AND ends_at > datetime('now') ORDER BY ends_at DESC LIMIT 1").get(uid);
}
function sessionUser(req, res) {
  const id = req.session.userId;
  if (!id) { bad(res, 'Трябва да влезете в профила си.', 401); return null; }
  const u = db.prepare('SELECT id, role, email_verified_at FROM users WHERE id = ?').get(id);
  if (!u) { req.session.destroy(() => bad(res, 'Сесията е невалидна.', 401)); return null; }
  const now = Date.now();
  if (!req.session.touched || now - req.session.touched > 60000) { req.session.touched = now; touch.run(id); }
  return u;
}
function requireAny(req, res, next) { if (sessionUser(req, res)) next(); }
function requireAuth(req, res, next) {
  const u = sessionUser(req, res);
  if (!u) return;
  if (!u.email_verified_at) return badc(res, 'Потвърди имейла си, за да продължиш.', 403, 'email_unverified');
  next();
}
function requireActive(req, res, next) {
  requireAuth(req, res, () => {
    const s = activeSuspension(req.session.userId);
    if (s) return badc(res, `Профилът ти е временно спрян до ${fmtBg(s.ends_at)}. Причина: ${s.reason}`, 403, 'suspended', { until: iso(s.ends_at), penaltyId: s.id });
    next();
  });
}
// Кой се вижда в търсенето: потвърден имейл, непаузиран, без активна суспензия.
const VISIBLE_SQL = `u.paused = 0 AND u.email_verified_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM penalties pn WHERE pn.user_id = u.id AND pn.kind = 'suspension' AND pn.lifted_at IS NULL AND pn.ends_at > datetime('now'))`;

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
    db.prepare(`SELECT region, COUNT(*) c FROM users u WHERE u.role <> 'admin' AND ${VISIBLE_SQL} GROUP BY region`).all().map(r => [r.region, r.c])
  );
  res.json({
    regions: places.REGIONS.map(r => ({ code: r.code, name: r.name, count: counts.get(r.code) || 0 })),
    interests: INTERESTS,
    minAge: MIN_AGE,
    maxPhotos: MAX_PHOTOS,
    total: db.prepare(`SELECT COUNT(*) c FROM users u WHERE u.role <> 'admin' AND ${VISIBLE_SQL}`).get().c,
    demoAdmin: demoAdminOn(),
    reportReasons: REPORT_REASONS,
    goals: GOALS,
    mailDev: mailer.mode === 'dev',
    iceServers: ICE_SERVERS,
  });
});

// Населени места в област (за избор при регистрация и в „Открий хора“).
// ?populated=1 → само местата с хора, подредени по брой; иначе се търси по ?q (градовете са преди селата).
app.get('/api/places', wrap((req, res) => {
  const region = String(req.query.region || '');
  if (!places.REGION_BY_CODE.has(region)) return bad(res, 'Изберете област.');
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const counts = new Map(db.prepare(`SELECT place_id, COUNT(*) c FROM users u WHERE u.region = ? AND u.role <> 'admin' AND ${VISIBLE_SQL} GROUP BY place_id`).all(region).map(r => [r.place_id, r.c]));
  let list;
  if (req.query.populated === '1') {
    list = [...counts.keys()].map(id => places.BY_ID.get(id)).filter(Boolean)
      .sort((a, b) => counts.get(b.id) - counts.get(a.id) || a.name.localeCompare(b.name, 'bg'));
  } else {
    list = places.search(region, req.query.q, limit);
  }
  res.json({ places: list.slice(0, limit).map(p => ({ ...places.describe(p), count: counts.get(p.id) || 0 })), total: list.length });
}));

// Регистрации: най-много 10 на час от един адрес (срещу автоматични регистрации).
const regLog = new Map();
function regAllowed(ip) {
  const now = Date.now(), arr = (regLog.get(ip) || []).filter(t => now - t < 3600e3);
  if (arr.length >= (Number(process.env.REG_PER_HOUR) || 10)) { regLog.set(ip, arr); return false; }
  arr.push(now); regLog.set(ip, arr); return true;
}
// Нов 6-цифрен код (15 мин валидност). В dev режим кодът се връща на интерфейса, иначе се изпраща по имейл.
function issueCode(userId, email) {
  const code = emailutil.newCode();
  db.prepare(`INSERT INTO email_verifications (user_id, code_hash, expires_at, attempts, sent_at, hour_start, hour_count)
    VALUES (?, ?, datetime('now', '+15 minutes'), 0, datetime('now'), datetime('now'), 1)
    ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = datetime('now'),
      hour_count = CASE WHEN hour_start < datetime('now', '-1 hour') THEN 1 ELSE hour_count + 1 END,
      hour_start = CASE WHEN hour_start < datetime('now', '-1 hour') THEN datetime('now') ELSE hour_start END`).run(userId, emailutil.codeHash(code, userId));
  mailer.send({ to: email, subject: 'Spark: код за потвърждение', text: `Твоят код за потвърждение е: ${code}\n\nВалиден е 15 минути. Ако не си се регистрирал в Spark, просто игнорирай това писмо.` });
  return mailer.mode === 'dev' ? { mode: 'dev', devCode: code } : { mode: 'smtp' };
}
// Проверка на имейл при регистрация и смяна: валиден, неедноразов, незабранен и неизползван.
function checkEmail(raw, exceptUserId) {
  const pe = emailutil.parseEmail(raw);
  if (!pe.ok) return { err: pe.reason === 'disposable' ? 'Не се приемат временни имейл адреси. Използвай личен имейл.' : 'Въведи валиден имейл адрес.', status: 400 };
  if (db.prepare('SELECT 1 FROM banned_emails WHERE hash = ?').get(emailutil.emailHash(pe.key))) return { err: 'Този имейл не може да се използва за регистрация.', status: 403 };
  const taken = db.prepare('SELECT id FROM users WHERE email_key = ?').get(pe.key);
  if (taken && taken.id !== exceptUserId) return { err: 'Този имейл вече е регистриран.', status: 409 };
  return { pe };
}

app.post('/api/register', wrap((req, res) => {
  const b = req.body || {};
  if (b.website) return bad(res, 'Невалидна заявка.');                   // honeypot: скритото поле се попълва само от ботове
  if (!regAllowed(req.ip)) return bad(res, 'Твърде много регистрации от този адрес. Опитайте по-късно.', 429);
  const username = String(b.username || '').trim();
  const nickname = String(b.nickname || '').trim().replace(/\s+/g, ' ');
  const password = String(b.password || '');
  if (!USER_RE.test(username)) return bad(res, 'Потребителското име трябва да е 3–30 символа: латински букви, цифри, . _ -');
  if (!NICK_RE.test(nickname)) return bad(res, 'Никнеймът трябва да е 3–20 символа (букви, цифри, интервал, . _ -).');
  const em = checkEmail(b.email);
  if (em.err) return bad(res, em.err, em.status);
  if (password.length < 8) return bad(res, 'Паролата трябва да е поне 8 символа.');
  if (Buffer.byteLength(password) > 72) return bad(res, 'Паролата е твърде дълга (макс. 72 байта).');
  if (!validBirth(b.birthDate)) return bad(res, 'Невалидна дата на раждане.');
  const age = ageFrom(b.birthDate);
  if (age < MIN_AGE) return bad(res, `Сайтът е само за пълнолетни (${MIN_AGE}+).`);
  if (age > 99) return bad(res, 'Невалидна дата на раждане.');
  if (!GENDERS.includes(b.gender)) return bad(res, 'Изберете пол.');
  const looking = LOOKING.includes(b.lookingFor) ? b.lookingFor : 'any';
  const place = places.BY_ID.get(String(b.placeId || ''));
  if (!place) return bad(res, 'Изберете област и населено място от списъка.');

  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'Това потребителско име е заето.', 409);
  if (db.prepare('SELECT 1 FROM deregistered WHERE username_key = ?').get(username.toLowerCase())) return bad(res, 'Това потребителско име не е достъпно.', 409);
  if (db.prepare('SELECT 1 FROM users WHERE nickname_key = ?').get(nickKey(nickname))) return bad(res, 'Този никнейм е зает.', 409);

  const id = db.prepare(
    'INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, email, email_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(username, bcrypt.hashSync(password, 10), nickname, nickKey(nickname), b.birthDate, b.gender, looking, place.label, place.id, place.region, em.pe.email, em.pe.key).lastInsertRowid;
  const mail = issueCode(id, em.pe.email);

  req.session.regenerate(err => {
    if (err) return bad(res, 'Грешка при създаване на сесия.', 500);
    req.session.userId = id;
    res.status(201).json({ user: meOf(id), mail });
  });
}));

// ── Потвърждаване на имейл ──
app.post('/api/verify/email', requireAny, wrap((req, res) => {
  const id = req.session.userId, code = String((req.body || {}).code || '').replace(/\s/g, '');
  const me = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(id);
  if (me.email_verified_at) return res.json({ user: meOf(id) });
  const v = db.prepare("SELECT *, expires_at < datetime('now') AS expired FROM email_verifications WHERE user_id = ?").get(id);
  if (!v) return bad(res, 'Няма изпратен код. Поискай нов.', 400);
  if (v.expired) return badc(res, 'Кодът е изтекъл. Поискай нов.', 400, 'code_expired');
  if (v.attempts >= 5) return badc(res, 'Твърде много грешни опити. Поискай нов код.', 429, 'too_many_attempts');
  if (!/^\d{6}$/.test(code) || !emailutil.safeEqual(emailutil.codeHash(code, id), v.code_hash)) {
    db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = ?').run(id);
    return bad(res, `Грешен код. Остават ${Math.max(0, 4 - v.attempts)} опита.`, 400);
  }
  db.transaction(() => {
    db.prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?").run(id);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(id);
  })();
  res.json({ user: meOf(id) });
}));

function resendLimits(id) {
  const v = db.prepare(`SELECT *, CAST((julianday('now') - julianday(sent_at)) * 86400 AS INTEGER) AS since,
    hour_start >= datetime('now', '-1 hour') AS in_hour FROM email_verifications WHERE user_id = ?`).get(id);
  if (!v) return null;
  if (v.since < 60) return { wait: 60 - v.since };
  if (v.in_hour && v.hour_count >= 5) return { wait: 3600 };
  return null;
}
app.post('/api/verify/resend', requireAny, wrap((req, res) => {
  const id = req.session.userId, u = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(id);
  if (u.email_verified_at) return bad(res, 'Имейлът вече е потвърден.');
  if (!u.email) return bad(res, 'Няма имейл за потвърждение.');
  const lim = resendLimits(id);
  if (lim) return badc(res, lim.wait >= 3600 ? 'Достигнахте лимита за кодове. Опитайте след час.' : `Изчакай ${lim.wait} сек. преди нов код.`, 429, 'wait', { retryAfter: lim.wait });
  res.json({ mail: issueCode(id, u.email) });
}));
// Сгрешен имейл при регистрация: сменя се само докато не е потвърден, и с паролата.
app.post('/api/verify/change-email', requireAny, wrap((req, res) => {
  const id = req.session.userId, b = req.body || {};
  const u = db.prepare('SELECT password_hash, email_verified_at FROM users WHERE id = ?').get(id);
  if (u.email_verified_at) return bad(res, 'Имейлът вече е потвърден.');
  if (typeof b.password !== 'string' || !bcrypt.compareSync(b.password, u.password_hash)) return bad(res, 'Паролата е грешна.', 403);
  const em = checkEmail(b.email, id);
  if (em.err) return bad(res, em.err, em.status);
  const lim = resendLimits(id);
  if (lim) return badc(res, `Изчакай ${Math.min(lim.wait, 3600)} сек. преди нов код.`, 429, 'wait', { retryAfter: lim.wait });
  db.prepare('UPDATE users SET email = ?, email_key = ? WHERE id = ?').run(em.pe.email, em.pe.key, id);
  res.json({ user: meOf(id), mail: issueCode(id, em.pe.email) });
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
  if (!ok) {
    if (!row && db.prepare('SELECT 1 FROM deregistered WHERE username_key = ?').get(username.trim().toLowerCase())) {
      return badc(res, 'Този профил е дерегистриран заради нарушение на правилата на сайта.', 403, 'deregistered');
    }
    noteFail(key); return bad(res, 'Грешно потребителско име или парола.', 401);
  }
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
app.put('/api/me', requireActive, wrap((req, res) => {
  const b = req.body || {};
  const id = req.session.userId;
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const next = { ...cur };
  let placeChanged = false;

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
  if (b.placeId !== undefined) {
    const place = places.BY_ID.get(String(b.placeId));
    if (!place) return bad(res, 'Изберете област и населено място от списъка.');
    if (place.id !== cur.place_id) {
      // Смяната на населеното място е ограничена (веднъж на 7 дни), за да не се „скача“ между градове и да се следи човек.
      if (cur.place_changed_at && Date.now() - Date.parse(cur.place_changed_at.replace(' ', 'T') + 'Z') < PLACE_CHANGE_DAYS * 864e5)
        return bad(res, `Населеното място може да се сменя веднъж на ${PLACE_CHANGE_DAYS} дни.`, 429);
      next.city = place.label; next.place_id = place.id; next.region = place.region; placeChanged = true;
    }
  }
  if (b.goal !== undefined) {
    if (b.goal !== '' && !GOALS[b.goal]) return bad(res, 'Невалидна стойност за „Какво търся“.');
    next.goal = b.goal;
  }
  if (b.bio !== undefined) {
    const bio = String(b.bio).trim();
    if (bio.length > 600) return bad(res, 'Биото може да е до 600 символа.');
    next.bio = bio;
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET nickname=?, nickname_key=?, gender=?, looking_for=?, city=?, place_id=?, region=?, bio=?, goal=? WHERE id=?')
      .run(next.nickname, nickKey(next.nickname), next.gender, next.looking_for, next.city, next.place_id, next.region, next.bio, next.goal, id);
    if (placeChanged) db.prepare("UPDATE users SET place_changed_at = datetime('now'), loc_verified_at = NULL WHERE id = ?").run(id);
    if (b.interests !== undefined) {
      db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(id);
      const ins = db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)');
      cleanInterests(b.interests).forEach(x => ins.run(id, x));
    }
  })();
  res.json({ user: meOf(id) });
}));

app.put('/api/me/settings', requireAuth, wrap((req, res) => {
  const b = req.body || {}, id = req.session.userId;
  if (b.paused !== undefined) db.prepare('UPDATE users SET paused = ? WHERE id = ?').run(b.paused ? 1 : 0, id);
  if (b.hideVisits !== undefined) db.prepare('UPDATE users SET hide_visits = ? WHERE id = ?').run(b.hideVisits ? 1 : 0, id);
  if (b.hideDistance !== undefined) db.prepare('UPDATE users SET hide_distance = ? WHERE id = ?').run(b.hideDistance ? 1 : 0, id);
  res.json({ user: meOf(id) });
}));

// Проверка на местоположението: браузърът праща GPS координати, сървърът ги сравнява с избраното населено място
// и ги ИЗХВЪРЛЯ – пази се само дали проверката е минала и кога. Не е доказателство (GPS може да се имитира), а възпиращ знак.
app.post('/api/me/location/verify', requireActive, wrap((req, res) => {
  const id = req.session.userId, key = 'loc:' + id;
  if (tooMany(key)) return bad(res, 'Твърде много опити. Опитайте по-късно.', 429);
  const lat = Number(req.body && req.body.lat), lng = Number(req.body && req.body.lng), acc = Number(req.body && req.body.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return bad(res, 'Невалидно местоположение.');
  if (Number.isFinite(acc) && acc > 5000) return bad(res, 'Сигналът е твърде неточен. Опитайте на открито или с включен GPS.');
  const me = db.prepare('SELECT place_id FROM users WHERE id = ?').get(id);
  const home = places.coordsOf(me.place_id);
  if (!home) return bad(res, 'Няма координати за избраното населено място.');
  const km = places.distanceKm([lat, lng], home);
  if (km > LOC_VERIFY_KM) {
    noteFail(key);
    return bad(res, `Изглежда си на около ${Math.round(km / 5) * 5} км от избраното населено място. Сменете мястото в профила или опитайте отново от там.`, 409);
  }
  db.prepare("UPDATE users SET loc_verified_at = datetime('now') WHERE id = ?").run(id);
  res.json({ user: meOf(id) });
}));

app.put('/api/me/password', requireAny, wrap((req, res) => {
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
app.put('/api/me/theme', requireAny, wrap((req, res) => {
  const theme = cleanTheme(req.body && req.body.theme);
  db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme ? JSON.stringify(theme) : null, req.session.userId);
  res.json({ theme });
}));

// Пълно изтриване на акаунт: разговори и файлове, снимки, сесии. Доказателствата в доклади остават.
function eraseUser(id) {
  const photoFiles = db.prepare('SELECT filename FROM photos WHERE user_id = ?').all(id);
  cleanupBeforeUserDelete(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  repairGroups();
  db.prepare("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?").run(id);
  photoFiles.forEach(f => fs.rm(path.join(db.UPLOAD_DIR, f.filename), { force: true }, () => {}));
}
app.delete('/api/me', requireAny, wrap((req, res) => {
  const id = req.session.userId;
  const { password } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  if (typeof password !== 'string' || !bcrypt.compareSync(password, row.password_hash)) {
    return bad(res, 'Паролата е грешна.', 403);
  }
  eraseUser(id);
  req.session.destroy(() => { res.clearCookie('spark.sid'); res.json({ ok: true }); });
}));

// ── Снимки ──
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
app.post('/api/me/photos', requireActive, bigJson, wrap((req, res) => {
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

app.delete('/api/me/photos/:pid', requireActive, wrap((req, res) => {
  const id = req.session.userId;
  const row = db.prepare('SELECT id, filename FROM photos WHERE id = ? AND user_id = ?').get(Number(req.params.pid), id);
  if (!row) return bad(res, 'Снимката не е намерена.', 404);
  db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);
  fs.rm(path.join(db.UPLOAD_DIR, row.filename), { force: true }, () => {});
  res.json({ user: meOf(id) });
}));

app.put('/api/me/photos/:pid/main', requireActive, wrap((req, res) => {
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
  const where = ['u.id <> ?', "u.role <> 'admin'", VISIBLE_SQL,
    'NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))'];
  const args = [req.session.userId, req.session.userId, req.session.userId];

  if (q.region) {
    if (!places.REGION_BY_CODE.has(q.region)) return bad(res, 'Непозната област.');
    where.push('u.region = ?'); args.push(q.region);
  }
  if (q.place) {
    if (!places.BY_ID.has(q.place)) return bad(res, 'Непознато населено място.');
    where.push('u.place_id = ?'); args.push(q.place);
  }
  if (q.gender) {
    if (!GENDERS.includes(q.gender)) return bad(res, 'Невалиден пол.');
    where.push('u.gender = ?'); args.push(q.gender);
  }
  const aMin = q.ageMin ? Math.max(MIN_AGE, parseInt(q.ageMin, 10) || MIN_AGE) : null;
  const aMax = q.ageMax ? Math.min(99, parseInt(q.ageMax, 10) || 99) : null;
  if (aMin) { where.push('u.birth_date <= ?'); args.push(dateYearsAgo(aMin)); }
  if (aMax) { where.push('u.birth_date > ?'); args.push(dateYearsAgo(aMax + 1)); }
  if (q.goal) {
    if (!GOALS[q.goal]) return bad(res, 'Непозната цел.');
    where.push('u.goal = ?'); args.push(q.goal);
  }
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
  const limit = Math.min(48, Math.max(1, parseInt(q.limit, 10) || 12));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);

  const order = SORTS[q.sort] || SORTS.active;
  const sqlWhere = 'WHERE ' + where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) c FROM users u ${sqlWhere}`).get(...args).c;
  const rows = db.prepare(`SELECT u.* FROM users u ${sqlWhere} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ total, offset, profiles: publicProfiles(rows, req.session.userId) });
}));

app.get('/api/profiles/:id', requireAuth, wrap((req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ? AND role <> 'admin'").get(Number(req.params.id));
  if (!row || blockedBetween(req.session.userId, row.id)) return bad(res, 'Профилът не е намерен.', 404);
  const me = req.session.userId;
  // Посещението се записва (веднъж на ден), освен ако посетителят не е изключил това в настройките си.
  if (row.id !== me && !db.prepare('SELECT hide_visits FROM users WHERE id = ?').get(me).hide_visits) {
    db.prepare("INSERT OR IGNORE INTO visits (visitor_id, visited_id, day) VALUES (?, ?, date('now'))").run(me, row.id);
  }
  res.json({ profile: publicProfiles([row], me)[0] });
}));

// Активност: кой те е харесал, взаимни харесвания и кой е гледал профила ти (последните 30 дни).
app.get('/api/activity', requireAuth, wrap((req, res) => {
  const me = req.session.userId;
  const ok = `u.role <> 'admin' AND ${VISIBLE_SQL} AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))`;
  const liked = db.prepare(`SELECT u.*, l.created_at AS at FROM likes l JOIN users u ON u.id = l.from_id WHERE l.to_id = ? AND ${ok} ORDER BY l.created_at DESC LIMIT 60`).all(me, me, me);
  const mine = new Set(db.prepare('SELECT to_id FROM likes WHERE from_id = ?').all(me).map(r => r.to_id));
  const visitors = db.prepare(`SELECT u.*, MAX(v.day) AS at FROM visits v JOIN users u ON u.id = v.visitor_id
    WHERE v.visited_id = ? AND v.day >= date('now', '-30 days') AND ${ok} GROUP BY u.id ORDER BY at DESC LIMIT 60`).all(me, me, me);
  const withAt = rows => { const ps = publicProfiles(rows, me); return ps.map((p, i) => ({ ...p, at: rows[i].at })); };
  const all = withAt(liked);
  res.json({ likedMe: all.filter(p => !mine.has(p.id)), mutual: all.filter(p => mine.has(p.id)), visitors: withAt(visitors) });
}));

app.post('/api/profiles/:id/like', requireActive, wrap((req, res) => {
  const to = Number(req.params.id), from = req.session.userId;
  if (to === from) return bad(res, 'Не можете да харесате себе си.');
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role <> 'admin'").get(to) || blockedBetween(from, to)) return bad(res, 'Профилът не е намерен.', 404);
  const had = db.prepare('DELETE FROM likes WHERE from_id = ? AND to_id = ?').run(from, to).changes > 0;
  if (!had) db.prepare('INSERT INTO likes (from_id, to_id) VALUES (?, ?)').run(from, to);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(to);
  res.json({ profile: publicProfiles([row], from)[0] });
}));

// ── Разговори (лични и групови), прикачени файлове, блокиране, доклади ──
const MAX_GROUP = 12;
const MAX_FILE = 10 * 1024 * 1024;
const isBlockedStmt = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)');
function blockedBetween(a, b) { return !!isBlockedStmt.get(a, b, b, a); }
const iso = t => t.replace(' ', 'T') + 'Z';
const findPeer = id => db.prepare("SELECT * FROM users WHERE id = ? AND role <> 'admin'").get(id);
const memberRow = (cid, uid) => db.prepare('SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(cid, uid);
const convRow = cid => db.prepare('SELECT * FROM conversations WHERE id = ?').get(cid);
const membersOf = cid => db.prepare('SELECT m.*, u.* , m.role AS mrole FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY m.joined_at, m.user_id').all(cid);
const lastMsgId = cid => db.prepare('SELECT COALESCE(MAX(id), 0) x FROM messages WHERE conversation_id = ?').get(cid).x;
const directKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// Най-много 20 съобщения/файла в минута на потребител.
const sendLog = new Map();
function canSend(uid) {
  const now = Date.now();
  const arr = (sendLog.get(uid) || []).filter(t => now - t < 60000);
  if (arr.length >= 20) { sendLog.set(uid, arr); return false; }
  arr.push(now); sendLog.set(uid, arr); return true;
}

function getOrCreateDirect(a, b) {
  const key = directKey(a, b);
  const ex = db.prepare('SELECT id FROM conversations WHERE direct_key = ?').get(key);
  if (ex) { // ако някой е бил изтрит/излязъл – връщаме го като член
    db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(ex.id, a);
    db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(ex.id, b);
    return ex.id;
  }
  return db.transaction(() => {
    const id = db.prepare("INSERT INTO conversations (kind, direct_key, created_by) VALUES ('direct', ?, ?)").run(key, a).lastInsertRowid;
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, a);
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, b);
    return id;
  })();
}
// Другият член на личен разговор (или null, ако го няма/е блокиран).
function directPeer(cid, me) {
  const o = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?').get(cid, me);
  const u = o && findPeer(o.user_id);
  return u && !blockedBetween(me, u.id) ? u : null;
}
function addSystem(cid, actorId, text) {
  return db.prepare("INSERT INTO messages (conversation_id, sender_id, kind, body) VALUES (?, ?, 'system', ?)").run(cid, actorId, text).lastInsertRowid;
}

// ── Прикачени файлове ──
const BLOCKED_EXT = new Set(['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'ps1', 'vbs', 'js', 'mjs', 'jar', 'sh', 'app', 'apk', 'dll', 'lnk', 'html', 'htm', 'xhtml', 'svg', 'hta', 'reg']);
function sniffAny(buf) {
  const img = sniff(buf);
  if (img) return img;
  if (buf.length > 6 && buf.subarray(0, 4).toString() === 'GIF8') return 'gif';
  return null;
}
const IMG_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const cleanName = raw => {
  let n = '';
  try { n = decodeURIComponent(String(raw || '')); } catch { n = String(raw || ''); }
  n = n.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(-120);
  return n || 'файл';
};
const attView = a => a && { id: a.id, name: a.name, size: a.size, kind: a.kind, variant: a.variant || '', url: '/api/files/' + a.id };
const attById = id => (id ? db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) : null);
const dropFile = stored => fs.rm(path.join(db.UPLOAD_DIR, stored), { force: true }, () => {});

// Качените, но неизпратени файлове се трият след 1 час.
function purgeOrphans() {
  const rows = db.prepare("SELECT id, stored FROM attachments WHERE message_id IS NULL AND created_at < datetime('now', '-1 hour')").all();
  rows.forEach(r => { db.prepare('DELETE FROM attachments WHERE id = ?').run(r.id); dropFile(r.stored); });
}
purgeOrphans();
setInterval(purgeOrphans, 30 * 60 * 1000).unref();

// Изтрива файловете на разговори/потребител, освен тези, които са доказателство в доклад.
function dropUnreferencedFiles(rows) {
  for (const r of rows) {
    if (db.prepare('SELECT 1 FROM report_messages WHERE attachment_id = ?').get(r.id)) continue;
    db.prepare('DELETE FROM attachments WHERE id = ?').run(r.id); dropFile(r.stored);
  }
}
// Преди изтриване на акаунт: личните разговори, останали без втори човек, се чистят заедно с файловете им.
function cleanupBeforeUserDelete(uid) {
  const direct = db.prepare("SELECT c.id FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id WHERE c.kind = 'direct' AND m.user_id = ?").all(uid);
  const files = [];
  for (const c of direct) {
    files.push(...db.prepare('SELECT a.* FROM attachments a JOIN messages m ON m.attachment_id = a.id WHERE m.conversation_id = ?').all(c.id));
    db.prepare('DELETE FROM conversations WHERE id = ?').run(c.id); // съобщенията се трият по каскада
  }
  files.push(...db.prepare('SELECT * FROM attachments WHERE uploader_id = ? AND message_id IS NULL').all(uid));
  dropUnreferencedFiles(files);
  db.prepare('SELECT stored FROM stickers WHERE owner_id = ?').all(uid).forEach(r => dropFile(r.stored));
}

// След изтриване на акаунт: групи без собственик получават нов (най-стария член), празните групи се трият.
function repairGroups() {
  for (const g of db.prepare("SELECT id FROM conversations WHERE kind = 'group'").all()) {
    const ms = membersOf(g.id);
    if (!ms.length) {
      const files = db.prepare('SELECT a.* FROM attachments a JOIN messages m ON m.attachment_id = a.id WHERE m.conversation_id = ?').all(g.id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(g.id); dropUnreferencedFiles(files);
    } else if (!ms.some(m => m.mrole === 'owner')) {
      db.prepare("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?").run(g.id, ms[0].user_id);
    }
  }
}

app.post('/api/chats/:id/attachments', requireActive, express.raw({ type: () => true, limit: MAX_FILE + 1024 }), wrap((req, res) => {
  const me = req.session.userId, cid = Number(req.params.id);
  if (!memberRow(cid, me)) return bad(res, 'Разговорът не е намерен.', 404);
  const conv = convRow(cid);
  if (conv.kind === 'direct' && !directPeer(cid, me)) return bad(res, 'Не можете да пишете на този профил.', 403);
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!buf.length) return bad(res, 'Празен файл.');
  if (buf.length > MAX_FILE) return bad(res, 'Файлът е твърде голям (макс. 10 MB).', 413);
  const name = cleanName(req.get('x-filename'));
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (name.includes('.') && BLOCKED_EXT.has(ext)) return bad(res, `Файлове от тип .${ext} не са позволени.`, 400);
  if (!canSend(me)) return bad(res, 'Изпращате твърде бързо. Изчакайте малко.', 429);
  const imgType = sniffAny(buf);
  const stored = crypto.randomBytes(16).toString('hex') + (imgType ? '.' + imgType : '.bin');
  fs.writeFileSync(path.join(db.UPLOAD_DIR, stored), buf, { flag: 'wx' });
  const r = db.prepare('INSERT INTO attachments (uploader_id, name, mime, size, stored, kind) VALUES (?, ?, ?, ?, ?, ?)')
    .run(me, name, imgType ? IMG_MIME[imgType] : 'application/octet-stream', buf.length, stored, imgType ? 'image' : 'file');
  res.status(201).json({ attachment: attView(attById(r.lastInsertRowid)) });
}));

// ── Местоположение на живо ──
// Доброволно и временно: докато е включено, клиентът праща позицията си; другите виждат само ГРУБО разстояние
// (никога координати или посока), а човек вижда другите, само ако и той самият споделя. Спира се ръчно, след 3 часа
// или при липса на сигнал 5 минути; при спиране позицията се изтрива.
const LIVE_FRESH_S = 300, LIVE_MAX_S = 3 * 3600, LIVE_MIN_GAP_S = 4, LIVE_MAX_SPEED = 100; // м/с (360 км/ч)
const sqlAge = t => (Date.now() - Date.parse(String(t).replace(' ', 'T') + 'Z')) / 1000;
// Грубо разстояние в метри (покрито отгоре): най-малко 300 м, за да не може човек да бъде „триангулиран“.
function liveBucket(m) {
  if (m < 300) return 300;
  if (m < 500) return 500;
  if (m < 1000) return 1000;
  if (m < 10000) return Math.ceil(m / 1000) * 1000;
  if (m < 50000) return Math.round(m / 5000) * 5000;
  return Math.round(m / 10000) * 10000;
}
const liveRow = uid => db.prepare('SELECT * FROM live_locations WHERE user_id = ?').get(uid);
const liveActiveFor = uid => { const r = liveRow(uid); return r && sqlAge(r.updated_at) < LIVE_FRESH_S && sqlAge(r.started_at) < LIVE_MAX_S ? r : null; };
const liveStatus = uid => { const r = liveActiveFor(uid); return r ? { active: true, startedAt: iso(r.started_at), expiresAt: new Date(Date.parse(r.started_at.replace(' ', 'T') + 'Z') + LIVE_MAX_S * 1000).toISOString() } : { active: false }; };
app.get('/api/live', requireAuth, wrap((req, res) => res.json(liveStatus(req.session.userId))));
app.put('/api/live', requireActive, wrap((req, res) => {
  const id = req.session.userId, b = req.body || {};
  if (db.prepare('SELECT role FROM users WHERE id = ?').get(id).role === 'admin') return bad(res, 'Администраторският профил не споделя местоположение.', 403);
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return bad(res, 'Невалидно местоположение.');
  if (Number.isFinite(acc) && acc > 500) return bad(res, 'Сигналът е твърде неточен (над 500 м). Излез на открито или включи GPS.');
  const cur = liveRow(id);
  if (cur) {
    if (sqlAge(cur.started_at) >= LIVE_MAX_S) { db.prepare('DELETE FROM live_locations WHERE user_id = ?').run(id); return res.json({ active: false, expired: true }); }
    const dt = sqlAge(cur.updated_at);
    if (dt < LIVE_MIN_GAP_S) return res.json({ ...liveStatus(id), skipped: true });
    if (dt < LIVE_FRESH_S) {
      const d = places.distanceKm([cur.lat, cur.lng], [lat, lng]) * 1000;
      if (d / dt > LIVE_MAX_SPEED && d > 500) return bad(res, 'Позицията се променя невъзможно бързо – изглежда имитирана. Опитай отново.', 422);
    }
    db.prepare("UPDATE live_locations SET lat = ?, lng = ?, acc = ?, updated_at = datetime('now'), started_at = CASE WHEN ? >= ? THEN datetime('now') ELSE started_at END WHERE user_id = ?")
      .run(lat, lng, Number.isFinite(acc) ? acc : null, dt, LIVE_FRESH_S, id);
  } else {
    db.prepare('INSERT INTO live_locations (user_id, lat, lng, acc) VALUES (?, ?, ?, ?)').run(id, lat, lng, Number.isFinite(acc) ? acc : null);
  }
  res.json(liveStatus(id));
}));
app.delete('/api/live', requireAuth, wrap((req, res) => { db.prepare('DELETE FROM live_locations WHERE user_id = ?').run(req.session.userId); res.json({ active: false }); }));
const liveAsked = new Map();
app.get('/api/live/nearby', requireActive, wrap((req, res) => {
  const me = req.session.userId, mine = liveActiveFor(me);
  if (!mine) return bad(res, 'Включи местоположението си на живо, за да видиш кой е наблизо.', 409);
  const last = liveAsked.get(me) || 0;
  if (Date.now() - last < 2500) return bad(res, 'Твърде често. Изчакай малко.', 429);
  liveAsked.set(me, Date.now());
  db.prepare("DELETE FROM live_locations WHERE updated_at < datetime('now', '-1 hour')").run();
  const rows = db.prepare(`SELECT u.*, l.lat AS llat, l.lng AS llng, l.updated_at AS lat_at FROM live_locations l JOIN users u ON u.id = l.user_id
    WHERE l.user_id <> ? AND l.updated_at >= datetime('now', '-${LIVE_FRESH_S} seconds') AND u.role <> 'admin' AND ${VISIBLE_SQL}
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))`).all(me, me, me);
  const withD = rows.map(r => ({ r, m: places.distanceKm([mine.lat, mine.lng], [r.llat, r.llng]) * 1000 })).sort((a, b) => a.m - b.m).slice(0, 60);
  const profs = publicProfiles(withD.map(x => x.r), me);
  res.json({ total: withD.length, profiles: profs.map((p, i) => ({ ...p, liveM: liveBucket(withD[i].m), liveAgo: Math.round(sqlAge(withD[i].r.lat_at)) })) });
}));

// ── Лични стикери и икони ──
const MAX_STICKER = 400 * 1024, MAX_STICKERS = { sticker: 40, icon: 60 };
const stickerView = r => ({ id: r.id, kind: r.kind, url: '/api/stickers/' + r.id + '/img' });
app.get('/api/stickers', requireAuth, wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM stickers WHERE owner_id = ? ORDER BY id DESC').all(req.session.userId);
  res.json({ stickers: rows.filter(r => r.kind === 'sticker').map(stickerView), icons: rows.filter(r => r.kind === 'icon').map(stickerView), max: MAX_STICKERS });
}));
app.post('/api/stickers', requireActive, express.raw({ type: () => true, limit: MAX_STICKER + 1024 }), wrap((req, res) => {
  const me = req.session.userId, kind = req.get('x-kind');
  if (!MAX_STICKERS[kind]) return bad(res, 'Невалиден вид (стикер или икона).');
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!buf.length) return bad(res, 'Празен файл.');
  if (buf.length > MAX_STICKER) return bad(res, 'Изображението е твърде голямо (макс. 400 KB след смаляване).', 413);
  const type = sniffAny(buf);
  if (!type) return bad(res, 'Позволени са само снимки: JPG, PNG, WebP или GIF.');
  if (db.prepare('SELECT COUNT(*) c FROM stickers WHERE owner_id = ? AND kind = ?').get(me, kind).c >= MAX_STICKERS[kind])
    return bad(res, `Достигнат е лимитът от ${MAX_STICKERS[kind]} ${kind === 'icon' ? 'икони' : 'стикера'}. Изтрий някой.`, 409);
  const stored = crypto.randomBytes(16).toString('hex') + '.' + type;
  fs.writeFileSync(path.join(db.UPLOAD_DIR, stored), buf, { flag: 'wx' });
  const r = db.prepare('INSERT INTO stickers (owner_id, kind, mime, stored) VALUES (?, ?, ?, ?)').run(me, kind, IMG_MIME[type], stored);
  res.status(201).json({ sticker: stickerView(db.prepare('SELECT * FROM stickers WHERE id = ?').get(r.lastInsertRowid)) });
}));
app.get('/api/stickers/:id/img', requireAuth, wrap((req, res) => {
  const r = db.prepare('SELECT * FROM stickers WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.session.userId);
  if (!r) return bad(res, 'Не е намерен.', 404);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'");
  res.type(r.mime);
  fs.createReadStream(path.join(db.UPLOAD_DIR, r.stored)).on('error', () => res.destroy()).pipe(res);
}));
app.delete('/api/stickers/:id', requireAuth, wrap((req, res) => {
  const r = db.prepare('SELECT * FROM stickers WHERE id = ? AND owner_id = ?').get(Number(req.params.id), req.session.userId);
  if (!r) return bad(res, 'Не е намерен.', 404);
  db.prepare('DELETE FROM stickers WHERE id = ?').run(r.id); dropFile(r.stored);
  res.json({ ok: true });
}));

// Достъп до файл: качилият го, членовете на разговора, а администратор – само ако е доказателство в доклад.
app.get('/api/files/:id', requireAuth, wrap((req, res) => {
  const me = req.session.userId, a = attById(Number(req.params.id));
  if (!a) return bad(res, 'Файлът не е намерен.', 404);
  let ok = a.uploader_id === me;
  if (!ok && a.message_id) {
    const m = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(a.message_id);
    ok = !!(m && memberRow(m.conversation_id, me));
  }
  if (!ok) {
    const isAdmin = db.prepare('SELECT role FROM users WHERE id = ?').get(me).role === 'admin';
    ok = isAdmin && !!db.prepare('SELECT 1 FROM report_messages WHERE attachment_id = ?').get(a.id);
    if (ok) db.prepare("INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, 'view_file', NULL)").run(me);
  }
  if (!ok) return bad(res, 'Файлът не е намерен.', 404);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'");
  res.type(a.kind === 'image' ? a.mime : 'application/octet-stream');
  const encoded = encodeURIComponent(a.name).replace(/['()]/g, escape);
  res.setHeader('Content-Disposition', `${a.kind === 'image' ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`);
  fs.createReadStream(path.join(db.UPLOAD_DIR, a.stored)).on('error', () => res.destroy()).pipe(res);
}));

// ── Разговори ──
function unreadTotal(uid) {
  return db.prepare(`SELECT COUNT(*) c FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    WHERE m.id > cm.last_read_id AND m.id >= cm.from_msg_id AND m.kind = 'user' AND COALESCE(m.sender_id, 0) <> ?`).get(uid, uid).c;
}
app.get('/api/chats/unread', requireAuth, wrap((req, res) => {
  const id = req.session.userId;
  const isAdmin = db.prepare('SELECT role FROM users WHERE id = ?').get(id).role === 'admin';
  const cnt = sql => (isAdmin ? db.prepare(sql).get().c : 0);
  res.json({ unread: unreadTotal(id), openReports: cnt("SELECT COUNT(*) c FROM reports WHERE status = 'open'"), openAppeals: cnt("SELECT COUNT(*) c FROM penalties WHERE appeal_status = 'pending'") });
}));

// Хората, с които си писал (за нова група и за добавяне към група).
function contactsOf(me) {
  const rows = db.prepare(`SELECT DISTINCT o.user_id FROM conversation_members mine
    JOIN conversations c ON c.id = mine.conversation_id AND c.kind = 'direct'
    JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id <> mine.user_id
    WHERE mine.user_id = ? AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.kind = 'user')`).all(me);
  return rows.map(r => findPeer(r.user_id)).filter(u => u && !blockedBetween(me, u.id));
}
app.get('/api/chats/contacts', requireAuth, wrap((req, res) => {
  res.json({ contacts: publicProfiles(contactsOf(req.session.userId), req.session.userId) });
}));

function messageView(m, me, names) {
  return { id: m.id, kind: m.kind, senderId: m.sender_id, senderNick: m.sender_id ? (names.get(m.sender_id) || 'Изтрит профил') : '', mine: m.sender_id === me,
    body: m.body, at: iso(m.created_at), attachment: attView(attById(m.attachment_id)) };
}
function lastPreview(c, me, names) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(c.last_id);
  const text = m.body || (m.attachment_id ? (attById(m.attachment_id) || {}).variant ? '🏷️ Стикер' : (attById(m.attachment_id) || {}).kind === 'image' ? '📷 Снимка' : '📎 Файл' : '');
  return { body: text, mine: m.sender_id === me, senderNick: m.sender_id ? names.get(m.sender_id) || '' : '', system: m.kind === 'system', at: iso(m.created_at) };
}

app.get('/api/chats', requireAuth, wrap((req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT c.*, cm.last_read_id, cm.from_msg_id,
      (SELECT MAX(id) FROM messages m WHERE m.conversation_id = c.id AND m.id >= cm.from_msg_id) AS last_id,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.id > cm.last_read_id AND m.id >= cm.from_msg_id AND m.kind = 'user' AND COALESCE(m.sender_id, 0) <> cm.user_id) AS unread
    FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.user_id = ? ORDER BY COALESCE(last_id, 0) DESC, c.id DESC LIMIT 100`).all(me);
  const chats = [];
  for (const c of rows) {
    if (!c.last_id) continue; // празни разговори не се показват
    const members = membersOf(c.id);
    const names = new Map(members.map(m => [m.user_id, m.nickname]));
    if (c.kind === 'direct') {
      const peer = directPeer(c.id, me);
      if (!peer) continue;
      chats.push({ id: c.id, kind: 'direct', title: peer.nickname, peer: publicProfiles([peer], me)[0], unread: c.unread, last: lastPreview(c, me, names) });
    } else {
      chats.push({ id: c.id, kind: 'group', title: c.title, members: members.length, preview: members.slice(0, 3).map(m => ({ id: m.user_id, nickname: m.nickname })), unread: c.unread, last: lastPreview(c, me, names) });
    }
  }
  res.json({ chats });
}));

app.post('/api/chats/direct', requireAuth, wrap((req, res) => {
  const me = req.session.userId, id = Number((req.body || {}).userId);
  if (db.prepare('SELECT role FROM users WHERE id = ?').get(me).role === 'admin') return bad(res, 'Администраторът не води разговори.', 403);
  const peer = id === me ? null : findPeer(id);
  if (!peer || blockedBetween(me, id)) return bad(res, 'Не можете да пишете на този профил.', 403);
  res.json({ id: getOrCreateDirect(me, id) });
}));

function groupMemberIds(me, raw, existing = []) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== me))];
  const allowed = new Set(contactsOf(me).map(u => u.id));
  const bad_ = ids.filter(i => !allowed.has(i));
  return { ids: ids.filter(i => !existing.includes(i)), invalid: bad_.length > 0 };
}
const cleanTitle = t => String(t || '').trim().replace(/\s+/g, ' ');

app.post('/api/chats/groups', requireActive, wrap((req, res) => {
  const me = req.session.userId, b = req.body || {};
  if (db.prepare('SELECT role FROM users WHERE id = ?').get(me).role === 'admin') return bad(res, 'Администраторът не води разговори.', 403);
  const title = cleanTitle(b.title);
  if (title.length < 2 || title.length > 40) return bad(res, 'Името на групата трябва да е 2–40 символа.');
  const { ids, invalid } = groupMemberIds(me, b.memberIds);
  if (invalid) return bad(res, 'В група може да добавяш само хора, с които си писал.');
  if (!ids.length) return bad(res, 'Избери поне един човек за групата.');
  if (ids.length + 1 > MAX_GROUP) return bad(res, `В група има най-много ${MAX_GROUP} души.`);
  const nick = db.prepare('SELECT nickname FROM users WHERE id = ?').get(me).nickname;
  const cid = db.transaction(() => {
    const id = db.prepare("INSERT INTO conversations (kind, title, created_by) VALUES ('group', ?, ?)").run(title, me).lastInsertRowid;
    db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')").run(id, me);
    ids.forEach(u => db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, u));
    addSystem(id, me, `${nick} създаде групата „${title}“`);
    return id;
  })();
  res.status(201).json({ id: cid });
}));

function threadFor(cid, me) {
  const conv = convRow(cid), mine = memberRow(cid, me);
  const members = membersOf(cid);
  const names = new Map(members.map(m => [m.user_id, m.nickname]));
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id >= ? ORDER BY id DESC LIMIT 200').all(cid, mine.from_msg_id).reverse();
  const out = {
    messages: rows.map(m => messageView(m, me, names)),
    conversation: { id: conv.id, kind: conv.kind, title: conv.title, isOwner: mine.role === 'owner', createdAt: iso(conv.created_at) },
  };
  if (conv.kind === 'direct') {
    const peer = directPeer(cid, me);
    out.conversation.peer = peer ? publicProfiles([peer], me)[0] : null;
    out.conversation.title = peer ? peer.nickname : 'Недостъпен профил';
  } else {
    const profiles = publicProfiles(members.map(m => findPeer(m.user_id)).filter(Boolean), me);
    out.conversation.members = profiles.map(p => ({ ...p, role: (members.find(m => m.user_id === p.id) || {}).mrole }));
  }
  return out;
}

app.get('/api/chats/:id', requireAuth, wrap((req, res) => {
  const me = req.session.userId, cid = Number(req.params.id);
  if (!memberRow(cid, me)) return bad(res, 'Разговорът не е намерен.', 404);
  const conv = convRow(cid);
  if (conv.kind === 'direct' && !directPeer(cid, me)) return bad(res, 'Разговорът не е намерен.', 404);
  const t = threadFor(cid, me);
  db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(lastMsgId(cid), cid, me);
  res.json(t);
}));

app.post('/api/chats/:id/messages', requireActive, wrap((req, res) => {
  const me = req.session.userId, cid = Number(req.params.id), b = req.body || {};
  if (!memberRow(cid, me)) return bad(res, 'Разговорът не е намерен.', 404);
  const conv = convRow(cid);
  if (conv.kind === 'direct' && !directPeer(cid, me)) return bad(res, 'Не можете да пишете на този профил.', 403);
  const body = String(b.body || '').trim();
  if (body.length > 1000) return bad(res, 'Съобщението може да е до 1000 символа.');
  let att = null;
  if (b.attachmentId) {
    att = attById(Number(b.attachmentId));
    if (!att || att.uploader_id !== me || att.message_id) return bad(res, 'Файлът не е наличен. Качи го отново.');
  }
  if (b.stickerId && !att) {
    // Изпращане на личен стикер/икона: файлът се копира, за да остане в чата дори собственикът да го изтрие.
    const st = db.prepare('SELECT * FROM stickers WHERE id = ? AND owner_id = ?').get(Number(b.stickerId), me);
    if (!st) return bad(res, 'Стикерът не е намерен.', 404);
    if (!canSend(me)) return bad(res, 'Изпращате твърде бързо. Изчакайте малко.', 429);
    const ext = st.stored.split('.').pop(), stored = crypto.randomBytes(16).toString('hex') + '.' + ext;
    try { fs.copyFileSync(path.join(db.UPLOAD_DIR, st.stored), path.join(db.UPLOAD_DIR, stored), fs.constants.COPYFILE_EXCL); } catch { return bad(res, 'Стикерът не е наличен.', 404); }
    const size = fs.statSync(path.join(db.UPLOAD_DIR, stored)).size;
    const ar = db.prepare("INSERT INTO attachments (uploader_id, name, mime, size, stored, kind, variant) VALUES (?, ?, ?, ?, ?, 'image', ?)")
      .run(me, st.kind === 'icon' ? 'икона' : 'стикер', st.mime, size, stored, st.kind);
    att = attById(ar.lastInsertRowid);
  }
  if (!body && !att) return bad(res, 'Съобщението е празно.');
  if (!canSend(me)) return bad(res, 'Изпращате твърде бързо. Изчакайте малко.', 429);
  const mid = db.prepare("INSERT INTO messages (conversation_id, sender_id, body, attachment_id) VALUES (?, ?, ?, ?)").run(cid, me, body, att ? att.id : null).lastInsertRowid;
  if (att) db.prepare('UPDATE attachments SET message_id = ? WHERE id = ?').run(mid, att.id);
  const names = new Map([[me, db.prepare('SELECT nickname FROM users WHERE id = ?').get(me).nickname]]);
  res.status(201).json({ message: messageView(db.prepare('SELECT * FROM messages WHERE id = ?').get(mid), me, names) });
}));

// Управление на група: преименуване, добавяне и премахване на хора, напускане.
function groupOwnerOnly(req, res) {
  const me = req.session.userId, cid = Number(req.params.id);
  const mine = memberRow(cid, me), conv = convRow(cid);
  if (!mine || !conv || conv.kind !== 'group') { bad(res, 'Групата не е намерена.', 404); return null; }
  if (mine.role !== 'owner') { bad(res, 'Само създателят на групата може да прави това.', 403); return null; }
  return { me, cid, conv };
}
app.put('/api/chats/:id', requireActive, wrap((req, res) => {
  const g = groupOwnerOnly(req, res); if (!g) return;
  const title = cleanTitle((req.body || {}).title);
  if (title.length < 2 || title.length > 40) return bad(res, 'Името на групата трябва да е 2–40 символа.');
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, g.cid);
  addSystem(g.cid, g.me, `Групата беше преименувана на „${title}“`);
  res.json({ ok: true });
}));
app.post('/api/chats/:id/members', requireActive, wrap((req, res) => {
  const g = groupOwnerOnly(req, res); if (!g) return;
  const current = membersOf(g.cid).map(m => m.user_id);
  const { ids, invalid } = groupMemberIds(g.me, (req.body || {}).userIds, current);
  if (invalid) return bad(res, 'Може да добавяш само хора, с които си писал.');
  if (!ids.length) return bad(res, 'Няма кого да добавиш.');
  if (current.length + ids.length > MAX_GROUP) return bad(res, `В група има най-много ${MAX_GROUP} души.`);
  const actor = db.prepare('SELECT nickname FROM users WHERE id = ?').get(g.me).nickname;
  db.transaction(() => {
    for (const u of ids) {
      const nick = db.prepare('SELECT nickname FROM users WHERE id = ?').get(u).nickname;
      const sid = addSystem(g.cid, g.me, `${actor} добави ${nick}`);
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id, from_msg_id, last_read_id) VALUES (?, ?, ?, ?)').run(g.cid, u, sid, sid);
    }
  })();
  res.status(201).json({ ok: true });
}));
app.delete('/api/chats/:id/members/:uid', requireAuth, wrap((req, res) => {
  const me = req.session.userId, cid = Number(req.params.id), uid = Number(req.params.uid);
  const conv = convRow(cid), mine = memberRow(cid, me), target = memberRow(cid, uid);
  if (!conv || conv.kind !== 'group' || !mine || !target) return bad(res, 'Групата не е намерена.', 404);
  if (uid !== me && mine.role !== 'owner') return bad(res, 'Само създателят на групата може да премахва хора.', 403);
  const nick = db.prepare('SELECT nickname FROM users WHERE id = ?').get(uid).nickname;
  db.transaction(() => {
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(cid, uid);
    const left = membersOf(cid);
    if (!left.length) { // последният излиза → групата се трие
      const files = db.prepare('SELECT a.* FROM attachments a JOIN messages m ON m.attachment_id = a.id WHERE m.conversation_id = ?').all(cid);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(cid);
      dropUnreferencedFiles(files);
      return;
    }
    if (target.role === 'owner') db.prepare("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?").run(cid, left[0].user_id);
    addSystem(cid, me, uid === me ? `${nick} напусна групата` : `${nick} беше премахнат от групата`);
  })();
  res.json({ ok: true });
}));

// ── Гласови и видео обаждания ──
const RING_SECONDS = 45, STALE_SECONDS = 25;
const callLabel = c => (c.kind === 'video' ? 'Видео' : 'Гласово');
const fmtDur = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function logCall(c, text) { if (c.conversation_id && convRow(c.conversation_id)) addSystem(c.conversation_id, c.caller_id, text); }
// Затваря неотговорени и „зависнали“ обаждания (никой не се отчита повече от 25 сек.).
function expireCalls() {
  for (const c of db.prepare("SELECT * FROM calls WHERE status = 'ringing' AND created_at < datetime('now', ?)").all(`-${RING_SECONDS} seconds`)) {
    db.prepare("UPDATE calls SET status = 'missed', ended_at = datetime('now') WHERE id = ?").run(c.id);
    logCall(c, `📞 Пропуснато ${callLabel(c).toLowerCase()} обаждане`);
  }
  for (const c of db.prepare(`SELECT * FROM calls WHERE status = 'active' AND (caller_seen < datetime('now', ?) OR COALESCE(callee_seen, answered_at) < datetime('now', ?))`).all(`-${STALE_SECONDS} seconds`, `-${STALE_SECONDS} seconds`)) {
    endCall(c, 'ended');
  }
}
function endCall(c, status) {
  db.prepare("UPDATE calls SET status = ?, ended_at = datetime('now') WHERE id = ?").run(status, c.id);
  if (status === 'ended' && c.answered_at) {
    const sec = Math.max(0, Math.round((Date.now() - new Date(c.answered_at.replace(' ', 'T') + 'Z').getTime()) / 1000));
    logCall(c, `📞 ${callLabel(c)} обаждане · ${fmtDur(sec)}`);
  } else if (status === 'canceled') logCall(c, `📞 Пропуснато ${callLabel(c).toLowerCase()} обаждане`);
  else if (status === 'declined') logCall(c, `📞 Отказано ${callLabel(c).toLowerCase()} обаждане`);
}
const callOpen = uid => db.prepare("SELECT * FROM calls WHERE status IN ('ringing', 'active') AND (caller_id = ? OR callee_id = ?) ORDER BY id DESC LIMIT 1").get(uid, uid);
function callView(c, me) {
  const otherId = c.caller_id === me ? c.callee_id : c.caller_id;
  const o = db.prepare("SELECT * FROM users WHERE id = ?").get(otherId);
  return { id: c.id, kind: c.kind, status: c.status, conversationId: c.conversation_id, incoming: c.callee_id === me,
    peer: o ? publicProfiles([o], me)[0] : null, answeredAt: c.answered_at ? iso(c.answered_at) : null, createdAt: iso(c.created_at) };
}

app.post('/api/calls', requireActive, wrap((req, res) => {
  const me = req.session.userId, b = req.body || {};
  if (!['audio', 'video'].includes(b.kind)) return bad(res, 'Невалиден вид обаждане.');
  const cid = Number(b.conversationId), conv = convRow(cid);
  if (!conv || conv.kind !== 'direct' || !memberRow(cid, me)) return bad(res, 'Обаждания има само в лични разговори.', 404);
  const peer = directPeer(cid, me);
  if (!peer) return bad(res, 'Не можете да се обадите на този профил.', 403);
  expireCalls();
  if (callOpen(me)) return badc(res, 'Вече си в обаждане.', 409, 'busy_self');
  if (callOpen(peer.id)) return badc(res, `${peer.nickname} е в друго обаждане. Опитай по-късно.`, 409, 'busy');
  const id = db.prepare('INSERT INTO calls (conversation_id, caller_id, callee_id, kind) VALUES (?, ?, ?, ?)').run(cid, me, peer.id, b.kind).lastInsertRowid;
  res.status(201).json({ call: callView(db.prepare('SELECT * FROM calls WHERE id = ?').get(id), me) });
}));

// Опресняване: входящо обаждане (без callId) или състоянието на конкретно обаждане + новите сигнали от другата страна.
app.get('/api/calls/poll', requireAuth, wrap((req, res) => {
  const me = req.session.userId;
  expireCalls();
  let c = req.query.callId ? db.prepare('SELECT * FROM calls WHERE id = ? AND (caller_id = ? OR callee_id = ?)').get(Number(req.query.callId), me, me) : callOpen(me);
  if (!c) return res.json({ call: null, signals: [] });
  if (c.status === 'ringing' || c.status === 'active') {
    db.prepare(`UPDATE calls SET ${c.caller_id === me ? 'caller_seen' : 'callee_seen'} = datetime('now') WHERE id = ?`).run(c.id);
  }
  const after = Number(req.query.after) || 0;
  const signals = db.prepare('SELECT id, type, payload FROM call_signals WHERE call_id = ? AND from_id <> ? AND id > ? ORDER BY id').all(c.id, me, after);
  res.json({ call: callView(c, me), signals: signals.map(x => ({ id: x.id, type: x.type, payload: x.payload })) });
}));

const myCall = (req, res, mustBeOpen = true) => {
  const me = req.session.userId, c = db.prepare('SELECT * FROM calls WHERE id = ? AND (caller_id = ? OR callee_id = ?)').get(Number(req.params.id), me, me);
  if (!c) { bad(res, 'Обаждането не е намерено.', 404); return null; }
  if (mustBeOpen && !['ringing', 'active'].includes(c.status)) { bad(res, 'Обаждането вече приключи.', 409); return null; }
  return c;
};
app.post('/api/calls/:id/signal', requireAuth, wrap((req, res) => {
  const c = myCall(req, res); if (!c) return;
  const b = req.body || {}, payload = typeof b.payload === 'string' ? b.payload : JSON.stringify(b.payload || '');
  if (!['offer', 'answer', 'ice'].includes(b.type)) return bad(res, 'Невалиден сигнал.');
  if (payload.length > 20000) return bad(res, 'Сигналът е твърде голям.', 413);
  const id = db.prepare('INSERT INTO call_signals (call_id, from_id, type, payload) VALUES (?, ?, ?, ?)').run(c.id, req.session.userId, b.type, payload).lastInsertRowid;
  res.status(201).json({ id });
}));
app.post('/api/calls/:id/answer', requireAuth, wrap((req, res) => {
  expireCalls();
  const c = myCall(req, res); if (!c) return;
  if (c.callee_id !== req.session.userId || c.status !== 'ringing') return bad(res, 'Не можеш да вдигнеш това обаждане.', 403);
  db.prepare("UPDATE calls SET status = 'active', answered_at = datetime('now'), callee_seen = datetime('now') WHERE id = ?").run(c.id);
  res.json({ call: callView(db.prepare('SELECT * FROM calls WHERE id = ?').get(c.id), req.session.userId) });
}));
app.post('/api/calls/:id/decline', requireAuth, wrap((req, res) => {
  const c = myCall(req, res); if (!c) return;
  if (c.callee_id !== req.session.userId || c.status !== 'ringing') return bad(res, 'Не можеш да откажеш това обаждане.', 403);
  endCall(c, 'declined'); res.json({ ok: true });
}));
app.post('/api/calls/:id/end', requireAuth, wrap((req, res) => {
  const c = myCall(req, res, false); if (!c) return;
  if (['ringing', 'active'].includes(c.status)) endCall(c, c.status === 'ringing' ? (c.caller_id === req.session.userId ? 'canceled' : 'declined') : 'ended');
  res.json({ ok: true });
}));

// Доклад за профил. Към него се прикача снимка на разговора (личния между двамата или групата), за да може администраторът да прецени казуса.
app.post('/api/profiles/:id/report', requireActive, wrap((req, res) => {
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
  // Кой разговор се прикача: подаденият (трябва и двамата да са членове), иначе личният между двамата.
  let cid = null;
  if (b.conversationId) {
    cid = Number(b.conversationId);
    if (!memberRow(cid, me) || !memberRow(cid, id)) return bad(res, 'Разговорът не е намерен.', 404);
  } else {
    const d = db.prepare('SELECT id FROM conversations WHERE direct_key = ?').get(directKey(me, id));
    cid = d ? d.id : null;
  }
  const reporter = db.prepare('SELECT nickname FROM users WHERE id = ?').get(me);
  db.transaction(() => {
    const conv = cid ? convRow(cid) : null;
    const dossierId = ensureDossier(id, target.nickname);
    const rid = db.prepare('INSERT INTO reports (reporter_id, reported_id, reporter_nick, reported_nick, reason, details, conversation_id, conv_title, dossier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(me, id, reporter.nickname, target.nickname, b.reason, details, cid, conv && conv.kind === 'group' ? conv.title : '', dossierId).lastInsertRowid;
    if (cid) {
      const from = memberRow(cid, me).from_msg_id;
      const msgs = db.prepare(`SELECT m.*, u.nickname FROM messages m LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ? AND m.id >= ? ORDER BY m.id DESC LIMIT 200`).all(cid, from).reverse();
      const ins = db.prepare('INSERT INTO report_messages (report_id, from_reporter, body, sent_at, sender_nick, role, attachment_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
      msgs.forEach(m => ins.run(rid, m.sender_id === me ? 1 : 0, m.body, m.created_at, m.kind === 'system' ? '' : m.nickname || 'Изтрит профил',
        m.kind === 'system' ? 'system' : m.sender_id === me ? 'reporter' : m.sender_id === id ? 'reported' : 'other', m.attachment_id));
    }
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
  const byRegion = db.prepare("SELECT region, COUNT(*) c FROM users WHERE role <> 'admin' GROUP BY region ORDER BY c DESC").all();
  const byGender = db.prepare("SELECT gender, COUNT(*) c FROM users WHERE role <> 'admin' GROUP BY gender").all();
  res.json({
    users: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin'"),
    real: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin' AND is_demo = 0"),
    demo: one('SELECT COUNT(*) c FROM users WHERE is_demo = 1'),
    photos: one('SELECT COUNT(*) c FROM photos'),
    likes: one('SELECT COUNT(*) c FROM likes'),
    online: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin' AND last_seen >= datetime('now', '-5 minutes')"),
    openReports: one("SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
    openAppeals: one("SELECT COUNT(*) c FROM penalties WHERE appeal_status = 'pending'"),
    suspended: one("SELECT COUNT(DISTINCT user_id) c FROM penalties WHERE kind = 'suspension' AND lifted_at IS NULL AND ends_at > datetime('now')"),
    dossiers: one('SELECT COUNT(*) c FROM dossiers'),
    newToday: one("SELECT COUNT(*) c FROM users WHERE role <> 'admin' AND is_demo = 0 AND created_at >= datetime('now', '-1 day')"),
    byRegion: byRegion.map(r => ({ region: (places.REGION_BY_CODE.get(r.region) || { name: '—' }).name, count: r.c })),
    byGender: Object.fromEntries(byGender.map(r => [r.gender, r.c])),
  });
}));

app.get('/api/admin/users', requireAdmin, wrap((req, res) => {
  const term = nickKey(String(req.query.q || '').trim().slice(0, 30)).replace(/[\\%_]/g, c => '\\' + c);
  const rows = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.birth_date, u.gender, u.city, u.place_id, u.region, u.is_demo, u.role, u.created_at, u.last_seen,
           (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id) AS photos,
           (SELECT COUNT(*) FROM likes l WHERE l.to_id = u.id) AS likes
    FROM users u WHERE (u.nickname_key LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')
    ORDER BY u.id DESC LIMIT 200`).all('%' + term + '%', '%' + term + '%');
  res.json({ users: rows.map(r => ({
    id: r.id, username: r.username, nickname: r.nickname, age: ageFrom(r.birth_date), gender: r.gender, ...placeFields(r),
    isDemo: !!r.is_demo, role: r.role, createdAt: r.created_at, lastSeen: r.last_seen, photos: r.photos, likes: r.likes,
  })) });
}));

app.delete('/api/admin/users/:id', requireAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!row) return bad(res, 'Потребителят не е намерен.', 404);
  if (row.role === 'admin') return bad(res, 'Администраторски акаунт не може да се изтрива.', 403);
  eraseUser(id);
  res.json({ ok: true });
}));

// ── Доклади (админ) ──
// Администраторът вижда разговор САМО като част от доклад (снимка от момента на докладването),
// не може да разглежда произволни чатове. Всяко отваряне се записва в журнала.
const REPORT_STATUSES = ['open', 'upheld', 'dismissed'];
const reportRow = r => ({
  id: r.id, dossierId: r.dossier_id, reporterNick: r.reporter_nick, reportedNick: r.reported_nick, reason: r.reason, reasonLabel: REPORT_REASONS[r.reason] || r.reason,
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
  const msgs = db.prepare('SELECT id, from_reporter, body, sent_at, sender_nick, role, attachment_id FROM report_messages WHERE report_id = ? ORDER BY id').all(r.id);
  let reported = null;
  if (r.reported_id) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.reported_id);
    if (u) {
      reported = { id: u.id, nickname: u.nickname, age: ageFrom(u.birth_date), ...placeFields(u), gender: u.gender, bio: u.bio, isDemo: !!u.is_demo, createdAt: iso(u.created_at),
        photos: db.prepare('SELECT COUNT(*) c FROM photos WHERE user_id = ?').get(u.id).c,
        otherReports: db.prepare('SELECT COUNT(*) c FROM reports WHERE reported_id = ? AND id <> ?').get(u.id, r.id).c };
    }
  }
  res.json({
    report: { ...reportRow(r), details: r.details, adminNote: r.admin_note, reporterStillExists: !!r.reporter_id, reportedStillExists: !!reported },
    reported,
    messages: msgs.map(m => ({
      id: m.id, fromReporter: !!m.from_reporter,
      role: m.role || (m.from_reporter ? 'reporter' : 'reported'),
      from: m.sender_nick != null ? m.sender_nick : (m.from_reporter ? r.reporter_nick : r.reported_nick),
      body: m.body, at: iso(m.sent_at), attachment: attView(attById(m.attachment_id)),
    })),
    conversation: r.conversation_id || r.conv_title ? { title: r.conv_title, group: !!r.conv_title } : null,
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

// ── Досиета, наказания, обжалвания ──
// Досие се създава само за ДОКЛАДВАН профил. Наказания се налагат само към профили с досие.
function ensureDossier(uid, nickname) {
  const ex = db.prepare('SELECT id FROM dossiers WHERE user_id = ?').get(uid);
  if (ex) return ex.id;
  return db.prepare('INSERT INTO dossiers (user_id, nickname) VALUES (?, ?)').run(uid, nickname).lastInsertRowid;
}
// „Страйкове“ = предупреждения и суспензии, освен уважените обжалвания.
const strikesOf = did => db.prepare("SELECT COUNT(*) c FROM penalties WHERE dossier_id = ? AND kind IN ('warning', 'suspension') AND appeal_status <> 'accepted'").get(did).c;
const adminPenalty = p => ({ ...penaltyView(p), note: p.note, issuedNick: p.issued_nick, liftedAt: p.lifted_at ? iso(p.lifted_at) : null, liftedNote: p.lifted_note,
  appealAt: p.appeal_at ? iso(p.appeal_at) : null, appealDecidedAt: p.appeal_decided_at ? iso(p.appeal_decided_at) : null, reportId: p.report_id,
  active: p.kind === 'suspension' && !p.lifted_at && p.ends_at && p.ends_at > new Date().toISOString().slice(0, 19).replace('T', ' ') });
const clean = (v, max) => String(v || '').trim().slice(0, max);
const adminNick = id => (db.prepare('SELECT nickname FROM users WHERE id = ?').get(id) || {}).nickname || 'Админ';

function notifyPenalty(uid, subject, text) {
  const u = db.prepare('SELECT email FROM users WHERE id = ?').get(uid);
  if (u && u.email) mailer.send({ to: u.email, subject, text });
}

app.get('/api/admin/dossiers', requireAdmin, wrap((req, res) => {
  const status = String(req.query.status || 'all'), term = String(req.query.q || '').trim().toLowerCase();
  const rows = db.prepare(`SELECT d.*,
      (SELECT COUNT(*) FROM reports r WHERE r.dossier_id = d.id) AS reports,
      (SELECT COUNT(*) FROM reports r WHERE r.dossier_id = d.id AND r.status = 'open') AS open_reports,
      (SELECT MAX(created_at) FROM reports r WHERE r.dossier_id = d.id) AS last_report,
      (SELECT COUNT(*) FROM penalties p WHERE p.dossier_id = d.id AND p.appeal_status = 'pending') AS appeals
    FROM dossiers d ORDER BY (open_reports > 0) DESC, last_report DESC LIMIT 300`).all();
  let list = rows.map(d => {
    const susp = d.user_id ? activeSuspension(d.user_id) : null;
    return { id: d.id, nickname: d.nickname, status: d.status, reports: d.reports, openReports: d.open_reports, strikes: strikesOf(d.id), strikeLimit: STRIKE_LIMIT,
      suspendedUntil: susp ? iso(susp.ends_at) : null, appeals: d.appeals, lastReportAt: d.last_report ? iso(d.last_report) : null, createdAt: iso(d.created_at) };
  });
  if (term) list = list.filter(d => d.nickname.toLowerCase().includes(term));
  if (status === 'suspended') list = list.filter(d => d.suspendedUntil);
  else if (status === 'deregistered') list = list.filter(d => d.status === 'deregistered');
  else if (status === 'appeals') list = list.filter(d => d.appeals > 0);
  else if (status === 'active') list = list.filter(d => d.status === 'active');
  res.json({ dossiers: list });
}));

app.get('/api/admin/dossiers/:id', requireAdmin, wrap((req, res) => {
  const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(Number(req.params.id));
  if (!d) return bad(res, 'Досието не е намерено.', 404);
  db.prepare("INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, 'view_dossier', NULL)").run(req.session.userId);
  let subject = null;
  if (d.user_id) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(d.user_id);
    if (u) subject = { alive: true, id: u.id, nickname: u.nickname, age: ageFrom(u.birth_date), ...placeFields(u), gender: u.gender, bio: u.bio, goal: u.goal, isDemo: !!u.is_demo, paused: !!u.paused,
      joinedAt: iso(u.created_at), lastSeen: iso(u.last_seen), emailMasked: emailutil.maskEmail(u.email), emailVerified: !!u.email_verified_at,
      photos: db.prepare('SELECT COUNT(*) c FROM photos WHERE user_id = ?').get(u.id).c };
  }
  if (!subject) { let snap = {}; try { snap = JSON.parse(d.snapshot || '{}'); } catch { /* ignore */ } subject = { alive: false, nickname: d.nickname, ...snap }; }
  const reports = db.prepare('SELECT * FROM reports WHERE dossier_id = ? ORDER BY id DESC').all(d.id).map(r => ({ ...reportRow(r), details: r.details, adminNote: r.admin_note, convTitle: r.conv_title }));
  const penalties = db.prepare('SELECT * FROM penalties WHERE dossier_id = ? ORDER BY id DESC').all(d.id).map(adminPenalty);
  const notes = db.prepare('SELECT * FROM dossier_notes WHERE dossier_id = ? ORDER BY id DESC').all(d.id).map(n => ({ id: n.id, note: n.note, admin: n.admin_nick, at: iso(n.created_at) }));
  const strikes = strikesOf(d.id);
  res.json({
    dossier: { id: d.id, nickname: d.nickname, status: d.status, createdAt: iso(d.created_at), closedAt: d.closed_at ? iso(d.closed_at) : null, closedReason: d.closed_reason },
    subject, reports, penalties, notes, strikes, strikeLimit: STRIKE_LIMIT, recommendDeregister: strikes >= STRIKE_LIMIT && d.status === 'active', suspendDays: SUSPEND_DAYS,
    emailBanned: d.status === 'deregistered',
  });
}));

app.post('/api/admin/dossiers/:id/notes', requireAdmin, wrap((req, res) => {
  const d = db.prepare('SELECT id FROM dossiers WHERE id = ?').get(Number(req.params.id));
  if (!d) return bad(res, 'Досието не е намерено.', 404);
  const note = clean((req.body || {}).note, 1000);
  if (note.length < 2) return bad(res, 'Напиши бележка.');
  db.prepare('INSERT INTO dossier_notes (dossier_id, admin_id, admin_nick, note) VALUES (?, ?, ?, ?)').run(d.id, req.session.userId, adminNick(req.session.userId), note);
  res.status(201).json({ ok: true });
}));

app.post('/api/admin/dossiers/:id/penalties', requireAdmin, wrap((req, res) => {
  const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(Number(req.params.id)), b = req.body || {};
  if (!d) return bad(res, 'Досието не е намерено.', 404);
  if (!d.user_id || d.status !== 'active') return bad(res, 'Профилът вече не е активен.', 409);
  if (!['warning', 'suspension'].includes(b.kind)) return bad(res, 'Избери вид наказание.');
  const days = b.kind === 'suspension' ? Number(b.days) : null;
  if (b.kind === 'suspension' && !SUSPEND_DAYS.includes(days)) return bad(res, `Суспензията е ${SUSPEND_DAYS.join(', ')} дни.`);
  const reason = clean(b.reason, 300);
  if (reason.length < 5) return bad(res, 'Напиши причина (поне 5 символа) – показва се на потребителя.');
  const reportId = b.reportId && db.prepare('SELECT 1 FROM reports WHERE id = ? AND dossier_id = ?').get(Number(b.reportId), d.id) ? Number(b.reportId) : null;
  const admin = req.session.userId;
  const r = db.prepare(`INSERT INTO penalties (dossier_id, user_id, kind, reason, note, days, report_id, issued_by, issued_nick, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${days ? "datetime('now', ?)" : 'NULL'})`)
    .run(...[d.id, d.user_id, b.kind, reason, clean(b.note, 500), days, reportId, admin, adminNick(admin)].concat(days ? [`+${days} days`] : [])).lastInsertRowid;
  db.prepare('INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, ?, ?)').run(admin, 'penalty_' + b.kind, reportId);
  notifyPenalty(d.user_id, b.kind === 'warning' ? 'Spark: предупреждение за профила ти' : 'Spark: профилът ти е временно спрян',
    `${b.kind === 'warning' ? 'Получи предупреждение' : `Профилът ти е спрян за ${days} дни`}.\nПричина: ${reason}\n\nАко смяташ, че е грешка, можеш да обжалваш от профила си в сайта.`);
  const strikes = strikesOf(d.id);
  res.status(201).json({ penalty: adminPenalty(db.prepare('SELECT * FROM penalties WHERE id = ?').get(r)), strikes, strikeLimit: STRIKE_LIMIT, recommendDeregister: strikes >= STRIKE_LIMIT });
}));

app.post('/api/admin/penalties/:id/lift', requireAdmin, wrap((req, res) => {
  const p = db.prepare('SELECT * FROM penalties WHERE id = ?').get(Number(req.params.id));
  if (!p || p.kind === 'deregistration') return bad(res, 'Наказанието не е намерено.', 404);
  if (p.lifted_at) return bad(res, 'Наказанието вече е вдигнато.', 409);
  db.prepare("UPDATE penalties SET lifted_at = datetime('now'), lifted_note = ? WHERE id = ?").run(clean((req.body || {}).note, 300), p.id);
  db.prepare("INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, 'penalty_lift', ?)").run(req.session.userId, p.report_id);
  res.json({ ok: true });
}));

app.post('/api/admin/penalties/:id/appeal', requireAdmin, wrap((req, res) => {
  const p = db.prepare('SELECT * FROM penalties WHERE id = ?').get(Number(req.params.id)), b = req.body || {};
  if (!p || p.appeal_status !== 'pending') return bad(res, 'Няма чакащо обжалване.', 404);
  if (!['accepted', 'rejected'].includes(b.decision)) return bad(res, 'Невалидно решение.');
  const note = clean(b.note, 300);
  db.transaction(() => {
    db.prepare("UPDATE penalties SET appeal_status = ?, appeal_note = ?, appeal_decided_at = datetime('now') WHERE id = ?").run(b.decision, note, p.id);
    if (b.decision === 'accepted' && !p.lifted_at) db.prepare("UPDATE penalties SET lifted_at = datetime('now'), lifted_note = 'Уважено обжалване' WHERE id = ?").run(p.id);
  })();
  db.prepare('INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, ?, ?)').run(req.session.userId, 'appeal_' + b.decision, p.report_id);
  if (p.user_id) notifyPenalty(p.user_id, 'Spark: решение по обжалването ти', `Обжалването ти беше ${b.decision === 'accepted' ? 'уважено – наказанието е отменено' : 'отхвърлено'}.${note ? `\nКоментар: ${note}` : ''}`);
  res.json({ ok: true });
}));

// Дерегистрация: профилът се изтрива, имейлът (само като хеш) се забранява за нова регистрация, досието остава.
app.post('/api/admin/dossiers/:id/deregister', requireAdmin, wrap((req, res) => {
  const d = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(Number(req.params.id)), b = req.body || {};
  if (!d) return bad(res, 'Досието не е намерено.', 404);
  if (!d.user_id || d.status !== 'active') return bad(res, 'Профилът вече не е активен.', 409);
  const reason = clean(b.reason, 300);
  if (reason.length < 5) return bad(res, 'Напиши причина (поне 5 символа).');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(d.user_id);
  if (!u || u.role === 'admin') return bad(res, 'Администраторски акаунт не може да се дерегистрира.', 403);
  const admin = req.session.userId, snapshot = JSON.stringify({ age: ageFrom(u.birth_date), ...placeFields(u), gender: u.gender, joinedAt: iso(u.created_at), lastSeen: iso(u.last_seen), isDemo: !!u.is_demo, emailMasked: emailutil.maskEmail(u.email) });
  const email = u.email;
  db.transaction(() => {
    if (u.email_key) db.prepare('INSERT OR IGNORE INTO banned_emails (hash, dossier_id) VALUES (?, ?)').run(emailutil.emailHash(u.email_key), d.id);
    db.prepare('INSERT OR IGNORE INTO deregistered (username_key, dossier_id) VALUES (?, ?)').run(u.username.toLowerCase(), d.id);
    db.prepare(`INSERT INTO penalties (dossier_id, user_id, kind, reason, note, issued_by, issued_nick) VALUES (?, ?, 'deregistration', ?, ?, ?, ?)`)
      .run(d.id, u.id, reason, clean(b.note, 500), admin, adminNick(admin));
    db.prepare("UPDATE dossiers SET status = 'deregistered', snapshot = ?, closed_reason = ?, closed_at = datetime('now') WHERE id = ?").run(snapshot, reason, d.id);
    eraseUser(u.id);               // FK: dossiers.user_id и penalties.user_id стават NULL
  })();
  db.prepare("INSERT INTO audit_log (admin_id, action, report_id) VALUES (?, 'deregister', NULL)").run(admin);
  if (email) mailer.send({ to: email, subject: 'Spark: профилът ти е дерегистриран', text: `Профилът ти „${d.nickname}“ беше дерегистриран заради нарушение на правилата.\nПричина: ${reason}\n\nС този имейл не може да се създава нов профил. Ако смяташ, че е допусната грешка, отговори на това писмо.` });
  res.json({ ok: true });
}));

// ── За самия потребител: прочитане на предупреждение и обжалване ──
app.post('/api/me/penalties/:id/ack', requireAuth, wrap((req, res) => {
  const p = db.prepare("SELECT id FROM penalties WHERE id = ? AND user_id = ? AND kind = 'warning'").get(Number(req.params.id), req.session.userId);
  if (!p) return bad(res, 'Не е намерено.', 404);
  db.prepare("UPDATE penalties SET acked_at = datetime('now') WHERE id = ?").run(p.id);
  res.json({ user: meOf(req.session.userId) });
}));
app.post('/api/me/penalties/:id/appeal', requireAuth, wrap((req, res) => {
  const me = req.session.userId, p = db.prepare("SELECT * FROM penalties WHERE id = ? AND user_id = ? AND kind IN ('warning', 'suspension')").get(Number(req.params.id), me);
  if (!p) return bad(res, 'Не е намерено.', 404);
  if (p.appeal_status !== 'none') return bad(res, 'Вече си обжалвал това наказание.', 409);
  const text = clean((req.body || {}).text, 500);
  if (text.length < 10) return bad(res, 'Опиши защо смяташ, че е грешка (поне 10 символа).');
  db.prepare("UPDATE penalties SET appeal_text = ?, appeal_at = datetime('now'), appeal_status = 'pending' WHERE id = ?").run(text, p.id);
  res.json({ user: meOf(me) });
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

// Непотвърдени акаунти се трият след 7 дни.
function purgeUnverified() {
  for (const u of db.prepare("SELECT id FROM users WHERE role = 'user' AND email_verified_at IS NULL AND created_at < datetime('now', '-7 days')").all()) eraseUser(u.id);
}
purgeUnverified();
setInterval(purgeUnverified, 3600e3).unref();

module.exports = app;
