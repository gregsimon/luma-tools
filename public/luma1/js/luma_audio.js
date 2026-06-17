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
  if (picker && slotRate && [12000, 24000, 44100, 48000].includes(slotRate)) {
    picker.value = slotRate.toString();
  }

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

  playingSound = theSound;
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
  const audioBuffer = createAudioBufferFromBytes(bufferData, playbackSampleRate);
  if (!audioBuffer) return;

  let theSound = actx.createBufferSource();
  theSound.buffer = audioBuffer;
  theSound.connect(actx.destination); // connect to the output

  const duration = (editor_out_point - editor_in_point + 1) / playbackSampleRate;
  const offset = editor_in_point / playbackSampleRate;

  // convert end points into seconds for playback.
  if (isLooping) {
    theSound.loop = true;
    theSound.start(0);
  } else {
    theSound.start(
      // when (seconds) playback should start (immediately)
      0,
      // offset (seconds) into the buffer where playback starts
      offset,
      // duration (seconds) of the sample to play
      duration,
    );
  }

  playingSound = theSound;
  playingSound.isEditorSound = true;
  playbackStartTime = actx.currentTime;
  playingSound.playbackOffset = offset;
  playingSound.loopDuration = duration;
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
