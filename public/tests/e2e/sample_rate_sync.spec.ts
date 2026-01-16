import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

function createWavBuffer(sampleRate: number, numSamples: number = 100) {
  const wavBuffer = Buffer.alloc(44 + numSamples);
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + numSamples, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20); // PCM
  wavBuffer.writeUInt16LE(1, 22); // Mono
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(sampleRate, 28);
  wavBuffer.writeUInt16LE(1, 32);
  wavBuffer.writeUInt16LE(8, 34); // 8-bit
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(numSamples, 40);
  wavBuffer.fill(128, 44);
  return wavBuffer;
}

test.describe('Sample Rate Picker Synchronization', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/luma1/');
    // Initialize audio context to avoid undefined issues
    await page.evaluate(() => {
        // @ts-ignore
        if (typeof audio_init === 'function') audio_init();
    });
  });

  test('dropping a 48kHz WAV file updates the picker', async ({ page }) => {
    const wavBuffer = createWavBuffer(48000);
    
    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'audio/wav' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      
      const target = document.querySelector('.editor_waveform');
      if (!target) throw new Error('Drop target not found');
      
      const event = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true
      });
      target.dispatchEvent(event);
    }, { buffer: Array.from(wavBuffer), fileName: 'test_48k.wav' });

    const picker = page.locator('#sample_rate_picker');
    await expect(picker).toHaveValue('48000');
  });

  test('playing a slot updates the picker to the slots rate', async ({ page }) => {
    // 1. Manually set up a slot with a specific sample rate
    await page.evaluate(() => {
      // @ts-ignore
      bank[3].sampleData = new Uint8Array(1024).fill(127);
      // @ts-ignore
      bank[3].sampleLength = 1024;
      // @ts-ignore
      bank[3].sample_rate = 12000;
      // @ts-ignore
      bank[3].name = "low-fi-sample";
    });

    // 2. Ensure picker is NOT 12000 initially
    const picker = page.locator('#sample_rate_picker');
    await page.selectOption('#sample_rate_picker', '24000');
    await expect(picker).toHaveValue('24000');

    // 3. Click the slot to trigger playSlotAudio(3)
    // Slot 3 is one of the canvases. We can find it by id.
    await page.click('#canvas_slot_3');

    // 4. Picker should now be 12000
    await expect(picker).toHaveValue('12000');
  });

  test('dragging a slot to the editor updates the picker', async ({ page }) => {
    // 1. Set up a slot with 44.1kHz
    await page.evaluate(() => {
      // @ts-ignore
      bank[5].sampleData = new Uint8Array(512).fill(100);
      // @ts-ignore
      bank[5].sampleLength = 512;
      // @ts-ignore
      bank[5].sample_rate = 44100;
      // @ts-ignore
      bank[5].name = "hi-fi-sample";
    });

    // 2. Ensure picker is NOT 44100
    const picker = page.locator('#sample_rate_picker');
    await page.selectOption('#sample_rate_picker', '24000');

    // 3. Simulate dragging slot 5 to the editor (ID 255)
    // We can call the internal copy function directly as it's what the drop handler uses
    await page.evaluate(() => {
      // @ts-ignore
      copyWaveFormBetweenSlots(5, 255);
    });

    // 4. Picker should now be 44100
    await expect(picker).toHaveValue('44100');
    
    // Check that editor actually has the data too
    const editorName = page.locator('#sample_name');
    await expect(editorName).toHaveValue('hi-fi-sample');
  });

  test('dropping a bank ZIP archive updates the picker from the first sample', async ({ page }) => {
    // 1. Create a ZIP with a BANKNAME.TXT and a sample in a folder
    const zip = new JSZip();
    zip.file('BANKNAME.TXT', 'Test Bank');
    
    // Create a WAV with 48kHz
    const wav48 = createWavBuffer(48000);
    // Path should match what droppedFileLoadedZip expects: tokens[0] for bankId, tokens[1] for filename
    // BASS is slot 0
    zip.file('BASS/kick_48k.wav', wav48);

    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });

    // 2. Set picker to something else
    const picker = page.locator('#sample_rate_picker');
    await page.selectOption('#sample_rate_picker', '12000');

    // 3. Drop the ZIP
    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'application/zip' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      
      const target = document.querySelector('.editor_waveform');
      if (!target) throw new Error('Drop target not found');
      
      const event = new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true
      });
      target.dispatchEvent(event);
    }, { buffer: Array.from(zipBuffer), fileName: 'test_bank.zip' });

    // 4. Picker should eventually become 48000
    // Zip loading is async, so we might need to wait a bit or use expect().toHaveValue() which retries
    await expect(picker).toHaveValue('48000', { timeout: 5000 });
    
    // Also verify slot 0 was updated
    const slot0Rate = await page.evaluate(() => {
        // @ts-ignore
        return bank[0].sample_rate;
    });
    expect(slot0Rate).toBe(48000);
  });

});

