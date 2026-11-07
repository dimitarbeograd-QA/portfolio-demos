// Области и населени места (ЕКАТТЕ на НСИ). Данните са в places.json (виж scripts/build-places.js).
const data = require('./places.json');

const REGIONS = data.regions; // [{ code, name }]
const REGION_BY_CODE = new Map(REGIONS.map(r => [r.code, r]));
const PLACES = data.places.map(([id, kind, name, region, ob]) => ({
  id, kind, name, region, obshtina: data.obshtini[ob] || '',
  // Градовете се показват само с името, селата и манастирите – с „с. Име“.
  label: kind === 'гр.' ? name : `${kind} ${name}`,
  key: name.toLowerCase(),
}));
const BY_ID = new Map(PLACES.map(p => [p.id, p]));
const BY_REGION = new Map(REGIONS.map(r => [r.code, PLACES.filter(p => p.region === r.code)]));

function describe(p) {
  if (!p) return null;
  return { id: p.id, label: p.label, kind: p.kind, name: p.name, obshtina: p.obshtina, region: p.region, regionName: REGION_BY_CODE.get(p.region).name };
}

// Търсене в област: първо започващите с текста, после съдържащите го. Градовете са преди селата.
function search(regionCode, q, limit = 30) {
  const list = BY_REGION.get(regionCode) || [];
  const term = String(q || '').toLowerCase().replace(/^(гр\.|с\.|ман\.)\s*/, '').trim();
  if (!term) return list.slice(0, limit);
  const starts = [], inside = [];
  for (const p of list) {
    const i = p.key.indexOf(term);
    if (i === 0) starts.push(p); else if (i > 0) inside.push(p);
  }
  return starts.concat(inside).slice(0, limit);
}

// За сийда: намира място по име (градовете имат предимство), по желание в конкретна област или вид.
function findPlace(name, { region, kind } = {}) {
  const k = name.toLowerCase();
  const hits = PLACES.filter(p => p.key === k && (!region || p.region === region) && (!kind || p.kind === kind));
  return hits.find(p => p.kind === 'гр.') || hits[0] || null;
}

module.exports = { REGIONS, REGION_BY_CODE, PLACES, BY_ID, BY_REGION, describe, search, findPlace };
