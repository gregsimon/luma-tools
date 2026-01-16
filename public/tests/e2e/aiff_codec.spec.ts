import { test, expect } from '@playwright/test';

test.describe('AIFF Codec Comprehensive Tests', () => {
  
  // Helper to create an 80-bit Extended Float for AIFF sample rates
  function write80BitFloat(buffer: Buffer, offset: number, value: number) {
    if (value === 0) {
      buffer.fill(0, offset, offset + 10);
      return;
    }
    let exponent = Math.floor(Math.log2(value)) + 16383;
    let mantissa = value / Math.pow(2, exponent - 16383);
    
    // Normalize mantissa to [1, 2)
    let hi = Math.floor(mantissa * Math.pow(2, 31));
    let lo = Math.floor((mantissa * Math.pow(2, 31) - hi) * Math.pow(2, 32));
    
    buffer.writeUInt16BE(exponent, offset);
    buffer.writeUInt32BE(hi >>> 0, offset + 2);
    buffer.writeUInt32BE(lo >>> 0, offset + 6);
  }

  function createAIFFBuffer({
    channels = 1,
    numFrames = 100,
    bitsPerSample = 16,
    sampleRate = 44100,
    includeExtraChunks = false,
    isAIFC = false
  }) {
    const bytesPerSample = Math.ceil(bitsPerSample / 8);
    const dataSize = numFrames * channels * bytesPerSample;
    const commSize = isAIFC ? 18 + 6 : 18; // AIFC has compressionID (4) + name (2 padding)
    
    // FORM: 12
    // COMM: 8 + commSize
    // SSND: 8 (header) + 8 (offset/blocksize) + dataSize
    let totalSize = 12 + (8 + commSize) + (8 + 8 + dataSize);
    if (includeExtraChunks) {
      totalSize += (8 + 4); // For a dummy NAME chunk
    }

    const buf = Buffer.alloc(totalSize);
    let pos = 0;

    // FORM
    buf.write('FORM', pos); pos += 4;
    buf.writeUInt32BE(totalSize - 8, pos); pos += 4;
    buf.write(isAIFC ? 'AIFC' : 'AIFF', pos); pos += 4;

    if (includeExtraChunks) {
      buf.write('NAME', pos); pos += 4;
      buf.writeUInt32BE(4, pos); pos += 4;
      buf.write('TEST', pos); pos += 4;
    }

    // COMM
    buf.write('COMM', pos); pos += 4;
    buf.writeUInt32BE(commSize, pos); pos += 4;
    buf.writeUInt16BE(channels, pos); pos += 2;
    buf.writeUInt32BE(numFrames, pos); pos += 4;
    buf.writeUInt16BE(bitsPerSample, pos); pos += 2;
    write80BitFloat(buf, pos, sampleRate); pos += 10;
    
    if (isAIFC) {
      buf.write('NONE', pos); pos += 4; // compression type
      buf.writeUInt16BE(0, pos); pos += 2; // dummy string
    }

    // SSND
    buf.write('SSND', pos); pos += 4;
    buf.writeUInt32BE(dataSize + 8, pos); pos += 4;
    buf.writeUInt32BE(0, pos); pos += 4; // offset
    buf.writeUInt32BE(0, pos); pos += 4; // blocksize
    
    // Fill with dummy data (ramp)
    for (let i = 0; i < numFrames * channels; i++) {
      if (bitsPerSample === 8) {
        buf.writeInt8(Math.floor((i / (numFrames * channels)) * 127), pos); pos += 1;
      } else if (bitsPerSample === 16) {
        buf.writeInt16BE(Math.floor((i / (numFrames * channels)) * 32767), pos); pos += 2;
      } else if (bitsPerSample === 24) {
        let val = Math.floor((i / (numFrames * channels)) * 8388607);
        buf.writeUInt8((val >> 16) & 0xFF, pos++);
        buf.writeUInt8((val >> 8) & 0xFF, pos++);
        buf.writeUInt8(val & 0xFF, pos++);
      } else if (bitsPerSample === 32) {
        buf.writeInt32BE(Math.floor((i / (numFrames * channels)) * 2147483647), pos); pos += 4;
      }
    }

    return buf;
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/luma1/');
  });

  test('8-bit Mono AIFF', async ({ page }) => {
    const numFrames = 500;
    const buffer = createAIFFBuffer({ bitsPerSample: 8, channels: 1, numFrames, sampleRate: 22050 });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test8.aif', { type: 'audio/aiff' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => editorSampleLength);
    expect(length).toBe(numFrames);
    
    const name = await page.locator('#sample_name').inputValue();
    expect(name).toBe('test8');
  });

  test('16-bit Stereo AIFF with extra chunks', async ({ page }) => {
    const numFrames = 256;
    const buffer = createAIFFBuffer({ 
      bitsPerSample: 16, 
      channels: 2, 
      numFrames, 
      sampleRate: 44100, 
      includeExtraChunks: true 
    });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test16.aiff', { type: 'audio/aiff' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => editorSampleLength);
    expect(length).toBe(numFrames);
  });

  test('24-bit Mono AIFF', async ({ page }) => {
    const numFrames = 1000;
    const buffer = createAIFFBuffer({ bitsPerSample: 24, channels: 1, numFrames, sampleRate: 48000 });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test24.aif', { type: 'audio/aiff' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => editorSampleLength);
    expect(length).toBe(numFrames);
  });

  test('32-bit Stereo AIFF', async ({ page }) => {
    const numFrames = 128;
    const buffer = createAIFFBuffer({ bitsPerSample: 32, channels: 2, numFrames, sampleRate: 96000 });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test32.aiff', { type: 'audio/aiff' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => editorSampleLength);
    expect(length).toBe(numFrames);
  });

  test('AIFC (Compressed) should fallback to decodeAudioData', async ({ page }) => {
    // We create a valid AIFC buffer with 'NONE' compression
    const numFrames = 100;
    const buffer = createAIFFBuffer({ isAIFC: true, numFrames });
    
    let fallbackTriggered = false;
    page.on('console', msg => {
      if (msg.text().includes('Falling back to decodeAudioData')) {
        fallbackTriggered = true;
      }
    });

    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test_aifc.aif', { type: 'audio/aiff' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    // Wait up to 5s for the fallback message
    await expect.poll(() => fallbackTriggered, { timeout: 5000 }).toBe(true);
  });

  test('Invalid AIFF (wrong magic)', async ({ page }) => {
    const buffer = Buffer.from('NOT_A_FORM_FILE_AT_ALL_SORRY');
    
    // We expect an alert
    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.dismiss();
    });

    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'bad.aif', { type: 'audio/aiff' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    // Give it a moment to process and show alert
    await page.waitForTimeout(500);
    expect(alertMessage).toContain('Error decoding audio file');
  });

});

