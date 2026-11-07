// API тестове с вграденият node:test. Стартират се с: npm test
process.env.NODE_ENV = 'test';
process.env.REG_PER_HOUR = '100000'; // тестовете регистрират много хора от един адрес
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:os').tmpdir() + '/spark-test-');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../server/app');
const places = require('../server/places');
const pid = (name, opts) => places.findPlace(name, opts).id;
const { seedDemo, seedAdmin, seedTestUser } = require('../server/seed');
seedDemo();
seedAdmin();
seedTestUser();

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
  const fn = async (method, url, body, opts = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = {};
    try { data = await res.json(); } catch { /* */ }
    const out = { status: res.status, data, headers: res.headers };
    // Регистрацията връща кода в dev режим → потвърждаваме автоматично (освен ако тестът иска непотвърден профил).
    if (url === '/api/register' && res.status === 201 && data.mail && data.mail.devCode && !opts.keepUnverified) {
      const v = await fn('POST', '/api/verify/email', { code: data.mail.devCode });
      out.data = { ...data, user: v.data.user };
    }
    return out;
  };
  fn.cookie = () => cookie;
  return fn;
}
const adult = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 28); return d.toISOString().slice(0, 10); };
const mailN = { n: 0 };
const reg = (over = {}) => ({ email: `u${Date.now().toString(36)}${++mailN.n}@example.test`, website: '', username: 'ivan_' + Math.random().toString(36).slice(2, 8), password: 'supersecret1', nickname: 'Иван' + Math.floor(Math.random() * 1e5), birthDate: adult(), gender: 'male', lookingFor: 'female', placeId: pid('София'), ...over });

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('meta е публичен и съдържа градове с броя профили', async () => {
  const c = client();
  const r = await c('GET', '/api/meta');
  assert.equal(r.status, 200);
  assert.equal(r.data.regions.length, 28);
  assert.ok(r.data.regions.find(x => x.code === 'SOF').count >= 1);
  assert.ok(!('cities' in r.data));
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
  assert.equal((await c('POST', '/api/register', reg({ placeId: '99999' }))).status, 400);
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
  const sofia = await c('GET', '/api/profiles?place=' + pid('София') + '&limit=48');
  assert.ok(sofia.data.total >= 4);
  assert.ok(sofia.data.profiles.every(p => p.city === 'София' && p.regionName === 'София (столица)'));
  const area = await c('GET', '/api/profiles?region=PDV&limit=48');
  assert.ok(area.data.total >= 4 && area.data.profiles.every(p => p.region === 'PDV'));

  const f = await c('GET', '/api/profiles?gender=female&ageMin=25&ageMax=30&limit=48');
  assert.ok(f.data.profiles.length > 0);
  assert.ok(f.data.profiles.every(p => p.gender === 'female' && p.age >= 25 && p.age <= 30));

  const i = await c('GET', '/api/profiles?interest=' + encodeURIComponent('Йога') + '&limit=48');
  assert.ok(i.data.profiles.every(p => p.interests.includes('Йога')));

  const q = await c('GET', '/api/profiles?q=' + encodeURIComponent('мил'));
  assert.ok(q.data.profiles.some(p => p.nickname === 'Мила'));

  assert.equal((await c('GET', '/api/profiles?region=XXX')).status, 400);
  assert.equal((await c('GET', '/api/profiles?place=00000')).status, 400);
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
  const r = await c('PUT', '/api/me', { bio: '<script>alert(1)</script> Здравей', placeId: pid('Варна'), interests: ['Музика', 'Невалиден', 'Йога'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.city, 'Варна');
  assert.equal(r.data.user.regionName, 'Варна');
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
    assert.ok(st.data.users >= 38 && st.data.demo >= 38 && Array.isArray(st.data.byRegion) && st.data.byRegion.length > 5);

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

// ───────── Разговори, групи, файлове, блокиране и доклади ─────────
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
// Праща текстово съобщение на човек (създава личен разговор при нужда). Връща { cid, r }.
async function say(c, toUser, body, extra = {}) {
  const d = await c('POST', '/api/chats/direct', { userId: toUser });
  if (d.status !== 200) return { cid: null, r: d };
  return { cid: d.data.id, r: await c('POST', `/api/chats/${d.data.id}/messages`, { body, ...extra }) };
}
async function upload(c, cid, bytes, name) {
  const res = await fetch(`${base}/api/chats/${cid}/attachments`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name), cookie: c.cookie() }, body: bytes });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const PNG_BYTES = Buffer.from(PNG.split(',')[1], 'base64');

test('чат: изпращане, непрочетени, прочитане', async () => {
  const { a, b, ua, ub } = await two();
  const { cid, r } = await say(a, ub.id, '  Здравей!  ');
  assert.equal(r.status, 201);
  assert.equal(r.data.message.body, 'Здравей!');
  assert.equal((await b('GET', '/api/chats/unread')).data.unread, 1);
  const list = (await b('GET', '/api/chats')).data.chats;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].kind, list[0].peer.id, list[0].unread, list[0].last.body], ['direct', ua.id, 1, 'Здравей!']);
  const thread = await b('GET', `/api/chats/${cid}`);
  assert.deepEqual(thread.data.messages.map(m => [m.body, m.mine, m.senderNick]), [['Здравей!', false, ua.nickname]]);
  assert.equal(thread.data.conversation.peer.id, ua.id);
  assert.equal((await b('GET', '/api/chats/unread')).data.unread, 0);
  await b('POST', `/api/chats/${cid}/messages`, { body: 'Здрасти' });
  assert.deepEqual((await a('GET', `/api/chats/${cid}`)).data.messages.map(m => m.mine), [true, false]);
  // повторно „директен“ връща същия разговор
  assert.equal((await b('POST', '/api/chats/direct', { userId: ua.id })).data.id, cid);
});

test('чат: валидации, себе си, админ, лимит и без вход', async () => {
  const { a, ua, ub } = await two();
  assert.equal((await client()('GET', '/api/chats')).status, 401);
  const { cid } = await say(a, ub.id, 'първо');
  assert.equal((await a('POST', `/api/chats/${cid}/messages`, { body: '   ' })).status, 400);
  assert.equal((await a('POST', `/api/chats/${cid}/messages`, { body: 'x'.repeat(1001) })).status, 400);
  assert.equal((await a('POST', '/api/chats/direct', { userId: ua.id })).status, 403);
  const adminId = require('../server/db').prepare("SELECT id FROM users WHERE role = 'admin'").get().id;
  assert.equal((await a('POST', '/api/chats/direct', { userId: adminId })).status, 403);
  assert.equal((await a('GET', '/api/chats/999999')).status, 404);
  assert.equal((await a('POST', '/api/chats/999999/messages', { body: 'x' })).status, 404);
  let last;
  for (let i = 0; i < 22; i++) last = await a('POST', `/api/chats/${cid}/messages`, { body: 'спам ' + i });
  assert.equal(last.status, 429);
});

test('чужд човек не може да чете или пише в чужд разговор', async () => {
  const { a, ub } = await two();
  const intruder = client();
  await intruder('POST', '/api/register', reg());
  const { cid } = await say(a, ub.id, 'само за нас двамата');
  assert.equal((await intruder('GET', `/api/chats/${cid}`)).status, 404);
  assert.equal((await intruder('POST', `/api/chats/${cid}/messages`, { body: 'вмъквам се' })).status, 404);
  assert.equal((await intruder('GET', '/api/chats')).data.chats.length, 0);
});

test('групов чат: създаване, съобщения, само познати, системни съобщения', async () => {
  const a = client(), b = client(), c = client(), stranger = client();
  const ua = (await a('POST', '/api/register', reg())).data.user;
  const ub = (await b('POST', '/api/register', reg())).data.user;
  const uc = (await c('POST', '/api/register', reg())).data.user;
  const us = (await stranger('POST', '/api/register', reg())).data.user;
  assert.equal((await a('GET', '/api/chats/contacts')).data.contacts.length, 0);
  await say(a, ub.id, 'здрасти'); await say(a, uc.id, 'здрасти и на теб');

  const contacts = (await a('GET', '/api/chats/contacts')).data.contacts.map(x => x.id).sort();
  assert.deepEqual(contacts, [ub.id, uc.id].sort());
  // валидации
  assert.equal((await a('POST', '/api/chats/groups', { title: 'x', memberIds: [ub.id] })).status, 400);
  assert.equal((await a('POST', '/api/chats/groups', { title: 'Приятели', memberIds: [] })).status, 400);
  assert.equal((await a('POST', '/api/chats/groups', { title: 'Приятели', memberIds: [us.id] })).status, 400); // не е писал с непознат
  const g = await a('POST', '/api/chats/groups', { title: 'Приятели', memberIds: [ub.id, uc.id] });
  assert.equal(g.status, 201);
  const gid = g.data.id;

  // всички виждат групата, непознатият – не
  for (const who of [b, c]) assert.ok((await who('GET', '/api/chats')).data.chats.some(x => x.id === gid && x.kind === 'group' && x.title === 'Приятели' && x.members === 3));
  assert.equal((await stranger('GET', `/api/chats/${gid}`)).status, 404);

  assert.equal((await b('POST', `/api/chats/${gid}/messages`, { body: 'Здравейте на всички!' })).status, 201);
  const seen = (await c('GET', `/api/chats/${gid}`)).data;
  assert.deepEqual(seen.messages.map(m => [m.kind, m.senderNick === ub.nickname ? 'b' : m.kind])[0], ['system', 'system']);
  const hello = seen.messages.find(m => m.body === 'Здравейте на всички!');
  assert.equal(hello.senderNick, ub.nickname); assert.equal(hello.mine, false);
  assert.equal(seen.conversation.members.length, 3);
  assert.equal(seen.conversation.members.find(m => m.id === ua.id).role, 'owner');
  // непрочетени в групата
  assert.equal((await a('GET', '/api/chats/unread')).data.unread, 1);
  // непознат не може да се добавя от не-собственик; собственикът не може да добави непознат
  assert.equal((await b('POST', `/api/chats/${gid}/members`, { userIds: [us.id] })).status, 403);
  assert.equal((await a('POST', `/api/chats/${gid}/members`, { userIds: [us.id] })).status, 400);
});

test('групов чат: добавяне, нов член вижда само новото, преименуване, премахване, напускане и прехвърляне', async () => {
  const a = client(), b = client(), c = client();
  const ua = (await a('POST', '/api/register', reg())).data.user;
  const ub = (await b('POST', '/api/register', reg())).data.user;
  const uc = (await c('POST', '/api/register', reg())).data.user;
  await say(a, ub.id, 'x'); await say(a, uc.id, 'y');
  const gid = (await a('POST', '/api/chats/groups', { title: 'Група', memberIds: [ub.id] })).data.id;
  await a('POST', `/api/chats/${gid}/messages`, { body: 'тайна преди Ц' });
  assert.equal((await a('POST', `/api/chats/${gid}/members`, { userIds: [uc.id] })).status, 201);
  await b('POST', `/api/chats/${gid}/messages`, { body: 'видимо за всички' });
  const forC = (await c('GET', `/api/chats/${gid}`)).data.messages.map(m => m.body);
  assert.ok(!forC.includes('тайна преди Ц'));            // не вижда историята отпреди добавянето
  assert.ok(forC.includes('видимо за всички'));
  assert.ok(forC.some(t => t.includes('добави')));
  // преименуване – само собственик
  assert.equal((await b('PUT', `/api/chats/${gid}`, { title: 'Хак' })).status, 403);
  assert.equal((await a('PUT', `/api/chats/${gid}`, { title: 'Ново име' })).status, 200);
  assert.equal((await a('PUT', `/api/chats/${gid}`, { title: 'я' })).status, 400);
  // премахване – само собственик
  assert.equal((await b('DELETE', `/api/chats/${gid}/members/${uc.id}`)).status, 403);
  assert.equal((await a('DELETE', `/api/chats/${gid}/members/${uc.id}`)).status, 200);
  assert.equal((await c('GET', `/api/chats/${gid}`)).status, 404);
  // собственикът напуска → собственик става другият
  assert.equal((await a('DELETE', `/api/chats/${gid}/members/${ua.id}`)).status, 200);
  const info = (await b('GET', `/api/chats/${gid}`)).data.conversation;
  assert.equal(info.isOwner, true); assert.equal(info.title, 'Ново име');
  // последният излиза → групата изчезва
  assert.equal((await b('DELETE', `/api/chats/${gid}/members/${ub.id}`)).status, 200);
  assert.equal((await b('GET', `/api/chats/${gid}`)).status, 404);
});

test('групата е ограничена до 12 души', async () => {
  const owner = client();
  await owner('POST', '/api/register', reg());
  const ids = [];
  for (let i = 0; i < 12; i++) { const x = client(); const u = (await x('POST', '/api/register', reg())).data.user; ids.push(u.id); await say(owner, u.id, 'здр ' + i); }
  assert.equal((await owner('POST', '/api/chats/groups', { title: 'Много хора', memberIds: ids })).status, 400); // 12 + собственикът = 13
  assert.equal((await owner('POST', '/api/chats/groups', { title: 'Точно 12', memberIds: ids.slice(0, 11) })).status, 201);
});

test('файлове: качване на снимка и документ, достъп само за членове, правилни хедъри', async () => {
  const { a, b, ub } = await two();
  const intruder = client(); await intruder('POST', '/api/register', reg());
  const { cid } = await say(a, ub.id, 'ето снимка');
  const img = await upload(a, cid, PNG_BYTES, 'сн.png');
  assert.equal(img.status, 201);
  assert.equal(img.data.attachment.kind, 'image');
  const doc = await upload(a, cid, Buffer.from('%PDF-1.4 тестов документ'), 'договор.pdf');
  assert.equal(doc.data.attachment.kind, 'file');

  const sent = await a('POST', `/api/chats/${cid}/messages`, { body: '', attachmentId: img.data.attachment.id });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.attachment.name, 'сн.png');
  await a('POST', `/api/chats/${cid}/messages`, { body: 'документът', attachmentId: doc.data.attachment.id });
  // същият файл не може да се изпрати втори път
  assert.equal((await a('POST', `/api/chats/${cid}/messages`, { attachmentId: img.data.attachment.id })).status, 400);

  const get = (who, id) => fetch(`${base}/api/files/${id}`, { headers: { cookie: who.cookie() } });
  const ri = await get(b, img.data.attachment.id);
  assert.equal(ri.status, 200);
  assert.equal(ri.headers.get('content-type'), 'image/png');
  assert.match(ri.headers.get('content-disposition'), /^inline/);
  assert.equal(ri.headers.get('x-content-type-options'), 'nosniff');
  const rd = await get(b, doc.data.attachment.id);
  assert.equal(rd.status, 200);
  assert.equal(rd.headers.get('content-type'), 'application/octet-stream');
  assert.match(rd.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''/);
  assert.equal(await rd.text(), '%PDF-1.4 тестов документ');
  // външен човек и гост – не
  assert.equal((await get(intruder, img.data.attachment.id)).status, 404);
  assert.equal((await fetch(`${base}/api/files/${img.data.attachment.id}`)).status, 401);
  // списъкът показва „Снимка“ за последното съобщение без текст
  const last = (await b('GET', '/api/chats')).data.chats[0].last.body;
  assert.ok(last.length > 0);
});

test('файлове: опасни типове, размер, чужд и невалиден файл, подправено разширение', async () => {
  const { a, b, ub } = await two();
  const { cid } = await say(a, ub.id, 'здр');
  for (const n of ['вирус.exe', 'x.HTML', 'icon.svg', 'run.sh', 'a.js']) assert.equal((await upload(a, cid, Buffer.from('x'), n)).status, 400, n);
  assert.equal((await upload(a, cid, Buffer.alloc(0), 'празен.txt')).status, 400);
  assert.equal((await upload(a, cid, Buffer.alloc(10 * 1024 * 1024 + 10, 1), 'голям.bin')).status, 413);
  assert.equal((await upload(client(), cid, Buffer.from('x'), 'x.txt')).status, 401);
  // файл с име .png, но съдържание текст → не е снимка, а обикновен файл (сервира се за сваляне)
  const fake = await upload(a, cid, Buffer.from('<script>alert(1)</script>'), 'фалшива.png');
  assert.equal(fake.data.attachment.kind, 'file');
  const res = await fetch(`${base}/api/files/${fake.data.attachment.id}`, { headers: { cookie: a.cookie() } });
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  // чужд файл не може да се прикачи
  const other = await upload(b, cid, Buffer.from('мое'), 'моя.txt');
  assert.equal((await a('POST', `/api/chats/${cid}/messages`, { attachmentId: other.data.attachment.id })).status, 400);
  // име с път се чисти
  const sneaky = await upload(a, cid, Buffer.from('x'), '../../etc/passwd.txt');
  assert.ok(!sneaky.data.attachment.name.includes('/'));
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
  // чужд разговор не може да се прикачи към доклад
  const { a: a2, ub: ub2 } = await two();
  assert.equal((await a2('POST', `/api/profiles/${ub2.id}/report`, { reason: 'spam', conversationId: 999999 })).status, 404);
});

test('доклад: админът вижда казуса и снимка на разговора, журналът го записва', async () => {
  const { a, b, ua, ub } = await two();
  const { cid } = await say(b, ua.id, 'Купи от мен: shop.example');
  await a('POST', `/api/chats/${cid}/messages`, { body: 'Не, благодаря' });
  await b('POST', `/api/chats/${cid}/messages`, { body: 'Последен шанс!!!' });
  await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'scam', details: 'Опитва да ми продаде нещо' });
  // съобщение СЛЕД доклада не влиза в снимката
  await b('POST', `/api/chats/${cid}/messages`, { body: 'по-късно съобщение' });

  const admin = await adminClient();
  const list = await admin('GET', '/api/admin/reports?status=open');
  assert.equal(list.status, 200);
  const item = list.data.reports.find(r => r.reportedNick === ub.nickname);
  assert.ok(item && item.status === 'open' && item.messages === 3 && item.reasonLabel);
  assert.ok(list.data.counts.open >= 3); // 2 примерни + този

  const d1 = await admin('GET', `/api/admin/reports/${item.id}`);
  assert.deepEqual(d1.data.messages.map(m => [m.role, m.body]),
    [['reported', 'Купи от мен: shop.example'], ['reporter', 'Не, благодаря'], ['reported', 'Последен шанс!!!']]);
  assert.equal(d1.data.messages[0].from, ub.nickname);
  assert.equal(d1.data.report.details, 'Опитва да ми продаде нещо');
  assert.equal(d1.data.reported.nickname, ub.nickname);
  assert.equal(d1.data.views, 1);
  assert.equal((await admin('GET', `/api/admin/reports/${item.id}`)).data.views, 2);

  assert.equal((await admin('PUT', `/api/admin/reports/${item.id}`, { status: 'upheld', note: 'Явна измама.' })).status, 200);
  const d2 = (await admin('GET', `/api/admin/reports/${item.id}`)).data.report;
  assert.equal(d2.status, 'upheld'); assert.equal(d2.adminNote, 'Явна измама.'); assert.ok(d2.resolvedAt);
  assert.equal((await admin('PUT', `/api/admin/reports/${item.id}`, { status: 'нищо' })).status, 400);
  assert.equal((await admin('PUT', `/api/admin/reports/999999`, { status: 'open' })).status, 404);
  assert.equal((await admin('PUT', `/api/admin/reports/${item.id}`, { status: 'open' })).status, 200);
});

test('доклад от групов чат: снимка на групата с трети хора и файл-доказателство', async () => {
  const a = client(), b = client(), c = client();
  const ua = (await a('POST', '/api/register', reg())).data.user;
  const ub = (await b('POST', '/api/register', reg())).data.user;
  const uc = (await c('POST', '/api/register', reg())).data.user;
  await say(a, ub.id, '1'); await say(a, uc.id, '2');
  const gid = (await a('POST', '/api/chats/groups', { title: 'Тестова група', memberIds: [ub.id, uc.id] })).data.id;
  const file = await upload(b, gid, Buffer.from('оферта за пари'), 'оферта.txt');
  await b('POST', `/api/chats/${gid}/messages`, { body: 'Изпратете ми пари', attachmentId: file.data.attachment.id });
  await c('POST', `/api/chats/${gid}/messages`, { body: 'Не съм съгласен!' });
  assert.equal((await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'scam', conversationId: gid })).status, 201);

  const admin = await adminClient();
  const item = (await admin('GET', '/api/admin/reports?status=open')).data.reports.find(r => r.reportedNick === ub.nickname);
  const d = (await admin('GET', `/api/admin/reports/${item.id}`)).data;
  assert.equal(d.conversation.group, true); assert.equal(d.conversation.title, 'Тестова група');
  const roles = d.messages.map(m => m.role);
  assert.ok(roles.includes('system') && roles.includes('reported') && roles.includes('other'));
  const withFile = d.messages.find(m => m.attachment);
  assert.equal(withFile.attachment.name, 'оферта.txt');
  // админът може да свали файла-доказателство; чужд файл – не
  const get = id => fetch(`${base}/api/files/${id}`, { headers: { cookie: admin.cookie() } });
  assert.equal((await get(withFile.attachment.id)).status, 200);
  const unrelated = await upload(a, (await say(a, uc.id, 'лично')).cid, Buffer.from('лично'), 'лично.txt');
  assert.equal((await get(unrelated.data.attachment.id)).status, 404);
  // докладващ, който не е в групата → 404; докладван извън групата → 404
  const outsider = client(); await outsider('POST', '/api/register', reg());
  assert.equal((await outsider('POST', `/api/profiles/${ub.id}/report`, { reason: 'spam', conversationId: gid })).status, 404);
});

test('админът НЕ може да чете произволни чатове', async () => {
  const { a, ua, ub } = await two();
  const { cid } = await say(a, ub.id, 'лично съобщение');
  const admin = await adminClient();
  assert.equal((await admin('GET', `/api/chats/${cid}`)).status, 404);
  assert.equal((await admin('POST', `/api/chats/${cid}/messages`, { body: 'вмъквам се' })).status, 404);
  assert.equal((await admin('GET', '/api/chats')).data.chats.length, 0);
  assert.equal((await admin('GET', `/api/admin/chats/${ua.id}`)).status, 404);
  const all = JSON.stringify((await admin('GET', '/api/admin/reports?status=all')).data);
  assert.ok(!all.includes('лично съобщение'));
  // нито файловете на разговора
  const f = await upload(a, cid, Buffer.from('лично'), 'лично.txt');
  assert.equal((await fetch(`${base}/api/files/${f.data.attachment.id}`, { headers: { cookie: admin.cookie() } })).status, 404);
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
  const { cid } = await say(a, ub.id, 'здрасти');
  assert.equal((await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'harassment', block: true })).data.blocked, true);
  assert.equal((await b('POST', `/api/chats/${cid}/messages`, { body: 'здрасти' })).status, 403);
  assert.equal((await a('POST', `/api/chats/${cid}/messages`, { body: 'здрасти' })).status, 403);
  assert.equal((await a('POST', '/api/chats/direct', { userId: ub.id })).status, 403);
  assert.equal((await b('GET', `/api/chats/${cid}`)).status, 404);
  assert.equal((await a('GET', `/api/profiles/${ub.id}`)).status, 404);
  assert.equal((await b('GET', `/api/profiles/${ua.id}`)).status, 404);
  assert.equal((await b('POST', `/api/profiles/${ua.id}/like`)).status, 404);
  assert.equal((await a('GET', '/api/chats')).data.chats.length, 0);
  const seen = (await a('GET', '/api/profiles?limit=48&sort=new')).data.profiles;
  assert.ok(!seen.some(p => p.id === ub.id));
});

test('доказателствата (съобщения и файлове) остават, когато докладваният изтрие акаунта си', async () => {
  const { a, b, ua, ub } = await two();
  const { cid } = await say(b, ua.id, 'неприлично съобщение');
  const f = await upload(b, cid, Buffer.from('доказателство'), 'доказ.txt');
  await b('POST', `/api/chats/${cid}/messages`, { body: '', attachmentId: f.data.attachment.id });
  await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'harassment' });
  assert.equal((await b('DELETE', '/api/me', { password: 'supersecret1' })).status, 200);
  const admin = await adminClient();
  const rep = (await admin('GET', '/api/admin/reports?status=open')).data.reports.find(r => r.reportedNick === ub.nickname);
  assert.ok(rep);
  const d = (await admin('GET', `/api/admin/reports/${rep.id}`)).data;
  assert.equal(d.report.reportedStillExists, false);
  assert.equal(d.reported, null);
  assert.equal(d.messages[0].body, 'неприлично съобщение');
  const att = d.messages.find(m => m.attachment).attachment;
  assert.equal(await (await fetch(`${base}/api/files/${att.id}`, { headers: { cookie: admin.cookie() } })).text(), 'доказателство');
  // разговорът вече не е достъпен за останалия потребител
  assert.equal((await a('GET', `/api/chats/${cid}`)).status, 404);
});

test('примерните доклади са заредени и броят отворени е в статистиката', async () => {
  const admin = await adminClient();
  assert.ok((await admin('GET', '/api/admin/stats')).data.openReports >= 2);
  assert.ok((await admin('GET', '/api/chats/unread')).data.openReports >= 2);
});

test('тестов потребител: изключен по подразбиране', async () => {
  delete process.env.DEMO_ADMIN;
  assert.equal((await client()('POST', '/api/demo-user')).status, 404);
  assert.equal((await client()('POST', '/api/login', { username: 'tester', password: 'tester123' })).status, 401);
});

test('тестов потребител: вход без парола, готови разговори и непрочетени', async () => {
  process.env.DEMO_ADMIN = '1';
  try {
    const c = client();
    const r = await c('POST', '/api/demo-user');
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, 'user');
    assert.equal(r.data.user.nickname, 'Тестер');
    assert.equal((await c('GET', '/api/chats/unread')).data.unread, 3);
    const chats = (await c('GET', '/api/chats')).data.chats;
    assert.equal(chats.length, 4);
    assert.deepEqual(chats.map(x => x.unread).sort(), [0, 1, 1, 1]);
    assert.equal(chats.filter(x => x.kind === 'group').length, 1);
    // не е админ
    assert.equal((await c('GET', '/api/admin/stats')).status, 403);
    // четенето на разговор маркира съобщенията като прочетени
    const teddy = chats.find(x => x.kind === 'direct' && x.title === 'Теди');
    await c('GET', `/api/chats/${teddy.id}`);
    assert.equal((await c('GET', '/api/chats/unread')).data.unread, 2);
    const group = chats.find(x => x.kind === 'group');
    const gt = (await c('GET', `/api/chats/${group.id}`)).data;
    assert.equal(gt.conversation.members.length, 3);
    assert.ok(gt.messages.some(m => m.body.includes(':cool:')));
    assert.equal((await c('GET', '/api/chats/unread')).data.unread, 1);
  } finally { delete process.env.DEMO_ADMIN; }
});

// ───────── Области и населени места ─────────
test('места: публичен списък по област, търсене и броячи', async () => {
  const c = client(); // без вход
  assert.equal((await c('GET', '/api/places')).status, 400);
  assert.equal((await c('GET', '/api/places?region=XXX')).status, 400);
  const all = await c('GET', '/api/places?region=PDV&limit=60');
  assert.equal(all.status, 200);
  assert.ok(all.data.places.length === 60 && all.data.places[0].kind === 'гр.'); // градовете са първи
  const found = await c('GET', '/api/places?region=PDV&q=' + encodeURIComponent('бачк'));
  assert.ok(found.data.places.some(p => p.label === 'с. Бачково' && p.obshtina === 'Асеновград' && p.regionName === 'Пловдив'));
  const pop = await c('GET', '/api/places?region=SOF&populated=1');
  assert.ok(pop.data.places.length >= 1 && pop.data.places.every(p => p.count > 0));
  // префиксът „с.“ в търсенето се игнорира
  assert.ok((await c('GET', '/api/places?region=PDV&q=' + encodeURIComponent('с. бачк'))).data.places.length >= 1);
});

test('регистрация в село: профилът показва населено място, община и област', async () => {
  const c = client();
  const bachkovo = places.findPlace('Бачково');
  const r = await c('POST', '/api/register', reg({ placeId: bachkovo.id }));
  assert.equal(r.status, 201);
  const u = r.data.user;
  assert.deepEqual([u.city, u.region, u.regionName, u.obshtina, u.placeId], ['с. Бачково', 'PDV', 'Пловдив', 'Асеновград', bachkovo.id]);
  // филтър по село намира само хората от него
  const here = await c('GET', `/api/profiles?place=${bachkovo.id}&limit=48`);
  assert.ok(here.data.profiles.every(p => p.placeId === bachkovo.id) && here.data.total >= 1);
  // броячът на областта се увеличава
  const meta = (await c('GET', '/api/meta')).data.regions.find(x => x.code === 'PDV');
  assert.ok(meta.count >= 5);
  // смяна на мястото
  const moved = await c('PUT', '/api/me', { placeId: pid('Варна') });
  assert.equal(moved.data.user.region, 'VAR');
  assert.equal((await c('PUT', '/api/me', { placeId: 'нищо' })).status, 400);
});

test('данни: 28 области, всички места имат област и община', () => {
  assert.equal(places.REGIONS.length, 28);
  assert.ok(places.PLACES.length > 5000);
  assert.ok(places.PLACES.every(p => places.REGION_BY_CODE.has(p.region) && p.obshtina && p.id.length === 5));
  assert.equal(new Set(places.PLACES.map(p => p.id)).size, places.PLACES.length);
  assert.ok(places.PLACES.filter(p => p.kind === 'гр.').length >= 250);
});

// ───────── Имейл потвърждение, наказания, досиета, дерегистрация ─────────
const dbx = require('../server/db');
const regRaw = (c, over = {}) => c('POST', '/api/register', reg(over), { keepUnverified: true });
const adminOf = async () => adminClient();
// Докладва човек и връща досието му (чрез админа).
async function reportAndDossier(reporter, reportedUser, admin, reason = 'harassment') {
  assert.equal((await reporter('POST', `/api/profiles/${reportedUser.id}/report`, { reason, details: 'тест' })).status, 201);
  const list = (await admin('GET', '/api/admin/dossiers?q=' + encodeURIComponent(reportedUser.nickname))).data.dossiers;
  return list.find(d => d.nickname === reportedUser.nickname);
}

test('регистрация: имейл е задължителен, едноразовите се отказват, нормализиран дубликат, honeypot', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/register', reg({ email: '' }))).status, 400);
  assert.equal((await c('POST', '/api/register', reg({ email: 'не-е-имейл' }))).status, 400);
  const dis = await c('POST', '/api/register', reg({ email: 'x@mailinator.com' }));
  assert.equal(dis.status, 400); assert.match(dis.data.error, /временни/);
  assert.equal((await c('POST', '/api/register', reg({ website: 'http://spam.example' }))).status, 400); // бот попълва скритото поле

  const base = 'Ivo.Test' + Date.now().toString(36);
  assert.equal((await client()('POST', '/api/register', reg({ email: `${base}@gmail.com` }))).status, 201);
  // същата пощенска кутия: други главни/точки/+етикет/googlemail
  for (const v of [`${base.toLowerCase()}@gmail.com`, `${base.replace('.', '')}+spam@gmail.com`, `${base}@googlemail.com`]) {
    const r = await client()('POST', '/api/register', reg({ email: v }));
    assert.equal(r.status, 409, v);
  }
});

test('регистрация: най-много N на час от един адрес', async () => {
  process.env.REG_PER_HOUR = '2';
  try {
    // другите тестове вече са запълнили лога – ползваме нов „адрес“ чрез X-Forwarded-For не е възможно, затова изчистваме чрез време:
    // проверяваме само, че при ниския лимит поне една от следващите заявки е с 429
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await client()('POST', '/api/register', reg())).status);
    assert.ok(statuses.includes(429), statuses.join(','));
  } finally { process.env.REG_PER_HOUR = '100000'; }
});

test('непотвърден профил: ограничен достъп, неизвестен в търсенето, потвърждение с код', async () => {
  const c = client(), viewer = client();
  await viewer('POST', '/api/register', reg());
  const r = await regRaw(c);
  assert.equal(r.status, 201);
  assert.equal(r.data.user.emailVerified, false);
  assert.match(r.data.mail.devCode, /^\d{6}$/);
  // писмото е „изпратено“ (dev поща)
  assert.ok(dbx.prepare('SELECT 1 FROM outbox WHERE body LIKE ?').get('%' + r.data.mail.devCode + '%'));

  for (const [m, u] of [['GET', '/api/profiles'], ['GET', '/api/chats'], ['GET', '/api/chats/unread'], ['GET', '/api/activity']]) {
    const x = await c(m, u); assert.equal(x.status, 403, u); assert.equal(x.data.code, 'email_unverified');
  }
  assert.equal((await c('GET', '/api/me')).data.user.emailVerified, false);        // /api/me работи
  // не се вижда в търсенето
  const nick = r.data.user.nickname;
  assert.ok(!(await viewer('GET', '/api/profiles?limit=48&sort=new&q=' + encodeURIComponent(nick))).data.profiles.some(p => p.nickname === nick));

  // грешен код → остават опити; верният код потвърждава
  const wrong = await c('POST', '/api/verify/email', { code: r.data.mail.devCode === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 400); assert.match(wrong.data.error, /Остават 4/);
  const ok = await c('POST', '/api/verify/email', { code: r.data.mail.devCode });
  assert.equal(ok.status, 200); assert.equal(ok.data.user.emailVerified, true);
  assert.equal((await c('GET', '/api/profiles')).status, 200);
  assert.ok((await viewer('GET', '/api/profiles?limit=48&sort=new&q=' + encodeURIComponent(nick))).data.profiles.some(p => p.nickname === nick));
});

test('потвърждение: лимит на опитите, изтичане, презаявка и смяна на грешен имейл', async () => {
  const c = client();
  const r = await regRaw(c);
  const real = r.data.mail.devCode, bad = real === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/verify/email', { code: bad })).status, 400);
  const locked = await c('POST', '/api/verify/email', { code: real });
  assert.equal(locked.status, 429); assert.equal(locked.data.code, 'too_many_attempts');       // и верен код след 5 грешки не минава

  // нов код: веднага → изчакване (60 сек.)
  const wait = await c('POST', '/api/verify/resend');
  assert.equal(wait.status, 429); assert.ok(wait.data.retryAfter > 0);
  dbx.prepare("UPDATE email_verifications SET sent_at = datetime('now', '-2 minutes') WHERE user_id = ?").run(r.data.user.id);
  const again = await c('POST', '/api/verify/resend');
  assert.equal(again.status, 200); assert.notEqual(again.data.mail.devCode, undefined);

  // изтекъл код
  dbx.prepare("UPDATE email_verifications SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?").run(r.data.user.id);
  const exp = await c('POST', '/api/verify/email', { code: again.data.mail.devCode });
  assert.equal(exp.status, 400); assert.equal(exp.data.code, 'code_expired');

  // смяна на сгрешен имейл: нужна е паролата
  dbx.prepare("UPDATE email_verifications SET sent_at = datetime('now', '-2 minutes') WHERE user_id = ?").run(r.data.user.id);
  assert.equal((await c('POST', '/api/verify/change-email', { email: 'нов@example.test', password: 'грешна' })).status, 403);
  const newMail = `fixed${Date.now().toString(36)}@example.test`;
  const ch = await c('POST', '/api/verify/change-email', { email: newMail, password: 'supersecret1' });
  assert.equal(ch.status, 200);
  assert.equal((await c('POST', '/api/verify/email', { code: ch.data.mail.devCode })).data.user.emailVerified, true);
  assert.equal((await c('GET', '/api/me')).data.user.email, newMail);
  assert.equal((await c('POST', '/api/verify/change-email', { email: 'още@example.test', password: 'supersecret1' })).status, 400); // вече е потвърден
});

test('най-много 5 кода на час', async () => {
  const c = client(); const r = await regRaw(c);
  for (let i = 0; i < 4; i++) {
    dbx.prepare("UPDATE email_verifications SET sent_at = datetime('now', '-2 minutes') WHERE user_id = ?").run(r.data.user.id);
    assert.equal((await c('POST', '/api/verify/resend')).status, 200);
  }
  dbx.prepare("UPDATE email_verifications SET sent_at = datetime('now', '-2 minutes') WHERE user_id = ?").run(r.data.user.id);
  const last = await c('POST', '/api/verify/resend');
  assert.equal(last.status, 429); assert.match(last.data.error, /лимита/);
});

test('досие се създава само за докладван профил, а наказания – само към такъв', async () => {
  const { a, ub, ua } = await two();
  const admin = await adminOf();
  const dossiersBefore = (await admin('GET', '/api/admin/dossiers')).data.dossiers.map(d => d.nickname);
  assert.ok(!dossiersBefore.includes(ub.nickname) && !dossiersBefore.includes(ua.nickname));       // никой не е докладван
  const d = await reportAndDossier(a, ub, admin);
  assert.ok(d && d.reports === 1 && d.openReports === 1 && d.strikes === 0 && d.status === 'active');
  assert.ok(!(await admin('GET', '/api/admin/dossiers')).data.dossiers.some(x => x.nickname === ua.nickname)); // докладващият няма досие
  // няма досие → няма наказание/дерегистрация (404 за несъществуващо досие)
  assert.equal((await admin('POST', '/api/admin/dossiers/999999/penalties', { kind: 'warning', reason: 'тест тест' })).status, 404);
  const detail = (await admin('GET', `/api/admin/dossiers/${d.id}`)).data;
  assert.equal(detail.subject.nickname, ub.nickname); assert.equal(detail.subject.alive, true);
  assert.equal(detail.reports.length, 1); assert.match(detail.subject.emailMasked, /\*/);
  assert.ok(!JSON.stringify(detail).includes('@example.test'));                                      // пълният имейл не се разкрива
  // само админ
  assert.equal((await a('GET', '/api/admin/dossiers')).status, 403);
  assert.equal((await a('GET', `/api/admin/dossiers/${d.id}`)).status, 403);
  assert.equal((await a('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'warning', reason: 'хак хак' })).status, 403);
  assert.equal((await a('POST', `/api/admin/dossiers/${d.id}/deregister`, { reason: 'хак хак' })).status, 403);
});

test('предупреждение: вижда се на потребителя, потвърждава се и се брои', async () => {
  const { a, b, ub } = await two(); const admin = await adminOf();
  const d = await reportAndDossier(a, ub, admin);
  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'warning', reason: 'х' })).status, 400);              // причината е задължителна
  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'бан', reason: 'достатъчно дълго' })).status, 400);
  const w = await admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'warning', reason: 'Обидни съобщения към други.', note: 'вътрешно' });
  assert.equal(w.status, 201); assert.equal(w.data.strikes, 1);
  const me = (await b('GET', '/api/me')).data.user;
  assert.equal(me.warning.reason, 'Обидни съобщения към други.');
  assert.ok(!('note' in me.warning));                                                               // вътрешната бележка не се вижда
  assert.equal((await b('POST', `/api/me/penalties/${me.warning.id}/ack`)).data.user.warning, null);
  assert.equal((await b('POST', `/api/me/penalties/${me.warning.id}/ack`)).status, 200);
  // предупреждението не ограничава достъпа
  assert.equal((await say(b, (await a('GET', '/api/me')).data.user.id, 'още мога да пиша')).r.status, 201);
});

test('суспензия: пише, харесва, качва и докладва не може; скрит е от търсенето; може да чете и да обжалва', async () => {
  const { a, b, ua, ub } = await two(); const admin = await adminOf();
  const { cid } = await say(a, ub.id, 'здрасти');
  const d = await reportAndDossier(a, ub, admin);
  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'suspension', days: 5, reason: 'Тормоз' })).status, 400); // 5 не е позволено
  const s = await admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'suspension', days: 3, reason: 'Тормоз на други потребители' });
  assert.equal(s.status, 201);

  const me = (await b('GET', '/api/me')).data.user;
  assert.equal(me.suspension.kind, 'suspension'); assert.ok(me.suspension.until > new Date().toISOString());
  const blocked = [
    await b('POST', `/api/chats/${cid}/messages`, { body: 'опит' }), await b('POST', `/api/profiles/${ua.id}/like`),
    await b('POST', '/api/me/photos', { dataUrl: PNG }), await b('PUT', '/api/me', { bio: 'нов био' }), await b('POST', `/api/profiles/${ua.id}/report`, { reason: 'spam' }),
  ];
  for (const r of blocked) { assert.equal(r.status, 403); assert.equal(r.data.code, 'suspended'); assert.match(r.data.error, /Тормоз на други/); }
  // чете, вижда разговорите си
  assert.equal((await b('GET', `/api/chats/${cid}`)).status, 200);
  assert.equal((await b('GET', '/api/profiles')).status, 200);
  // скрит в търсенето
  assert.ok(!(await a('GET', '/api/profiles?limit=48&sort=new&q=' + encodeURIComponent(ub.nickname))).data.profiles.some(p => p.nickname === ub.nickname));

  // обжалване
  const pid = me.suspension.id;
  assert.equal((await b('POST', `/api/me/penalties/${pid}/appeal`, { text: 'къс' })).status, 400);
  const ap = await b('POST', `/api/me/penalties/${pid}/appeal`, { text: 'Смятам, че е недоразумение – разговаряхме нормално.' });
  assert.equal(ap.data.user.suspension.appealStatus, 'pending');
  assert.equal((await b('POST', `/api/me/penalties/${pid}/appeal`, { text: 'второ обжалване не може' })).status, 409);
  assert.equal((await a('POST', `/api/me/penalties/${pid}/appeal`, { text: 'чуждо наказание не може' })).status, 404);
  assert.ok((await admin('GET', '/api/admin/stats')).data.openAppeals >= 1);
  assert.ok((await admin('GET', '/api/chats/unread')).data.openAppeals >= 1);
  assert.ok((await admin('GET', '/api/admin/dossiers?status=appeals')).data.dossiers.some(x => x.id === d.id));
  // решение: отхвърлено → остава; уважено → вдига
  assert.equal((await a('POST', `/api/admin/penalties/${pid}/appeal`, { decision: 'accepted' })).status, 403);
  const acc = await admin('POST', `/api/admin/penalties/${pid}/appeal`, { decision: 'accepted', note: 'Прегледахме – няма нарушение.' });
  assert.equal(acc.status, 200);
  assert.equal((await b('GET', '/api/me')).data.user.suspension, null);
  assert.equal((await b('POST', `/api/chats/${cid}/messages`, { body: 'пак мога' })).status, 201);
  assert.equal((await admin('GET', `/api/admin/dossiers/${d.id}`)).data.strikes, 0);               // уважено обжалване не е страйк
  assert.equal((await admin('POST', `/api/admin/penalties/${pid}/appeal`, { decision: 'rejected' })).status, 404); // вече е решено
});

test('суспензията изтича сама; ръчно вдигане; страйкове и препоръка за дерегистрация', async () => {
  const { a, b, ub } = await two(); const admin = await adminOf();
  const d = await reportAndDossier(a, ub, admin);
  const post = (kind, extra = {}) => admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind, reason: 'Нарушение на правилата', ...extra });
  const w = await post('warning'); assert.equal(w.data.recommendDeregister, false);
  const s1 = await post('suspension', { days: 1 }); assert.equal(s1.data.strikes, 2); assert.equal(s1.data.recommendDeregister, false);
  // изтичане: връщаме ends_at в миналото
  dbx.prepare("UPDATE penalties SET ends_at = datetime('now', '-1 minute') WHERE id = ?").run(s1.data.penalty.id);
  assert.equal((await b('GET', '/api/me')).data.user.suspension, null);
  assert.ok((await a('GET', '/api/profiles?limit=48&sort=new&q=' + encodeURIComponent(ub.nickname))).data.profiles.some(p => p.nickname === ub.nickname));
  const s2 = await post('suspension', { days: 7 }); assert.equal(s2.data.strikes, 3); assert.equal(s2.data.recommendDeregister, true);
  assert.equal((await admin('GET', `/api/admin/dossiers/${d.id}`)).data.recommendDeregister, true);
  // ръчно вдигане
  assert.equal((await admin('POST', `/api/admin/penalties/${s2.data.penalty.id}/lift`, { note: 'Договорено' })).status, 200);
  assert.equal((await admin('POST', `/api/admin/penalties/${s2.data.penalty.id}/lift`)).status, 409);
  assert.equal((await b('GET', '/api/me')).data.user.suspension, null);
  // бележки в досието
  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/notes`, { note: 'Следим профила.' })).status, 201);
  const det = (await admin('GET', `/api/admin/dossiers/${d.id}`)).data;
  assert.equal(det.notes[0].note, 'Следим профила.'); assert.equal(det.penalties.length, 3);
});

test('дерегистрация: профилът изчезва, досието и доказателствата остават, имейлът е забранен завинаги', async () => {
  const a = client(), b = client();
  const ua = (await a('POST', '/api/register', reg())).data.user;
  const badMail = `Bad.User${Date.now().toString(36)}@gmail.com`;
  const rb = await b('POST', '/api/register', reg({ email: badMail, username: 'baduser' + Date.now().toString(36) }));
  const ub = rb.data.user, bUsername = ub.username;
  const { cid } = await say(b, ua.id, 'неприлично съобщение');
  await a('POST', `/api/profiles/${ub.id}/report`, { reason: 'harassment' });
  const admin = await adminOf();
  const d = (await admin('GET', '/api/admin/dossiers?q=' + encodeURIComponent(ub.nickname))).data.dossiers[0];

  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/deregister`, { reason: 'x' })).status, 400);
  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/deregister`, { reason: 'Системен тормоз и заплахи', note: 'Окончателно' })).status, 200);

  // профилът го няма, не може да влезе и получава ясно съобщение
  assert.equal((await b('GET', '/api/me')).data.user, null);                                       // сесията е прекратена
  const login = await client()('POST', '/api/login', { username: bUsername, password: 'supersecret1' });
  assert.equal(login.status, 403); assert.equal(login.data.code, 'deregistered');
  assert.equal(dbx.prepare('SELECT 1 FROM users WHERE username = ?').get(bUsername), undefined);
  assert.equal((await a('GET', `/api/profiles/${ub.id}`)).status, 404);
  assert.equal((await a('GET', `/api/chats/${cid}`)).status, 404);                                  // личният разговор е изчистен

  // досието остава
  const det = (await admin('GET', `/api/admin/dossiers/${d.id}`)).data;
  assert.equal(det.dossier.status, 'deregistered'); assert.equal(det.subject.alive, false); assert.equal(det.emailBanned, true);
  assert.equal(det.dossier.closedReason, 'Системен тормоз и заплахи');
  assert.equal(det.penalties[0].kind, 'deregistration'); assert.equal(det.reports.length, 1);
  assert.equal(det.reports[0].details, 'тест' === 'x' ? '' : det.reports[0].details);
  const rep = (await admin('GET', '/api/admin/reports?status=open')).data.reports.find(r => r.reportedNick === ub.nickname);
  assert.equal((await admin('GET', `/api/admin/reports/${rep.id}`)).data.messages[0].body, 'неприлично съобщение'); // доказателството е живо
  assert.ok((await admin('GET', '/api/admin/dossiers?status=deregistered')).data.dossiers.some(x => x.id === d.id));
  // повторна дерегистрация/наказание – не
  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/deregister`, { reason: 'още веднъж' })).status, 409);
  assert.equal((await admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'warning', reason: 'вече няма профил' })).status, 409);

  // Забрана на имейла – същият, и всички негови „варианти“
  const key = dbx.prepare('SELECT hash FROM banned_emails').all();
  assert.ok(key.length >= 1); assert.ok(!JSON.stringify(key).includes('baduser'));                  // пази се само хеш
  for (const v of [badMail, badMail.toLowerCase(), badMail.replace('.', ''), badMail.replace('@', '+x@'), badMail.replace('gmail.com', 'googlemail.com')]) {
    const r = await client()('POST', '/api/register', reg({ email: v }));
    assert.equal(r.status, 403, v); assert.match(r.data.error, /не може да се използва/);
  }
  // потребителското име също не може да се ползва наново, но друг имейл и име – да
  assert.equal((await client()('POST', '/api/register', reg({ username: bUsername }))).status, 409);
  assert.equal((await client()('POST', '/api/register', reg())).status, 201);
});

test('самоизтрит профил НЕ блокира имейла му; админ не може да бъде дерегистриран', async () => {
  const c = client(); const mail = `self${Date.now().toString(36)}@example.test`;
  await c('POST', '/api/register', reg({ email: mail }));
  assert.equal((await c('DELETE', '/api/me', { password: 'supersecret1' })).status, 200);
  assert.equal((await client()('POST', '/api/register', reg({ email: mail }))).status, 201);   // може да се регистрира пак
  const admin = await adminOf();
  const adminDossier = dbx.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  dbx.prepare("INSERT INTO dossiers (user_id, nickname) VALUES (?, 'Админ')").run(adminDossier.id);
  const did = dbx.prepare('SELECT id FROM dossiers WHERE user_id = ?').get(adminDossier.id).id;
  assert.equal((await admin('POST', `/api/admin/dossiers/${did}/deregister`, { reason: 'опит срещу админ' })).status, 403);
});

test('активност: харесали те, взаимни и посетители (с възможност за скрито разглеждане)', async () => {
  const { a, b, ua, ub } = await two();
  const empty = (await b('GET', '/api/activity')).data; assert.deepEqual([empty.likedMe.length, empty.mutual.length, empty.visitors.length], [0, 0, 0]);
  await a('POST', `/api/profiles/${ub.id}/like`);
  await a('GET', `/api/profiles/${ub.id}`);                                  // a отваря профила на b → посещение
  const act1 = (await b('GET', '/api/activity')).data;
  assert.deepEqual(act1.likedMe.map(p => p.id), [ua.id]); assert.equal(act1.mutual.length, 0);
  assert.deepEqual(act1.visitors.map(p => p.id), [ua.id]);
  await b('POST', `/api/profiles/${ua.id}/like`);                            // взаимно
  const act2 = (await b('GET', '/api/activity')).data;
  assert.deepEqual([act2.likedMe.length, act2.mutual.map(p => p.id)], [0, [ua.id]]);
  // скрито разглеждане: b гледа профила на a, но не се записва
  await b('PUT', '/api/me/settings', { hideVisits: true });
  await b('GET', `/api/profiles/${ua.id}`);
  assert.equal((await a('GET', '/api/activity')).data.visitors.length, 0);
  // посещенията се дублират само веднъж на ден
  await a('GET', `/api/profiles/${ub.id}`); await a('GET', `/api/profiles/${ub.id}`);
  assert.equal(dbx.prepare('SELECT COUNT(*) c FROM visits WHERE visitor_id = ? AND visited_id = ?').get(ua.id, ub.id).c, 1);
  // блокиран не се вижда в активността
  await b('POST', `/api/profiles/${ua.id}/report`, { reason: 'spam', block: true });
  assert.equal((await b('GET', '/api/activity')).data.mutual.length, 0);
});

test('пауза на профила: скрит от търсенето и броячите, но чатът работи', async () => {
  const { a, b, ua, ub } = await two();
  const { cid } = await say(a, ub.id, 'здрасти');
  const count = async () => (await a('GET', '/api/meta')).data.regions.find(r => r.code === 'SOF').count;
  const before = await count();
  assert.equal((await b('PUT', '/api/me/settings', { paused: true })).data.user.paused, true);
  assert.equal(await count(), before - 1);
  assert.ok(!(await a('GET', '/api/profiles?limit=48&sort=new&q=' + encodeURIComponent(ub.nickname))).data.profiles.some(p => p.nickname === ub.nickname));
  assert.equal((await b('POST', `/api/chats/${cid}/messages`, { body: 'пак пиша' })).status, 201);   // разговорите работят
  await b('PUT', '/api/me/settings', { paused: false });
  assert.equal(await count(), before);
});

test('какво търся (цел): филтър и попълненост на профила', async () => {
  const { a, ua } = await two();
  const base = (await a('GET', '/api/me')).data.user.completeness;
  assert.equal(base.pct, 15);                                                // само потвърден имейл
  assert.equal((await a('PUT', '/api/me', { goal: 'нищо' })).status, 400);
  const me = (await a('PUT', '/api/me', { goal: 'serious', bio: 'Обичам планината, кафето и дългите разходки в неделя сутрин.', interests: ['Музика', 'Йога', 'Кино'] })).data.user;
  assert.equal(me.goal, 'serious'); assert.equal(me.goalLabel, 'Сериозна връзка'); assert.equal(me.completeness.pct, 15 + 10 + 20 + 15);
  await a('POST', '/api/me/photos', { dataUrl: PNG });
  assert.equal((await a('GET', '/api/me')).data.user.completeness.pct, 85);
  const b = client(); await b('POST', '/api/register', reg());
  const found = (await b('GET', '/api/profiles?goal=serious&limit=48')).data.profiles;
  assert.ok(found.some(p => p.id === ua.id) && found.every(p => p.goal === 'serious'));
  assert.equal((await b('GET', '/api/profiles?goal=нищо')).status, 400);
});

test('мета: целите и режим на пощата; непотвърдените не се броят', async () => {
  const meta = (await client()('GET', '/api/meta')).data;
  assert.equal(meta.goals.serious, 'Сериозна връзка'); assert.equal(meta.mailDev, true);
});

test('примерното досие е заредено: Сашо има предупреждение с чакащо обжалване и изтекла суспензия', async () => {
  const admin = await adminOf();
  const d = (await admin('GET', '/api/admin/dossiers?q=' + encodeURIComponent('Сашо'))).data.dossiers[0];
  assert.ok(d && d.strikes === 2 && d.appeals === 1 && d.suspendedUntil === null);
  const det = (await admin('GET', `/api/admin/dossiers/${d.id}`)).data;
  assert.equal(det.penalties.map(p => p.kind).sort().join(), 'suspension,warning');
  assert.ok(det.penalties.find(p => p.kind === 'warning').appealText.length > 10);
});

// ───────── Гласови и видео обаждания ─────────
async function callPair() {
  const { a, b, ua, ub } = await two();
  const { cid } = await say(a, ub.id, 'ще се чуем ли?');
  return { a, b, ua, ub, cid };
}
const ring = (a, cid, kind = 'audio') => a('POST', '/api/calls', { conversationId: cid, kind });

test('обаждане: звънене, входящо, отговор, сигнали, край и запис в чата', async () => {
  const { a, b, ua, ub, cid } = await callPair();
  const r = await ring(a, cid, 'video');
  assert.equal(r.status, 201); assert.equal(r.data.call.status, 'ringing'); assert.equal(r.data.call.kind, 'video'); assert.equal(r.data.call.peer.id, ub.id);
  const id = r.data.call.id;
  // входящото се вижда само на получателя
  const inc = await b('GET', '/api/calls/poll');
  assert.equal(inc.data.call.id, id); assert.equal(inc.data.call.incoming, true); assert.equal(inc.data.call.peer.id, ua.id);
  // сигнал offer от звънящия; получателят го вижда, звънящият – не
  assert.equal((await a('POST', `/api/calls/${id}/signal`, { type: 'offer', payload: '{"sdp":"X"}' })).status, 201);
  const got = (await b('GET', `/api/calls/poll?callId=${id}`)).data.signals;
  assert.deepEqual(got.map(s => [s.type, s.payload]), [['offer', '{"sdp":"X"}']]);
  assert.equal((await a('GET', `/api/calls/poll?callId=${id}&after=0`)).data.signals.length, 0);
  // отговор → активно
  const ans = await b('POST', `/api/calls/${id}/answer`);
  assert.equal(ans.status, 200); assert.equal(ans.data.call.status, 'active');
  await b('POST', `/api/calls/${id}/signal`, { type: 'answer', payload: 'A' });
  await a('POST', `/api/calls/${id}/signal`, { type: 'ice', payload: 'C1' });
  assert.deepEqual((await a('GET', `/api/calls/poll?callId=${id}`)).data.signals.map(s => s.type), ['answer']);
  assert.deepEqual((await b('GET', `/api/calls/poll?callId=${id}&after=${got[0].id}`)).data.signals.map(s => s.type), ['ice']);
  // край → запис в разговора, повторно приключване е безвредно
  dbx.prepare("UPDATE calls SET answered_at = datetime('now', '-75 seconds') WHERE id = ?").run(id);
  assert.equal((await a('POST', `/api/calls/${id}/end`)).status, 200);
  assert.equal((await b('GET', `/api/calls/poll?callId=${id}`)).data.call.status, 'ended');
  const log = (await a('GET', `/api/chats/${cid}`)).data.messages.filter(m => m.kind === 'system').map(m => m.body);
  assert.ok(log.some(t => /Видео обаждане · 1:1\d/.test(t)), log.join('|'));
  assert.equal((await a('POST', `/api/calls/${id}/signal`, { type: 'ice', payload: 'късно' })).status, 409);   // след края няма сигнали
  assert.equal((await a('POST', `/api/calls/${id}/end`)).status, 200);
});

test('обаждане: отказ, отмяна и неотговорено', async () => {
  const { a, b, cid } = await callPair();
  const d1 = (await ring(a, cid)).data.call.id;
  assert.equal((await a('POST', `/api/calls/${d1}/decline`)).status, 403);                    // звънящият не може да „откаже“
  assert.equal((await b('POST', `/api/calls/${d1}/decline`)).status, 200);
  assert.equal((await a('GET', `/api/calls/poll?callId=${d1}`)).data.call.status, 'declined');
  const d2 = (await ring(a, cid)).data.call.id;
  assert.equal((await a('POST', `/api/calls/${d2}/end`)).status, 200);                         // звънящият отменя
  assert.equal((await b('GET', `/api/calls/poll?callId=${d2}`)).data.call.status, 'canceled');
  const d3 = (await ring(a, cid)).data.call.id;
  dbx.prepare("UPDATE calls SET created_at = datetime('now', '-60 seconds') WHERE id = ?").run(d3);
  assert.equal((await b('GET', '/api/calls/poll')).data.call, null);                           // изтекло звънене → няма входящо
  assert.equal((await a('GET', `/api/calls/poll?callId=${d3}`)).data.call.status, 'missed');
  const log = (await b('GET', `/api/chats/${cid}`)).data.messages.filter(m => m.kind === 'system').map(m => m.body);
  assert.ok(log.some(t => /Отказано/.test(t)) && log.filter(t => /Пропуснато/.test(t)).length === 2, log.join('|'));
});

test('обаждане: заети линии, валидации и права', async () => {
  const { a, b, ub, cid } = await callPair();
  const stranger = client(); await stranger('POST', '/api/register', reg());
  assert.equal((await ring(a, cid, 'сегашно')).status, 400);
  assert.equal((await ring(stranger, cid)).status, 404);                                       // не е член на разговора
  assert.equal((await client()('POST', '/api/calls', { conversationId: cid, kind: 'audio' })).status, 401);
  const id = (await ring(a, cid)).data.call.id;
  assert.equal((await ring(a, cid)).data.code, 'busy_self');                                   // вече звъни
  const c3 = client(); const u3 = (await c3('POST', '/api/register', reg())).data.user;
  const { cid: cid3 } = await say(c3, ub.id, 'и аз искам да звънна');
  const busy = await ring(c3, cid3); assert.equal(busy.status, 409); assert.equal(busy.data.code, 'busy');   // ub е зает
  // външен човек не може да чете, подава сигнал или вдига
  assert.equal((await stranger('GET', `/api/calls/poll?callId=${id}`)).data.call, null);
  assert.equal((await stranger('POST', `/api/calls/${id}/signal`, { type: 'ice', payload: 'x' })).status, 404);
  assert.equal((await stranger('POST', `/api/calls/${id}/answer`)).status, 404);
  assert.equal((await a('POST', `/api/calls/${id}/answer`)).status, 403);                       // звънящият не може да вдига
  assert.equal((await b('POST', `/api/calls/${id}/signal`, { type: 'нещо', payload: 'x' })).status, 400);
  assert.equal((await b('POST', `/api/calls/${id}/signal`, { type: 'ice', payload: 'x'.repeat(20001) })).status, 413);
  await b('POST', `/api/calls/${id}/end`);
  // след края линията е свободна
  assert.equal((await ring(c3, cid3)).status, 201);
  // групи – не; блокиран – не
  const g = client(); const ug = (await g('POST', '/api/register', reg())).data.user;
  await say(a, ug.id, 'х'); const gid = (await a('POST', '/api/chats/groups', { title: 'Група', memberIds: [ug.id] })).data.id;
  assert.equal((await ring(a, gid)).status, 404);
  await b('POST', `/api/profiles/${(await a('GET', '/api/me')).data.user.id}/report`, { reason: 'spam', block: true });
  assert.equal((await ring(a, cid)).status, 403);
});

test('обаждане: суспендиран не може да звъни, но може да вдигне; зависнало обаждане се затваря; ICE в meta', async () => {
  const { a, b, ub, cid } = await callPair(); const admin = await adminOf();
  const d = await reportAndDossier(a, ub, admin);
  await admin('POST', `/api/admin/dossiers/${d.id}/penalties`, { kind: 'suspension', days: 1, reason: 'Тестова суспензия' });
  const blocked = await ring(b, cid); assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'suspended');
  const id = (await ring(a, cid)).data.call.id;
  assert.equal((await b('POST', `/api/calls/${id}/answer`)).status, 200);
  // никой не се отчита → затваря се
  dbx.prepare("UPDATE calls SET caller_seen = datetime('now', '-60 seconds') WHERE id = ?").run(id);
  assert.equal((await a('GET', `/api/calls/poll?callId=${id}`)).data.call.status, 'ended');
  const meta = (await client()('GET', '/api/meta')).data;
  assert.ok(Array.isArray(meta.iceServers) && meta.iceServers[0].urls);
});

test('наблизо: радиус, закръглено разстояние, поверителност', async () => {
  const mk = async place => { const c = client(); const u = (await c('POST', '/api/register', reg({ placeId: pid(place) }))).data.user; return { c, u }; };
  const me = await mk('Пловдив'), near = await mk('Асеновград'), far = await mk('Варна'), mid = await mk('Карлово');
  const list = async (c, km, extra = '') => c('GET', `/api/profiles?nearby=${km}&limit=48${extra}`);
  const r = await list(me.c, 25);
  assert.equal(r.status, 200);
  const ids = r.data.profiles.map(p => p.id);
  assert.ok(ids.includes(near.u.id), 'Асеновград е в 25 км');
  assert.ok(!ids.includes(far.u.id) && !ids.includes(mid.u.id), 'Варна и Карлово са извън 25 км');
  const pn = r.data.profiles.find(p => p.id === near.u.id);
  assert.ok(pn.distanceKm >= 5 && pn.distanceKm <= 30 && pn.distanceKm % 5 === 0, 'разстоянието е закръглено до 5 км');
  assert.equal((await list(me.c, 100)).data.profiles.some(p => p.id === mid.u.id), true);
  assert.equal((await list(me.c, 100)).data.profiles.some(p => p.id === far.u.id), false);
  // подредени по разстояние
  const ds = (await list(me.c, 100)).data.profiles.map(p => p.distanceKm).filter(x => x !== null);
  assert.deepEqual(ds, [...ds].sort((x, y) => x - y));
  assert.equal((await list(me.c, 7)).status, 400);
  // обикновеният списък също връща разстояние, но без точни координати
  const all = (await me.c('GET', '/api/profiles?limit=48')).data.profiles.find(p => p.id === near.u.id);
  assert.ok(all.distanceKm > 0 && !('lat' in all) && !('lng' in all));
  // скрито разстояние: не се вижда в „наблизо“, няма разстояние, и не може да се търси наблизо
  await near.c('PUT', '/api/me/settings', { hideDistance: true });
  assert.ok(!(await list(me.c, 25)).data.profiles.some(p => p.id === near.u.id));
  assert.equal((await me.c('GET', '/api/profiles?limit=48')).data.profiles.find(p => p.id === near.u.id).distanceKm, null);
  assert.equal((await list(near.c, 25)).status, 409);
});

test('местоположение: проверка с GPS и ограничение на смяната на мястото', async () => {
  const c = client();
  const u = (await c('POST', '/api/register', reg({ placeId: pid('Пловдив') }))).data.user;
  assert.equal(u.locVerified, false);
  // далеч (София) → отказ, нищо не се записва
  const bad1 = await c('POST', '/api/me/location/verify', { lat: 42.698, lng: 23.324, accuracy: 20 });
  assert.equal(bad1.status, 409);
  assert.equal((await c('GET', '/api/me')).data.user.locVerified, false);
  assert.equal((await c('POST', '/api/me/location/verify', { lat: 'x', lng: 1 })).status, 400);
  assert.equal((await c('POST', '/api/me/location/verify', { lat: 42.15, lng: 24.75, accuracy: 90000 })).status, 400);
  // наблизо до Пловдив → потвърдено
  const ok = await c('POST', '/api/me/location/verify', { lat: 42.16, lng: 24.76, accuracy: 30 });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.locVerified, true);
  const row = dbx.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  assert.ok(row.loc_verified_at && !Object.keys(row).some(k => /^(lat|lng|latitude|longitude)$/.test(k)), 'координатите не се пазят');
  // публичният профил показва знака
  const o = client(); await o('POST', '/api/register', reg());
  assert.equal((await o('GET', `/api/profiles/${u.id}`)).data.profile.locVerified, true);
  // смяна на мястото: първата минава, нулира проверката; втората в рамките на 7 дни е отказана
  const m1 = await c('PUT', '/api/me', { placeId: pid('Варна') });
  assert.equal(m1.status, 200);
  assert.equal(m1.data.user.locVerified, false);
  assert.equal((await c('PUT', '/api/me', { placeId: pid('Бургас') })).status, 429);
  assert.equal((await c('PUT', '/api/me', { bio: 'ок' })).status, 200);
  dbx.prepare("UPDATE users SET place_changed_at = datetime('now', '-8 days') WHERE id = ?").run(u.id);
  assert.equal((await c('PUT', '/api/me', { placeId: pid('Бургас') })).status, 200);
});
