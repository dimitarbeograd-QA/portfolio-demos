const { test } = require('@playwright/test');
const { expect, openApp, testLogin, switchRole, orderOneItem } = require('./helpers');

for (const width of [360, 320]) {
  test.describe(`Оформление на ${width} px (TC-050..052)`, () => {
    test.use({ viewport: { width, height: 780 } });

    const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    test('екраните нямат хоризонтално скролиране', async ({ page }) => {
      await openApp(page);
      expect(await noOverflow(page)).toBe(true);                 // вход
      await testLogin(page, 'manager');
      await switchRole(page, 'waiter');
      expect(await noOverflow(page)).toBe(true);                 // маси
      await orderOneItem(page, 7);
      expect(await noOverflow(page)).toBe(true);                 // меню + поръчка
      await page.click('#open');
      expect(await noOverflow(page)).toBe(true);                 // сметка
    });

    test('плочките с бележки не се припокриват', async ({ page }) => {
      await openApp(page);
      await testLogin(page, 'manager');
      await switchRole(page, 'waiter');
      await page.click('[data-tn="1"]');
      await page.fill('#tn_time', '18:00');
      await page.fill('#tn_people', '12');
      await page.fill('#tn_text', 'голяма компания за вечеря');
      await page.click('[data-tnsave]');
      const tile = page.locator('[data-t="1"]');
      const box = await tile.boundingBox();
      const kids = await tile.locator('> *').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { r: r.right, l: r.left }; }));
      for (const k of kids) {
        expect(k.l).toBeGreaterThanOrEqual(box.x - 1);
        expect(k.r).toBeLessThanOrEqual(box.x + box.width + 1);
      }
    });
  });
}
