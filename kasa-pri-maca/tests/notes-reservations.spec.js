const { test } = require('@playwright/test');
const { expect, openApp, testLogin, switchRole, orderOneItem } = require('./helpers');

test.describe('Бележки и резервации (TC-015..017)', () => {
  test('часът остава след платена сметка и се попълва при редакция', async ({ page }) => {
    await openApp(page);
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');
    await orderOneItem(page, 2);
    await page.click('#toTables');

    // TC-015: записване на резервация
    await page.click('[data-tn="2"]');
    await page.fill('#tn_time', '19:30');
    await page.fill('#tn_people', '6');
    await page.fill('#tn_text', 'рожден ден');
    await page.click('[data-tnsave]');
    await expect(page.locator('[data-t="2"]')).toContainText('19:30');

    // TC-016: плащане и освобождаване на масата — резервацията остава
    await page.click('#tgrid [data-t="2"]');
    await page.click('#open');
    await page.click('#issue');
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('ov').hidden = true; });
    await expect(page.locator('[data-t="2"]')).toContainText('19:30');
    await expect(page.locator('[data-tn="2"]')).toContainText('6');

    // TC-017: редакторът показва старите данни
    await page.click('[data-tn="2"]');
    await expect(page.locator('#tn_time')).toHaveValue('19:30');
    await expect(page.locator('#tn_people')).toHaveValue('6');
    await expect(page.locator('#tn_text')).toHaveValue('рожден ден');
  });

  test('резервацията оцелява след презареждане', async ({ page }) => {
    await openApp(page);
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');
    await page.click('[data-tn="5"]');
    await page.fill('#tn_time', '20:15');
    await page.fill('#tn_people', '4');
    await page.click('[data-tnsave]');
    await page.reload();
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');
    await expect(page.locator('[data-t="5"]')).toContainText('20:15');
  });
});
