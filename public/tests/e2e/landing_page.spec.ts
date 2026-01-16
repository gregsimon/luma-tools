import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('shows selection UI on first visit', async ({ page }) => {
    await page.goto('/');
    
    // Check for logo and selection options
    await expect(page.locator('.logo .icon')).toBeVisible();
    await expect(page.locator('.logo .text-logo')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'SELECT YOUR DEVICE' })).toBeVisible();
    
    // Check for device choices
    await expect(page.getByText('Luma-1', { exact: true })).toBeVisible();
    await expect(page.getByText('Luma-Mu', { exact: true })).toBeVisible();
  });

  test('selecting Luma-1 sets localStorage and redirects', async ({ page }) => {
    await page.goto('/');
    
    // Click Luma-1
    await page.getByText('Luma-1', { exact: true }).click();
    
    // Should redirect to luma1/
    await expect(page).toHaveURL(/\/luma1\/$/);
    await expect(page).toHaveTitle(/Luma-1 Tools/);
    
    // Verify localStorage
    const deviceMode = await page.evaluate(() => localStorage.getItem('deviceMode'));
    expect(deviceMode).toBe('luma1');
  });

  test('selecting Luma-Mu sets localStorage and redirects', async ({ page }) => {
    await page.goto('/');
    
    // Click Luma-Mu
    await page.getByText('Luma-Mu', { exact: true }).click();
    
    // Should redirect to luma1/
    await expect(page).toHaveURL(/\/luma1\/$/);
    await expect(page).toHaveTitle(/Luma-Mu Tools/);
    
    // Verify localStorage
    const deviceMode = await page.evaluate(() => localStorage.getItem('deviceMode'));
    expect(deviceMode).toBe('lumamu');
  });

  test('automatically redirects if deviceMode is already set', async ({ page }) => {
    await page.goto('/');
    
    // Set localStorage manually
    await page.evaluate(() => localStorage.setItem('deviceMode', 'luma1'));
    
    // Reload page or go to root again
    await page.goto('/');
    
    // Should redirect immediately to luma1/
    await expect(page).toHaveURL(/\/luma1\/$/);
    await expect(page).toHaveTitle(/Luma-1 Tools/);
  });
});
