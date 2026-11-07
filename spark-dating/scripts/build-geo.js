// Прави server/places-geo.json: координати (центрове) на населените места.
// Източник: GeoNames (CC BY 4.0), файл BG.txt. Употреба: node scripts/build-geo.js /път/до/BG.txt
const fs = require('fs'), path = require('path');
const data = require('../server/places.json');
const A1 = { BLG: 38, BGS: 39, VAR: 61, VTR: 62, VID: 63, VRC: 64, GAB: 41, DOB: 40, KRZ: 44, KNL: 45, LOV: 46, MON: 47, PAZ: 48, PER: 49, PVN: 50, PDV: 51, RAZ: 52, RSE: 53, SLS: 55, SLV: 56, SML: 57, SFO: 58, SOF: 42, SZR: 59, TGV: 60, HKV: 43, SHU: 54, JAM: 65 };
const norm = s => s.toLowerCase().replace(/ё/g, 'е').trim();
const byA1 = new Map();
for (const line of fs.readFileSync(process.argv[2] || 'BG.txt', 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15 || f[6] !== 'P') continue;
  const a1 = Number(f[10]);
  const names = new Set(f[3].split(',').filter(n => /[а-я]/i.test(n)).map(norm));
  const rec = { lat: +f[4], lng: +f[5], pop: +f[14] || 0, names };
  (byA1.get(a1) || byA1.set(a1, []).get(a1)).push(rec);
}
const out = {}, byOb = new Map(), byReg = new Map();
let exact = 0, amb = 0;
for (const [id, kind, name, region, ob] of data.places) {
  const pool = [...(byA1.get(A1[region]) || []), ...(region === 'SFO' ? byA1.get(42) || [] : [])];
  const hits = pool.filter(r => r.names.has(norm(name)));
  if (hits.length) {
    const best = hits.sort((a, b) => b.pop - a.pop)[0];
    out[id] = [+best.lat.toFixed(3), +best.lng.toFixed(3)]; exact++; if (hits.length > 1) amb++;
    for (const [m, k] of [[byOb, ob], [byReg, region]]) { const c = m.get(k) || { la: 0, ln: 0, n: 0 }; c.la += best.lat; c.ln += best.lng; c.n++; m.set(k, c); }
  }
}
let viaOb = 0, viaReg = 0;
for (const [id, , , region, ob] of data.places) {
  if (out[id]) continue;
  const c = byOb.get(ob), r = byReg.get(region);
  if (c) { out[id] = [+(c.la / c.n).toFixed(3), +(c.ln / c.n).toFixed(3)]; viaOb++; }
  else if (r) { out[id] = [+(r.la / r.n).toFixed(3), +(r.ln / r.n).toFixed(3)]; viaReg++; }
}
fs.writeFileSync(path.join(__dirname, '../server/places-geo.json'), JSON.stringify({ source: 'GeoNames (CC BY 4.0) https://www.geonames.org', coords: out }));
console.log({ total: data.places.length, exact, ambiguous: amb, viaObshtina: viaOb, viaRegion: viaReg });
