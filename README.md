# Luma-Tools
## For the Luma-1 Drum Computer

**luma-tools** is a web application that can be used as a companion to the [Luma-1 Drum computer](https://github.com/joebritt/luma1). It enables:
- drag and drop sample conversion and loading
- sample bank assembling, loading, importing, exporting

Releases are hosted at **[https://luma.tools](https://luma.tools/)** and do not require any installation.

## How to use
Luma tools uses [WebMIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) so it requires Chrome or Firefox (Safari does not support WebMIDI). It should work in Chrome on any device that has a MIDI interface.

1. Plug your Luma-1 into the USB port of your Mac/PC/Android phone. Alternatively connect your Luma-1's MIDI connections to a MIDI interface on your Mac/PC/Android phone.
2. In Chrome navigate to **[https://luma.tools](https://luma.tools/)**
3. Click **"Allow"** in the popup asking for WebMIDI/SysEx permission (only required once)
4. From the drop-down **MIDI Interface** picker on the left select your *Luma-1.*

Now you can drag samples in from the desktop (Wav, PCM) into the editing area. Select a slot (e.g. BASS, SNARE, ...) and click "Send to Luma" to load it into the machine.

## How it works
The project is a client-side-only web application. It uses WebMIDI to communicate with the 
Luma1 hardware and uses WebAudio to do processing and playback. See luma.js for the details. It
is currently hosted on firebase, but can be hosted anywhere since there are no server-side 
dependencies.

##FAQ
- **Will it run in Safari?** No, as Safari does not support WebMIDI.
- **Will it run offline?** It was designed to do this and will support this mode in an upcoming release!

## Roadmap
- Offline support (either via Service Worker or Electron)
- Pattern editing
- ... ? email suggestions to [gregsimon@gmail.com](mailto:gregsimon@gmail.com)
