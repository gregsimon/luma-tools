// Device actions are explicit. One transfer owns the port and both controls.
let picoOperationInProgress = false;

function setPicoROMBusy(busy) {
  picoOperationInProgress = busy;
  for (const id of ['read_picorom', 'program_picorom']) {
    const button = de(id);
    if (button) button.disabled = busy;
  }
}

async function uploadToPicoROMClicked() {
  if (picoOperationInProgress) return;
  setPicoROMBusy(true);
  try {
    // Export and programming use the same committed bytes, in physical slot order.
    const rom = buildMuRomBank();
    const name = de('bank_name_mu').value.trim() || 'Untitled';
    showMessage('Choose the PicoROM to program.');
    await window.PicoROM.upload(rom.buffer, (written, total) => {
      showMessage(`Programming PicoROM: ${Math.floor(written / total * 100)}%`);
    }, name);
    showMessage('PicoROM programming complete.');
  } catch (error) {
    showMessage(`PicoROM programming failed: ${error.message}`, true);
  } finally {
    setPicoROMBusy(false);
  }
}

async function readFromPicoROMClicked() {
  if (picoOperationInProgress) return;
  setPicoROMBusy(true);
  try {
    invalidateImports();
    const generation = editorImportGeneration;
    showMessage('Choose the PicoROM to read.');
    const image = await window.PicoROM.readImage((read, total) => {
      if (generation === editorImportGeneration) {
        showMessage(`Reading PicoROM: ${Math.floor(read / total * 100)}%`);
      }
    });
    // A newer import, edit or clear always wins over an unfinished hardware read.
    if (generation !== editorImportGeneration) return;
    if (image.byteLength !== 131072 && image.byteLength !== 262144) {
      throw new Error('Expected a complete 128 KiB bank or 256 KiB image.');
    }
    // Use the normal transactional importer, including the 256 KiB half chooser.
    await importFiles([new File([image], 'PicoROM.bin')]);
  } catch (error) {
    showMessage(`PicoROM read failed: ${error.message}`, true);
  } finally {
    setPicoROMBusy(false);
  }
}
