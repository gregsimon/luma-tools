// MIDI and Sysex communication functions

function sendSysexToLuma(header) {
  if (!midiOut) return;

  // pack into the MIDI message
  // [f0] [69] [ulaw data] ..... [f7]
  var binaryStream = [];
  for (let i = 0; i < 32; i++) binaryStream.push(header[i]); // 32b header

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

function onMIDIMessageReceived(event) {
  let str = formatMidiLogString(event);
  if (str != "") {
    const midi_log = de("midi_log");
    if (midi_log) {
      midi_log.innerHTML += `${str} \n`;
      midi_log.scrollTop = midi_log.scrollHeight;
    }
  }

  console.log(`onMIDIMessageReceived ${event.data.length} bytes`);
  console.log(`last byte is ${event.data[event.data.length - 1].toString(16)}`);

  if (event.data[0] == 0xf0) {
    // Unpack the Sysex to figure out what we received.
    const decoder = new TextDecoder();
    console.log(`event.data MIDI In = ${event.data.length} bytes`);
    const dataToBeUnpacked = event.data.slice(2, event.data.length - 1)
    console.log(`event.data = ${event.data}`);
    console.log(`dataToBeUnpacked = ${dataToBeUnpacked}`);
    var data = Uint8Array.from(
      unpack_sysex(dataToBeUnpacked),
    );
    var type = data[0];
    if (type == CMD_SAMPLE || type == (CMD_SAMPLE | CMD_REQUEST) || 
        type == CMD_SAMPLE_BANK || type == (CMD_SAMPLE_BANK | CMD_REQUEST)) {
      // 0x00, 0x08, 0x01, or 0x09 for samples
      var name = data.slice(1, 24);
      var name_len = 0;
      for (var i = 0; i < name.length; i++) {
        if (name[i] == 0) break;
        name_len++;
      }
      sampleName = decoder.decode(name.slice(0, name_len));
      console.log(sampleName);
      const nameInput = document.getElementById("sample_name");
      if (nameInput) nameInput.value = sampleName;
      
      var ulaw_data = data.slice(32);
      var ulaw_data_ab = arrayToArrayBuffer(ulaw_data);

      if (reading_banks) {
        bank[reading_banks_current_slot].sampleData = new Uint8Array(ulaw_data_ab);
        bank[reading_banks_current_slot].sampleLength = ulaw_data_ab.byteLength;
        const snInput = document.getElementById("sample_name");
        bank[reading_banks_current_slot].name = snInput ? snInput.value : "untitled";
        bank[reading_banks_current_slot].original_binary = cloneArrayBuffer(ulaw_data_ab);

        reading_banks_current_slot++;
        if (reading_banks_current_slot < slot_names.length)
          readNextSampleInBank();
        else reading_banks = false;
      } else {
        editorSampleData = new Uint8Array(ulaw_data_ab);
        editorSampleLength = ulaw_data_ab.byteLength;
        editor_out_point = editorSampleLength - 1;
        binaryFileOriginal = ulaw_data_ab; // save the binary stream
      }

      if (typeof resizeCanvasToParent === 'function') resizeCanvasToParent();
      if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
      if (typeof updateStatusBar === 'function') updateStatusBar();
    } else if (type == CMD_UTIL || type == (CMD_UTIL | CMD_REQUEST)) {
      var enc = new TextDecoder("utf-8");
      switch (data[26]) {
        case SX_TEENSY_VERSION:
          luma_firmware_version = enc.decode(data.slice(1, 25));
          const fv = document.getElementById("firmware_version");
          if (fv) fv.innerHTML = luma_firmware_version;
          break;
        case SX_SERIAL_NUMBER:
          luma_serial_number = enc.decode(data.slice(1, 25));
          const sn = de("serial_number");
          if (sn) sn.innerHTML = luma_serial_number;
          break;
        case SX_RAM_BANK_NAME:
          console.log("SX_RAM_BANK_NAME received");
          break;
        case SX_VOICE_BANK_NAME:
          console.log("SX_VOICE_BANK_NAME received");
          bank_name = enc.decode(data.slice(1, 25));
          const bn = de("bank_name");
          if (bn) bn.value = bank_name;
          break;
      }
    } else if (type == CMD_RAM_BANK || type == (CMD_RAM_BANK | CMD_REQUEST)) {
      console.log(`CMD_RAM_BANK ${event.data.length} bytes`);
      var el = de("ram_editor");
      if (el) {
        ram_dump = data.slice(32);
        var format = {
          width: 16,
          html: false,
          format: "twos",
        };
        el.innerText = hexy(ram_dump, format);
      }
    } else {
      console.log("unsupported Luma packet type=" + type);
    }
  }
}

function refreshMidiDeviceList(event) {
  var midiSelectElement = de("midi_out_device");
  if (!midiSelectElement) return;

  midiSelectElement.innerHTML = "";
  let outputs = midiAccess.outputs;
  let inputs = midiAccess.inputs;

  midiSelectElement.options.add(
    new Option("NO MIDI Connection", "NONE", false, false),
  );

  outputs.forEach((port) => {
    midiSelectElement.options.add(
      new Option(port.name, port.fingerprint, false, false),
    );
  });
  midiSelectElement.selectedIndex = 0;

  if (midiSelectElement.value != undefined) {
    midiSelectElement.value = settings_midiDeviceName;
    outputs.forEach((port) => {
      if (0 == port.name.localeCompare(settings_midiDeviceName)) {
        midiOut = port;
      }
    });

    inputs.forEach((port) => {
      if (0 == port.name.localeCompare(settings_midiDeviceName)) {
        midiIn = port;
        midiIn.onmidimessage = onMIDIMessageReceived;
      }
    });
  }
}

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
      if (typeof saveSettings === 'function') saveSettings();
    }
    selectedIndex--;
  });

  inputs.forEach((port) => {
    if (0 == port.name.localeCompare(settings_midiDeviceName)) {
      midiIn = port;
      midiIn.onmidimessage = onMIDIMessageReceived;
    }
  });
}

function onMidiSuccessCallback(access) {
  midiAccess = access;
  var selectMidiOut = de("midi_out_device");

  access.onstatechange = (event) => {
    refreshMidiDeviceList();
  };
  if (selectMidiOut) selectMidiOut.onchange = userChangedMIDIOutDevice;

  refreshMidiDeviceList();

  if (midiIn != null && midiOut != null) {
    console.log("Connected to Luma");
    var buf = new Uint8Array(32);
    buf[0] = CMD_UTIL | 0x08;
    buf[26] = SX_TEENSY_VERSION;
    sendSysexToLuma(buf);

    buf[26] = SX_SERIAL_NUMBER;
    sendSysexToLuma(buf);
  }
}

function onMidiFailCallback(err) {
  console.log(`WebMIDI failed to initialize: ${err.code}`);
  const mf = document.getElementById("midiFailed");
  if (mf) mf.style.display = "block";
}

function writeSampleToDevice(slotId = 255) {
  var numSamples = editor_out_point - editor_in_point + 1;
  var ulaw_buffer = [];

  for (let i = 0; i < numSamples; i++) {
    ulaw_buffer.push(editorSampleData[editor_in_point + i]);
  }

  var binaryStream = [];
  for (let i = 0; i < 32; i++) binaryStream.push(0x00);

  binaryStream[0] = 0x01;
  const bId = de("bankId");
  const sId = de("slotId");
  binaryStream[25] = bId ? bId.value : 0;
  binaryStream[26] = sId ? sId.value : 0;

  const kMaxChars = 24;
  const snInput = document.getElementById("sample_name");
  sampleName = (snInput ? snInput.value : "untitled").slice(0, kMaxChars);
  for (let i = 0; i < sampleName.length; i++)
    binaryStream[i + 1] = sampleName.charAt(i).charCodeAt();

  for (let i = 0; i < ulaw_buffer.length; i++) binaryStream.push(ulaw_buffer[i]);

  var ulaw_stream_7bits = pack_sysex(binaryStream);
  var sysx = [0xf0, 0x69];
  var sysx2 = sysx.concat(ulaw_stream_7bits);
  sysx2.push(0xf7);

  console.log(`Writing ${sysx2.length} to MIDI OUT`);
  if (midiOut) midiOut.send(sysx2);
}

function writeSampleToDeviceSlotBank(slotId, bankId) {
  if (bank[slotId].sampleData == null) return;

  const fromBank = bank[slotId];
  var numSamples = fromBank.sampleLength;
  var ulaw_buffer = [];

  for (let i = 0; i < numSamples; i++) {
    ulaw_buffer.push(fromBank.sampleData[i]);
  }

  var binaryStream = [];
  for (let i = 0; i < 32; i++) binaryStream.push(0x00);

  binaryStream[0] = 0x01;
  binaryStream[25] = bankId;
  binaryStream[26] = slotId;

  const kMaxChars = 24;
  let sName = fromBank.name.slice(0, kMaxChars);
  console.log(`writing ${sName.length} chars to slot ${slotId} in bank ${bankId}`);
  for (let i = 0; i < sName.length; i++)
    binaryStream[i + 1] = sName.charAt(i).charCodeAt();

  for (let i = 0; i < ulaw_buffer.length; i++) binaryStream.push(ulaw_buffer[i]);

  var ulaw_stream_7bits = pack_sysex(binaryStream);
  var sysx = [0xf0, 0x69];
  var sysx2 = sysx.concat(ulaw_stream_7bits);
  sysx2.push(0xf7);

  if (midiOut) midiOut.send(sysx2);
}

function writeBankToDevice() {
  const bankId = de("bankId2").value;

  var buf = new Uint8Array(32);
  buf[0] = CMD_UTIL | CMD_REQUEST;
  buf[25] = bankId;
  buf[26] = SX_VOICE_BANK_NAME;
  const kMaxChars = 24;
  const bnInput = de("bank_name");
  let bName = (bnInput ? bnInput.value : "Untitled").slice(0, kMaxChars);
  for (let i = 0; i < bName.length; i++)
    buf[i + 1] = bName.charAt(i).charCodeAt();

  sendSysexToLuma(buf);

  const write_order = [
    DRUM_CONGA, DRUM_TOM, DRUM_SNARE, DRUM_BASS, DRUM_HIHAT,
    DRUM_COWBELL, DRUM_CLAPS, DRUM_CLAVE, DRUM_TAMB, DRUM_CABASA,
  ];
  for (let idx = 0; idx < write_order.length; idx++) {
    var slotId = write_order[idx];
    console.log(`writing slot ${slotId} in bank ${bankId}`);
    writeSampleToDeviceSlotBank(slotId, bankId);
  }
}

function readBankfromDevice() {
  if (typeof audio_init === 'function') audio_init();

  reading_banks = true;
  reading_banks_id = document.getElementById("bankId2").value;
  reading_banks_current_slot = 0;

  readNextSampleInBank();
}

function readNextSampleInBank() {
  var buf = new Uint8Array(32);
  buf[0] = CMD_SAMPLE | 0x08;
  buf[25] = reading_banks_id;
  buf[26] = reading_banks_current_slot;
  sendSysexToLuma(buf);
}

function readSampleFromDevice() {
  if (typeof audio_init === 'function') audio_init();

  const slotEl = de(current_mode === "luma1" ? "slotId" : "slotId_mu");
  const bankEl = de("bankId");
  if (!slotEl || !bankEl) return;

  var slotId = slotEl.value;
  var bankId = bankEl.value;
  console.log(`Requesting sample: mode=${current_mode}, bank=${bankId}, slot=${slotId}`);

  var buf = new Uint8Array(32);
  buf[0] = CMD_SAMPLE | 0x08;
  buf[25] = bankId;
  buf[26] = slotId;

  sendSysexToLuma(buf);
}

function readRAMfromDevice() {
  if (typeof audio_init === 'function') audio_init();

  var buf = new Uint8Array(32);
  buf[0] = CMD_RAM_BANK | CMD_REQUEST;
  const rbId = de("ram_bankId");
  buf[25] = rbId ? rbId.value : 255;

  sendSysexToLuma(buf);
}

function writeRAMToDevice() {
  if (typeof audio_init === 'function') audio_init();

  if (!ram_dump) return;

  var buf = new Uint8Array(32 + ram_dump.length);
  buf[0] = CMD_RAM_BANK;
  const rbId = de("ram_bankId");
  buf[25] = rbId ? rbId.value : 255;

  for (let i = 0; i < ram_dump.length; i++) {
    buf[i + 32] = ram_dump[i];
  }

  sendSysexToLuma(buf);
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
  var midi_cmd = d[0] & 0xf0;
  if (midi_cmd == 0x90)
    str += "Note ON  " + noteNumberToString(d[1]) + " vel=" + d[2];
  else if (midi_cmd == 0x80)
    str += "Note OFF " + noteNumberToString(d[1]) + " vel=" + d[2];
  else if (midi_cmd == 0xb0)
    str += "CC controller=" + CCtoName(d[1]) + " value=" + d[2];
  else if (midi_cmd == 0xe0) str += "Pitch bend ";

  return str;
}

function noteNumberToString(note) {
  const note_names = [
    " C", "C#", " D", "D#", " E", " F", "F#", " G", "G#", " A", "A#", " B",
  ];
  var octave = note / 12;
  var note_in_octave = note % 12;
  let str = note_names[note_in_octave];
  str += (octave + 1).toFixed(0);
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

