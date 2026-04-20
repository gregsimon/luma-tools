import { test, expect } from '@playwright/test';

test('Duplicate to Fill repeats the selection to fill 32k for Luma-1', async ({ page }) => {
  await page.goto('/luma1/');

  // 1. Generate and load a short test sample
  const originalData = [10, 20, 30, 40];
  
  await page.evaluate((data) => {
    // @ts-ignore
    editorSampleData = new Uint8Array(data);
    // @ts-ignore
    editorSampleLength = data.length;
    // @ts-ignore
    editor_in_point = 0;
    // @ts-ignore
    editor_out_point = data.length - 1;
    // @ts-ignore
    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  }, originalData);

  // 2. Select "Duplicate to Fill"
  await page.selectOption('#function_picker', 'Duplicate to Fill');

  // 3. Verify it expanded to the correct length
  const { length, first8, last4 } = await page.evaluate(() => {
    // @ts-ignore
    return {
      // @ts-ignore
      length: editorSampleLength,
      // @ts-ignore
      first8: Array.from(editorSampleData.subarray(0, 8)),
      // @ts-ignore
      last4: Array.from(editorSampleData.subarray(editorSampleData.length - 4))
    };
  });

  // Luma-1 mode default max size is 32768
  expect(length).toBe(32768);
  expect(first8).toEqual([10, 20, 30, 40, 10, 20, 30, 40]);
  // 32768 is a multiple of 4, so it should end perfectly with [10, 20, 30, 40]
  expect(last4).toEqual([10, 20, 30, 40]);
});

test('Duplicate to Fill repeats the selection to fill 16k for Luma-Mu', async ({ page }) => {
  await page.goto('/luma1/');
  
  // Switch to lumamu
  await page.selectOption('#device_mode', 'lumamu');

  // Generate a test sample of 3 items
  const originalData = [5, 15, 25];
  
  await page.evaluate((data) => {
    // @ts-ignore
    editorSampleData = new Uint8Array(data);
    // @ts-ignore
    editorSampleLength = data.length;
    // @ts-ignore
    editor_in_point = 0;
    // @ts-ignore
    editor_out_point = data.length - 1;
    // @ts-ignore
    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  }, originalData);

  await page.selectOption('#function_picker', 'Duplicate to Fill');

  const { length, first6, last2 } = await page.evaluate(() => {
    // @ts-ignore
    return {
      // @ts-ignore
      length: editorSampleLength,
      // @ts-ignore
      first6: Array.from(editorSampleData.subarray(0, 6)),
      // @ts-ignore
      last2: Array.from(editorSampleData.subarray(editorSampleData.length - 2))
    };
  });

  // Luma-Mu max size is 16384
  expect(length).toBe(16384);
  expect(first6).toEqual([5, 15, 25, 5, 15, 25]);
  
  // 16384 % 3 = 1
  // Sequence repeats. 16383rd element is 16383 % 3 = 0 -> index 0 -> 5.
  // 16382nd element is 16382 % 3 = 2 -> index 2 -> 25.
  // So the last two elements should be [25, 5].
  expect(last2).toEqual([25, 5]);
});
