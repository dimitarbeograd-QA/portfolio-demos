// Демо профили, за да не е празен сайтът при първо стартиране.
// Маркирани са is_demo=1 (в интерфейса има значка „демо“), нямат снимки и
// паролите им са неизползваеми – в тях не може да се влезе.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const places = require('./places');

const { PEOPLE, randomInterests, SAMPLE_REPORTS, TEST_USER, TEST_CHATS, TEST_GROUPS, SAMPLE_PENALTIES } = require('./seed-data');

function birthFor(age, i) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setMonth((i * 5) % 12, 1 + ((i * 11) % 27));
  return d.toISOString().slice(0, 10);
}

function seedReports() {
  const idOf = nick => db.prepare('SELECT id FROM users WHERE nickname_key = ?').get(nick.toLowerCase()).id;
  const insR = db.prepare(`INSERT INTO reports (reporter_id, reported_id, reporter_nick, reported_nick, reason, details, created_at, dossier_id)
                           VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), ?)`);
  const dossierFor = (uid, nick) => (db.prepare('SELECT id FROM dossiers WHERE user_id = ?').get(uid) || { id: db.prepare('INSERT INTO dossiers (user_id, nickname) VALUES (?, ?)').run(uid, nick).lastInsertRowid }).id;
  const insM = db.prepare("INSERT INTO report_messages (report_id, from_reporter, body, sent_at, sender_nick, role) VALUES (?, ?, ?, datetime('now', ?), ?, ?)");
  db.transaction(() => {
    for (const r of SAMPLE_REPORTS) {
      const rid = insR.run(idOf(r.reporter), idOf(r.reported), r.reporter, r.reported, r.reason, r.details, `-${r.ago} minutes`, dossierFor(idOf(r.reported), r.reported)).lastInsertRowid;
      r.msgs.forEach(([who, text, ago]) => insM.run(rid, who === 'r' ? 1 : 0, text, `-${ago} minutes`, who === 'r' ? r.reporter : r.reported, who === 'r' ? 'reporter' : 'reported'));
    }
  })();
}

function seedDemo() {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) return 0;
  const insUser = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, bio, is_demo, last_seen, email_verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', ?), datetime('now'))`);
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
  db.prepare(`INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, bio, role, email_verified_at)
              VALUES ('admin', ?, 'Админ', 'админ', '1990-01-01', 'other', 'any', ?, ?, ?, 'Администратор на Spark.', 'admin', datetime('now'))`).run(dead, sofia.label, sofia.id, sofia.region);
  seedPenalties();
  return true;
}

// Примерни наказания в досието на „Сашо“ (изискват админ и вече създадени доклади).
function seedPenalties() {
  const admin = db.prepare("SELECT id, nickname FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return;
  for (const p of SAMPLE_PENALTIES) {
    const u = db.prepare('SELECT id FROM users WHERE nickname_key = ?').get(p.target.toLowerCase());
    const d = u && db.prepare('SELECT id FROM dossiers WHERE user_id = ?').get(u.id);
    if (!d || db.prepare('SELECT 1 FROM penalties WHERE dossier_id = ? AND kind = ? AND reason = ?').get(d.id, p.kind, p.reason)) continue;
    const ends = p.days ? `datetime('now', '-${p.ago} minutes', '+${p.days} days')` : 'NULL';
    const id = db.prepare(`INSERT INTO penalties (dossier_id, user_id, kind, reason, note, days, issued_by, issued_nick, created_at, ends_at, acked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ${ends}, ${p.kind === 'warning' ? "datetime('now')" : 'NULL'})`)
      .run(d.id, u.id, p.kind, p.reason, p.note, p.days || null, admin.id, admin.nickname, `-${p.ago} minutes`).lastInsertRowid;
    if (p.appeal) db.prepare("UPDATE penalties SET appeal_text = ?, appeal_status = 'pending', appeal_at = datetime('now', ?) WHERE id = ?").run(p.appeal.text, `-${p.appeal.ago} minutes`, id);
  }
}

// Тестов обикновен потребител с готови разговори. Без използваема парола; влиза се през /api/demo-user (DEMO_ADMIN=1).
function seedTestUser() {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(TEST_USER.username)) return false;
  const T = TEST_USER;
  const place = places.findPlace(T.city);
  const dead = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4);
  const born = new Date(); born.setFullYear(born.getFullYear() - T.age); born.setMonth(5, 15);
  db.transaction(() => {
    const id = db.prepare(`INSERT INTO users (username, password_hash, nickname, nickname_key, birth_date, gender, looking_for, city, place_id, region, bio, is_demo, email_verified_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`)
      .run(T.username, dead, T.nickname, T.nickname.toLowerCase(), born.toISOString().slice(0, 10), T.gender, T.lookingFor, place.label, place.id, place.region, T.bio).lastInsertRowid;
    T.interests.forEach(i => db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)').run(id, i));
    const idOf = nick => db.prepare('SELECT id FROM users WHERE nickname_key = ?').get(nick.toLowerCase());
    const addMsg = db.prepare("INSERT INTO messages (conversation_id, sender_id, kind, body, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))");
    const setRead = db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?');
    const maxId = cid => db.prepare('SELECT MAX(id) x FROM messages WHERE conversation_id = ?').get(cid).x;
    for (const c of TEST_CHATS) {
      const peer = idOf(c.peer);
      if (!peer) continue;
      const key = id < peer.id ? `${id}:${peer.id}` : `${peer.id}:${id}`;
      const cid = db.prepare("INSERT INTO conversations (kind, direct_key, created_by) VALUES ('direct', ?, ?)").run(key, id).lastInsertRowid;
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(cid, id);
      db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(cid, peer.id);
      let lastPeerMsg = 0;
      c.msgs.forEach(([who, text, ago]) => { const mid = addMsg.run(cid, who === 'p' ? peer.id : id, 'user', text, `-${ago} minutes`).lastInsertRowid; if (who === 'p') lastPeerMsg = mid; });
      setRead.run(c.unread ? lastPeerMsg - 1 : maxId(cid), cid, id);
      setRead.run(maxId(cid), cid, peer.id);
    }
    for (const g of TEST_GROUPS) {
      const people = g.members.map(idOf).filter(Boolean);
      const cid = db.prepare("INSERT INTO conversations (kind, title, created_by) VALUES ('group', ?, ?)").run(g.title, id).lastInsertRowid;
      db.prepare("INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'owner')").run(cid, id);
      people.forEach(p => db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(cid, p.id));
      let lastOther = 0;
      g.msgs.forEach(([who, text, ago]) => {
        const sender = who === 'sys' || who === 'me' ? id : (idOf(who) || {}).id;
        const mid = addMsg.run(cid, sender, who === 'sys' ? 'system' : 'user', text, `-${ago} minutes`).lastInsertRowid;
        if (who !== 'me' && who !== 'sys') lastOther = mid;
      });
      setRead.run(g.unread ? lastOther - 1 : maxId(cid), cid, id);
      people.forEach(p => setRead.run(maxId(cid), cid, p.id));
    }
  })();
  return true;
}

module.exports = { seedDemo, seedAdmin, seedTestUser };
