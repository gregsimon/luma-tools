import { test, expect } from '@playwright/test';

test('toggleLoopPlayback: toggles button state and UI class', async ({ page }) => {
  await page.goto('/luma1/');

  const loopButton = page.locator('#loop_playback_button');
  
  // 1. Verify initial state
  await expect(loopButton).toHaveValue('Loop: Off');
  await expect(loopButton).not.toHaveClass(/loop_active/);

  // 2. Click to toggle ON
  await loopButton.click();
  
  // Verify state changed to ON
  await expect(loopButton).toHaveValue('Loop: On');
  await expect(loopButton).toHaveClass(/loop_active/);

  // 3. Click to toggle OFF
  await loopButton.click();
  
  // Verify state changed back to OFF
  await expect(loopButton).toHaveValue('Loop: Off');
  await expect(loopButton).not.toHaveClass(/loop_active/);
});
