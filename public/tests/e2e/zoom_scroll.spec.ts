import { test, expect } from '@playwright/test';

test.describe('Waveform Zoom and Scroll', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    
    // Initialize editor with some data
    const sampleSize = 10000;
    await page.evaluate((size) => {
      // @ts-ignore
      editorSampleData = new Uint8Array(size).fill(128);
      // @ts-ignore
      editorSampleLength = size;
      // @ts-ignore
      editor_in_point = 0;
      // @ts-ignore
      editor_out_point = size - 1;
      // @ts-ignore
      editorZoomLevel = 1.0;
      // @ts-ignore
      editorViewStart = 0;
      // @ts-ignore
      if (typeof updateStatusBar === 'function') updateStatusBar();
      // @ts-ignore
      if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
    }, sampleSize);
  });

  test('zoom in and out using keyboard', async ({ page }) => {
    // Initial zoom should be 1.0
    let zoom = await page.evaluate(() => {
      // @ts-ignore
      return editorZoomLevel;
    });
    expect(zoom).toBe(1.0);

    // Press '+' to zoom in
    await page.keyboard.press('+');
    zoom = await page.evaluate(() => {
      // @ts-ignore
      return editorZoomLevel;
    });
    expect(zoom).toBeGreaterThan(1.0);

    // Press '-' to zoom out
    await page.keyboard.press('-');
    zoom = await page.evaluate(() => {
      // @ts-ignore
      return editorZoomLevel;
    });
    // Should be back to 1.0 because 1.0 * 1.2 / 1.2 = 1.0
    expect(zoom).toBeCloseTo(1.0);
  });

  test('scrolling via scrollbar', async ({ page }) => {
    // Zoom in first so we have something to scroll
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    
    const initialViewStart = await page.evaluate(() => {
      // @ts-ignore
      return editorViewStart;
    });

    const scrollbar = page.locator('#scrollbar_canvas');
    const box = await scrollbar.boundingBox();
    if (!box) throw new Error('Scrollbar not found');

    // Click at the far right of the scrollbar
    await page.mouse.move(box.x + box.width - 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    const newViewStart = await page.evaluate(() => {
      // @ts-ignore
      return editorViewStart;
    });
    expect(newViewStart).toBeGreaterThan(initialViewStart);
  });

  test('snapping endpoints in gutters', async ({ page }) => {
    const canvas = page.locator('#editor_canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    // Reset view
    await page.click('input[value="Select All"]');

    // 1. Snap out-point to 3/4 of the way (MUST DO THIS FIRST OR AFTER in-point is set to something smaller)
    await page.mouse.click(box.x + (box.width * 3) / 4, box.y + box.height - 5);
    
    let state = await page.evaluate(() => {
      // @ts-ignore
      return { out: editor_out_point };
    });
    expect(state.out).toBeCloseTo(7500, -2);

    // 2. Snap in-point to 1/4 of the way
    await page.mouse.click(box.x + box.width / 4, box.y + 5);
    
    state = await page.evaluate(() => {
      // @ts-ignore
      return { in: editor_in_point };
    });
    expect(state.in).toBeCloseTo(2500, -2);
  });

  test('marker auto-scroll when dragging near edges', async ({ page }) => {
    // Zoom in heavily
    for(let i=0; i<5; i++) await page.keyboard.press('+');
    
    const canvas = page.locator('#editor_canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const initialViewStart = await page.evaluate(() => {
      // @ts-ignore
      return editorViewStart;
    });

    // Drag in-point handle (it should be at 0, start of view)
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.down();
    // Drag to the right edge to trigger auto-scroll
    await page.mouse.move(box.x + box.width - 5, box.y + 2);
    
    // Wait a bit for auto-scroll to kick in (it triggers on mousemove)
    // In the current implementation, it scrolls on every mousemove near the edge.
    // Move slightly to keep triggering it.
    for(let i=0; i<10; i++) {
        await page.mouse.move(box.x + box.width - 5 - i, box.y + 2);
    }
    
    await page.mouse.up();

    const finalViewStart = await page.evaluate(() => {
      // @ts-ignore
      return editorViewStart;
    });
    expect(finalViewStart).toBeGreaterThan(initialViewStart);
  });
});

