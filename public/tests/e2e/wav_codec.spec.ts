import { test, expect } from '@playwright/test';

test.describe('WAV Codec Comprehensive Tests', () => {

  function createWAVBuffer({
    channels = 1,
    numFrames = 100,
    bitsPerSample = 16,
    sampleRate = 44100,
    compression = 1, // PCM
    extraChunks = [] as { id: string, data: Buffer }[]
  }) {
    const bytesPerSample = Math.ceil(bitsPerSample / 8);
    const dataSize = numFrames * channels * bytesPerSample;
    const fmtSize = 16; 
    
    let totalSize = 12 + (8 + fmtSize) + (8 + dataSize);
    for (const chunk of extraChunks) {
      totalSize += 8 + chunk.data.length + (chunk.data.length % 2);
    }

    const buf = Buffer.alloc(totalSize);
    let pos = 0;

    // RIFF
    buf.write('RIFF', pos); pos += 4;
    buf.writeUInt32LE(totalSize - 8, pos); pos += 4;
    buf.write('WAVE', pos); pos += 4;

    // fmt 
    buf.write('fmt ', pos); pos += 4;
    buf.writeUInt32LE(fmtSize, pos); pos += 4;
    buf.writeUInt16LE(compression, pos); pos += 2;
    buf.writeUInt16LE(channels, pos); pos += 2;
    buf.writeUInt32LE(sampleRate, pos); pos += 4;
    buf.writeUInt32LE(sampleRate * channels * bytesPerSample, pos); pos += 4; // byteRate
    buf.writeUInt16LE(channels * bytesPerSample, pos); pos += 2; // blockAlign
    buf.writeUInt16LE(bitsPerSample, pos); pos += 2;

    // extra chunks before data
    for (const chunk of extraChunks) {
      buf.write(chunk.id.padEnd(4, ' '), pos); pos += 4;
      buf.writeUInt32LE(chunk.data.length, pos); pos += 4;
      chunk.data.copy(buf, pos); pos += chunk.data.length;
      if (chunk.data.length % 2 !== 0) {
        buf.writeUInt8(0, pos); pos += 1;
      }
    }

    // data
    buf.write('data', pos); pos += 4;
    buf.writeUInt32LE(dataSize, pos); pos += 4;
    
    // Fill with dummy data
    for (let i = 0; i < numFrames * channels; i++) {
      if (bitsPerSample === 8) {
        buf.writeUInt8(Math.floor((i / (numFrames * channels)) * 255), pos++);
      } else if (bitsPerSample === 16) {
        buf.writeInt16LE(Math.floor((i / (numFrames * channels)) * 32767), pos); pos += 2;
      } else if (bitsPerSample === 24) {
        const val = Math.floor((i / (numFrames * channels)) * 8388607);
        buf.writeUInt8(val & 0xFF, pos++);
        buf.writeUInt8((val >> 8) & 0xFF, pos++);
        buf.writeUInt8((val >> 16) & 0xFF, pos++);
      } else if (bitsPerSample === 32) {
        buf.writeInt32LE(Math.floor((i / (numFrames * channels)) * 2147483647), pos); pos += 4;
      }
    }

    return buf;
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/luma1/');
  });

  test('8-bit Mono WAV', async ({ page }) => {
    const numFrames = 500;
    const buffer = createWAVBuffer({ bitsPerSample: 8, channels: 1, numFrames, sampleRate: 22050 });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test8.wav', { type: 'audio/wav' });
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

  test('16-bit Stereo WAV with extra chunks', async ({ page }) => {
    const numFrames = 256;
    const extraChunks = [
      { id: 'JUNK', data: Buffer.from('some junk data') },
      { id: 'LIST', data: Buffer.from('info about the file') }
    ];
    const buffer = createWAVBuffer({ 
      bitsPerSample: 16, 
      channels: 2, 
      numFrames, 
      sampleRate: 44100, 
      extraChunks 
    });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test16.wav', { type: 'audio/wav' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => editorSampleLength);
    expect(length).toBe(numFrames);
  });

  test('24-bit Mono WAV', async ({ page }) => {
    const numFrames = 1000;
    const buffer = createWAVBuffer({ bitsPerSample: 24, channels: 1, numFrames, sampleRate: 48000 });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test24.wav', { type: 'audio/wav' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => editorSampleLength);
    expect(length).toBe(numFrames);
  });

  test('32-bit Stereo WAV', async ({ page }) => {
    const numFrames = 128;
    const buffer = createWAVBuffer({ bitsPerSample: 32, channels: 2, numFrames, sampleRate: 96000 });
    
    await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test32.wav', { type: 'audio/wav' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    }, { buffer: Array.from(buffer) });

    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => editorSampleLength);
    expect(length).toBe(numFrames);
  });

  test('Direct use of wav.js API', async ({ page }) => {
    const numFrames = 441;
    const sampleRate = 44100;
    const buffer = createWAVBuffer({ bitsPerSample: 16, channels: 1, numFrames, sampleRate });
    
    const results = await page.evaluate(async ({ buffer }) => {
      const data = new Uint8Array(buffer).buffer;
      const w = new (window as any).wav(data);
      
      // Since we pass ArrayBuffer, it's synchronous
      return {
        chunkID: w.chunkID,
        format: w.format,
        compression: w.compression,
        numChannels: w.numChannels,
        sampleRate: w.sampleRate,
        bitsPerSample: w.bitsPerSample,
        dataLength: w.dataLength,
        duration: w.getDuration(),
        isMono: w.isMono(),
        isStereo: w.isStereo(),
        isCompressed: w.isCompressed()
      };
    }, { buffer: Array.from(buffer) });

    expect(results.chunkID).toBe('RIFF');
    expect(results.format).toBe('WAVE');
    expect(results.compression).toBe(1);
    expect(results.numChannels).toBe(1);
    expect(results.sampleRate).toBe(sampleRate);
    expect(results.bitsPerSample).toBe(16);
    expect(results.duration).toBeCloseTo(0.01);
    expect(results.isMono).toBe(true);
    expect(results.isStereo).toBe(false);
    expect(results.isCompressed).toBe(false);
  });

  test('Slicing support in wav.js', async ({ page }) => {
    const numFrames = 1000;
    const sampleRate = 1000; // 1 second of audio
    const buffer = createWAVBuffer({ bitsPerSample: 16, channels: 1, numFrames, sampleRate });
    
    const slicedBuffer = await page.evaluate(async ({ buffer }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], 'test.wav', { type: 'audio/wav' });
      const w = new (window as any).wav(file);
      
      return new Promise<number[]>((resolve) => {
        w.onloadend = function() {
          // Slice 0.5 seconds from start
          w.slice(0, 0.5, (result: ArrayBuffer) => {
            resolve(Array.from(new Uint8Array(result)));
          });
        };
      });
    }, { buffer: Array.from(buffer) });

    // The sliced buffer should be a valid WAV file
    const slicedWavResults = await page.evaluate(async ({ buffer }) => {
      const data = new Uint8Array(buffer).buffer;
      const w = new (window as any).wav(data);
      return {
        duration: w.getDuration(),
        dataLength: w.dataLength
      };
    }, { buffer: slicedBuffer });

    expect(slicedWavResults.duration).toBeCloseTo(0.5);
    // 0.5s * 1000 samples/s * 2 bytes/sample = 1000 bytes
    expect(slicedWavResults.dataLength).toBe(1000);
  });

  test('Compressed format detection', async ({ page }) => {
    const buffer = createWAVBuffer({ 
      compression: 2, // MS ADPCM
      bitsPerSample: 4,
      numFrames: 100,
      channels: 1
    });

    const results = await page.evaluate(async ({ buffer }) => {
      const data = new Uint8Array(buffer).buffer;
      const w = new (window as any).wav(data);
      return {
        compression: w.compression,
        isCompressed: w.isCompressed(),
        compressionName: w.getCompressionName()
      };
    }, { buffer: Array.from(buffer) });

    expect(results.compression).toBe(2);
    expect(results.isCompressed).toBe(true);
    expect(results.compressionName).toBe('MS_ADPCM');
  });

  test('Invalid WAV - Not RIFF', async ({ page }) => {
    const buffer = Buffer.from('NOT_RIFF_DATA_HERE');
    
    const error = await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer).buffer;
      const w = new (window as any).wav(data);
      return w.error;
    }, { buffer: Array.from(buffer) });

    expect(error).toBe('NOT_SUPPORTED_FORMAT');
  });

  test('Invalid WAV - Missing fmt chunk', async ({ page }) => {
    // Manually create a RIFF/WAVE but skip the fmt chunk
    const totalSize = 20;
    const buf = Buffer.alloc(totalSize);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(totalSize - 8, 4);
    buf.write('WAVE', 8);
    buf.write('data', 12);
    buf.writeUInt32LE(0, 16);

    const error = await page.evaluate(({ buffer }) => {
      const data = new Uint8Array(buffer).buffer;
      const w = new (window as any).wav(data);
      return w.error;
    }, { buffer: Array.from(buf) });

    expect(error).toContain('NO_FORMAT_CHUNK_FOUND');
  });

});

