// Имейл: валидиране, нормализиране (за да не се заобикаля забрана с точки или +етикет), хеш за списъка със забранени.
const crypto = require('node:crypto');

// Малък списък с най-масовите едноразови пощи. Не е изчерпателен (виж README: за истинска защита – външна услуга).
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'trashmail.com', 'trashmail.net',
  'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com',
  'spamgourmet.com', 'moakt.com', 'burnermail.io', 'mytemp.email', 'tmpmail.org', 'tmpmail.net', 'discard.email', 'mailcatch.com', 'inboxkitten.com',
]);
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

// Връща { ok, email, key, domain } или { ok:false, reason }.
function parseEmail(raw) {
  const email = String(raw || '').trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, reason: 'invalid' };
  let [local, domain] = email.toLowerCase().split('@');
  if (local.length > 64 || domain.includes('..') || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return { ok: false, reason: 'invalid' };
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable' };
  // „име+етикет@…“ е същата пощенска кутия; в Gmail точките също не се броят.
  local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return { ok: false, reason: 'invalid' };
  return { ok: true, email, key: `${local}@${domain}`, domain };
}

const maskEmail = e => {
  const [l, d] = String(e || '').split('@');
  if (!d) return '';
  const dot = d.lastIndexOf('.');
  return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(l.length - 2, 5)))}@${d[0]}${'*'.repeat(Math.max(1, Math.min(dot - 1, 5)))}${d.slice(dot)}`;
};

// Сол за хешовете. В production се задава EMAIL_PEPPER (иначе се ползва SESSION_SECRET).
const pepper = () => process.env.EMAIL_PEPPER || process.env.SESSION_SECRET || 'dev-only-secret-change-me';
const emailHash = key => crypto.createHmac('sha256', pepper()).update(key).digest('hex');
const codeHash = (code, userId) => crypto.createHmac('sha256', pepper()).update(`code:${userId}:${code}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

module.exports = { parseEmail, maskEmail, emailHash, codeHash, newCode, safeEqual, DISPOSABLE };
