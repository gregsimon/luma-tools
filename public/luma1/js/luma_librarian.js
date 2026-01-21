// Google Drive librarian and authentication functions

let googleDriveAccessToken = null;

function login() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');

  firebase.auth().signInWithPopup(provider).then((result) => {
    googleDriveAccessToken = result.credential.accessToken;
    console.log("Drive Access Token acquired");

    // Load Picker API if not already loaded
    loadPickerApi();

    // Update UI state
    updateLibrarianUI();
  }).catch((error) => {
    console.error("Login failed:", error);
    alert("Login failed: " + error.message);
  });
}

function logout() {
  firebase.auth().signOut().then(() => {
    googleDriveAccessToken = null;
    // Clearing Drive state
    updateLibrarianUI();
  }).catch((error) => {
    console.error("Logout failed:", error);
  });
}


// -- Google Picker Implementation --

let pickerApiLoaded = false;

function loadPickerApi() {
  gapi.load('picker', {
    'callback': onPickerApiLoad
  });
}

function onPickerApiLoad() {
  pickerApiLoaded = true;
  console.log("Picker API loaded");
  updateLibrarianUI();
}

function updateLibrarianUI() {
  const container = document.getElementById("librarian_content");
  if (!container) return; // Not on the page yet?

  // Clear previous content
  container.innerHTML = "";

  // Instructions
  const helpBox = document.createElement("div");
  helpBox.style.marginBottom = "20px";
  helpBox.style.padding = "15px";
  helpBox.style.background = "#333";
  helpBox.style.borderRadius = "4px";
  helpBox.style.lineHeight = "1.5";
  helpBox.innerHTML = `
    <strong>Google Drive Integration</strong>
    <p style="margin: 8px 0;">
      Use the Google Picker to select files securely from your Drive or save your work.
      <br>This app only requests access to the specific files you select or create.
    </p>
  `;
  container.appendChild(helpBox);

  // Buttons Container
  const btnContainer = document.createElement("div");
  btnContainer.style.display = "flex";
  btnContainer.style.flexDirection = "column";
  btnContainer.style.gap = "15px";
  container.appendChild(btnContainer);

  const createSection = (title, buttons) => {
    const section = document.createElement("div");
    section.style.border = "1px solid #444";
    section.style.padding = "15px";
    section.style.borderRadius = "5px";
    section.style.background = "#222";

    const header = document.createElement("h3");
    header.style.marginTop = "0";
    header.textContent = title;
    section.appendChild(header);

    const actionsDiv = document.createElement("div");
    actionsDiv.style.display = "flex";
    actionsDiv.style.gap = "10px";
    actionsDiv.style.flexWrap = "wrap";

    buttons.forEach(btnConfig => {
      const btn = document.createElement("input");
      btn.type = "button";
      btn.value = btnConfig.label;
      btn.onclick = btnConfig.action;
      if (btnConfig.tooltip) btn.title = btnConfig.tooltip;
      if (btnConfig.class) btn.className = btnConfig.class;
      actionsDiv.appendChild(btn);
    });

    section.appendChild(actionsDiv);
    return section;
  };

  // Open Section
  btnContainer.appendChild(createSection("Open from Google Drive", [
    {
      label: "Open Audio File / Bin...",
      action: showOpenAudioPicker,
      tooltip: "Open audio files (.wav, .mp3, etc) or raw .bin/ROM files"
    },
    {
      label: "Open Bank...",
      action: showOpenBankPicker,
      tooltip: "Open a .zip bank file into the Staging Area"
    }
  ]));

  // Save Section
  btnContainer.appendChild(createSection("Save to Google Drive", [
    {
      label: "Save Active Editor Sample...",
      action: showSaveSamplePicker,
      tooltip: "Save the current sample in the editor to Drive"
    },
    {
      label: "Save Active Bank...",
      action: showSaveBankPicker,
      tooltip: "Save the current Staging bank as a Zip to Drive"
    }
  ]));

  // Status div
  const statusDiv = document.createElement("div");
  statusDiv.id = "drive_status_msg";
  statusDiv.style.marginTop = "15px";
  statusDiv.style.fontStyle = "italic";
  statusDiv.style.color = "#aaa";
  container.appendChild(statusDiv);
}

// Helper to show status
function setDriveStatus(msg, isError = false) {
  const el = document.getElementById("drive_status_msg");
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? "#ff5555" : "#aaa";
  }
}

// --- Picker Builders ---

function createPicker() {
  if (!pickerApiLoaded || !googleDriveAccessToken) {
    alert("Google Drive API not ready or not logged in.");
    return null;
  }
  return new google.picker.PickerBuilder()
    .setOAuthToken(googleDriveAccessToken)
    .setDeveloperKey(firebaseConfig.apiKey)
    .setAppId(firebaseConfig.messagingSenderId); // messagingSenderId is the Project Number
}

function showOpenAudioPicker() {
  const picker = createPicker();
  if (!picker) return;

  // DocsView with setIncludeFolders(true) allows navigation
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
  view.setIncludeFolders(true);
  // Combined audio and binary mime types
  view.setMimeTypes("audio/wav,audio/x-wav,audio/mp3,audio/mpeg,audio/x-aiff,audio/flac,application/x-flac,application/mac-binary,application/macbinary,application/octet-stream,application/binary");

  picker.addView(view)
    .setCallback(pickerCallbackOpen)
    .setTitle("Select Audio or Bin File")
    .build()
    .setVisible(true);
}

function showOpenBankPicker() {
  const picker = createPicker();
  if (!picker) return;

  const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
  view.setIncludeFolders(true);
  view.setMimeTypes("application/zip,application/x-zip-compressed");

  picker.addView(view)
    .setCallback(pickerCallbackOpen)
    .setTitle("Select Bank Zip")
    .build()
    .setVisible(true);
}

async function pickerCallbackOpen(data) {
  if (data[google.picker.Response.ACTION] == google.picker.Action.PICKED) {
    const doc = data[google.picker.Response.DOCUMENTS][0];
    const fileId = doc[google.picker.Document.ID];
    const name = doc[google.picker.Document.NAME];

    console.log("Picker selected:", name, fileId);
    setDriveStatus(`Downloading ${name}...`);
    await downloadFromDrive(fileId, name);
    setDriveStatus(`Loaded ${name}`, false);
  }
}

// --- Save Pickers (Folder Selection) ---

// We use the Picker to select a FOLDER, then we perform the upload to that folder ID.

let pendingUploadType = null; // 'sample' or 'bank'

function showSaveSamplePicker() {
  if (!editorSampleData) {
    alert("No sample loaded in the editor.");
    return;
  }
  pendingUploadType = 'sample';
  showFolderPicker("Select Destination Folder");
}

function showSaveBankPicker() {
  pendingUploadType = 'bank';
  showFolderPicker("Select Destination Folder for Bank");
}

function showFolderPicker(title) {
  const picker = createPicker();
  if (!picker) return;

  const view = new google.picker.View(google.picker.ViewId.FOLDERS);
  view.setMimeTypes("application/vnd.google-apps.folder");

  picker.addView(view)
    .setSelectableMimeTypes("application/vnd.google-apps.folder")
    .setCallback(pickerCallbackSave)
    .setTitle(title)
    .build()
    .setVisible(true);
}

async function pickerCallbackSave(data) {
  if (data[google.picker.Response.ACTION] == google.picker.Action.PICKED) {
    const doc = data[google.picker.Response.DOCUMENTS][0];
    const folderId = doc[google.picker.Document.ID];
    const folderName = doc[google.picker.Document.NAME];

    console.log("Picker selected folder:", folderName, folderId);

    if (pendingUploadType === 'sample') {
      await uploadToDrive(folderId);
    } else if (pendingUploadType === 'bank') {
      await uploadBankToDrive(folderId);
    }
    pendingUploadType = null;
  }
}

// Redefine listDriveFiles as a no-op/alias to updateLibrarianUI just in case it's called
// from global scope or init.
function listDriveFiles() {
  updateLibrarianUI();
}


async function uploadToDrive(folderId) {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access for this session.");
    return;
  }

  if (!editorSampleData) {
    alert("No sample loaded in the editor to upload.");
    return;
  }

  // Guard if folderId undefined (shouldn't happen with Picker)
  if (!folderId) {
    alert("No destination folder selected.");
    return;
  }

  const sampleNameField = (current_mode === "luma1") ? "sample_name" : "sample_name_mu";
  let name = document.getElementById(sampleNameField).value || "untitled";

  setDriveStatus("Preparing files for upload...");

  try {


    const binBlob = new Blob([editorSampleData], { type: 'application/octet-stream' });
    const binFilename = name.endsWith(".bin") ? name : name + ".bin";
    setDriveStatus(`Uploading ${binFilename}...`);
    await uploadBlobToDrive(binBlob, binFilename, 'application/octet-stream', folderId);

    const exportSampleRate = getSelectedSampleRate();
    const audioBuffer = createAudioBufferFromBytes(editorSampleData, exportSampleRate);
    if (!audioBuffer) throw new Error("Error creating audio buffer for WAV export");

    var channelData = audioBuffer.getChannelData(0);
    var encoder = new WavAudioEncoder(exportSampleRate, 1);
    encoder.encode([channelData]);
    const wavBlob = encoder.finish();
    const wavFilename = name.endsWith(".bin") ? name.slice(0, -4) + ".wav" : name + ".wav";

    setDriveStatus(`Uploading ${wavFilename}...`);
    await uploadBlobToDrive(wavBlob, wavFilename, 'audio/wav', folderId);

    alert(`Successfully uploaded both ${binFilename} and ${wavFilename} to Google Drive!`);
    setDriveStatus(`Upload Complete.`);
  } catch (error) {
    console.error("Upload failed:", error);
    alert("Upload failed: " + error.message);
    setDriveStatus("Upload failed.", true);
  }
}

async function uploadBlobToDrive(blob, filename, mimeType, folderId) {
  const metadata = {
    name: filename,
    mimeType: mimeType,
    parents: [folderId]
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${googleDriveAccessToken}`
      },
      body: form
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error.message);
  }
}

async function uploadBankToDrive(folderId) {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access for this session.");
    return;
  }

  if (!folderId) {
    alert("No destination folder selected.");
    return;
  }

  setDriveStatus(`Preparing bank for upload...`);

  try {

    // Get bank name (same logic as exportBankAsZip)
    const bankNameField = (current_mode === "luma1") ? "bank_name" : "bank_name_mu";
    const bnInput = document.getElementById(bankNameField);
    const bank_name = (bnInput ? bnInput.value : "Untitled") || "Untitled";

    // Create zip file (same logic as exportBankAsZip)
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

    // Generate zip blob and upload
    setDriveStatus(`Generating zip file...`);
    const zipBlob = await zip.generateAsync({ type: "blob" });

    const zipFilename = bank_name + ".zip";
    setDriveStatus(`Uploading ${zipFilename}...`);
    await uploadBlobToDrive(zipBlob, zipFilename, 'application/zip', folderId);

    alert(`Successfully uploaded ${zipFilename} to Google Drive!`);
    setDriveStatus(`Upload Complete.`);
  } catch (error) {
    console.error("Upload failed:", error);
    alert("Upload failed: " + error.message);
    setDriveStatus("Upload failed", true);
  }
}

// shareDriveFile removed as we no longer show a file list. users can share from Drive UI.

async function downloadFromDrive(fileId, filename) {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access.");
    return;
  }

  currentDropZone = null;
  setDriveStatus(`Downloading ${filename}...`);

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: {
          'Authorization': `Bearer ${googleDriveAccessToken}`
        }
      }
    );

    if (!response.ok) throw new Error("Failed to download file");

    const arrayBuffer = await response.arrayBuffer();

    if (typeof audio_init === 'function') audio_init();
    sampleName = trim_filename_ext(filename);
    binaryFileOriginal = arrayBuffer;
    fileReader = { result: arrayBuffer };

    const lowerFilename = filename.toLowerCase();
    const dummyEvent = { target: fileReader };

    if (lowerFilename.endsWith(".zip")) {
      if (typeof switchTab === 'function') switchTab(TAB_SAMPLE_EDITOR);
      if (typeof droppedFileLoadedZip === 'function') droppedFileLoadedZip(dummyEvent);
      console.log(`Loaded Bank ${filename} from Google Drive into Staging Slots.`);
    } else {
      if (typeof switchTab === 'function') switchTab(TAB_SAMPLE_EDITOR);

      if (lowerFilename.endsWith(".wav")) {
        if (typeof droppedFileLoadedWav === 'function') droppedFileLoadedWav(dummyEvent);
      } else if (lowerFilename.endsWith(".mp3")) {
        if (typeof droppedFileLoadedMp3 === 'function') droppedFileLoadedMp3(dummyEvent);
      } else if (lowerFilename.endsWith(".aif") || lowerFilename.endsWith(".aiff")) {
        if (typeof droppedFileLoadedAif === 'function') droppedFileLoadedAif(dummyEvent);
      } else if (lowerFilename.endsWith(".flac")) {
        if (typeof droppedFileLoadedFlac === 'function') droppedFileLoadedFlac(dummyEvent);
      } else {
        if (typeof droppedFileLoadedBIN === 'function') droppedFileLoadedBIN(dummyEvent);
      }
      console.log(`Loaded ${filename} from Google Drive into the Editor.`);
    }
  } catch (error) {
    console.error("Download failed:", error);
    setDriveStatus(`Error: ${error.message}`, true);
  } finally {
    //
  }
}

