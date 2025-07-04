"Copyright 2023-2025 Greg Simon";

// globals
const classAudioContext = window.AudioContext || window.webkitAudioContext;
let actx; // AudioContext
let editorAudioBuffer; // AudioBuffer (active sample)
let midiAccess = null;
let midiOut = null;
let midiIn = null;
let fileReader;
let editor_in_point = 0;
let editor_out_point = 0;
let sampleRate = 12000; // Hz
let sampleName = "untitled";
let shiftDown = false;
let binaryFileOriginal = null; // Original raw bytes of loaded sample
let binaryFormat = "ulaw_u8";
let kMaxSampleSize = 32768;
let bank = []; // Hold the state of each slot
let bank_name = "Untitled";
let current_mode = "luma1"; // Current device mode: luma1 or lumamu
const drag_gutter_pct = 0.1;
let luma_firmware_version = "";
let luma_serial_number = "";
let throttle_midi_send_ms = 0;
let ram_dump = null;

// settings lets that are persisted locally on computer
let settings_midiDeviceName = "";
let settings_midi_monitor_show_sysex = false;

const TAB_SAMPLE_EDITOR = 0;
const TAB_PATTERN_EDITOR = 1;
const TAB_MIDI_MONITOR = 2;
const TAB_UTILITIES = 3;

// send/receive device command IDs
const CMD_SAMPLE = 0x00;
const CMD_SAMPLE_BANK = 0x01;
const CMD_RAM_BANK = 0x02;
const CMD_PARAM = 0x04;
const CMD_UTIL = 0x05;
const CMD_REQUEST = 0x08;

const SX_VOICE_BANK_NAME = 0x00;
const SX_RAM_BANK_NAME = 0x01;
const SX_TEENSY_VERSION = 0x02;
const SX_SERIAL_NUMBER = 0x03;

// Drum slot IDs
const DRUM_BASS = 0;
const DRUM_SNARE = 1;
const DRUM_HIHAT = 2;
const DRUM_CLAPS = 3;
const DRUM_CABASA = 4;
const DRUM_TAMB = 5;
const DRUM_TOM = 6;
const DRUM_CONGA = 7;
const DRUM_COWBELL = 8;
const DRUM_CLAVE = 9;

// Luma-1 slot names
const luma1_slot_names = [
  "BASS", // 0  [ 1]
  "SNARE", // 1 [ 6 wav]
  "HIHAT", // 2 [ 3 wav]
  "CLAPS", // 3 [ 4 wav]
  "CABASA", // 4 [ 5 wav]
  "TAMB", // 5 [  6 wav]
  "TOM", // 6 [  7 wav ]
  "CONGA", // 7 [8 wav]
  "COWBELL", // 8  []
  "RIMSHOT", // 9 [ ]
];

// Luma-Mu slot names (ordered strange to follow 
// unaddressed ordering of drum bank names)
const lumamu_slot_names = [
  "SLOT 4", // 0 
  "SLOT 3", // 1
  "SLOT 5", // 2
  "SLOT 6", // 3
  "SLOT 8", // 4
  "SLOT 7", // 5
  "SLOT 2", // 6
  "SLOT 1", // 7
];

// Current slot names based on mode
let slot_names = luma1_slot_names;

const slot_waveform_fg = "rgb(214,214,214)";
const slot_waveform_bg = "rgb(41,41,41)";
const editor_waveform_fg = "rgb(214,214,214)";
const editor_waveform_bg = "rgb(41,41,41)";
const drag_handle_color = "rgb(46, 155, 214)";

// State during read banks. We need to chain together a number
// of sample request callbacks.
let reading_banks = false; // are we reading banks?
let reading_banks_id; // 255, 0-99
let reading_banks_current_slot = 0; // what slot to drop the sample in when it arrives

// Used to pad number strings with 0s
Number.padLeft = (nr, len = 2, padChr = `0`) =>
  `${nr < 0 ? `-` : ``}${`${Math.abs(nr)}`.padStart(len, padChr)}`;

function p(s) {
  console.log(s);
}
function de(id) {
  return document.getElementById(id);
}

// Initialize the application.
function luma1_init() {
  
  // Initialize with Luma-1 mode
  current_mode = "luma1";
  slot_names = luma1_slot_names;
  
  // wire up the slot waveforms
  // Always initialize 10 slots for both modes
  for (let i = 0; i < 10; i++) {
    bank.push({
      id: i,
      name: "untitled",
      sample_rate: 12000,
      original_binary: null,
      audioBuffer: null,
    });
    const el = document.getElementById("canvas_slot_" + i);
    el.draggable = true;
    el.ondrop = (ev) => {
      ev.preventDefault();
      console.log(ev);
    };
    el.onmouseup = () => {
      playSlotAudio(i);
    };
    el.ondragover = (ev) => {
      ev.preventDefault();
    };
    el.ondragstart = (ev) => {
      ev.dataTransfer.setData("text/plain", i);
    };
    el.ondrop = (ev) => {
      ev.preventDefault();
      const srcId = ev.dataTransfer.getData("text/plain");
      copyWaveFormBetweenSlots(srcId, i);
    };
  }

  // populate the bank select fields
  const populate_bank_select = (el, top_item_name = "STAGING") => {
    const opt = document.createElement("option");
    opt.value = 255;
    opt.innerHTML = top_item_name;
    el.appendChild(opt);
    for (let i = 0; i <= 99; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.innerHTML = String(i).padStart(2, "0");
      el.appendChild(opt);
    }
  };
  populate_bank_select(document.getElementById("bankId"));
  populate_bank_select(document.getElementById("bankId2"));
  populate_bank_select(document.getElementById("ram_bankId"), "ACTIVE");

  // populate the slot fields for both modes
  const populate_slot_select = (el, mode) => {
    // Clear existing options
    el.innerHTML = '';
    
    // Get the appropriate slot names and number of slots based on mode
    const slotNamesArray = (mode === "luma1") ? luma1_slot_names : lumamu_slot_names;
    const numSlots = slotNamesArray.length;
    
    for (let i = 0; i < numSlots; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.innerHTML = slotNamesArray[i];
      el.appendChild(opt);
    }
  };
  
  // Initialize both slot selectors
  populate_slot_select(document.getElementById("slotId"), "luma1");
  populate_slot_select(document.getElementById("slotId_mu"), "lumamu");

  // Add event listener for mode change
  document.getElementById("device_mode").addEventListener("change", changeDeviceMode);
  
  // Add event handlers for sample offset text fields
  document.getElementById("in_point").addEventListener("input", (e) => {
    const value = parseInt(e.target.value) || 0;
    if (editorAudioBuffer) {
      editor_in_point = Math.max(0, Math.min(value, editorAudioBuffer.length - 1));
      if (editor_in_point >= editor_out_point) {
        editor_out_point = Math.min(editor_in_point + 1, editorAudioBuffer.length - 1);
        document.getElementById("out_point").value = editor_out_point;
      }
      redrawAllWaveforms();
    }
  });
  
  document.getElementById("out_point").addEventListener("input", (e) => {
    const value = parseInt(e.target.value) || 0;
    if (editorAudioBuffer) {
      editor_out_point = Math.max(0, Math.min(value, editorAudioBuffer.length - 1));
      if (editor_out_point <= editor_in_point) {
        editor_in_point = Math.max(0, editor_out_point - 1);
        document.getElementById("in_point").value = editor_in_point;
      }
      redrawAllWaveforms();
    }
  });

  // setup main waveform editor
  const canvas = document.getElementById("editor_canvas");
  canvas.draggable = true;
  canvas.onmousedown = (event) => {
    onEditorCanvasMouseDown(event);
  };
  canvas.onmousemove = (event) => {
    onEditorCanvasMouseMove(event);
  };
  canvas.onmouseup = (event) => {
    onEditorCanvasMouseUp(event);
  };
  canvas.onmouseleave = (event) => {
    onEditorCanvasMouseUp(event);
  };
  canvas.ondragstart = (ev) => {
    const y = ev.offsetY;
    const h = canvas.height;
    const edge = h * drag_gutter_pct;
    if (y > edge && y < h - edge) {
      ev.dataTransfer.setData("text/plain", 255); // start drag
    } else {
      ev.preventDefault(); // do endpoint adjustment
    }
  };
  canvas.ondragover = (ev) => {
    ev.preventDefault();
  };
  canvas.ondrop = (ev) => {
    ev.preventDefault();
    const srcId = ev.dataTransfer.getData("text/plain");
    if (srcId !== "") {
      copyWaveFormBetweenSlots(srcId, 255);
    }
  };

  // tabs
  document.getElementById("sample_editor_tab_button").onclick = () => {
    switchTab(TAB_SAMPLE_EDITOR);
  };
  document.getElementById("pattern_editor_tab_button").onclick = () => {
    switchTab(TAB_PATTERN_EDITOR);
  };
  document.getElementById("midi_monitor_tab_button").onclick = () => {
    switchTab(TAB_MIDI_MONITOR);
  };

  // MIDI log
  document.getElementById("midi_log").readonly = true;
  document.getElementById("log_clear").onclick = () => {
    document.getElementById("midi_log").innerHTML = "";
  };
  document.getElementById("show_sysex").onclick = () => {
    settings_midi_monitor_show_sysex =
      document.getElementById("show_sysex").checked;
    saveSettings();
  };

  // general window events
  window.addEventListener("resize", () => {
    resizeCanvasToParent();
    redrawAllWaveforms();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === " ") {
      e.preventDefault(); // TODO this prevents space in the text edit field
      playAudio();
    } else if (e.shiftKey) {
      shiftDown = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key.charCodeAt(0) === 83) {
      shiftDown = false;
    }
  });

  loadSettings();

  // get the build #
  fetch("deploy_date.txt")
    .then((response) => response.text())
    .then((text) => {
      document.getElementById("deployed_date").innerText = text;
    });

  navigator
    .requestMIDIAccess({ sysex: true })
    .then(onMidiSuccessCallback)
    .catch(onMidiFailCallback);

  resizeCanvasToParent();
  redrawAllWaveforms();

  slot_names = (current_mode === "luma1") ? luma1_slot_names : lumamu_slot_names;
  updateUIForMode(current_mode);
}

// This can only be done after a user gesture on the page.
function audio_init() {
  // We are selecting 12000 Hz here in order estimate the
  // Luma-1's pitch knob position at 12-o-clock. This matters because
  // when we drag import wav files WebAudio matches them to this audiocontext.
  if (actx == undefined) actx = new classAudioContext({ sampleRate: 12000 });
}

function switchTab(newTab) {
  de("sample_editor_tab").style.display = "none";
  de("pattern_editor_tab").style.display = "none";
  de("midi_monitor_tab").style.display = "none";
  switch (newTab) {
    case TAB_SAMPLE_EDITOR:
      de("sample_editor_tab").style.display = "block";
      break;
    case TAB_PATTERN_EDITOR:
      de("pattern_editor_tab").style.display = "block";
      break;
    case TAB_MIDI_MONITOR:
      de("midi_monitor_tab").style.display = "block";
      break;
    case TAB_UTILITIES:
      de("utilities_tab").style.display = "block";
      break;
  }
}

// Copy a webAudio buffer object, optionally endpointing the source.
function cloneAudioBuffer(fromAudioBuffer, start_index = 0, end_index = -1) {
  if (end_index == -1) end_index = fromAudioBuffer.length;

  num_samples_to_copy = end_index - start_index;

  const audioBuffer = new AudioBuffer({
    length: num_samples_to_copy,
    numberOfChannels: fromAudioBuffer.numberOfChannels,
    sampleRate: fromAudioBuffer.sampleRate,
  });
  for (let channelI = 0; channelI < audioBuffer.numberOfChannels; ++channelI) {
    var samples = fromAudioBuffer.getChannelData(channelI);
    samples = samples.subarray(start_index, start_index + num_samples_to_copy);

    audioBuffer.copyToChannel(samples, channelI);
  }
  return audioBuffer;
}

function cloneArrayBuffer(src) {
  if (src == null) return new ArrayBuffer(0);
  var dst = new ArrayBuffer(src.byteLength);
  new Uint8Array(dst).set(new Uint8Array(src));
  return dst;
}

// Copy the audio buffer between slots. If the src is the editor window
// we want to only copy the part of the sample that is selected.
function copyWaveFormBetweenSlots(srcId, dstId) {
  if (srcId == dstId) return;

  if (srcId == 255) {
    // Editor --> slot (with endpointing)
    bank[dstId].audioBuffer = cloneAudioBuffer(
      editorAudioBuffer,
      editor_in_point,
      editor_out_point + 1,  // +1 because editor_out_point is inclusive but cloneAudioBuffer expects exclusive
    );
    bank[dstId].name = document.getElementById("sample_name").value;
    bank[dstId].original_binary = cloneArrayBuffer(binaryFileOriginal);
  } else if (dstId == 255) {
    // Slot --> editor
    editorAudioBuffer = cloneAudioBuffer(bank[srcId].audioBuffer);
    sampleName = bank[srcId].name;
    document.getElementById("sample_name").value = sampleName;
    binaryFileOriginal = cloneArrayBuffer(bank[srcId].original_binary);
    resetRange();
  } else {
    // Slot --> Slot
    bank[dstId].audioBuffer = cloneAudioBuffer(bank[srcId].audioBuffer);
    bank[dstId].name = bank[srcId].name;
    bank[dstId].original_binary = cloneArrayBuffer(bank[srcId].original_binary);
  }

  redrawAllWaveforms();
}

function playSlotAudio(id) {
  // disable focus since it may double-trigger if "Preview" is selected and
  // the spacebar is pressed.
  document.activeElement.blur();

  let theSound = actx.createBufferSource();
  theSound.buffer = bank[id].audioBuffer;
  theSound.connect(actx.destination); // connect to the output

  // convert end points into seconds for playback.
  // TODO make sample rate adjustable
  theSound.start(0, 0, theSound.buffer.length / sampleRate);
}

// convert an arraybuffer into an AudioBuffer source ready for playback.
function convert_8b_ulaw_to_audioBuffer(arraybuf) {
  // convert ulaw into linear in the sourceAudioBuffer.
  var dv = new DataView(arraybuf);
  var newAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);

  //editor_out_point = dv.byteLength;
  channelData = newAudioBuffer.getChannelData(0);
  for (i = 0; i < dv.byteLength; i++) {
    var ulaw = dv.getUint8(i);
    ulaw = ~ulaw;
    var sample = ulaw_to_linear(ulaw);
    sample = sample / 32768.0;
    channelData[i] = sample;
  }
  return newAudioBuffer;
}

function drawSlotWaveforms() {
  // Get the appropriate number of slots based on current mode
  const numSlots = (current_mode === "luma1") ? luma1_slot_names.length : lumamu_slot_names.length;
  
  for (let i = 0; i < 10; i++) {
    const canvas = document.getElementById("canvas_slot_" + i);
    if (canvas) {
      // Only draw if this slot should be visible in the current mode
      if (i < numSlots) {
        // Use the appropriate slot name based on the current mode
        const slotName = (current_mode === "luma1") ? luma1_slot_names[i] : lumamu_slot_names[i];
        
        drawSlotWaveformOnCanvas(
          canvas,
          bank[i].audioBuffer,
          slotName,
          bank[i].name
        );
      }
    }
  }
}

function drawSlotWaveformOnCanvas(
  canvas,
  audioBuffer,
  title,
  name = "untitled",
) {
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext("2d");

  // Scale the inner drawling surface to the same
  // aspect ratio as the canvas element
  canvas.width = canvas.height * (canvas.clientWidth / canvas.clientHeight);

  ctx.fillStyle = slot_waveform_bg;
  ctx.fillRect(0, 0, w, h);

  if (audioBuffer && audioBuffer.length > 0) {
    ctx.strokeStyle = slot_waveform_fg;
    drawWaveform(w, h, ctx, audioBuffer);
    const tab_side = 15;
  }

  ctx.fillStyle = slot_waveform_fg;
  ctx.textAlign = "right";
  ctx.font = "24px condensed";
  ctx.fillText(name + " : " + title + " ", w, 24);
}

// -- Loading handlers

// File data is loaded/cached in binaryFileOriginal -
// interpret it based on 'binaryFormat'
function interpretBinaryFile() {
  if (binaryFormat === "ulaw_u8")
    editorAudioBuffer = convert_8b_ulaw_to_audioBuffer(binaryFileOriginal);
  else if (binaryFormat === "pcm_u8") loadBIN_u8b_pcm(binaryFileOriginal);

  // These are indexes into the
  editor_in_point = 0;
  editor_out_point = editorAudioBuffer.length - 1;

  trimBufferToFitLuma();
  document.getElementById("sample_name").value = sampleName;
}

function bankIdForName(name) {
  // try luma-1 bank names
  for (i = 0; i < luma1_slot_names.length; i++) {
    if (name === luma1_slot_names[i]) return i;
  }
  // try luma-mu bank names
  for (i = 0; i < lumamu_slot_names.length; i++) {
    if (name === lumamu_slot_names[i]) return i;
  }
  return -1;
}

// A zip file was dropped, presumably holding individual .wav files
// for each of the slots.
// the bank may be bured 'n' folders deep in the zip archive. To
// find it we'll look for the first occurance of BANKNAME.TXT which
// will be on the same level as the slot folders BASS, CONGA, etc.
function droppedFileLoadedZip(event) {
  var droppedZip = new JSZip();
  droppedZip.loadAsync(fileReader.result).then(function (zip) {
    // First locate the bank in the zip. We can't assume order here.
    var bank_path_prefix = "";
    var found_bank = false;
    for (const [key, value] of Object.entries(zip.files)) {
      if (!value.dir && value.name[0] != ".") {
        console.log(value.name.slice(-12));
        if (value.name.slice(-12).toUpperCase() === "BANKNAME.TXT") {
          found_bank = true;
          bank_path_prefix = value.name.slice(0, -12);
          console.log("found! bank_path_prefix=" + bank_path_prefix);
          break;
        }
      }
    }

    if (found_bank == false) {
      alert("Zip archive contains no folder with the file BANKNAME.TXT");
      return;
    }

    // Now we can walk through the file again and find the slots which will
    // be at the same level as 'bank_path_prefix'
    for (const [key, value] of Object.entries(zip.files)) {
      if (!value.dir) {
        //&& value.name.indexOf("t") == -1) {
        //console.log(`entry {${value.name}|`);

        if (value.name.slice(0, bank_path_prefix.length) != bank_path_prefix) {
          //console.log(`   Discard`);
          continue;
        }

        var name = value.name.slice(bank_path_prefix.length);

        // split name into slot_id
        var tokens = name.split("/");
        var bankId = bankIdForName(tokens[0]);
        if (bankId >= 0) {
          if (tokens[1][0] == ".")
            // ignore files that begin with .
            continue;

          // uncompress the data.
          (function (bankId, filename) {
            //console.log(`full: |${name}|`);
            droppedZip
              .file(value.name)
              .async("ArrayBuffer")
              .then(function (data) {
                //console.log(`|${filename}| ${data.byteLength} bytes`);

                bank[bankId].name = filename;

                const fileext = filename.slice(-4);
                if (fileext === ".wav") {
                  actx.decodeAudioData(data, function (buf) {
                    //console.log("Decoded wav file: SR="+buf.sampleRate+" len="+buf.length);
                    bank[bankId].audioBuffer = buf;
                    bank[bankId].sample_rate = buf.sampleRate;
                    redrawAllWaveforms();

                    // TODO trimBufferToFitLuma();
                  });
                } else if (fileext === ".bin") {
                  // this is the original binary stream
                  bank[bankId].original_binary = cloneArrayBuffer(data);
                  //console.log(bank[bankId].original_binary);
                }
              });
          })(bankId, tokens[1]);
        }
      }
    }
  });
}

// Binary stream - could be any number of formats.
function droppedFileLoadedBIN(event) {
  binaryFileOriginal = fileReader.result; // save original so we can re-interpret it.
  document.getElementById("binaryFormat").removeAttribute("disabled");
  interpretBinaryFile();
}

// Handle ROM binary files in Luma-Mu mode
function droppedFileLoadedRomMu(event) {
  const SLOT_SIZE = 16384;
  const NUM_SLOTS = 8;
  const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
  
  // Verify file size
  if (fileReader.result.byteLength !== TOTAL_SIZE) {
    alert("Invalid ROM file size. Expected 131072 bytes (128k)");
    return;
  }
  
  const romData = new Uint8Array(fileReader.result);
  const slot_import_order = [7, 6, 1, 0, 2, 3, 5, 4]; // Same order as exportBankAsRomMu
  
  // Process each slot
  for (let i = 0; i < NUM_SLOTS; i++) {
    const slotIndex = slot_import_order[i];
    const slotOffset = i * SLOT_SIZE;
    const slotData = romData.slice(slotOffset, slotOffset + SLOT_SIZE);
    
    // Convert uLaw data back to linear PCM
    const linearData = new Float32Array(SLOT_SIZE);
    for (let j = 0; j < SLOT_SIZE; j++) {
      let ulaw = slotData[j];
      ulaw = ~ulaw; // Invert back from PicoROM format
      const linear = ulaw_to_linear(ulaw);
      linearData[j] = linear / 32768.0; // Convert to float [-1, 1]
    }
    
    // Create AudioBuffer for this slot
    const audioBuffer = actx.createBuffer(1, SLOT_SIZE, 24000);
    audioBuffer.copyToChannel(linearData, 0);
    
    // Store in bank array
    bank[slotIndex] = {
      id: slotIndex,
      name: ``,
      sample_rate: 24000,
      original_binary: slotData.buffer,
      audioBuffer: audioBuffer,
    };
  }
  
  // Update the bank name from the filename
  const bankName = sampleName || "Imported ROM";
  document.getElementById("bank_name_mu").value = bankName;
  
  // Load the first slot into the editor
  if (bank[0] && bank[0].audioBuffer) {
    editorAudioBuffer = cloneAudioBuffer(bank[0].audioBuffer);
    sampleName = bank[0].name;
    document.getElementById("sample_name_mu").value = sampleName;
    binaryFileOriginal = cloneArrayBuffer(bank[0].original_binary);
    resetRange();
  }
  
  // Redraw all waveforms
  resizeCanvasToParent();
  redrawAllWaveforms();
  updateStatusBar();
  
  console.log(`Imported ROM file with ${NUM_SLOTS} slots`);
}

function trimBufferToFitLuma() {
  // limit sourceAudioBuffer to kMaxSampleSize samples
  console.log("imported sample len is " + editorAudioBuffer.length);
  if (editorAudioBuffer.length > kMaxSampleSize) {
    console.log(
      "trim buffer to kMaxSampleSize, original_size=" +
        editorAudioBuffer.length +
        " sampleRate=" +
        editorAudioBuffer.sampleRate, // <-- this comes from the original wav file
    );

    // use the same sample rate as the original file so we just
    // copy out samples
    var newSampleRate = editorAudioBuffer.sampleRate;

    var newArrayBuffer = actx.createBuffer(1, kMaxSampleSize, newSampleRate);
    var anotherArray = new Float32Array(kMaxSampleSize);
    var offset = 0;

    // editorBuffer --> anotherArray
    editorAudioBuffer.copyFromChannel(anotherArray, 0, 0);

    // write each sample from anotherArray to the console
    for (i = 0; i < anotherArray.length; i++) {
      //console.log(anotherArray[i]);
    }
  

    // newArrayBuffer <-- anotherArray
    newArrayBuffer.copyToChannel(anotherArray, 0, 0);

    editorAudioBuffer = newArrayBuffer;
    editor_in_point = 0;
    editor_out_point = editorAudioBuffer.length - 1;
    console.log("trimmed - new len is " + editorAudioBuffer.length);
  } else {
    // sample is <= to the full sample size.
    // let's try padding with zeros on the end and see what that does.
    console.log("sample is " + editorAudioBuffer.length + "/" + kMaxSampleSize);

    editor_in_point = 0;
    editor_out_point = editorAudioBuffer.length - 2;
  }

  resizeCanvasToParent();
  redrawAllWaveforms();
  updateStatusBar();
}

// Decode a Windows WAV file using wav.js (no resampling)
function droppedFileLoadedWav(event) {
  document.getElementById("binaryFormat").setAttribute("disabled", true);

  const wavFile = new wav(fileReader.result);
  
  if (wavFile.readyState !== wavFile.DONE) {
    alert("Error loading WAV file: " + wavFile.error);
    return;
  }
  
  // Check if format is supported
  if (wavFile.isCompressed()) {
    alert("Compressed WAV files are not supported. Please use uncompressed PCM format.");
    return;
  }
  
  if (!wavFile.isMono()) {
    alert("Only mono WAV files are supported. Please convert to mono.");
    return;
  }
  
  // Get the raw PCM data
  const dataOffset = wavFile.dataOffset;
  const dataLength = wavFile.dataLength;
  const bitsPerSample = wavFile.bitsPerSample;
  const sampleRate = wavFile.sampleRate;
  
  console.log(`Data: ${dataLength} bytes, ${bitsPerSample}-bit, ${sampleRate} Hz`);
  
  // Create AudioBuffer with the original sample rate
  const numSamples = dataLength / (bitsPerSample / 8);
  const audioBuffer = actx.createBuffer(1, numSamples, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  
  // Copy samples based on bit depth
  const dataView = new DataView(fileReader.result, dataOffset, dataLength);
  
  if (bitsPerSample === 8) {
    // 8-bit unsigned PCM (0-255, center at 128)
    for (let i = 0; i < numSamples; i++) {
      const sample = dataView.getUint8(i);
      channelData[i] = (sample - 128) / 128.0; // Convert to [-1, 1]
    }
  } else if (bitsPerSample === 16) {
    // 16-bit signed PCM
    for (let i = 0; i < numSamples; i++) {
      const sample = dataView.getInt16(i * 2, true); // true = little endian
      channelData[i] = sample / 32768.0; // Convert to [-1, 1]
    }
  } else if (bitsPerSample === 24) {
    // 24-bit signed PCM
    for (let i = 0; i < numSamples; i++) {
      const offset = i * 3;
      let sample = dataView.getUint8(offset) | 
                  (dataView.getUint8(offset + 1) << 8) | 
                  (dataView.getUint8(offset + 2) << 16);
      
      // Handle sign extension for 24-bit
      if (sample & 0x800000) {
        sample = sample | ~0xFFFFFF;
      }
      
      channelData[i] = sample / 8388608.0; // Convert to [-1, 1]
    }
  } else if (bitsPerSample === 32) {
    // 32-bit signed PCM
    for (let i = 0; i < numSamples; i++) {
      const sample = dataView.getInt32(i * 4, true); // true = little endian
      channelData[i] = sample / 2147483648.0; // Convert to [-1, 1]
    }
  } else {
    alert(`Unsupported bit depth: ${bitsPerSample}-bit. Please use 8, 16, 24, or 32-bit PCM.`);
    return;
  }
  
  editorAudioBuffer = audioBuffer;
  editor_in_point = 0;
  editor_out_point = editorAudioBuffer.length - 1;
  
  trimBufferToFitLuma();
  document.getElementById("sample_name").value = sampleName;
  
  console.log(`Successfully loaded wav ${numSamples} samples at ${sampleRate} Hz`);
}

function dragOverHandler(ev) {
  ev.preventDefault();
}

function resizeCanvasToParent() {
  // editor canvas
  var canvas = document.getElementById("editor_canvas");
  canvas.width = canvas.parentElement.offsetWidth;

  // slot canvases
  for (i = 0; i < 10; i++) {
    canvas = document.getElementById("canvas_slot_" + i);
    canvas.width = canvas.height * (canvas.clientWidth / canvas.clientHeight);
  }
}

var editorCanvasMouseIsDown = false;
function onEditorCanvasMouseDown(event) {
  editorCanvasMouseIsDown = true;
}

function onEditorCanvasMouseMove(event) {
  if (editorCanvasMouseIsDown) {
    const x = event.offsetX;
    const y = event.offsetY;
    var canvas = document.getElementById("editor_canvas");
    const h = canvas.height;
    const w = canvas.width;
    var drag_gutter_size = h * drag_gutter_pct;

    if (editorAudioBuffer == null) return;

    var new_pt = (editorAudioBuffer.length * x) / w;
    if (shiftDown) new_pt = Math.round(new_pt / 1024) * 1024;

    if (y >= h - drag_gutter_size) {
      // adjust endpoint
      if (new_pt > editor_in_point) editor_out_point = Math.floor(new_pt);
      editor_out_point = Math.min(
        editorAudioBuffer.length - 1,
        editor_out_point,
      );
    } else if (y < drag_gutter_size) {
      // adjust inpoint
      if (new_pt < editor_out_point) editor_in_point = Math.floor(new_pt);
      editor_in_point = Math.max(0, editor_in_point);
    } else {
      // TODO : initiate a drag
    }
    updateStatusBar();
    drawEditorCanvas();
  }
}

function onEditorCanvasMouseUp(event) {
  editorCanvasMouseIsDown = false;
}

function reverseSampleBuffer() {
  var len = editorAudioBuffer.length;
  var data = editorAudioBuffer.getChannelData(0);
  for (i = 0; i < len / 2; i++) {
    var sample = data[i];
    data[i] = data[len - 1 - i];
    data[len - 1 - i] = sample;
  }
  redrawAllWaveforms();
}

function resetRange() {
  editor_in_point = 0;
  editor_out_point = editorAudioBuffer.length - 1;
  updateStatusBar();
  redrawAllWaveforms();
}

function updateStatusBar() {
  document.getElementById("in_point").value = editor_in_point;
  document.getElementById("out_point").value = editor_out_point;
}

function redrawAllWaveforms() {
  drawEditorCanvas();
  drawSlotWaveforms();
}

// Render the audio waveform and endpoint UI into the canvas
function drawEditorCanvas() {
  var canvas = document.getElementById("editor_canvas");
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext("2d");

  ctx.fillStyle = editor_waveform_bg;
  ctx.fillRect(0, 0, w, h);

  if (editorAudioBuffer && editorAudioBuffer.length > 0) {
    ctx.strokeStyle = editor_waveform_fg;
    drawWaveform(w, h, ctx, editorAudioBuffer);
    const tab_side = 15;

    ctx.fillStyle = drag_handle_color;
    var offset = (w * editor_in_point) / editorAudioBuffer.length;
    ctx.fillRect(offset, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + tab_side, 0);
    ctx.lineTo(offset, tab_side);
    ctx.lineTo(offset, 0);
    ctx.closePath();
    ctx.fill();

    //draw gray on first part of sample
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, offset, h);
    ctx.globalAlpha = 1;

    ctx.fillStyle = drag_handle_color;
    offset = (w * editor_out_point) / editorAudioBuffer.length;
    ctx.fillRect(offset - 1, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset - 1 - tab_side, h);
    ctx.lineTo(offset, h - tab_side);
    ctx.lineTo(offset, h);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(offset, 0, w, h);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = slot_waveform_fg;
    ctx.textAlign = "center";
    ctx.font = "24px condensed";
    
    let helpText = "Drag a .bin (sample ROM), wav, or zip (bank archive) file here to get started.";
    if (current_mode === "lumamu") {
      helpText = "Drag a .bin (ROM file), wav, or zip (bank archive) file here to get started.";
    }
    
    ctx.fillText(helpText, w / 2, h / 2);
  }
}

function drawWaveform(w, h, ctx, buffer) {
  var data = buffer.getChannelData(0);
  ctx.beginPath();
  for (var x = 0; x < w; x++) {
    var sample_idx = Math.floor((data.length * x) / w);
    var d = data[sample_idx]; // d is [-1..1]

    d += 1; // now [0..2]
    d /= 2; // now [0..1]
    d *= h; // now [0..h]

    if (x > 0) {
      ctx.lineTo(x, d);
    } else {
      ctx.moveTo(x, d);
    }
  }
  ctx.stroke();
}

function dropHandler(ev) {
  ev.preventDefault();
  audio_init();

  [...ev.dataTransfer.items].forEach((item, i) => {
    // If dropped items aren't files, reject them
    if (item.kind === "file") {
      const file = item.getAsFile();
      var name = `${file.name}`;
      sampleName = name.slice(0, name.length - 4);
      name = name.toLowerCase();
      //console.log(`… file2[${i}].name = ${file.name}`);

      fileReader = new FileReader();
      if (name.slice(-4) === ".bin") {
        // Check if we're in Luma-Mu mode and this might be a ROM file
        if (current_mode === "lumamu" && file.size === 131072) { // 128k = 8 slots * 16384 bytes
          fileReader.onload = droppedFileLoadedRomMu;
        } else {
          fileReader.onload = droppedFileLoadedBIN;
        }
      }
      else if (name.slice(-4) === ".wav")
        fileReader.onload = droppedFileLoadedWav;
      else if (name.slice(-4) === ".zip")
        fileReader.onload = droppedFileLoadedZip;

      fileReader.readAsArrayBuffer(file);
    }
  });
}

function sendSysexToLuma(header) {
  // pack into the MIDI message
  // [f0] [69] [ulaw data] ..... [f7]
  var binaryStream = [];
  for (i = 0; i < 32; i++) binaryStream.push(header[i]); // 32b header

  // pack msg into 7bits
  var ulaw_stream_7bits = pack_sysex(binaryStream);

  // now add the sysex around it 0xf0 0x69 ulaw_stream_7bits 0xf7
  var sysx = [0xf0, 0x69];
  var sysx2 = sysx.concat(ulaw_stream_7bits);
  sysx2.push(0xf7);

  if (throttle_midi_send_ms > 0) {
    setTimeout(
      function (packet) {
        console.log(`sendSysexToLuma ${packet.length}`);
        midiOut.send(packet);
      },
      throttle_midi_send_ms,
      sysx2,
    );
  } else midiOut.send(sysx2);
}

// only send samples from in in-out points.
// This result will need to be added to 2k, 4k, 8k, 16k, or 32k
function writeSampleToDevice(slotId = 255) {
  var numSamples = editor_out_point - editor_in_point;
  var channels = editorAudioBuffer.getChannelData(0);
  var ulaw_buffer = [];

  // Convert from float<> to g711 uLaw buffer
  for (i = 0; i < numSamples; i++) {
    var sample = channels[editor_in_point + i] * 32768.0;
    var ulaw = linear_to_ulaw(sample);
    ulaw = ~ulaw;
    ulaw_buffer.push(ulaw);
  }

  // pack into the MIDI message
  // [f0] [69] [32 byte header] [ulaw data] ..... [f7]
  var binaryStream = [];
  for (i = 0; i < 32; i++) binaryStream.push(0x00); // 32b header

  // Offset into header
  // ----------------------
  // 0      cmd
  // 1-24   24 bytes of name
  // 25     bank Id
  // 26     slot Id
  // 27-31  padding
  binaryStream[0] = 0x01; // write to specific slot
  binaryStream[25] = de("bankId").value; //  bank
  binaryStream[26] = de("slotId").value;

  // pack name into offset [1]
  const kMaxChars = 24;
  sampleName = document.getElementById("sample_name").value.slice(0, kMaxChars);
  //console.log("writing "+sampleName.length+ " chars to slot "+document.getElementById('slotId').value);
  for (i = 0; i < sampleName.length; i++)
    binaryStream[i + 1] = sampleName.charAt(i).charCodeAt();

  // add in the ulaw data
  for (i = 0; i < ulaw_buffer.length; i++) binaryStream.push(ulaw_buffer[i]);

  // pack msg into 7bits
  var ulaw_stream_7bits = pack_sysex(binaryStream);

  // now add the sysex around it 0xf0 0x69 ulaw_stream_7bits 0xf7
  var sysx = [0xf0, 0x69];
  var sysx2 = sysx.concat(ulaw_stream_7bits);
  sysx2.push(0xf7);

  console.log(`Writing ${sysx2.length} to MIDI OUT`);
  midiOut.send(sysx2);
}

// only send samples from in in-out points.
// This result will need to be added to 2k, 4k, 8k, 16k, or 32k
function writeSampleToDeviceSlotBank(slotId, bankId) {
  if (bank[slotId].audioBuffer == null) return;

  const fromBank = bank[slotId];
  var numSamples = fromBank.audioBuffer.length;
  var channels = fromBank.audioBuffer.getChannelData(0);
  var ulaw_buffer = [];

  // Convert from float<> to g711 uLaw buffer
  for (i = 0; i < numSamples; i++) {
    var sample = channels[editor_in_point + i] * 32768.0;
    var ulaw = linear_to_ulaw(sample);
    ulaw = ~ulaw;
    ulaw_buffer.push(ulaw);
  }

  // pack into the MIDI message
  // [f0] [69] [32 byte header] [data] ..... [f7]
  var binaryStream = [];
  for (i = 0; i < 32; i++) binaryStream.push(0x00); // 32b header

  // Offset into header
  // ----------------------
  // 0      cmd
  // 1-24   24 bytes of name
  // 25     bank Id
  // 26     slot Id
  // 27-31  padding
  binaryStream[0] = 0x01; // write to specific slot
  binaryStream[25] = bankId;
  binaryStream[26] = slotId;

  // pack name into offset [1]
  const kMaxChars = 24;
  sampleName = fromBank.name.slice(0, kMaxChars);
  console.log(
    `writing ${sampleName.length} chars to slot ${slotId} in bank ${bankId}`,
  );
  for (i = 0; i < sampleName.length; i++)
    binaryStream[i + 1] = sampleName.charAt(i).charCodeAt();

  // add in the ulaw data
  for (i = 0; i < ulaw_buffer.length; i++) binaryStream.push(ulaw_buffer[i]);

  // pack msg into 7bits
  var ulaw_stream_7bits = pack_sysex(binaryStream);

  // now add the sysex around it 0xf0 0x69 ulaw_stream_7bits 0xf7
  var sysx = [0xf0, 0x69];
  var sysx2 = sysx.concat(ulaw_stream_7bits);
  sysx2.push(0xf7);

  midiOut.send(sysx2);
}

function playAudio() {
  // disable focus since it may double-trigger if "Preview" is selected and
  // the spacebar is pressed.
  document.activeElement.blur();

  let theSound = actx.createBufferSource();
  theSound.buffer = editorAudioBuffer;
  theSound.connect(actx.destination); // connect to the output

  console.log("editor_in_point = " + editor_in_point);
  console.log("editor_out_point = " + editor_out_point); 
  console.log("num samples to play = " + (editor_out_point - editor_in_point+1));
  console.log("start at " + editor_in_point / sampleRate + " seconds");
  console.log("total duration = " + (editor_out_point - editor_in_point+1) / sampleRate + " seconds");
  
  // convert end points into seconds for playback.
  // TODO make sample rate adjustable
  theSound.start(
    // when (seconds) playback should start (immediately)
    0,
    // offset (seconds) into the buffer where playback starts
    editor_in_point / theSound.buffer.sampleRate, 
    // duration (seconds) of the sample to play
    (editor_out_point - editor_in_point+1) / theSound.buffer.sampleRate,
  );
}

// convert an arraybuffer into an AudioBuffer source ready for playback.
function loadBIN_u8b_pcm(arraybuf) {
  dv = new DataView(arraybuf);
  editorAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);
  editor_out_point = dv.byteLength;
  channelData = editorAudioBuffer.getChannelData(0);
  for (i = 0; i < dv.byteLength; i++) {
    var sample = dv.getUint8(i); // unsigned 8bit
    sample -= 128;
    sample = sample / 128.0;
    channelData[i] = sample;
  }
}

// Writes all samples in the bank[] data structure to the device.
function writeBankToDevice() {
  const bankId = de("bankId2").value;

  // Write the bank name
  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);
  buf[0] = CMD_UTIL | 0x08;
  buf[25] = de("ram_bankId").value;
  buf[26] = SX_RAM_BANK_NAME;
  const kMaxChars = 24;
  sampleName = de("bank_name").value.slice(0, kMaxChars);
  for (i = 0; i < sampleName.length; i++)
    buf[i + 1] = sampleName.charAt(i).charCodeAt();

  sendSysexToLuma(buf);

  // write the slots
  const write_order = [
    DRUM_CONGA,
    DRUM_TOM,
    DRUM_SNARE,
    DRUM_BASS,
    DRUM_HIHAT,
    DRUM_COWBELL,
    DRUM_CLAPS,
    DRUM_CLAVE,
    DRUM_TAMB,
    DRUM_CABASA,
  ];
  for (idx = 0; idx < write_order.length; idx++) {
    var slotId = write_order[idx];
    console.log(`writing slot ${slotId} in bank ${bankId}`);
    writeSampleToDeviceSlotBank(slotId, bankId);
  }
}

// reads all samples from the bank in the 'bankid2' field.
function readBankfromDevice() {
  audio_init(); // may not have been called

  reading_banks = true;
  reading_banks_id = document.getElementById("bankId2").value;
  reading_banks_current_slot = 0; // start with slot 0

  readNextSampleInBank();
}

function readNextSampleInBank() {
  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);

  // struct from LM_MIDI.ino
  buf[0] = CMD_SAMPLE | 0x08;
  buf[25] = reading_banks_id;
  buf[26] = reading_banks_current_slot;
  sendSysexToLuma(buf);
}

// Ask Luma to send the sample buffer
function readSampleFromDevice() {
  audio_init(); // may not have been called

  var slotId = document.getElementById("slotId").selectedIndex;
  var bankId = document.getElementById("bankId").value;
  console.log("bankid = " + bankId);

  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);

  // struct from LM_MIDI.ino
  buf[0] = CMD_SAMPLE | 0x08;
  buf[25] = bankId;
  buf[26] = slotId;

  sendSysexToLuma(buf);
}

function changeBinFormat(event) {
  binaryFormat = document.getElementById("binaryFormat").value;
  interpretBinaryFile();
}

// Download this arraybuffer to the local computer as a binary file
function saveLocalByteAray(name, buffer) {
  var blob = new Blob([buffer], { type: "application/octet-stream" });
  console.log("blob size is " + blob.size);
  var link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  var fileName = name;
  link.download = fileName;
  link.click();
}

// Encode and download sample as a WAV file to local file system
function exportSample() {
  if (!editorAudioBuffer) {
    alert("No sample loaded");
    return;
  }

  // Get the appropriate sample name field based on current mode
  const sampleNameField = (current_mode === "luma1") ? "sample_name" : "sample_name_mu";
  let name = document.getElementById(sampleNameField).value || "untitled";
  
  let wav = encodeWAV(editorAudioBuffer, editor_in_point, editor_out_point);
  let blob = new Blob([wav], { type: "audio/wav" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = name + ".wav";
  a.click();
}

// Ask Luma to send the pattern block
function readRAMfromDevice() {
  audio_init();

  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);
  buf[0] = CMD_RAM_BANK | 0x08;
  buf[25] = de("ram_bankId").value;

  sendSysexToLuma(buf);
}

function downloadRAMBuffer() {
  var ram_blob = new Blob([ram_buffer]);

  var link = document.createElement("a");
  link.href = window.URL.createObjectURL(ram_blob);
  link.download = "luna_ram.bin";
  link.click();
}

// Ask Luma to send the pattern block
function writeRAMToDevice() {
  audio_init();

  // TODO
}

function noteNumberToString(note) {
  const note_names = [
    " C",
    "C#",
    " D",
    "D#",
    " E",
    " F",
    "F#",
    " G",
    "G#",
    " A",
    "A#",
    " B",
  ];
  var octave = note / 12;
  var note_in_octave = note % 12;
  str = note_names[note_in_octave];
  str += (octave + 1).toFixed(0);
  return str;
}

function CCtoName(num) {
  switch (num) {
    case 0:
      return "sound bank MSB";
    case 1:
      return "mod wheel";
    case 7:
      return "volume level";
    case 10:
      return "panoramic";
    case 11:
      return "expression";
    case 32:
      return "sound bank LSB";
    case 64:
      return "sustain pedal";
  }
  return num;
}

function formatMidiLogString(event) {
  if (event.data[0] == 0xf0 && !settings_midi_monitor_show_sysex) return "";

  const date = new Date();
  const dateString =
    date.getUTCHours() +
    ":" +
    date.getMinutes() +
    ":" +
    date.getSeconds() +
    "." +
    Number.padLeft(date.getMilliseconds(), 3);

  let str = `${dateString} [${event.data.length} bytes]: `;
  for (const character of event.data) {
    str += `${character.toString(16)} `;
  }

  str += "  ";

  const d = event.data;
  // format the message.
  var midi_cmd = d[0] & 0xf0;
  if (midi_cmd == 0x90)
    str += "Note ON  " + noteNumberToString(d[1]) + " vel=" + d[2];
  else if (midi_cmd == 0x80)
    str += "Note OFF " + noteNumberToString(d[1]) + " vel=" + d[2];
  else if (midi_cmd == 0xb0)
    str += "CC controller=" + CCtoName(d[1]) + " value=" + d[2];
  else if (midi_cmd == 0xe0) str += "Pitch bend ";
  else if (midi_cmd == 0xe0) str += "Pitch bend ";

  return str;
}

// ----------------------------------------------------------------------------
// WebMIDI routines

function onMidiFailCallback(err) {
  console.log(`WebMIDI failed to initialize: ${err.code}`);
  document.getElementById("midiFailed").style.display = "block";
}

function onMIDIMessageReceived(event) {
  let str = formatMidiLogString(event);
  if (str != "") {
    const midi_log = de("midi_log");
    midi_log.innerHTML += `${str} \n`;
    midi_log.scrollTop = midi_log.scrollHeight;
  }

  console.log(`onMIDIMessageReceived ${event.data.length} bytes`);
  console.log(`last byte is ${event.data[event.data.length - 1].toString(16)}`);

  if (event.data[0] == 0xf0) {
    // Unpack the Sysex to figure out what we received.
    // skip first two and last bytes

    const decoder = new TextDecoder();
    console.log(`event.data MIDI In = ${event.data.length} bytes`);
    var data = Uint8Array.from(
      unpack_sysex(event.data.slice(2, event.data.length - 1)),
    );
    var type = data[0];
    if (type == 0x01 || type == 0x09) {
      // 0x01 or 0x09 for samples
      // header 32 bytes
      // [0] cmd
      // [1-23] name
      // [25] bank
      // [26] slot
      var name = data.slice(1, 24);
      var name_len = 0;
      for (var i = 0; i < name.length; i++) {
        if (name[i] == 0) {
          break;
        }
        name_len++;
      }
      sampleName = decoder.decode(name.slice(0, name_len));
      console.log(sampleName);
      document.getElementById("sample_name").value = sampleName;
      var ulaw_data = data.slice(32);
      var ulaw_data_ab = arrayToArrayBuffer(ulaw_data);
      var newAudioBuffer = convert_8b_ulaw_to_audioBuffer(ulaw_data_ab);

      if (reading_banks) {
        // copy the sample to the appropriate slot.
        //copyWaveFormBetweenSlots(255, reading_banks_current_slot);

        bank[reading_banks_current_slot].audioBuffer =
          cloneAudioBuffer(newAudioBuffer);
        bank[reading_banks_current_slot].name =
          document.getElementById("sample_name").value;
        bank[reading_banks_current_slot].original_binary =
          cloneArrayBuffer(ulaw_data_ab);

        reading_banks_current_slot++;
        if (reading_banks_current_slot < slot_names.length)
          readNextSampleInBank();
        else reading_banks = false;
      } else {
        editor_out_point = newAudioBuffer.length;

        editorAudioBuffer = newAudioBuffer;
        binaryFileOriginal = ulaw_data_ab; // save the binary stream
      }

      resizeCanvasToParent();
      redrawAllWaveforms();
      updateStatusBar();
    } else if (type == CMD_UTIL) {
      var data = Uint8Array.from(
        unpack_sysex(event.data.slice(2, event.data.length - 1)),
      );
      var enc = new TextDecoder("utf-8");

      switch (data[26]) {
        case SX_TEENSY_VERSION:
          {
            luma_firmware_version = enc.decode(data.slice(1, 25));
            document.getElementById("firmware_version").innerHTML =
              luma_firmware_version;
          }
          break;

        case SX_SERIAL_NUMBER:
          luma_serial_number = enc.decode(data.slice(1, 25));
          de("serial_number").innerHTML = luma_serial_number;
          break;

        case SX_RAM_BANK_NAME:
          console.log("SX_RAM_BANK_NAME received");
          break;

        case SX_VOICE_BANK_NAME:
          console.log("SX_VOICE_BANK_NAME received");
          bank_name = enc.decode(data.slice(1, 25));
          de("bank_name").value = bank_name;
          break;
      }
    } else if (type == CMD_RAM_BANK) {
      console.log(`CMD_RAM_BANK ${event.data.length} bytes`);
      var el = de("ram_editor");
      ram_buffer = data.slice(32);
      var format = {
        width: 16,
        html: false,
        format: "twos",
      };
      el.innerText = hexy(ram_buffer, format);
    } else {
      console.log("unsupported Luma packet type=" + type);
    }
  }
}

// A MIDI device was attached to or detacted from the computer.
function refreshMidiDeviceList(event) {
  var midiSelectElement = de("midi_out_device");

  midiSelectElement.innerHTML = "";

  let outputs = midiAccess.outputs;
  inputs = midiAccess.inputs;

  midiSelectElement.options.add(
    new Option("NO MIDI Connection", "NONE", false, false),
  );

  // Add ports to the UI picker. If we have selected one in the past, set it again
  outputs.forEach((port) => {
    midiSelectElement.options.add(
      new Option(port.name, port.fingerprint, false, false),
    );
  });
  midiSelectElement.selectedIndex = 0;

  // Load the last used MIDI port, if one was set.
  if (midiSelectElement.value != undefined) {
    midiSelectElement.value = settings_midiDeviceName;
    outputs.forEach((port) => {
      if (0 == port.name.localeCompare(settings_midiDeviceName)) {
        midiOut = port;
      }
    });

    // find the midi input port using the output device name
    inputs.forEach((port) => {
      if (0 == port.name.localeCompare(settings_midiDeviceName)) {
        midiIn = port;
        midiIn.onmidimessage = onMIDIMessageReceived;
      }
    });
  }
}

function generateRamp() {
  var value = 0;
  var data = editorAudioBuffer.getChannelData(0);
  for (var i = 0; i < editorAudioBuffer.length; i++) {
    data[i] = value;
    value = value + 0.01;
    if (value > 1) value = 0;
  }

  redrawAllWaveforms();
}

// User changed MIDI device
function userChangedMIDIOutDevice(event) {
  let outputs = midiAccess.outputs,
    inputs = midiAccess.inputs,
    selectedIndex = event.target.selectedIndex - 1;

  midiOut = undefined;
  midiIn = undefined;
  outputs.forEach((port) => {
    if (selectedIndex == 0) {
      midiOut = port;
      settings_midiDeviceName = port.name;
      saveSettings();
    }
    selectedIndex--;
  });

  // find the midi input port using the output device name
  inputs.forEach((port) => {
    if (0 == port.name.localeCompare(settings_midiDeviceName)) {
      midiIn = port;
      midiIn.onmidimessage = onMIDIMessageReceived;
    }
  });
}

function onMidiSuccessCallback(access) {
  midiAccess = access;

  // We are going to only list the MIDI out device
  // and then look for the MIDI in to connect as well. I supose
  // ideally we'd show separate IN and OUT selects?
  var selectMidiOut = de("midi_out_device");

  access.onstatechange = (event) => {
    refreshMidiDeviceList();
  };
  selectMidiOut.onchange = userChangedMIDIOutDevice;

  refreshMidiDeviceList();

  if (midiIn != null && midiOut != null) {
    console.log("Connected to Luma");
    var buf = new ArrayBuffer(32);
    dv = new DataView(buf);
    buf[0] = CMD_UTIL | 0x08;
    buf[26] = SX_TEENSY_VERSION;
    sendSysexToLuma(buf); // ask for firmware version

    buf[26] = SX_SERIAL_NUMBER;
    sendSysexToLuma(buf); // ask for serial #
  }
}

function trim_filename_ext(filename) {
  if (filename.indexOf(".") >= 0)
    return filename.split(".").slice(0, -1).join(".");

  return filename;
}

// This function takes all 8 slots and either expands or shrinks their
// audio buffers (channel 0) to 16384 bytes, then cats them together as
// one 128k continuous buffer. It then renames this "ROM.BIN" and downloads
// it to the user's computer.
function exportBankAsRom() {
  if (current_mode === "lumamu") {
    exportBankAsRomMu();
    return;
  }
  // Each slot's channel 0 must be 16384 bytes, 8 slots = 131072 bytes (128k)
  const SLOT_SIZE = 16384;
  const NUM_SLOTS = 8;
  const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
  const romBuffer = new Uint8Array(TOTAL_SIZE);

  for (let i = 0; i < NUM_SLOTS; i++) {
    if (!bank[i] || !bank[i].audioBuffer) {
      // If slot is empty, leave as zeros
      continue;
    }
    let channelData = bank[i].audioBuffer.getChannelData(0);
    let ulaw = new Uint8Array(SLOT_SIZE);
    for (let j = 0; j < SLOT_SIZE; j++) {
      let s = (j < channelData.length) ? channelData[j] : 0;
      // Clamp to [-1, 1]
      s = Math.max(-1, Math.min(1, s));
      // Convert float [-1,1] to 16-bit signed integer
      let linear = Math.round(s * 32767);
      ulaw[j] = linear_to_ulaw(linear);
      ulaw[j] =~ ulaw[j];
    }
    romBuffer.set(ulaw, i * SLOT_SIZE);
  }

  saveLocalByteAray("ROM.BIN", romBuffer.buffer);
}

// Export ROM file for Luma-Mu mode
// Similar to exportBankAsRom but uses the bank_name_mu field for naming
// and only exports 8 slots
function exportBankAsRomMu() {
  // Each slot's channel 0 must be 16384 bytes, 8 slots = 131072 bytes (128k)
  const SLOT_SIZE = 16384;
  const NUM_SLOTS = 8;
  const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
  const romBuffer = new Uint8Array(TOTAL_SIZE);

  const slot_export_order = [7, 6, 1, 0, 2, 3, 5, 4];
  for (let i = 0; i < NUM_SLOTS; i++) {
    const idx = slot_export_order[i];
    if (!bank[idx] || !bank[idx].audioBuffer) {
      // If slot is empty, leave as zeros
      continue;
    }
    let channelData = bank[idx].audioBuffer.getChannelData(0);
    let ulaw = new Uint8Array(SLOT_SIZE);
    for (let j = 0; j < SLOT_SIZE; j++) {
      let s = (j < channelData.length) ? channelData[j] : 0;
      // Clamp to [-1, 1]
      s = Math.max(-1, Math.min(1, s));
      // Convert float [-1,1] to 16-bit signed integer
      let linear = Math.round(s * 32767);
      ulaw[j] = linear_to_ulaw(linear);
      ulaw[j] = ~ulaw[j];
    }
    romBuffer.set(ulaw, i * SLOT_SIZE);
  }

  // Use the bank name from the Luma-Mu bank name field
  const bankName = document.getElementById("bank_name_mu").value || "Untitled";
  saveLocalByteAray(`${bankName}.bin`, romBuffer.buffer);
}

// Upload directly to a PicoROM
async function uploadToPicoROMClicked() {
  const statusDiv = document.createElement('div');
  try {
    // First, create the ROM binary data
    const SLOT_SIZE = 16384;
    const NUM_SLOTS = 8;
    const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
    const romBuffer = new Uint8Array(TOTAL_SIZE);

    const slot_export_order = [7, 6, 1, 0, 2, 3, 5, 4];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const idx = slot_export_order[i];
      if (!bank[idx] || !bank[idx].audioBuffer) {
        // If slot is empty, leave as zeros
        continue;
      }
      let channelData = bank[idx].audioBuffer.getChannelData(0);
      let ulaw = new Uint8Array(SLOT_SIZE);
      for (let j = 0; j < SLOT_SIZE; j++) {
        let s = (j < channelData.length) ? channelData[j] : 0;
        // Clamp to [-1, 1]
        s = Math.max(-1, Math.min(1, s));
        // Convert float [-1,1] to 16-bit signed integer
        let linear = Math.round(s * 32767);
        ulaw[j] = linear_to_ulaw(linear);
        ulaw[j] = ~ulaw[j]; // Invert for PicoROM format
      }
      romBuffer.set(ulaw, i * SLOT_SIZE);
    }
    
    // Get the bank name from the HTML
    const bankName = document.getElementById("bank_name_mu").value || "Untitled";
    
    // Show a status message
    
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '50%';
    statusDiv.style.left = '50%';
    statusDiv.style.transform = 'translate(-50%, -50%)';
    statusDiv.style.padding = '20px';
    statusDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    statusDiv.style.color = 'white';
    statusDiv.style.borderRadius = '5px';
    statusDiv.style.zIndex = '1000';
    document.body.appendChild(statusDiv);
    
    statusDiv.textContent = 'Requesting PicoROM device...';
    
    // Upload the ROM to the PicoROM with the bank name
    await window.PicoROM.upload(romBuffer.buffer, (uploaded, total) => {
      const percent = Math.floor((uploaded / total) * 100);
      statusDiv.textContent = `Uploading to PicoROM: ${percent}%`;
    }, bankName);
    
    statusDiv.textContent = 'Upload complete!';
    setTimeout(() => {
      document.body.removeChild(statusDiv);
    }, 2000);
    
  } catch (error) {
    document.body.removeChild(statusDiv);
    console.error('Error uploading to PicoROM:', error);
    alert(`PicoROM upload failed: ${error.message}`);
    
  }
}

// Read from a PicoROM and load into the editor
async function readFromPicoROMClicked() {
  audio_init();
  const statusDiv = document.createElement('div');
  try {
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '50%';
    statusDiv.style.left = '50%';
    statusDiv.style.transform = 'translate(-50%, -50%)';
    statusDiv.style.padding = '20px';
    statusDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    statusDiv.style.color = 'white';
    statusDiv.style.borderRadius = '5px';
    statusDiv.style.zIndex = '1000';
    document.body.appendChild(statusDiv);
    
    statusDiv.textContent = 'Requesting PicoROM device...';

    const imageBuffer = await window.PicoROM.readImage((read, total) => {
        const percent = Math.floor((read / total) * 100);
        statusDiv.textContent = `Reading from PicoROM: ${percent}%`;
    });
    
    statusDiv.textContent = 'Read complete! Loading bank...';

    // We have the ROM, now load it into the bank slots
    const rom = new Uint8Array(imageBuffer);
    const SLOT_SIZE = 16384;
    const NUM_SLOTS = 8;
    const slot_import_order = [7, 6, 1, 0, 2, 3, 5, 4];

    for (let i = 0; i < NUM_SLOTS; i++) {
        const idx = slot_import_order[i];
        const offset = i * SLOT_SIZE;
        const chunk = rom.slice(offset, offset + SLOT_SIZE);

        const audioBuffer = convert_8b_ulaw_to_audioBuffer(chunk.buffer);
        bank[idx].audioBuffer = audioBuffer;
        bank[idx].name = ``;
        bank[idx].original_binary = chunk.buffer;
    }

    redrawAllWaveforms();

    setTimeout(() => {
      document.body.removeChild(statusDiv);
    }, 2000);

  } catch (error) {
    if (statusDiv.parentElement) {
        document.body.removeChild(statusDiv);
    }
    console.error('Error reading from PicoROM:', error);
    alert(`PicoROM read failed: ${error.message}`);
  }
}

// Add all the waveforms from the slots into a zip file and download it.
function exportBankAsZip() {
  // Get the appropriate bank name based on current mode
  const bankNameField = (current_mode === "luma1") ? "bank_name" : "bank_name_mu";
  bank_name = document.getElementById(bankNameField).value || "Untitled";

  var zip = new JSZip();

  zip.file("BANKNAME.TXT", bank_name);

  for (i = 0; i < slot_names.length; i++) {
    console.log("slot " + i);
    const slot_name = slot_names[i];
    const sample_name_base = trim_filename_ext(bank[i].name);
    if (bank[i].original_binary != null) {
      //console.log(bank[i].original_binary);
      if (bank[i].original_binary.byteLength > 0) {
        // export original binary
        // console.log(bank[i].original_binary);
        zip
          .folder(slot_name)
          .file(sample_name_base + ".bin", bank[i].original_binary);
      }
    }

    // export WAV
    var channelData = bank[i].audioBuffer.getChannelData(0);
    var encoder = new WavAudioEncoder(sampleRate, 1);
    encoder.encode([channelData]);
    var blob = encoder.finish();
    zip.folder(slot_name).file(sample_name_base + ".wav", blob);
  }

  console.log("here");

  zip.generateAsync({ type: "blob" }).then(function (blob_) {
    console.log("here2");
    var link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob_);
    link.download = bank_name + ".zip";
    link.click();
  });
}

function loadSettings() {
  settings_midiDeviceName = localStorage.getItem("midiDeviceName") || "";
  settings_midi_monitor_show_sysex =
    localStorage.getItem("midi_monitor_show_sysex") === "true";
  // Load saved mode if available
  const savedMode = localStorage.getItem("deviceMode");
  if (savedMode) {
    current_mode = savedMode;
    document.getElementById("device_mode").value = savedMode;
    updateUIForMode(savedMode);
  }
}

function saveSettings() {
  localStorage.setItem("midiDeviceName", settings_midiDeviceName);
  localStorage.setItem("midi_monitor_show_sysex", settings_midi_monitor_show_sysex);
  localStorage.setItem("deviceMode", current_mode);
}

// Function to handle mode change
function changeDeviceMode() {
  const modeSelect = document.getElementById("device_mode");
  current_mode = modeSelect.value;
  
  // Update slot names based on mode
  slot_names = (current_mode === "luma1") ? luma1_slot_names : lumamu_slot_names;
  
  // Update UI elements based on mode
  updateUIForMode(current_mode);
  
  // Save settings
  saveSettings();
}

// Function to update UI elements based on mode
function updateUIForMode(mode) {
  const slotContainer = document.getElementById("slot_container");
  
  if (mode === "luma1") {
    // Show Luma-1 specific elements
    slotContainer.className = "luma1_layout";
    document.getElementById("luma1_controls").style.display = "block";
    document.getElementById("lumamu_controls").style.display = "none";
    document.getElementById("luma1_sample_controls").style.display = "block";
    document.getElementById("lumamu_sample_controls").style.display = "none";
    document.getElementById("pattern_editor_tab_button").style.display = "block";
    document.getElementById("midi_monitor_tab_button").style.display = "block";
    
    // Update title
    document.title = "Luma-1 Tools";
    
    // Show all 10 slots for Luma-1
    for (let i = 0; i < 10; i++) {
      const slotElement = document.getElementById("canvas_slot_" + i);
      if (slotElement) {
        slotElement.parentElement.style.display = "flex";
      }
    }
  } else {
    // Show Luma-Mu specific elements
    slotContainer.className = "lumamu_layout";
    document.getElementById("luma1_controls").style.display = "none";
    document.getElementById("lumamu_controls").style.display = "block";
    document.getElementById("luma1_sample_controls").style.display = "none";
    document.getElementById("lumamu_sample_controls").style.display = "block";
    document.getElementById("pattern_editor_tab_button").style.display = "none";
    document.getElementById("midi_monitor_tab_button").style.display = "none";
    
    // If we're in a tab that's not available in Luma-Mu mode, switch to sample editor
    if (document.getElementById("pattern_editor_tab").style.display !== "none" ||
        document.getElementById("midi_monitor_tab").style.display !== "none") {
      switchTab(TAB_SAMPLE_EDITOR);
    }
    
    // Hide slots 8 and 9 for Luma-Mu (only shows 0-7)
    for (let i = 0; i < 10; i++) {
      const slotElement = document.getElementById("canvas_slot_" + i);
      if (slotElement) {
        if (i < 8) {
          slotElement.parentElement.style.display = "flex";
        } else {
          slotElement.parentElement.style.display = "none";
        }
      }
    }
    
    // Update title
    document.title = "Luma-Mu Tools";
  }
  
  // Update help text based on mode
  const helpTextElement = document.getElementById("help_text");
  if (helpTextElement) {
    if (mode === "luma1") {
      helpTextElement.innerHTML = 
        "Drag a binary file (8-bit PCM or uLaw), Wav file, or a zip archive of a bank onto top editor above.<br>" +
        "Press \"Spacebar\" to playback sample in browser<br>" +
        "Hold \"Shift\" while dragging endpoints to lock cursor to 1k (1024 samples)<br>" +
        "Drag waveforms between slots in the staging area, they can also be dragged to and from the editor<br>" +
        "The \"STAGING\" bank represents the samples currently loaded into the cards, the numbered banks are banks stored on the internal SD card.";
    } else {
      helpTextElement.innerHTML = 
        "Drag a ROM file (.bin), Wav file, or a zip archive of a bank onto top editor above.<br>" +
        "ROM files should be 131072 bytes (128k) containing 8 slots of sample data.<br>" +
        "Press \"Spacebar\" to playback sample in browser<br>" +
        "Hold \"Shift\" while dragging endpoints to lock cursor to 1k (1024 samples)<br>" +
        "Drag waveforms between slots in the staging area, they can also be dragged to and from the editor<br>" +
        "The \"STAGING\" bank represents the samples currently loaded into the cards, the numbered banks are banks stored on the internal SD card.";
    }
  }
  
  // Redraw waveforms to update labels
  redrawAllWaveforms();
}
