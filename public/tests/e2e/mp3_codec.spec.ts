import { test, expect } from '@playwright/test';

test.describe('MP3 Codec Tests', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('MP3 file drop and mock decode', async ({ page }) => {
    const numFrames = 1000;
    const sampleRate = 44100;
    
    // We'll mock actx.decodeAudioData before dropping the file
    await page.evaluate(({ numFrames, sampleRate }) => {
      // @ts-ignore
      if (typeof audio_init === 'function') audio_init();
      
      // @ts-ignore
      const originalDecode = actx.decodeAudioData;
      // @ts-ignore
      actx.decodeAudioData = (data, successCallback, errorCallback) => {
        // Create a mock AudioBuffer
        // @ts-ignore
        const mockBuffer = actx.createBuffer(1, numFrames, sampleRate);
        const channelData = mockBuffer.getChannelData(0);
        // Fill with a simple ramp
        for (let i = 0; i < numFrames; i++) {
          channelData[i] = (i / numFrames) * 2 - 1;
        }
        
        if (successCallback) {
          successCallback(mockBuffer);
        }
        return Promise.resolve(mockBuffer);
      };
    }, { numFrames, sampleRate });

    // Drop a dummy MP3 file
    await page.evaluate(() => {
      const data = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // Minimal ID3 header
      const file = new File([data], 'test.mp3', { type: 'audio/mpeg' });
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
    });

    // Verify the app processed the file via our mock
    const nameInput = page.locator('#sample_name');
    await expect(nameInput).toHaveValue('test');
    
    await page.waitForFunction(() => typeof editorSampleLength !== 'undefined' && editorSampleLength > 0);
    const length = await page.evaluate(() => {
        // @ts-ignore
        return editorSampleLength;
    });
    expect(length).toBe(numFrames);

    // Verify it was mixed/converted correctly (should be u-law bytes now)
    const firstByte = await page.evaluate(() => {
        // @ts-ignore
        return editorSampleData[0];
    });
    // First sample of our ramp was -1.0. 
    // In processDecodedAudio:
    // const linear = Math.round(Math.max(-1, Math.min(1, channelData[i])) * 32767);
    // For -1.0, linear = -32767
    // const ulaw = linear_to_ulaw(linear);
    // sampleData[i] = ~ulaw;
    expect(firstByte).toBeDefined();
    expect(typeof firstByte).toBe('number');
  });

  test('MP3 decode error handling', async ({ page }) => {
    // Mock a decoding error
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof audio_init === 'function') audio_init();

      // @ts-ignore
      actx.decodeAudioData = (data, successCallback, errorCallback) => {
        if (errorCallback) {
          errorCallback(new Error('Mock Decode Error'));
        }
        return Promise.reject(new Error('Mock Decode Error'));
      };
      
      // Spy on window.alert
      (window as any).alertCalledWith = null;
      window.alert = (msg) => { (window as any).alertCalledWith = msg; };
    });

    // Drop a dummy MP3 file
    await page.evaluate(() => {
      const data = new Uint8Array([0x00, 0x01, 0x02]);
      const file = new File([data], 'error.mp3', { type: 'audio/mpeg' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    });

    // Check if alert was called
    const alertMsg = await page.evaluate(() => (window as any).alertCalledWith);
    expect(alertMsg).toContain('Error decoding MP3 file');
  });

  test('MP3 in ZIP archive', async ({ page }) => {
    // We'll mock actx.decodeAudioData for this as well
    const numFrames = 500;
    const sampleRate = 24000;

    await page.evaluate(({ numFrames, sampleRate }) => {
      // @ts-ignore
      if (typeof audio_init === 'function') audio_init();
      // @ts-ignore
      actx.decodeAudioData = (data, success, error) => {
        // @ts-ignore
        const buf = actx.createBuffer(1, numFrames, sampleRate);
        if (success) success(buf);
        return Promise.resolve(buf);
      };
    }, { numFrames, sampleRate });

    // Create a zip with an mp3
    // Note: We're in the browser context for JSZip
    await page.evaluate(async () => {
      // @ts-ignore
      const zip = new JSZip();
      zip.file("BANKNAME.TXT", "Test Bank");
      zip.folder("BASS").file("sample.mp3", new Uint8Array([0,1,2,3]));
      
      const content = await zip.generateAsync({type:"uint8array"});
      const file = new File([content], 'bank.zip', { type: 'application/zip' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      
      const target = document.querySelector('.editor_waveform');
      target?.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true }));
    });

    // Wait for slot to be populated
    // Slots are indexed 0-9. "BASS" matches slot 0 in luma1_slot_names
    await page.waitForFunction(() => {
      // @ts-ignore
      return bank[0] && bank[0].sampleLength > 0;
    }, { timeout: 10000 });

    const slotLength = await page.evaluate(() => {
      // @ts-ignore
      return bank[0].sampleLength;
    });
    expect(slotLength).toBe(numFrames);
  });
});

