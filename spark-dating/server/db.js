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
    city          TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    theme         TEXT,                     -- JSON с персонални цветове/шрифт
    is_demo       INTEGER NOT NULL DEFAULT 0,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_users_city ON users(city);

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

module.exports = db;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
