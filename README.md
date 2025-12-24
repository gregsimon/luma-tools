# Luma-Tools
## For the Luma-1 Drum Computer and Luma-mu Eurorack module

**luma-tools** is a web application that can be used as a companion to the [Luma-1 Drum computer](https://github.com/joebritt/luma1) and the **Luma-mu** Eurorack module. It enables:
- drag and drop sample conversion and loading
- sample bank assembling, loading, importing, exporting
- support for Luma-1 (via MIDI) and Luma-mu (via PicoROM/ROM export)

Releases are hosted at **[https://luma.tools](https://luma.tools/)** and do not require any installation.

## Device Modes
Luma-tools supports two different hardware devices. You can switch between them using the **Mode** dropdown at the top of the application.

### Luma-1 Mode
- **Slots:** 10 voice slots (BASS, SNARE, HIHAT, CLAPS, CABASA, TAMB, TOM, CONGA, COWBELL, RIMSHOT).
- **Connectivity:** Uses WebMIDI to read and write individual samples or complete banks directly to the hardware.
- **Features:** Supports naming samples and banks, bank management, and real-time communication.

### Luma-mu Mode
- **Slots:** 8 voice slots (SLOT 1 to SLOT 8).
- **Connectivity:** No direct MIDI sample transfer. Instead, it supports exporting the entire bank as a ROM image.
- **PicoROM Support:** Can directly program a PicoROM device connected via USB, or read banks from it.
- **Features:** Bank names are used as filenames for ROM exports.

## How to use
Luma tools uses [WebMIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) (for Luma-1) and WebUSB/WebSerial (for PicoROM/Luma-mu), so it requires Chrome or Firefox (Safari does not support these APIs).

1. **For Luma-1:** Plug your Luma-1 into the USB port or connect via a MIDI interface.
2. **For Luma-mu:** Connect your PicoROM-equipped module via USB.
3. In Chrome navigate to **[https://luma.tools](https://luma.tools/)**
4. Click **"Allow"** in the popup asking for permissions.
5. Select the correct **Mode** (Luma-1 or Luma-Mu) at the top.
6. For Luma-1, select your *Luma-1* from the **MIDI Device** picker.

Now you can drag samples in from the desktop (WAV, PCM) into the editing area. Select a slot and use the device-specific controls to send to your hardware.

## How it works
The project is a client-side-only web application. It uses **WebMIDI** to communicate with the Luma-1 hardware, **Web Serial** to communicate with PicoROM/Luma-mu devices, and **WebAudio** for processing and playback. See `luma_core.js` and other `luma_*.js` files for implementation details. It is currently hosted on Firebase, but can be hosted anywhere since there are no server-side dependencies.

Luma Tools also supports integration with your Google Drive account to use that
storage as personal librarian for your samples and banks. This is optional and requires
you have a Google account and log in accordingly.

## Testing
This project has an automated End-to-End test suite using Playwright. See [testing.md](testing.md) for details on how to install and run the tests.

## FAQ
- **Will it run in Safari?** No, as Safari does not support WebMIDI or Web Serial APIs.
- **Will it run offline?** It was designed to do this and will support this mode in an upcoming release!

## Roadmap
- Offline support (either via Service Worker or Electron)
- Pattern editing
- ... ? email suggestions to [gregsimon@gmail.com](mailto:gregsimon@gmail.com)
