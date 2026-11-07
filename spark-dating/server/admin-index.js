// Администрацията – отделен процес: друг порт, друга бисквитка, друга база за акаунтите (admin.db), вход с парола + 2FA.
// По подразбиране слуша САМО на 127.0.0.1; пускай я зад отделен адрес (напр. admin.example.com) и защитен вход (VPN/Cloudflare Access/IP филтър).
process.env.APP_MODE = 'admin';
const app = require('./app');
const PORT = process.env.ADMIN_PORT || 3200, HOST = process.env.ADMIN_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Spark админ слуша на http://${HOST}:${PORT}`));
