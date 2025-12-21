// Waveform rendering and canvas interaction functions

function resizeCanvasToParent() {
  // editor canvas
  var canvas = document.getElementById("editor_canvas");
  if (canvas && canvas.parentElement) {
    canvas.width = canvas.parentElement.offsetWidth;
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

  if (editorSampleData && editorSampleLength > 0) {
    ctx.strokeStyle = editor_waveform_fg;
    drawWaveform(w, h, ctx, editorSampleData, editorSampleLength);
    const tab_side = 15;

    ctx.fillStyle = drag_handle_color;
    var offset = (w * editor_in_point) / editorSampleLength;
    ctx.fillRect(offset, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + tab_side, 0);
    ctx.lineTo(offset, tab_side);
    ctx.lineTo(offset, 0);
    ctx.closePath();
    ctx.fill();

    //draw gray on first part of sample
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, offset, h);
    ctx.globalAlpha = 1;

    ctx.fillStyle = drag_handle_color;
    offset = (w * editor_out_point) / editorSampleLength;
    ctx.fillRect(offset - 1, 0, 1, h);
    ctx.beginPath();
    ctx.moveTo(offset - 1 - tab_side, h);
    ctx.lineTo(offset, h - tab_side);
    ctx.lineTo(offset, h);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(offset, 0, w, h);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = slot_waveform_fg;
    ctx.textAlign = "center";
    ctx.font = "24px condensed";
    
    let helpText = "Drag a .bin (sample ROM), wav, or zip (bank archive) file here to get started.";
    if (current_mode === "lumamu") {
      helpText = "Drag a .bin (ROM file), wav, or zip (bank archive) file here to get started.";
    }
    
    ctx.fillText(helpText, w / 2, h / 2);
  }
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
}

function drawWaveform(w, h, ctx, sampleData, sampleLength) {
  ctx.beginPath();
  for (var x = 0; x < w; x++) {
    var sample_idx = Math.floor((sampleLength * x) / w);
    if (sample_idx >= sampleLength) break;
    
    // Convert uLaw to linear for display
    let ulaw = sampleData[sample_idx];
    ulaw = ~ulaw; // Invert from storage format
    const linear = ulaw_to_linear(ulaw);
    var d = (linear / 32768.0) + 1; // Convert to [0, 2]
    d /= 2; // Convert to [0, 1]
    d *= h; // Convert to [0, h]

    if (x > 0) {
      ctx.lineTo(x, d);
    } else {
      ctx.moveTo(x, d);
    }
  }
  ctx.stroke();
}

let editorCanvasMouseIsDown = false;
function onEditorCanvasMouseDown(event) {
  editorCanvasMouseIsDown = true;
  
  const x = event.offsetX;
  const y = event.offsetY;
  const canvas = document.getElementById("editor_canvas");
  const h = canvas.height;
  const w = canvas.width;
  const tab_side = 15;
  
  if (editorSampleData == null) return;
  
  // Calculate endpoint positions
  const in_offset = (w * editor_in_point) / editorSampleLength;
  const out_offset = (w * editor_out_point) / editorSampleLength;
  
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
  
  // If not clicking on endpoints, check if it's in the middle area for waveform drag
  const edge = h * drag_gutter_pct;
  if (y > edge && y < h - edge) {
    isDraggingWaveform = true;
  }
}

function onEditorCanvasMouseMove(event) {
  if (editorCanvasMouseIsDown && isDraggingEndpoint) {
    const x = event.offsetX;
    const y = event.offsetY;
    const canvas = document.getElementById("editor_canvas");
    const w = canvas.width;

    if (editorSampleData == null) return;

    var new_pt = (editorSampleLength * x) / w;
    if (shiftDown) new_pt = Math.round(new_pt / 1024) * 1024;

    // Handle endpoint dragging
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
    if (typeof updateStatusBar === 'function') updateStatusBar();
    drawEditorCanvas();
  }
}

function onEditorCanvasMouseUp(event) {
  editorCanvasMouseIsDown = false;
  isDraggingEndpoint = false;
  draggingWhichEndpoint = null;
  isDraggingWaveform = false;
}

function resetRange() {
  editor_in_point = 0;
  editor_out_point = editorSampleLength - 1;
  if (typeof updateStatusBar === 'function') updateStatusBar();
  redrawAllWaveforms();
}

