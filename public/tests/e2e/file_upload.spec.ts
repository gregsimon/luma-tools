import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('File Upload via Drag and Drop', () => {
  
  test('drag and drop a .wav file', async ({ page }) => {
    await page.goto('/luma1/');

    // 1. Create a buffer representing a valid minimal 8-bit mono PCM WAV file
    // 24000 Hz, 8-bit, 100 samples of silence
    const sampleRate = 24000;
    const numSamples = 100;
    const wavBuffer = Buffer.alloc(44 + numSamples);
    
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + numSamples, 4); // File size - 8
    wavBuffer.write('WAVE', 8);
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16); // Chunk size
    wavBuffer.writeUInt16LE(1, 20); // PCM
    wavBuffer.writeUInt16LE(1, 22); // Mono
    wavBuffer.writeUInt32LE(sampleRate, 24);
    wavBuffer.writeUInt32LE(sampleRate, 28); // Byte rate
    wavBuffer.writeUInt16LE(1, 32); // Block align
    wavBuffer.writeUInt16LE(8, 34); // Bits per sample
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(numSamples, 40);
    wavBuffer.fill(128, 44); // 128 is silence in 8-bit PCM

    // 2. Dispatch drop event
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
    }, { buffer: Array.from(wavBuffer), fileName: 'test_audio.wav' });

    // 3. Verify the app processed the file
    // The sample name should update in the UI
    const nameInput = page.locator('#sample_name');
    await expect(nameInput).toHaveValue('test_audio');
    
    // Internal state check
    const editorLength = await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
    });
    expect(editorLength).toBe(numSamples);
  });

  test('drag and drop a .bin file', async ({ page }) => {
    await page.goto('/luma1/');

    // 1. Create a dummy binary file (1024 bytes)
    const binSize = 1024;
    const binBuffer = Buffer.alloc(binSize).fill(0xAA);

    // 2. Dispatch drop event
    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'application/octet-stream' });
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
    }, { buffer: Array.from(binBuffer), fileName: 'raw_data.bin' });

    // 3. Verify the app processed the file
    const nameInput = page.locator('#sample_name');
    await expect(nameInput).toHaveValue('raw_data');
    
    const editorLength = await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
    });
    expect(editorLength).toBe(binSize);
    
    const firstByte = await page.evaluate(() => {
        // @ts-ignore
        return editorSampleData[0];
    });
    // In Luma-1 mode, .bin is treated as 8-bit ulaw and stored directly
    expect(firstByte).toBe(0xAA);
  });

  test('drag and drop a .aif file', async ({ page }) => {
    // Capture console logs
    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    await page.goto('/luma1/');

    // Create a valid minimal AIFF buffer (16-bit PCM, Big Endian)
    const numSamples = 100;
    const aiffBuffer = Buffer.alloc(12 + 26 + 16 + numSamples * 2);
    
    // FORM chunk
    aiffBuffer.write('FORM', 0);
    aiffBuffer.writeUInt32BE(aiffBuffer.length - 8, 4);
    aiffBuffer.write('AIFF', 8);
    
    // COMM chunk
    aiffBuffer.write('COMM', 12);
    aiffBuffer.writeUInt32BE(18, 16);
    aiffBuffer.writeUInt16BE(1, 20); // Mono
    aiffBuffer.writeUInt32BE(numSamples, 22);
    aiffBuffer.writeUInt16BE(16, 26); // 16-bit
    
    // Sample rate 24000 in 80-bit float
    aiffBuffer.writeUInt16BE(0x400D, 28); // Exponent
    aiffBuffer.writeUInt32BE(0xBB800000, 30); // Mantissa
    aiffBuffer.writeUInt32BE(0x00000000, 34);
    
    // SSND chunk
    aiffBuffer.write('SSND', 38);
    aiffBuffer.writeUInt32BE(numSamples * 2 + 8, 42);
    aiffBuffer.writeUInt32BE(0, 46); // Offset
    aiffBuffer.writeUInt32BE(0, 50); // Block size
    aiffBuffer.fill(0, 54); // Silence (0 for 16-bit PCM)

    await page.evaluate(({ buffer, fileName }) => {
      const data = new Uint8Array(buffer);
      const file = new File([data], fileName, { type: 'audio/aiff' });
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
    }, { buffer: Array.from(aiffBuffer), fileName: 'test_audio.aif' });

    // Wait and log for debugging if it fails
    try {
      const nameInput = page.locator('#sample_name');
      await expect(nameInput).toHaveValue('test_audio', { timeout: 5000 });
    } catch (e) {
      console.log('Test failed. Logs from browser:');
      console.log(logs.join('\n'));
      throw e;
    }
    
    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const finalLength = await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
    });
    expect(finalLength).toBe(numSamples);
  });
});
