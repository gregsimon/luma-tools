"Copyright 2023-2024 The Luma-1 Project Authors"

// globals
const AudioContext = window.AudioContext || window.webkitAudioContext;
var actx; // AudioContext
var sourceAudioBuffer; // AudioBuffer (active sample)
var midiAccess = null;
var midiOut = null;
var midiIn = null;
var fileReader;
var in_point = 0;
var out_point = 0;
var sampleRate = 24000; // Hz
var sampleName = "untitled";
var shiftDown = false;
var binaryFileOriginal = null; // Original raw bytes of loaded sample
var binaryFormat = "ulaw_u8";

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

// Initialize the application.
function luma1_init() {
  loadSettings();

  navigator.requestMIDIAccess({sysex:true}).then(onMidiSuccessCallback, onMidiFailCallback);

  var canvas = document.getElementById('waveform_canvas');
  canvas.onmousedown = onCanvasMouseDown;
  canvas.onmousemove = onCanvasMouseMove;
  canvas.onmouseup = onCanvasMouseUp;
  canvas.onmouseleave = onCanvasMouseUp;

  window.addEventListener( "resize",  function(event) {
      resizeCanvasToParent();
      drawWaveformCanvas();
    });
  window.addEventListener( "keydown", function(theKey) {
      if ( theKey.key === " " )
        playAudio();
      else if ( theKey.shiftKey == true)
        shiftDown = true;
    });
  window.addEventListener( "keyup", function(theKey) {
      if ( theKey.key.charCodeAt() == 83 )
      shiftDown = false;
    });
}

// This can only be done after a user gesture on the page.
function audio_init() {
  if (actx == undefined)
    actx = new AudioContext;
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
  in_point = 0;
  out_point = sourceAudioBuffer.length-1;

  resizeCanvasToParent();
  drawWaveformCanvas();
  updateStatusBar();
  document.getElementById('sample_name').value = sampleName;
}

// Binary stream - could be any number of formats.
function droppedFileLoadedBIN(event) { 
  binaryFileOriginal = fileReader.result; // save original so we can re-interpret it.
  document.getElementById('binaryFormat').removeAttribute('disabled');
  interpretBinaryFile();
}

// Decode a Windows WAV file
function droppedFileLoadedWav(event) {
  document.getElementById('binaryFormat').setAttribute('disabled', true);

  console.log("droppedFileLoadedWav " + fileReader.result);
  actx.decodeAudioData(fileReader.result, function(buf) {
    sourceAudioBuffer = buf;
    in_point = 0;
    out_point = sourceAudioBuffer.length-1;

    resizeCanvasToParent();
    drawWaveformCanvas();
    updateStatusBar();
    document.getElementById('sample_name').value = sampleName;
  });
}

function dragOverHandler(ev) {
  ev.preventDefault();
}

function resizeCanvasToParent() {
  var canvas = document.getElementById('waveform_canvas');
  canvas.width = canvas.parentElement.offsetWidth;
}

var canvasMouseIsDown = false;
function onCanvasMouseDown(event) {
  canvasMouseIsDown = true;
}

function onCanvasMouseMove(event) {
  if (canvasMouseIsDown) {
    var x = event.offsetX;
    var y = event.offsetY;
    var canvas = document.getElementById('waveform_canvas');
    var h = canvas.height;
    var w = canvas.width;

    var new_pt = (sourceAudioBuffer.length * x) / w;
    if (shiftDown)
      new_pt = Math.round(new_pt / 1024) * 1024;

    if (y > (h/2)) {
      // adjust endpoint
      if (new_pt > in_point)
        out_point = Math.floor(new_pt);
      out_point = Math.min(sourceAudioBuffer.length-1, out_point);
    } else {
      // adjust inpoint
      if (new_pt < out_point)
        in_point = Math.floor(new_pt);
      in_point = Math.max(0, in_point);
    }
    updateStatusBar();
    drawWaveformCanvas();
  }
}

function onCanvasMouseUp(event) {
  canvasMouseIsDown = false;
}

function reverseSampleBuffer() {
  var len = sourceAudioBuffer.length;
  var data = sourceAudioBuffer.getChannelData(0);
  for (i=0; i<len/2; i++) {
    var sample = data[i];
    data[i] = data[len-1-i];
    data[len-1-i] = sample;
  }
  drawWaveformCanvas();
}

function resetRange() {
  in_point = 0;
  out_point = sourceAudioBuffer.length-1;
  updateStatusBar();
  drawWaveformCanvas();
}

function updateStatusBar() {
  document.getElementById('in_point').value = in_point;
  document.getElementById('out_point').value = out_point;
  document.getElementById('status').innerText = 
    sourceAudioBuffer.length+" samples total, "+(out_point-in_point+1)+" samples selected";
}

// Render the audio waveform and endpoint UI into the canvas
function drawWaveformCanvas() {
  var canvas = document.getElementById('waveform_canvas');
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
    var offset = (w * in_point)/sourceAudioBuffer.length;
    ctx.fillRect(offset, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset-tab_side, 0);
    ctx.lineTo(offset+tab_side, 0);
    ctx.lineTo(offset, tab_side);
    ctx.lineTo(offset-tab_side, 0);
    ctx.closePath();
    ctx.fill();
    
    ctx.fillStyle = "rgb(200,200,200)";
    offset = (w * (out_point))/sourceAudioBuffer.length;
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
    console.log(`… file2[${i}].name = ${file.name}`);
    
    fileReader = new FileReader();
    if (name.slice(-4) === '.bin')
      fileReader.onload = droppedFileLoadedBIN;
    else if (name.slice(-4) === '.wav')
      fileReader.onload = droppedFileLoadedWav;

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
function sendToLuma() {
  var numSamples = out_point - in_point;
  var channels = sourceAudioBuffer.getChannelData(0);
  var ulaw_buffer = [];

  // Convert from float<> to g711 uLaw buffer
  for (i=0; i<numSamples; i++ ) {
    var sample = channels[in_point+i] * 32768.0;
    var ulaw = linear_to_ulaw(sample);
    ulaw = ~ulaw;
    ulaw_buffer.push(ulaw);
  }

  // pack into the MIDI message
  // [f0] [69] [32 byte header] [ulaw data] ..... [f7]
  var binaryStream = [];
  for (i=0; i<32; i++)
    binaryStream.push(0x00); // 32b header

  // pack name into offset [1]
  const kMaxChars = 16;
  sampleName = document.getElementById('sample_name').value.slice(0, kMaxChars);
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
  theSound.start(0, in_point / sampleRate, (out_point-in_point)/sampleRate);
}

// convert an arraybuffer into an AudioBuffer source ready for playback.
function loadBIN_8b_ulaw(arraybuf) {
  dv = new DataView(arraybuf);

  // convert ulaw into linear in the sourceAudioBuffer.
  sourceAudioBuffer = actx.createBuffer(1, dv.byteLength, 24000);
  out_point = dv.byteLength;
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
  out_point = dv.byteLength;
  channelData = sourceAudioBuffer.getChannelData(0);
  for (i=0; i<dv.byteLength; i++) {
    var sample = dv.getUint8(i); // unsigned 8bit
    sample -= 128;
    sample = sample / 128.0;
    channelData[i] = sample;
  }
}

// Ask Luma to send the sample buffer
function requestDeviceSample() {
  audio_init(); // may not have been called

  var drumType = document.getElementById('drumType').selectedIndex;
  console.log(drumType);

  var buf = new ArrayBuffer(32);
  dv = new DataView(buf);

  buf[0] = CMD_SAMPLE | 0x08;
  buf[26] = drumType;

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
      drawWaveformCanvas();
      updateStatusBar();
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
