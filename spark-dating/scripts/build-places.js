// Сглобява server/places.json от официалния ЕКАТТЕ на НСИ (JSON архив).
// Свали: https://www.nsi.bg/nrnm/ekatte/archive  → „Ekatte-YYYY-json.zip“, разархивирай и подай папката:
//   node scripts/build-places.js /път/до/разархивираната/папка
const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2];
if (!dir) { console.error('Употреба: node scripts/build-places.js <папка с ek_atte.json, ek_obl.json, ek_obst.json>'); process.exit(1); }
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).filter(r => r.ekatte); // пропуска служебния ред с дата

const atte = read('ek_atte.json');
const obl = read('ek_obl.json');
const obst = read('ek_obst.json');

// Област → име на областния център (така се казва и областта, напр. „Благоевград“).
// „София“ е и столицата, и областта – разграничаваме ги, за да не се бъркат в списъка.
const RENAME = { SFO: 'София (област)' };
const regions = obl.map(r => ({ code: r.oblast, name: RENAME[r.oblast] || r.name }));
const regionName = new Map(regions.map(r => [r.code, r.name]));
const obshtini = {};
for (const r of obst) obshtini[r.obshtina] = r.name;

const kindOrder = { 'гр.': 0, 'ман.': 2 };
const places = atte
  .map(r => [r.ekatte, r.t_v_m, r.name, r.oblast, r.obshtina])
  .sort((a, b) => a[3].localeCompare(b[3]) || (kindOrder[a[1]] ?? 1) - (kindOrder[b[1]] ?? 1) || a[2].localeCompare(b[2], 'bg') || a[0].localeCompare(b[0]));

for (const p of places) if (!regionName.has(p[3])) throw new Error('Неизвестна област ' + p[3]);

regions.sort((a, b) => a.name.localeCompare(b.name, 'bg'));
const out = path.join(__dirname, '..', 'server', 'places.json');
// Един ред на населено място – по-малък diff при обновяване.
const body = '{\n"source": "НСИ, ЕКАТТЕ (https://www.nsi.bg/nrnm/ekatte/archive)",\n"regions": ' + JSON.stringify(regions) +
  ',\n"obshtini": ' + JSON.stringify(obshtini) + ',\n"places": [\n' + places.map(p => JSON.stringify(p)).join(',\n') + '\n]\n}\n';
fs.writeFileSync(out, body);
console.log(`OK: ${regions.length} области, ${Object.keys(obshtini).length} общини, ${places.length} населени места → ${out} (${Math.round(body.length / 1024)} KB)`);
