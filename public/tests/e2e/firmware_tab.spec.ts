import { test, expect } from '@playwright/test';

test.describe('Firmware Tab', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the GitHub API response
    await page.route('https://api.github.com/repos/joebritt/luma1/contents/TeensyCode', async route => {
      const json = [
        { name: "Luma1", type: "dir", html_url: "http://example.com/Luma1" },
        { name: "Prebuilt 0.92", type: "dir", html_url: "http://example.com/v0.92" },
        { name: "Prebuilt 0.945", type: "dir", html_url: "http://example.com/v0.945" },
        { name: "Prebuilt 0.941", type: "dir", html_url: "http://example.com/v0.941" }
      ];
      await route.fulfill({ json });
    });

    // Go to the main app page in Luma-1 mode
    await page.goto('/luma1/');

    // Ensure we are in Luma-1 mode
    await page.evaluate(() => {
      localStorage.setItem('deviceMode', 'luma1');
      // @ts-ignore
      if (window.changeDeviceMode) window.changeDeviceMode();
    });
  });

  test('can navigate to firmware tab', async ({ page }) => {
    // Click the Firmware tab button
    await page.locator('#firmware_tab_button').click();

    // Verify the firmware tab is visible
    await expect(page.locator('#firmware_tab')).toBeVisible();

    // Verify initial "Unknown" states
    await expect(page.locator('#latest_firmware_version')).toHaveText('Unknown');
  });

  test('checks for updates successfully when update available', async ({ page }) => {
    // Mock connected device version to be older
    await page.evaluate(() => {
      // @ts-ignore
      luma_firmware_version = "0.941";
    });

    await page.locator('#firmware_tab_button').click();

    // Initial check - should be scanning or empty until we check
    await expect(page.locator('#current_firmware_version_tab')).toHaveText('Scanning...');

    // Click check button
    await page.locator('#check_firmware_btn').click();

    // Now it should show the device version
    await expect(page.locator('#current_firmware_version_tab')).toHaveText('0.941');

    // Verify results
    // The latest in our mock is 0.945
    await expect(page.locator('#latest_firmware_version')).toHaveText('0.945');

    // Should show update available message
    await expect(page.locator('#firmware_status')).toContainText('Update available!');
    await expect(page.locator('#firmware_status a')).toHaveAttribute('href', 'http://example.com/v0.945');
  });

  test('checks for updates successfully when up to date', async ({ page }) => {
    // Mock connected device version to be latest
    await page.evaluate(() => {
      // @ts-ignore
      luma_firmware_version = "0.945";
    });

    await page.locator('#firmware_tab_button').click();
    await page.locator('#check_firmware_btn').click();

    // Verify results
    await expect(page.locator('#latest_firmware_version')).toHaveText('0.945');
    await expect(page.locator('#firmware_status')).toContainText('Your firmware is up to date.');
  });

  test('handles version string with v prefix correctly', async ({ page }) => {
    // Mock connected device version to have 'v' prefix
    await page.evaluate(() => {
      // @ts-ignore
      luma_firmware_version = "v0.941";
    });

    await page.locator('#firmware_tab_button').click();
    await page.locator('#check_firmware_btn').click();

    // Latest is 0.945, device is v0.941 -> Update Available
    await expect(page.locator('#latest_firmware_version')).toHaveText('0.945');
    await expect(page.locator('#firmware_status')).toContainText('Update available!');
  });
});
