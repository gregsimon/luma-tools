// luma_firmware.js
// Handles firmware version checking against GitHub repository

const GITHUB_API_URL = "https://api.github.com/repos/joebritt/luma1/contents/TeensyCode";

let availableFirmwareVersions = []; // Store the fetched versions

async function checkLatestFirmware() {
  const firmwareStatusDiv = document.getElementById("firmware_status");
  const checkBtn = document.getElementById("check_firmware_btn");
  const latestVersionSpan = document.getElementById("latest_firmware_version");
  const currentVersionSpan = document.getElementById("current_firmware_version_tab");

  if (!firmwareStatusDiv || !checkBtn) return;

  // Update current version display in the tab
  if (currentVersionSpan) {
    currentVersionSpan.innerText = luma_firmware_version || "Unknown";
  }

  checkBtn.disabled = true;
  checkBtn.value = "Checking...";
  firmwareStatusDiv.innerHTML = "Querying GitHub...";
  firmwareStatusDiv.className = ""; // Reset class

  try {
    const response = await fetch(GITHUB_API_URL);
    if (!response.ok) {
      throw new Error(`GitHub API Error: ${response.statusText}`);
    }
    const data = await response.json();

    // Filter for directories starting with "Prebuilt "
    const prebuiltDirs = data.filter(item =>
      item.type === "dir" && item.name.startsWith("Prebuilt ")
    );

    if (prebuiltDirs.length === 0) {
      firmwareStatusDiv.innerHTML = "No firmware versions found.";
      return;
    }

    // Extract versions and find the latest
    let latestVersion = "0.0.0";
    let latestDirName = "";
    let latestUrl = "";

    // Reset global list
    availableFirmwareVersions = [];

    prebuiltDirs.forEach(dir => {
      // Name format: "Prebuilt X.XXX"
      const versionPart = dir.name.substring(9).trim();

      // Store for dropdown
      availableFirmwareVersions.push({
        version: versionPart,
        name: dir.name,
        url: dir.url // Use API URL for direct fetching
      });

      if (compareFirmwareVersions(versionPart, latestVersion) > 0) {
        latestVersion = versionPart;
        latestDirName = dir.name;
        latestUrl = dir.html_url;
      }
    });

    // Populate the dropdown
    populateFirmwareDropdown();

    if (latestVersionSpan) {
      latestVersionSpan.innerText = latestVersion;
    }

    // Compare with connected device version
    const deviceVersion = luma_firmware_version || "0.0.0"; // fallback if unknown

    // Clean up device version string just in case it has extra characters
    const cleanDeviceVersion = deviceVersion.trim();

    if (cleanDeviceVersion === "Unknown" || cleanDeviceVersion === "") {
      firmwareStatusDiv.innerHTML = `Latest online is <b>${latestVersion}</b>. <br>Connect device to compare.`;
    } else if (compareFirmwareVersions(latestVersion, cleanDeviceVersion) > 0) {
      firmwareStatusDiv.innerHTML = `Update available! <br><a href="${latestUrl}" target="_blank">Download ${latestDirName} here</a>`;
      firmwareStatusDiv.className = "status_alert"; // Add styling class if needed
    } else {
      firmwareStatusDiv.innerHTML = "Your firmware is up to date.";
      firmwareStatusDiv.className = "status_success";
    }

  } catch (error) {
    console.error("Firmware check failed:", error);
    firmwareStatusDiv.innerHTML = "Failed to check updates. (Rate limit or network error)";
  } finally {
    checkBtn.disabled = false;
    checkBtn.value = "Check for Updates";
  }
}

// Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
function compareFirmwareVersions(v1, v2) {
  // The firmware versions appear to be decimal numbers (e.g. 0.940, 0.945)
  // Simple float comparison handles 0.95 > 0.945 correctly, whereas
  // splitting by dot would treat 95 < 945.

  // Strip any leading non-numeric characters (like 'v', 'V', space)
  // This regex replaces anything that is NOT a digit or a dot at the start of the string
  const v1Clean = v1.replace(/^[^\d.]+/, '');
  const v2Clean = v2.replace(/^[^\d.]+/, '');

  const f1 = parseFloat(v1Clean);
  const f2 = parseFloat(v2Clean);

  if (isNaN(f1) || isNaN(f2)) return 0;

  if (f1 > f2) return 1;
  if (f1 < f2) return -1;
  return 0;
}

function populateFirmwareDropdown() {
  const select = document.getElementById("firmware_version_select");
  if (!select) return;

  // Clear existing options
  select.innerHTML = '<option value="">-- Select Version --</option>';

  // Sort versions descending (newest first)
  availableFirmwareVersions.sort((a, b) => compareFirmwareVersions(b.version, a.version));

  availableFirmwareVersions.forEach(fw => {
    const opt = document.createElement("option");
    opt.value = fw.url;
    opt.innerText = `${fw.version} (${fw.name})`;
    select.appendChild(opt);
  });
}

function updateDownloadLink() {
  const select = document.getElementById("firmware_version_select");
  const downloadBtn = document.getElementById("download_selected_firmware_btn");
  const flashBtn = document.getElementById("flash_selected_firmware_btn");
  if (!select) return;

  const hasSelection = select.value !== "";
  if (downloadBtn) downloadBtn.disabled = !hasSelection;
  if (flashBtn) flashBtn.disabled = !hasSelection;
}

// Intel HEX parser
class IntelHex {
  constructor() {
    this.blocks = new Map(); // address -> Uint8Array
    this.minAddr = 0xFFFFFFFF;
    this.maxAddr = 0;
  }

  parse(hexString) {
    const lines = hexString.split(/\r?\n/);
    let upperAddr = 0;

    for (let line of lines) {
      if (line[0] !== ':') continue;

      const byteCount = parseInt(line.substr(1, 2), 16);
      const addr = parseInt(line.substr(3, 4), 16);
      const recordType = parseInt(line.substr(7, 2), 16);
      const fullAddr = (upperAddr << 16) | addr;

      if (recordType === 0) { // Data record
        const data = new Uint8Array(byteCount);
        for (let i = 0; i < byteCount; i++) {
          data[i] = parseInt(line.substr(9 + i * 2, 2), 16);
        }

        // Store in 1k blocks
        let currentAddr = fullAddr;
        let dataOffset = 0;
        while (dataOffset < byteCount) {
          const blockAddr = currentAddr & ~(1024 - 1);
          const offsetInBlock = currentAddr & (1024 - 1);
          const spaceInBlock = 1024 - offsetInBlock;
          const toCopy = Math.min(spaceInBlock, byteCount - dataOffset);

          if (!this.blocks.has(blockAddr)) {
            this.blocks.set(blockAddr, new Uint8Array(1024).fill(0xFF));
          }
          const block = this.blocks.get(blockAddr);
          block.set(data.subarray(dataOffset, dataOffset + toCopy), offsetInBlock);

          currentAddr += toCopy;
          dataOffset += toCopy;
        }

        this.minAddr = Math.min(this.minAddr, fullAddr);
        this.maxAddr = Math.max(this.maxAddr, fullAddr + byteCount);
      } else if (recordType === 4) { // Extended Linear Address Record
        upperAddr = parseInt(line.substr(9, 4), 16);
      } else if (recordType === 1) { // End of File
        break;
      }
    }
  }

  getSortedBlocks() {
    return Array.from(this.blocks.keys()).sort((a, b) => a - b);
  }
}

async function flashSelectedFirmware() {
  if (!navigator.hid) {
    alert("WebHID is not supported in this browser. Please use a modern browser like Chrome or Edge.");
    return;
  }

  const select = document.getElementById("firmware_version_select");
  if (!select || select.value === "") return;

  const apiUrl = select.value;
  const statusDiv = document.getElementById("firmware_status");
  const progressContainer = document.getElementById("firmware_progress_container");
  const progressBar = document.getElementById("firmware_progress_bar");
  const progressPercent = document.getElementById("firmware_progress_percent");
  const progressLabel = document.getElementById("firmware_progress_label");

  const setStatus = (msg, isError = false) => {
    statusDiv.innerHTML = msg;
    statusDiv.className = isError ? "status_alert" : "";
    console.log(msg);
  };

  const updateProgress = (label, percent) => {
    progressLabel.innerText = label;
    progressPercent.innerText = `${Math.round(percent)}%`;
    progressBar.style.width = `${percent}%`;
  };

  // Helper to send report (tries Output Report first, then Feature Report)
  const sendReport = async (device, reportId, data, useFeature = false) => {
    const maxRetries = 3;
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        if (useFeature) {
          await device.sendFeatureReport(reportId, data);
        } else {
          await device.sendReport(reportId, data);
        }
        return; // Success
      } catch (e) {
        lastError = e;
        console.warn(`HID write attempt ${i + 1} failed (ID: ${reportId}, Size: ${data.byteLength}, Feature: ${useFeature}):`, e);
        
        // If it's a permission/busy error, wait a bit and retry
        if (e.name === "NotAllowedError" || e.name === "NetworkError") {
          await new Promise(r => setTimeout(r, 200 * (i + 1)));
          continue;
        }
        throw e; // For other errors, fail immediately
      }
    }
    
    // If we reach here, all retries failed. Try the opposite type as a last resort.
    try {
      if (useFeature) {
        await device.sendReport(reportId, data);
      } else {
        await device.sendFeatureReport(reportId, data);
      }
      console.log("Fallback report type succeeded.");
      return;
    } catch (e) {
      console.error("All HID write attempts and fallbacks failed.", e);
      throw new Error(`HID write failed after retries: ${lastError.message}`);
    }
  };

  try {
    progressContainer.style.display = "block";
    updateProgress("Downloading...", 0);
    setStatus("Fetching firmware info...");

    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error("Failed to fetch directory info");

    const files = await response.json();
    const hexFileInfo = files.find(f => f.name.endsWith(".hex"));

    if (!hexFileInfo || !hexFileInfo.download_url) {
      throw new Error("No .hex file found in this version folder.");
    }

    setStatus(`Downloading ${hexFileInfo.name}...`);
    const hexResp = await fetch(hexFileInfo.download_url);
    if (!hexResp.ok) throw new Error("Failed to download hex file");
    const hexText = await hexResp.text();

    setStatus("Parsing hex file...");
    const ih = new IntelHex();
    ih.parse(hexText);

    if (ih.blocks.size === 0) {
      throw new Error("Hex file is empty or invalid.");
    }

    // Step 1: Reboot to bootloader
    setStatus("Please select your Luma-1 device to begin the update...");
    
    try {
      if (navigator.serial) {
        const ports = await navigator.serial.getPorts();
        let port = ports.find(p => p.getInfo().usbVendorId === TEENSY_VID);
        
        if (!port) {
          port = await navigator.serial.requestPort({
            filters: [{ usbVendorId: TEENSY_VID }]
          });
        }
        
        setStatus("Rebooting into bootloader mode...");
        await port.open({ baudRate: 134 });
        await port.close();
        
        // Wait for the device to disconnect and reconnect as bootloader
        // Increased wait time for macOS stability
        setStatus("Waiting for device to enter bootloader mode...");
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      console.log("Web Serial reboot failed or cancelled", e);
      setStatus("Could not reboot automatically. Please press the button on the Teensy manually.");
      await new Promise(r => setTimeout(r, 2000));
    }

    // Step 2: Connect via WebHID (HalfKay)
    setStatus("Please select the 'Teensy HalfKay' device...");
    let device;
    try {
      const hidDevices = await navigator.hid.requestDevice({
        filters: [{ vendorId: TEENSY_VID, productId: TEENSY_BOOTLOADER_PID }]
      });

      if (hidDevices.length === 0) {
        throw new Error("No Teensy bootloader device selected.");
      }
      device = hidDevices[0];
      console.log("HID Device selected:", device);
    } catch (e) {
      throw new Error("Failed to connect to bootloader. " + e.message);
    }

    if (!device.opened) {
      await device.open();
    }

    // Determine report size and type from collections
    let outputReportSize = 1088;
    let useFeatureReport = false;
    let bootloaderCollection = null;

    if (device.collections) {
      for (const collection of device.collections) {
        if (collection.usagePage === 0xFF9C) {
          bootloaderCollection = collection;
          console.log(`Found Teensy Bootloader Collection (Usage: 0x${collection.usage.toString(16)})`);
          
          const outRep = collection.outputReports.find(r => r.reportId === 0);
          const featRep = collection.featureReports.find(r => r.reportId === 0);
          
          const bestRep = outRep || featRep;
          useFeatureReport = !outRep && !!featRep;

          if (bestRep && bestRep.items) {
            let totalBits = 0;
            for (const item of bestRep.items) {
              totalBits += item.reportSize * item.reportCount;
            }
            const calculatedSize = totalBits / 8;
            if (calculatedSize > 0) {
              outputReportSize = calculatedSize;
              console.log(`Calculated report size: ${outputReportSize} bytes, Use Feature: ${useFeatureReport}`);
            }
          }
          break;
        }
      }
    }

    // Step 3: Flash blocks
    const sortedAddrs = ih.getSortedBlocks();
    const totalBlocks = sortedAddrs.length;
    let blocksDone = 0;

    setStatus("Flashing... Do not disconnect the device.");
    for (const addr of sortedAddrs) {
      const block = ih.blocks.get(addr);
      
      const reportData = new Uint8Array(outputReportSize);
      reportData[0] = addr & 0xFF;
      reportData[1] = (addr >> 8) & 0xFF;
      reportData[2] = (addr >> 16) & 0xFF;
      reportData.set(block, 64);

      await sendReport(device, 0, reportData, useFeatureReport);
      
      blocksDone++;
      const percent = (blocksDone / totalBlocks) * 100;
      updateProgress("Flashing...", percent);

      // Erase takes time on the first block
      if (blocksDone === 1) {
        await new Promise(r => setTimeout(r, 600));
      }
    }

    // Step 4: Reset
    setStatus("Resetting device...");
    updateProgress("Finalizing...", 100);
    
    const resetData = new Uint8Array(outputReportSize);
    resetData[0] = 0xFF;
    resetData[1] = 0xFF;
    resetData[2] = 0xFF;
    await sendReport(device, 0, resetData, useFeatureReport);

    await device.close();
    
    setStatus("Update successful! Your Luma-1 is restarting.", false);
    setTimeout(() => {
      progressContainer.style.display = "none";
      if (typeof checkLatestFirmware === 'function') checkLatestFirmware();
    }, 3000);

  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message}`, true);
    setTimeout(() => {
      progressContainer.style.display = "none";
    }, 10000);
  }
}

const TEENSY_VID = 0x16C0;
const TEENSY_BOOTLOADER_PID = 0x0478;

async function downloadSelectedFirmware() {
  const select = document.getElementById("firmware_version_select");
  const btn = document.getElementById("download_selected_firmware_btn");
  if (!select || select.value === "" || !btn) return;

  const apiUrl = select.value;
  const originalText = btn.value;

  btn.disabled = true;
  btn.value = "Finding hex file...";

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error("Failed to fetch directory info");

    const files = await response.json();
    const hexFile = files.find(f => f.name.endsWith(".hex")); // robust search

    if (hexFile && hexFile.download_url) {
      // Force download by fetching blob and creating anchor
      btn.value = "Downloading...";
      const fileResp = await fetch(hexFile.download_url);
      if (!fileResp.ok) throw new Error("Failed to download file");

      const blob = await fileResp.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = hexFile.name; // Use original filename
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } else {
      alert("No .hex file found in this version folder.");
    }
  } catch (e) {
    console.error(e);
    alert("Error finding firmware file.");
  } finally {
    btn.disabled = false;
    btn.value = originalText;
  }
}
