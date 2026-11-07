const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const isTest = process.env.NODE_ENV === 'test';
const db = new Database(isTest ? ':memory:' : path.join(DATA_DIR, 'spark.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    nickname      TEXT NOT NULL,
    nickname_key  TEXT NOT NULL UNIQUE,     -- toLowerCase() от JS: SQLite NOCASE/LIKE не знае кирилица
    birth_date    TEXT NOT NULL,            -- YYYY-MM-DD, никога не се връща на другите
    gender        TEXT NOT NULL CHECK (gender IN ('male','female','other')),
    looking_for   TEXT NOT NULL DEFAULT 'any' CHECK (looking_for IN ('male','female','any')),
    city          TEXT NOT NULL,            -- етикет на населеното място (напр. „Пловдив“ или „с. Дъбница“)
    place_id      TEXT NOT NULL DEFAULT '', -- ЕКАТТЕ код на населеното място
    region        TEXT NOT NULL DEFAULT '', -- код на областта (напр. PDV)
    bio           TEXT NOT NULL DEFAULT '',
    theme         TEXT,                     -- JSON с персонални цветове/шрифт
    is_demo       INTEGER NOT NULL DEFAULT 0,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_interests (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interest TEXT NOT NULL,
    PRIMARY KEY (user_id, interest)
  );

  CREATE TABLE IF NOT EXISTS photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id, position);

  CREATE TABLE IF NOT EXISTS likes (
    from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (from_id, to_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(from_id, to_id, id);
  CREATE INDEX IF NOT EXISTS idx_msg_unread ON messages(to_id, read_at);

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (blocker_id, blocked_id)
  );

  -- Докладите пазят никнеймовете и снимка на разговора: остават читаеми дори ако някой изтрие акаунта си.
  CREATE TABLE IF NOT EXISTS reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reported_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reporter_nick TEXT NOT NULL,
    reported_nick TEXT NOT NULL,
    reason        TEXT NOT NULL,
    details       TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')),
    admin_note    TEXT NOT NULL DEFAULT '',
    resolved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, id);

  CREATE TABLE IF NOT EXISTS report_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id     INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    from_reporter INTEGER NOT NULL,
    body          TEXT NOT NULL,
    sent_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rm_report ON report_messages(report_id, id);

  -- Журнал: кой администратор кога е отварял доклад (и съответно разговора в него).
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    report_id  INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

// Миграция за бази, създадени преди колоната role.
if (!db.prepare("PRAGMA table_info(users)").all().some(c => c.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

// Миграция за бази, създадени преди областите и населените места.
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'place_id')) {
  db.exec("ALTER TABLE users ADD COLUMN place_id TEXT NOT NULL DEFAULT ''; ALTER TABLE users ADD COLUMN region TEXT NOT NULL DEFAULT '';");
  const { findPlace } = require('./places');
  const upd = db.prepare('UPDATE users SET place_id = ?, region = ? WHERE id = ?');
  for (const u of db.prepare('SELECT id, city FROM users').all()) {
    const p = findPlace(u.city);
    if (p) upd.run(p.id, p.region, u.id);
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_users_place ON users(place_id); CREATE INDEX IF NOT EXISTS idx_users_region ON users(region);');

module.exports = db;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
