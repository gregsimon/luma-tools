import { test, expect } from '@playwright/test';

test.describe('Playback Toggle Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    
    // Mock AudioContext to avoid issues with real audio hardware and user gesture requirements
    await page.evaluate(() => {
      // @ts-ignore
      window.AudioContext = window.webkitAudioContext = class {
        constructor() {
          this.state = 'running';
          this.destination = {};
          this.sampleRate = 12000;
        }
        createBuffer() {
          return {
            length: 1000,
            duration: 1,
            sampleRate: 12000,
            getChannelData: () => new Float32Array(1000)
          };
        }
        createBufferSource() {
          const source = {
            buffer: null,
            connect: () => {},
            start: function() {
              // We'll use a global to access the last created source
              // @ts-ignore
              window._lastSource = this;
            },
            stop: function() {
              if (this.onended) this.onended();
            },
            onended: null
          };
          return source;
        }
        decodeAudioData() {}
      };

      // Initialize sample data so playAudio has something to play
      // @ts-ignore
      editorSampleData = new Uint8Array(1000).fill(0);
      // @ts-ignore
      editorSampleLength = 1000;
      // @ts-ignore
      editor_in_point = 0;
      // @ts-ignore
      editor_out_point = 999;
    });
  });

  test('clicking Preview toggles playback', async ({ page }) => {
    // 1. Initial state: not playing
    let isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(false);

    // 2. Click Preview -> Should start playing
    await page.click('input[value="Preview"]');
    isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(true);

    // 3. Click Preview again -> Should stop playing
    await page.click('input[value="Preview"]');
    isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(false);
  });

  test('playback clears when sound ends naturally', async ({ page }) => {
    // 1. Start playing
    await page.click('input[value="Preview"]');
    let isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(true);

    // 2. Simulate natural end of playback
    await page.evaluate(() => {
      // @ts-ignore
      if (window._lastSource && window._lastSource.onended) {
        // @ts-ignore
        window._lastSource.onended();
      }
    });

    // 3. Should have cleared playingSound
    await expect.poll(async () => {
      return await page.evaluate(() => {
        // @ts-ignore
        return playingSound === null;
      });
    }).toBe(true);
  });

  test('pressing Spacebar toggles playback', async ({ page }) => {
    // 1. Initial state: not playing
    let isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(false);

    // 2. Press Space -> Should start playing
    await page.keyboard.press(' ');
    isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(true);

    // 3. Press Space again -> Should stop playing
    await page.keyboard.press(' ');
    isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(false);
  });

  test('tab switching stops playback', async ({ page }) => {
    // 1. Start playing
    await page.click('input[value="Preview"]');
    let isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(true);

    // 2. Switch to another tab
    await page.click('#pattern_editor_tab_button');

    // 3. Should have stopped playing
    isPlaying = await page.evaluate(() => {
      // @ts-ignore
      return playingSound !== null;
    });
    expect(isPlaying).toBe(false);
  });
});
