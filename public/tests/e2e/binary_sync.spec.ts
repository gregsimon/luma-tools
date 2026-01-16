import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import * as fs from 'fs';

test('binaryFileOriginal synchronizes with editor modifications and merges', async ({ page }) => {
  await page.goto('/luma1/');

  // 1. Load initial sample and verify binaryFileOriginal
  await page.evaluate(() => {
    // @ts-ignore
    if (typeof audio_init === 'function') audio_init();
    // @ts-ignore
    current_mode = "luma1";
    
    // @ts-ignore
    editorSampleData = new Uint8Array([1, 2, 3, 4]);
    // @ts-ignore
    editorSampleLength = 4;
    // @ts-ignore
    editor_in_point = 0;
    // @ts-ignore
    editor_out_point = 3;
    // @ts-ignore
    updateBinaryFileOriginal();
  });

  let binaryData = await page.evaluate(() => {
    // @ts-ignore
    return binaryFileOriginal ? Array.from(new Uint8Array(binaryFileOriginal)) : null;
  });
  expect(binaryData).toEqual([1, 2, 3, 4]);

  // 2. Simulate merging (appending to end)
  await page.evaluate(() => {
    const newData = new Uint8Array([5, 6]);
    // @ts-ignore
    const combined = new Uint8Array(editorSampleLength + newData.length);
    // @ts-ignore
    combined.set(editorSampleData);
    // @ts-ignore
    combined.set(newData, editorSampleLength);
    
    // @ts-ignore
    editorSampleData = combined;
    // @ts-ignore
    editorSampleLength = combined.length;
    // @ts-ignore
    editor_out_point = editorSampleLength - 1;
    
    // This is what the fix added to the event handlers
    // @ts-ignore
    updateBinaryFileOriginal();
  });

  binaryData = await page.evaluate(() => {
    // @ts-ignore
    return binaryFileOriginal ? Array.from(new Uint8Array(binaryFileOriginal)) : null;
  });
  expect(binaryData).toEqual([1, 2, 3, 4, 5, 6]);

  // 3. Simulate a crop operation
  await page.evaluate(() => {
    // Set crop range to [2, 3, 4, 5] (indices 1 to 4)
    // @ts-ignore
    editor_in_point = 1;
    // @ts-ignore
    editor_out_point = 4;
    
    // @ts-ignore
    cropSample(); // This function now calls updateBinaryFileOriginal()
  });

  binaryData = await page.evaluate(() => {
    // @ts-ignore
    return binaryFileOriginal ? Array.from(new Uint8Array(binaryFileOriginal)) : null;
  });
  expect(binaryData).toEqual([2, 3, 4, 5]);

  // 4. Copy to a slot and verify slot's original_binary
  await page.evaluate(() => {
    // @ts-ignore
    const snInput = document.getElementById("sample_name") as HTMLInputElement;
    if (snInput) snInput.value = "merged-cropped";
    
    // Copy editor (255) to slot 0
    // @ts-ignore
    copyWaveFormBetweenSlots(255, 0);
  });

  const slotBinary = await page.evaluate(() => {
    // @ts-ignore
    return bank[0].original_binary ? Array.from(new Uint8Array(bank[0].original_binary)) : null;
  });
  expect(slotBinary).toEqual([2, 3, 4, 5]);

  // 5. Export as zip and verify the .bin file
  await page.evaluate(() => {
    const bankNameInput = document.getElementById('bank_name') as HTMLInputElement;
    if (bankNameInput) bankNameInput.value = "Binary-Sync-Bank";
  });

  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.click('input[value="Export Bank as Zip..."]')
  ]);

  const path = await download.path();
  if (!path) throw new Error('Download path is null');
  
  const zipBuffer = fs.readFileSync(path);
  const zip = await JSZip.loadAsync(zipBuffer);

  // Check BASS folder (slot 0) for the .bin file
  const bassFolder = zip.folder('BASS');
  expect(bassFolder).not.toBeNull();
  
  const binContent = await bassFolder?.file('merged-cropped.bin')?.async('uint8array');
  expect(binContent ? Array.from(binContent) : null).toEqual([2, 3, 4, 5]);
});

