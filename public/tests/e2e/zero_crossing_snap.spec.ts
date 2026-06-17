import { test, expect } from '@playwright/test';

test('Zero-Crossing Snapping Behavior', async ({ page }) => {
  await page.goto('/luma1/');

  const snapButton = page.locator('#zero_crossing_snap_button');
  
  // 1. Verify initial state of Snap Zero button
  await expect(snapButton).toHaveValue('Snap Zero: Off');
  await expect(snapButton).not.toHaveClass(/loop_active/);

  // 2. Click to toggle ON
  await snapButton.click();
  await expect(snapButton).toHaveValue('Snap Zero: On');
  await expect(snapButton).toHaveClass(/loop_active/);

  // 3. Initialize editor with controlled alternating data
  await page.evaluate(() => {
    // @ts-ignore
    editorSampleLength = 100;
    // @ts-ignore
    editorSampleData = new Uint8Array(100);
    // Mock getLinearSample to have zero crossings at index 10, 20, 30, 40, etc.
    // @ts-ignore
    window.getLinearSample = (index) => {
      // Zero crossing at 10 (crosses negative to positive, slope = 1)
      // Zero crossing at 20 (crosses positive to negative, slope = -1)
      // Zero crossing at 30 (crosses negative to positive, slope = 1)
      // Zero crossing at 40 (crosses positive to negative, slope = -1)
      if (index < 10) return -100;
      if (index === 10) return 0;
      if (index < 20) return 100;
      if (index === 20) return 0;
      if (index < 30) return -100;
      if (index === 30) return 0;
      if (index < 40) return 100;
      if (index === 40) return 0;
      return -100;
    };
    
    // @ts-ignore
    editor_in_point = 5;
    // @ts-ignore
    editor_out_point = 35;
    
    // Toggle snap to run the immediate snapping logic
    // @ts-ignore
    toggleZeroCrossingSnap(); // Off
    // @ts-ignore
    toggleZeroCrossingSnap(); // On (which will snap immediately)
  });

  // Verify that it snapped immediately on toggle
  let state = await page.evaluate(() => {
    // @ts-ignore
    return { in: editor_in_point, out: editor_out_point };
  });

  // in (5) -> 10 (slope +1).
  // out (35) -> 30 (slope +1, matches in slope) or 40 (slope -1). Snaps to 30.
  expect(state.in).toBe(10);
  expect(state.out).toBe(30);

  // 4. Test dragging the in-point handle
  const canvas = page.locator('#editor_canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  // Move to the current in-point handle at index 10 (x = 10% of width)
  // Let's drag the handle to index 15 (x = 15% of width)
  await page.mouse.move(box.x + box.width * 0.1, box.y + 2); // At index 10
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, box.y + 2); // Drag to index 15
  await page.mouse.up();

  state = await page.evaluate(() => {
    // @ts-ignore
    return { in: editor_in_point };
  });
  expect(state.in).toBe(10);

  // Drag the out-point handle (currently at 30, x = 30% of width)
  // Let's drag the out-point handle to index 43 (x = 43% of width)
  await page.evaluate(() => {
    // Extend mock getLinearSample to 50
    // @ts-ignore
    const oldGetLinear = window.getLinearSample;
    // @ts-ignore
    window.getLinearSample = (index) => {
      if (index === 50) return 0;
      if (index > 40 && index < 50) return -100;
      if (index > 50) return 100;
      return oldGetLinear(index);
    };
  });

  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height - 2); // At index 30
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.43, box.y + box.height - 2); // Drag to index 43
  await page.mouse.up();

  state = await page.evaluate(() => {
    // @ts-ignore
    return { out: editor_out_point };
  });
  expect(state.out).toBe(50);
});
