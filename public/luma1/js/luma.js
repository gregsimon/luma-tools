"Copyright 2023-2024 Greg Simon"

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
const drag_gutter_pct = 0.10;
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

const slot_names = ["BASS", "SNARE", "HIHAT", "CLAPS",
  "CABASA", "TAMB", "TOM", "CONGA", "COWBELL", "RIMSHOT"];

const slot_waveform_fg = "rgb(214,214,214)";
const slot_waveform_bg = "rgb(41,41,41)";
const editor_waveform_fg = "rgb(214,214,214)";
const editor_waveform_bg = "rgb(41,41,41)"; 
const drag_handle_color = "rgb(46, 155, 214)";

// State during read banks. We need to chain together a number
// of sample request callbacks.
let reading_banks = false;            // are we reading banks?
let reading_banks_id;                 // 255, 0-99
let reading_banks_current_slot = 0;   // what slot to drop the sample in when it arrives

// Used to pad number strings with 0s
Number.padLeft = (nr, len = 2, padChr = `0`) => 
  `${nr < 0 ? `-` : ``}${`${Math.abs(nr)}`.padStart(len, padChr)}`;

function p(s) { console.log(s); }
function de(id) { return document.getElementById(id); }

// Initialize the application.
function luma1_init() {

  // wire up the slot waveforms
  for (i=0; i<slot_names.length; i++) {
    (function(i) {
      bank.push({
        id: i,
        name: "untitled",
        sample_rate: 12000,
        original_binary: null,
        audioBuffer: null
      });
      var el = de("canvas_slot_"+i);
      el.draggable = true;
      el.ondrop = (ev) => {
        ev.preventDefault();
        console.log(ev);
      }; 
      //el.ondblclick = (ev) => {copyWaveFormBetweenSlots(i, 255)};
      el.onmouseup = (ev) => {playSlotAudio(i);}   
      el.ondragover = (ev) => {ev.preventDefault();};
      el.ondragstart = (ev) => {ev.dataTransfer.setData("text/plain", i);};
      el.ondrop = (ev) => {
        ev.preventDefault();
        const srcId = ev.dataTransfer.getData("text/plain");
        copyWaveFormBetweenSlots(srcId, i);
      };
      })(i);
  }

  // populate the bank select fields
  let populate_bank_select = function(el, top_item_name = "STAGING") {
    var opt = document.createElement('option');
    opt.value = 255;
    opt.innerHTML = top_item_name;
    el.appendChild(opt);  
    for (i=0; i<=99; i++) {
      opt = document.createElement('option');
      opt.value = i;
      opt.innerHTML = Number.padLeft(i);
      el.appendChild(opt);
    }
  };
  populate_bank_select(de('bankId'));
  populate_bank_select(de('bankId2'));
  populate_bank_select(de('ram_bankId'), 'ACTIVE');

  // populate the slot field
  let populate_slot_select = function(el) {
    for (i=0; i<=slot_names.length; i++) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.innerHTML = slot_names[i];
      el.appendChild(opt);
    }
  };
  populate_slot_select(de('slotId'));


  // setup main waveform editor
  var canvas = de('editor_canvas');
  canvas.draggable = true;
  canvas.onmousedown = onEditorCanvasMouseDown;
  canvas.onmousemove = onEditorCanvasMouseMove;
  canvas.onmouseup = onEditorCanvasMouseUp;
  canvas.onmouseleave = onEditorCanvasMouseUp;
  canvas.ondragstart = (ev) => {
      const y = ev.offsetY;
      const h = de('editor_canvas').height;
      const edge = h * drag_gutter_pct;
      if (y > edge && y < (h-edge)) {        
        ev.dataTransfer.setData("text/plain", 255); // start drag
      } else {        
        ev.preventDefault(); // do endpoint adjustment
      }
    };
  canvas.ondragover = (ev) => {ev.preventDefault();};
  canvas.ondrop = (ev) => {
    ev.preventDefault();
    const srcId = ev.dataTransfer.getData("text/plain");
    if (srcId != "")
      copyWaveFormBetweenSlots(srcId, 255);
  };

  // tabs
  de("sample_editor_tab_button").onclick = (ev) => {switchTab(TAB_SAMPLE_EDITOR);};
  de("pattern_editor_tab_button").onclick = (ev) => {switchTab(TAB_PATTERN_EDITOR);};
  de("midi_monitor_tab_button").onclick = (ev) => {switchTab(TAB_MIDI_MONITOR);};

  // MIDI log
  de('midi_log').readonly = true;  
  de('log_clear').onclick = (ev) => { de('midi_log').innerHTML=""; }
  de('show_sysex').onclick = (ev) => { 
    settings_midi_monitor_show_sysex = de('show_sysex').checked;
    saveSettings();
  }
  
  // general window events
  window.addEventListener( "resize",  function(event) {
      resizeCanvasToParent();
      redrawAllWaveforms();
    });
  window.addEventListener( "keydown", function(e) {
      if ( e.key === " " ) {
        e.preventDefault(); // TODO this prevents space in the text edit field
        playAudio();
      } else if ( e.shiftKey == true)
        shiftDown = true;
    });
  window.addEventListener( "keyup", function(e) {
      if ( e.key.charCodeAt() == 83 )
      shiftDown = false;
    });


  loadSettings();

  // get the build #
  fetch("deploy_date.txt").then(function(response){
    response.text().then(function(text){ 
      de('deployed_date').innerText = text;
    });
  });


  navigator.requestMIDIAccess({sysex:true}).then(onMidiSuccessCallback, onMidiFailCallback);
  
  resizeCanvasToParent();
  redrawAllWaveforms();
}

// This can only be done after a user gesture on the page.
function audio_init() {
  // We are selecting 12000 Hz here in order estimate the
  // Luma-1's pitch knob position at 12-o-clock. This matters because 
  // when we drag import wav files WebAudio matches them to this audiocontext.
  if (actx == undefined)
    actx = new classAudioContext({sampleRate:12000});
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
  if (end_index == -1)
    end_index = fromAudioBuffer.length

  num_samples_to_copy = end_index - start_index;

  const audioBuffer = new AudioBuffer({
    length:num_samples_to_copy, 
    numberOfChannels:fromAudioBuffer.numberOfChannels, 
    sampleRate:fromAudioBuffer.sampleRate
  });
  for(let channelI = 0; channelI < audioBuffer.numberOfChannels; ++channelI) {
    var samples = fromAudioBuffer.getChannelData(channelI);
    samples = samples.subarray(start_index, start_index + num_samples_to_copy);

    audioBuffer.copyToChannel(samples, channelI);
  }
  return audioBuffer;
}

function cloneArrayBuffer(src)  {
  if (src == null)
    return new ArrayBuffer(0);
  var dst = new ArrayBuffer(src.byteLength);
  new Uint8Array(dst).set(new Uint8Array(src));
  return dst;
}

// Copy the audio buffer between slots. If the src is the editor window
// we want to only copy the part of the sample that is selected.
function copyWaveFormBetweenSlots(srcId, dstId) {
  if (srcId == dstId)
    return;

  if (srcId == 255) {
    // Editor --> slot (with endpointing)
    bank[dstId].audioBuffer = cloneAudioBuffer(editorAudioBuffer, 
                                                editor_in_point, editor_out_point);
    bank[dstId].name = document.getElementById('sample_name').value;
    bank[dstId].original_binary = cloneArrayBuffer(binaryFileOriginal);
  } else if (dstId == 255) {
    // Slot --> editor
    editorAudioBuffer = cloneAudioBuffer(bank[srcId].audioBuffer);
    sampleName = bank[srcId].name;
    document.getElementById('sample_name').value = sampleName;
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

  let	theSound = actx.createBufferSource();
  theSound.buffer = bank[id].audioBuffer;
  theSound.connect(actx.destination); // connect to the output

  // convert end points into seconds for playback.
  // TODO make sample rate adjustable
  theSound.start(0, 0, (theSound.buffer.length)/sampleRate);
}

// convert an arraybuffer into an AudioBuffer source ready for playback.
function convert_8b_ulaw_to_audioBuffer(arraybuf) {
  // convert ulaw into linear in the sourceAudioBuffer.
  var dv = new DataView(arraybuf);
  var newAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);
  
  //editor_out_point = dv.byteLength;
  channelData = newAudioBuffer.getChannelData(0);
  for (i=0; i<dv.byteLength; i++) {
    var ulaw = dv.getUint8(i);
    ulaw = ~ulaw;
    var sample = ulaw_to_linear(ulaw);
    sample = sample / 32768.0;
    channelData[i] = sample;
  }
  return newAudioBuffer;
}

function drawSlotWaveforms() {
  for (i=0; i<10; i++) {
    var c = document.getElementById("canvas_slot_"+i);
    drawSlotWaveformOnCanvas(c, bank[i].audioBuffer, 
          slot_names[i], bank[i].name);
    }
}

function drawSlotWaveformOnCanvas(canvas, audioBuffer, title, name = "untitled") {
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext('2d');

  // Scale the inner drawling surface to the same
  // aspect ratio as the canvas element
  canvas.width = canvas.height * 
      (canvas.clientWidth / canvas.clientHeight);

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
  else if (binaryFormat === "pcm_u8")
    loadBIN_u8b_pcm(binaryFileOriginal);

  // These are indexes into the 
  editor_in_point = 0;
  editor_out_point = editorAudioBuffer.length-1;

  trimBufferToFitLuma();
  document.getElementById('sample_name').value = sampleName;
}

function bankIdForName(name) {
  for (i=0; i<slot_names.length; i++) {
    if (name === slot_names[i])
      return i;
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
  droppedZip.loadAsync(fileReader.result).then(function(zip) {

    // First locate the bank in the zip. We can't assume order here.
    var bank_path_prefix = "";
    var found_bank = false;
    for (const [key, value] of Object.entries(zip.files)) {
      if (!value.dir && value.name[0] != '.') {
        console.log(value.name.slice(-12));
        if (value.name.slice(-12).toUpperCase() === "BANKNAME.TXT") {
          found_bank = true;
          bank_path_prefix = value.name.slice(0, -12);
          console.log("found! bank_path_prefix="+bank_path_prefix);
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

      if (!value.dir ) { //&& value.name.indexOf("t") == -1) {
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

          if (tokens[1][0] == '.')   // ignore files that begin with .
            continue;

          // uncompress the data.
          (function (bankId, filename) {
            //console.log(`full: |${name}|`);
            droppedZip.file(value.name).async("ArrayBuffer").then(function(data) {
              //console.log(`|${filename}| ${data.byteLength} bytes`);

              bank[bankId].name = filename;

              const fileext = filename.slice(-4);
              if (fileext === ".wav") {
                actx.decodeAudioData(data, function(buf) {
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
  document.getElementById('binaryFormat').removeAttribute('disabled');
  interpretBinaryFile();
}

function trimBufferToFitLuma() {
  // limit sourceAudioBuffer to kMaxSampleSize samples
  console.log("imported sample len is "+editorAudioBuffer.length);
  if (editorAudioBuffer.length >= kMaxSampleSize) {
    console.log("trim buffer to kMaxSampleSize, original_size="+editorAudioBuffer.length+" sampleRate="+
    editorAudioBuffer.sampleRate);

    // TODO : resample buffer!
    var newSampleRate = 24000;

    var newArrayBuffer = actx.createBuffer(1, kMaxSampleSize, newSampleRate);
    var anotherArray = new Float32Array(kMaxSampleSize);
    var offset = 0;

    editorAudioBuffer.copyFromChannel(anotherArray, 0, 0);
    newArrayBuffer.copyToChannel(anotherArray, 0, 0);
    
    editorAudioBuffer = newArrayBuffer;
    editor_in_point = 0;
    editor_out_point = editorAudioBuffer.length-1;
    console.log("trimmed - new len is "+editorAudioBuffer.length);
  }
  else {
    // sample is <= to the full sample size.
    // let's try padding with zeros on the end and see what that does.
    console.log("sample is "+editorAudioBuffer.length+"/"+kMaxSampleSize);

    editor_in_point = 0;
    editor_out_point = editorAudioBuffer.length-2;
  }

  resizeCanvasToParent();
  redrawAllWaveforms();
  updateStatusBar();
}

// Decode a Windows WAV file
function droppedFileLoadedWav(event) {
  document.getElementById('binaryFormat').setAttribute('disabled', true);

  actx.decodeAudioData(fileReader.result, function(buf) {
    console.log("decoded wav file: SR="+buf.sampleRate+" len="+buf.length);
    editorAudioBuffer = buf;
    editor_in_point = 0;
    editor_out_point = editorAudioBuffer.length-1;
16866326 
    trimBufferToFitLuma();
    document.getElementById('sample_name').value = sampleName;
  });
}

function dragOverHandler(ev) {
  ev.preventDefault();
}

function resizeCanvasToParent() {
  // editor canvas
  var canvas = document.getElementById('editor_canvas');
  canvas.width = canvas.parentElement.offsetWidth;

  // slot canvases
  for (i=0; i<10; i++) {
    canvas = document.getElementById("canvas_slot_"+i);
    canvas.width = canvas.height * 
                      (canvas.clientWidth / canvas.clientHeight);

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
    var canvas = document.getElementById('editor_canvas');
    const h = canvas.height;
    const w = canvas.width;
    var drag_gutter_size = h * drag_gutter_pct;

    if (editorAudioBuffer == null)
      return;

    var new_pt = (editorAudioBuffer.length * x) / w;
    if (shiftDown)
      new_pt = Math.round(new_pt / 1024) * 1024;

    if (y >= (h-drag_gutter_size)) {
      // adjust endpoint
      if (new_pt > editor_in_point)
        editor_out_point = Math.floor(new_pt);
      editor_out_point = Math.min(editorAudioBuffer.length-1, editor_out_point);
    } else if (y < drag_gutter_size) {
      // adjust inpoint
      if (new_pt < editor_out_point)
        editor_in_point = Math.floor(new_pt);
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
  for (i=0; i<len/2; i++) {
    var sample = data[i];
    data[i] = data[len-1-i];
    data[len-1-i] = sample;
  }
  redrawAllWaveforms();
}

function resetRange() {
  editor_in_point = 0;
  editor_out_point = editorAudioBuffer.length-1;
  updateStatusBar();
  redrawAllWaveforms();
}

function updateStatusBar() {
  document.getElementById('in_point').value = editor_in_point;
  document.getElementById('out_point').value = editor_out_point;
}

function redrawAllWaveforms() {
  drawEditorCanvas();
  drawSlotWaveforms();  
}

// Render the audio waveform and endpoint UI into the canvas
function drawEditorCanvas() {  
  var canvas = document.getElementById('editor_canvas');
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext('2d');

  ctx.fillStyle = editor_waveform_bg;
  ctx.fillRect(0, 0, w, h);
 
  if (editorAudioBuffer && editorAudioBuffer.length > 0) {
    ctx.strokeStyle = editor_waveform_fg;
    drawWaveform(w, h, ctx, editorAudioBuffer);
    const tab_side = 15;

    ctx.fillStyle = drag_handle_color;
    var offset = (w * editor_in_point)/editorAudioBuffer.length;
    ctx.fillRect(offset, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset+tab_side, 0);
    ctx.lineTo(offset,tab_side);
    ctx.lineTo(offset, 0);
    ctx.closePath();
    ctx.fill();

    //draw gray on first part of sample
    ctx.globalAlpha = .3;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0,0, offset, h);
    ctx.globalAlpha = 1;
    
    
    ctx.fillStyle = drag_handle_color;
    offset = (w * (editor_out_point))/editorAudioBuffer.length;
    ctx.fillRect(offset-1, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset-1-tab_side, h);
    ctx.lineTo(offset, h-tab_side);
    ctx.lineTo(offset, h);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = .3;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(offset, 0, w, h);
    ctx.globalAlpha = 1;    
  } else {
    ctx.fillStyle = slot_waveform_fg;
    ctx.textAlign = "center";
    ctx.font = "24px condensed";
    ctx.fillText("Drag a .bin (sample ROM), wav, or zip (bank archive) file here to get started.",
      w/2, h/2
    );
  }
}

function drawWaveform(w, h, ctx, buffer) {
  var data = buffer.getChannelData(0);
  ctx.beginPath();
  for(var x=0; x < w; x++) {
    var sample_idx = Math.floor((data.length * x)/w);
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
    sampleName = name.slice(0, name.length-4);
    name = name.toLowerCase();
    //console.log(`… file2[${i}].name = ${file.name}`);
    
    fileReader = new FileReader();
    if (name.slice(-4) === '.bin')
      fileReader.onload = droppedFileLoadedBIN;
    else if (name.slice(-4) === '.wav')
      fileReader.onload = droppedFileLoadedWav;
    else if (name.slice(-4) === '.zip')
      fileReader.onload = droppedFileLoadedZip;

    fileReader.readAsArrayBuffer(file);
  }
  });
}

function sendSysexToLuma(header) {
  // pack into the MIDI message
  // [f0] [69] [ulaw data] ..... [f7]
  var binaryStream = [];
  for (i=0; i<32; i++)
    binaryStream.push(header[i]); // 32b header

  // pack msg into 7bits
  var ulaw_stream_7bits = pack_sysex(binaryStream);

  // now add the sysex around it 0xf0 0x69 ulaw_stream_7bits 0xf7
  var sysx = [0xf0, 0x69];
  var sysx2 = sysx.concat(ulaw_stream_7bits);
  sysx2.push(0xf7);

  if (throttle_midi_send_ms > 0) {
    setTimeout(function(packet) {
      console.log(`sendSysexToLuma ${packet.length}`);
      midiOut.send(packet);
    }, throttle_midi_send_ms, sysx2);
  }
  else
    midiOut.send(sysx2);  
}

// only send samples from in in-out points.
// This result will need to be added to 2k, 4k, 8k, 16k, or 32k
function writeSampleToDevice(slotId = 255) {
  var numSamples = editor_out_point - editor_in_point;
  var channels = editorAudioBuffer.getChannelData(0);
  var ulaw_buffer = [];

  // Convert from float<> to g711 uLaw buffer
  for (i=0; i<numSamples; i++ ) {
    var sample = channels[editor_in_point+i] * 32768.0;
    var ulaw = linear_to_ulaw(sample);
    ulaw = ~ulaw;
    ulaw_buffer.push(ulaw);
  }

  // pack into the MIDI message
  // [f0] [69] [32 byte header] [ulaw data] ..... [f7]
  var binaryStream = [];
  for (i=0; i<32; i++)
    binaryStream.push(0x00); // 32b header

  // Offset into header
  // ----------------------
  // 0      cmd
  // 1-24   24 bytes of name
  // 25     bank Id
  // 26     slot Id
  // 27-31  padding
  binaryStream[0]  = 0x01; // write to specific slot
  binaryStream[25] = de('bankId').value;  //  bank
  binaryStream[26] = de('slotId').value;

  // pack name into offset [1]
  const kMaxChars = 24;
  sampleName = document.getElementById('sample_name').value.slice(0, kMaxChars);
  //console.log("writing "+sampleName.length+ " chars to slot "+document.getElementById('slotId').value);
  for (i=0; i<sampleName.length; i++)
    binaryStream[i+1] = sampleName.charAt(i).charCodeAt();

  // add in the ulaw data
  for (i=0; i<ulaw_buffer.length; i++)
    binaryStream.push(ulaw_buffer[i]);

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
  if (bank[slotId].audioBuffer == null)
    return;

  const fromBank = bank[slotId];
  var numSamples = fromBank.audioBuffer.length;
  var channels = fromBank.audioBuffer.getChannelData(0);
  var ulaw_buffer = [];

  // Convert from float<> to g711 uLaw buffer
  for (i=0; i<numSamples; i++ ) {
    var sample = channels[editor_in_point+i] * 32768.0;
    var ulaw = linear_to_ulaw(sample);
    ulaw = ~ulaw;
    ulaw_buffer.push(ulaw);
  }

  // pack into the MIDI message
  // [f0] [69] [32 byte header] [data] ..... [f7]
  var binaryStream = [];
  for (i=0; i<32; i++)
    binaryStream.push(0x00); // 32b header

  // Offset into header
  // ----------------------
  // 0      cmd
  // 1-24   24 bytes of name
  // 25     bank Id
  // 26     slot Id
  // 27-31  padding
  binaryStream[0]  = 0x01; // write to specific slot
  binaryStream[25] = bankId;
  binaryStream[26] = slotId;

  // pack name into offset [1]
  const kMaxChars = 24;
  sampleName = fromBank.name.slice(0, kMaxChars);
  console.log(`writing ${sampleName.length} chars to slot ${slotId} in bank ${bankId}`);
  for (i=0; i<sampleName.length; i++)
    binaryStream[i+1] = sampleName.charAt(i).charCodeAt();

  // add in the ulaw data
  for (i=0; i<ulaw_buffer.length; i++)
    binaryStream.push(ulaw_buffer[i]);

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

  let	theSound = actx.createBufferSource();
  theSound.buffer = editorAudioBuffer;
  theSound.connect(actx.destination); // connect to the output

  // convert end points into seconds for playback.
  // TODO make sample rate adjustable
  theSound.start(0, editor_in_point / sampleRate, (editor_out_point-editor_in_point)/sampleRate);
}

// convert an arraybuffer into an AudioBuffer source ready for playback.
function loadBIN_u8b_pcm(arraybuf) {
  dv = new DataView(arraybuf);
  editorAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);
  editor_out_point = dv.byteLength;
  channelData = editorAudioBuffer.getChannelData(0);
  for (i=0; i<dv.byteLength; i++) {
    var sample = dv.getUint8(i); // unsigned 8bit
    sample -= 128;
    sample = sample / 128.0;
    channelData[i] = sample;
  }
}

// Writes all samples in the bank[] data structure to the device.
function writeBankToDevice() {
  const bankId = de('bankId2').value;

  // Write the bank name
  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);
  buf[0] = CMD_UTIL | 0x08;
  buf[25] = de('ram_bankId').value;
  buf[26] = SX_RAM_BANK_NAME;
  const kMaxChars = 24;
  sampleName = de('bank_name').value.slice(0, kMaxChars);
  for (i=0; i<sampleName.length; i++)
    buf[i+1] = sampleName.charAt(i).charCodeAt();

  sendSysexToLuma(buf);

  // write the slots
  const write_order = [DRUM_CONGA, DRUM_TOM, DRUM_SNARE, DRUM_BASS,
    DRUM_HIHAT, DRUM_COWBELL, DRUM_CLAPS, DRUM_CLAVE, DRUM_TAMB, DRUM_CABASA];
  for (idx=0; idx<write_order.length; idx++) {
    var slotId = write_order[idx];
    console.log(`writing slot ${slotId} in bank ${bankId}`);
    writeSampleToDeviceSlotBank(slotId, bankId);
  }

}

// reads all samples from the bank in the 'bankid2' field.
function readBankfromDevice() {
  audio_init(); // may not have been called

  reading_banks = true;
  reading_banks_id = document.getElementById('bankId2').value;
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

  var slotId = document.getElementById('slotId').selectedIndex;
  var bankId = document.getElementById('bankId').value;
  console.log("bankid = " + bankId)

  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);

  // struct from LM_MIDI.ino
  buf[0] = CMD_SAMPLE | 0x08;
  buf[25] = bankId;
  buf[26] = slotId;

  sendSysexToLuma(buf);
}

function changeBinFormat(event) {
  binaryFormat = document.getElementById('binaryFormat').value;
  interpretBinaryFile();
}

// Download this arraybuffer to the local computer as a binary file
function saveLocalByteAray(name, buffer) {
  var blob = new Blob([buffer], {type: "application/octet-stream"});
  console.log("blob size is "+ blob.size);
  var link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  var fileName = name;
  link.download = fileName;
  link.click();
}

// Encode and download sample as a WAV file to local file system
function exportSample() {
  audio_init(); // may not have been called
  var channelData = editorAudioBuffer.getChannelData(0);

  var encoder = new WavAudioEncoder(sampleRate, 1);
  encoder.encode([channelData]);
  var blob = encoder.finish();

  var link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = sampleName + ".wav";
  link.click();
}

// Ask Luma to send the pattern block
function readRAMfromDevice() {
  audio_init();

  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);
  buf[0] = CMD_RAM_BANK | 0x08;
  buf[25] = de('ram_bankId').value;

  sendSysexToLuma(buf);
}

function downloadRAMBuffer() {

  var ram_blob = new Blob([ram_buffer]);

  var link = document.createElement('a');
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
  const note_names = [" C", "C#", " D", "D#", " E", " F", "F#", " G", "G#", " A", "A#", " B"];
  var octave = note / 12;
  var note_in_octave = note % 12;
  str = note_names[note_in_octave];
  str += (octave+1).toFixed(0);
  return str;
}

function CCtoName(num) {
  switch (num) {
    case 0: return "sound bank MSB";
    case 1: return "mod wheel";
    case 7: return "volume level";
    case 10: return "panoramic";
    case 11: return "expression";
    case 32: return "sound bank LSB";
    case 64: return "sustain pedal";
  }
  return num;
}

function formatMidiLogString(event) {
  if ((event.data[0] == 0xf0) && !settings_midi_monitor_show_sysex)
    return "";

  const date = new Date();
  const dateString = date.getUTCHours() + ":"
   + date.getMinutes() + ":" + date.getSeconds() + "." +
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
    str += "Note ON  " + noteNumberToString(d[1]) + " vel="+d[2];
  else if (midi_cmd == 0x80)
    str += "Note OFF " + noteNumberToString(d[1]) + " vel="+d[2];
  else if (midi_cmd == 0xb0)
    str += "CC controller=" + CCtoName(d[1]) + " value=" + d[2];
  else if (midi_cmd == 0xe0)
    str += "Pitch bend ";
  else if (midi_cmd == 0xe0)
    str += "Pitch bend ";

  return str;
}

// ----------------------------------------------------------------------------
// WebMIDI routines

function onMidiFailCallback(err) {
  console.log(`WebMIDI failed to initialize: ${err.code}`);
  document.getElementById('midiFailed').style.display='block';
}

function onMIDIMessageReceived(event) {

  let str = formatMidiLogString(event);
  if (str != "") {
    const midi_log = de('midi_log');
    midi_log.innerHTML += `${str} \n`;
    midi_log.scrollTop = midi_log.scrollHeight;
  }

  console.log(`onMIDIMessageReceived ${event.data.length} bytes`);
  console.log(`last byte is ${event.data[event.data.length-1].toString(16)}`);

  if (event.data[0] == 0xf0) {
    // Unpack the Sysex to figure out what we received.
    // skip first two and last bytes

    const decoder = new TextDecoder();
    console.log(`event.data MIDI In = ${event.data.length} bytes`);
    var data = Uint8Array.from(unpack_sysex(event.data.slice(2, event.data.length-1)));
    var type = data[0];
    if (type == 0x01 || type == 0x09) { // 0x01 or 0x09 for samples
      // header 32 bytes
      // [0] cmd
      // [1-23] name
      // [25] bank
      // [26] slot
      var name = data.slice(1, 24);
      var name_len = 0;
      for (var i=0; i<name.length; i++) {
        if (name[i] == 0) {
          break;
        }
        name_len++;
      }
      sampleName = decoder.decode(name.slice(0, name_len));
      console.log(sampleName);
      document.getElementById('sample_name').value = sampleName;
      var ulaw_data = data.slice(32);
      var ulaw_data_ab = arrayToArrayBuffer(ulaw_data);
      var newAudioBuffer = convert_8b_ulaw_to_audioBuffer(ulaw_data_ab);
      

      if (reading_banks) {
        // copy the sample to the appropriate slot.        
        //copyWaveFormBetweenSlots(255, reading_banks_current_slot);

        bank[reading_banks_current_slot].audioBuffer = 
              cloneAudioBuffer(newAudioBuffer);
        bank[reading_banks_current_slot].name = 
              document.getElementById('sample_name').value;
        bank[reading_banks_current_slot].original_binary = 
              cloneArrayBuffer(ulaw_data_ab);

        reading_banks_current_slot++;
        if (reading_banks_current_slot < slot_names.length)
          readNextSampleInBank();
        else
          reading_banks = false;

      } else {
        editor_out_point = newAudioBuffer.length;

        editorAudioBuffer = newAudioBuffer;
        binaryFileOriginal = ulaw_data_ab; // save the binary stream 
      }

      resizeCanvasToParent();
      redrawAllWaveforms();
      updateStatusBar();

    }
    else if (type == CMD_UTIL) {
      var data = Uint8Array.from(unpack_sysex(event.data.slice(2, event.data.length-1)));
      var enc = new TextDecoder("utf-8");

      switch (data[26]) {
        case SX_TEENSY_VERSION:
          {
            luma_firmware_version = enc.decode(data.slice(1, 25));
            document.getElementById('firmware_version').innerHTML = luma_firmware_version;
          }
          break;

        case SX_SERIAL_NUMBER:
          luma_serial_number = enc.decode(data.slice(1, 25));
          de('serial_number').innerHTML = luma_serial_number;
          break;

        case SX_RAM_BANK_NAME:
          console.log(("SX_RAM_BANK_NAME received"))
          break;

        case SX_VOICE_BANK_NAME:
          console.log(("SX_VOICE_BANK_NAME received"))
          bank_name = enc.decode(data.slice(1, 25));
          de('bank_name').value = bank_name;
          break;
      }
    }
    else if (type == CMD_RAM_BANK) {
      console.log(`CMD_RAM_BANK ${event.data.length} bytes`);
      var el = de('ram_editor');
      ram_buffer = data.slice(32);
      var format = {
        width:16,
        html: false,
        format:"twos",
      };
      el.innerText = hexy(ram_buffer, format);
    }
    else  {
      console.log("unsupported Luma packet type=" + type);
    }
  }
}

// A MIDI device was attached to or detacted from the computer.
function refreshMidiDeviceList(event) {
  var midiSelectElement = de("midi_out_device");

  midiSelectElement.innerHTML = "";

  let 
    outputs = midiAccess.outputs;
    inputs = midiAccess.inputs;

  midiSelectElement.options.add(new Option("NO MIDI Connection", "NONE", false, false));

  // Add ports to the UI picker. If we have selected one in the past, set it again
  outputs.forEach((port) => {
      midiSelectElement.options.add(new Option(port.name, port.fingerprint, false, false));
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
        midiIn.onmidimessage  = onMIDIMessageReceived;
      }
    });
  }

}

function generateRamp() {
  var value = 0;
  var data = editorAudioBuffer.getChannelData(0);
  for( var i=0; i<editorAudioBuffer.length; i++) {
      data[i] = value;
      value = value + 0.01;
      if (value > 1)
        value = 0;
  }

  redrawAllWaveforms();
}

// User changed MIDI device
function userChangedMIDIOutDevice(event) {
    let
        outputs = midiAccess.outputs, 
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
        midiIn.onmidimessage  = onMIDIMessageReceived;
      }
    });
}

function onMidiSuccessCallback(access) {
  midiAccess = access;

  // We are going to only list the MIDI out device
  // and then look for the MIDI in to connect as well. I supose
  // ideally we'd show separate IN and OUT selects?
  var selectMidiOut = de("midi_out_device");
  
  access.onstatechange = (event) => { refreshMidiDeviceList(); }
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
  if (filename.indexOf('.') >= 0)
    return filename.split('.').slice(0, -1).join('.')

  return filename;
}


// Writes all samples in the bank[] data structure to the device.
function exportBankAsRom() {
  var bank_name = de("bank_name").value;

  var blob = new Blob();
  var dataView = new DataView(blob);

  let offset = 0;
  for (let i = 0; i < slot_names.length; i++) {
    let sample = bank[i].audioBuffer;

    if (sample == null) continue;

    let sampleData = sample.getChannelData(0);
    let sampleLength = sampleData.length;

    if (sampleLength > 16384) {
      console.log(
        "truncating sample " + i + " from " + sampleLength + " to 16384",
      );
      // truncate
    } else if (sampleLength < 16384) {
      console.log(
        "padding sample " + i + " from " + sampleLength + " to 16384",
      );
    }

    let sampleBuffer = new Float32Array(16384);

    for (let j = 0; j < 16384; j++) {
      if (j < sampleLength) {
        sampleBuffer[j] = sampleData[j];
      } else {
        sampleBuffer[j] = 0.0; // Pad with zeros
      }
    }

    // Copy float32 array to Uint8Array for Blob
    let uint8Array = new Uint8Array(sampleBuffer.length * 4);
    for (let j = 0; j < sampleBuffer.length; j++) {
      uint8Array[j * 4] = (sampleBuffer[j] >>> 24) & 0xff;
      uint8Array[j * 4 + 1] = (sampleBuffer[j] >>> 16) & 0xff;
      uint8Array[j * 4 + 2] = (sampleBuffer[j] >>> 8) & 0xff;
      uint8Array[j * 4 + 3] = sampleBuffer[j] & 0xff;
    }
    blob.append(uint8Array);
  }

  if (blob.size != 131072) {
    console.log("Error: Bank size is not 128k. Actual size: " + blob.size);
  }

  var link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.download = bank_name + ".BIN";
  link.click();
}

// Add all the waveforms from the slots into a zip file and download it.
function exportBankAsZip() {
  var bank_name = de('bank_name').value;

  var zip = new JSZip();

  zip.file("BANKNAME.TXT", bank_name);

  for (i=0; i<slot_names.length; i++) {
    console.log("slot "+i);
    const slot_name = slot_names[i];
    const sample_name_base = trim_filename_ext(bank[i].name);
    if (bank[i].original_binary != null) {
      //console.log(bank[i].original_binary);
      if ( bank[i].original_binary.byteLength > 0 ) {
        // export original binary
        // console.log(bank[i].original_binary);
        zip.folder(slot_name).file(sample_name_base + ".bin", bank[i].original_binary);  
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
  
  zip.generateAsync({type: "blob"}).then(function (blob_) {
    console.log("here2");
    var link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob_);
    link.download = bank_name + ".zip";
    link.click();
  });
}

function loadSettings() {
  settings_midiDeviceName = localStorage.getItem("midiOutPortName");
  if (localStorage.getItem("monitorShowSysex") == "true")
    settings_midi_monitor_show_sysex = true;
  else
  settings_midi_monitor_show_sysex = false;
  de('show_sysex').checked = settings_midi_monitor_show_sysex;
}

function saveSettings() {
  localStorage.setItem("midiOutPortName", settings_midiDeviceName);
  localStorage.setItem("monitorShowSysex", settings_midi_monitor_show_sysex);
}
