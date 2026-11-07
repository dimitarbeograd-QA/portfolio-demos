const app = require('./app');
const { seedDemo, seedAdmin, seedTestUser } = require('./seed');

if (process.env.SEED_DEMO !== '0') {
  const n = seedDemo();
  if (n) console.log(`Добавени са ${n} демо профила (SEED_DEMO=0 за изключване).`);
}

if (process.env.DEMO_ADMIN === '1') {
  seedAdmin();
  seedTestUser();
  console.log('⚠ DEMO_ADMIN=1: вход без парола (администратор и тестов потребител) е ВКЛЮЧЕН (само за демо).');
}

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log(`Spark слуша на http://localhost:${PORT}`));
