// Публичният сайт. В production: APP_MODE=public (без админ част). Администрацията е отделен процес – server/admin-index.js.
const app = require('./app');
const { seedDemo, seedAdmin, seedTestUser } = require('./seed');
const backup = require('./backup');

if (process.env.SEED_DEMO !== '0') {
  const n = seedDemo();
  if (n) console.log(`Добавени са ${n} демо профила (SEED_DEMO=0 за изключване).`);
}

if (process.env.DEMO_ADMIN === '1') {
  seedAdmin();
  seedTestUser();
  console.log('⚠ DEMO_ADMIN=1: вход без парола (администратор и тестов потребител) е ВКЛЮЧЕН (само за демо).');
}

backup.schedule();
const PORT = process.env.PORT || 3100, HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`Spark слуша на http://${HOST}:${PORT} (режим: ${process.env.APP_MODE || 'all'})`));
