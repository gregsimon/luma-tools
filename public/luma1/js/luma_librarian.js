// Google Drive librarian and authentication functions

let googleDriveAccessToken = null;
let lumaFolderId = null;
let currentDriveFolderId = null;
let driveFolderStack = []; // Stack of {id, name} for breadcrumbs/navigation

function login() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');

  firebase.auth().signInWithPopup(provider).then((result) => {
    googleDriveAccessToken = result.credential.accessToken;
    console.log("Drive Access Token acquired");
    
    const libTab = document.getElementById("librarian_tab");
    if (libTab && libTab.style.display !== "none") {
      listDriveFiles();
    }
  }).catch((error) => {
    console.error("Login failed:", error);
    alert("Login failed: " + error.message);
  });
}

function logout() {
  firebase.auth().signOut().then(() => {
    googleDriveAccessToken = null;
    lumaFolderId = null;
    currentDriveFolderId = null;
    driveFolderStack = [];
  }).catch((error) => {
    console.error("Logout failed:", error);
  });
}

async function getOrCreateRootFolder() {
  if (lumaFolderId) return lumaFolderId;

  console.log("Searching for 'luma_librarian' folder...");
  const query = encodeURIComponent("name = 'luma_librarian' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
    {
      headers: {
        'Authorization': `Bearer ${googleDriveAccessToken}`
      }
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error("Folder search failed: " + errorData.error.message);
  }

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    lumaFolderId = data.files[0].id;
    if (!currentDriveFolderId) currentDriveFolderId = lumaFolderId;
    return lumaFolderId;
  }

  console.log("Creating 'luma_librarian' folder...");
  const createResponse = await fetch(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${googleDriveAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'luma_librarian',
        mimeType: 'application/vnd.google-apps.folder'
      })
    }
  );

  if (!createResponse.ok) {
    const errorData = await createResponse.json();
    throw new Error("Folder creation failed: " + errorData.error.message);
  }

  const newData = await createResponse.json();
  lumaFolderId = newData.id;
  if (!currentDriveFolderId) currentDriveFolderId = lumaFolderId;
  return lumaFolderId;
}

async function listDriveFiles(targetFolderId = null, folderName = null) {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access for this session.");
    return;
  }

  const listContainer = document.getElementById("drive_file_list");
  if (!listContainer) return;
  listContainer.innerHTML = "Listing files...";

  try {
    const rootId = await getOrCreateRootFolder();
    
    if (targetFolderId) {
      if (targetFolderId === rootId) {
        driveFolderStack = [];
        currentDriveFolderId = rootId;
      } else if (targetFolderId === "UP") {
        driveFolderStack.pop();
        currentDriveFolderId = driveFolderStack.length > 0 ? driveFolderStack[driveFolderStack.length - 1].id : rootId;
      } else {
        if (driveFolderStack.length === 0 || driveFolderStack[driveFolderStack.length - 1].id !== targetFolderId) {
          driveFolderStack.push({ id: targetFolderId, name: folderName });
        }
        currentDriveFolderId = targetFolderId;
      }
    } else if (!currentDriveFolderId) {
      currentDriveFolderId = rootId;
    }

    const query = encodeURIComponent(`'${currentDriveFolderId}' in parents and (name contains '.bin' or name contains '.wav' or name contains '.aif' or name contains '.aiff' or name contains '.flac' or name contains '.zip' or mimeType = 'application/vnd.google-apps.folder') and trashed = false`);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=folder,name&fields=files(id, name, mimeType)`,
      {
        headers: {
          'Authorization': `Bearer ${googleDriveAccessToken}`
        }
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error.message);
    }

    const data = await response.json();
    listContainer.innerHTML = "";

    const navDiv = document.createElement("div");
    navDiv.style.padding = "5px";
    navDiv.style.marginBottom = "10px";
    navDiv.style.borderBottom = "1px dashed #555";
    navDiv.style.fontSize = "0.9em";
    
    const rootLink = document.createElement("a");
    rootLink.href = "#";
    rootLink.textContent = "luma_librarian";
    rootLink.onclick = (e) => { e.preventDefault(); listDriveFiles(rootId); };
    navDiv.appendChild(rootLink);

    driveFolderStack.forEach((f, idx) => {
      navDiv.appendChild(document.createTextNode(" / "));
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = f.name;
      link.onclick = (e) => { 
        e.preventDefault(); 
        driveFolderStack = driveFolderStack.slice(0, idx + 1);
        listDriveFiles(f.id, f.name); 
      };
      navDiv.appendChild(link);
    });
    listContainer.appendChild(navDiv);

    if (currentDriveFolderId !== rootId) {
      const upDiv = document.createElement("div");
      upDiv.style.padding = "8px";
      upDiv.style.cursor = "pointer";
      upDiv.style.color = "#aaa";
      upDiv.innerHTML = "<strong>📁 .. (Parent Folder)</strong>";
      upDiv.onclick = () => listDriveFiles("UP");
      listContainer.appendChild(upDiv);
    }
    
    if (data.files && data.files.length > 0) {
      data.files.forEach((file, index) => {
        const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
        const div = document.createElement("div");
        div.style.padding = "8px";
        div.style.borderBottom = "1px solid #333";
        div.style.display = "flex";
        div.style.justifyContent = "space-between";
        div.style.alignItems = "center";
        // Alternate row colors for better legibility
        if (index % 2 === 0) {
          div.style.backgroundColor = "#2a2a2a";
        }
        
        const nameSpan = document.createElement("span");
        nameSpan.textContent = (isFolder ? "📁 " : "📄 ") + file.name;
        if (isFolder) {
          nameSpan.style.cursor = "pointer";
          nameSpan.style.fontWeight = "bold";
          nameSpan.onclick = () => listDriveFiles(file.id, file.name);
        }
        
        const buttonContainer = document.createElement("div");
        buttonContainer.style.display = "flex";
        buttonContainer.style.gap = "8px";
        
        const actionBtn = document.createElement("input");
        actionBtn.type = "button";
        if (isFolder) {
          actionBtn.value = "Open";
          actionBtn.onclick = () => listDriveFiles(file.id, file.name);
        } else {
          actionBtn.value = file.name.toLowerCase().endsWith(".zip") ? "Load Bank into Slots" : "Load into Editor";
          actionBtn.onclick = () => downloadFromDrive(file.id, file.name);
        }
        
        // Add Share button for files (not folders)
        if (!isFolder) {
          const shareBtn = document.createElement("input");
          shareBtn.type = "button";
          shareBtn.value = "Share";
          shareBtn.onclick = () => shareDriveFile(file.id, file.name);
          buttonContainer.appendChild(shareBtn);
        }
        
        buttonContainer.appendChild(actionBtn);
        div.appendChild(nameSpan);
        div.appendChild(buttonContainer);
        listContainer.appendChild(div);
      });
    } else {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.padding = "10px";
      emptyMsg.textContent = "This folder is empty.";
      listContainer.appendChild(emptyMsg);
    }
  } catch (error) {
    console.error("Error listing Drive files:", error);
    listContainer.innerHTML = "Error listing files: " + error.message;
  }
}

async function uploadToDrive() {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access for this session.");
    return;
  }

  if (!editorSampleData) {
    alert("No sample loaded in the editor to upload.");
    return;
  }

  const sampleNameField = (current_mode === "luma1") ? "sample_name" : "sample_name_mu";
  let name = document.getElementById(sampleNameField).value || "untitled";
  
  const listContainer = document.getElementById("drive_file_list");
  const originalStatus = listContainer ? listContainer.innerHTML : "";
  if (listContainer) listContainer.innerHTML = `Preparing files for upload...`;

  try {
    const rootId = await getOrCreateRootFolder();
    const folderId = currentDriveFolderId || rootId;
    
    const binBlob = new Blob([editorSampleData], { type: 'application/octet-stream' });
    const binFilename = name.endsWith(".bin") ? name : name + ".bin";
    if (listContainer) listContainer.innerHTML = `Uploading ${binFilename}...`;
    await uploadBlobToDrive(binBlob, binFilename, 'application/octet-stream', folderId);

    const exportSampleRate = getSelectedSampleRate();
    const audioBuffer = createAudioBufferFromBytes(editorSampleData, exportSampleRate);
    if (!audioBuffer) throw new Error("Error creating audio buffer for WAV export");
    
    var channelData = audioBuffer.getChannelData(0);
    var encoder = new WavAudioEncoder(exportSampleRate, 1);
    encoder.encode([channelData]);
    const wavBlob = encoder.finish();
    const wavFilename = name.endsWith(".bin") ? name.slice(0, -4) + ".wav" : name + ".wav";
    
    if (listContainer) listContainer.innerHTML = `Uploading ${wavFilename}...`;
    await uploadBlobToDrive(wavBlob, wavFilename, 'audio/wav', folderId);

    alert(`Successfully uploaded both ${binFilename} and ${wavFilename} to your Google Drive!`);
    listDriveFiles(); 
  } catch (error) {
    console.error("Upload failed:", error);
    alert("Upload failed: " + error.message);
    if (listContainer) listContainer.innerHTML = originalStatus;
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

async function uploadBankToDrive() {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access for this session.");
    return;
  }

  const listContainer = document.getElementById("drive_file_list");
  const originalStatus = listContainer ? listContainer.innerHTML : "";
  if (listContainer) listContainer.innerHTML = `Preparing bank for upload...`;

  try {
    const rootId = await getOrCreateRootFolder();
    const folderId = currentDriveFolderId || rootId;

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
    if (listContainer) listContainer.innerHTML = `Generating zip file...`;
    const zipBlob = await zip.generateAsync({ type: "blob" });
    
    const zipFilename = bank_name + ".zip";
    if (listContainer) listContainer.innerHTML = `Uploading ${zipFilename}...`;
    await uploadBlobToDrive(zipBlob, zipFilename, 'application/zip', folderId);

    alert(`Successfully uploaded ${zipFilename} to your Google Drive!`);
    listDriveFiles();
  } catch (error) {
    console.error("Upload failed:", error);
    alert("Upload failed: " + error.message);
    if (listContainer) listContainer.innerHTML = originalStatus;
  }
}

async function shareDriveFile(fileId, filename) {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access.");
    return;
  }

  try {
    // First, try to create a permission to allow anyone with the link to view (read-only)
    let permissionCreated = false;
    try {
      const permissionResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${googleDriveAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone'
          })
        }
      );

      if (permissionResponse.ok) {
        permissionCreated = true;
      } else {
        // Check if permission already exists (409) or if it's a scope issue
        const errorData = await permissionResponse.json();
        if (errorData.error && errorData.error.code === 409) {
          // Permission already exists, that's fine
          permissionCreated = true;
        } else if (errorData.error && errorData.error.message && errorData.error.message.includes('insufficient')) {
          // Insufficient permissions - we'll still try to get/create a link
          console.warn("Insufficient permissions to create share link, but will try to get existing link");
        }
      }
    } catch (permError) {
      console.warn("Error creating permission:", permError);
      // Continue anyway to try to get the link
    }

    // Get the file metadata to retrieve the shareable link
    let shareableLink = `https://drive.google.com/file/d/${fileId}/view`;
    
    try {
      const fileResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink,webContentLink`,
        {
          headers: {
            'Authorization': `Bearer ${googleDriveAccessToken}`
          }
        }
      );

      if (fileResponse.ok) {
        const fileData = await fileResponse.json();
        shareableLink = fileData.webViewLink || fileData.webContentLink || shareableLink;
      }
    } catch (linkError) {
      console.warn("Error getting file link:", linkError);
      // Use the constructed link as fallback
    }

    // Copy to clipboard if possible, otherwise show in prompt
    const message = permissionCreated 
      ? `Shareable link for "${filename}" copied to clipboard!\n\n${shareableLink}\n\nAnyone with this link can view the file (read-only).`
      : `Link for "${filename}" copied to clipboard!\n\n${shareableLink}\n\nNote: You may need to manually enable sharing in Google Drive for this link to work.`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareableLink);
      alert(message);
    } else {
      // Fallback: show in prompt
      prompt(`Shareable link for "${filename}" (read-only):`, shareableLink);
    }
  } catch (error) {
    console.error("Share failed:", error);
    alert("Failed to create shareable link: " + error.message + "\n\nYou may need to share the file manually through Google Drive.");
  }
}

async function downloadFromDrive(fileId, filename) {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access.");
    return;
  }

  currentDropZone = null;
  const listContainer = document.getElementById("drive_file_list");
  const originalStatus = listContainer ? listContainer.innerHTML : "";
  if (listContainer) listContainer.innerHTML = `Downloading ${filename}...`;

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
    if (lowerFilename.endsWith(".zip")) {
      if (typeof switchTab === 'function') switchTab(TAB_SAMPLE_EDITOR);
      if (typeof droppedFileLoadedZip === 'function') droppedFileLoadedZip();
      console.log(`Loaded Bank ${filename} from Google Drive into Staging Slots.`);
    } else {
      if (typeof switchTab === 'function') switchTab(TAB_SAMPLE_EDITOR);

      if (lowerFilename.endsWith(".wav")) {
        if (typeof droppedFileLoadedWav === 'function') droppedFileLoadedWav();
      } else {
        if (typeof droppedFileLoadedBIN === 'function') droppedFileLoadedBIN();
      }
      console.log(`Loaded ${filename} from Google Drive into the Editor.`);
    }
  } catch (error) {
    console.error("Download failed:", error);
  } finally {
    if (listContainer) {
      listContainer.innerHTML = originalStatus;
      listDriveFiles();
    }
  }
}

