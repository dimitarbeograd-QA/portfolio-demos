// Създава (или обновява) администраторски акаунт: node scripts/create-admin.js <потребител> [--reset]
// Паролата се чете скрито от терминала (или от ADMIN_PASSWORD). Принтира тайната за приложението за удостоверяване (TOTP).
const readline = require('node:readline');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../server/db');
const adb = require('../server/admin-db');
const places = require('../server/places');
const { newTotpSecret, totpUri } = require('../server/security');

const name = process.argv[2];
if (!name || !/^[a-zA-Z0-9_.-]{3,30}$/.test(name)) { console.error('Употреба: node scripts/create-admin.js <потребител (3–30 знака)> [--reset]'); process.exit(1); }
const reset = process.argv.includes('--reset');

function askHidden(q) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); else rl.output.write(''); };
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const existing = adb.prepare('SELECT * FROM admin_accounts WHERE username = ?').get(name);
  if (existing && !reset) { console.error('Такъв администратор вече има. Добави --reset за нова парола и нов 2FA код.'); process.exit(1); }
  const password = process.env.ADMIN_PASSWORD || await askHidden('Парола (поне 14 знака): ');
  if (password.length < 14 || Buffer.byteLength(password) > 72) { console.error('Паролата трябва да е 14–72 знака.'); process.exit(1); }
  const secret = newTotpSecret(), hash = bcrypt.hashSync(password, 12);
  let shadow = existing && existing.shadow_user_id;
  if (!shadow) {
    const sofia = places.findPlace('София');
    const dead = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4); // ред без използваема парола – само за журнала на действията
    shadow = db.prepare(`INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, bio, role, email_verified_at)
      VALUES (?, ?, ?, ?, '1990-01-01', 'other', 'any', ?, ?, ?, 'Администратор на Spark.', 'admin', datetime('now'))`)
      .run('adm_' + name.toLowerCase(), dead, 'Админ ' + name, ('админ ' + name).toLowerCase(), sofia.label, sofia.id, sofia.region).lastInsertRowid;
  }
  if (existing) adb.prepare('UPDATE admin_accounts SET password_hash = ?, totp_secret = ?, fails = 0, locked_until = 0, last_totp_step = 0 WHERE id = ?').run(hash, secret, existing.id);
  else adb.prepare('INSERT INTO admin_accounts (username, password_hash, totp_secret, shadow_user_id) VALUES (?, ?, ?, ?)').run(name, hash, secret, shadow);
  console.log(`\nАдминистратор „${name}“ е ${existing ? 'обновен' : 'създаден'}.\n`);
  console.log('Добави този ключ в приложение за удостоверяване (Google Authenticator, Aegis, 1Password…):');
  console.log('  Ключ:', secret);
  console.log('  URI :', totpUri(secret, name), '\n');
  console.log('Този ключ се показва само сега. Запиши го на сигурно място (напр. мениджър на пароли).');
})();
