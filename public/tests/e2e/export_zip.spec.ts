import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test('export bank as zip', async ({ page }) => {
  await page.goto('/');

  // 1. Initialize audio and populate bank with fake data
  await page.evaluate(() => {
    // @ts-ignore
    if (typeof audio_init === 'function') audio_init();
    
    // Populate slot 0 (BASS)
    // @ts-ignore
    bank[0].sampleData = new Uint8Array(1024).fill(127);
    // @ts-ignore
    bank[0].sampleLength = 1024;
    // @ts-ignore
    bank[0].name = "bass-drum";
    // @ts-ignore
    bank[0].original_binary = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]).buffer;

    // Populate slot 1 (SNARE)
    // @ts-ignore
    bank[1].sampleData = new Uint8Array(2048).fill(64);
    // @ts-ignore
    bank[1].sampleLength = 2048;
    // @ts-ignore
    bank[1].name = "snare-drum";
    
    // Set bank name in the UI
    const bankNameInput = document.getElementById('bank_name') as HTMLInputElement;
    if (bankNameInput) {
        bankNameInput.value = "Test-Export-Bank";
        // Trigger any potential change handlers if they existed
        bankNameInput.dispatchEvent(new Event('change'));
    }
  });

  // 2. Start the download
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.click('input[value="Export Bank as Zip..."]')
  ]);

  // 3. Verify filename
  expect(download.suggestedFilename()).toBe('Test-Export-Bank.zip');

  // 4. Read the zip content
  const path = await download.path();
  if (!path) throw new Error('Download path is null');
  
  const fs = require('fs');
  const zipBuffer = fs.readFileSync(path);
  const zip = await JSZip.loadAsync(zipBuffer);

  // 5. Verify ZIP structure
  // BANKNAME.TXT
  const bankNameContent = await zip.file('BANKNAME.TXT')?.async('string');
  expect(bankNameContent).toBe('Test-Export-Bank');

  // Check BASS folder (slot 0)
  // Note: slot_names[0] is "BASS"
  const bassFolder = zip.folder('BASS');
  expect(bassFolder).not.toBeNull();
  
  const bassBin = await bassFolder?.file('bass-drum.bin')?.async('uint8array');
  expect(bassBin).toEqual(new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]));
  
  const bassWav = bassFolder?.file('bass-drum.wav');
  expect(bassWav).not.toBeNull();

  // Check SNARE folder (slot 1)
  const snareFolder = zip.folder('SNARE');
  expect(snareFolder).not.toBeNull();
  
  const snareWav = snareFolder?.file('snare-drum.wav');
  expect(snareWav).not.toBeNull();
  
  // SNARE had no original_binary, so no .bin should be present
  const snareBin = snareFolder?.file('snare-drum.bin');
  expect(snareBin).toBeNull();
});
