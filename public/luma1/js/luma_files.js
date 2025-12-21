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
  droppedZip.loadAsync(fileReader.result).then(function (zip) {
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
            droppedZip.file(value.name).async("ArrayBuffer").then(function (data) {
              bank[bankId].name = filename;
              const fileext = filename.slice(-4);
              if (fileext === ".wav") {
                actx.decodeAudioData(data, function (buf) {
                  const sampleData = createBytesFromAudioBuffer(buf);
                  bank[bankId].sampleData = sampleData;
                  bank[bankId].sampleLength = buf.length;
                  bank[bankId].sample_rate = buf.sampleRate;
                  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
                });
              } else if (fileext === ".bin") {
                bank[bankId].original_binary = cloneArrayBuffer(data);
                bank[bankId].sampleData = convert_8b_ulaw_to_bytes(data);
                bank[bankId].sampleLength = data.byteLength;
              }
            });
          })(bankId, tokens[1]);
        }
      }
    }
  });
}

function droppedFileLoadedBIN(event) {
  binaryFileOriginal = fileReader.result;
  const bf = document.getElementById("binaryFormat");
  if (bf) bf.removeAttribute("disabled");
  interpretBinaryFile();
}

function droppedFileLoadedRomMu(event) {
  const SLOT_SIZE = 16384;
  const NUM_SLOTS = 8;
  const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
  
  if (fileReader.result.byteLength !== TOTAL_SIZE) {
    alert("Invalid ROM file size. Expected 131072 bytes (128k)");
    return;
  }
  
  const romData = new Uint8Array(fileReader.result);
  const slot_import_order = [7, 6, 1, 0, 2, 3, 5, 4];
  
  for (let i = 0; i < NUM_SLOTS; i++) {
    const slotIndex = slot_import_order[i];
    const slotOffset = i * SLOT_SIZE;
    const slotData = romData.slice(slotOffset, slotOffset + SLOT_SIZE);
    
    bank[slotIndex] = {
      id: slotIndex,
      name: `Slot ${slotIndex + 1}`,
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
  
  if (typeof resizeCanvasToParent === 'function') resizeCanvasToParent();
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
  if (typeof updateStatusBar === 'function') updateStatusBar();
}

function droppedFileLoadedWav(event) {
  const bf = document.getElementById("binaryFormat");
  if (bf) bf.setAttribute("disabled", true);

  const wavFile = new wav(fileReader.result);
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
  const dataView = new DataView(fileReader.result, dataOffset, dataLength);

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

  const sampleData = new Uint8Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const linear = Math.round(channelData[i] * 32767);
    const ulaw = linear_to_ulaw(linear);
    sampleData[i] = ~ulaw;
  }

  editorSampleData = sampleData;
  editorSampleLength = numFrames;
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;

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

  [...ev.dataTransfer.items].forEach((item, i) => {
    if (item.kind === "file") {
      const file = item.getAsFile();
      var name = `${file.name}`;
      sampleName = name.slice(0, name.length - 4);
      name = name.toLowerCase();

      fileReader = new FileReader();
      if (name.slice(-4) === ".bin") {
        if (current_mode === "lumamu" && file.size === 131072) {
          fileReader.onload = droppedFileLoadedRomMu;
        } else {
          fileReader.onload = droppedFileLoadedBIN;
        }
      } else if (name.slice(-4) === ".wav")
        fileReader.onload = droppedFileLoadedWav;
      else if (name.slice(-4) === ".zip")
        fileReader.onload = droppedFileLoadedZip;

      fileReader.readAsArrayBuffer(file);
    }
  });
}

function dragOverHandler(ev) {
  ev.preventDefault();
}

function interpretBinaryFile() {
  if (binaryFormat === "ulaw_u8") {
    editorSampleData = convert_8b_ulaw_to_bytes(binaryFileOriginal);
    editorSampleLength = editorSampleData.length;
  } else if (binaryFormat === "pcm_u8") {
    loadBIN_u8b_pcm(binaryFileOriginal);
  }

  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;

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

function loadBIN_u8b_pcm(arraybuf) {
  let dv = new DataView(arraybuf);
  editorSampleLength = dv.byteLength;
  editorSampleData = new Uint8Array(dv.byteLength);
  for (let i = 0; i < dv.byteLength; i++) {
    var sample = (dv.getUint8(i) - 128) / 128.0;
    const linear = Math.round(sample * 32767);
    const ulaw = linear_to_ulaw(linear);
    editorSampleData[i] = ~ulaw;
  }
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
      sample_name_base = `sample_${i + 1}`;
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

function downloadRAMBuffer() {
  if (!ram_dump) return;
  var ram_blob = new Blob([ram_dump]);
  var link = document.createElement("a");
  link.href = window.URL.createObjectURL(ram_blob);
  link.download = "luna_ram.bin";
  link.click();
}

