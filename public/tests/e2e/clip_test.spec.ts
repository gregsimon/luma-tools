import { test, expect } from '@playwright/test';

test('clip-test: select subset of sample and drag to slot', async ({ page }) => {
  await page.goto('/');

  // 1. Initialize editor with a known test sample (0 to 199)
  const sampleSize = 200;
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
    sampleName = "original-sample";
    // @ts-ignore
    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
    // @ts-ignore
    if (typeof updateStatusBar === 'function') updateStatusBar();
  }, originalData);

  const canvas = page.locator('#editor_canvas');
  const slot2Canvas = page.locator('#canvas_slot_2');
  const box = await canvas.boundingBox();
  const slot2Box = await slot2Canvas.boundingBox();
  
  if (!box || !slot2Box) throw new Error('Could not find canvases');

  // 2. Set points via input fields to ensure precision, 
  // since dragging the bottom-right handle is tricky in headless mode
  const inPointInput = page.locator('#in_point');
  const outPointInput = page.locator('#out_point');

  await inPointInput.fill('50');
  await inPointInput.dispatchEvent('input');
  
  await outPointInput.fill('149');
  await outPointInput.dispatchEvent('input');

  const points = await page.evaluate(() => {
    // @ts-ignore
    return { in: editor_in_point, out: editor_out_point };
  });
  
  expect(points.in).toBe(50);
  expect(points.out).toBe(149);

  // 3. Drag selection to Slot 2
  // We drag from the middle of the canvas (where the waveform is)
  const canvasCenter = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
  const slot2Center = {
    x: slot2Box.x + slot2Box.width / 2,
    y: slot2Box.y + slot2Box.height / 2
  };

  await page.mouse.move(canvasCenter.x, canvasCenter.y);
  await page.mouse.down();
  await page.mouse.move(slot2Center.x, slot2Center.y, { steps: 5 });
  await page.mouse.up();

  // 4. Verify Slot 2 has the correct subset
  const slotData = await page.evaluate(() => {
    // @ts-ignore
    const s = bank[2];
    // @ts-ignore
    return s.sampleData ? Array.from(s.sampleData) : null;
  });

  expect(slotData).not.toBeNull();
  
  const expectedSubset = originalData.slice(50, 150); // index 50 to 149
  expect(slotData).toEqual(expectedSubset);
});
