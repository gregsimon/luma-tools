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

test('Duplicate to fill repeats the selection to fill 16k for Luma-Mu', async ({ page }) => {
  await page.goto('/luma1/');
  await page.selectOption('#device_mode', 'lumamu');
  await page.waitForFunction(() => {
    const f = document.getElementById('lumamu_editor_frame') as HTMLIFrameElement;
    return !!(f && f.contentWindow && (f.contentWindow as any).LumaMuBridge);
  });

  // ROM bytes 5, 15, 25 opened at the module rate keep their exact bytes at noon pitch
  const result = await page.evaluate(async () => {
    const w = (document.getElementById('lumamu_editor_frame') as HTMLIFrameElement).contentWindow as any;
    w.eval("loadEditorSound(LumaSound.fromBytes(new Uint8Array([5, 15, 25]), LUMA_REFERENCE_RATE), 'tiny', 0)");
    const picker = w.document.getElementById('function_picker');
    picker.value = 'Duplicate to fill';
    picker.dispatchEvent(new Event('change'));
    const bytes = w.eval('editorSampleData');
    return { length: w.eval('editorSampleLength'), first6: Array.from(bytes.subarray(0, 6)), last2: Array.from(bytes.subarray(bytes.length - 2)) };
  });

  // Luma-Mu max size is 16384; 16384 % 3 = 1, so it ends ..., 25, 5
  expect(result.length).toBe(16384);
  expect(result.first6).toEqual([5, 15, 25, 5, 15, 25]);
  expect(result.last2).toEqual([25, 5]);
});
