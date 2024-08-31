"Copyright 2023-2024 Greg Simon"

// globals
const classAudioContext = window.AudioContext || window.webkitAudioContext;
var actx; // AudioContext
var sourceAudioBuffer; // AudioBuffer (active sample)
var midiAccess = null;
var midiOut = null;
var midiIn = null;
var fileReader;
var editor_in_point = 0;
var editor_out_point = 0;
var sampleRate = 24000; // Hz
var sampleName = "untitled";
var shiftDown = false;
var binaryFileOriginal = null; // Original raw bytes of loaded sample
var binaryFormat = "ulaw_u8";
var kMaxSampleSize = 32768;
var bank = []; // Hold the state of each slot
var bank_name = "Untitled";
const drag_gutter_pct = 0.10;

// settings vars that are persisted locally on computer
var settings_midiDeviceName = "";

// send/receive device command IDs
const CMD_SAMPLE = 0x00;
const CMD_SAMPLE_BANK = 0x01;
const CMD_RAM_BANK = 0x02;
const CMD_PARAM = 0x04;
const CMD_UTIL = 0x05;
const CMD_REQUEST = 0x08;

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
const DRUM_CLAVE = 9

const slot_names = ["BASS", "SNARE", "HIHAT", "CLAPS",
  "CABASA", "TAMB", "TOM", "CONGA", "COWBELL", "RIMSHOT"];

// State during read banks. We need to chain together a number
// of sample request callbacks.
var reading_banks = false;            // are we reading banks?
var reading_banks_id;                 // 255, 0-99
var reading_banks_current_slot = 0;   // what slot to drop the sample in when it arrives

// Used to pad number strings with 0s
Number.padLeft = (nr, len = 2, padChr = `0`) => 
  `${nr < 0 ? `-` : ``}${`${Math.abs(nr)}`.padStart(len, padChr)}`;

// Initialize the application.
function luma1_init() {

  // wire up the slot waveforms
  for (i=0; i<slot_names.length; i++) {
    (function(i) {
      bank.push({
        id: i,
        title: "untitled",
        original_binary: null,
        audioBuffer: null
      });
      var el = document.getElementById("canvas_slot_"+i);
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
  let populate_bank_select = function(el) {
    var opt = document.createElement('option');
    opt.value = 255;
    opt.innerHTML = "STAGING";
    el.appendChild(opt);  
    for (i=0; i<=99; i++) {
      opt = document.createElement('option');
      opt.value = i;
      opt.innerHTML = Number.padLeft(i);
      el.appendChild(opt);
    }
  };
  populate_bank_select(document.getElementById('bankId'));
  populate_bank_select(document.getElementById('bankId2'));

  // populate the slot field
  let populate_slot_select = function(el) {
    for (i=0; i<=slot_names.length; i++) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.innerHTML = slot_names[i];
      el.appendChild(opt);
    }
  };
  populate_slot_select(document.getElementById('slotId'));

  // setup main waveform editor
  var canvas = document.getElementById('editor_canvas');
  canvas.draggable = true;
  canvas.onmousedown = onEditorCanvasMouseDown;
  canvas.onmousemove = onEditorCanvasMouseMove;
  canvas.onmouseup = onEditorCanvasMouseUp;
  canvas.onmouseleave = onEditorCanvasMouseUp;
  canvas.ondragstart = (ev) => {
      const y = ev.offsetY;
      const h = document.getElementById('editor_canvas').height;
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
    copyWaveFormBetweenSlots(srcId, 255);
  };
  
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

  navigator.requestMIDIAccess({sysex:true}).then(onMidiSuccessCallback, onMidiFailCallback);

  resizeCanvasToParent();
  drawSlotCanvases();
}

// This can only be done after a user gesture on the page.
function audio_init() {
  // We are selecting 12000 Hz here in order estimate the
  // Luma-1's pitch knob position at 12-o-clock. This matters because 
  // when we drag import wav files WebAudio matches them to this audiocontext.
  if (actx == undefined)
    actx = new classAudioContext({sampleRate:12000});
}

// Copy a webAudio buffer object, optionally endpointing the source.
function cloneAudioBuffer(fromAudioBuffer, start_index = 0, end_index = -1) {
  if (end_index == -1)
    end_index = fromAudioBuffer.length

  num_samples_to_copy = end_index - start_index;
  console.log("num_samples_to_copy="+num_samples_to_copy)

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

// Copy the audio buffer between slots. If the src is the editor window
// we want to only copy the part of the sample that is selected.
function copyWaveFormBetweenSlots(srcId, dstId) {
  if (srcId == dstId)
    return;

  if (srcId == 255) {
    // Editor --> slot (with endpointing)
    bank[dstId].audioBuffer = cloneAudioBuffer(sourceAudioBuffer, 
                                                editor_in_point, editor_out_point);
    bank[dstId].name = document.getElementById('sample_name').value;
    bank[dstId].original_binary = binaryFileOriginal;
  } else if (dstId == 255) {
    // Slot --> editor
    sourceAudioBuffer = cloneAudioBuffer(bank[srcId].audioBuffer);
    sampleName = bank[srcId].name;
    document.getElementById('sample_name').value = sampleName;
    binaryFileOriginal = bank[srcId].original_binary;
    resetRange();
  } else {
    // Slot --> Slot
    bank[dstId].audioBuffer = cloneAudioBuffer(bank[srcId].audioBuffer);
    bank[dstId].name = bank[srcId].name;
    bank[dstId].original_binary = bank[srcId].original_binary;
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
function loadBIN_8b_ulaw(arraybuf) {
  dv = new DataView(arraybuf);

  // convert ulaw into linear in the sourceAudioBuffer.
  sourceAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);
  editor_out_point = dv.byteLength;
  channelData = sourceAudioBuffer.getChannelData(0);
  for (i=0; i<dv.byteLength; i++) {
    var ulaw = dv.getUint8(i);
    ulaw = ~ulaw;
    var sample = ulaw_to_linear(ulaw);
    sample = sample / 32768.0;
    channelData[i] = sample;
  }
}

function drawSlotCanvases() {
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

  ctx.fillStyle = "rgb(40, 40, 40)"
  ctx.fillRect(0, 0, w, h);
  
  if (audioBuffer && audioBuffer.length > 0) {
    ctx.strokeStyle = "rgb(46, 155, 214)"
    drawWaveform(w, h, ctx, audioBuffer);
    const tab_side = 15;
  }

  ctx.fillStyle = "rgb(46, 155, 214)";
  ctx.textAlign = "right";
  ctx.font = "24px local_oswald";
  ctx.fillText(name + " : " + title + " ", w, 24);
}

// -- Loading handlers

// File data is loaded/cached in binaryFileOriginal - 
// interpret it based on 'binaryFormat'
function interpretBinaryFile() {

  if (binaryFormat === "ulaw_u8")
    loadBIN_8b_ulaw(binaryFileOriginal);
  else if (binaryFormat === "pcm_u8")
    loadBIN_u8b_pcm(binaryFileOriginal);

  // These are indexes into the 
  editor_in_point = 0;
  editor_out_point = sourceAudioBuffer.length-1;

  trimBufferToFitLuma();
  document.getElementById('sample_name').value = sampleName;
}

// A zip file was dropped, presumably holding individual .wav files
// for each of the slots.
function droppedFileLoadedZip(event) {

}

// Binary stream - could be any number of formats.
function droppedFileLoadedBIN(event) { 
  binaryFileOriginal = fileReader.result; // save original so we can re-interpret it.
  document.getElementById('binaryFormat').removeAttribute('disabled');
  interpretBinaryFile();
}

function trimBufferToFitLuma() {
  // limit sourceAudioBuffer to kMaxSampleSize samples
  console.log("imported sample len is "+sourceAudioBuffer.length);
  if (sourceAudioBuffer.length >= kMaxSampleSize) {
    console.log("trim buffer to kMaxSampleSize, original_size="+sourceAudioBuffer.length+" sampleRate="+
    sourceAudioBuffer.sampleRate);

    // TODO : resample buffer!
    var newSampleRate = 24000;

    var newArrayBuffer = actx.createBuffer(1, kMaxSampleSize, newSampleRate);
    var anotherArray = new Float32Array(kMaxSampleSize);
    var offset = 0;

    sourceAudioBuffer.copyFromChannel(anotherArray, 0, 0);
    newArrayBuffer.copyToChannel(anotherArray, 0, 0);
    
    sourceAudioBuffer = newArrayBuffer;
    editor_in_point = 0;
    editor_out_point = sourceAudioBuffer.length-1;
    console.log("trimmed - new len is "+sourceAudioBuffer.length);
  }
  else {
    // sample is <= to the full sample size.
    // let's try padding with zeros on the end and see what that does.
    console.log("sample is "+sourceAudioBuffer.length+"/"+kMaxSampleSize);

    editor_in_point = 0;
    editor_out_point = sourceAudioBuffer.length-2;
  }

  resizeCanvasToParent();
  drawWaveformCanvas();
  updateStatusBar();
  
}

// Decode a Windows WAV file
function droppedFileLoadedWav(event) {
  document.getElementById('binaryFormat').setAttribute('disabled', true);

  actx.decodeAudioData(fileReader.result, function(buf) {
    console.log("decoded wav file: SR="+buf.sampleRate+" len="+buf.length);
    sourceAudioBuffer = buf;
    editor_in_point = 0;
    editor_out_point = sourceAudioBuffer.length-1;

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

    var new_pt = (sourceAudioBuffer.length * x) / w;
    if (shiftDown)
      new_pt = Math.round(new_pt / 1024) * 1024;

    if (y >= (h-drag_gutter_size)) {
      // adjust endpoint
      if (new_pt > editor_in_point)
        editor_out_point = Math.floor(new_pt);
      editor_out_point = Math.min(sourceAudioBuffer.length-1, editor_out_point);
    } else if (y < drag_gutter_size) {
      // adjust inpoint
      if (new_pt < editor_out_point)
        editor_in_point = Math.floor(new_pt);
      editor_in_point = Math.max(0, editor_in_point);
    } else {
      // TODO : initiate a drag
    }
    updateStatusBar();
    drawWaveformCanvas();
  }
}

function onEditorCanvasMouseUp(event) {
  editorCanvasMouseIsDown = false;
}

function reverseSampleBuffer() {
  var len = sourceAudioBuffer.length;
  var data = sourceAudioBuffer.getChannelData(0);
  for (i=0; i<len/2; i++) {
    var sample = data[i];
    data[i] = data[len-1-i];
    data[len-1-i] = sample;
  }
  redrawAllWaveforms();
}

function resetRange() {
  editor_in_point = 0;
  editor_out_point = sourceAudioBuffer.length-1;
  updateStatusBar();
  redrawAllWaveforms();
}

function updateStatusBar() {
  document.getElementById('in_point').value = editor_in_point;
  document.getElementById('out_point').value = editor_out_point;
  document.getElementById('status').innerText = 
    sourceAudioBuffer.length+" samples total, "+(editor_out_point-editor_in_point+1)+" samples selected";
}

function redrawAllWaveforms() {
  drawSlotCanvases();
  drawWaveformCanvas();
}

// Render the audio waveform and endpoint UI into the canvas
function drawWaveformCanvas() {
  
  var canvas = document.getElementById('editor_canvas');
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext('2d');

  ctx.fillStyle = "rgb(40, 40, 40)"
  ctx.fillRect(0, 0, w, h);
  
  if (sourceAudioBuffer && sourceAudioBuffer.length > 0) {
    ctx.strokeStyle = "rgb(46, 155, 214)"
    drawWaveform(w, h, ctx, sourceAudioBuffer);
    const tab_side = 15;

    ctx.fillStyle = "rgb(200,200,200)";
    var offset = (w * editor_in_point)/sourceAudioBuffer.length;
    ctx.fillRect(offset, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset-tab_side, 0);
    ctx.lineTo(offset+tab_side, 0);
    ctx.lineTo(offset, tab_side);
    ctx.lineTo(offset-tab_side, 0);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = "rgb(200,200,200)";
    offset = (w * (editor_out_point))/sourceAudioBuffer.length;
    ctx.fillRect(offset-1, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset-1-tab_side, h);
    ctx.lineTo(offset, h-tab_side);
    ctx.lineTo(offset+tab_side, h);
    ctx.lineTo(offset-1-tab_side, h);
    ctx.closePath();
    ctx.fill();
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
      fileReaderonload = droppedFileLoadedZip;

    fileReader.readAsArrayBuffer(file);
  }
  });
}


function sendSysexToLuma(header) {
  // pack into the MIDI message
  // [f0] [69] [32 byte header] [ulaw data] ..... [f7]
  var binaryStream = [];
  for (i=0; i<32; i++)
    binaryStream.push(header[i]); // 32b header

  // pack msg into 7bits
  var ulaw_stream_7bits = pack_sysex(binaryStream);

  // now add the sysex around it 0xf0 0x69 ulaw_stream_7bits 0xf7
  var sysx = [0xf0, 0x69];
  var sysx2 = sysx.concat(ulaw_stream_7bits);
  sysx2.push(0xf7);

  midiOut.send(sysx2);
}

// only send samples from in in-out points.
// This result will need to be added to 2k, 4k, 8k, 16k, or 32k
function sendEditorSampleToLuma() {
  var numSamples = editor_out_point - editor_in_point;
  var channels = sourceAudioBuffer.getChannelData(0);
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
  binaryStream[25] = 255;  // staging bank
  binaryStream[26] = document.getElementById('slotId').value;

  // pack name into offset [1]
  const kMaxChars = 24;
  sampleName = document.getElementById('sample_name').value.slice(0, kMaxChars);
  console.log("writing "+sampleName.length+ " chars to slot "+document.getElementById('slotId').value);
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
  theSound.buffer = sourceAudioBuffer;
  theSound.connect(actx.destination); // connect to the output

  // convert end points into seconds for playback.
  // TODO make sample rate adjustable
  theSound.start(0, editor_in_point / sampleRate, (editor_out_point-editor_in_point)/sampleRate);
}

// convert an arraybuffer into an AudioBuffer source ready for playback.
function loadBIN_8b_ulaw(arraybuf) {
  dv = new DataView(arraybuf);

  // convert ulaw into linear in the sourceAudioBuffer.
  sourceAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);
  editor_out_point = dv.byteLength;
  channelData = sourceAudioBuffer.getChannelData(0);
  for (i=0; i<dv.byteLength; i++) {
    var ulaw = dv.getUint8(i);
    ulaw = ~ulaw;
    var sample = ulaw_to_linear(ulaw);
    sample = sample / 32768.0;
    channelData[i] = sample;
  }
}

// convert an arraybuffer into an AudioBuffer source ready for playback.
function loadBIN_u8b_pcm(arraybuf) {
  dv = new DataView(arraybuf);
  sourceAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);
  editor_out_point = dv.byteLength;
  channelData = sourceAudioBuffer.getChannelData(0);
  for (i=0; i<dv.byteLength; i++) {
    var sample = dv.getUint8(i); // unsigned 8bit
    sample -= 128;
    sample = sample / 128.0;
    channelData[i] = sample;
  }
}


// reads all samples from the bank in the 'bankid2' field.
function readBank() {
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
  buf[25] = bankId;
  buf[26] = reading_banks_current_slot;
  sendSysexToLuma(buf);
}

// Ask Luma to send the sample buffer
function requestDeviceSample() {
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
  var channelData = sourceAudioBuffer.getChannelData(0);

  var encoder = new WavAudioEncoder(sampleRate, 1);
  encoder.encode([channelData]);
  var blob = encoder.finish();

  var link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = sampleName + ".wav";
  link.click();
}

// Ask Luma to send the pattern block
function requestReadPattern() {
  audio_init();

  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);

  buf[0] = CMD_RAM_BANK | 0x08;

  sendSysexToLuma(buf);
}

// ----------------------------------------------------------------------------
// WebMIDI routines

function onMidiFailCallback(err) {
  console.log("WebMIDI failed to initialize: " + err.code);
  document.getElementById('midiFailed').style.display='block';
}

function onMidiMessageReceived(event) {
  let str = `MIDI msg received at timestamp ${event.timeStamp}[${event.data.length} bytes]: `;
  for (const character of event.data) {
    str += `0x${character.toString(16)} `;
  }
  console.log(str);

  if (event.data[0] == 0xf0) {
    // Unpack the Sysex to figure out what we received.
    // skip first two and last bytes

    const decoder = new TextDecoder();
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
      loadBIN_8b_ulaw(ulaw_data_ab);
      resizeCanvasToParent();
      redrawAllWaveforms();
      updateStatusBar();

      if (reading_banks) {
        // copy the sample to the appropriate slot.        
        copyWaveFormBetweenSlots(255, reading_banks_current_slot);
        reading_banks_current_slot++;
        if (reading_banks_current_slot < slot_names.length)
          readNextSampleInBank();
        else
          reading_banks = false;
      }
    }
    else  {
      console.log("unsupported Luma packet type=" + type);
    }
  }

}

// User changed MIDI device
function changeMIDIOutCallback(event) {
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
        midiIn.onmidimessage  = onMidiMessageReceived;
      }
    });
}

function onMidiSuccessCallback(inMidiAccess) {
  midiAccess = inMidiAccess;
  var selectMidiOut = document.getElementById("midiOut");

  let 
    outputs = midiAccess.outputs;
    inputs = midiAccess.inputs;

  // Add ports to the UI picker. If we have selected one in the past, set it again
  outputs.forEach((port) => {
      selectMidiOut.options.add(new Option(port.name, port.fingerprint, false, false));
  });
  selectMidiOut.onchange = changeMIDIOutCallback;
  selectMidiOut.selectedIndex = 0;

  // Load the last used MIDI port, if one was set.
  if (selectMidiOut.value != undefined) {
    selectMidiOut.value = settings_midiDeviceName;
    outputs.forEach((port) => {
      if (0 == port.name.localeCompare(settings_midiDeviceName)) {
        midiOut = port;
      }
    });

    // find the midi input port using the output device name 
    inputs.forEach((port) => {
      if (0 == port.name.localeCompare(settings_midiDeviceName)) {
        midiIn = port;
        midiIn.onmidimessage  = onMidiMessageReceived;
      }
    });
  }
}

function loadSettings() {
  settings_midiDeviceName = localStorage.getItem("midiOutPortName");
}

function saveSettings() {
  localStorage.setItem("midiOutPortName", settings_midiDeviceName);
}
