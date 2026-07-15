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

// Get padded sample size for Luma-1 hardware
function getPaddedSampleSize(numSamples) {
  if (current_mode !== "luma1") return numSamples;
  const MIN_SIZE = 2048;
  const HARDWARE_SIZE = 1024;
  if (numSamples <= MIN_SIZE) return MIN_SIZE;
  return Math.ceil(numSamples / HARDWARE_SIZE) * HARDWARE_SIZE;
}

// Apply Luma-1 hardware padding to a Uint8Array
function applyHardwarePadding(sampleData) {
  if (current_mode !== "luma1") return sampleData;
  const paddedSize = getPaddedSampleSize(sampleData.length);
  if (paddedSize === sampleData.length) return sampleData;

  const paddedData = new Uint8Array(paddedSize);
  paddedData.set(sampleData);
  // Uint8Array is initialized with 0x00, which is u-law silence in our inverted format
  return paddedData;
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

// ========================= AM6072+555 Emulation (Luma-Mu hardware preview) =========================

const CLOCK_WANDER_CENTS = 1.5;   // slow thermal drift (std, sub-Hz)
const CLOCK_JITTER_SEC = 150e-9;  // per-cycle period noise (std), constant in TIME

// Measured knob taper: [position 0..1, semitones re as-prepped pitch].
const KNOB_TAPER = [
  [0.000, -16.25], [0.143, -15.20], [0.286, -12.77], [0.429, -9.57],
  [0.490, -7.11], [0.571, -4.78], [0.714, 1.52], [0.857, 8.97],
  [1.000, 16.10],
];

function knobToSemitones(pos) {
  pos = Math.max(0, Math.min(1, pos));
  for (let i = 1; i < KNOB_TAPER.length; i++) {
    const [p0, s0] = KNOB_TAPER[i - 1], [p1, s1] = KNOB_TAPER[i];
    if (pos <= p1) return s0 + (s1 - s0) * (pos - p0) / (p1 - p0);
  }
  return KNOB_TAPER[KNOB_TAPER.length - 1][1];
}

function mulawCompand(x) {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    const mag = Math.abs(v) * 8031;
    const biased = Math.min(mag + 33, 8191);
    const chord = Math.max(0, Math.min(7, Math.floor(Math.log2(biased)) - 5));
    const step = Math.max(0, Math.min(15,
        Math.floor(biased / Math.pow(2, chord + 1)) - 16));
    const dec = Math.pow(2, chord) * (2 * step + 33) - 33;
    out[i] = Math.sign(v) * dec / 8031;
  }
  return out;
}

function gauss() {  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function zohRender(rom, clock, outRate,
                    wanderCents = CLOCK_WANDER_CENTS,
                    jitterSec = CLOCK_JITTER_SEC) {
  const n = rom.length;
  if (n < 2) return new Float32Array(1);
  // slow wander at the clock rate
  let acc = new Float64Array(n);
  if (wanderCents > 0) {
    const a = 1 - Math.exp(-2 * Math.PI * 0.3 / clock);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      p1 += a * (gauss() - p1);
      p2 += a * (p1 - p2);
      acc[i] = p2;
    }
    let m = 0, s = 0;
    for (let i = 0; i < n; i++) m += acc[i];
    m /= n;
    for (let i = 0; i < n; i++) s += (acc[i] - m) * (acc[i] - m);
    s = Math.sqrt(s / n);
    const target = (wanderCents / 1200) * Math.LN2;
    if (s > 0) for (let i = 0; i < n; i++) acc[i] *= target / s;
  }
  const jitFrac = jitterSec * clock;
  const base = outRate / clock;
  // edge times (output-rate units)
  const edges = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    let per = base * (1 - acc[i] + jitFrac * gauss());
    if (per < 0.05 * base) per = 0.05 * base;
    t += per;
    edges[i] = t;
  }
  const nOut = Math.floor(edges[n - 1]);
  if (nOut < 2) return new Float32Array(1);
  const y = new Float64Array(nOut);
  // naive hold: forward walk
  let k = 0;
  for (let m2 = 0; m2 < nOut; m2++) {
    while (k < n - 1 && edges[k] <= m2) k++;
    y[m2] = rom[Math.min(k, n - 1)];
  }
  // polyBLEP bandlimited correction at every transition
  for (let e = 0; e < n - 1; e++) {
    const et = edges[e];
    if (et <= 0 || et >= nOut - 1) continue;
    const dv = rom[e + 1] - rom[e];
    const i = Math.floor(et);
    const f = et - i;
    y[i] += dv * (1 - f) * (1 - f) / 2;
    y[i + 1] -= dv * f * f / 2;
  }
  return Float32Array.from(y);
}

function simulate(rom, knobPos, outRate, romRate) {
  const st = knobToSemitones(knobPos);
  const clock = romRate * Math.pow(2, st / 12);
  return zohRender(mulawCompand(rom), clock, outRate);
}

function createEmulatedAudioBufferFromBytes(sampleData, playbackSampleRate) {
  if (!sampleData || sampleData.length === 0) return null;

  const numSamples = sampleData.length;
  const rom = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    let ulaw = sampleData[i];
    ulaw = ~ulaw; // Invert from storage format
    const linear = ulaw_to_linear(ulaw);
    rom[i] = linear / 32768.0; // Convert to [-1, 1]
  }

  // Get current pitch setting (0..100) -> 0..1
  const pitchInput = document.getElementById("emu_pitch");
  const pos = pitchInput ? parseFloat(pitchInput.value) / 100 : 0.49;
  const outRate = actx.sampleRate; // Browser's native AudioContext sample rate

  // Run the emulation chain
  const emulatedData = simulate(rom, pos, outRate, playbackSampleRate);

  // Create AudioBuffer at the browser's native sample rate
  const audioBuffer = actx.createBuffer(1, emulatedData.length, outRate);
  audioBuffer.copyToChannel(emulatedData, 0);

  return audioBuffer;
}

function createPlaybackAudioBuffer(sampleData, playbackSampleRate) {
  const emuCheckbox = document.getElementById('emu_enable');
  const isEmuEnabled = emuCheckbox && emuCheckbox.checked;

  if (isEmuEnabled) {
    return createEmulatedAudioBufferFromBytes(sampleData, playbackSampleRate);
  } else {
    return createAudioBufferFromBytes(sampleData, playbackSampleRate);
  }
}

function toggleEmuControls() {
  const emuCheckbox = document.getElementById("emu_enable");
  const emuControls = document.getElementById("emu_controls");
  if (emuCheckbox && emuControls) {
    if (emuCheckbox.checked) {
      emuControls.style.display = "inline-flex";
      updateEmuPitchLabel();
    } else {
      emuControls.style.display = "none";
    }
  }
}

function updateEmuPitchLabel() {
  const emuPitch = document.getElementById("emu_pitch");
  const emuPitchVal = document.getElementById("emu_pitchval");
  if (emuPitch && emuPitchVal) {
    const pos = parseFloat(emuPitch.value);
    const st = knobToSemitones(pos / 100);
    const rel = st - knobToSemitones(0.49);
    const romRate = getSelectedSampleRate();
    const clock = romRate * Math.pow(2, st / 12);
    emuPitchVal.textContent = `${pos.toFixed(0)}% · ${rel >= 0 ? "+" : ""}${rel.toFixed(1)} st · ${(clock / 1000).toFixed(1)} kHz`;
  }
}

function initEmuControls() {
  const emuPitch = document.getElementById("emu_pitch");
  if (emuPitch) {
    emuPitch.addEventListener("input", () => {
      updateEmuPitchLabel();
    });
    emuPitch.addEventListener("change", () => {
      if (playingSound) {
        if (playingSound.isEditorSound) {
          playAudio();
        }
      }
    });
  }

  const emuEnable = document.getElementById("emu_enable");
  if (emuEnable) {
    emuEnable.addEventListener("change", () => {
      toggleEmuControls();
      if (playingSound) {
        if (playingSound.isEditorSound) {
          playAudio();
        }
      }
    });
  }

  const ratePicker = document.getElementById("sample_rate_picker");
  if (ratePicker) {
    ratePicker.addEventListener("change", () => {
      updateEmuPitchLabel();
    });
  }
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

function updateBinaryFileOriginal() {
  if (editorSampleData) {
    // Use slice() to get a copy of the data and its buffer
    binaryFileOriginal = editorSampleData.slice().buffer;
  } else {
    binaryFileOriginal = null;
  }
}

// Stretch a linear float32 buffer to a target length using linear interpolation
function stretchLinearBuffer(inputData, targetLength) {
  const inputLength = inputData.length;
  if (inputLength === targetLength) return inputData;

  const outputData = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const pos = i * (inputLength - 1) / (targetLength - 1);
    const index = Math.floor(pos);
    const frac = pos - index;
    if (index >= inputLength - 1) {
      outputData[i] = inputData[inputLength - 1];
    } else {
      outputData[i] = (1 - frac) * inputData[index] + frac * inputData[index + 1];
    }
  }
  return outputData;
}

// Stretch a uLaw buffer to a target length
function stretchULawBuffer(inputData, targetLength) {
  const inputLength = inputData.length;
  if (inputLength === targetLength) return inputData;

  // Convert to linear
  const linearData = new Float32Array(inputLength);
  for (let i = 0; i < inputLength; i++) {
    let ulaw = inputData[i];
    ulaw = ~ulaw; // Invert from storage format
    const linear = ulaw_to_linear(ulaw);
    linearData[i] = linear / 32768.0;
  }

  // Stretch linear
  const stretchedLinear = stretchLinearBuffer(linearData, targetLength);

  // Convert back to u-law
  const outputData = new Uint8Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const linear = Math.round(stretchedLinear[i] * 32767);
    const ulaw = linear_to_ulaw(linear);
    outputData[i] = ~ulaw;
  }
  return outputData;
}

function stopPlayingSound() {
  if (playingSound) {
    try {
      playingSound.stop();
    } catch (e) {
      console.log("Error stopping sound:", e);
    }
    playingSound = null;
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function updatePlaybackCursor() {
  if (playingSound && playingSound.isEditorSound) {
    if (typeof drawEditorCanvas === 'function') drawEditorCanvas();
    animationFrameId = requestAnimationFrame(updatePlaybackCursor);
  } else {
    animationFrameId = null;
    if (typeof drawEditorCanvas === 'function') drawEditorCanvas();
  }
}

function playSlotAudio(id) {
  if (typeof audio_init === 'function') audio_init();
  if (actx == undefined) return;

  // disable focus since it may double-trigger if "Preview" is selected and
  // the spacebar is pressed.
  document.activeElement.blur();

  if (playingSound) {
    stopPlayingSound();
    return;
  }

  // Update the sample rate picker to match the slot's sample rate if it's standard
  const slotRate = bank[id].sample_rate;
  const picker = document.getElementById('sample_rate_picker');
  if (picker && slotRate && [12000, 20000, 24000, 44100, 48000].includes(slotRate)) {
    picker.value = slotRate.toString();
  }

  // Get the selected sample rate for playback
  const playbackSampleRate = getSelectedSampleRate();

  // Create AudioBuffer on-demand for playback
  const audioBuffer = createPlaybackAudioBuffer(bank[id].sampleData, playbackSampleRate);
  if (!audioBuffer) return;

  let theSound = actx.createBufferSource();
  theSound.buffer = audioBuffer;
  theSound.connect(actx.destination); // connect to the output

  const emuCheckbox = document.getElementById('emu_enable');
  const isEmuEnabled = emuCheckbox && emuCheckbox.checked;

  if (isEmuEnabled) {
    const pitchInput = document.getElementById("emu_pitch");
    const pos = pitchInput ? parseFloat(pitchInput.value) : 49.0;
    const st = knobToSemitones(pos / 100);
    const scale = Math.pow(2, st / 12);
    theSound.start(0);
    playingSound = theSound;
    playingSound.pitchScale = scale;
  } else {
    // convert end points into seconds for playback.
    theSound.start(0, 0, audioBuffer.length / playbackSampleRate);
    playingSound = theSound;
    playingSound.pitchScale = 1.0;
  }

  playingSound.isEditorSound = false;
  playingSound.onended = () => {
    if (playingSound === theSound) {
      playingSound = null;
      if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
    }
  };
}

function toggleLoopPlayback() {
  const btn = document.getElementById('loop_playback_button');
  if (!btn) return;
  
  if (btn.classList.contains('loop_active')) {
    btn.classList.remove('loop_active');
    btn.value = "Loop: Off";
  } else {
    btn.classList.add('loop_active');
    btn.value = "Loop: On";
  }
}

function playAudio() {
  if (typeof audio_init === 'function') audio_init();
  if (actx == undefined) return;

  // disable focus since it may double-trigger if "Preview" is selected and
  // the spacebar is pressed.
  document.activeElement.blur();

  if (playingSound) {
    stopPlayingSound();
    return;
  }

  // Get the selected sample rate for playback
  const playbackSampleRate = getSelectedSampleRate();

  const loopBtn = document.getElementById('loop_playback_button');
  const isLooping = loopBtn && loopBtn.classList.contains('loop_active');

  let bufferData = editorSampleData;
  if (isLooping) {
    bufferData = cloneSampleData(editorSampleData, editorSampleLength, editor_in_point, editor_out_point + 1);
  }

  // Create AudioBuffer on-demand for playback
  const audioBuffer = createPlaybackAudioBuffer(bufferData, playbackSampleRate);
  if (!audioBuffer) return;

  let theSound = actx.createBufferSource();
  theSound.buffer = audioBuffer;
  theSound.connect(actx.destination); // connect to the output

  const duration = (editor_out_point - editor_in_point + 1) / playbackSampleRate;
  const offset = editor_in_point / playbackSampleRate;

  const emuCheckbox = document.getElementById('emu_enable');
  const isEmuEnabled = emuCheckbox && emuCheckbox.checked;
  let scale = 1.0;

  if (isEmuEnabled) {
    const pitchInput = document.getElementById("emu_pitch");
    const pos = pitchInput ? parseFloat(pitchInput.value) : 49.0;
    const st = knobToSemitones(pos / 100);
    scale = Math.pow(2, st / 12);
  }

  // convert end points into seconds for playback.
  if (isLooping) {
    theSound.loop = true;
    theSound.start(0);
  } else {
    if (isEmuEnabled) {
      // If emulated and not looping, we pass the full editorSampleData to emulate,
      // so the offset and duration in the emulated buffer are scaled.
      theSound.start(0, offset / scale, duration / scale);
    } else {
      theSound.start(0, offset, duration);
    }
  }

  playingSound = theSound;
  playingSound.isEditorSound = true;
  playbackStartTime = actx.currentTime;
  playingSound.playbackOffset = offset;
  playingSound.loopDuration = isEmuEnabled ? (duration / scale) : duration;
  playingSound.pitchScale = scale;
  playingSound.onended = () => {
    if (playingSound === theSound) {
      playingSound = null;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
    }
  };

  // Start animation loop for playback cursor
  updatePlaybackCursor();
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
  updateBinaryFileOriginal();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function reverseSampleBuffer() {
  var len = editorSampleLength;
  for (i = 0; i < len / 2; i++) {
    var temp = editorSampleData[i];
    editorSampleData[i] = editorSampleData[len - 1 - i];
    editorSampleData[len - 1 - i] = temp;
  }
  updateBinaryFileOriginal();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function cropSample() {
  if (!editorSampleData || editorSampleLength === 0) return;

  const start = Math.max(0, editor_in_point);
  const end = Math.min(editorSampleLength - 1, editor_out_point);

  if (start > end) return;

  const newLength = end - start + 1;
  const newSampleData = new Uint8Array(newLength);
  newSampleData.set(editorSampleData.subarray(start, end + 1));

  editorSampleData = newSampleData;
  editorSampleLength = newLength;

  if (typeof resetRange === 'function') resetRange();
  updateBinaryFileOriginal();
}

function deleteSelection() {
  if (!editorSampleData || editorSampleLength === 0) return;

  const start = Math.max(0, editor_in_point);
  const end = Math.min(editorSampleLength - 1, editor_out_point);

  if (start > end) return;

  const removeLength = end - start + 1;
  const newLength = editorSampleLength - removeLength;

  if (newLength === 0) {
    editorSampleData = new Uint8Array(0);
    editorSampleLength = 0;
  } else {
    const newSampleData = new Uint8Array(newLength);
    // Copy part before selection
    if (start > 0) {
      newSampleData.set(editorSampleData.subarray(0, start));
    }
    // Copy part after selection
    if (end < editorSampleLength - 1) {
      newSampleData.set(editorSampleData.subarray(end + 1), start);
    }
    editorSampleData = newSampleData;
    editorSampleLength = newLength;
  }

  if (typeof resetRange === 'function') resetRange();
  updateBinaryFileOriginal();
}

function zeroRange() {
  if (!editorSampleData || editorSampleLength === 0) return;

  const start = Math.max(0, editor_in_point);
  const end = Math.min(editorSampleLength - 1, editor_out_point);

  if (start > end) return;

  for (let i = start; i <= end; i++) {
    editorSampleData[i] = 0;
  }

  updateBinaryFileOriginal();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function clearSample() {
  editorSampleData = null;
  editorSampleLength = 0;
  sampleName = "untitled";

  if (typeof resetRange === 'function') resetRange();
  updateBinaryFileOriginal();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();

  const sampleNameInput = document.getElementById('sample_name');
  if (sampleNameInput) sampleNameInput.value = "untitled";

  const sampleNameMuInput = document.getElementById('sample_name_mu');
  if (sampleNameMuInput) sampleNameMuInput.value = "untitled";
}

function duplicateToFill() {
  if (!editorSampleData || editorSampleLength === 0) return;

  const targetLength = getMaxSampleSize();
  const start = Math.max(0, editor_in_point);
  const end = Math.min(editorSampleLength - 1, editor_out_point);
  const sourceLength = end - start + 1;
  
  if (sourceLength <= 0) return;

  const newSampleData = new Uint8Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    newSampleData[i] = editorSampleData[start + (i % sourceLength)];
  }

  editorSampleData = newSampleData;
  editorSampleLength = targetLength;

  if (typeof resetRange === 'function') resetRange();
  updateBinaryFileOriginal();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function handleFunctionPicker(selectElement) {
  const value = selectElement.value;
  if (value === "Crop") cropSample();
  else if (value === "Delete Selection") deleteSelection();
  else if (value === "Zero Range") zeroRange();
  else if (value === "Reverse") reverseSampleBuffer();
  else if (value === "Clear") clearSample();
  else if (value === "Duplicate to Fill") duplicateToFill();

  // Reset the picker to the label
  selectElement.selectedIndex = 0;
}

function updateZeroCrossingSnapButton() {
  const btn = document.getElementById("zero_crossing_snap_button");
  if (!btn) return;
  if (typeof snapToZeroCrossing !== "undefined" && snapToZeroCrossing) {
    btn.classList.add("loop_active");
    btn.value = "Snap Zero: On";
  } else {
    btn.classList.remove("loop_active");
    btn.value = "Snap Zero: Off";
  }
}

function toggleZeroCrossingSnap() {
  if (typeof snapToZeroCrossing !== "undefined") {
    snapToZeroCrossing = !snapToZeroCrossing;
    if (typeof saveSettings === "function") saveSettings();
    updateZeroCrossingSnapButton();

    // Snap current selection bounds immediately if turned on
    if (snapToZeroCrossing && editorSampleData && editorSampleLength > 0) {
      editor_in_point = findNearestZeroCrossing(editor_in_point, 0);
      const inSlope = getSampleSlope(editor_in_point);
      editor_out_point = findNearestZeroCrossing(editor_out_point, inSlope);

      if (editor_out_point <= editor_in_point) {
        editor_out_point = Math.min(editor_in_point + 1, editorSampleLength - 1);
      }

      if (typeof updateStatusBar === "function") updateStatusBar();
      if (typeof redrawAllWaveforms === "function") redrawAllWaveforms();
    }
  }
}

function getLinearSample(index) {
  if (!editorSampleData || index < 0 || index >= editorSampleLength) return 0;
  let ulaw = editorSampleData[index];
  ulaw = ~ulaw; // Invert from storage format
  return ulaw_to_linear(ulaw);
}

function getSampleSlope(index) {
  const v1 = getLinearSample(index);
  const v2 = getLinearSample(index + 1);
  return (v2 - v1 >= 0) ? 1 : -1;
}

function findNearestZeroCrossing(targetIndex, preferredSlope = 0) {
  if (!editorSampleData || editorSampleLength <= 0) return targetIndex;

  targetIndex = Math.round(targetIndex);
  targetIndex = Math.max(0, Math.min(targetIndex, editorSampleLength - 1));

  const maxSearch = 1000; // Search up to 1000 samples away
  let bestDistAny = Infinity;
  let bestIndexAny = targetIndex;

  let bestDistSlope = Infinity;
  let bestIndexSlope = targetIndex;

  for (let offset = 0; offset < maxSearch; offset++) {
    // Check indices in outward order
    const checkIndices = [];
    if (offset === 0) {
      checkIndices.push(targetIndex);
    } else {
      checkIndices.push(targetIndex + offset);
      checkIndices.push(targetIndex - offset);
    }

    for (const idx of checkIndices) {
      if (idx < 0 || idx >= editorSampleLength - 1) continue;

      const v1 = getLinearSample(idx);
      const v2 = getLinearSample(idx + 1);

      // Is this a zero crossing?
      if (v1 * v2 <= 0 && !(v1 === 0 && v2 === 0)) {
        const slope = (v2 - v1 >= 0) ? 1 : -1;
        const crossingIdx = (Math.abs(v1) <= Math.abs(v2)) ? idx : idx + 1;
        const dist = Math.abs(crossingIdx - targetIndex);

        if (dist < bestDistAny) {
          bestDistAny = dist;
          bestIndexAny = crossingIdx;
        }

        if (preferredSlope === 0 || slope === preferredSlope) {
          if (dist < bestDistSlope) {
            bestDistSlope = dist;
            bestIndexSlope = crossingIdx;
          }
        }
      }
    }

    // Break early if we found a slope-matched one close by
    if (bestDistSlope < offset) {
      break;
    }
  }

  if (bestDistSlope !== Infinity) {
    return bestIndexSlope;
  }
  if (bestDistAny !== Infinity) {
    return bestIndexAny;
  }
  return targetIndex;
}
