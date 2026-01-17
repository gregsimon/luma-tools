// luma_firmware.js
// Handles firmware version checking against GitHub repository

const GITHUB_API_URL = "https://api.github.com/repos/joebritt/luma1/contents/TeensyCode";

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

    prebuiltDirs.forEach(dir => {
      // Name format: "Prebuilt X.XXX"
      const versionPart = dir.name.substring(9).trim();
      if (compareFirmwareVersions(versionPart, latestVersion) > 0) {
        latestVersion = versionPart;
        latestDirName = dir.name;
        latestUrl = dir.html_url;
      }
    });

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
