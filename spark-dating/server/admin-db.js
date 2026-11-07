// Отделна база за администраторите (admin.db): акаунти, 2FA и сесии. Публичният процес НЕ я отваря –
// така пробив в публичния сайт не дава нито админ сесии, нито админ пароли.
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const file = process.env.ADMIN_DB || path.join(DATA_DIR, 'admin.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const adb = new Database(process.env.NODE_ENV === 'test' ? ':memory:' : file);
adb.pragma('journal_mode = WAL');
try { if (process.env.NODE_ENV !== 'test') fs.chmodSync(file, 0o600); } catch { /* ignore */ }
adb.exec(`
  CREATE TABLE IF NOT EXISTS admin_accounts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT NOT NULL,
    totp_secret    TEXT NOT NULL,
    shadow_user_id INTEGER NOT NULL,            -- ред в spark.db с role='admin' (без използваема парола), за журнала на действията
    last_totp_step INTEGER NOT NULL DEFAULT 0,  -- един и същ код не може да се ползва два пъти
    fails          INTEGER NOT NULL DEFAULT 0,
    locked_until   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
`);
module.exports = adb;
