// Luma-Mu editor, based on Greg Simon's original Luma Tools.
const classAudioContext = window.AudioContext || window.webkitAudioContext;
const LUMA_REFERENCE_RATE = 12908; // approximate strobe-tested noon; documented in Help
const current_mode = 'lumamu';
const SLOT_ORDER = [7, 6, 1, 0, 2, 3, 5, 4];
const lumamu_slot_names = ['SLOT 3','SLOT 2','SLOT 4','SLOT 5','SLOT 7','SLOT 6','SLOT 1','SLOT 0'];
const slot_names = lumamu_slot_names;
const slot_waveform_fg = 'rgb(214,214,214)', slot_waveform_bg = 'rgb(41,41,41)';
const editor_waveform_fg = '#aaa4b7', editor_waveform_bg = '#28272b', drag_handle_color = 'rgb(46,155,214)';
const drag_gutter_pct = 0.1;
let actx, playingSound = null, playbackStartTime = 0, animationFrameId = null;
let editorSampleData = null, editorSampleLength = 0, editor_in_point = 0, editor_out_point = -1;
let editorZoomLevel = 1, editorViewStart = 0, editorMouseX = -1, sampleName = 'untitled';
let editorSound = null, editorPitch = 0, selectedSlotId = 7;
let isImporting = false, currentDropZone = null, snapToZeroCrossing = false, shiftDown = false;
let isDraggingEndpoint = false, isDraggingWaveform = false, isDraggingSelection = false;
let binaryFormat = 'ulaw_u8';
let bank = Array.from({length:10},(_,id)=>emptySlot(id));
const undoHistory = [];
function de(id) { return document.getElementById(id); }
function emptySlot(id) { return {id,name:'untitled',sampleData:null,sampleLength:0,source:null,pitch:0,previewPitch:0,sample_rate:LUMA_REFERENCE_RATE}; }
function getSelectedSampleRate() { return LUMA_REFERENCE_RATE; }
function getMaxSampleSize() { return 16384; }
function showMessage(message,error=false) { de('app_status').textContent=message;de('app_status').classList.toggle('error',error); }
function guarded(action) { try {return action();} catch(error) {showMessage(error.message,true);return false;} }
function luma1_init() {
  const container=de('slot_container');
  SLOT_ORDER.forEach((id,key)=>{
    const li=document.createElement('li');li.dataset.slot=String(id);
    const canvas=document.createElement('canvas');canvas.id='canvas_slot_'+id;canvas.width=500;canvas.height=150;canvas.tabIndex=0;canvas.draggable=true;canvas.setAttribute('aria-label',`Slot ${key}. Press Space to audition.`);
    canvas.addEventListener('pointerdown',e=>{if(e.button===0&&!e.ctrlKey){selectPitchSlot(id);canvas.focus({preventScroll:true});playSlotAudio(id);}});
    canvas.addEventListener('dragstart',e=>{stopPlayingSound();e.dataTransfer.setData('text/plain',String(id));e.dataTransfer.effectAllowed='copy';});
    const clear=document.createElement('button');clear.className='clear-box';clear.id='clear_slot_'+id;clear.textContent='×';clear.title=`Clear slot ${key}`;clear.setAttribute('aria-label',clear.title);clear.onclick=()=>clearSlot(id);
    const edit=document.createElement('button');edit.className='slot-edit';edit.textContent='Edit';edit.title='Open this sound in the editor';edit.onclick=()=>copyWaveFormBetweenSlots(id,255);
    li.append(canvas,clear,edit);container.append(li);
    li.addEventListener('dragover',e=>{e.preventDefault();li.classList.add('selection-drop-target');});
    li.addEventListener('dragleave',e=>{if(!li.contains(e.relatedTarget))li.classList.remove('selection-drop-target');});
    li.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();li.classList.remove('selection-drop-target');if(e.dataTransfer.files.length){importFiles(e.dataTransfer.files,id);return;}const src=e.dataTransfer.getData('text/plain');if(/^(255|[0-7])$/.test(src))copyWaveFormBetweenSlots(Number(src),id);});
    for(const picker of [de('slotId_mu'),de('repitch_slot')])picker.add(new Option(`SLOT ${key}`,id));
  });
  initSelectionControls();initEditorControls();initEmuControls();
  de('open_file').onchange=e=>{importFiles(e.target.files);e.target.value='';};
  window.addEventListener('resize',()=>{resizeCanvasToParent();redrawAllWaveforms();drawLpgPreview();});
  window.addEventListener('keydown',handleKeyboard);
  window.addEventListener('blur',()=>{shiftDown=false;stopPlayingSound();});
  for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>de('editor_canvas').focus({preventScroll:true}));
  de('deployed_date').textContent='2.0.2 · 4 October 2026';
  resizeCanvasToParent();refreshAll();
}
function refreshAll() { updateStatusBar();redrawAllWaveforms();drawLpgPreview(); }
function selectionFrameRange(sound=editorSound) {
  if(!sound||!editorSampleLength)return [0,0];
  const first=Math.max(0,Math.min(sound.pcm.length-1,Math.round(editor_in_point*sound.pcm.length/editorSampleLength)));
  const last=Math.max(first+1,Math.min(sound.pcm.length,Math.round((editor_out_point+1)*sound.pcm.length/editorSampleLength)));
  return [first,last];
}
function selectionOutputLength() {
  if(!editorSound)return 0;const [a,b]=selectionFrameRange();return Math.max(1,Math.round((b-a)*LUMA_REFERENCE_RATE/editorSound.rate/2**(editorPitch/12)));
}
function updateStatusBar() {
  const loaded=!!editorSound?.pcm.length, count=loaded?editor_out_point-editor_in_point+1:0, length=selectionOutputLength();
  de('in_point').value=loaded?editor_in_point:0;de('out_point').value=loaded?editor_out_point:0;
  de('sample_count').textContent=`${count.toLocaleString()} samples`;
  de('editor_pitch').value=editorPitch;de('editor_pitch_value').textContent=`${editorPitch.toFixed(1)} st`;
  de('selection_status').textContent=!loaded?'Drop audio above to begin.':length>16384?`${length.toLocaleString()} samples — shorten the selection or use Fit.`:`${(length/LUMA_REFERENCE_RATE).toFixed(3)} s · ${Math.round(length/16384*100)}% of slot`;
  de('selection_status').classList.toggle('over-capacity',length>16384);de('fit_selection').hidden=length<=16384;
  for(const id of ['editor_preview','clear_editor','editor_crop_selection','editor_zoom_in','editor_zoom_out','editor_pitch','editor_pitch_reset','export_selection','percussion_before','percussion_preview','percussion_apply','percussion_make_hit','percussion_decay','percussion_damping'])de(id).disabled=!loaded||isImporting;
  de('clear_editor').disabled=!loaded&&!isImporting;
  de('copy_selection_mu').disabled=!loaded||length>16384||isImporting;
  de('function_picker').disabled=!loaded||isImporting;
  de('editor_undo').disabled=!undoHistory.length||isImporting;de('editor_undo').title=undoHistory.length?'Undo '+undoHistory.at(-1).label:'Nothing to undo';
  for(const id of SLOT_ORDER){de('clear_slot_'+id).disabled=!bank[id].sampleLength;de('canvas_slot_'+id).parentElement.classList.toggle('selected-slot',id===selectedSlotId);}
  updateSlotPitchControls();
}
function pushUndo(label) {
  invalidateImports();
  undoHistory.push({label,editorSound,editorPitch,sampleName,selection:[editor_in_point,editor_out_point],view:[editorZoomLevel,editorViewStart],bank:bank.map(s=>({...s})),selectedSlotId,bankName:de('bank_name_mu').value,lpgSession,lpgSettings:lpgSettings()});
  if(undoHistory.length>12)undoHistory.shift();
}
function undoEdit() {
  if(!undoHistory.length||isImporting)return;stopPlayingSound();cancelEditorGesture();invalidateImports();
  const s=undoHistory.pop();editorSound=s.editorSound;editorPitch=s.editorPitch;sampleName=s.sampleName;bank=s.bank;selectedSlotId=s.selectedSlotId;lpgSession=s.lpgSession;
  lpgPreviewCache=null;
  for(const name of ['decay','damping']){const value=Math.round(s.lpgSettings[name]*100);de('percussion_'+name).value=value;de('percussion_'+name+'_value').textContent=value+'%';}
  de('sample_name_mu').value=sampleName;de('bank_name_mu').value=s.bankName;syncEditorDisplay();[editor_in_point,editor_out_point]=s.selection;[editorZoomLevel,editorViewStart]=s.view;
  refreshAll();showMessage(`Undid ${s.label}.`);
}
function onEditorSelectionChanged() {stopPlayingSound();lpgSession=null;updateStatusBar();drawLpgPreview();}
function editableText(target) {return target?.isContentEditable||target?.tagName==='TEXTAREA'||(target?.tagName==='INPUT'&&!['range','checkbox','radio','button','file'].includes(target.type));}
function handleKeyboard(e) {
  if(document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'){cancelEditorGesture();stopPlayingSound();return;}
  if(editableText(e.target))return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(!e.repeat&&!e.shiftKey)undoEdit();return;}
  if(e.key===' '){
    if(e.target?.matches('input[type=checkbox],summary,select'))return;
    e.preventDefault();if(e.repeat)return;
    if(e.target?.closest('#editor_percussion_panel'))previewLpg();
    else if(e.target?.closest('#slot_pitch_panel'))toggleSlotAudio(selectedSlotId);
    else if(e.target?.closest('#slot_container li'))toggleSlotAudio(Number(e.target.closest('li').dataset.slot));
    else playAudio();return;
  }
  if(e.target?.matches('input,select,button,summary'))return;
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&/^[1-8]$/.test(e.key)){e.preventDefault();if(!e.repeat){const id=SLOT_ORDER[Number(e.key)-1];selectPitchSlot(id);playSlotAudio(id);}return;}
  if(e.key==='+'||e.key==='='){e.preventDefault();zoomIn();}else if(e.key==='-'){e.preventDefault();zoomOut();}
}
