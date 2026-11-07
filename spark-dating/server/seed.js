// Демо профили, за да не е празен сайтът при първо стартиране.
// Маркирани са is_demo=1 (в интерфейса има значка „демо“), нямат снимки и
// паролите им са неизползваеми – в тях не може да се влезе.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { CITIES, INTERESTS } = require('./constants');

const { PEOPLE, randomInterests, SAMPLE_REPORTS } = require('./seed-data');

function birthFor(age, i) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setMonth((i * 5) % 12, 1 + ((i * 11) % 27));
  return d.toISOString().slice(0, 10);
}

function seedReports() {
  const idOf = nick => db.prepare('SELECT id FROM users WHERE nickname_key = ?').get(nick.toLowerCase()).id;
  const insR = db.prepare(`INSERT INTO reports (reporter_id, reported_id, reporter_nick, reported_nick, reason, details, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`);
  const insM = db.prepare("INSERT INTO report_messages (report_id, from_reporter, body, sent_at) VALUES (?, ?, ?, datetime('now', ?))");
  db.transaction(() => {
    for (const r of SAMPLE_REPORTS) {
      const rid = insR.run(idOf(r.reporter), idOf(r.reported), r.reporter, r.reported, r.reason, r.details, `-${r.ago} minutes`).lastInsertRowid;
      r.msgs.forEach(([who, text, ago]) => insM.run(rid, who === 'r' ? 1 : 0, text, `-${ago} minutes`));
    }
  })();
}

function seedDemo() {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) return 0;
  const insUser = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, bio, is_demo, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', ?))`);
  const insInt = db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)');
  // Един и същ неизползваем хеш за всички демо акаунти.
  const dead = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4);
  const tx = db.transaction(() => {
    PEOPLE.forEach(([nick, gender, age, city, bio], i) => {
      if (!CITIES.includes(city)) throw new Error('Unknown city in seed: ' + city);
      const looking = gender === 'male' ? 'female' : gender === 'female' ? 'male' : 'any';
      const id = insUser.run(
        `demo_${i}_${crypto.randomBytes(4).toString('hex')}`, dead, nick, nick.toLowerCase(),
        birthFor(age, i), gender, i % 9 === 0 ? 'any' : looking, city, bio,
        `-${(i * 37) % 600} minutes`
      ).lastInsertRowid;
      randomInterests(i).forEach(x => insInt.run(id, x));
    });
  });
  tx();
  seedReports();
  return PEOPLE.length;
}

// Администраторски акаунт: без използваема парола. Влиза се само през /api/demo-admin (DEMO_ADMIN=1).
function seedAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return false;
  const dead = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4);
  db.prepare(`INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, bio, role)
              VALUES ('admin', ?, 'Админ', 'админ', '1990-01-01', 'other', 'any', 'София', 'Администратор на Spark.', 'admin')`).run(dead);
  return true;
}

module.exports = { seedDemo, seedAdmin };
