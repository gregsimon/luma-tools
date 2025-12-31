"Copyright 2023-2026 Greg Simon";

// globals
const classAudioContext = window.AudioContext || window.webkitAudioContext;
let actx; // AudioContext
let playingSound = null; // Currently playing AudioBufferSourceNode
let editorSampleData = null; // Uint8Array in uLaw format (active sample)
let editorSampleLength = 0; // number of samples
let midiAccess = null;
let midiOut = null;
let midiIn = null;
let fileReader;
let editor_in_point = 0;
let editor_out_point = 0;
let editorZoomLevel = 1.0;
let editorViewStart = 0;
let sampleRate = 12000; // Hz
let sampleName = "untitled";
let shiftDown = false;
let binaryFileOriginal = null; // Original raw bytes of loaded sample
let binaryFormat = "ulaw_u8";
let bank = []; // Hold the state of each slot
let bank_name = "Untitled";
let current_mode = "luma1"; // Current device mode: luma1 or lumamu
const drag_gutter_pct = 0.1;
let luma_firmware_version = "";
let luma_serial_number = "";
let throttle_midi_send_ms = 0;
let ram_dump = null;
let ENABLE_LIBRARIAN = true;

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAcdlLcHOK_j68DCQaECjfU9tNeIAAopVA",
  authDomain: "luma-tools.firebaseapp.com",
  projectId: "luma-tools",
  storageBucket: "luma-tools.firebasestorage.app",
  messagingSenderId: "225679885224",
  appId: "1:225679885224:web:dff1e269683868fd85939d",
  measurementId: "G-2X4KL02039"
};

// Drag state variables
let isDraggingEndpoint = false;
let draggingWhichEndpoint = null; // "in" or "out"
let isDraggingWaveform = false;
let currentDropZone = null; // null, "start", "center", "end"

// settings lets that are persisted locally on computer
let settings_midiDeviceName = "";
let settings_midi_monitor_show_sysex = false;

const TAB_SAMPLE_EDITOR = 0;
const TAB_PATTERN_EDITOR = 1;
const TAB_MIDI_MONITOR = 2;
const TAB_UTILITIES = 3;
const TAB_LIBRARIAN = 4;

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
  "SLOT 3", // 0 
  "SLOT 2", // 1
  "SLOT 4", // 2
  "SLOT 5", // 3
  "SLOT 7", // 4
  "SLOT 6", // 5
  "SLOT 1", // 6
  "SLOT 0", // 7
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
  
  // Initialize Firebase
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();

  // Set up Auth state listener
  auth.onAuthStateChanged((user) => {
    const loginBtn = document.getElementById("login_button");
    const userInfo = document.getElementById("user_info");
    const userName = document.getElementById("user_name");
    const libAuthNotice = document.getElementById("librarian_auth_notice");
    const libContent = document.getElementById("librarian_content");

    if (user) {
      if (loginBtn) loginBtn.style.display = "none";
      if (userInfo) userInfo.style.display = ENABLE_LIBRARIAN ? "flex" : "none";
      if (userName) userName.textContent = user.displayName || user.email;
      if (libAuthNotice) libAuthNotice.style.display = "none";
      if (libContent) libContent.style.display = "block";
      console.log("User signed in:", user.uid);
    } else {
      if (loginBtn) loginBtn.style.display = ENABLE_LIBRARIAN ? "block" : "none";
      if (userInfo) userInfo.style.display = "none";
      if (userName) userName.textContent = "";
      if (libAuthNotice) libAuthNotice.style.display = "block";
      if (libContent) libContent.style.display = "none";
      console.log("User signed out");
    }
  });

  // Specifically hide login UI if librarian is disabled
  if (!ENABLE_LIBRARIAN) {
    const loginBtn = document.getElementById("login_button");
    const userInfo = document.getElementById("user_info");
    if (loginBtn) loginBtn.style.display = "none";
    if (userInfo) userInfo.style.display = "none";
  }

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
      sampleData: null,    // Uint8Array in uLaw format
      sampleLength: 0,     // number of samples
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
    if (mode === "luma1") {
      for (let i = 0; i < luma1_slot_names.length; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.innerHTML = luma1_slot_names[i];
        el.appendChild(opt);
      }
    } else {
      // Luma-Mu mode: show in numeric order SLOT 0, SLOT 1, ...
      // These indices correspond to the order: 7 (SLOT 0), 6 (SLOT 1), 1 (SLOT 2), 0 (SLOT 3), 2 (SLOT 4), 3 (SLOT 5), 5 (SLOT 6), 4 (SLOT 7)
      const lumamu_picker_order = [7, 6, 1, 0, 2, 3, 5, 4];
      for (let i = 0; i < lumamu_picker_order.length; i++) {
        const slotIdx = lumamu_picker_order[i];
        const opt = document.createElement("option");
        opt.value = slotIdx;
        opt.innerHTML = lumamu_slot_names[slotIdx];
        el.appendChild(opt);
      }
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
    if (editorSampleData) {
      editor_in_point = Math.max(0, Math.min(value, editorSampleLength - 1));
      if (editor_in_point >= editor_out_point) {
        editor_out_point = Math.min(editor_in_point + 1, editorSampleLength - 1);
        document.getElementById("out_point").value = editor_out_point;
      }
      updateStatusBar();
      redrawAllWaveforms();
    }
  });
  
  document.getElementById("out_point").addEventListener("input", (e) => {
    const value = parseInt(e.target.value) || 0;
    if (editorSampleData) {
      editor_out_point = Math.max(0, Math.min(value, editorSampleLength - 1));
      if (editor_out_point <= editor_in_point) {
        editor_in_point = Math.max(0, editor_out_point - 1);
        document.getElementById("in_point").value = editor_in_point;
      }
      updateStatusBar();
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
    // Only stop dragging if we're not dragging endpoints
    // Endpoint dragging should continue even when mouse leaves the canvas
    if (!isDraggingEndpoint) {
      onEditorCanvasMouseUp(event);
    }
  };
  canvas.ondragstart = (ev) => {
    // Only allow waveform dragging if not dragging endpoints and we're in waveform drag mode
    if (isDraggingEndpoint || !isDraggingWaveform) {
      ev.preventDefault();
      return;
    }
    
    ev.dataTransfer.setData("text/plain", 255); // start drag
  };
  canvas.ondragover = (ev) => {
    ev.preventDefault();
  };
  canvas.ondrop = (ev) => {
    // Only handle waveform dragging, let file drops pass through to parent
    const srcId = ev.dataTransfer.getData("text/plain");
    if (srcId !== "" && srcId !== "255") {
      ev.preventDefault();
      copyWaveFormBetweenSlots(srcId, 255);
      return; // Don't let event bubble up
    }
    // For file drops (no text/plain data), let event bubble up to parent div
  };

  // setup scrollbar
  const sbCanvas = document.getElementById("scrollbar_canvas");
  if (sbCanvas) {
    sbCanvas.onmousedown = (event) => {
      onScrollbarMouseDown(event);
    };
    sbCanvas.onmousemove = (event) => {
      onScrollbarMouseMove(event);
    };
    sbCanvas.onmouseup = (event) => {
      onScrollbarMouseUp(event);
    };
    sbCanvas.onmouseleave = (event) => {
      onScrollbarMouseUp(event);
    };
  }

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
  
  if (ENABLE_LIBRARIAN) {
    document.getElementById("librarian_tab_button").onclick = () => {
      switchTab(TAB_LIBRARIAN);
    };
  } else {
    document.getElementById("librarian_tab_button").style.display = "none";
  }

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
    } else if (e.key === "=" || e.key === "+") {
      zoomIn();
    } else if (e.key === "-") {
      zoomOut();
    } else if (e.shiftKey) {
      shiftDown = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key.charCodeAt(0) === 83) {
      shiftDown = false;
    }
  });
  
  // Global mouse events for endpoint dragging
  window.addEventListener("mousemove", (event) => {
    if (isDraggingEndpoint && editorCanvasMouseIsDown) {
      const canvas = document.getElementById("editor_canvas");
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const w = canvas.width;
      
      if (editorSampleData == null) return;
      
      const visibleSamples = editorSampleLength / editorZoomLevel;

      // Auto-scroll when dragging near edges
      const scrollEdge = 20; // pixels
      if (x < scrollEdge) {
        editorViewStart -= visibleSamples * 0.05;
      } else if (x > w - scrollEdge) {
        editorViewStart += visibleSamples * 0.05;
      }
      
      // Clamp editorViewStart
      editorViewStart = Math.max(0, Math.min(editorViewStart, editorSampleLength - visibleSamples));

      var new_pt = editorViewStart + (visibleSamples * x) / w;
      
      if (shiftDown) new_pt = Math.round(new_pt / 1024) * 1024;
      
      if (draggingWhichEndpoint === "in") {
        if (new_pt < editor_out_point) {
          editor_in_point = Math.floor(new_pt);
          editor_in_point = Math.max(0, editor_in_point);
        }
      } else if (draggingWhichEndpoint === "out") {
        if (new_pt > editor_in_point) {
          editor_out_point = Math.floor(new_pt);
          editor_out_point = Math.min(editorSampleLength - 1, editor_out_point);
        }
      }
      updateStatusBar();
      drawEditorCanvas();
    }
  });
  
  window.addEventListener("mouseup", (event) => {
    if (isDraggingEndpoint) {
      onEditorCanvasMouseUp(event);
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

function switchTab(newTab) {
  if (typeof stopPlayingSound === 'function') stopPlayingSound();
  de("sample_editor_tab").style.display = "none";
  de("pattern_editor_tab").style.display = "none";
  de("midi_monitor_tab").style.display = "none";
  de("librarian_tab").style.display = "none";
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
    case TAB_LIBRARIAN:
      de("librarian_tab").style.display = "block";
      break;
  }
}

function updateStatusBar() {
  document.getElementById("in_point").value = editor_in_point;
  document.getElementById("out_point").value = editor_out_point;
  
  // Calculate and display the number of selected samples
  const sampleCount = editor_out_point - editor_in_point + 1;
  document.getElementById("sample_count").textContent = sampleCount;

  // Enable/disable stretch button
  const stretchBtn = document.getElementById("stretch_to_16k");
  if (stretchBtn) {
    stretchBtn.disabled = !(current_mode === "lumamu" && editorSampleLength > 0 && editorSampleLength < 16384);
  }
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
    if (ENABLE_LIBRARIAN) {
      document.getElementById("librarian_tab_button").style.display = "block";
    } else {
      document.getElementById("librarian_tab_button").style.display = "none";
    }
    
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
    if (ENABLE_LIBRARIAN) {
      document.getElementById("librarian_tab_button").style.display = "block";
    } else {
      document.getElementById("librarian_tab_button").style.display = "none";
    }
    
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
        "Drag a binary file (8-bit PCM or uLaw), Wav, AIFF, or FLAC file, or a zip archive of a bank onto top editor above.<br>" +
        "Press \"Spacebar\" to playback sample in browser<br>" +
        "Hold \"Shift\" while dragging endpoints to lock cursor to 1k (1024 samples)<br>" +
        "Drag waveforms between slots in the staging area, they can also be dragged to and from the editor<br>" +
        "The \"STAGING\" bank represents the samples currently loaded into the cards, the numbered banks are banks stored on the internal SD card.";
    } else {
      helpTextElement.innerHTML = 
        "Drag a ROM file (.bin), Wav, AIFF, or FLAC file, or a zip archive of a bank onto top editor above.<br>" +
        "ROM files should be 131072 bytes (128k) containing 8 slots of sample data.<br>" +
        "Press \"Spacebar\" to playback sample in browser<br>" +
        "Hold \"Shift\" while dragging endpoints to lock cursor to 1k (1024 samples)<br>" +
        "Drag waveforms between slots in the staging area, they can also be dragged to and from the editor<br>" +
        "The \"STAGING\" bank represents the samples currently loaded into the cards, the numbered banks are banks stored on the internal SD card.";
    }
  }
  
  // Redraw waveforms to update labels
  if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
}

function trim_filename_ext(filename) {
  if (filename.indexOf(".") >= 0)
    return filename.split(".").slice(0, -1).join(".");

  return filename;
}

