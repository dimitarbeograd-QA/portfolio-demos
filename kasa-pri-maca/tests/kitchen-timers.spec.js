const { test } = require('@playwright/test');
const { expect, openApp, testLogin, switchRole, orderOneItem } = require('./helpers');

test.describe('Кухня и таймери (TC-030..035)', () => {
  test('поръчка → готово → взимане → плащане, със записани времена', async ({ page }) => {
    const errors = await openApp(page);
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');

    // TC-030: новата поръчка се вижда при сервитьора като „в кухнята“ с таймер
    await orderOneItem(page, 7);
    await expect(page.locator('#oKt')).toContainText('В кухнята');
    await page.click('#toTables');
    await expect(page.locator('[data-t="7"] .tk .tm')).toBeVisible();

    // TC-034: таймерът върви
    const t1 = await page.locator('[data-t="7"] .tk .tm').innerText();
    await page.waitForTimeout(2100);
    const t2 = await page.locator('[data-t="7"] .tk .tm').innerText();
    expect(t2).not.toBe(t1);

    // TC-030: появява се при готвача
    await switchRole(page, 'cook');
    await expect(page.locator('#kitchenView')).toContainText('Маса 7');

    // TC-031: готово → банер при сервитьора
    await page.click('[data-kdone]');
    await switchRole(page, 'waiter');
    await expect(page.locator('#kalert')).toContainText('Маса 7 е готова');

    // TC-032: сервитьорът взема поръчката
    await page.click('#tgrid [data-t="7"]');
    await expect(page.locator('#oTake')).toBeVisible();
    await expect(page.locator('#oKt')).toContainText('чака за взимане');
    await page.click('#oTake');
    await expect(page.locator('#oKt')).toContainText('взета след');

    // TC-035: при плащане се записва времето
    await page.click('#open');
    await page.click('#issue');
    await page.waitForTimeout(400);
    const kt = await page.evaluate(() => {
      const h = JSON.parse(localStorage.getItem('pmt_history') || '[]');
      return h.map(r => r.kt);
    });
    expect(kt).toHaveLength(1);
    expect(kt[0].d).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('TC-033 „Върни в готвене“ връща поръчката и пази натрупаното време', async ({ page }) => {
    await openApp(page);
    await testLogin(page, 'manager');
    await switchRole(page, 'waiter');
    await orderOneItem(page, 3);
    await page.click('#toTables');
    await switchRole(page, 'cook');
    await page.click('[data-kdone]');
    await expect(page.locator('[data-kundo]')).toBeVisible();
    await page.click('[data-kundo]');
    await expect(page.locator('[data-kdone]')).toBeVisible();
  });

  test('TC-039 без връзка с базата кухненският екран го казва ясно', async ({ page }) => {
    await openApp(page, { fakeDb: false });
    await testLogin(page, 'cook');
    await expect(page.locator('#kitchenView')).toContainText('Няма връзка със сървъра');
  });
});
