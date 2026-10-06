import { test, expect } from '@playwright/test';

// Luma-Mu "Stretch to 16k": sets the editor pitch so the selection fills a 16 KB slot.
// The retained source is not changed; the pitch is applied when the sound is added to a slot.
test.describe('Luma-mu Stretch to 16k', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/luma1/');
    await page.selectOption('#device_mode', 'lumamu');
    await page.waitForFunction(() => {
      const f = document.getElementById('lumamu_editor_frame') as HTMLIFrameElement;
      return !!(f && f.contentWindow && (f.contentWindow as any).LumaMuBridge);
    });
  });

  async function openRamp(page, frames: number) {
    return page.evaluate(async (n) => {
      const w = (document.getElementById('lumamu_editor_frame') as HTMLIFrameElement).contentWindow as any;
      const pcm = Array.from({ length: n }, (_, i) => (i / n) * 0.8 - 0.4);
      // A WAV at the module rate, opened through the same path as the Librarian
      const wav = w.wavBytes(pcm, w.eval('LUMA_REFERENCE_RATE'));
      return w.LumaMuBridge.importFile(wav, 'small_ramp.wav');
    }, frames);
  }

  function editor(page, expr: string) {
    return page.evaluate((e) => {
      const w = (document.getElementById('lumamu_editor_frame') as HTMLIFrameElement).contentWindow as any;
      return w.eval(e);
    }, expr);
  }

  test('stretches a short selection to fill 16k', async ({ page }) => {
    // 5000 frames → about −20.5 semitones to fill 16384 (the limit is −24)
    expect(await openRamp(page, 5000)).toBe(true);
    expect(await editor(page, 'editorSampleLength')).toBe(5000);

    const picker = page.frameLocator('#lumamu_editor_frame').locator('#function_picker');
    await picker.selectOption('Stretch to 16k');

    expect(await editor(page, 'selectionOutputLength()')).toBe(16384);
    expect(await editor(page, 'editorPitch')).toBeLessThan(0);
    // The source is untouched
    expect(await editor(page, 'editorSampleLength')).toBe(5000);

    // Adding to a slot renders the stretched sound
    await page.frameLocator('#lumamu_editor_frame').locator('#copy_selection_mu').click();
    expect(await editor(page, 'bank[Number(de("slotId_mu").value)].sampleLength')).toBe(16384);
  });

  test('refuses selections too short to stretch', async ({ page }) => {
    // 1000 frames would need about −48 semitones
    expect(await openRamp(page, 1000)).toBe(true);
    const picker = page.frameLocator('#lumamu_editor_frame').locator('#function_picker');
    await picker.selectOption('Stretch to 16k');
    expect(await editor(page, 'editorPitch')).toBe(0);
    await expect(page.frameLocator('#lumamu_editor_frame').locator('#app_status')).toContainText('too short');
  });
});
