// Защити на сайта: хедъри, CSRF (проверка на Origin), ограничаване на заявките, TOTP (2FA) и сигурностен журнал.
const crypto = require('node:crypto');

// ── Хедъри ──
function headers({ prod, admin }) {
  const csp = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
    "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" + (prod ? '; upgrade-insecure-requests' : '');
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    // Камерата/микрофонът са нужни за обажданията, местоположението – за „На живо“; в админ частта не е нужно нищо.
    res.setHeader('Permissions-Policy', admin ? 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' : 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()');
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (admin) { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Cache-Control', 'no-store'); }
    next();
  };
}

// ── CSRF: заявка, която променя данни, не бива да идва от друг сайт ──
// Браузърите винаги пращат Origin при POST/PUT/DELETE; ако е различен от хоста (или липсва Sec-Fetch-Site: same-origin) → отказ.
function csrf(onBlock) {
  const extra = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin'), site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site) && !(origin && extra.has(origin))) { onBlock && onBlock(req, 'csrf-site'); return res.status(403).json({ error: 'Заявката е отхвърлена (чужд произход).' }); }
    if (origin && origin !== 'null') {
      let host = '';
      try { host = new URL(origin).host; } catch { /* невалиден */ }
      if (host !== req.get('host') && !extra.has(origin)) { onBlock && onBlock(req, 'csrf-origin'); return res.status(403).json({ error: 'Заявката е отхвърлена (чужд произход).' }); }
    } else if (origin === 'null') { onBlock && onBlock(req, 'csrf-null'); return res.status(403).json({ error: 'Заявката е отхвърлена.' }); }
    next();
  };
}

// ── Ограничаване на заявките (плъзгащ се прозорец в паметта, по IP) ──
function limiter({ windowMs, max, name, onHit }) {
  const hits = new Map();
  const timer = setInterval(() => { const cut = Date.now() - windowMs; for (const [k, v] of hits) if (v[v.length - 1] < cut) hits.delete(k); }, Math.max(30000, windowMs));
  timer.unref();
  const mw = (req, res, next) => {
    const now = Date.now(), key = req.ip, arr = (hits.get(key) || []).filter(t => t > now - windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      onHit && onHit(req, name);
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Твърде много заявки. Опитайте отново след малко.' });
    }
    arr.push(now); hits.set(key, arr);
    next();
  };
  mw.reset = () => hits.clear();
  return mw;
}

// ── TOTP (RFC 6238): двуфакторен вход за администраторите ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function b32decode(s) {
  let bits = '';
  for (const c of String(s).replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) throw new Error('bad base32'); bits += v.toString(2).padStart(5, '0'); }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
const newTotpSecret = () => b32encode(crypto.randomBytes(20));
function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}
// Връща номера на 30-секундния интервал, в който кодът е верен (или null). ±1 интервал толеранс за часовника.
function totpCheck(secret, code, now = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    const a = Buffer.from(hotp(secret, step + d)), b = Buffer.from(code);
    if (crypto.timingSafeEqual(a, b)) return step + d;
  }
  return null;
}
const totpUri = (secret, user, issuer = 'Spark Admin') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

// Слаби пароли (кратък списък; истинската защита е дължината + ограничението на опитите).
const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'abc12345', 'password123', '11111111', '00000000', 'admin123', 'letmein1', 'parola123', 'parola12']);
const weakPassword = p => COMMON.has(String(p).toLowerCase()) || /^(.)\1+$/.test(p);

module.exports = { headers, csrf, limiter, newTotpSecret, totpCheck, totpUri, hotp, weakPassword };
