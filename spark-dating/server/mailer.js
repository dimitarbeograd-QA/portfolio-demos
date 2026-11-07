// Изпращане на имейли.
//  • SMTP_URL (напр. smtps://user:pass@smtp.example.com) → истински имейли чрез nodemailer.
//  • Без SMTP_URL → „dev“ режим: писмото се записва в таблицата outbox и в конзолата, а кодът за потвърждение се връща на
//    интерфейса (само за демо/разработка). В production dev режимът е забранен, освен ако изрично е MAIL_DEV=1.
const db = require('./db');

const isProd = process.env.NODE_ENV === 'production';
const smtp = process.env.SMTP_URL || '';
const mode = smtp ? 'smtp' : 'dev';
if (isProd && mode === 'dev' && process.env.MAIL_DEV !== '1') {
  throw new Error('В production е нужен SMTP_URL (истински имейли за потвърждение). За тест без пощенски сървър: MAIL_DEV=1.');
}
const from = process.env.MAIL_FROM || 'Spark <no-reply@spark.local>';
let transport = null;
const getTransport = () => transport || (transport = require('nodemailer').createTransport(smtp));

db.exec(`CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

// Не чака доставката (SMTP може да е бавен); грешките се логват, а потребителят може да поиска нов код.
function send({ to, subject, text }) {
  if (mode === 'dev') {
    db.prepare('INSERT INTO outbox (to_email, subject, body) VALUES (?, ?, ?)').run(to, subject, text);
    db.prepare("DELETE FROM outbox WHERE created_at < datetime('now', '-2 days')").run();
    if (process.env.NODE_ENV !== 'test') console.log(`✉ [dev поща] до ${to}: ${subject}\n${text}\n`);
    return;
  }
  getTransport().sendMail({ from, to, subject, text }).catch(e => console.error('Грешка при изпращане на имейл:', e.message));
}

module.exports = { send, mode };
