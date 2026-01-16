import { test, expect } from '@playwright/test';

test('editor selection and basic functions', async ({ page }) => {
  await page.goto('/luma1/');

  // 1. Initialize editor with some data
  const sampleSize = 4096;
  await page.evaluate((size) => {
    // @ts-ignore
    editorSampleData = new Uint8Array(size).fill(0).map((_, i) => i % 256);
    // @ts-ignore
    editorSampleLength = size;
    // @ts-ignore
    editor_in_point = 0;
    // @ts-ignore
    editor_out_point = size - 1;
    // @ts-ignore
    if (typeof updateStatusBar === 'function') updateStatusBar();
    // @ts-ignore
    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  }, sampleSize);

  // 2. Test Selection via Text Fields
  const inPointInput = page.locator('#in_point');
  const outPointInput = page.locator('#out_point');

  await inPointInput.fill('100');
  await inPointInput.dispatchEvent('input');
  
  await outPointInput.fill('2000');
  await outPointInput.dispatchEvent('input');

  let state = await page.evaluate(() => {
    // @ts-ignore
    return { in: editor_in_point, out: editor_out_point };
  });
  expect(state.in).toBe(100);
  expect(state.out).toBe(2000);

  // 3. Test "Select All" Button
  await page.click('input[value="Select All"]');
  state = await page.evaluate(() => {
    // @ts-ignore
    return { in: editor_in_point, out: editor_out_point };
  });
  expect(state.in).toBe(0);
  expect(state.out).toBe(sampleSize - 1);

  // 4. Test "Reverse" Button
  // Check first few bytes before reverse
  let firstBytes = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData.slice(0, 4));
  });
  expect(firstBytes).toEqual([0, 1, 2, 3]);

  await page.selectOption('#function_picker', 'Reverse');
  
  // Check first few bytes after reverse (should be the end of the original array reversed)
  firstBytes = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData.slice(0, 4));
  });
  // original: [..., 252, 253, 254, 255] (since 4096 % 256 is 0)
  // reversed start should be [255, 254, 253, 252]
  expect(firstBytes).toEqual([255, 254, 253, 252]);

  // 5. Test Dragging Handles
  const canvas = page.locator('#editor_canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  // Drag in-point handle (top-left)
  // The handle is a triangle at (in_offset, 0)
  await page.mouse.move(box.x + 2, box.y + 2); // Start at top left
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4, box.y + 2); // Drag to 1/4 of the way
  await page.mouse.up();

  state = await page.evaluate(() => {
    // @ts-ignore
    return { in: editor_in_point };
  });
  // Should be roughly 1/4 of sampleSize (1024)
  expect(state.in).toBeCloseTo(1024, -1); // -1 means +/- 10 tolerance

  // 6. Test Shift-Snap Dragging
  // Drag in-point handle with shift key
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width / 4, box.y + 2);
  await page.mouse.down();
  // Drag to somewhere near 2048
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + 2); 
  await page.mouse.up();
  await page.keyboard.up('Shift');

  state = await page.evaluate(() => {
    // @ts-ignore
    return { in: editor_in_point };
  });
  // Should be exactly 2048 because of 1024-snap
  expect(state.in).toBe(2048);
});
