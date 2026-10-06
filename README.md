# Luma-Tools
## For the Luma-1 Drum Computer and Luma-mu Eurorack module

**luma-tools** is a web application that can be used as a companion to the [Luma-1 Drum computer](https://github.com/joebritt/luma1) and the **Luma-mu** Eurorack module. It enables:
- drag and drop sample conversion and loading
- sample bank assembling, loading, importing, exporting
- pattern (rhythm) editing for the Luma-1, including LM-1 shuffle, micro-timing and ratchets
- support for Luma-1 (via MIDI) and Luma-mu (via PicoROM/ROM export)

Releases are hosted at **[https://luma.tools](https://luma.tools/)** and do not require any installation.

## Device Modes
Luma-tools supports two different hardware devices. You can switch between them using the **Mode** dropdown at the top of the application. The choice is remembered between visits.

| | Luma-1 | Luma-mu |
|---|---|---|
| Tabs | Sample Editor, Pattern Editor, MIDI Monitor, Librarian, Firmware | Sample Editor, Librarian |
| Voice slots | 10 (BASS … RIMSHOT) | 8 (SLOT 0 … SLOT 7), 16 KB each |
| Connection | WebMIDI | PicoROM over Web Serial, or ROM file export |

### Luma-1 Mode
- **Slots:** 10 voice slots (BASS, SNARE, HIHAT, CLAPS, CABASA, TAMB, TOM, CONGA, COWBELL, RIMSHOT).
- **Connectivity:** Uses WebMIDI to read and write individual samples or complete banks directly to the hardware, and to read and write the pattern RAM.
- **Sample Editor:** naming samples and banks, bank management, loop playback, zero-crossing snap, sliding the selection (Alt/Option- or Cmd/Ctrl-drag), Duplicate to Fill, and **Luma-Sim** preview (see below).
- **Pattern Editor:** see [Pattern Editor (Luma-1)](#pattern-editor-luma-1).

### Luma-mu Mode
In Luma-mu mode the Sample Editor tab hosts a dedicated Luma-mu editor (`public/luma1/mu/`). It keeps each sound's original audio and renders it for the module only when you add it to a slot, so edits and pitch changes never pile up conversion losses.

- **Slots:** 8 voice slots (SLOT 0 to SLOT 7), 16,384 bytes each, prepared for the module's measured playback rate of about 12,908 Hz at noon (see Help in the editor for the calibration notes).
- **Opening sounds:** drop or open WAV, AIFF, FLAC, MP3, single-sound `.bin` files (up to 16 KB), complete ROMs (128 KB, or either half of a 256 KB image), bank ZIPs, and `.luma.zip` projects.
- **Editing:** select, zoom, Crop, Normalize, Reverse, Delete or Silence the selection, **Stretch to 16k** (pitches the selection so it fills a slot), **Duplicate to fill**, and Undo (12 steps, including slot changes and clearing).
- **Pitch:** "Pitch at noon" (±24 semitones) for the editor selection, and per-slot pitch that you preview and then apply. Pitch is always rendered from the original audio.
- **Low-pass gate:** shapes a selection into a percussive hit (Decay, Damping); **Make hit** applies the fade and crops in one step.
- **Filling slots:** drag the highlighted selection down onto any slot card, or choose a slot and click **Add to slot**. Ctrl-drag picks the selection up from anywhere in the waveform. Click a slot (or press 1–8) to audition it; **Edit** on a slot opens it in the editor.
- **Luma Preview:** an approximate listening model of the module's pitch knob and conversion.
- **Saving:** **Export ROM** (bank name becomes the file name), **Export bank ZIP** (per-slot `.bin` + `.wav`), **Save project** (`.luma.zip` with original audio, edits, selections and slot pitches), **Export selection** as WAV.
- **PicoROM:** **Program PicoROM** and **Read PicoROM** (the read goes through the normal import, including the 256 KB half chooser).
- **Librarian:** in Luma-mu mode the Librarian opens Drive files in the Luma-mu editor and saves its selection (`.bin` + `.wav`) and bank ZIP.

Banks prepared in earlier versions at 24 kHz will play at a different pitch and speed on the module than banks prepared by this editor; old bank ZIPs still import.

## Pattern Editor (Luma-1)
Edits the Luma-1 (LM-1) pattern RAM: 100 patterns and 8 chains, as read from the device, loaded from a `.bin`/`.syx` RAM image, or dropped onto the grid.

- **Default bank:** when nothing has been read from the Luma-1 or loaded from a file, the editor opens the bundled bank "Pseudo-Factory Patts" (`public/luma1/data/default_ram.js`, the 8 KB RAM image in base64). The pattern list header shows where the current RAM came from.
- **Grid:** 12 voices × up to 32 steps. Click a step to cycle off → soft → loud (hi-hat also has open). Steps react on mouse press: **hold and drag along a row to paint**. Shift-click (or Shift-drag) clears.
- **Pattern length:** 1–32 steps (16 = 1 bar, 32 = 2 bars). Steps past the length are greyed out and are not played or written. Patterns longer than 32 steps load with a warning, and Write to Slot asks before writing a shortened copy back.
- **Shuffle (LM-1 ADJ SHFL):** a menu per instrument with the LM-1 settings — 50% (straight), and 54%, 58%, 62%, 66%, 70% at AUTO CORR **16** (every second 1/16 note is late) or **8** (every second 1/8 note is late). See the LM-1 manual, "AUTO-CORRECT → Shuffle Settings".
- **Micro offsets:** hover a hit and use the **‹ ›** handles or **←/→** to move it up to ±5 ticks (1 tick = 1/12 of a step) early or late; double-click a handle to put it back on the grid. Alt-click nudges late.
- **Ratchets:** hover a hit and press **↑/↓**, or right-click it, to repeat it x2, x3, x4, x6 or x12 within its step (the Luma-1's 12 ticks per step allow only counts that divide 12). The burst starts where the hit plays, so it follows shuffle and offsets.
- **QUANTIZE:** LM-1 AUTO-CORRECT without shuffle — moves every hit back onto its 1/16 step and sets every shuffle to 50% (ratchets are kept).
- **Playback:** BPM, hi-hat decay, per-voice pitch sliders, keyboard preview (q w e r t y u i o p [ ]), Space to play/stop, chain playback, and an optional **Luma-Sim** rendering with its own pitch knob.
- **Writing:** **Write to Slot** encodes the grid into the RAM image; **Write RAM To Device** sends it to the Luma-1; **Download** saves the 8 KB image.
- **Encoding view:** shows each pattern's Z-80 RAM events (address, bytes, tick, step and offset).

Shuffle, offsets and ratchets are stored the way the Luma-1 stores them — as hit times (12 ticks per 1/16 note). When a pattern is loaded, the editor works out each row's shuffle setting and folds evenly spaced repeats back into ratchets; the timing always comes back exactly, though the label can differ when two settings sound the same.

## Luma-Sim
Luma-Sim previews samples through a model of the playback hardware (µ-law conversion and a 555-timer sample clock with drift and jitter). The pitch knob is relative to noon (49% = the sample's own pitch). It is available in the Luma-1 Sample Editor and, separately, in the Pattern Editor.

## How to use
Luma tools uses [WebMIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) (for Luma-1) and Web Serial (for PicoROM/Luma-mu), so it requires a Chromium-based browser such as Chrome or Edge. Safari supports neither API.

1. **For Luma-1:** Plug your Luma-1 into the USB port or connect via a MIDI interface.
2. **For Luma-mu:** Connect your PicoROM-equipped module via USB.
3. In Chrome navigate to **[https://luma.tools](https://luma.tools/)**
4. Click **"Allow"** in the popup asking for permissions.
5. Select the correct **Mode** (Luma-1 or Luma-Mu) at the top.
6. For Luma-1, select your *Luma-1* from the **MIDI Device** picker.

Now you can drag samples in from the desktop (WAV, AIFF, FLAC, MP3, PCM) into the editing area. Select a slot and use the device-specific controls to send to your hardware.

## How it works
The project is a client-side-only web application. It uses **WebMIDI** to communicate with the Luma-1 hardware, **Web Serial** to communicate with PicoROM/Luma-mu devices, and **WebAudio** for processing and playback. It is currently hosted on Firebase, but can be hosted anywhere since there are no server-side dependencies.

- `public/luma1/` — the app shell, Luma-1 Sample Editor (`luma_core.js`, `luma_audio.js`, `luma_waveform.js`, `luma_files.js`), MIDI (`luma_midi.js`), Pattern Editor (`luma_sequencer.js`), Librarian, Firmware.
- `public/luma1/mu/` — the Luma-mu editor (its own page, shown in an iframe in Luma-mu mode). The shell and Librarian talk to it with `postMessage` (`mu/js/luma_embed.js` ↔ `lumaMuBridge()` in `luma_core.js`).
- `public/luma1/data/` — tooltips (`tooltips.en.js`), the default pattern bank (`default_ram.js`) and the firmware list. Data the app needs is shipped as scripts rather than fetched, so it also works when opened from disk.

Luma Tools also supports integration with your Google Drive account to use that
storage as personal librarian for your samples and banks. This is optional and requires
you have a Google account and log in accordingly.

You can open `public/luma1/index.html` straight from disk in Chrome. Google Drive login needs a web server (OAuth does not accept `file://` pages); everything else works. Or serve the `public` folder with any static web server and open `/luma1/`, for example:
```bash
npx http-server public -p 8080
```
The footer's deploy date comes from `deploy_date.txt`, which `scripts/pre_deploy.py` writes on Firebase deploy; locally it reads "local build (not deployed)".

## Testing
This project has an automated End-to-End test suite using Playwright. See [testing.md](testing.md) for details on how to install and run the tests.

## FAQ
- **Will it run in Safari?** No, as Safari does not support WebMIDI or Web Serial APIs.
- **Will it run offline?** It was designed to do this and will support this mode in an upcoming release!

## Roadmap
- Offline support (either via Service Worker or Electron)
- ... ? email suggestions to [gregsimon@gmail.com](mailto:gregsimon@gmail.com)
