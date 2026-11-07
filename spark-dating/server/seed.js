// Демо профили, за да не е празен сайтът при първо стартиране.
// Маркирани са is_demo=1 (в интерфейса има значка „демо“), нямат снимки и
// паролите им са неизползваеми – в тях не може да се влезе.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const places = require('./places');

const { PEOPLE, randomInterests, SAMPLE_REPORTS, TEST_USER, TEST_CHATS } = require('./seed-data');

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
    INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, bio, is_demo, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', ?))`);
  const insInt = db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)');
  // Един и същ неизползваем хеш за всички демо акаунти.
  const dead = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4);
  const tx = db.transaction(() => {
    PEOPLE.forEach(([nick, gender, age, city, bio], i) => {
      const place = places.findPlace(city);
      if (!place) throw new Error('Unknown place in seed: ' + city);
      const looking = gender === 'male' ? 'female' : gender === 'female' ? 'male' : 'any';
      const id = insUser.run(
        `demo_${i}_${crypto.randomBytes(4).toString('hex')}`, dead, nick, nick.toLowerCase(),
        birthFor(age, i), gender, i % 9 === 0 ? 'any' : looking, place.label, place.id, place.region, bio,
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
  const sofia = places.findPlace('София');
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return false;
  const dead = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4);
  db.prepare(`INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, bio, role)
              VALUES ('admin', ?, 'Админ', 'админ', '1990-01-01', 'other', 'any', ?, ?, ?, 'Администратор на Spark.', 'admin')`).run(dead, sofia.label, sofia.id, sofia.region);
  return true;
}

// Тестов обикновен потребител с готови разговори. Без използваема парола; влиза се през /api/demo-user (DEMO_ADMIN=1).
function seedTestUser() {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(TEST_USER.username)) return false;
  const T = TEST_USER;
  const place = places.findPlace(T.city);
  const dead = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4);
  const born = new Date(); born.setFullYear(born.getFullYear() - T.age); born.setMonth(5, 15);
  const readAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.transaction(() => {
    const id = db.prepare(`INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, bio, is_demo)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(T.username, dead, T.nickname, T.nickname.toLowerCase(), born.toISOString().slice(0, 10), T.gender, T.lookingFor, place.label, place.id, place.region, T.bio).lastInsertRowid;
    T.interests.forEach(i => db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)').run(id, i));
    const ins = db.prepare("INSERT INTO messages (from_id, to_id, body, created_at, read_at) VALUES (?, ?, ?, datetime('now', ?), ?)");
    for (const c of TEST_CHATS) {
      const peer = db.prepare('SELECT id FROM users WHERE nickname_key = ?').get(c.peer.toLowerCase());
      if (!peer) continue;
      c.msgs.forEach(([who, text, ago], n) => {
        const fromPeer = who === 'p';
        const unread = fromPeer && c.unread && n === c.msgs.length - 1;
        ins.run(fromPeer ? peer.id : id, fromPeer ? id : peer.id, text, `-${ago} minutes`, unread ? null : readAt);
      });
    }
  })();
  return true;
}

module.exports = { seedDemo, seedAdmin, seedTestUser };
