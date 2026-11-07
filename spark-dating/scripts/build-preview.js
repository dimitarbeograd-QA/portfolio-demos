// Сглобява ЕДИН html файл за статичен преглед (без сървър): css + app.js + mock API.
// Резултат: index.html в корена на проекта = статичното демо за GitHub Pages.
// Употреба: node scripts/build-preview.js [изходен/файл.html]
const fs = require('node:fs');
const path = require('node:path');
const { CITIES, INTERESTS, REPORT_REASONS } = require('../server/constants');
const { PEOPLE, randomInterests, SAMPLE_REPORTS, TEST_USER, TEST_CHATS } = require('../server/seed-data');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const people = PEOPLE.map(([nickname, gender, age, city, bio], i) => ({
  nickname, gender, age, city, bio, interests: randomInterests(i),
  lookingFor: i % 9 === 0 ? 'any' : gender === 'male' ? 'female' : gender === 'female' ? 'male' : 'any',
}));
// Hash маршрутите в артефактите са само #name (не #/path).
const app = read('public/js/app.js')
  .replace(/#\/discover/g, '#discover').replace(/#\/profile/g, '#profile').replace(/#\/settings/g, '#settings')
  .replace(/'#\/'/g, "'#'").replace(/href: '#\/'/g, "href: '#'");
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const html = `<title>Spark — запознанства</title>
<style>
${read('public/css/style.css')}
html, body { height: auto; }
</style>
<div class="bg-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
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
<main id="view" tabindex="-1"></main>
<footer class="foot"><span>© Spark · само за лица над 18 години</span><span class="dim">Профилите с значка „демо“ са примерни.</span></footer>
<div id="modalRoot"></div>
<div id="toasts" role="status" aria-live="polite"></div>
<script>window.__SPARK_PREVIEW__ = ${safe(JSON.stringify({ cities: CITIES, interests: INTERESTS, people, reportReasons: REPORT_REASONS, sampleReports: SAMPLE_REPORTS, testUser: TEST_USER, testChats: TEST_CHATS }))};</script>
<script>
${safe(read('preview/mock-api.js'))}
</script>
<script>
${safe(app)}
</script>
`;
const out = process.argv[2] || path.join(root, 'index.html');
fs.writeFileSync(out, html);
console.log('OK', out, Math.round(html.length / 1024) + ' KB');
