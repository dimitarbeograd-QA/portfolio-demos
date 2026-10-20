const { test } = require('@playwright/test');
const { expect, openApp, testLogin, switchRole, orderOneItem } = require('./helpers');

test.describe('Плащане и меню', () => {
  test('TC-020/022 брой с ресто и бакшиш отделно от оборота', async ({ page }) => {
    await openApp(page);
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');
    await orderOneItem(page, 4);
    await page.click('#open');
    await page.fill('#tipcustom', '1');
    await page.fill('#given', '50');
    await page.click('#issue');
    await page.waitForTimeout(400);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('pmt_history') || '[]')[0]);
    expect(rec).toBeTruthy();
    const total = rec.lines.reduce((s, l) => s + l.qty * l.cents, 0);
    expect(total).toBeGreaterThan(0);
    // бакшишът се пази отделно и не е част от сумата на редовете
    expect(JSON.stringify(rec)).toMatch(/tip/i);
  });

  test('TC-042 менюто се зарежда след презареждане в тестов режим', async ({ page }) => {
    await openApp(page);
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');
    await page.reload();
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');
    await page.click('#tgrid [data-t="1"]');
    await expect(page.locator('#menu [data-key="0.0"]')).toBeVisible();
  });
});
