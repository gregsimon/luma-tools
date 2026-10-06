// Pointer selection and editor-to-slot copying. Native file/slot imports stay separate.
// Endpoints are inclusive sample indices, matching the original editor and ROM code.
let editorGesture = null;
let editorSelectionControlsReady = false;
let editorDragGhost = null;
let editorDragTarget = null;
let editorDragScrollFrame = 0;

function editorPointerPosition(event, canvas = document.getElementById('editor_canvas')) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height),
    ratio: (event.clientX - rect.left) / Math.max(1, rect.width),
  };
}

function editorSampleAtPointer(event) {
  const point = editorPointerPosition(event);
  return Math.max(0, Math.min(editorSampleLength - 1,
    Math.floor(editorViewStart + point.ratio * editorSampleLength / editorZoomLevel)));
}

function notifyEditorRange() {
  if (typeof onEditorSelectionChanged === 'function') onEditorSelectionChanged();
  if (typeof updateStatusBar === 'function') updateStatusBar();
  drawEditorCanvas();
}

function setEditorRange(start, end) {
  if (!editorSampleData || editorSampleLength <= 0) return;
  const nextIn = Math.max(0, Math.min(editorSampleLength - 1, Math.round(start)));
  const nextOut = Math.max(nextIn, Math.min(editorSampleLength - 1, Math.round(end)));
  if (nextIn === editor_in_point && nextOut === editor_out_point) return;
  editor_in_point = nextIn;
  editor_out_point = nextOut;
  notifyEditorRange();
}

function editorSnapEndpoint(sample, other, event) {
  if (event.shiftKey) sample = Math.round(sample / 1024) * 1024;
  else if (typeof snapToZeroCrossing !== 'undefined' && snapToZeroCrossing &&
           typeof findNearestZeroCrossing === 'function') {
    const slope = typeof getSampleSlope === 'function' ? getSampleSlope(other) : 0;
    sample = findNearestZeroCrossing(sample, slope);
  }
  return Math.max(0, Math.min(editorSampleLength - 1, Math.round(sample)));
}

function editorSlotAtPoint(clientX, clientY) {
  // Captured pointers may release outside the native window. Never copy to an
  // offscreen card whose document geometry happens to overlap that coordinate.
  if (clientX < 0 || clientY < 0 || clientX >= window.innerWidth || clientY >= window.innerHeight) return null;
  // Resolve the whole visible card by geometry, including its disabled controls.
  // This intentionally does not depend on event.target (pointer capture retargets it).
  for (const canvas of document.querySelectorAll('canvas[id^="canvas_slot_"]')) {
    const slot = canvas.closest('li');
    if (!slot || !slot.getClientRects().length) continue;
    const rect = slot.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return { element: slot, id: Number(canvas.id.slice('canvas_slot_'.length)) };
    }
  }
  return null;
}

function updateEditorDropTarget(clientX, clientY) {
  const target = editorSlotAtPoint(clientX, clientY);
  if (editorDragTarget && (!target || editorDragTarget.element !== target.element)) {
    editorDragTarget.element.classList.remove('selection-drop-target');
  }
  editorDragTarget = target;
  if (target) target.element.classList.add('selection-drop-target');
  if (editorDragGhost) {
    const label = editorDragGhost.querySelector('[data-drag-label]');
    let slotLabel = target ? `slot ${target.id}` : '';
    if (target && typeof lumamu_slot_names !== 'undefined') slotLabel = lumamu_slot_names[target.id];
    label.textContent = target ? `Release to add to ${slotLabel}` : 'Drag selection to any slot';
    editorDragGhost.style.left = `${Math.min(clientX + 16, Math.max(8, window.innerWidth - 252))}px`;
    editorDragGhost.style.top = `${Math.max(8, Math.min(clientY + 18, window.innerHeight - 106))}px`;
  }
}

function createEditorDragGhost() {
  editorDragGhost = document.createElement('div');
  editorDragGhost.id = 'selection-drag-ghost';
  editorDragGhost.setAttribute('aria-hidden', 'true');
  // Fixed, noninteractive surface: it can never steal a drop or mouse focus.
  Object.assign(editorDragGhost.style, {
    position: 'fixed', zIndex: '10000', width: '230px', padding: '8px',
    pointerEvents: 'none', background: 'rgba(40,39,43,.85)', opacity: '.82',
    border: '1px solid #aaa4b7', borderRadius: '6px', color: '#f4f2f7',
    boxShadow: '0 6px 20px rgba(0,0,0,.3)', font: '13px sans-serif',
  });
  const waveform = document.createElement('canvas');
  waveform.width = 230;
  waveform.height = 58;
  waveform.style.cssText = 'display:block;width:230px;height:58px;pointer-events:none';
  const ctx = waveform.getContext('2d');
  ctx.strokeStyle = '#aaa4b7';
  drawWaveform(230, 58, ctx, editorSampleData, editorSampleLength,
    editor_in_point, editor_out_point - editor_in_point + 1);
  const label = document.createElement('div');
  label.setAttribute('data-drag-label', '');
  label.style.marginTop = '5px';
  editorDragGhost.append(waveform, label);
  document.body.append(editorDragGhost);
}

function scrollEditorCopyAtEdge() {
  editorDragScrollFrame = 0;
  if (!editorGesture || editorGesture.kind !== 'copy') return;
  const y = editorGesture.clientY;
  const amount = y < 38 ? -14 : y > window.innerHeight - 38 ? 14 : 0;
  if (amount) {
    window.scrollBy(0, amount);
    updateEditorDropTarget(editorGesture.clientX, y);
  }
  editorDragScrollFrame = requestAnimationFrame(scrollEditorCopyAtEdge);
}

function cancelEditorGesture() {
  const gesture = editorGesture;
  editorGesture = null;
  if (editorDragScrollFrame) cancelAnimationFrame(editorDragScrollFrame);
  editorDragScrollFrame = 0;
  if (editorDragTarget) editorDragTarget.element.classList.remove('selection-drop-target');
  editorDragTarget = null;
  if (editorDragGhost) editorDragGhost.remove();
  editorDragGhost = null;
  if (gesture) {
    gesture.canvas.style.cursor = '';
    if (gesture.canvas.hasPointerCapture(gesture.pointerId)) {
      gesture.canvas.releasePointerCapture(gesture.pointerId);
    }
  }
  document.body.classList.remove('editor-gesture-active');
}

function beginEditorGesture(event, kind, canvas) {
  // Commit a typed endpoint before starting; its change handler cancels old gestures.
  canvas.focus({ preventScroll: true });
  cancelEditorGesture();
  const point = editorPointerPosition(event, canvas);
  editorGesture = {
    kind, canvas, pointerId: event.pointerId, pointerType: event.pointerType || 'mouse', source: editorSampleData,
    length: editorSampleLength, startIn: editor_in_point, startOut: editor_out_point,
    startRatio: point.ratio, startView: editorViewStart,
    visible: editorSampleLength / editorZoomLevel,
    anchor: editorSampleAtPointer(event), clientX: event.clientX, clientY: event.clientY,
    startClientX: event.clientX, startClientY: event.clientY,
  };
  canvas.setPointerCapture(event.pointerId);
  document.body.classList.add('editor-gesture-active');
  event.preventDefault();
  return editorGesture;
}

// Is the pointer over the highlighted selection (not on its handles)?
function editorPointInSelection(point, canvas) {
  if (!editorSampleData || editorSampleLength <= 0 || editor_out_point <= editor_in_point) return false;
  const visible = editorSampleLength / editorZoomLevel;
  const inX = (editor_in_point - editorViewStart) * canvas.width / visible;
  const outX = (editor_out_point + 1 - editorViewStart) * canvas.width / visible;
  const onInHandle = point.y <= 20 && point.x >= inX - 6 && point.x <= inX + 20;
  const onOutHandle = point.y >= canvas.height - 20 && point.x >= outX - 20 && point.x <= outX + 6;
  return point.x >= inX && point.x <= outX && !onInHandle && !onOutHandle;
}

function startEditorCopyDrag(gesture, event) {
  gesture.kind = 'copy';
  gesture.canvas.style.cursor = 'copy';
  createEditorDragGhost();
  updateEditorDropTarget(event.clientX, event.clientY);
  editorDragScrollFrame = requestAnimationFrame(scrollEditorCopyAtEdge);
}

// A press inside the selection waits to see which way it moves: up/down or out of
// the waveform picks the selection up for a slot; sideways starts a new selection.
function resolvePendingGesture(gesture, event) {
  const dx = event.clientX - gesture.startClientX, dy = event.clientY - gesture.startClientY;
  const rect = gesture.canvas.getBoundingClientRect();
  const leftWaveform = event.clientY < rect.top || event.clientY > rect.bottom;
  if (!leftWaveform && Math.hypot(dx, dy) < 6) return; // too small to tell yet
  // Selecting is a sideways motion; anything steeper than ~30° is a drag to a slot.
  if (leftWaveform || Math.abs(dy) > Math.abs(dx) * 0.6) {
    startEditorCopyDrag(gesture, event);
  } else {
    gesture.kind = 'range';
    gesture.canvas.style.cursor = 'crosshair';
    if (typeof stopPlayingSound === 'function') stopPlayingSound();
    gesture.anchor = editorSnapEndpoint(gesture.anchor, gesture.anchor, event);
  }
}

function moveEditorGesture(event) {
  const gesture = editorGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  if (gesture.source !== editorSampleData || gesture.length !== editorSampleLength) {
    cancelEditorGesture();
    return;
  }
  gesture.clientX = event.clientX;
  gesture.clientY = event.clientY;
  if (event.cancelable) event.preventDefault();
  if (gesture.kind === 'pending') {
    resolvePendingGesture(gesture, event);
    if (gesture.kind === 'pending') return;
  }
  if (gesture.kind === 'copy') {
    updateEditorDropTarget(event.clientX, event.clientY);
    return;
  }
  const point = editorPointerPosition(event, gesture.canvas);
  if (gesture.kind === 'scroll') {
    const ratio = point.ratio - gesture.thumbGrab;
    editorViewStart = Math.max(0, Math.min(editorSampleLength - gesture.visible,
      ratio * editorSampleLength));
    drawEditorCanvas();
    return;
  }
  if (gesture.kind === 'slide') {
    let delta = (point.ratio - gesture.startRatio) * gesture.visible;
    if (event.shiftKey) delta = Math.round(delta / 1024) * 1024;
    const width = gesture.startOut - gesture.startIn;
    const start = Math.max(0, Math.min(editorSampleLength - 1 - width,
      gesture.startIn + Math.round(delta)));
    setEditorRange(start, start + width);
    return;
  }
  // Scroll a zoomed view when the pointer travels beyond a waveform edge.
  if (point.ratio < 0 || point.ratio > 1) {
    editorViewStart = Math.max(0, Math.min(editorSampleLength - gesture.visible,
      editorViewStart + Math.sign(point.ratio - .5) * gesture.visible * .04));
  }
  let sample = editorSampleAtPointer(event);
  if (gesture.kind === 'in' || gesture.kind === 'out') {
    sample = Math.round(editorViewStart + (point.ratio - gesture.endpointGrab) * gesture.visible)
      - (gesture.kind === 'out' ? 1 : 0);
  }
  if (gesture.kind === 'in') {
    sample = editorSnapEndpoint(sample, editor_out_point, event);
    setEditorRange(Math.min(sample, editor_out_point), editor_out_point);
  } else if (gesture.kind === 'out') {
    sample = editorSnapEndpoint(sample, editor_in_point, event);
    setEditorRange(editor_in_point, Math.max(sample, editor_in_point));
  } else {
    sample = editorSnapEndpoint(sample, gesture.anchor, event);
    setEditorRange(Math.min(gesture.anchor, sample), Math.max(gesture.anchor, sample));
  }
}

function endEditorGesture(event, pointerId = event.pointerId) {
  const gesture = editorGesture;
  if (!gesture || pointerId !== gesture.pointerId) return;
  const valid = gesture.source === editorSampleData && gesture.length === editorSampleLength;
  // The release coordinates are authoritative even if no move/hover reached the card.
  const destination = valid && gesture.kind === 'copy'
    ? editorSlotAtPoint(event.clientX, event.clientY) : null;
  if (valid && gesture.kind === 'pending') {
    if (typeof stopPlayingSound === 'function') stopPlayingSound();
    const sample = editorSnapEndpoint(gesture.anchor, gesture.anchor, event);
    setEditorRange(sample, sample);
  } else if (valid && gesture.kind !== 'copy') moveEditorGesture(event);
  cancelEditorGesture();
  if (event.cancelable) event.preventDefault();
  if (destination) {
    try {
      copyWaveFormBetweenSlots(255, destination.id);
    } catch (error) {
      if (typeof showMessage === 'function') showMessage(error.message || 'Could not add this selection.', true);
      else console.error(error);
    }
  }
}

function initSelectionControls() {
  if (editorSelectionControlsReady) return;
  editorSelectionControlsReady = true;
  const canvas = document.getElementById('editor_canvas');
  const scrollbar = document.getElementById('scrollbar_canvas');
  canvas.draggable = false;
  canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || !editorSampleData || editorSampleLength <= 0) return;
    const point = editorPointerPosition(event);
    const visible = editorSampleLength / editorZoomLevel;
    const inX = (editor_in_point - editorViewStart) * canvas.width / visible;
    const outX = (editor_out_point + 1 - editorViewStart) * canvas.width / visible;
    // Ctrl always means copy, even over handles, gutters or unselected audio.
    let kind = event.ctrlKey ? 'copy' : event.altKey || event.metaKey ? 'slide' : 'range';
    if (kind === 'range') {
      if (point.y <= 20 && point.x >= inX - 6 && point.x <= inX + 20) kind = 'in';
      else if (point.y >= canvas.height - 20 && point.x >= outX - 20 && point.x <= outX + 6) kind = 'out';
      else if (editorPointInSelection(point, canvas)) kind = 'pending';
    }
    const gesture = beginEditorGesture(event, kind, canvas);
    if (kind === 'in' || kind === 'out') {
      const boundary = kind === 'in' ? editor_in_point : editor_out_point + 1;
      gesture.endpointGrab = point.ratio - (boundary - editorViewStart) / visible;
    }
    if (kind === 'copy') {
      startEditorCopyDrag(gesture, event);
    } else if (kind === 'pending') {
      canvas.style.cursor = 'grabbing';
    } else {
      canvas.style.cursor = kind === 'slide' ? 'grabbing' : 'crosshair';
      if (typeof stopPlayingSound === 'function') stopPlayingSound();
      if (kind === 'range') {
        gesture.anchor = editorSnapEndpoint(gesture.anchor, gesture.anchor, event);
        setEditorRange(gesture.anchor, gesture.anchor);
      }
    }
  });
  canvas.addEventListener('pointermove', event => {
    const point = editorPointerPosition(event);
    editorMouseX = point.x;
    if (!editorGesture) canvas.style.cursor = editorPointInSelection(point, canvas) ? 'grab' : '';
  });
  canvas.addEventListener('pointerleave', () => { editorMouseX = -1; if (!editorGesture) canvas.style.cursor = ''; });
  canvas.addEventListener('contextmenu', event => {
    if (event.ctrlKey || editorGesture?.kind === 'copy') event.preventDefault();
  });
  canvas.addEventListener('dragstart', event => event.preventDefault());
  canvas.addEventListener('dragover', event => event.preventDefault());
  canvas.addEventListener('drop', event => {
    const text = event.dataTransfer.getData('text/plain');
    if (!/^[0-9]$/.test(text)) return; // File imports bubble to the editor import target.
    event.preventDefault();
    event.stopPropagation();
    cancelEditorGesture();
    copyWaveFormBetweenSlots(Number(text), 255);
  });
  canvas.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return; // Normal wheel retains page scrolling.
    event.preventDefault();
    if (!editorSampleData || editorSampleLength <= 0 || editorGesture) return;
    const ratio = Math.max(0, Math.min(1, editorPointerPosition(event).ratio));
    const anchor = editorViewStart + ratio * editorSampleLength / editorZoomLevel;
    editorZoomLevel = Math.max(1, Math.min(500, editorZoomLevel * Math.exp(-event.deltaY * .005)));
    editorViewStart = anchor - ratio * editorSampleLength / editorZoomLevel;
    drawEditorCanvas();
  }, { passive: false });
  if (scrollbar) {
    scrollbar.style.touchAction = 'none';
    scrollbar.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || !editorSampleData || editorSampleLength <= 0) return;
      const ratio = editorPointerPosition(event, scrollbar).ratio;
      const startRatio = editorViewStart / editorSampleLength;
      const thumbWidth = 1 / editorZoomLevel;
      const gesture = beginEditorGesture(event, 'scroll', scrollbar);
      gesture.thumbGrab = ratio >= startRatio && ratio <= startRatio + thumbWidth
        ? ratio - startRatio : thumbWidth / 2;
      moveEditorGesture(event);
    });
  }
  for (const element of [canvas, scrollbar].filter(Boolean)) {
    element.addEventListener('lostpointercapture', event => {
      if (editorGesture?.pointerId !== event.pointerId) return;
      // A mouse/trackpad copy can continue through the window handlers after
      // capture is lost. Loss of capture alone is not a cancelled drag.
      if (editorGesture.kind === 'copy' && editorGesture.pointerType === 'mouse') return;
      cancelEditorGesture();
    });
  }
  // A fresh press starts a new interaction even if the previous platform
  // sequence lost both release events. Never let an old copy commit on a later click.
  window.addEventListener('pointerdown', () => {
    if (editorGesture) cancelEditorGesture();
  }, true);
  window.addEventListener('pointermove', moveEditorGesture, { capture: true, passive: false });
  window.addEventListener('pointerup', endEditorGesture, { capture: true, passive: false });
  window.addEventListener('mouseup', event => {
    const gesture = editorGesture;
    // Native modifier/trackpad sequences can supply a compatibility mouseup
    // without pointerup. Both paths clear the gesture before committing, so
    // receiving both events still copies exactly once. Never finish a chord
    // while another button remains held, or revive a cancelled gesture.
    if (gesture?.kind !== 'copy' || gesture.pointerType !== 'mouse' || event.buttons !== 0 ||
        ![0, 2].includes(event.button)) return;
    endEditorGesture(event, gesture.pointerId);
  }, { capture: true, passive: false });
  window.addEventListener('pointercancel', event => {
    if (editorGesture?.pointerId === event.pointerId) cancelEditorGesture();
  }, true);
  window.addEventListener('blur', event => { if (event.target === window) cancelEditorGesture(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelEditorGesture(); });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && editorGesture) {
      event.preventDefault();
      cancelEditorGesture();
    }
  }, true);
  window.addEventListener('scroll', () => {
    if (editorGesture?.kind === 'copy') updateEditorDropTarget(editorGesture.clientX, editorGesture.clientY);
  }, true);
  for (const [id, endpoint] of [['in_point', 'in'], ['out_point', 'out']]) {
    const input = document.getElementById(id);
    if (!input) continue;
    input.addEventListener('change', () => {
      const sample = Number(input.value);
      if (editorSampleData && Number.isFinite(sample)) {
        cancelEditorGesture();
        if (endpoint === 'in') setEditorRange(Math.min(sample, editor_out_point), editor_out_point);
        else setEditorRange(editor_in_point, Math.max(sample, editor_in_point));
      }
      if (typeof updateStatusBar === 'function') updateStatusBar();
    });
  }
}
