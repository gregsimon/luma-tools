import { test, expect } from '@playwright/test';

test('audio processing: reverse integrity', async ({ page }) => {
  await page.goto('/');

  // 1. Generate and load a unique test sample (0, 1, 2, ..., 255)
  const sampleSize = 256;
  const originalData = Array.from({ length: sampleSize }, (_, i) => i);
  
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

  // 2. Verify initial state
  let currentData = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData);
  });
  expect(currentData).toEqual(originalData);

  // 3. Reverse the sample
  await page.selectOption('#function_picker', 'Reverse');

  // 4. Check that it is reversed
  currentData = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData);
  });
  const expectedReversed = [...originalData].reverse();
  expect(currentData).toEqual(expectedReversed);
  expect(currentData[0]).toBe(255);
  expect(currentData[255]).toBe(0);

  // 5. Reverse again
  await page.selectOption('#function_picker', 'Reverse');

  // 6. Check that it is back to original
  currentData = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData);
  });
  expect(currentData).toEqual(originalData);
});

