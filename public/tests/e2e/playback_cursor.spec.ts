import { test, expect } from '@playwright/test';

test.describe('Playback Cursor Line', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/luma1/');
    
    // Mock AudioContext and initialize editor data
    await page.evaluate(() => {
      // @ts-ignore
      window._mockCurrentTime = 0;
      
      const mockActx = {
        state: 'running',
        destination: {},
        sampleRate: 12000,
        get currentTime() {
          // @ts-ignore
          return window._mockCurrentTime;
        },
        createBuffer: () => ({
          length: 12000,
          duration: 1,
          sampleRate: 12000,
          getChannelData: () => new Float32Array(12000)
        }),
        createBufferSource: () => ({
          buffer: null,
          connect: () => {},
          start: function() {
            // @ts-ignore
            window._lastSource = this;
          },
          stop: function() {
            if (this.onended) this.onended();
          },
          onended: null
        })
      };

      // @ts-ignore
      window.actx = mockActx;
      // @ts-ignore
      window.classAudioContext = class { constructor() { return mockActx; } };

      // @ts-ignore
      editorSampleData = new Uint8Array(12000).fill(0);
      // @ts-ignore
      editorSampleLength = 12000;
      // @ts-ignore
      editor_in_point = 0;
      // @ts-ignore
      editor_out_point = 11999;
      // @ts-ignore
      editorZoomLevel = 1.0;
      // @ts-ignore
      editorViewStart = 0;
      
      // Mock getSelectedSampleRate
      // @ts-ignore
      window.getSelectedSampleRate = () => 12000;

      // Initialize AudioContext
      // @ts-ignore
      if (typeof audio_init === 'function') audio_init();
    });
  });

  test('playback cursor line is rendered during playback', async ({ page }) => {
    // 1. Start playback
    await page.click('input[value="Preview"]');

    // 2. Verify animation frame is active
    const animationActive = await page.evaluate(() => {
      // @ts-ignore
      return animationFrameId !== null;
    });
    expect(animationActive).toBe(true);

    // 3. Verify playback start time is set
    const startTimeSet = await page.evaluate(() => {
      // @ts-ignore
      return playbackStartTime > 0 || (typeof playbackStartTime === 'number' && playingSound !== null);
    });
    expect(startTimeSet).toBe(true);

    // 4. Check if the vertical line drawing is happening
    // We'll mock the canvas context's stroke method to see if it's called with the cursor color
    await page.evaluate(() => {
      const canvas = document.getElementById('editor_canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // @ts-ignore
      window._cursorDrawDetected = false;
      const originalStroke = ctx.stroke;
      ctx.stroke = function() {
        const style = ctx.strokeStyle.toString().replace(/\s/g, '').toLowerCase();
        const width = ctx.lineWidth;
        // Normalize color for comparison
        if ((style === 'rgb(255,255,255)' || style === '#ffffff') && width === 2) {
          // @ts-ignore
          window._cursorDrawDetected = true;
        }
        originalStroke.apply(this, arguments);
      };
    });

    // Wait a moment for at least one frame to render
    await page.waitForTimeout(500);

    const debugInfo = await page.evaluate(() => {
      // @ts-ignore
      return {
        playing: playingSound !== null,
        isEditorSound: playingSound ? playingSound.isEditorSound : null,
        animationFrameId: animationFrameId,
        cursorDrawDetected: window._cursorDrawDetected
      };
    });
    console.log('Debug Info:', debugInfo);

    expect(debugInfo.cursorDrawDetected).toBe(true);

    // 5. Stop playback
    await page.click('input[value="Preview"]');

    // 6. Verify animation frame is cleared
    const animationCleared = await page.evaluate(() => {
      // @ts-ignore
      return animationFrameId === null;
    });
    expect(animationCleared).toBe(true);
  });
});

