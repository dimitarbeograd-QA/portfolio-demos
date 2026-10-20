const { test } = require('@playwright/test');
const { expect, openApp, testLogin, switchRole } = require('./helpers');

test.describe('Вход и роли (TC-001..003)', () => {
  test('TC-001 тестов вход като управител показва банер за тестов режим', async ({ page }) => {
    const errors = await openApp(page);
    await testLogin(page, 'manager');
    await expect(page.locator('#testbar')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('TC-002 бързо превключване между трите роли', async ({ page }) => {
    await openApp(page);
    await testLogin(page, 'manager');
    for (const role of ['waiter', 'cook', 'manager']) {
      await switchRole(page, role);
      await expect(page.locator(`#swRole [data-role=${role}]`)).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('TC-003 готвачът вижда кухненския екран', async ({ page }) => {
    await openApp(page);
    await testLogin(page, 'cook');
    await expect(page.locator('#kitchenView')).toBeVisible();
    await expect(page.locator('#tgrid')).toBeHidden();
  });
});
