const test = require('node:test');
const assert = require('node:assert/strict');
const Zip = require('../../js/zip.js');

test('CRC32 съвпада със стандартната контролна стойност', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(Zip.crc32(bytes), 0xCBF43926);
});

test('ZIP има правилна структура и съдържание', async () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new TextEncoder().encode('привет');
  const blob = Zip.build([
    { name: 'snimka-001.jpg', data: a },
    { name: 'snimka-002.jpg', data: b }
  ]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);

  // край на централната директория
  const eocd = buf.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 2);

  // централна директория -> локални записи
  let p = dv.getUint32(eocd + 16, true);
  const names = [];
  const sizes = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const localOffset = dv.getUint32(p + 42, true);
    names.push(new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen)));
    sizes.push(size);
    assert.equal(dv.getUint32(localOffset, true), 0x04034b50);
    p += 46 + nameLen;
  }
  assert.deepEqual(names, ['snimka-001.jpg', 'snimka-002.jpg']);
  assert.deepEqual(sizes, [a.length, b.length]);
});
