// One retained linear source per sound. Pitch is an absolute proposal, never a resampled copy.
let lpgSession=null,lpgPreviewCache=null;
function syncEditorDisplay(){
  if(!editorSound){editorSampleData=null;editorSampleLength=0;return;}
  const rendered=LumaSound.render(editorSound,LUMA_REFERENCE_RATE,0);
  editorSampleData=rendered.bytes;editorSampleLength=rendered.bytes.length;
}
function loadEditorSound(sound,name,pitch=0){
  const rendered=LumaSound.render(sound,LUMA_REFERENCE_RATE,0);
  pushUndo('open sound');stopPlayingSound();cancelEditorGesture();
  editorSound=sound;editorPitch=pitch;sampleName=String(name||'untitled').slice(0,80);de('sample_name_mu').value=sampleName;
  editorSampleData=rendered.bytes;editorSampleLength=rendered.bytes.length;
  editor_in_point=0;editor_out_point=editorSampleLength-1;editorZoomLevel=1;editorViewStart=0;lpgSession=null;lpgPreviewCache=null;
  refreshAll();showMessage('Select a part, shape it, then Add to slot.');
}
function selectedSource(sound=editorSound){const [a,b]=selectionFrameRange(sound);return LumaSound.slice(sound,a,b);}
function renderEditorSelection(fade=false){return LumaSound.render(selectedSource(fade?getLpgProposal():editorSound),LUMA_REFERENCE_RATE,editorPitch);}
function setEditorPitch(value){if(!Number.isFinite(value)||value< -24||value>24)return;stopPlayingSound();editorPitch=value;updateStatusBar();drawLpgPreview();}
function fitSelection(){
  if(!editorSound)return;
  editor_out_point=Math.min(editorSampleLength-1,editor_in_point+Math.max(1,Math.floor(16384*2**(editorPitch/12)))-1);
  while(selectionOutputLength()>16384&&editor_out_point>editor_in_point)editor_out_point--;
  onEditorSelectionChanged();drawEditorCanvas();showMessage('Selection shortened to fit. The source sound is intact.');
}
function clearSample(){
  if(editorSound)pushUndo('clear editor');else invalidateImports();
  stopPlayingSound();cancelEditorGesture();editorSound=null;editorPitch=0;sampleName='untitled';de('sample_name_mu').value=sampleName;
  editorSampleData=null;editorSampleLength=0;editor_in_point=0;editor_out_point=-1;editorZoomLevel=1;editorViewStart=0;lpgSession=null;lpgPreviewCache=null;refreshAll();showMessage('Editor cleared. Undo restores the sound.');
}
function clearSlot(id){if(!SLOT_ORDER.includes(id)||!bank[id].sampleLength)return;pushUndo('clear '+lumamu_slot_names[id]);if(playingSound?.slotId===id)stopPlayingSound();bank[id]=emptySlot(id);refreshAll();showMessage(`${lumamu_slot_names[id]} cleared.`);}
function copyWaveFormBetweenSlots(srcId,dstId){
  return guarded(()=>{
    if(![255,...SLOT_ORDER].includes(srcId)||![255,...SLOT_ORDER].includes(dstId)||srcId===dstId)return false;
    if(dstId===255){if(!bank[srcId].source)return false;loadEditorSound(bank[srcId].source,bank[srcId].name,bank[srcId].pitch);return true;}
    let source,pitch,name,bytes;
    if(srcId===255){if(!editorSound)return false;if(selectionOutputLength()>16384)throw Error('Selection exceeds 16 KB. Use Fit selection or select a shorter part.');source=selectedSource();pitch=editorPitch;name=de('sample_name_mu').value||'untitled';bytes=LumaSound.render(source,LUMA_REFERENCE_RATE,pitch).bytes;}
    else {const slot=bank[srcId];if(!slot.source)return false;source=slot.source;pitch=slot.pitch;name=slot.name;bytes=slot.sampleData.slice();}
    if(bytes.length>16384)throw Error('This sound exceeds 16 KB; the slot was not changed.');
    pushUndo('add to '+lumamu_slot_names[dstId]);stopPlayingSound();
    bank[dstId]={...emptySlot(dstId),source,pitch,previewPitch:pitch,name,sampleData:bytes,sampleLength:bytes.length};
    selectPitchSlot(dstId);refreshAll();showMessage(`Added ${name} to ${lumamu_slot_names[dstId]}.`);return true;
  });
}
function selectPitchSlot(id){if(!SLOT_ORDER.includes(id))return;selectedSlotId=id;de('repitch_slot').value=String(id);updateStatusBar();}
function updateSlotPitchControls(){
  const slot=bank[selectedSlotId],loaded=!!slot?.source;
  de('repitch_slot').value=String(selectedSlotId);de('slot_pitch').value=slot?.previewPitch||0;de('slot_pitch_value').textContent=`${(slot?.previewPitch||0).toFixed(1)} st`;
  const count=loaded?Math.max(1,Math.round(slot.source.pcm.length*LUMA_REFERENCE_RATE/slot.source.rate/2**(slot.previewPitch/12))):0;
  for(const id of ['slot_pitch','slot_pitch_preview','slot_pitch_reset'])de(id).disabled=!loaded;
  de('slot_pitch_apply').disabled=!loaded||count>16384||slot.previewPitch===slot.pitch;
  de('slot_pitch_status').textContent=!loaded?'Choose a sound to adjust.':count>16384?'Too long for this slot. Raise the pitch.':slot.previewPitch!==slot.pitch?'Preview only · Apply pitch to keep it.':`${slot.name} · ${(slot.sampleLength/LUMA_REFERENCE_RATE).toFixed(3)} s · Applied`;
}
function applySlotPitch(){guarded(()=>{const s=bank[selectedSlotId];if(!s.source||s.pitch===s.previewPitch)return;const result=LumaSound.render(s.source,LUMA_REFERENCE_RATE,s.previewPitch);if(result.bytes.length>16384)throw Error('Pitch exceeds the slot capacity.');pushUndo('slot pitch');stopPlayingSound();bank[selectedSlotId]={...s,pitch:s.previewPitch,sampleData:result.bytes,sampleLength:result.bytes.length};refreshAll();showMessage('Pitch applied from the retained original.');});}
function resetSlotPitch(){const s=bank[selectedSlotId];if(!s.source)return;stopPlayingSound();bank[selectedSlotId]={...s,previewPitch:0};updateStatusBar();}
function editorChange(label,makeSound,{crop=false}={}){
  return guarded(()=>{if(!editorSound)return false;const next=makeSound();const rendered=LumaSound.render(next,LUMA_REFERENCE_RATE,0);pushUndo(label);stopPlayingSound();cancelEditorGesture();editorSound=next;editorSampleData=rendered.bytes;editorSampleLength=rendered.bytes.length;lpgSession=null;lpgPreviewCache=null;if(crop){editor_in_point=0;editor_out_point=editorSampleLength-1;editorZoomLevel=1;editorViewStart=0;}else{editor_out_point=Math.min(editor_out_point,editorSampleLength-1);editor_in_point=Math.min(editor_in_point,editor_out_point);}refreshAll();showMessage(`${label}. Undo restores the previous sound.`);return true;});
}
function cropSample(){editorChange('Crop',()=>selectedSource(),{crop:true});}
function normalizeSelection(){editorChange('Normalize',()=>{const[a,b]=selectionFrameRange();return LumaSound.normalize(editorSound,a,b);});}
// Pitch the selection so it fills a whole slot (a longer, higher-resolution sample); the source stays intact.
function stretchToFill(){
  if(!editorSound)return;
  const [a,b]=selectionFrameRange(),natural=(b-a)*LUMA_REFERENCE_RATE/editorSound.rate;
  let pitch=12*Math.log2(natural/16384);
  if(pitch< -24){showMessage('The selection is too short to stretch to 16 KB (limit −24 semitones).',true);return;}
  if(pitch>24){showMessage('The selection is too long; use Fit selection instead.',true);return;}
  pitch=Math.round(pitch*1000)/1000;editorPitch=pitch;
  while(selectionOutputLength()>16384&&editorPitch<24)editorPitch=Math.round((editorPitch+0.001)*1000)/1000;
  stopPlayingSound();updateStatusBar();drawLpgPreview();
  showMessage(`Pitch set to ${editorPitch.toFixed(2)} st so the selection fills the slot.`);
}
// Repeat the selection until it fills a slot at the current pitch (as on the Luma-1 editor).
function duplicateToFill(){
  editorChange('Duplicate to fill',()=>{
    const [a,b]=selectionFrameRange(),len=b-a;
    let frames=Math.floor(16384*editorSound.rate*2**(editorPitch/12)/LUMA_REFERENCE_RATE);
    const out=()=>Math.round(frames*LUMA_REFERENCE_RATE/editorSound.rate/2**(editorPitch/12));
    while(frames>1&&out()>16384)frames--;
    if(frames<=len)throw Error('The selection already fills the slot.');
    const repeat=data=>{const r=new data.constructor(frames);for(let i=0;i<frames;i++)r[i]=data[a+i%len];return r;};
    const next=LumaSound.create(repeat(editorSound.pcm),editorSound.rate);
    if(editorSound.rawBytes){next.rawBytes=repeat(editorSound.rawBytes);if(editorSound.rawExact)next.rawExact=repeat(editorSound.rawExact);}
    return next;
  },{crop:true});
}
function handleFunctionPicker(select){
  const action=select.value;select.value='';
  if(action==='Normalize')normalizeSelection();
  else if(action==='Stretch to 16k')stretchToFill();
  else if(action==='Duplicate to fill')duplicateToFill();
  else if(action==='Reverse'||action==='Silence selection')editorChange(action,()=>{const[a,b]=selectionFrameRange();const next=LumaSound.clone(editorSound);if(action==='Reverse')next.pcm.subarray(a,b).reverse();else next.pcm.fill(0,a,b);if(next.rawBytes){next.rawExact=next.rawExact||new Uint8Array(next.pcm.length).fill(1);next.rawExact.fill(0,a,b);}return next;});
  else if(action==='Delete selection'){
    const[a,b]=selectionFrameRange();if(a===0&&b===editorSound.pcm.length){clearSample();return;}
    editorChange(action,()=>{
      const removeRange=data=>{const result=new data.constructor(data.length-(b-a));result.set(data.subarray(0,a));result.set(data.subarray(b),a);return result;};
      const next=LumaSound.create(removeRange(editorSound.pcm),editorSound.rate);
      if(editorSound.rawBytes){next.rawBytes=removeRange(editorSound.rawBytes);if(editorSound.rawExact)next.rawExact=removeRange(editorSound.rawExact);}
      return next;
    },{crop:true});
  }
  de('editor_canvas').focus({preventScroll:true});
}
function lpgSettings(){return {decay:Number(de('percussion_decay').value)/100,damping:Number(de('percussion_damping').value)/100};}
function getLpgProposal(){
  const range=selectionFrameRange();
  if(!lpgSession||![lpgSession.base,lpgSession.applied].includes(editorSound)||lpgSession.range[0]!==range[0]||lpgSession.range[1]!==range[1])lpgSession={base:editorSound,range,applied:null};
  const options=lpgSettings(),key=JSON.stringify(options);
  if(lpgPreviewCache?.base===lpgSession.base&&lpgPreviewCache.key===key&&lpgPreviewCache.range[0]===range[0]&&lpgPreviewCache.range[1]===range[1])return lpgPreviewCache.sound;
  const sound=LumaSound.percussion(lpgSession.base,...range,options);lpgPreviewCache={base:lpgSession.base,key,range,sound};return sound;
}
function previewLpg(before=false){
  if(playingSound?.tag===(before?'lpg-before':'lpg')){stopPlayingSound();return;}
  guarded(()=>{if(!editorSound)return;const sound=getLpgProposal();const source=before?lpgSession.base:sound;const result=LumaSound.render(selectedSource(source),LUMA_REFERENCE_RATE,editorPitch);startAudio(result.bytes,before?'lpg-before':'lpg',{loop:de('loop_playback_button').classList.contains('loop_active')});});
}
function applyLpg(crop){guarded(()=>{
  if(!editorSound)return;const proposal=getLpgProposal(),session=lpgSession,next=crop?selectedSource(proposal):proposal;
  if(!crop&&session.applied===proposal)return;
  const rendered=LumaSound.render(next,LUMA_REFERENCE_RATE,0);pushUndo(crop?'Make hit':'LPG fade');stopPlayingSound();cancelEditorGesture();editorSound=next;editorSampleData=rendered.bytes;editorSampleLength=rendered.bytes.length;
  lpgSession=crop?null:{...session,applied:next};if(crop){editor_in_point=0;editor_out_point=editorSampleLength-1;editorZoomLevel=1;editorViewStart=0;lpgPreviewCache=null;}
  refreshAll();showMessage(crop?'Hit shaped and cropped. Add it to a slot when ready.':'Fade applied. Undo restores the previous sound.');
});}
function drawLpgPreview(){
  const canvas=de('percussion_canvas');if(!canvas||!de('editor_percussion_panel').open)return;
  canvas.width=Math.max(1,canvas.clientWidth);const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.fillStyle='#28272b';ctx.fillRect(0,0,w,h);
  if(!editorSound)return;
  guarded(()=>{const next=getLpgProposal(),range=selectionFrameRange();for(const[sound,color] of [[lpgSession.base,'#675f7a'],[next,'#aaa4b7']]){
    const pcm=sound.pcm.subarray(...range);ctx.strokeStyle=color;ctx.beginPath();
    for(let x=0;x<w;x++){const a=Math.floor(x*pcm.length/w),b=Math.max(a+1,Math.floor((x+1)*pcm.length/w));let lo=0,hi=0;for(let i=a;i<Math.min(b,pcm.length);i++){lo=Math.min(lo,pcm[i]);hi=Math.max(hi,pcm[i]);}ctx.moveTo(x,h/2-hi*h*.46);ctx.lineTo(x,h/2-lo*h*.46);}ctx.stroke();
  }});
}
function initEditorControls(){
  de('editor_pitch').oninput=e=>setEditorPitch(Number(e.target.value));
  de('slot_pitch').oninput=e=>{stopPlayingSound();const s=bank[selectedSlotId];bank[selectedSlotId]={...s,previewPitch:Number(e.target.value)};updateSlotPitchControls();};
  for(const id of ['percussion_decay','percussion_damping'])de(id).oninput=e=>{stopPlayingSound();de(id+'_value').textContent=e.target.value+'%';drawLpgPreview();};
}
