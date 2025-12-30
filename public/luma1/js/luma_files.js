// File handling, drag & drop, and export functions

function bankIdForName(name) {
  for (let i = 0; i < luma1_slot_names.length; i++) {
    if (name === luma1_slot_names[i]) return i;
  }
  for (let i = 0; i < lumamu_slot_names.length; i++) {
    if (name === lumamu_slot_names[i]) return i;
  }
  return -1;
}

function droppedFileLoadedZip(event) {
  var droppedZip = new JSZip();
  droppedZip.loadAsync(event.target.result).then(function (zip) {
    var bank_path_prefix = "";
    var found_bank = false;
    for (const [key, value] of Object.entries(zip.files)) {
      if (!value.dir && value.name[0] != ".") {
        if (value.name.slice(-12).toUpperCase() === "BANKNAME.TXT") {
          found_bank = true;
          bank_path_prefix = value.name.slice(0, -12);
          break;
        }
      }
    }

    if (found_bank == false) {
      alert("Zip archive contains no folder with the file BANKNAME.TXT");
      return;
    }

    // Collect all file loading promises
    var filePromises = [];

    for (const [key, value] of Object.entries(zip.files)) {
      if (!value.dir) {
        if (value.name.slice(0, bank_path_prefix.length) != bank_path_prefix) {
          continue;
        }
        var name = value.name.slice(bank_path_prefix.length);
        var tokens = name.split("/");
        var bankId = bankIdForName(tokens[0]);
        if (bankId >= 0) {
          if (tokens[1][0] == ".") continue;
          (function (bankId, filename) {
            var filePromise = droppedZip.file(value.name).async("ArrayBuffer").then(function (data) {
              bank[bankId].name = filename;
              const fileext = filename.slice(-4);
              if (fileext === ".wav") {
                return new Promise(function(resolve) {
                  actx.decodeAudioData(data, function (buf) {
                    const sampleData = createBytesFromAudioBuffer(buf);
                    bank[bankId].sampleData = sampleData;
                    bank[bankId].sampleLength = buf.length;
                    bank[bankId].sample_rate = buf.sampleRate;
                    resolve();
                  }, function(error) {
                    console.error("Error decoding audio:", error);
                    resolve(); // Resolve anyway to not block other files
                  });
                });
              } else if (fileext === ".bin") {
                bank[bankId].original_binary = cloneArrayBuffer(data);
                bank[bankId].sampleData = convert_8b_ulaw_to_bytes(data);
                bank[bankId].sampleLength = data.byteLength;
                return Promise.resolve();
              }
              return Promise.resolve();
            });
            filePromises.push(filePromise);
          })(bankId, tokens[1]);
        }
      }
    }

    // Wait for all files to load, then redraw waveforms once
    Promise.all(filePromises).then(function() {
      currentDropZone = null;
      if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
      if (typeof updateStatusBar === 'function') updateStatusBar();
    }).catch(function(error) {
      currentDropZone = null;
      console.error("Error loading bank files:", error);
      if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
    });
  });
}

function droppedFileLoadedBIN(event) {
  binaryFileOriginal = event.target.result;
  const bf = document.getElementById("binaryFormat");
  if (bf) bf.removeAttribute("disabled");
  interpretBinaryFile();
}

function droppedFileLoadedRomMu(event) {
  const SLOT_SIZE = 16384;
  const NUM_SLOTS = 8;
  const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
  
  if (event.target.result.byteLength !== TOTAL_SIZE) {
    alert("Invalid ROM file size. Expected 131072 bytes (128k)");
    return;
  }
  
  const romData = new Uint8Array(event.target.result);
  const slot_import_order = [7, 6, 1, 0, 2, 3, 5, 4];
  
  for (let i = 0; i < NUM_SLOTS; i++) {
    const slotIndex = slot_import_order[i];
    const slotOffset = i * SLOT_SIZE;
    const slotData = romData.slice(slotOffset, slotOffset + SLOT_SIZE);
    
    bank[slotIndex] = {
      id: slotIndex,
      name: `Slot ${i}`,
      sample_rate: 24000,
      original_binary: slotData.buffer,
      sampleData: slotData,
      sampleLength: SLOT_SIZE,
    };
  }
  
  const bankNameMu = document.getElementById("bank_name_mu");
  const bName = sampleName || "Imported ROM";
  if (bankNameMu) bankNameMu.value = bName;
  
  if (bank[0] && bank[0].sampleData) {
    editorSampleData = cloneSampleData(bank[0].sampleData, bank[0].sampleLength);
    editorSampleLength = bank[0].sampleLength;
    sampleName = bank[0].name;
    const snMu = document.getElementById("sample_name_mu");
    if (snMu) snMu.value = sampleName;
    binaryFileOriginal = cloneArrayBuffer(bank[0].original_binary);
    if (typeof resetRange === 'function') resetRange();
  }
  
  currentDropZone = null;
  if (typeof resizeCanvasToParent === 'function') resizeCanvasToParent();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  if (typeof updateStatusBar === 'function') updateStatusBar();
}

function droppedFileLoadedWav(event) {
  const bf = document.getElementById("binaryFormat");
  if (bf) bf.setAttribute("disabled", true);

  const wavFile = new wav(event.target.result);
  if (wavFile.readyState !== wavFile.DONE) {
    alert("Error loading WAV file: " + wavFile.error);
    return;
  }
    
  const dataOffset = wavFile.dataOffset;
  const dataLength = wavFile.dataLength;
  const bitsPerSample = wavFile.bitsPerSample;
  const sRate = wavFile.sampleRate;
  const numChannels = wavFile.numChannels;
  
  if (numChannels !== 1 && numChannels !== 2) {
    alert(`Unsupported channel count: ${numChannels}. Only mono and stereo are supported.`);
    return;
  }

  const numFrames = dataLength / (bitsPerSample / 8) / numChannels;
  const audioBuffer = actx.createBuffer(1, numFrames, sRate);
  const channelData = audioBuffer.getChannelData(0);
  const dataView = new DataView(event.target.result, dataOffset, dataLength);

  if (bitsPerSample === 8) {
    for (let i = 0; i < numFrames; i++) {
      if (numChannels === 1) {
        channelData[i] = (dataView.getUint8(i) - 128) / 128.0;
      } else {
        const left = dataView.getUint8(i * 2);
        const right = dataView.getUint8(i * 2 + 1);
        channelData[i] = ((left - 128) + (right - 128)) / 2 / 128.0;
      }
    }
  } else if (bitsPerSample === 16) {
    for (let i = 0; i < numFrames; i++) {
      if (numChannels === 1) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
      } else {
        const left = dataView.getInt16(i * 4, true);
        const right = dataView.getInt16(i * 4 + 2, true);
        channelData[i] = ((left + right) / 2) / 32768.0;
      }
    }
  } else if (bitsPerSample === 24) {
    for (let i = 0; i < numFrames; i++) {
      const offset = i * 3 * numChannels;
      let left = dataView.getUint8(offset) | (dataView.getUint8(offset + 1) << 8) | (dataView.getUint8(offset + 2) << 16);
      if (left & 0x800000) left |= ~0xFFFFFF;
      if (numChannels === 1) {
        channelData[i] = left / 8388608.0;
      } else {
        let right = dataView.getUint8(offset + 3) | (dataView.getUint8(offset + 4) << 8) | (dataView.getUint8(offset + 5) << 16);
        if (right & 0x800000) right |= ~0xFFFFFF;
        channelData[i] = ((left + right) / 2) / 8388608.0;
      }
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < numFrames; i++) {
      if (numChannels === 1) {
        channelData[i] = dataView.getInt32(i * 4, true) / 2147483648.0;
      } else {
        const left = dataView.getInt32(i * 8, true);
        const right = dataView.getInt32(i * 8 + 4, true);
        channelData[i] = ((left + right) / 2) / 2147483648.0;
      }
    }
  }

  let processingData = channelData;
  let processingFrames = numFrames;

  const sampleData = new Uint8Array(processingFrames);
  for (let i = 0; i < processingFrames; i++) {
    const linear = Math.round(processingData[i] * 32767);
    const ulaw = linear_to_ulaw(linear);
    sampleData[i] = ~ulaw;
  }

  if (currentDropZone === "start") {
    const newBuffer = new Uint8Array(editorSampleLength + processingFrames);
    newBuffer.set(sampleData);
    if (editorSampleData) {
      newBuffer.set(editorSampleData, processingFrames);
    }
    editorSampleData = newBuffer;
    editorSampleLength += processingFrames;
  } else if (currentDropZone === "end") {
    const newBuffer = new Uint8Array(editorSampleLength + processingFrames);
    if (editorSampleData) {
      newBuffer.set(editorSampleData);
    }
    newBuffer.set(sampleData, editorSampleLength);
    editorSampleData = newBuffer;
    editorSampleLength += processingFrames;
  } else {
    // Center or default (replace)
    editorSampleData = sampleData;
    editorSampleLength = processingFrames;
  }

  currentDropZone = null;
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;
  editorZoomLevel = 1.0;
  editorViewStart = 0;

  const picker = document.getElementById('sample_rate_picker');
  if (picker) {
    if ([12000, 24000, 44100, 48000].includes(sRate)) {
      picker.value = sRate.toString();
    } else {
      picker.value = "24000";
    }
  }

  trimBufferToFitLuma();
  const snInput = document.getElementById("sample_name");
  if (snInput) snInput.value = sampleName;
}

function droppedFileLoadedAif(event) {
  const bf = document.getElementById("binaryFormat");
  if (bf) bf.setAttribute("disabled", true);

  const data = event.target.result;
  console.log("Attempting to decode audio, buffer size:", data.byteLength);
  
  // Try our custom AIFF parser first for standard PCM files, 
  // as it's more reliable than decodeAudioData in some browsers
  const aiffFile = new aiff(data);
  if (aiffFile.readyState === aiffFile.DONE && aiffFile.format === 'AIFF') {
    console.log("Using custom AIFF parser");
    const numChannels = aiffFile.numChannels;
    const bitsPerSample = aiffFile.sampleSize;
    const sRate = aiffFile.sampleRate;
    const dataOffset = aiffFile.dataOffset;
    const dataLength = aiffFile.dataLength;
    const numFrames = aiffFile.numSampleFrames;

    const audioBuffer = actx.createBuffer(1, numFrames, sRate);
    const channelData = audioBuffer.getChannelData(0);
    const dataView = new DataView(data, dataOffset, dataLength);

    if (bitsPerSample === 8) {
      for (let i = 0; i < numFrames; i++) {
        if (numChannels === 1) {
          channelData[i] = dataView.getInt8(i) / 128.0;
        } else {
          const left = dataView.getInt8(i * 2);
          const right = dataView.getInt8(i * 2 + 1);
          channelData[i] = (left + right) / 2 / 128.0;
        }
      }
    } else if (bitsPerSample === 16) {
      for (let i = 0; i < numFrames; i++) {
        if (numChannels === 1) {
          channelData[i] = dataView.getInt16(i * 2, false) / 32768.0;
        } else {
          const left = dataView.getInt16(i * 4, false);
          const right = dataView.getInt16(i * 4 + 2, false);
          channelData[i] = ((left + right) / 2) / 32768.0;
        }
      }
    } else if (bitsPerSample === 24) {
      for (let i = 0; i < numFrames; i++) {
        const offset = i * 3 * numChannels;
        let left = (dataView.getUint8(offset) << 16) | (dataView.getUint8(offset + 1) << 8) | dataView.getUint8(offset + 2);
        if (left & 0x800000) left |= ~0xFFFFFF;
        if (numChannels === 1) {
          channelData[i] = left / 8388608.0;
        } else {
          let right = (dataView.getUint8(offset + 3) << 16) | (dataView.getUint8(offset + 4) << 8) | dataView.getUint8(offset + 5);
          if (right & 0x800000) right |= ~0xFFFFFF;
          channelData[i] = ((left + right) / 2) / 8388608.0;
        }
      }
    } else if (bitsPerSample === 32) {
      for (let i = 0; i < numFrames; i++) {
        if (numChannels === 1) {
          channelData[i] = dataView.getInt32(i * 4, false) / 2147483648.0;
        } else {
          const left = dataView.getInt32(i * 8, false);
          const right = dataView.getInt32(i * 8 + 4, false);
          channelData[i] = ((left + right) / 2) / 2147483648.0;
        }
      }
    }

    processDecodedAudio(audioBuffer);
    return;
  }

  // Fallback to decodeAudioData for AIFC or if custom parser fails
  console.log("Falling back to decodeAudioData");
  let decodeCtx;
  try {
    decodeCtx = new classAudioContext();
  } catch (e) {
    decodeCtx = actx;
  }

  const decodePromise = new Promise((resolve, reject) => {
    try {
      const res = decodeCtx.decodeAudioData(data.slice(0), resolve, reject);
      if (res && typeof res.then === 'function') {
        res.then(resolve).catch(reject);
      }
    } catch (e) {
      reject(e);
    }
  });

  decodePromise.then(function(buffer) {
    processDecodedAudio(buffer);
    if (decodeCtx && decodeCtx !== actx && typeof decodeCtx.close === 'function') decodeCtx.close();
  }).catch(function(error) {
    console.error("Error decoding audio:", error);
    if (decodeCtx && decodeCtx !== actx && typeof decodeCtx.close === 'function') decodeCtx.close();
    
    const view = new Uint8Array(data.slice(0, 12));
    const magic = String.fromCharCode(view[0], view[1], view[2], view[3]);
    const format = String.fromCharCode(view[8], view[9], view[10], view[11]);
    
    let msg = `Error decoding audio file. The format (${magic}/${format}) may be unsupported by your browser.`;
    if (magic === "FORM" && format !== "AIFF" && format !== "AIFC") {
      msg = `This file appears to be an IFF file but not a standard AIFF (format: ${format}).`;
    }
    alert(msg);
  });
}

function processDecodedAudio(buffer) {
  const processingFrames = buffer.length;
  const sRate = buffer.sampleRate;

  // Mix to mono if necessary
  let channelData;
  if (buffer.numberOfChannels > 1) {
    channelData = new Float32Array(processingFrames);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < processingFrames; i++) {
      channelData[i] = (left[i] + right[i]) / 2;
    }
  } else {
    channelData = buffer.getChannelData(0);
  }

  // Convert to internal format (u-law bytes)
  const sampleData = new Uint8Array(processingFrames);
  for (let i = 0; i < processingFrames; i++) {
    const linear = Math.round(Math.max(-1, Math.min(1, channelData[i])) * 32767);
    const ulaw = linear_to_ulaw(linear);
    sampleData[i] = ~ulaw;
  }

  if (currentDropZone === "start") {
    const newBuffer = new Uint8Array(editorSampleLength + processingFrames);
    newBuffer.set(sampleData);
    if (editorSampleData) {
      newBuffer.set(editorSampleData, processingFrames);
    }
    editorSampleData = newBuffer;
    editorSampleLength += processingFrames;
  } else if (currentDropZone === "end") {
    const newBuffer = new Uint8Array(editorSampleLength + processingFrames);
    if (editorSampleData) {
      newBuffer.set(editorSampleData);
    }
    newBuffer.set(sampleData, editorSampleLength);
    editorSampleData = newBuffer;
    editorSampleLength += processingFrames;
  } else {
    // Center or default (replace)
    editorSampleData = sampleData;
    editorSampleLength = processingFrames;
  }

  currentDropZone = null;
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;
  editorZoomLevel = 1.0;
  editorViewStart = 0;

  const picker = document.getElementById('sample_rate_picker');
  if (picker) {
    if ([12000, 24000, 44100, 48000].includes(sRate)) {
      picker.value = sRate.toString();
    } else {
      picker.value = "24000"; 
    }
  }

  trimBufferToFitLuma();
  const snInput = document.getElementById("sample_name");
  if (snInput) snInput.value = sampleName;
}

function dropHandler(ev) {
  ev.preventDefault();
  if (typeof audio_init === 'function') audio_init();

  const rect = ev.currentTarget.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const width = rect.width;

  if (x < width / 4) {
    currentDropZone = "start";
  } else if (x > (width * 3) / 4) {
    currentDropZone = "end";
  } else {
    currentDropZone = "center";
  }

  [...ev.dataTransfer.items].forEach((item, i) => {
    if (item.kind === "file") {
      const file = item.getAsFile();
      var name = `${file.name}`;
      const lastDot = name.lastIndexOf('.');
      const ext = lastDot !== -1 ? name.slice(lastDot).toLowerCase() : "";
      sampleName = lastDot !== -1 ? name.slice(0, lastDot) : name;

      fileReader = new FileReader();
      if (ext === ".bin") {
        if (current_mode === "lumamu" && file.size === 131072) {
          fileReader.onload = droppedFileLoadedRomMu;
        } else {
          fileReader.onload = droppedFileLoadedBIN;
        }
      } else if (ext === ".wav")
        fileReader.onload = droppedFileLoadedWav;
      else if (ext === ".aif" || ext === ".aiff")
        fileReader.onload = droppedFileLoadedAif;
      else if (ext === ".zip")
        fileReader.onload = droppedFileLoadedZip;

      fileReader.readAsArrayBuffer(file);
    }
  });
}

function dragOverHandler(ev) {
  ev.preventDefault();
  const rect = ev.currentTarget.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const width = rect.width;

  let newDropZone;
  if (x < width / 4) {
    newDropZone = "start";
  } else if (x > (width * 3) / 4) {
    newDropZone = "end";
  } else {
    newDropZone = "center";
  }

  if (newDropZone !== currentDropZone) {
    currentDropZone = newDropZone;
    if (typeof drawEditorCanvas === "function") drawEditorCanvas();
  }
}

function dragLeaveHandler(ev) {
  currentDropZone = null;
  if (typeof drawEditorCanvas === "function") drawEditorCanvas();
}

function interpretBinaryFile() {
  let newSampleData;
  if (binaryFormat === "ulaw_u8") {
    newSampleData = convert_8b_ulaw_to_bytes(binaryFileOriginal);
  } else if (binaryFormat === "pcm_u8") {
    newSampleData = loadBIN_u8b_pcm_data(binaryFileOriginal);
  }

  if (newSampleData) {
    if (currentDropZone === "start") {
      const combined = new Uint8Array(editorSampleLength + newSampleData.length);
      combined.set(newSampleData);
      if (editorSampleData) combined.set(editorSampleData, newSampleData.length);
      editorSampleData = combined;
      editorSampleLength = combined.length;
    } else if (currentDropZone === "end") {
      const combined = new Uint8Array(editorSampleLength + newSampleData.length);
      if (editorSampleData) combined.set(editorSampleData);
      combined.set(newSampleData, editorSampleLength);
      editorSampleData = combined;
      editorSampleLength = combined.length;
    } else {
      editorSampleData = newSampleData;
      editorSampleLength = newSampleData.length;
    }
  }

  currentDropZone = null;
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;
  editorZoomLevel = 1.0;
  editorViewStart = 0;

  trimBufferToFitLuma();
  const snInput = document.getElementById("sample_name");
  if (snInput) snInput.value = sampleName;
}

function convert_8b_ulaw_to_bytes(arraybuf) {
  var dv = new DataView(arraybuf);
  var sampleData = new Uint8Array(dv.byteLength);
  for (let i = 0; i < dv.byteLength; i++) {
    sampleData[i] = dv.getUint8(i);
  }
  return sampleData;
}

function loadBIN_u8b_pcm_data(arraybuf) {
  let dv = new DataView(arraybuf);
  let data = new Uint8Array(dv.byteLength);
  for (let i = 0; i < dv.byteLength; i++) {
    var sample = (dv.getUint8(i) - 128) / 128.0;
    const linear = Math.round(sample * 32767);
    const ulaw = linear_to_ulaw(linear);
    data[i] = ~ulaw;
  }
  return data;
}

function loadBIN_u8b_pcm(arraybuf) {
  editorSampleData = loadBIN_u8b_pcm_data(arraybuf);
  editorSampleLength = editorSampleData.length;
}

function trimBufferToFitLuma() {
  const max = getMaxSampleSize();
  if (editorSampleLength > max) {
    const newSampleData = new Uint8Array(max);
    newSampleData.set(editorSampleData.subarray(0, max));
    editorSampleData = newSampleData;
    editorSampleLength = max;
    editor_in_point = 0;
    editor_out_point = editorSampleLength - 1;
  } else {
    editor_in_point = 0;
    editor_out_point = editorSampleLength - 1;
  }

  if (typeof resizeCanvasToParent === 'function') resizeCanvasToParent();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  if (typeof updateStatusBar === 'function') updateStatusBar();
}

function changeBinFormat(event) {
  const bf = document.getElementById("binaryFormat");
  if (bf) {
    binaryFormat = bf.value;
    interpretBinaryFile();
  }
}

function getSelectedSampleRate() {
  const picker = document.getElementById('sample_rate_picker');
  return picker ? parseInt(picker.value) : 24000;
}

function saveLocalByteAray(name, buffer) {
  var blob = new Blob([buffer], { type: "application/octet-stream" });
  var link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  link.download = name;
  link.click();
}

function exportSample() {
  if (!editorSampleData) {
    alert("No sample loaded");
    return;
  }

  const sampleNameField = (current_mode === "luma1") ? "sample_name" : "sample_name_mu";
  let nameInput = document.getElementById(sampleNameField);
  let name = nameInput ? nameInput.value : "untitled";
  
  const exportSampleRate = getSelectedSampleRate();
  const audioBuffer = createAudioBufferFromBytes(editorSampleData, exportSampleRate);
  if (!audioBuffer) {
    alert("Error creating audio buffer for export");
    return;
  }
  
  var channelData = audioBuffer.getChannelData(0);
  var encoder = new WavAudioEncoder(exportSampleRate, 1);
  encoder.encode([channelData]);
  var blob = encoder.finish();
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = name + ".wav";
  a.click();
}

function exportBankAsRom() {
  if (current_mode === "lumamu") {
    exportBankAsRomMu();
    return;
  }
  const SLOT_SIZE = 16384;
  const NUM_SLOTS = 8;
  const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
  const romBuffer = new Uint8Array(TOTAL_SIZE);

  for (let i = 0; i < NUM_SLOTS; i++) {
    if (!bank[i] || !bank[i].sampleData) continue;
    const slotData = bank[i].sampleData;
    const copyLength = Math.min(SLOT_SIZE, slotData.length);
    romBuffer.set(slotData.subarray(0, copyLength), i * SLOT_SIZE);
  }

  saveLocalByteAray("ROM.BIN", romBuffer.buffer);
}

function exportBankAsRomMu() {
  const SLOT_SIZE = 16384;
  const NUM_SLOTS = 8;
  const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
  const romBuffer = new Uint8Array(TOTAL_SIZE);

  const slot_export_order = [7, 6, 1, 0, 2, 3, 5, 4];
  for (let i = 0; i < NUM_SLOTS; i++) {
    const idx = slot_export_order[i];
    if (!bank[idx] || !bank[idx].sampleData) continue;
    const slotData = bank[idx].sampleData;
    const copyLength = Math.min(SLOT_SIZE, slotData.length);
    romBuffer.set(slotData.subarray(0, copyLength), i * SLOT_SIZE);
  }

  const bnMu = document.getElementById("bank_name_mu");
  const bankName = (bnMu ? bnMu.value : "Untitled") || "Untitled";
  saveLocalByteAray(`${bankName}.bin`, romBuffer.buffer);
}

function exportBankAsZip() {
  const bankNameField = (current_mode === "luma1") ? "bank_name" : "bank_name_mu";
  const bnInput = document.getElementById(bankNameField);
  bank_name = (bnInput ? bnInput.value : "Untitled") || "Untitled";

  var zip = new JSZip();
  zip.file("BANKNAME.TXT", bank_name);

  let exportSlotNames = (current_mode === "lumamu") ? lumamu_slot_names : slot_names;
  const numSlotsToExport = (current_mode === "lumamu") ? 8 : 10;
  for (let i = 0; i < numSlotsToExport; i++) {
    const slot_name = exportSlotNames[i];
    let sample_name_base = trim_filename_ext(bank[i].name);
    if (!sample_name_base || sample_name_base === "") {
      if (current_mode === "lumamu") {
        const match = slot_name.match(/SLOT (\d+)/);
        sample_name_base = match ? `sample_${match[1]}` : `sample_${i}`;
      } else {
        sample_name_base = `sample_${i + 1}`;
      }
    }
    if (bank[i].original_binary != null && bank[i].original_binary.byteLength > 0) {
      zip.folder(slot_name).file(sample_name_base + ".bin", bank[i].original_binary);
    }

    const exportSampleRate = getSelectedSampleRate();
    const audioBuffer = createAudioBufferFromBytes(bank[i].sampleData, exportSampleRate);
    if (audioBuffer) {
      var channelData = audioBuffer.getChannelData(0);
      var encoder = new WavAudioEncoder(exportSampleRate, 1);
      encoder.encode([channelData]);
      var blob = encoder.finish();
      zip.folder(slot_name).file(sample_name_base + ".wav", blob);
    }
  }

  zip.generateAsync({ type: "blob" }).then(function (blob_) {
    var link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob_);
    link.download = bank_name + ".zip";
    link.click();
  });
}

function copyWaveFormBetweenSlots(srcId, dstId) {
  if (srcId == dstId) return;

  if (srcId == 255) {
    const numSamples = editor_out_point - editor_in_point + 1;
    bank[dstId].sampleData = cloneSampleData(editorSampleData, editorSampleLength, editor_in_point, editor_out_point + 1);
    bank[dstId].sampleLength = numSamples;
    const snInput = document.getElementById("sample_name");
    bank[dstId].name = snInput ? snInput.value : "untitled";
    bank[dstId].original_binary = cloneArrayBuffer(binaryFileOriginal);
  } else if (dstId == 255) {
    editorSampleData = cloneSampleData(bank[srcId].sampleData, bank[srcId].sampleLength);
    editorSampleLength = bank[srcId].sampleLength;
    sampleName = bank[srcId].name;
    const snInput = document.getElementById("sample_name");
    if (snInput) snInput.value = sampleName;
    binaryFileOriginal = cloneArrayBuffer(bank[srcId].original_binary);
    if (typeof resetRange === 'function') resetRange();
  } else {
    bank[dstId].sampleData = cloneSampleData(bank[srcId].sampleData, bank[srcId].sampleLength);
    bank[dstId].sampleLength = bank[srcId].sampleLength;
    bank[dstId].name = bank[srcId].name;
    bank[dstId].original_binary = cloneArrayBuffer(bank[srcId].original_binary);
  }

  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function stretchTo16kClicked() {
  if (current_mode !== "lumamu" || !editorSampleData || editorSampleLength >= 16384 || editorSampleLength === 0) {
    return;
  }

  editorSampleData = stretchULawBuffer(editorSampleData, 16384);
  editorSampleLength = 16384;
  
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;
  editorZoomLevel = 1.0;
  editorViewStart = 0;

  trimBufferToFitLuma(); // This will redraw and update status bar
}

function downloadRAMBuffer() {
  if (!ram_dump) return;
  var ram_blob = new Blob([ram_dump]);
  var link = document.createElement("a");
  link.href = window.URL.createObjectURL(ram_blob);
  link.download = "luna_ram.bin";
  link.click();
}

