const test = require('node:test');
const assert = require('node:assert/strict');
const RSVP = require('../../js/rsvp.js');

const ok = { name: 'Иван Петров', attending: 'yes', guests: '2', note: '' };

test('валиден отговор "идвам" няма грешки', () => {
  assert.deepEqual(RSVP.validate(ok, 2), {});
});

test('празно име и име с 1 символ са грешка', () => {
  assert.ok(RSVP.validate({ ...ok, name: '' }, 2).name);
  assert.ok(RSVP.validate({ ...ok, name: '  ' }, 2).name);
  assert.ok(RSVP.validate({ ...ok, name: 'И' }, 2).name);
});

test('име: граница 80 символа', () => {
  assert.equal(RSVP.validate({ ...ok, name: 'а'.repeat(80) }, 2).name, undefined);
  assert.ok(RSVP.validate({ ...ok, name: 'а'.repeat(81) }, 2).name);
});

test('липсващ или невалиден отговор е грешка', () => {
  assert.ok(RSVP.validate({ ...ok, attending: '' }, 2).attending);
  assert.ok(RSVP.validate({ ...ok, attending: 'maybe' }, 2).attending);
});

test('брой души: невалидни стойности', () => {
  ['', '0', '-1', '1.5', 'abc', '1e1', ' '].forEach(v => {
    assert.ok(RSVP.validate({ ...ok, guests: v }, 5).guests, 'трябва да е грешка за: "' + v + '"');
  });
});

test('брой души: граница според местата в поканата', () => {
  assert.equal(RSVP.validate({ ...ok, guests: '2' }, 2).guests, undefined);
  assert.ok(RSVP.validate({ ...ok, guests: '3' }, 2).guests);
  assert.equal(RSVP.validate({ ...ok, guests: '1' }, 1).guests, undefined);
  assert.ok(RSVP.validate({ ...ok, guests: '2' }, 1).guests);
});

test('при "не идвам" броят души не се проверява', () => {
  assert.deepEqual(RSVP.validate({ ...ok, attending: 'no', guests: 'abc' }, 2), {});
});

test('бележка: граница 300 символа', () => {
  assert.equal(RSVP.validate({ ...ok, note: 'x'.repeat(300) }, 2).note, undefined);
  assert.ok(RSVP.validate({ ...ok, note: 'x'.repeat(301) }, 2).note);
});
