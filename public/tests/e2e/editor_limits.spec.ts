import { test, expect } from '@playwright/test';

test.describe('Editor Limits', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should allow loading samples larger than 32768 in Luma-1 mode', async ({ page }) => {
    const largeSize = 50000;
    
    await page.evaluate((size) => {
      // @ts-ignore
      current_mode = "luma1";
      // @ts-ignore
      editorSampleData = new Uint8Array(size).fill(128);
      // @ts-ignore
      editorSampleLength = size;
      // @ts-ignore
      if (typeof trimBufferToFitLuma === 'function') trimBufferToFitLuma();
    }, largeSize);

    const length = await page.evaluate(() => {
      // @ts-ignore
      return editorSampleLength;
    });

    expect(length).toBe(largeSize);
  });

  test('should allow loading samples larger than 16384 in Luma-Mu mode', async ({ page }) => {
    const largeSize = 25000;
    
    await page.evaluate((size) => {
      // @ts-ignore
      current_mode = "lumamu";
      // @ts-ignore
      editorSampleData = new Uint8Array(size).fill(128);
      // @ts-ignore
      editorSampleLength = size;
      // @ts-ignore
      if (typeof trimBufferToFitLuma === 'function') trimBufferToFitLuma();
    }, largeSize);

    const length = await page.evaluate(() => {
      // @ts-ignore
      return editorSampleLength;
    });

    expect(length).toBe(largeSize);
  });

  test('should truncate to hardware limits when copying from editor to voice slots', async ({ page }) => {
    const largeSize = 50000;
    
    // Set up editor with a very large sample
    await page.evaluate((size) => {
      // @ts-ignore
      current_mode = "luma1"; // Limit is 32768
      // @ts-ignore
      editorSampleData = new Uint8Array(size).fill(128);
      // @ts-ignore
      editorSampleLength = size;
      // @ts-ignore
      editor_in_point = 0;
      // @ts-ignore
      editor_out_point = size - 1;
      
      // Copy from editor (255) to slot 0
      // @ts-ignore
      if (typeof copyWaveFormBetweenSlots === 'function') {
        // @ts-ignore
        copyWaveFormBetweenSlots(255, 0);
      }
    }, largeSize);

    const slotLength = await page.evaluate(() => {
      // @ts-ignore
      return bank[0].sampleLength;
    });

    // Luma-1 limit is 32768
    expect(slotLength).toBe(32768);

    // Switch to Luma-Mu and copy again
    await page.evaluate(() => {
      // @ts-ignore
      current_mode = "lumamu"; // Limit is 16384
      // @ts-ignore
      editor_in_point = 0;
      // @ts-ignore
      editor_out_point = 50000 - 1;
      
      // @ts-ignore
      if (typeof copyWaveFormBetweenSlots === 'function') {
        // @ts-ignore
        copyWaveFormBetweenSlots(255, 1);
      }
    });

    const muSlotLength = await page.evaluate(() => {
      // @ts-ignore
      return bank[1].sampleLength;
    });

    // Luma-Mu limit is 16384
    expect(muSlotLength).toBe(16384);
  });
});

