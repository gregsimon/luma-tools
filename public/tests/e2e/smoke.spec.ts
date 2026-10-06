import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/luma1/');
  await expect(page).toHaveTitle(/Luma-1 Tools/);
});

test('can switch modes', async ({ page }) => {
  await page.goto('/luma1/');
  
  const modeSelect = page.locator('#device_mode');
  await modeSelect.selectOption('lumamu');
  
  await expect(page).toHaveTitle(/Luma-Mu Tools/);
  await expect(page.locator('#lumamu_editor_frame')).toBeVisible();
  await expect(page.locator('#luma1_sample_editor')).toBeHidden();
  await expect(page.frameLocator('#lumamu_editor_frame').locator('#bank_title')).toHaveText('ROM bank');
});
