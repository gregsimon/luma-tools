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
    if (canvas) {
      canvas.width = canvas.height * (canvas.clientWidth / canvas.clientHeight);
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

    // Draw max slot size indicators (transparent green block with limit lines)
    // This shows how much of the sample (starting at the in-point) 
    // will be copied to a slot based on the current device mode.
    const maxLimit = getMaxSampleSize();
    const inX = sampleToX(editor_in_point);
    const endX = sampleToX(editor_in_point + maxLimit);
    
    ctx.save();
    
    // 1. Draw the overall transparent green block for the max limit
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "rgb(0, 255, 0)";
    
    const blockStart = Math.max(0, inX);
    const blockEnd = Math.min(w, endX);
    if (blockEnd > blockStart) {
      ctx.fillRect(blockStart, 0, blockEnd - blockStart, h);
    }

    // 2. Draw vertical lines and labels for 2k, 4k, 8k, 16k, and 32k
    const limits = [2048, 4096, 8192, 16384, 32768];
    ctx.strokeStyle = "rgb(0, 255, 0)";
    ctx.fillStyle = "rgb(0, 255, 0)";
    ctx.font = "10px InterstateRegular, sans-serif";
    ctx.textAlign = "right";
    
    limits.forEach(limit => {
      if (limit > maxLimit) return;
      
      const limitX = sampleToX(editor_in_point + limit);
      if (limitX >= 0 && limitX <= w) {
        // Draw vertical line
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(limitX, 0);
        ctx.lineTo(limitX, h);
        ctx.stroke();
        
        // Draw label
        ctx.globalAlpha = 0.8;
        const label = (limit / 1024) + "k";
        ctx.fillText(label, limitX - 2, 12);
      }
    });
    
    ctx.restore();

    ctx.strokeStyle = editor_waveform_fg;
    drawWaveform(w, h, ctx, editorSampleData, editorSampleLength, editorViewStart, visibleSamples);
    
    const tab_side = 15;
    
    ctx.fillStyle = drag_handle_color;
    var offset = sampleToX(editor_in_point);
    
    // Only draw in-point if it's within the visible range
    if (offset >= -tab_side && offset <= w) {
      ctx.fillRect(offset, 0, 1, h);
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + tab_side, 0);
      ctx.lineTo(offset, tab_side);
      ctx.lineTo(offset, 0);
      ctx.closePath();
      ctx.fill();
    }

    // draw gray on first part of sample (before in-point)
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "rgb(0,0,0)";
    let grayInWidth = Math.min(w, Math.max(0, offset));
    if (grayInWidth > 0) {
      ctx.fillRect(0, 0, grayInWidth, h);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = drag_handle_color;
    var out_offset = sampleToX(editor_out_point);
    
    // Only draw out-point if it's within the visible range
    if (out_offset >= 0 && out_offset <= w + tab_side) {
      ctx.fillRect(out_offset - 1, 0, 1, h);
      ctx.beginPath();
      ctx.moveTo(out_offset - 1 - tab_side, h);
      ctx.lineTo(out_offset, h - tab_side);
      ctx.lineTo(out_offset, h);
      ctx.closePath();
      ctx.fill();
    }

    // draw gray on last part of sample (after out-point)
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "rgb(0,0,0)";
    let grayOutStart = Math.max(0, Math.min(w, out_offset));
    if (grayOutStart < w) {
      ctx.fillRect(grayOutStart, 0, w - grayOutStart, h);
    }
    ctx.globalAlpha = 1;

    // Draw playback cursor if playing editor sound
    if (playingSound && playingSound.isEditorSound && typeof actx !== 'undefined' && actx && typeof getSelectedSampleRate === 'function') {
      const elapsed = actx.currentTime - playbackStartTime;
      const currentSample = (playingSound.playbackOffset + elapsed) * getSelectedSampleRate();
      const cursorX = sampleToX(currentSample);
      
      if (cursorX >= 0 && cursorX <= w) {
        ctx.strokeStyle = "rgb(255, 255, 255)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cursorX, 0);
        ctx.lineTo(cursorX, h);
        ctx.stroke();
      }
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
  const w = canvas.width;
  const h = canvas.height;
  var ctx = canvas.getContext("2d");

  // Scale the inner drawling surface to the same
  // aspect ratio as the canvas element
  canvas.width = canvas.height * (canvas.clientWidth / canvas.clientHeight);

  ctx.fillStyle = slot_waveform_bg;
  ctx.fillRect(0, 0, w, h);

  if (sampleData && sampleLength > 0) {
    ctx.strokeStyle = slot_waveform_fg;
    drawWaveform(w, h, ctx, sampleData, sampleLength);
  }

  ctx.fillStyle = slot_waveform_fg;
  ctx.textAlign = "right";
  ctx.font = "24px condensed";
  ctx.fillText(name + " : " + title + " ", w, 24);

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

let editorCanvasMouseIsDown = false;
let scrollbarMouseIsDown = false;

function onEditorCanvasMouseDown(event) {
  editorCanvasMouseIsDown = true;
  
  const x = event.offsetX;
  const y = event.offsetY;
  const canvas = document.getElementById("editor_canvas");
  const h = canvas.height;
  const w = canvas.width;
  const tab_side = 15;
  
  if (editorSampleData == null) return;
  
  const visibleSamples = editorSampleLength / editorZoomLevel;
  const sampleToX = (s) => ((s - editorViewStart) * w) / visibleSamples;

  // Calculate endpoint positions in pixels
  const in_offset = sampleToX(editor_in_point);
  const out_offset = sampleToX(editor_out_point);
  
  // Check if clicking on in-point handle (triangle at top)
  if (y < tab_side && x >= in_offset && x <= in_offset + tab_side) {
    isDraggingEndpoint = true;
    draggingWhichEndpoint = "in";
    return;
  }
  
  // Check if clicking on out-point handle (triangle at bottom)
  if (y >= h - tab_side && x >= out_offset - tab_side && x <= out_offset) {
    isDraggingEndpoint = true;
    draggingWhichEndpoint = "out";
    return;
  }

  // Snap to point if clicked in gutters but not on handles
  if (y < tab_side) {
    let new_pt = editorViewStart + (visibleSamples * x) / w;
    if (new_pt < editor_out_point) {
      editor_in_point = Math.floor(Math.max(0, new_pt));
      isDraggingEndpoint = true;
      draggingWhichEndpoint = "in";
      if (typeof updateStatusBar === "function") updateStatusBar();
      drawEditorCanvas();
    }
    return;
  }

  if (y >= h - tab_side) {
    let new_pt = editorViewStart + (visibleSamples * x) / w;
    if (new_pt > editor_in_point) {
      editor_out_point = Math.floor(Math.min(editorSampleLength - 1, new_pt));
      isDraggingEndpoint = true;
      draggingWhichEndpoint = "out";
      if (typeof updateStatusBar === "function") updateStatusBar();
      drawEditorCanvas();
    }
    return;
  }
  
  // If not clicking on endpoints, check if it's in the middle area for waveform drag
  const edge = h * drag_gutter_pct;
  if (y > edge && y < h - edge) {
    isDraggingWaveform = true;
  }
}

function onEditorCanvasMouseMove(event) {
  editorMouseX = event.offsetX;
}

function onEditorCanvasMouseUp(event) {
  editorCanvasMouseIsDown = false;
  isDraggingEndpoint = false;
  draggingWhichEndpoint = null;
  isDraggingWaveform = false;
}

function onScrollbarMouseDown(event) {
  scrollbarMouseIsDown = true;
  onScrollbarMouseMove(event);
}

function onScrollbarMouseMove(event) {
  if (scrollbarMouseIsDown) {
    const canvas = document.getElementById("scrollbar_canvas");
    const w = canvas.width;
    const x = event.offsetX;
    
    const visibleSamples = editorSampleLength / editorZoomLevel;
    const thumbWidthActual = (1.0 / editorZoomLevel) * w;
    
    // Center the thumb on the mouse click
    let newStartRatio = (x - thumbWidthActual / 2) / w;
    editorViewStart = newStartRatio * editorSampleLength;
    
    // Clamp
    editorViewStart = Math.max(0, Math.min(editorViewStart, editorSampleLength - visibleSamples));
    
    drawEditorCanvas();
  }
}

function onScrollbarMouseUp(event) {
  scrollbarMouseIsDown = false;
}

function resetRange() {
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;
  editorZoomLevel = 1.0;
  editorViewStart = 0;
  if (typeof updateStatusBar === 'function') updateStatusBar();
  redrawAllWaveforms();
}
