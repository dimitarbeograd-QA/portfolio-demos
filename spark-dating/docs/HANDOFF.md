# Spark – бележка за продължаване в нова сесия

**Репо:** `dimitarbeograd-QA/portfolio-demos`, папка `spark-dating/`, клон `claude/add-spark-dating` (последен запис ≈ `3b74613`+). **Не е слят в main, няма PR.**
**Демо (частен артефакт, Version 17):** https://claude.ai/artifact/Rtz56wiYWRku5rmTA5PRmt – публикува се от `spark-dating/preview/artifact.html` след `node scripts/build-preview.js` (без `icon` при обновяване).
Първоначалният проект в `linde-al45` е изчистен.

## Стек и команди
Node 22, Express 4, better-sqlite3, bcryptjs, express-session (SQLite store), nodemailer 10; фронтенд – vanilla JS (`public/js/app.js`, IIFE, hash маршрути), CSS (`public/css/style.css`), UI на български.
`npm test` (69 теста, node:test) · `npm start` · `npm run start:admin` · `npm run create-admin -- <име>` · `npm run backup` · `node scripts/build-preview.js` (статично демо: `index.html` + `preview/artifact.html`, мок API в `preview/mock-api.js`, localStorage ключ `spark.preview.v3`).
Правила: без PR, освен ако се поиска; commit съобщенията завършват с `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` и `Claude-Session: …`; push: `git push -u origin claude/add-spark-dating`; ако Stop hook се оплаче за „непушнати“ – `git fetch origin '+refs/heads/claude/add-spark-dating:refs/remotes/origin/claude/add-spark-dating'` (локалният tracking ref е остарял, не липсва нищо).
Капани: `Element.append(null)` пише „null“ → `.filter(Boolean)`; `e.currentTarget` е null след `await`; строг CSP (без inline стилове, `h()` ги задава през CSSOM, `connect-src 'self'`); DOM само през textContent.

## Направено (всичко работи и е тествано)
- Сайт за запознанства: регистрация/вход, никнейм, снимки (до 6), био, интереси, тъмна тема + собствени цветове/шрифт, области → населени места (ЕКАТТЕ), филтри (сгъваем панел), харесвания/активност/посещения.
- Имейл верификация, доклади, досиета, наказания (предупреждение/суспензия/дерегистрация), обжалване, забрана на имейл след дерегистрация; админ вижда чатове само като доклад-снимка (журнал).
- Чат: лични и групови, снимки/файлове, наши жълти SVG емотиконки + емоджи, **лични стикери и икони** (качване от телефона или рисуване в редактор), прозорче-кръгче с глоу, **гласови/видео обаждания** (WebRTC P2P, сигнали през HTTP polling, STUN по подразбиране, `ICE_SERVERS` за TURN).
- **Мобилен вид ≤700px:** долна лента с табове, меню „Още“, филтри на цял екран, 2 колони, чат/обаждания на цял екран. Визия: карти със снимка, конфети при взаимно харесване, skeleton зареждане, **преглед на снимки на цял екран**.
- **Наблизо на живо:** доброволно споделяне (`/api/live`, таблица `live_locations`), само грубо разстояние (≥300 м), взаимно, авто-спиране (3 ч / 5 мин без сигнал), анти-„телепорт“; плюс приблизително разстояние между населените места (GeoNames, `server/places-geo.json`), по желание „Потвърди с GPS“ (✓), смяна на място веднъж на 7 дни. Радиусният филтър е премахнат.
- **Отделна администрация:** `APP_MODE=public|admin|all` (в production `all` е забранен). Админ процесът (`server/admin-index.js`) – друг порт/бисквитка, акаунти и сесии в `admin.db`, вход парола + TOTP (еднократни кодове, заключване след 5 грешки, 30 мин. idle / 8 ч. макс.). Необратими действия: нов 2FA код + резервно копие преди тях + лимит 10/час. Панел „Сигурност“ (журнал `security_events`).
- **Защити:** CSP/HSTS/Permissions-Policy/COOP/CORP, CSRF по Origin/Sec-Fetch-Site, rate limit по IP, ≤72 байта и без слаби пароли, резервни копия (`server/backup.js`), `nodemailer` ^10.3.1 (`npm audit` = 0).
- **Разгръщане (подготвено, НЕ пуснато):** `Dockerfile`, `deploy/docker-compose.yml` (web + admin + backup + Caddy, отделни волюми), `deploy/Caddyfile`, `deploy/.env.example`, `docs/DEPLOY.md`.

## Предстои / за следваща сесия
1. **Публикуване** (изисква акаунт на потребителя): Oracle Cloud Always Free VM + Docker + домейн (DuckDNS или платен) – следвай `docs/DEPLOY.md`. Docker образът/compose **не са тествани на работеща машина** (тук няма стартиран Docker демон) – очаквай дребни поправки при първо пускане. Нужен е истински SMTP (`SMTP_URL`), иначе в production не стартира.
2. След пускане: създай админ (`docker compose run --rm -it admin node scripts/create-admin.js <име>`), добави 2FA ключа в приложение, ограничи `ADMIN_ALLOW_IPS`, настрой изтегляне на копията извън машината, провери възстановяване от копие.
3. По избор: отваряне на PR за публикуване на статичното демо в GitHub Pages (`spark-dating/`) – потребителят още не е отговорил.
4. Идеи/неизяснено: по-топла цветова палитра по избор и „история“ на картата (по-малко „панел“, повече запознанство); иконите не са вградени в текста (само отделно съобщение); GIF стикерите стават неподвижни; на живо – заявки на ~6 сек., не WebSocket; при много потребители – Postgres, S3/R2 за снимки, SSE/WebSocket, Redis (виж отговора за капацитета: комфортно ≈ десетки хиляди профила, ~500–1500 онлайн на 2 ядра; не е мерен реален товар); обажданията нямат групови разговори и без TURN не работят през строги мрежи; GPS проверката/на живо може да се имитира.
5. Не са тествани на истински телефон: мобилен вид, живо споделяне при движение, обаждания (тествани само с емулация/фалшиви устройства в Chromium).
