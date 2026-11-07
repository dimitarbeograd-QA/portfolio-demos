// API тестове с вграденият node:test. Стартират се с: npm test
process.env.NODE_ENV = 'test';
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
  const fn = async (method, url, body) => {
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
  fn.cookie = () => cookie;
  return fn;
}
const adult = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 28); return d.toISOString().slice(0, 10); };
const reg = (over = {}) => ({ username: 'ivan_' + Math.random().toString(36).slice(2, 8), password: 'supersecret1', nickname: 'Иван' + Math.floor(Math.random() * 1e5), birthDate: adult(), gender: 'male', lookingFor: 'female', placeId: pid('София'), ...over });

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
