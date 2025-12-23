import { test, expect } from '@playwright/test';

test('drag from editor to slot 1 and back', async ({ page }) => {
  await page.goto('/');

  // 1. Initialize editor with some dummy data so we can drag it
  await page.evaluate(() => {
    // @ts-ignore
    editorSampleData = new Uint8Array(1024).fill(127);
    // @ts-ignore
    editorSampleLength = 1024;
    // @ts-ignore
    editor_in_point = 0;
    // @ts-ignore
    editor_out_point = 1023;
    // @ts-ignore
    sampleName = "test-drag";
    // @ts-ignore
    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  });

  const editorCanvas = page.locator('#editor_canvas');
  const slot1Canvas = page.locator('#canvas_slot_1');

  // 2. Drag from editor to slot 1
  // We use manual mouse events because the app sets 'isDraggingWaveform' on mousedown
  const editorBox = await editorCanvas.boundingBox();
  const slot1Box = await slot1Canvas.boundingBox();

  if (!editorBox || !slot1Box) throw new Error('Could not find canvases');

  const editorCenter = {
    x: editorBox.x + editorBox.width / 2,
    y: editorBox.y + editorBox.height / 2
  };
  const slot1Center = {
    x: slot1Box.x + slot1Box.width / 2,
    y: slot1Box.y + slot1Box.height / 2
  };

  // Drag Editor -> Slot 1
  await page.mouse.move(editorCenter.x, editorCenter.y);
  await page.mouse.down();
  await page.mouse.move(slot1Center.x, slot1Center.y, { steps: 5 });
  await page.mouse.up();

  // Verify Slot 1 has the data
  const slot1Data = await page.evaluate(() => {
    // @ts-ignore
    return bank[1].sampleData ? Array.from(bank[1].sampleData.slice(0, 5)) : null;
  });
  expect(slot1Data).not.toBeNull();
  expect(slot1Data).toEqual([127, 127, 127, 127, 127]);

  // 3. Clear editor data to verify drag back works
  await page.evaluate(() => {
    // @ts-ignore
    editorSampleData = null;
    // @ts-ignore
    editorSampleLength = 0;
    // @ts-ignore
    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  });

  // 4. Drag from slot 1 back to editor
  await page.mouse.move(slot1Center.x, slot1Center.y);
  await page.mouse.down();
  await page.mouse.move(editorCenter.x, editorCenter.y, { steps: 5 });
  await page.mouse.up();

  // Verify Editor has the data again
  const editorData = await page.evaluate(() => {
    // @ts-ignore
    return editorSampleData ? Array.from(editorSampleData.slice(0, 5)) : null;
  });
  expect(editorData).not.toBeNull();
  expect(editorData).toEqual([127, 127, 127, 127, 127]);
});
