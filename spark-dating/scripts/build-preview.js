// Сглобява ЕДИН html файл за статичен преглед (без сървър): css + app.js + mock API.
// Резултат: index.html в корена на проекта = статичното демо за GitHub Pages.
// Употреба: node scripts/build-preview.js [изходен/файл.html]
const fs = require('node:fs');
const path = require('node:path');
const { INTERESTS, REPORT_REASONS, GOALS, SUSPEND_DAYS } = require('../server/constants');
const places = require('../server/places');
const placesData = require('../server/places.json');
const { PEOPLE, randomInterests, SAMPLE_REPORTS, TEST_USER, TEST_CHATS, TEST_GROUPS, SAMPLE_PENALTIES } = require('../server/seed-data');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const placeIdOf = name => { const p = places.findPlace(name); if (!p) throw new Error('Неизвестно място: ' + name); return p.id; };
const people = PEOPLE.map(([nickname, gender, age, city, bio], i) => ({
  nickname, gender, age, placeId: placeIdOf(city), bio, interests: randomInterests(i),
  lookingFor: i % 9 === 0 ? 'any' : gender === 'male' ? 'female' : gender === 'female' ? 'male' : 'any',
}));
// Hash маршрутите в артефактите са само #name (не #/path).
const app = read('public/js/app.js')
  .replace(/#\/discover/g, '#discover').replace(/#\/profile/g, '#profile').replace(/#\/settings/g, '#settings')
  .replace(/'#\/'/g, "'#'").replace(/href: '#\/'/g, "href: '#'");
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const headPart = `<title>Spark — запознанства</title>
<style>
${read('public/css/style.css')}
html, body { height: auto; }
</style>
`;
const bodyPart = `<div class="bg-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
<header class="topbar" id="topbar">
  <a class="brand" href="#" aria-label="Spark — начало">
    <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><path d="M34 6 18 36h12l-3 22 19-32H33z" fill="currentColor"/></svg><span>Spark</span>
  </a>
  <nav class="nav" id="nav" aria-label="Основна навигация"></nav>
  <div class="tools">
    <div class="fontctl" role="group" aria-label="Размер на шрифта">
      <button type="button" class="chip-btn" id="fontDown" aria-label="По-малък шрифт" title="По-малък шрифт">A−</button>
      <button type="button" class="chip-btn" id="fontReset" aria-label="Нормален шрифт" title="Нормален размер">A</button>
      <button type="button" class="chip-btn" id="fontUp" aria-label="По-голям шрифт" title="По-голям шрифт">A+</button>
    </div>
    <div id="userbox"></div>
  </div>
</header>
<div id="banners" class="banners"></div>
<main id="view" tabindex="-1"></main>
<footer class="foot"><span>© Spark · само за лица над 18 години</span><span class="dim">Профилите с значка „демо“ са примерни.</span></footer>
<div id="modalRoot"></div>
<div id="toasts" role="status" aria-live="polite"></div>
<script>window.__SPARK_PREVIEW__ = ${safe(JSON.stringify({ places: { regions: placesData.regions, obshtini: placesData.obshtini, places: placesData.places }, geo: require('../server/places-geo.json').coords, adminPlaceId: placeIdOf('София'), interests: INTERESTS, people, reportReasons: REPORT_REASONS, sampleReports: SAMPLE_REPORTS, testUser: { ...TEST_USER, placeId: placeIdOf(TEST_USER.city) }, testChats: TEST_CHATS, testGroups: TEST_GROUPS, samplePenalties: SAMPLE_PENALTIES, goals: GOALS, suspendDays: SUSPEND_DAYS, strikeLimit: 3 }))};</script>
<script>
${safe(read('preview/mock-api.js'))}
</script>
<script>
${safe(read('public/js/emoticons.js'))}
</script>
<script>
${safe(app)}
</script>
`;
// 1) index.html – ПЪЛЕН документ (за GitHub Pages и директно отваряне; има viewport за телефони).
// 2) preview/artifact.html – фрагмент без <html>/<head> (платформата за артефакти добавя собствена обвивка).
const full = `<!doctype html>\n<html lang="bg">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="color-scheme" content="dark">\n<meta name="theme-color" content="#070b14">\n${headPart}</head>\n<body>\n${bodyPart}</body>\n</html>\n`;
const out = process.argv[2] || path.join(root, 'index.html');
fs.writeFileSync(out, full);
const fragOut = process.argv[3] || path.join(root, 'preview', 'artifact.html');
fs.writeFileSync(fragOut, headPart + bodyPart);
console.log('OK', out, Math.round(full.length / 1024) + ' KB', '+ фрагмент', path.relative(root, fragOut));
