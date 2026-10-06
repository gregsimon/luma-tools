// Waveform rendering and canvas interaction functions

function resizeCanvasToParent() {
  // editor canvas
  var canvas = document.getElementById("editor_canvas");
  if (canvas && canvas.parentElement) {
    canvas.width = canvas.parentElement.offsetWidth;
  }

  var sbCanvas = document.getElementById("scrollbar_canvas");
  if (sbCanvas && sbCanvas.parentElement) {
    sbCanvas.width = sbCanvas.parentElement.offsetWidth;
  }

  // slot canvases
  for (let i = 0; i < 10; i++) {
    canvas = document.getElementById("canvas_slot_" + i);
    if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
      canvas.width = Math.round(canvas.height * canvas.clientWidth / canvas.clientHeight);
    }
  }
}

function redrawAllWaveforms() {
  drawEditorCanvas();
  drawSlotWaveforms();
}

// Render the audio waveform and endpoint UI into the canvas
function drawEditorCanvas() {
  var canvas = document.getElementById("editor_canvas");
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext("2d");

  ctx.fillStyle = editor_waveform_bg;
  ctx.fillRect(0, 0, w, h);

  // Draw zero-crossing reference line (center amplitude line)
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.restore();

  if (isImporting) {
    ctx.fillStyle = editor_waveform_fg;
    ctx.font = "20px InterstateRegular, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Importing...", w / 2, h / 2);
    return;
  }

  if (editorSampleData && editorSampleLength > 0) {
    const visibleSamples = editorSampleLength / editorZoomLevel;

    // Clamp scroll position
    editorViewStart = Math.max(0, Math.min(editorViewStart, editorSampleLength - visibleSamples));

    const sampleToX = (s) => ((s - editorViewStart) * w) / visibleSamples;

    // Keep the selected audio bright and the unselected audio opaque and muted.
    // Paint these layers before the blue handles so their contrast never changes.
    const inX = sampleToX(editor_in_point);
    const outX = sampleToX(editor_out_point + 1);
    const selectedLeft = Math.max(0, Math.min(w, inX));
    const selectedRight = Math.max(0, Math.min(w, outX));
    ctx.fillStyle = '#242329';
    ctx.fillRect(0, 0, w, h);
    if (selectedRight > selectedLeft) {
      ctx.fillStyle = '#343239';
      ctx.fillRect(selectedLeft, 0, selectedRight - selectedLeft, h);
    }
    ctx.strokeStyle = '#675f7a';
    drawWaveform(w, h, ctx, editorSampleData, editorSampleLength, editorViewStart, visibleSamples);
    if (selectedRight > selectedLeft) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(selectedLeft, 0, selectedRight - selectedLeft, h);
      ctx.clip();
      ctx.strokeStyle = editor_waveform_fg;
      drawWaveform(w, h, ctx, editorSampleData, editorSampleLength, editorViewStart, visibleSamples);
      ctx.restore();
    }

    const tab_side = 15;
    ctx.fillStyle = drag_handle_color;
    if (inX >= -tab_side && inX <= w) {
      ctx.fillRect(Math.min(w - 1, inX), 0, 1, h);
      ctx.beginPath();
      ctx.moveTo(inX, 0);
      ctx.lineTo(inX + tab_side, 0);
      ctx.lineTo(inX, tab_side);
      ctx.closePath();
      ctx.fill();
    }
    if (outX >= 0 && outX <= w + tab_side) {
      ctx.fillRect(outX - 1, 0, 1, h);
      ctx.beginPath();
      ctx.moveTo(outX - 1 - tab_side, h);
      ctx.lineTo(outX, h - tab_side);
      ctx.lineTo(outX, h);
      ctx.closePath();
      ctx.fill();
    }

    // Draw playback cursor if playing editor sound
    if (playingSound && playingSound.isEditorSound && typeof actx !== 'undefined' && actx && typeof getSelectedSampleRate === 'function') {
      ctx.save();
      let elapsed = actx.currentTime - playbackStartTime;
      
      if (playingSound.loop) {
        const loopDuration = playingSound.loopDuration;
        if (loopDuration > 0) {
          elapsed = elapsed % loopDuration;
        }
      }

      const scale = playingSound.pitchScale || 1.0;
      const currentSample = (playingSound.playbackOffset + elapsed * scale) * getSelectedSampleRate();
      const cursorX = sampleToX(currentSample);

      if (cursorX >= 0 && cursorX <= w) {
        ctx.strokeStyle = "rgb(255, 255, 255)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX, h);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawScrollbar();
  } else {
    ctx.fillStyle = slot_waveform_fg;
    ctx.textAlign = "center";
    ctx.font = "24px condensed";

    let helpText = "Drag a .bin, .wav, .mp3, .aif, .flac, or .zip archive here to get started.";
    if (current_mode === "lumamu") {
      helpText = "Drag a .bin (ROM file), .wav, .mp3, .aif, .flac, or .zip archive here to get started.";
    }

    ctx.fillText(helpText, w / 2, h / 2);

    // Also clear scrollbar
    const sbCanvas = document.getElementById("scrollbar_canvas");
    if (sbCanvas) {
      const sbCtx = sbCanvas.getContext("2d");
      sbCtx.fillStyle = editor_waveform_bg;
      sbCtx.fillRect(0, 0, sbCanvas.width, sbCanvas.height);
    }
  }

  // Draw drop zone overlay if dragging
  if (currentDropZone) {
    ctx.fillStyle = "rgba(46, 155, 214, 0.3)";
    ctx.strokeStyle = drag_handle_color;
    ctx.lineWidth = 2;
    ctx.textAlign = "center";
    ctx.font = "bold 20px condensed";

    let text = "";
    let rectX = 0;
    let rectW = w;

    if (currentDropZone === "start") {
      rectW = w / 4;
      text = "Insert at Beginning";
    } else if (currentDropZone === "end") {
      rectX = (w * 3) / 4;
      rectW = w / 4;
      text = "Append to End";
    } else {
      rectX = w / 4;
      rectW = w / 2;
      text = "Replace Entire Buffer";
    }

    ctx.fillRect(rectX, 0, rectW, h);
    ctx.strokeRect(rectX, 0, rectW, h);
    ctx.fillStyle = "white";
    ctx.fillText(text, rectX + rectW / 2, h / 2);
  }
}

function drawScrollbar() {
  const canvas = document.getElementById("scrollbar_canvas");
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = editor_waveform_bg;
  ctx.fillRect(0, 0, w, h);

  if (!editorSampleData || editorSampleLength <= 0) return;

  // Draw background track
  ctx.fillStyle = "rgb(60, 60, 60)";
  ctx.fillRect(0, 2, w, h - 4);

  // Calculate thumb position and width
  const thumbXActual = (editorViewStart / editorSampleLength) * w;
  const thumbWidthActual = (1.0 / editorZoomLevel) * w;

  ctx.fillStyle = drag_handle_color;
  ctx.fillRect(thumbXActual, 4, Math.max(2, thumbWidthActual), h - 8);
}

function zoomIn() {
  if (!editorSampleData) return;
  const canvas = document.getElementById("editor_canvas");
  if (!canvas) return;
  const w = canvas.width;

  const oldVisibleSamples = editorSampleLength / editorZoomLevel;

  let mouseRatio = 0.5;
  if (editorMouseX >= 0 && editorMouseX <= w) {
    mouseRatio = editorMouseX / w;
  }

  const zoomCenterSample = editorViewStart + mouseRatio * oldVisibleSamples;

  editorZoomLevel *= 1.2;
  if (editorZoomLevel > 500) editorZoomLevel = 500; // Cap zoom

  const newVisibleSamples = editorSampleLength / editorZoomLevel;
  editorViewStart = zoomCenterSample - mouseRatio * newVisibleSamples;

  drawEditorCanvas();
}

function zoomOut() {
  if (!editorSampleData) return;
  const canvas = document.getElementById("editor_canvas");
  if (!canvas) return;
  const w = canvas.width;

  const oldVisibleSamples = editorSampleLength / editorZoomLevel;

  let mouseRatio = 0.5;
  if (editorMouseX >= 0 && editorMouseX <= w) {
    mouseRatio = editorMouseX / w;
  }

  const zoomCenterSample = editorViewStart + mouseRatio * oldVisibleSamples;

  editorZoomLevel /= 1.2;
  if (editorZoomLevel < 1.0) editorZoomLevel = 1.0;

  const newVisibleSamples = editorSampleLength / editorZoomLevel;
  editorViewStart = zoomCenterSample - mouseRatio * newVisibleSamples;

  drawEditorCanvas();
}

function drawSlotWaveforms() {
  // Get the appropriate number of slots based on current mode
  const numSlots = (current_mode === "luma1") ? luma1_slot_names.length : lumamu_slot_names.length;

  for (let i = 0; i < 10; i++) {
    const canvas = document.getElementById("canvas_slot_" + i);
    if (canvas) {
      // Only draw if this slot should be visible in the current mode
      if (i < numSlots) {
        // Use the appropriate slot name based on the current mode
        const slotName = (current_mode === "luma1") ? luma1_slot_names[i] : lumamu_slot_names[i];

        drawSlotWaveformOnCanvas(
          canvas,
          bank[i].sampleData,
          bank[i].sampleLength,
          slotName,
          bank[i].name
        );
      }
    }
  }
}

function drawSlotWaveformOnCanvas(
  canvas,
  sampleData,
  sampleLength,
  title,
  name = "untitled",
) {
  // Size first: changing a canvas width resets the drawing state.
  if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    const desiredWidth = Math.round(canvas.height * canvas.clientWidth / canvas.clientHeight);
    if (canvas.width !== desiredWidth) canvas.width = desiredWidth;
  }
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext("2d");

  ctx.fillStyle = slot_waveform_bg;
  ctx.fillRect(0, 0, w, h);

  if (sampleData && sampleLength > 0) {
    ctx.strokeStyle = slot_waveform_fg;
    drawWaveform(w, h, ctx, sampleData, sampleLength);
  }

  ctx.fillStyle = slot_waveform_fg;
  ctx.textAlign = "right";
  ctx.font = "24px condensed";
  // Reserve room for the tiny Clear button at the card's upper-right corner.
  ctx.fillText(name + " : " + title, w - 38, 24, Math.max(1, w - 48));

  if (sampleData && sampleLength > 0) {
    let sizeText = (sampleLength % 1024 === 0) ? (sampleLength / 1024) + "k" : sampleLength.toString();
    ctx.fillText(sizeText + " ", w, h - 10);
  }
}

function drawWaveform(w, h, ctx, sampleData, sampleLength, startSample = 0, numSamples = -1) {
  if (numSamples === -1) numSamples = sampleLength;

  const pixelsPerSample = w / numSamples;

  // Draw sample separator lines if zoomed in enough (at least 5 pixels per sample)
  if (pixelsPerSample >= 5) {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(214, 214, 214, 0.2)";
    ctx.lineWidth = 1;

    const firstSample = Math.floor(startSample);
    const lastSample = Math.ceil(startSample + numSamples);

    for (let s = firstSample; s <= lastSample; s++) {
      const x = ((s - startSample) * w) / numSamples;
      if (x >= 0 && x <= w) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.beginPath();
  for (var x = 0; x < w; x++) {
    const s0 = startSample + (x * numSamples) / w;
    const s1 = startSample + ((x + 1) * numSamples) / w;

    const firstSample = Math.max(0, Math.floor(s0));
    const lastSample = Math.max(firstSample, Math.floor(s1));

    if (firstSample >= sampleLength) break;

    let min = 1.0;
    let max = -1.0;

    for (let s = firstSample; s <= Math.min(lastSample, sampleLength - 1); s++) {
      let ulaw = sampleData[s];
      ulaw = ~ulaw; // Invert from storage format
      const linear = ulaw_to_linear(ulaw);
      const d = linear / 32768.0;
      if (d < min) min = d;
      if (d > max) max = d;
    }

    // Convert [-1, 1] to [0, h]
    const yMin = ((min + 1) / 2) * h;
    const yMax = ((max + 1) / 2) * h;

    if (x === 0) {
      ctx.moveTo(x, yMin);
    }

    ctx.lineTo(x, yMin);
    ctx.lineTo(x, yMax);
  }
  ctx.stroke();
}

function zoomAll() {
  editorZoomLevel = 1;
  editorViewStart = 0;
  drawEditorCanvas();
}

function zoomToSelection() {
  if (!editorSampleData || editorSampleLength <= 0) return;
  const selected = Math.max(1, editor_out_point - editor_in_point + 1);
  editorZoomLevel = Math.min(500, Math.max(1, editorSampleLength / (selected * 1.12)));
  const visible = editorSampleLength / editorZoomLevel;
  editorViewStart = editor_in_point - (visible - selected) / 2;
  drawEditorCanvas();
}

function resetRange() {
  if (typeof cancelEditorGesture === 'function') cancelEditorGesture();
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;
  editorZoomLevel = 1;
  editorViewStart = 0;
  if (typeof onEditorSelectionChanged === 'function') onEditorSelectionChanged();
  if (typeof updateStatusBar === 'function') updateStatusBar();
  redrawAllWaveforms();
}
