import { test, expect } from '@playwright/test';

test('midi monitor: message logging and filtering', async ({ page }) => {
  // 1. Mock WebMIDI before page load
  await page.addInitScript(() => {
    const mockMidiInput = {
      name: 'Mock MIDI Input',
      id: 'mock-input-id',
      type: 'input',
      onmidimessage: null,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const mockMidiAccess = {
      inputs: new Map([['mock-input-id', mockMidiInput]]),
      outputs: new Map(),
      onstatechange: null,
    };

    // @ts-ignore
    navigator.requestMIDIAccess = () => Promise.resolve(mockMidiAccess);
    localStorage.setItem('midiDeviceName', 'Mock MIDI Input');
  });

  await page.goto('/luma1/');

  // 2. Navigate to MIDI Monitor tab
  await page.click('#midi_monitor_tab_button');
  await expect(page.locator('#midi_monitor_tab')).toBeVisible();

  const midiLog = page.locator('#midi_log');
  
  // 3. Simulate Note On message [0x90, 0x3C, 0x40] (Note 60, Vel 64)
  await page.evaluate(() => {
    // @ts-ignore
    if (midiIn && midiIn.onmidimessage) {
      // @ts-ignore
      midiIn.onmidimessage({ data: new Uint8Array([0x90, 0x3C, 0x40]) });
    }
  });

  // Check if log contains the message.
  // "Note ON  " (2 spaces) + " C6" (from noteNumberToString) = "Note ON   C6" (3 spaces)
  await expect(midiLog).toContainText('Note ON   C6 vel=64');

  // 4. Test "Clear" button
  await page.click('#log_clear');
  await expect(midiLog).toBeEmpty();

  // 5. Send another message to ensure it still works after clear
  await page.evaluate(() => {
    // @ts-ignore
    midiIn.onmidimessage({ data: new Uint8Array([0x80, 0x3C, 0x00]) }); // Note Off
  });
  await expect(midiLog).toContainText('Note OFF  C6 vel=0');

  // 6. Test Sysex filtering
  const showSysexCheckbox = page.locator('#show_sysex');
  
  // Ensure sysex checkbox is UNCHECKED by default
  await showSysexCheckbox.uncheck();

  // Simulate Sysex message [0xf0, 0x01, 0x02, 0xf7]
  await page.evaluate(() => {
    // @ts-ignore
    midiIn.onmidimessage({ data: new Uint8Array([0xf0, 0x01, 0x02, 0xf7]) });
  });

  // Verify Sysex is NOT in the log
  await expect(midiLog).not.toContainText('f0 1 2 f7');

  // Check the box
  await showSysexCheckbox.check();

  // Simulate Sysex message again
  await page.evaluate(() => {
    // @ts-ignore
    midiIn.onmidimessage({ data: new Uint8Array([0xf0, 0x03, 0x04, 0xf7]) });
  });

  // Verify Sysex IS in the log now
  await expect(midiLog).toContainText('f0 3 4 f7');

  // Uncheck and verify new sysex doesn't appear
  await showSysexCheckbox.uncheck();
  await page.evaluate(() => {
    // @ts-ignore
    midiIn.onmidimessage({ data: new Uint8Array([0xf0, 0x05, 0x06, 0xf7]) });
  });
  await expect(midiLog).not.toContainText('f0 5 6 f7');
});
