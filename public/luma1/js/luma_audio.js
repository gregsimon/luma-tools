// Audio initialization and processing functions

// This can only be done after a user gesture on the page.
function audio_init() {
  // We are selecting 12000 Hz here in order estimate the
  // Luma-1's pitch knob position at 12-o-clock. This matters because
  // when we drag import wav files WebAudio matches them to this audiocontext.
  if (actx == undefined) actx = new classAudioContext({ sampleRate: 12000 });
}

function cloneArrayBuffer(src) {
  if (src == null) return new ArrayBuffer(0);
  var dst = new ArrayBuffer(src.byteLength);
  new Uint8Array(dst).set(new Uint8Array(src));
  return dst;
}

// Get maximum sample size based on current mode
function getMaxSampleSize() {
  return (current_mode === "lumamu") ? 16384 : 32768;
}

// Create AudioBuffer from byte array for playback
function createAudioBufferFromBytes(sampleData, sampleRate = 24000) {
  if (!sampleData || sampleData.length === 0) return null;
  
  // Convert uLaw bytes to linear PCM float32
  const numSamples = sampleData.length;
  const audioBuffer = actx.createBuffer(1, numSamples, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  
  for (let i = 0; i < numSamples; i++) {
    let ulaw = sampleData[i];
    ulaw = ~ulaw; // Invert from storage format
    const linear = ulaw_to_linear(ulaw);
    channelData[i] = linear / 32768.0; // Convert to [-1, 1]
  }
  
  return audioBuffer;
}

// Create byte array from AudioBuffer for storage
function createBytesFromAudioBuffer(audioBuffer) {
  const numSamples = audioBuffer.length;
  const sampleData = new Uint8Array(numSamples);
  const channelData = audioBuffer.getChannelData(0);
  
  for (let i = 0; i < numSamples; i++) {
    const sample = channelData[i];
    // Clamp to [-1, 1] and convert to 16-bit linear
    const linear = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
    const ulaw = linear_to_ulaw(linear);
    sampleData[i] = ~ulaw; // Invert for storage format
  }
  
  return sampleData;
}

// Clone sample data with optional endpointing
function cloneSampleData(fromSampleData, fromLength, startIndex = 0, endIndex = -1) {
  if (!fromSampleData || fromLength === 0) return null;
  if (endIndex === -1) endIndex = fromLength;
  const numSamples = endIndex - startIndex;
  const newSampleData = new Uint8Array(numSamples);
  newSampleData.set(fromSampleData.subarray(startIndex, endIndex));
  return newSampleData;
}

function playSlotAudio(id) {
  if (typeof audio_init === 'function') audio_init();
  if (actx == undefined) return;

  // disable focus since it may double-trigger if "Preview" is selected and
  // the spacebar is pressed.
  document.activeElement.blur();

  // Get the selected sample rate for playback
  const playbackSampleRate = getSelectedSampleRate();

  // Create AudioBuffer on-demand for playback
  const audioBuffer = createAudioBufferFromBytes(bank[id].sampleData, playbackSampleRate);
  if (!audioBuffer) return;
  
  let theSound = actx.createBufferSource();
  theSound.buffer = audioBuffer;
  theSound.connect(actx.destination); // connect to the output

  // convert end points into seconds for playback.
  theSound.start(0, 0, audioBuffer.length / playbackSampleRate);
}

function playAudio() {
  if (typeof audio_init === 'function') audio_init();
  if (actx == undefined) return;

  // disable focus since it may double-trigger if "Preview" is selected and
  // the spacebar is pressed.
  document.activeElement.blur();

  // Get the selected sample rate for playback
  const playbackSampleRate = getSelectedSampleRate();

  // Create AudioBuffer on-demand for playback
  const audioBuffer = createAudioBufferFromBytes(editorSampleData, playbackSampleRate);
  if (!audioBuffer) return;

  let theSound = actx.createBufferSource();
  theSound.buffer = audioBuffer;
  theSound.connect(actx.destination); // connect to the output

  console.log("editor_in_point = " + editor_in_point);
  console.log("editor_out_point = " + editor_out_point); 
  console.log("num samples to play = " + (editor_out_point - editor_in_point+1));
  console.log("start at " + editor_in_point / playbackSampleRate + " seconds");
  console.log("total duration = " + (editor_out_point - editor_in_point+1) / playbackSampleRate + " seconds");
  
  // convert end points into seconds for playback.
  theSound.start(
    // when (seconds) playback should start (immediately)
    0,
    // offset (seconds) into the buffer where playback starts
    editor_in_point / audioBuffer.sampleRate, 
    // duration (seconds) of the sample to play
    (editor_out_point - editor_in_point+1) / audioBuffer.sampleRate,
  );
}

function generateRamp() {
  var value = 0;
  // Create a new sample data array
  const numSamples = 16384; // Default size
  editorSampleData = new Uint8Array(numSamples);
  editorSampleLength = numSamples;
  
  for (var i = 0; i < numSamples; i++) {
    // Convert float to uLaw
    const linear = Math.round(value * 32767);
    const ulaw = linear_to_ulaw(linear);
    editorSampleData[i] = ~ulaw; // Invert for storage format
    
    value = value + 0.01;
    if (value > 1) value = 0;
  }

  if (typeof resetRange === 'function') resetRange();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function reverseSampleBuffer() {
  var len = editorSampleLength;
  for (i = 0; i < len / 2; i++) {
    var temp = editorSampleData[i];
    editorSampleData[i] = editorSampleData[len - 1 - i];
    editorSampleData[len - 1 - i] = temp;
  }
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

