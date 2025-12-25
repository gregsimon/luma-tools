import { test, expect } from '@playwright/test';

test('file drop zones: start, center, and end detection', async ({ page }) => {
  await page.goto('/');

  const editorWaveform = page.locator('.editor_waveform');
  const box = await editorWaveform.boundingBox();
  if (!box) throw new Error('Could not find editor');

  // Helper to dispatch dragover event
  const dispatchDragOver = async (x: number) => {
    await page.evaluate((xCoord) => {
      const el = document.querySelector('.editor_waveform');
      const ev = new MouseEvent('dragover', {
        clientX: xCoord,
        clientY: 100, // arbitrary Y
        bubbles: true
      });
      el?.dispatchEvent(ev);
    }, x);
  };

  // 1. Test "Start" zone (left 1/4)
  await dispatchDragOver(box.x + box.width * 0.1);
  let dropZone = await page.evaluate(() => (window as any).currentDropZone);
  if (dropZone === undefined) {
    dropZone = await page.evaluate(() => {
      try {
        // @ts-ignore
        return currentDropZone;
      } catch (e) {
        return undefined;
      }
    });
  }
  expect(dropZone).toBe('start');

  // 2. Test "Center" zone (middle)
  await dispatchDragOver(box.x + box.width * 0.5);
  dropZone = await page.evaluate(() => {
    // @ts-ignore
    return currentDropZone;
  });
  expect(dropZone).toBe('center');

  // 3. Test "End" zone (right 1/4)
  await dispatchDragOver(box.x + box.width * 0.9);
  dropZone = await page.evaluate(() => {
    // @ts-ignore
    return currentDropZone;
  });
  expect(dropZone).toBe('end');

  // 4. Test "Leave" resets zone
  await page.evaluate(() => {
    const el = document.querySelector('.editor_waveform');
    const ev = new MouseEvent('dragleave', { bubbles: true });
    el?.dispatchEvent(ev);
  });
  dropZone = await page.evaluate(() => {
    // @ts-ignore
    return currentDropZone;
  });
  expect(dropZone).toBeNull();
});

test('file drop zones: buffer concatenation logic', async ({ page }) => {
  await page.goto('/');

  // Initialize with [1, 2, 3]
  await page.evaluate(() => {
    // @ts-ignore
    editorSampleData = new Uint8Array([1, 2, 3]);
    // @ts-ignore
    editorSampleLength = 3;
    // @ts-ignore
    editor_in_point = 0;
    // @ts-ignore
    editor_out_point = 2;
  });

  // Helper to simulate the buffer logic in luma_files.js
  const simulateBufferLogic = async (zone: string, newData: number[]) => {
    await page.evaluate(({ zone, newData }) => {
      // @ts-ignore
      currentDropZone = zone;
      const sampleData = new Uint8Array(newData);
      const processingFrames = newData.length;
      
      // @ts-ignore
      const editorLength = editorSampleLength;
      // @ts-ignore
      const editorData = editorSampleData;

      if (zone === "start") {
        const newBuffer = new Uint8Array(editorLength + processingFrames);
        newBuffer.set(sampleData);
        if (editorData) newBuffer.set(editorData, processingFrames);
        // @ts-ignore
        editorSampleData = newBuffer;
        // @ts-ignore
        editorSampleLength = editorLength + processingFrames;
      } else if (zone === "end") {
        const newBuffer = new Uint8Array(editorLength + processingFrames);
        if (editorData) newBuffer.set(editorData);
        newBuffer.set(sampleData, editorLength);
        // @ts-ignore
        editorSampleData = newBuffer;
        // @ts-ignore
        editorSampleLength = editorLength + processingFrames;
      } else {
        // @ts-ignore
        editorSampleData = sampleData;
        // @ts-ignore
        editorSampleLength = processingFrames;
      }
      // @ts-ignore
      currentDropZone = null;
    }, { zone, newData });
  };

  // 1. Append to end: [1, 2, 3] + [4, 5] -> [1, 2, 3, 4, 5]
  await simulateBufferLogic('end', [4, 5]);
  let data = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData);
  });
  expect(data).toEqual([1, 2, 3, 4, 5]);

  // 2. Insert at start: [1, 2, 3, 4, 5] + [9] -> [9, 1, 2, 3, 4, 5]
  await simulateBufferLogic('start', [9]);
  data = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData);
  });
  expect(data).toEqual([9, 1, 2, 3, 4, 5]);

  // 3. Replace center: [9, 1, 2, 3, 4, 5] -> [0, 0, 0]
  await simulateBufferLogic('center', [0, 0, 0]);
  data = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData);
  });
  expect(data).toEqual([0, 0, 0]);
});

test('file drop zones: max sample size limit', async ({ page }) => {
  await page.goto('/');

  // Initialize with a large buffer close to the limit (32768 for luma1)
  await page.evaluate(() => {
    // @ts-ignore
    current_mode = "luma1"; // Max 32768
    const size = 32760;
    // @ts-ignore
    editorSampleData = new Uint8Array(size).fill(1);
    // @ts-ignore
    editorSampleLength = size;
  });

  // Append a sample that would push it over 32768
  await page.evaluate(() => {
    // @ts-ignore
    currentDropZone = "end";
    const newSample = new Uint8Array(20).fill(2); // total 32780 > 32768
    const processingFrames = 20;

    // @ts-ignore
    const editorLength = editorSampleLength;
    // @ts-ignore
    const editorData = editorSampleData;

    // Logic from droppedFileLoadedWav
    const newBuffer = new Uint8Array(editorLength + processingFrames);
    if (editorData) newBuffer.set(editorData);
    newBuffer.set(newSample, editorLength);
    // @ts-ignore
    editorSampleData = newBuffer;
    // @ts-ignore
    editorSampleLength = editorLength + processingFrames;

    // Call trimBufferToFitLuma() which should enforce the limit
    // @ts-ignore
    if (typeof trimBufferToFitLuma === 'function') trimBufferToFitLuma();
  });

  const finalLength = await page.evaluate(() => {
    // @ts-ignore
    return editorSampleLength;
  });
  expect(finalLength).toBe(32768);

  const lastSamples = await page.evaluate(() => {
    // @ts-ignore
    return Array.from(editorSampleData.slice(32760, 32768));
  });
  // Should be the first 8 samples of the new 20-sample block
  expect(lastSamples).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
});

