// PicoROM specific interaction handlers

// Upload directly to a PicoROM
async function uploadToPicoROMClicked() {
  const statusDiv = document.createElement('div');
  try {
    // First, create the ROM binary data
    const SLOT_SIZE = 16384;
    const NUM_SLOTS = 8;
    const TOTAL_SIZE = SLOT_SIZE * NUM_SLOTS;
    const romBuffer = new Uint8Array(TOTAL_SIZE);

    const slot_export_order = [7, 6, 1, 0, 2, 3, 5, 4];
    for (let i = 0; i < NUM_SLOTS; i++) {
      const idx = slot_export_order[i];
      if (!bank[idx] || !bank[idx].sampleData) {
        // If slot is empty, leave as zeros
        continue;
      }
      // Copy sample data directly (already in uLaw format)
      const slotData = bank[idx].sampleData;
      const copyLength = Math.min(SLOT_SIZE, slotData.length);
      romBuffer.set(slotData.subarray(0, copyLength), i * SLOT_SIZE);
    }
    
    // Get the bank name from the HTML
    const bankName = document.getElementById("bank_name_mu").value || "Untitled";
    
    // Show a status message
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '50%';
    statusDiv.style.left = '50%';
    statusDiv.style.transform = 'translate(-50%, -50%)';
    statusDiv.style.padding = '20px';
    statusDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    statusDiv.style.color = 'white';
    statusDiv.style.borderRadius = '5px';
    statusDiv.style.zIndex = '1000';
    document.body.appendChild(statusDiv);
    
    statusDiv.textContent = 'Requesting PicoROM device...';
    
    // Upload the ROM to the PicoROM with the bank name
    await window.PicoROM.upload(romBuffer.buffer, (uploaded, total) => {
      const percent = Math.floor((uploaded / total) * 100);
      statusDiv.textContent = `Uploading to PicoROM: ${percent}%`;
    }, bankName);
    
    statusDiv.textContent = 'Upload complete!';
    setTimeout(() => {
      document.body.removeChild(statusDiv);
    }, 2000);
    
  } catch (error) {
    if (statusDiv.parentElement) document.body.removeChild(statusDiv);
    console.error('Error uploading to PicoROM:', error);
    alert(`PicoROM upload failed: ${error.message}`);
  }
}

// Read from a PicoROM and load into the editor
async function readFromPicoROMClicked() {
  if (typeof audio_init === 'function') audio_init();
  const statusDiv = document.createElement('div');
  try {
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '50%';
    statusDiv.style.left = '50%';
    statusDiv.style.transform = 'translate(-50%, -50%)';
    statusDiv.style.padding = '20px';
    statusDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    statusDiv.style.color = 'white';
    statusDiv.style.borderRadius = '5px';
    statusDiv.style.zIndex = '1000';
    document.body.appendChild(statusDiv);
    
    statusDiv.textContent = 'Requesting PicoROM device...';

    const imageBuffer = await window.PicoROM.readImage((read, total) => {
        const percent = Math.floor((read / total) * 100);
        statusDiv.textContent = `Reading from PicoROM: ${percent}%`;
    });
    
    statusDiv.textContent = 'Read complete! Loading bank...';

    // We have the ROM, now load it into the bank slots
    const rom = new Uint8Array(imageBuffer);
    const SLOT_SIZE = 16384;
    const NUM_SLOTS = 8;
    const slot_import_order = [7, 6, 1, 0, 2, 3, 5, 4];

    for (let i = 0; i < NUM_SLOTS; i++) {
        const idx = slot_import_order[i];
        const offset = i * SLOT_SIZE;
        const chunk = rom.slice(offset, offset + SLOT_SIZE);

        bank[idx].sampleData = new Uint8Array(chunk);
        bank[idx].sampleLength = chunk.length;
        bank[idx].name = `Slot ${idx + 1}`; // Provide a default name
        bank[idx].original_binary = chunk.buffer;
    }

    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();

    setTimeout(() => {
      if (statusDiv.parentElement) document.body.removeChild(statusDiv);
    }, 2000);

  } catch (error) {
    if (statusDiv.parentElement) {
        document.body.removeChild(statusDiv);
    }
    console.error('Error reading from PicoROM:', error);
    alert(`PicoROM read failed: ${error.message}`);
  }
}

