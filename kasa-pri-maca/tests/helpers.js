const { expect } = require('@playwright/test');

// In-memory stand-in for the shared database the page gets from claude.ai.
const FAKE_DB = `
(() => {
  const store = {}, subs = [];
  const snap = col => {
    const docs = Object.keys(store[col] || {}).sort().map(id => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(store[col][id])) }));
    return { docs, size: docs.length, empty: !docs.length };
  };
  const fire = col => subs.filter(s => s.col === col).forEach(s => setTimeout(() => s.cb(snap(col)), 5));
  const db = { collection(col) { return {
    onSnapshot(cb) { const s = { col, cb }; subs.push(s); setTimeout(() => cb(snap(col)), 5); return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); }; },
    doc(id) { return {
      set(d) { store[col] = store[col] || {}; store[col][id] = JSON.parse(JSON.stringify(d)); fire(col); return Promise.resolve(); },
      delete() { if (store[col]) delete store[col][id]; fire(col); return Promise.resolve(); } }; } }; } };
  window.__store = store;
  window.claude = { use: n => Promise.resolve(n === 'db' ? db : null) };
})();
`;

async function openApp(page, { fakeDb = true } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (fakeDb) await page.addInitScript(FAKE_DB);
  await page.goto('');
  return errors;
}

async function testLogin(page, role) {
  await page.click(`[data-trole="${role}"]`);
  await page.waitForTimeout(300);
}

async function switchRole(page, role) {
  await page.click(`#swRole [data-role=${role}]`);
  await page.waitForTimeout(400);
}

// Waiter opens table n and taps the first menu item once.
async function orderOneItem(page, n) {
  await page.click(`#tgrid [data-t="${n}"]`);
  await page.click('#menu [data-key="0.0"]');
  await page.waitForTimeout(300);
}

module.exports = { expect, openApp, testLogin, switchRole, orderOneItem };
