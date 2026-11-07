// Резервни копии на базата (VACUUM INTO – консистентен снимък, без спиране на сайта).
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const DIR = process.env.BACKUP_DIR || path.join(path.dirname(db.UPLOAD_DIR), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
let lastSnap = 0;

function snapshot(tag = 'auto', { minGapMs = 0 } = {}) {
  if (process.env.NODE_ENV === 'test') return null;
  if (minGapMs && Date.now() - lastSnap < minGapMs) return null;
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DIR, `spark-${stamp()}-${tag}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  lastSnap = Date.now();
  prune();
  return file;
}
// Пази последните KEEP копия; копията „pre-…“ (преди изтриване) се пазят отделно колкото KEEP.
function prune() {
  const all = fs.readdirSync(DIR).filter(f => /^spark-.*\.db$/.test(f)).sort();
  for (const group of [all.filter(f => /-pre-/.test(f)), all.filter(f => !/-pre-/.test(f))]) {
    group.slice(0, Math.max(0, group.length - KEEP)).forEach(f => fs.rmSync(path.join(DIR, f), { force: true }));
  }
}
function schedule() {
  if (process.env.NODE_ENV === 'test' || process.env.BACKUP === '0') return;
  try { snapshot('start'); } catch (e) { console.error('Резервното копие не успя:', e.message); }
  const t = setInterval(() => { try { snapshot('daily'); } catch (e) { console.error('Резервното копие не успя:', e.message); } }, 24 * 3600 * 1000);
  t.unref();
}
module.exports = { snapshot, schedule, DIR };
