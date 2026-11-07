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

// Стар модел на съобщенията (от един към един) → преименуваме и мигрираме по-долу към разговори.
const legacyMessages = (() => {
  const cols = db.prepare('PRAGMA table_info(messages)').all();
  if (cols.some(c => c.name === 'from_id')) { db.exec('ALTER TABLE messages RENAME TO messages_old'); return true; }
  return false;
})();

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
    email         TEXT,                     -- адресът за потвърждение и известия (виден само на потребителя и в маскиран вид на админ)
    email_key     TEXT,                     -- нормализиран (без точки и +етикет) – за уникалност
    email_verified_at TEXT,                 -- NULL = още не е потвърден → профилът е ограничен
    paused        INTEGER NOT NULL DEFAULT 0,   -- скрит от търсенето, но с достъп до разговорите
    hide_visits   INTEGER NOT NULL DEFAULT 0,   -- не записва посещенията му в чужди профили
    goal          TEXT NOT NULL DEFAULT '',     -- какво търси: serious | dating | friends | open
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

  -- Разговор = личен (двама души) или група (до 12). Съобщенията принадлежат на разговор.
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK (kind IN ('direct','group')),
    title      TEXT NOT NULL DEFAULT '',
    direct_key TEXT UNIQUE,                         -- „малкото:голямото“ id за личните разговори
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
    from_msg_id     INTEGER NOT NULL DEFAULT 0,     -- нов член вижда само съобщенията от присъединяването нататък
    last_read_id    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_cm_user ON conversation_members(user_id);
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user','system')),
    body            TEXT NOT NULL DEFAULT '',
    attachment_id   INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
  -- Прикачени снимки и файлове в чата. Файловете са ЛИЧНИ: достъпни само за членове на разговора (и за админ през доклад).
  CREATE TABLE IF NOT EXISTS attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    stored      TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('image','file')),
    message_id  INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Местоположение на живо: една ред на потребител, трие се при спиране/изтичане.
  CREATE TABLE IF NOT EXISTS live_locations (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    acc        REAL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Лични стикери и икони (качени от телефона или нарисувани). При изпращане файлът се копира като прикачен файл.
  CREATE TABLE IF NOT EXISTS stickers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('sticker','icon')),
    mime       TEXT NOT NULL,
    stored     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_stickers_owner ON stickers(owner_id, kind);

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
    resolved_at   TEXT,
    conversation_id INTEGER,                        -- разговорът, от който е снимката (личен или група)
    conv_title      TEXT NOT NULL DEFAULT '',
    dossier_id      INTEGER REFERENCES dossiers(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, id);

  CREATE TABLE IF NOT EXISTS report_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id     INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    from_reporter INTEGER NOT NULL,
    body          TEXT NOT NULL,
    sent_at       TEXT NOT NULL,
    sender_nick   TEXT,                             -- никнейм на изпращача (в група има и трети хора)
    role          TEXT,                             -- reporter | reported | other | system
    attachment_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_rm_report ON report_messages(report_id, id);

  -- Журнал: кой администратор кога е отварял доклад (и съответно разговора в него).
  -- Сигурностен журнал: неуспешни влизания, блокирани заявки, админ входове (без пароли и лични данни).
  CREATE TABLE IF NOT EXISTS security_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    ip         TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_secev_time ON security_events(created_at);

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    report_id  INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Досие = история на ДОКЛАДВАН профил (създава се при първия доклад). Остава, дори профилът да бъде дерегистриран.
  CREATE TABLE IF NOT EXISTS dossiers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    nickname      TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deregistered','closed')),
    snapshot      TEXT,                             -- JSON: данни към момента на дерегистрация (възраст, място, дата на регистрация…)
    closed_reason TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at     TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_user ON dossiers(user_id) WHERE user_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS dossier_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    admin_nick TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Наказания: предупреждение, временна суспензия или дерегистрация. Потребителят вижда причината и може да обжалва.
  CREATE TABLE IF NOT EXISTS penalties (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dossier_id   INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('warning','suspension','deregistration')),
    reason       TEXT NOT NULL,                     -- показва се на наказания
    note         TEXT NOT NULL DEFAULT '',          -- вътрешна бележка (само за администратори)
    days         INTEGER,
    report_id    INTEGER,
    issued_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    issued_nick  TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    ends_at      TEXT,
    lifted_at    TEXT,
    lifted_note  TEXT NOT NULL DEFAULT '',
    acked_at     TEXT,
    appeal_text  TEXT NOT NULL DEFAULT '',
    appeal_at    TEXT,
    appeal_status TEXT NOT NULL DEFAULT 'none' CHECK (appeal_status IN ('none','pending','accepted','rejected')),
    appeal_note  TEXT NOT NULL DEFAULT '',
    appeal_decided_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pen_user ON penalties(user_id, kind, lifted_at, ends_at);
  CREATE INDEX IF NOT EXISTS idx_pen_dossier ON penalties(dossier_id);
  -- Забранени имейли след дерегистрация. Пази се САМО хеш (HMAC) на нормализирания имейл, не самият адрес.
  CREATE TABLE IF NOT EXISTS banned_emails (
    hash       TEXT PRIMARY KEY,
    dossier_id INTEGER REFERENCES dossiers(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- За да получи дерегистриран потребител ясно съобщение при опит за вход.
  CREATE TABLE IF NOT EXISTS deregistered (
    username_key TEXT PRIMARY KEY,
    dossier_id   INTEGER REFERENCES dossiers(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS email_verifications (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
    hour_start TEXT NOT NULL DEFAULT (datetime('now')),
    hour_count INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS visits (
    visitor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visited_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    PRIMARY KEY (visitor_id, visited_id, day)
  );
  CREATE INDEX IF NOT EXISTS idx_visits_visited ON visits(visited_id, day);

  -- Гласови и видео обаждания (WebRTC). Сървърът само предава сигналите (offer/answer/ICE); медията върви директно между двамата.
  CREATE TABLE IF NOT EXISTS calls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    caller_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    callee_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('audio','video')),
    status          TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended','declined','missed','canceled')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    answered_at     TEXT,
    ended_at        TEXT,
    caller_seen     TEXT NOT NULL DEFAULT (datetime('now')),
    callee_seen     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, status);
  CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id, status);
  CREATE TABLE IF NOT EXISTS call_signals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id    INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    from_id    INTEGER NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('offer','answer','ice')),
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_signals_call ON call_signals(call_id, id);

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

// Миграции за бази, създадени преди новите колони на докладите.
for (const [table, col, ddl] of [
  ['reports', 'conversation_id', 'ALTER TABLE reports ADD COLUMN conversation_id INTEGER'],
  ['reports', 'conv_title', "ALTER TABLE reports ADD COLUMN conv_title TEXT NOT NULL DEFAULT ''"],
  ['report_messages', 'sender_nick', 'ALTER TABLE report_messages ADD COLUMN sender_nick TEXT'],
  ['report_messages', 'role', 'ALTER TABLE report_messages ADD COLUMN role TEXT'],
  ['report_messages', 'attachment_id', 'ALTER TABLE report_messages ADD COLUMN attachment_id INTEGER'],
]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(ddl);
}

// Миграции за бази, създадени преди имейл потвърждението, досиетата и новите настройки.
for (const [col, ddl] of [
  ['email', 'ALTER TABLE users ADD COLUMN email TEXT'],
  ['email_key', 'ALTER TABLE users ADD COLUMN email_key TEXT'],
  ['email_verified_at', 'ALTER TABLE users ADD COLUMN email_verified_at TEXT'],
  ['paused', 'ALTER TABLE users ADD COLUMN paused INTEGER NOT NULL DEFAULT 0'],
  ['hide_visits', 'ALTER TABLE users ADD COLUMN hide_visits INTEGER NOT NULL DEFAULT 0'],
  ['goal', "ALTER TABLE users ADD COLUMN goal TEXT NOT NULL DEFAULT ''"],
  ['hide_distance', 'ALTER TABLE users ADD COLUMN hide_distance INTEGER NOT NULL DEFAULT 0'],
  ['loc_verified_at', 'ALTER TABLE users ADD COLUMN loc_verified_at TEXT'],
  ['place_changed_at', 'ALTER TABLE users ADD COLUMN place_changed_at TEXT'],
]) {
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === col)) {
    db.exec(ddl);
    // Съществуващите акаунти (без имейл) се водят потвърдени, за да не бъдат заключени.
    if (col === 'email_verified_at') db.exec("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL");
  }
}
if (!db.prepare('PRAGMA table_info(attachments)').all().some(c => c.name === 'variant')) {
  db.exec("ALTER TABLE attachments ADD COLUMN variant TEXT NOT NULL DEFAULT ''"); // '', 'sticker' или 'icon'
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email_key) WHERE email_key IS NOT NULL');
if (!db.prepare('PRAGMA table_info(reports)').all().some(c => c.name === 'dossier_id')) db.exec('ALTER TABLE reports ADD COLUMN dossier_id INTEGER REFERENCES dossiers(id) ON DELETE SET NULL');
// Досие за всеки вече докладван профил.
db.transaction(() => {
  const mk = db.prepare('INSERT INTO dossiers (user_id, nickname, status, created_at) VALUES (?, ?, ?, ?)');
  for (const r of db.prepare('SELECT DISTINCT reported_id id, reported_nick nick, MIN(created_at) at FROM reports WHERE dossier_id IS NULL AND reported_id IS NOT NULL GROUP BY reported_id').all()) {
    let d = db.prepare('SELECT id FROM dossiers WHERE user_id = ?').get(r.id);
    if (!d) d = { id: mk.run(r.id, r.nick, 'active', r.at).lastInsertRowid };
    db.prepare('UPDATE reports SET dossier_id = ? WHERE reported_id = ? AND dossier_id IS NULL').run(d.id, r.id);
  }
  for (const r of db.prepare('SELECT reported_nick nick, MIN(created_at) at FROM reports WHERE dossier_id IS NULL AND reported_id IS NULL GROUP BY reported_nick').all()) {
    const id = mk.run(null, r.nick, 'closed', r.at).lastInsertRowid;
    db.prepare('UPDATE reports SET dossier_id = ? WHERE reported_nick = ? AND dossier_id IS NULL AND reported_id IS NULL').run(id, r.nick);
  }
})();

// Старите съобщения (от → към) стават лични разговори; непрочетените остават непрочетени.
if (legacyMessages) {
  db.transaction(() => {
    const old = db.prepare('SELECT * FROM messages_old ORDER BY id').all();
    const convOf = new Map();
    const mkConv = db.prepare("INSERT INTO conversations (kind, direct_key) VALUES ('direct', ?)");
    const mkMember = db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)");
    const ins = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)');
    const firstUnread = new Map(); // "conv:user" -> първото непрочетено ново id
    for (const m of old) {
      const key = m.from_id < m.to_id ? `${m.from_id}:${m.to_id}` : `${m.to_id}:${m.from_id}`;
      let cid = convOf.get(key);
      if (!cid) { cid = mkConv.run(key).lastInsertRowid; convOf.set(key, cid); mkMember.run(cid, m.from_id); mkMember.run(cid, m.to_id); }
      const nid = ins.run(cid, m.from_id, m.body, m.created_at).lastInsertRowid;
      if (!m.read_at && !firstUnread.has(`${cid}:${m.to_id}`)) firstUnread.set(`${cid}:${m.to_id}`, nid);
    }
    const setRead = db.prepare('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?');
    for (const m of db.prepare('SELECT conversation_id c, user_id u FROM conversation_members').all()) {
      const fu = firstUnread.get(`${m.c}:${m.u}`);
      setRead.run(fu ? fu - 1 : db.prepare('SELECT COALESCE(MAX(id),0) x FROM messages WHERE conversation_id = ?').get(m.c).x, m.c, m.u);
    }
    db.exec('DROP TABLE messages_old');
  })();
}

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
