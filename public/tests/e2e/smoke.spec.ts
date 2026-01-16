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
  await expect(page.locator('#lumamu_sample_controls')).toBeVisible();
  await expect(page.locator('#luma1_sample_controls')).toBeHidden();
});
