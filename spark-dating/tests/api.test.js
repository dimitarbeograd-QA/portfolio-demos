// API тестове с вграденият node:test. Стартират се с: npm test
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:os').tmpdir() + '/spark-test-');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../server/app');
const { seedDemo, seedAdmin } = require('../server/seed');
seedDemo();
seedAdmin();

let server, base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => new Promise(r => server.close(r)));

// Мини клиент с бисквитки
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = {};
    try { data = await res.json(); } catch { /* */ }
    return { status: res.status, data, headers: res.headers };
  };
}
const adult = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 28); return d.toISOString().slice(0, 10); };
const reg = (over = {}) => ({ username: 'ivan_' + Math.random().toString(36).slice(2, 8), password: 'supersecret1', nickname: 'Иван' + Math.floor(Math.random() * 1e5), birthDate: adult(), gender: 'male', lookingFor: 'female', city: 'София', ...over });

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('meta е публичен и съдържа градове с броя профили', async () => {
  const c = client();
  const r = await c('GET', '/api/meta');
  assert.equal(r.status, 200);
  assert.ok(r.data.cities.find(x => x.name === 'София').count >= 1);
  assert.ok(r.data.interests.length > 5);
});

test('списъкът с хора изисква вход', async () => {
  const r = await client()('GET', '/api/profiles');
  assert.equal(r.status, 401);
});

test('регистрация: валидации', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/register', reg({ password: 'short' }))).status, 400);
  assert.equal((await c('POST', '/api/register', reg({ username: 'a b' }))).status, 400);
  assert.equal((await c('POST', '/api/register', reg({ city: 'Атлантида' }))).status, 400);
  assert.equal((await c('POST', '/api/register', reg({ gender: 'x' }))).status, 400);
  const young = new Date(); young.setFullYear(young.getFullYear() - 17);
  const r = await c('POST', '/api/register', reg({ birthDate: young.toISOString().slice(0, 10) }));
  assert.equal(r.status, 400);
  assert.match(r.data.error, /пълнолетни/);
  assert.equal((await c('POST', '/api/register', reg({ birthDate: '2000-02-31' }))).status, 400);
});

test('регистрация, вход, изход и уникалност', async () => {
  const c = client();
  const body = reg();
  const r = await c('POST', '/api/register', body);
  assert.equal(r.status, 201);
  assert.equal(r.data.user.nickname, body.nickname);
  assert.equal(r.data.user.age, 28);
  assert.ok(!('passwordHash' in r.data.user));

  assert.equal((await c('GET', '/api/me')).data.user.username, body.username);
  assert.equal((await client()('POST', '/api/register', { ...reg(), username: body.username.toUpperCase() })).status, 409);
  assert.equal((await client()('POST', '/api/register', { ...reg(), nickname: body.nickname.toLowerCase() })).status, 409);

  await c('POST', '/api/logout');
  assert.equal((await c('GET', '/api/me')).data.user, null);

  const bad = await c('POST', '/api/login', { username: body.username, password: 'wrongpass' });
  assert.equal(bad.status, 401);
  const ok = await c('POST', '/api/login', { username: body.username, password: body.password });
  assert.equal(ok.status, 200);
});

test('в демо акаунтите не може да се влезе', async () => {
  const demo = require('../server/db').prepare('SELECT username FROM users WHERE is_demo = 1 LIMIT 1').get();
  const r = await client()('POST', '/api/login', { username: demo.username, password: 'whatever123' });
  assert.equal(r.status, 401);
});

test('блокиране след много неуспешни опити', async () => {
  const c = client();
  const u = 'nobody_' + Math.random().toString(36).slice(2, 7);
  let last;
  for (let i = 0; i < 9; i++) last = await c('POST', '/api/login', { username: u, password: 'x'.repeat(10) });
  assert.equal(last.status, 429);
});

test('публичният профил не изтича лични данни', async () => {
  const c = client();
  await c('POST', '/api/register', reg());
  const list = await c('GET', '/api/profiles?limit=5');
  assert.equal(list.status, 200);
  const p = list.data.profiles[0];
  for (const k of ['username', 'birthDate', 'birth_date', 'password_hash', 'theme']) assert.ok(!(k in p), k);
  assert.equal(typeof p.age, 'number');
});

test('филтри: град, пол, възраст, интереси, никнейм', async () => {
  const c = client();
  await c('POST', '/api/register', reg());
  const sofia = await c('GET', '/api/profiles?city=' + encodeURIComponent('София') + '&limit=48');
  assert.ok(sofia.data.total >= 4);
  assert.ok(sofia.data.profiles.every(p => p.city === 'София'));

  const f = await c('GET', '/api/profiles?gender=female&ageMin=25&ageMax=30&limit=48');
  assert.ok(f.data.profiles.length > 0);
  assert.ok(f.data.profiles.every(p => p.gender === 'female' && p.age >= 25 && p.age <= 30));

  const i = await c('GET', '/api/profiles?interest=' + encodeURIComponent('Йога') + '&limit=48');
  assert.ok(i.data.profiles.every(p => p.interests.includes('Йога')));

  const q = await c('GET', '/api/profiles?q=' + encodeURIComponent('мил'));
  assert.ok(q.data.profiles.some(p => p.nickname === 'Мила'));

  assert.equal((await c('GET', '/api/profiles?city=Нищо')).status, 400);
  // SQL-подобни стойности не чупят заявката
  assert.equal((await c('GET', "/api/profiles?q=" + encodeURIComponent("'; DROP TABLE users;--%_"))).status, 200);

  const page1 = await c('GET', '/api/profiles?limit=5&offset=0&sort=new');
  const page2 = await c('GET', '/api/profiles?limit=5&offset=5&sort=new');
  assert.equal(page1.data.profiles.length, 5);
  assert.notEqual(page1.data.profiles[0].id, page2.data.profiles[0].id);
});

test('профил: редакция, био, интереси, валидации', async () => {
  const c = client();
  await c('POST', '/api/register', reg());
  const r = await c('PUT', '/api/me', { bio: '<script>alert(1)</script> Здравей', city: 'Варна', interests: ['Музика', 'Невалиден', 'Йога'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.city, 'Варна');
  assert.deepEqual(r.data.user.interests.sort(), ['Йога', 'Музика']);
  assert.equal(r.data.user.bio, '<script>alert(1)</script> Здравей'); // пази се като текст; клиентът ползва textContent
  assert.equal((await c('PUT', '/api/me', { bio: 'x'.repeat(601) })).status, 400);
  assert.equal((await c('PUT', '/api/me', { nickname: 'Мила' })).status, 409);
});

test('снимки: качване, основна, изтриване, валидации', async () => {
  const c = client();
  await c('POST', '/api/register', reg());
  const up = await c('POST', '/api/me/photos', { dataUrl: PNG });
  assert.equal(up.status, 201);
  assert.equal(up.data.user.photos.length, 1);
  const url = up.data.user.photos[0].url;
  const img = await fetch(base + url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  // фалшив файл с image mime
  const fake = 'data:image/png;base64,' + Buffer.from('това не е картинка, просто текст').toString('base64');
  assert.equal((await c('POST', '/api/me/photos', { dataUrl: fake })).status, 400);
  assert.equal((await c('POST', '/api/me/photos', { dataUrl: 'data:text/html;base64,PGI+' })).status, 400);
  assert.equal((await c('POST', '/api/me/photos', { dataUrl: 'http://evil/x.png' })).status, 400);

  for (let i = 0; i < 5; i++) await c('POST', '/api/me/photos', { dataUrl: PNG });
  const over = await c('POST', '/api/me/photos', { dataUrl: PNG });
  assert.equal(over.status, 400);

  const me = (await c('GET', '/api/me')).data.user;
  assert.equal(me.photos.length, 6);
  const last = me.photos[5].id;
  const main = await c('PUT', `/api/me/photos/${last}/main`);
  assert.equal(main.data.user.photos[0].id, last);
  const del = await c('DELETE', `/api/me/photos/${last}`);
  assert.equal(del.data.user.photos.length, 5);
  assert.equal((await c('DELETE', `/api/me/photos/${last}`)).status, 404);
});

test('чужди снимки не могат да се трият', async () => {
  const a = client(), b = client();
  await a('POST', '/api/register', reg());
  await b('POST', '/api/register', reg());
  const pid = (await a('POST', '/api/me/photos', { dataUrl: PNG })).data.user.photos[0].id;
  assert.equal((await b('DELETE', `/api/me/photos/${pid}`)).status, 404);
  assert.equal((await b('PUT', `/api/me/photos/${pid}/main`)).status, 404);
});

test('тема: приемат се само валидни стойности', async () => {
  const c = client();
  await c('POST', '/api/register', reg());
  const r = await c('PUT', '/api/me/theme', { theme: { text: '#aabbcc', accent: 'red; background:url(x)', fontScale: 999, radius: 10, glow: -5, evil: 'x', animations: false } });
  assert.deepEqual(r.data.theme, { text: '#aabbcc', fontScale: 150, radius: 10, glow: 0, animations: false });
  assert.deepEqual((await c('GET', '/api/me')).data.user.theme, r.data.theme);
});

test('харесвания: включване/изключване и взаимност', async () => {
  const a = client(), b = client();
  const ra = (await a('POST', '/api/register', reg())).data.user;
  const rb = (await b('POST', '/api/register', reg())).data.user;
  const l1 = await a('POST', `/api/profiles/${rb.id}/like`);
  assert.equal(l1.data.profile.liked, true);
  assert.equal(l1.data.profile.likes, 1);
  const seen = await b('GET', `/api/profiles/${ra.id}`);
  assert.equal(seen.data.profile.likedMe, true); // a е харесал b → за b „a ме харесва“
  await b('POST', `/api/profiles/${ra.id}/like`);
  assert.equal((await a('GET', `/api/profiles/${rb.id}`)).data.profile.likedMe, true);
  assert.equal((await a('POST', `/api/profiles/${rb.id}/like`)).data.profile.liked, false);
  assert.equal((await a('POST', `/api/profiles/${ra.id}/like`)).status, 400);
});

test('смяна на парола и изтриване на профил', async () => {
  const c = client();
  const body = reg();
  await c('POST', '/api/register', body);
  assert.equal((await c('PUT', '/api/me/password', { current: 'wrong-pass', next: 'newpassword1' })).status, 403);
  assert.equal((await c('PUT', '/api/me/password', { current: body.password, next: 'short' })).status, 400);
  assert.equal((await c('PUT', '/api/me/password', { current: body.password, next: 'newpassword1' })).status, 200);
  await c('POST', '/api/logout');
  assert.equal((await c('POST', '/api/login', { username: body.username, password: body.password })).status, 401);
  assert.equal((await c('POST', '/api/login', { username: body.username, password: 'newpassword1' })).status, 200);

  await c('POST', '/api/me/photos', { dataUrl: PNG });
  assert.equal((await c('DELETE', '/api/me', { password: 'nope' })).status, 403);
  assert.equal((await c('DELETE', '/api/me', { password: 'newpassword1' })).status, 200);
  assert.equal((await c('GET', '/api/me')).data.user, null);
  assert.equal((await client()('POST', '/api/login', { username: body.username, password: 'newpassword1' })).status, 401);
});

test('защитни хедъри и бисквитка', async () => {
  const c = client();
  const r = await c('POST', '/api/register', reg());
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(r.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('вход без парола е изключен по подразбиране', async () => {
  delete process.env.DEMO_ADMIN;
  const c = client();
  assert.equal((await c('GET', '/api/meta')).data.demoAdmin, false);
  assert.equal((await c('POST', '/api/demo-admin')).status, 404);
  // и админът не може да влезе с парола
  assert.equal((await c('POST', '/api/login', { username: 'admin', password: 'admin' })).status, 401);
});

test('DEMO_ADMIN=1: вход без парола и админ панел', async () => {
  process.env.DEMO_ADMIN = '1';
  try {
    const c = client();
    assert.equal((await c('GET', '/api/meta')).data.demoAdmin, true);
    const r = await c('POST', '/api/demo-admin');
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'admin');

    const st = await c('GET', '/api/admin/stats');
    assert.equal(st.status, 200);
    assert.ok(st.data.users >= 38 && st.data.demo >= 38 && Array.isArray(st.data.byCity));

    const list = await c('GET', '/api/admin/users?q=' + encodeURIComponent('мил'));
    assert.ok(list.data.users.some(u => u.nickname === 'Мила' && 'username' in u));

    // админът не е в публичните списъци, нито в броя градове
    const pub = await c('GET', '/api/profiles?limit=48&q=' + encodeURIComponent('админ'));
    assert.equal(pub.data.profiles.length, 0);

    // изтриване на потребител, но не и на админ
    const u = client();
    const created = (await u('POST', '/api/register', reg())).data.user;
    assert.equal((await c('DELETE', `/api/admin/users/${created.id}`)).status, 200);
    assert.equal((await u('GET', '/api/me')).data.user, null);
    const adminId = r.data.user.id;
    assert.equal((await c('DELETE', `/api/admin/users/${adminId}`)).status, 403);
  } finally { delete process.env.DEMO_ADMIN; }
});

test('админ маршрутите са затворени за обикновени потребители', async () => {
  process.env.DEMO_ADMIN = '1';
  try {
    const c = client();
    assert.equal((await c('GET', '/api/admin/stats')).status, 401);
    await c('POST', '/api/register', reg());
    assert.equal((await c('GET', '/api/admin/stats')).status, 403);
    assert.equal((await c('GET', '/api/admin/users')).status, 403);
    assert.equal((await c('DELETE', '/api/admin/users/1')).status, 403);
    assert.equal((await c('GET', '/api/me')).data.user.role, 'user');
  } finally { delete process.env.DEMO_ADMIN; }
});

// ───────── Чат, блокиране и доклади ─────────
async function two() {
  const a = client(), b = client();
  const ua = (await a('POST', '/api/register', reg())).data.user;
  const ub = (await b('POST', '/api/register', reg())).data.user;
  return { a, b, ua, ub };
}
async function adminClient() {
  process.env.DEMO_ADMIN = '1';
  const c = client();
  await c('POST', '/api/demo-admin');
  delete process.env.DEMO_ADMIN;
  return c;
}

test('чат: изпращане, непрочетени, прочитане', async () => {
  const { a, b, ua, ub } = await two();
  assert.equal((await a('POST', `/api/chats/${ub.id}`, { body: '  Здравей!  ' })).status, 201);
  assert.equal((await b('GET', '/api/chats/unread')).data.unread, 1);
  const list = await b('GET', '/api/chats');
  assert.equal(list.data.chats[0].profile.id, ua.id);
  assert.equal(list.data.chats[0].unread, 1);
  assert.equal(list.data.chats[0].last.body, 'Здравей!');
  const thread = await b('GET', `/api/chats/${ua.id}`);
  assert.deepEqual(thread.data.messages.map(m => [m.body, m.mine]), [['Здравей!', false]]);
  assert.equal((await b('GET', '/api/chats/unread')).data.unread, 0);
  await b('POST', `/api/chats/${ua.id}`, { body: 'Здрасти' });
  assert.deepEqual((await a('GET', `/api/chats/${ub.id}`)).data.messages.map(m => m.mine), [true, false]);
});

test('чат: валидации, себе си, админ, лимит и без вход', async () => {
  const { a, ua, ub } = await two();
  assert.equal((await client()('GET', '/api/chats')).status, 401);
  assert.equal((await a('POST', `/api/chats/${ub.id}`, { body: '   ' })).status, 400);
  assert.equal((await a('POST', `/api/chats/${ub.id}`, { body: 'x'.repeat(1001) })).status, 400);
  assert.equal((await a('POST', `/api/chats/${ua.id}`, { body: 'сам на себе си' })).status, 403);
  const adminId = require('../server/db').prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
  assert.equal((await a('POST', `/api/chats/${adminId}`, { body: 'здрасти админ' })).status, 403);
  assert.equal((await a('GET', '/api/chats/999999')).status, 404);
  let last;
  for (let i = 0; i < 22; i++) last = await a('POST', `/api/chats/${ub.id}`, { body: 'спам ' + i });
  assert.equal(last.status, 429);
});

test('доклад: валидации и дубликати', async () => {
  const { a, ua, ub } = await two();
  assert.equal((await client()('POST', `/api/profiles/${ub.id}/report`, { reason: 'spam' })).status, 401);
  assert.equal((await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'измислено' })).status, 400);
  assert.equal((await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'spam', details: 'x'.repeat(501) })).status, 400);
  assert.equal((await a('POST', `/api/profiles/${ua.id}/report`, { reason: 'spam' })).status, 400);
  assert.equal((await a('POST', '/api/profiles/999999/report', { reason: 'spam' })).status, 404);
  assert.equal((await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'spam', details: 'тест' })).status, 201);
  assert.equal((await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'spam' })).status, 409);
});

test('доклад: админът вижда казуса и снимка на разговора, журналът го записва', async () => {
  const { a, b, ua, ub } = await two();
  await b('POST', `/api/chats/${ua.id}`, { body: 'Купи от мен: shop.example' });
  await a('POST', `/api/chats/${ub.id}`, { body: 'Не, благодаря' });
  await b('POST', `/api/chats/${ua.id}`, { body: 'Последен шанс!!!' });
  await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'scam', details: 'Опитва да ми продаде нещо' });
  // съобщение СЛЕД доклада не влиза в снимката
  await b('POST', `/api/chats/${ua.id}`, { body: 'по-късно съобщение' });

  const admin = await adminClient();
  const list = await admin('GET', '/api/admin/reports?status=open');
  assert.equal(list.status, 200);
  const item = list.data.reports.find(r => r.reportedNick === ub.nickname);
  assert.ok(item && item.status === 'open' && item.messages === 3 && item.reasonLabel);
  assert.ok(list.data.counts.open >= 3); // 2 примерни + този

  const d1 = await admin('GET', `/api/admin/reports/${item.id}`);
  assert.deepEqual(d1.data.messages.map(m => [m.fromReporter, m.body]),
    [[false, 'Купи от мен: shop.example'], [true, 'Не, благодаря'], [false, 'Последен шанс!!!']]);
  assert.equal(d1.data.messages[0].from, ub.nickname);
  assert.equal(d1.data.report.details, 'Опитва да ми продаде нещо');
  assert.equal(d1.data.reported.nickname, ub.nickname);
  assert.equal(d1.data.views, 1);
  assert.equal((await admin('GET', `/api/admin/reports/${item.id}`)).data.views, 2);

  // решение
  assert.equal((await admin('PUT', `/api/admin/reports/${item.id}`, { status: 'upheld', note: 'Явна измама.' })).status, 200);
  const d2 = (await admin('GET', `/api/admin/reports/${item.id}`)).data.report;
  assert.equal(d2.status, 'upheld'); assert.equal(d2.adminNote, 'Явна измама.'); assert.ok(d2.resolvedAt);
  assert.equal((await admin('PUT', `/api/admin/reports/${item.id}`, { status: 'нищо' })).status, 400);
  assert.equal((await admin('PUT', `/api/admin/reports/999999`, { status: 'open' })).status, 404);
  assert.equal((await admin('PUT', `/api/admin/reports/${item.id}`, { status: 'open' })).status, 200);
});

test('админът НЕ може да чете произволни чатове', async () => {
  const { a, ua, ub } = await two();
  await a('POST', `/api/chats/${ub.id}`, { body: 'лично съобщение' });
  const admin = await adminClient();
  // чат маршрутите връщат само собствените разговори на админа (няма такива)
  assert.equal((await admin('GET', `/api/chats/${ub.id}`)).data.messages.length, 0);
  assert.equal((await admin('GET', '/api/chats')).data.chats.length, 0);
  assert.equal((await admin('GET', `/api/admin/chats/${ua.id}`)).status, 404);
  // без доклад съобщението не е достъпно никъде в админ API
  const all = JSON.stringify((await admin('GET', '/api/admin/reports?status=all')).data);
  assert.ok(!all.includes('лично съобщение'));
});

test('докладите са само за админ', async () => {
  const { a, ub } = await two();
  await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'spam' });
  assert.equal((await a('GET', '/api/admin/reports')).status, 403);
  assert.equal((await a('GET', '/api/admin/reports/1')).status, 403);
  assert.equal((await a('PUT', '/api/admin/reports/1', { status: 'dismissed' })).status, 403);
  assert.equal((await client()('GET', '/api/admin/reports')).status, 401);
});

test('блокиране при доклад: без чат, без профил, без списък', async () => {
  const { a, b, ua, ub } = await two();
  assert.equal((await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'harassment', block: true })).data.blocked, true);
  assert.equal((await b('POST', `/api/chats/${ua.id}`, { body: 'здрасти' })).status, 403);
  assert.equal((await a('POST', `/api/chats/${ub.id}`, { body: 'здрасти' })).status, 403);
  assert.equal((await a('GET', `/api/profiles/${ub.id}`)).status, 404);
  assert.equal((await b('GET', `/api/profiles/${ua.id}`)).status, 404);
  assert.equal((await b('POST', `/api/profiles/${ua.id}/like`)).status, 404);
  const seen = (await a('GET', '/api/profiles?limit=48&sort=new')).data.profiles;
  assert.ok(!seen.some(p => p.id === ub.id));
});

test('доказателствата остават, когато докладваният изтрие акаунта си', async () => {
  const { a, b, ua, ub } = await two();
  const pass = 'supersecret1';
  await b('POST', `/api/chats/${ua.id}`, { body: 'неприлично съобщение' });
  await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'harassment' });
  assert.equal((await b('DELETE', '/api/me', { password: pass })).status, 200);
  const admin = await adminClient();
  const rep = (await admin('GET', '/api/admin/reports?status=open')).data.reports.find(r => r.reportedNick === ub.nickname);
  assert.ok(rep);
  const d = (await admin('GET', `/api/admin/reports/${rep.id}`)).data;
  assert.equal(d.report.reportedStillExists, false);
  assert.equal(d.reported, null);
  assert.equal(d.messages[0].body, 'неприлично съобщение');
});

test('примерните доклади са заредени и броят отворени е в статистиката', async () => {
  const admin = await adminClient();
  assert.ok((await admin('GET', '/api/admin/stats')).data.openReports >= 2);
  assert.ok((await admin('GET', '/api/chats/unread')).data.openReports >= 2);
});
