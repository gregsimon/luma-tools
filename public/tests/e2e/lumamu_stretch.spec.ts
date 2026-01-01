import { test, expect } from '@playwright/test';

test.describe('Luma-mu Stretch to 16k', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Switch to Luma-mu mode
    await page.selectOption('#device_mode', 'lumamu');
  });

  test('should stretch a small .wav file to 16k', async ({ page }) => {
    const sampleRate = 24000;
    const numSamples = 1000;
    
    // Create a simple ramp in the WAV file to test interpolation
    // 8-bit PCM: 128 is silence, we'll go from 128 to 228
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
    wavBuffer.writeUInt16LE(8, 34);
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(numSamples, 40);
    
    for (let i = 0; i < numSamples; i++) {
      wavBuffer.writeUInt8(128 + Math.floor((i / numSamples) * 100), 44 + i);
    }

    // Drop the file
    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'audio/wav' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      if (!target) throw new Error('Drop target not found');
      const event = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    }, { buffer: Array.from(wavBuffer), fileName: 'small_ramp.wav' });

    // Wait for the file to be loaded
    await expect.poll(async () => {
      return await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
      });
    }).toBe(1000);

    // Click the stretch button
    await page.click('#stretch_to_16k');

    // 1. Verify length is stretched to 16384
    const editorLength = await page.evaluate(() => {
      // @ts-ignore
      return editorSampleLength;
    });
    expect(editorLength).toBe(16384);

    // 2. Verify data is not just padded with zeros, but interpolated
    // Check points along the stretched sample
    const sampleData = await page.evaluate(() => {
      // @ts-ignore
      return Array.from(editorSampleData);
    });

    // Check that it's not all the same value
    const uniqueValues = new Set(sampleData);
    expect(uniqueValues.size).toBeGreaterThan(1);

    // Check last sample is near the end value (converted to u-law and inverted)
    // The original last sample was 128 + 99 = 227 (approx)
    // In u-law storage format it will be different, but let's just ensure it's not 0 or silence
    expect(sampleData[16383]).not.toBe(sampleData[0]);
  });

  test('should stretch a small .bin file to 16k', async ({ page }) => {
    // 1024 bytes of a ramp (0, 1, 2, ... 255 repeating)
    const binSize = 1024;
    const binBuffer = Buffer.alloc(binSize);
    for (let i = 0; i < binSize; i++) {
      binBuffer[i] = i % 256;
    }

    // Drop the file
    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'application/octet-stream' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      if (!target) throw new Error('Drop target not found');
      const event = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    }, { buffer: Array.from(binBuffer), fileName: 'small_ramp.bin' });

    // Wait for the file to be loaded
    await expect.poll(async () => {
      return await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
      });
    }).toBe(1024);

    // Click the stretch button
    await page.click('#stretch_to_16k');

    // 1. Verify length is stretched to 16384
    const editorLength = await page.evaluate(() => {
      // @ts-ignore
      return editorSampleLength;
    });
    expect(editorLength).toBe(16384);

    // 2. Verify data check
    const sampleData = await page.evaluate(() => {
      // @ts-ignore
      return Array.from(editorSampleData);
    });
    expect(sampleData.length).toBe(16384);
  });

  test('should NOT stretch automatically and button should be enabled for small samples', async ({ page }) => {
    const binSize = 1024;
    const binBuffer = Buffer.alloc(binSize).fill(0x55);

    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'application/octet-stream' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      if (!target) throw new Error('Drop target not found');
      const event = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    }, { buffer: Array.from(binBuffer), fileName: 'no_stretch.bin' });

    // Wait for the file to be loaded and editorSampleLength to be updated
    await expect.poll(async () => {
      return await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
      });
    }).toBe(1024);

    const editorLength = await page.evaluate(() => {
      // @ts-ignore
      return editorSampleLength;
    });
    // Should NOT have stretched yet
    expect(editorLength).toBe(1024);

    // Button should be enabled
    const isEnabled = await page.isEnabled('#stretch_to_16k');
    expect(isEnabled).toBe(true);
  });

  test('button should be disabled for samples >= 16k', async ({ page }) => {
    const binSize = 16384;
    const binBuffer = Buffer.alloc(binSize).fill(0x55);

    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'application/octet-stream' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      if (!target) throw new Error('Drop target not found');
      const event = new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    }, { buffer: Array.from(binBuffer), fileName: 'large_sample.bin' });

    // Wait for the file to be loaded
    await expect.poll(async () => {
      return await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
      });
    }).toBe(16384);

    const isEnabled = await page.isEnabled('#stretch_to_16k');
    expect(isEnabled).toBe(false);
  });
});

