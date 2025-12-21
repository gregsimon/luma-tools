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

  console.log("Searching for 'luma1_sounds' folder...");
  const query = encodeURIComponent("name = 'luma1_sounds' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
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

  console.log("Creating 'luma1_sounds' folder...");
  const createResponse = await fetch(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${googleDriveAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'luma1_sounds',
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

    const query = encodeURIComponent(`'${currentDriveFolderId}' in parents and (name contains '.bin' or name contains '.wav' or name contains '.zip' or mimeType = 'application/vnd.google-apps.folder') and trashed = false`);
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
    rootLink.textContent = "luma1_sounds";
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
      data.files.forEach(file => {
        const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
        const div = document.createElement("div");
        div.style.padding = "8px";
        div.style.borderBottom = "1px solid #333";
        div.style.display = "flex";
        div.style.justifyContent = "space-between";
        div.style.alignItems = "center";
        
        const nameSpan = document.createElement("span");
        nameSpan.textContent = (isFolder ? "📁 " : "📄 ") + file.name;
        if (isFolder) {
          nameSpan.style.cursor = "pointer";
          nameSpan.style.fontWeight = "bold";
          nameSpan.onclick = () => listDriveFiles(file.id, file.name);
        }
        
        const actionBtn = document.createElement("input");
        actionBtn.type = "button";
        if (isFolder) {
          actionBtn.value = "Open";
          actionBtn.onclick = () => listDriveFiles(file.id, file.name);
        } else {
          actionBtn.value = file.name.toLowerCase().endsWith(".zip") ? "Load Bank into Slots" : "Load into Editor";
          actionBtn.onclick = () => downloadFromDrive(file.id, file.name);
        }
        
        div.appendChild(nameSpan);
        div.appendChild(actionBtn);
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

async function downloadFromDrive(fileId, filename) {
  if (!googleDriveAccessToken) {
    alert("Please click 'Login with Google' again to enable Google Drive access.");
    return;
  }

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

