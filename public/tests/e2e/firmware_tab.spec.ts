import { test, expect } from '@playwright/test';

test.describe('Firmware Tab', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the GitHub API response
    await page.route('https://api.github.com/repos/joebritt/luma1/contents/TeensyCode', async route => {
      const json = [
        { name: "Luma1", type: "dir", html_url: "http://example.com/Luma1", url: "http://example.com/api/Luma1" },
        { name: "Prebuilt 0.92", type: "dir", html_url: "http://example.com/v0.92", url: "http://example.com/api/Prebuilt%200.92" },
        { name: "Prebuilt 0.945", type: "dir", html_url: "http://example.com/v0.945", url: "http://example.com/api/Prebuilt%200.945" },
        { name: "Prebuilt 0.941", type: "dir", html_url: "http://example.com/v0.941", url: "http://example.com/api/Prebuilt%200.941" }
      ];
      await route.fulfill({ json });
    });

    // Mock the specific directory call for 0.92
    await page.route('http://example.com/api/Prebuilt%200.92', async route => {
      const json = [
        { name: "Luma1.hex", download_url: "http://example.com/downloads/v0.92/Luma1.hex" },
        { name: "readme.txt" }
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

    // Verify auto-check started/finished
    // It might be "Checking..." or already "0.945" depending on speed, but definitely not "Unknown" forever
    await expect(page.locator('#latest_firmware_version')).not.toHaveText('Unknown');
  });

  test('checks for updates successfully when update available', async ({ page }) => {
    // Set mocks BEFORE navigation so auto-check picks them up
    await page.addInitScript(() => {
      // @ts-ignore
      window.localStorage.setItem('deviceMode', 'luma1');
      // @ts-ignore
      window.luma_firmware_version = "0.941";
    });

    // We must reload or go to page to trigger the init with new mocks
    await page.goto('/luma1/');

    await page.locator('#firmware_tab_button').click();

    // Auto-check should happen. 
    await expect(page.locator('#check_firmware_btn')).toBeEnabled();

    // Verify results
    await expect(page.locator('#latest_firmware_version')).toHaveText('0.945');

    // Explicitly check current version display
    await expect(page.locator('#current_firmware_version_tab')).toHaveText('0.941');

    // Should show update available message
    await expect(page.locator('#firmware_status')).toContainText('Update available!');
    await expect(page.locator('#firmware_status a')).toHaveAttribute('href', 'http://example.com/v0.945');
  });

  test('checks for updates successfully when up to date', async ({ page }) => {
    // Set mocks BEFORE navigation
    await page.addInitScript(() => {
      // @ts-ignore
      window.localStorage.setItem('deviceMode', 'luma1');
      // @ts-ignore
      window.luma_firmware_version = "0.945";
    });

    await page.goto('/luma1/');

    await page.locator('#firmware_tab_button').click();
    // No need to click check, auto-check runs

    // Verify results
    await expect(page.locator('#latest_firmware_version')).toHaveText('0.945');
    await expect(page.locator('#firmware_status')).toContainText('Your firmware is up to date.');
  });

  test('handles version string with v prefix correctly', async ({ page }) => {
    // Set mocks BEFORE navigation
    await page.addInitScript(() => {
      // @ts-ignore
      window.localStorage.setItem('deviceMode', 'luma1');
      // @ts-ignore
      window.luma_firmware_version = "v0.941";
    });

    await page.goto('/luma1/');

    await page.locator('#firmware_tab_button').click();

    // Latest is 0.945, device is v0.941 -> Update Available
    await expect(page.locator('#latest_firmware_version')).toHaveText('0.945');
    await expect(page.locator('#firmware_status')).toContainText('Update available!');
  });

  test('populates version dropdown and enables download', async ({ page }) => {
    // Set mocks BEFORE navigation
    await page.addInitScript(() => {
      // @ts-ignore
      window.localStorage.setItem('deviceMode', 'luma1');
      // @ts-ignore
      window.luma_firmware_version = "0.945"; // Version doesn't matter for dropdown, but sets mode
    });

    await page.goto('/luma1/');

    await page.locator('#firmware_tab_button').click();

    // Initial state: download disabled (even if fetched, nothing selected)
    await expect(page.locator('#download_selected_firmware_btn')).toBeDisabled();

    // Wait for dropdown to populate (latest version text appears means fetch is done)
    await expect(page.locator('#latest_firmware_version')).toHaveText('0.945');

    // Select an older version
    const dropdown = page.locator('#firmware_version_select');
    // Select by value (API URL)
    await dropdown.selectOption({ value: 'http://example.com/api/Prebuilt%200.92' });

    // Button should be enabled
    await expect(page.locator('#download_selected_firmware_btn')).toBeEnabled();

    // Verify download click triggers actual file download
    const downloadPromise = page.waitForEvent('download');

    // Setup route for the hex file itself
    await page.route('http://example.com/downloads/v0.92/Luma1.hex', async route => {
      await route.fulfill({
        body: 'hex content',
        headers: {
          'Content-Disposition': 'attachment; filename="Luma1.hex"'
        }
      });
    });

    await page.locator('#download_selected_firmware_btn').click();
    const download = await downloadPromise;

    // Verify filename
    expect(download.suggestedFilename()).toBe('Luma1.hex');
  });
});
