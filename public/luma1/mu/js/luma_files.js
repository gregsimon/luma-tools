// Offline file boundaries. Decode at the source rate and stage every import
// before changing editor/bank state. Exported ROMs contain applied slot bytes.
let editorImportGeneration = 0;
const IMPORT_FILE_LIMIT = 64 * 1024 * 1024;
const IMPORT_ZIP_LIMIT = 96 * 1024 * 1024;
const IMPORT_ENTRY_LIMIT = 8 * 1024 * 1024;
const ZIP_CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=value&1?(value>>>1)^0xedb88320:value>>>1;
  return value>>>0;
});
let pendingRomChoice = null;

function invalidateImports() {
  editorImportGeneration++;
  isImporting = false;
  if (pendingRomChoice) pendingRomChoice();
}
function importStillCurrent(generation) { return generation === editorImportGeneration; }
function cleanName(name, fallback = 'untitled') {
  return String(name || '').replace(/[/\\\x00-\x1f]/g, '_').trim().slice(0, 80) || fallback;
}
function withoutExtension(name) { return cleanName(name).replace(/\.[^.]+$/, '') || 'untitled'; }
function validatePitch(pitch) {
  if (!Number.isFinite(pitch) || pitch < -24 || pitch > 24) throw new Error('Invalid saved pitch.');
  return pitch;
}
function ensureEditorFits(sound) {
  const frames = Math.max(1,Math.round(sound.pcm.length * LUMA_REFERENCE_RATE / sound.rate));
  if (!sound.pcm.length || frames < 1 || frames > LumaSound.MAX_FRAMES)
    throw new Error('This audio is too long or too short for the editor. Trim it before importing.');
  return sound;
}
function preparedSlot(id, sound, name, pitch = 0) {
  validatePitch(pitch);
  const rendered = LumaSound.render(sound, LUMA_REFERENCE_RATE, pitch);
  if (!rendered.bytes.length || rendered.bytes.length > 16384)
    throw new Error(cleanName(name) + ' does not fit a slot. Open it in the editor and select a shorter section.');
  return {...emptySlot(id), source:sound, name:cleanName(name), pitch, previewPitch:pitch,
    sampleData:rendered.bytes, sampleLength:rendered.bytes.length};
}
function blankBank() { return Array.from({length:10}, (_, id) => emptySlot(id)); }
function commitBank(staged, name, label) {
  stopPlayingSound(); cancelEditorGesture(); pushUndo(label);
  bank = staged; de('bank_name_mu').value = cleanName(name, 'Untitled');
  refreshAll();
}

function pcmFromFile(data, format) {
  const {channels, bits, rate, offset, length, frames, littleEndian, unsigned8, floating, stride} = format;
  const sampleBytes = bits / 8;
  if (![1,2].includes(channels) || !(floating ? [32,64] : [8,16,24,32]).includes(bits))
    throw new Error('Use mono or stereo PCM with a supported sample size.');
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > LumaSound.MAX_FRAMES ||
      !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 ||
      offset + length > data.byteLength || frames * stride > length || stride < channels * sampleBytes)
    throw new Error('Audio is incomplete or exceeds the editor length limit.');
  const view = new DataView(data, offset, length), mono = new Float32Array(frames);
  function sample(at) {
    if (floating) return bits === 32 ? view.getFloat32(at,littleEndian) : view.getFloat64(at,littleEndian);
    if (bits === 8) return unsigned8 ? (view.getUint8(at)-128)/128 : view.getInt8(at)/128;
    if (bits === 16) return view.getInt16(at,littleEndian)/32768;
    if (bits === 32) return view.getInt32(at,littleEndian)/2147483648;
    let value = littleEndian ? view.getUint8(at)|(view.getUint8(at+1)<<8)|(view.getUint8(at+2)<<16)
      : (view.getUint8(at)<<16)|(view.getUint8(at+1)<<8)|view.getUint8(at+2);
    if (value & 0x800000) value |= ~0xffffff;
    return value / 8388608;
  }
  for (let i=0;i<frames;i++) mono[i] = channels === 1 ? sample(i*stride)
    : (sample(i*stride)+sample(i*stride+sampleBytes))/2;
  return ensureEditorFits(LumaSound.create(mono,rate));
}
function audioChunks(data, littleEndian) {
  const view = new DataView(data), chunks = new Map();
  if(data.byteLength<12)throw new Error('Incomplete audio header.');
  const declaredEnd=view.getUint32(4,littleEndian)+8;
  if(declaredEnd>data.byteLength||declaredEnd<12)throw new Error('Incomplete audio container.');
  for(let at=12;at+8<=declaredEnd;) {
    const id=String.fromCharCode(...new Uint8Array(data,at,4)), length=view.getUint32(at+4,littleEndian);
    if(at+8+length>declaredEnd)throw new Error('Incomplete audio chunk.');
    if(!chunks.has(id))chunks.set(id,{offset:at+8,length});
    at+=8+length+(length&1);
  }
  return chunks;
}
async function decodeImportedAudio(data, filename) {
  const header=String.fromCharCode(...new Uint8Array(data,0,Math.min(12,data.byteLength)));
  if(header.startsWith('RIFF')&&header.slice(8)==='WAVE') {
    const chunks=audioChunks(data,true), fmt=chunks.get('fmt '), body=chunks.get('data');
    if(!fmt||fmt.length<16||!body)throw new Error('WAV needs format and audio chunks.');
    const parsed=new wav(data);
    if(parsed.readyState!==parsed.DONE)throw new Error('Invalid WAV file.');
    let compression=parsed.compression;
    if(compression===65534) {
      if(fmt.length<40)throw new Error('Incomplete extended WAV format.');
      compression=new DataView(data).getUint16(fmt.offset+24,true);
    }
    if(compression===1||compression===3)
      return pcmFromFile(data,{channels:parsed.numChannels,bits:parsed.bitsPerSample,rate:parsed.sampleRate,
        offset:body.offset,length:body.length,frames:body.length/parsed.blockAlign,stride:parsed.blockAlign,
        littleEndian:true,unsigned8:true,floating:compression===3});
  } else if(header.startsWith('FORM')&&['AIFF','AIFC'].includes(header.slice(8))) {
    const chunks=audioChunks(data,false), comm=chunks.get('COMM'), body=chunks.get('SSND');
    if(!comm||comm.length<18||!body||body.length<8)throw new Error('AIFF needs format and audio chunks.');
    const parsed=new aiff(data), view=new DataView(data);
    if(parsed.readyState!==parsed.DONE)throw new Error('Invalid AIFF file.');
    const compression=parsed.format==='AIFF'?'NONE':comm.length>=22
      ?String.fromCharCode(...new Uint8Array(data,comm.offset+18,4)):'';
    if(['NONE','twos','sowt','fl32','FL32','fl64','FL64'].includes(compression)) {
      const skip=view.getUint32(body.offset,false), length=body.length-8-skip;
      return pcmFromFile(data,{channels:parsed.numChannels,bits:parsed.sampleSize,rate:parsed.sampleRate,
        offset:body.offset+8+skip,length,frames:parsed.numSampleFrames,stride:parsed.numChannels*parsed.sampleSize/8,
        littleEndian:compression==='sowt',unsigned8:false,floating:/^fl(32|64)$/i.test(compression)});
    }
  } else if(header.startsWith('fLaC')) {
    const decoded=new flac(data).decoder.decodeStream();
    if(![1,2].includes(decoded.channels.length)||decoded.length<1||decoded.length>LumaSound.MAX_FRAMES)
      throw new Error('FLAC must be mono or stereo and fit the editor.');
    const mono=new Float32Array(decoded.length);
    for(let i=0;i<mono.length;i++)mono[i]=decoded.channels.length===1?decoded.channels[0][i]
      :(decoded.channels[0][i]+decoded.channels[1][i])/2;
    return ensureEditorFits(LumaSound.create(mono,decoded.sampleRate));
  }
  if(!/\.(wav|aif|aiff|aifc|flac|mp3|m4a|ogg)$/i.test(filename))throw new Error('Unsupported audio file type.');
  // Compressed formats use the browser's native-rate decoder, never the module's
  // low playback rate. PCM WAV/AIFF/FLAC above retain their exact source rate.
  audio_init();
  const decoded=await actx.decodeAudioData(data.slice(0));
  if(![1,2].includes(decoded.numberOfChannels)||decoded.length>LumaSound.MAX_FRAMES)
    throw new Error('Decoded audio must be mono or stereo and fit the editor.');
  const mono=decoded.getChannelData(0).slice();
  if(decoded.numberOfChannels===2){const right=decoded.getChannelData(1);for(let i=0;i<mono.length;i++)mono[i]=(mono[i]+right[i])/2;}
  return ensureEditorFits(LumaSound.create(mono,decoded.sampleRate));
}

function chooseRomHalf(generation) {
  return new Promise(resolve=>{
    const dialog=de('rom_half_dialog');
    function finish(choice) {dialog.removeEventListener('close',onClose);pendingRomChoice=null;resolve(choice);}
    function onClose(){finish(['0','1'].includes(dialog.returnValue)?Number(dialog.returnValue):null);}
    pendingRomChoice=()=>{dialog.removeEventListener('close',onClose);if(dialog.open)dialog.close('cancel');finish(null);};
    dialog.returnValue='cancel';dialog.addEventListener('close',onClose);dialog.showModal();
    if(!importStillCurrent(generation))pendingRomChoice();
  });
}
async function stageRom(data,name,generation,targetSlotId) {
  const bytes=new Uint8Array(data);
  if(bytes.length>=1&&bytes.length<=16384) {
    const id=targetSlotId??SLOT_ORDER.find(id=>!bank[id].sampleLength);
    if(id===undefined)throw new Error('All slots are occupied. Drop this BIN on a slot to replace it.');
    return {kind:'slot',slot:preparedSlot(id,LumaSound.fromBytes(bytes,LUMA_REFERENCE_RATE),withoutExtension(name))};
  }
  if(![131072,262144].includes(bytes.length))throw new Error('ROM files must be 128 KB, 256 KB, or a single sound of 1–16,384 bytes.');
  if(targetSlotId!==null)throw new Error('Drop a complete ROM on the editor to load its bank.');
  const half=bytes.length===262144?await chooseRomHalf(generation):0;
  if(half===null)return null;
  const staged=blankBank();
  SLOT_ORDER.forEach((id,physical)=>{const raw=bytes.slice(half*131072+physical*16384,half*131072+(physical+1)*16384);
    staged[id]=preparedSlot(id,LumaSound.fromBytes(raw,LUMA_REFERENCE_RATE),'Sample '+physical);});
  return {kind:'bank',bank:staged,name:withoutExtension(name)};
}

async function boundedZip(data) {
  const zip=await new JSZip().loadAsync(data,{createFolders:false});
  const entries=Object.values(zip.files).filter(file=>!file.dir&&!file.name.split('/').some(p=>p.startsWith('.'))&&!file.name.startsWith('__MACOSX/'));
  if(entries.length>128)throw new Error('This archive contains too many files.');
  let declared=0;
  for(const entry of entries){const count=entry._data?.uncompressedSize;
    if(!Number.isSafeInteger(count)||count<0||count>IMPORT_ENTRY_LIMIT)throw new Error('An archive entry exceeds the import limit.');declared+=count;}
  if(declared>IMPORT_ZIP_LIMIT)throw new Error('This archive expands beyond the import limit.');
  return {zip,entries,budget:{read:0}};
}
function readZipEntry(entry,budget,max=IMPORT_ENTRY_LIMIT) {
  return new Promise((resolve,reject)=>{
    if(!entry){reject(new Error('A required project file is missing.'));return;}
    let count=0,failed=false,crc=0xffffffff;const chunks=[],stream=entry.internalStream('uint8array');
    stream.on('data',chunk=>{if(failed)return;count+=chunk.length;budget.read+=chunk.length;
      if(count>max||budget.read>IMPORT_ZIP_LIMIT){failed=true;stream.pause();reject(new Error('Archive data exceeds the import limit.'));return;}
      for(const byte of chunk)crc=(crc>>>8)^ZIP_CRC_TABLE[(crc^byte)&255];chunks.push(chunk);})
      .on('error',reject).on('end',()=>{if(failed)return;
        if(((crc^0xffffffff)>>>0)!==(entry._data.crc32>>>0)){reject(new Error('An archive file failed its integrity check.'));return;}
        const bytes=new Uint8Array(count);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}resolve(bytes);}).resume();
  });
}
function zipText(bytes){return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
async function stageZip(data,generation) {
  const archive=await boundedZip(data), {entries,budget}=archive;
  const projects=entries.filter(e=>/(^|\/)LUMA_PROJECT\.json$/i.test(e.name));
  if(projects.length>1)throw new Error('The archive contains more than one project.');
  if(projects.length)return stageProject(archive,projects[0]);
  const names=entries.filter(e=>/(^|\/)BANKNAME\.TXT$/i.test(e.name));
  if(names.length!==1)throw new Error('Choose a bank ZIP containing one BANKNAME.TXT, or a saved .luma.zip project.');
  const prefix=names[0].name.slice(0,-12), staged=blankBank();
  const preparation=entries.find(e=>e.name.toUpperCase()===(prefix+'PREPARATION.JSON').toUpperCase());
  if(preparation){const legacy=JSON.parse(zipText(await readZipEntry(preparation,budget,65536)));
    if(legacy.version!==1||!Array.isArray(legacy.halfSpeedSlots))throw new Error('Invalid legacy preparation metadata.');
    if(legacy.halfSpeedSlots.length)throw new Error('This bank contains half-speed prepared sounds. Export ordinary-pitch WAVs from the older app and import those sounds here.');}
  const choices=new Map();
  for(const entry of entries){if(!entry.name.startsWith(prefix))continue;
    const parts=entry.name.slice(prefix.length).split('/');if(parts.length!==2)continue;
    const match=/^SLOT ([0-7])$/i.exec(parts[0]);if(!match||! /\.(bin|wav|aif|aiff|aifc|flac|mp3)$/i.test(parts[1]))continue;
    const id=SLOT_ORDER[Number(match[1])], old=choices.get(id), isBin=/\.bin$/i.test(parts[1]);
    if(old&&(/\.bin$/i.test(old.name)===isBin))throw new Error('More than one sound is assigned to '+parts[0]+'.');
    if(!old||isBin)choices.set(id,entry);
  }
  const name=zipText(await readZipEntry(names[0],budget,1024)).trim();
  for(const [id,entry] of choices){if(!importStillCurrent(generation))return null;
    const bytes=await readZipEntry(entry,budget), filename=entry.name.split('/').pop();
    const sound=/\.bin$/i.test(filename)?LumaSound.fromBytes(bytes,LUMA_REFERENCE_RATE)
      :await decodeImportedAudio(bytes.buffer,filename);
    staged[id]=preparedSlot(id,sound,withoutExtension(filename));}
  return {kind:'bank',bank:staged,name};
}

async function importFiles(fileList,targetSlotId=null) {
  invalidateImports();const generation=editorImportGeneration;
  try {
    const files=Array.from(fileList||[]);
    if(!files.length)return false;
    if(files.length!==1)throw new Error('Open one sound, ROM, bank ZIP, or project at a time.');
    if(targetSlotId!==null&&!SLOT_ORDER.includes(targetSlotId))throw new Error('Invalid destination slot.');
    const file=files[0];
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>IMPORT_FILE_LIMIT)throw new Error('Choose a nonempty file smaller than 64 MB.');
    isImporting=true;stopPlayingSound();cancelEditorGesture();refreshAll();showMessage('Opening '+cleanName(file.name)+'…');
    const data=await file.arrayBuffer();if(!importStillCurrent(generation))return false;
    let staged;
    if(/\.(bin|rom)$/i.test(file.name))staged=await stageRom(data,file.name,generation,targetSlotId);
    else if(/\.zip$/i.test(file.name)){if(targetSlotId!==null)throw new Error('Drop a bank or project ZIP on the editor.');staged=await stageZip(data,generation);}
    else {const sound=await decodeImportedAudio(data,file.name);staged=targetSlotId===null
      ?{kind:'editor',sound,name:withoutExtension(file.name)}:{kind:'slot',slot:preparedSlot(targetSlotId,sound,withoutExtension(file.name))};}
    if(!staged||!importStillCurrent(generation))return false;
    isImporting=false;
    if(staged.kind==='editor')loadEditorSound(staged.sound,staged.name,0);
    else if(staged.kind==='slot'){pushUndo('load slot');bank[staged.slot.id]=staged.slot;selectedSlotId=staged.slot.id;refreshAll();}
    else if(staged.kind==='project')commitProject(staged);
    else commitBank(staged.bank,staged.name,'load bank');
    showMessage('Opened '+cleanName(file.name)+'.');return true;
  } catch(error){if(importStillCurrent(generation))showMessage(error.message||String(error),true);return false;}
  finally {if(importStillCurrent(generation)){isImporting=false;refreshAll();}}
}
function openRomBankFile(file){return importFiles([file]);}
function dragOverHandler(event){event.preventDefault();event.currentTarget.classList.add('drag-over');}
function dragLeaveHandler(event){if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('drag-over');}
function dropHandler(event){event.preventDefault();event.stopPropagation();event.currentTarget.classList.remove('drag-over');
  if(event.dataTransfer.files.length)return importFiles(event.dataTransfer.files);
  const id=event.dataTransfer.getData('text/plain');if(/^[0-7]$/.test(id))copyWaveFormBetweenSlots(Number(id),255);
}

function buildMuRomBank() {
  const output=new Uint8Array(131072);
  SLOT_ORDER.forEach((id,physical)=>{const slot=bank[id];if(!slot)throw new Error('Missing slot '+physical+'.');
    if(!slot.sampleData){if(slot.sampleLength)throw new Error('Invalid slot length.');return;}
    if(!(slot.sampleData instanceof Uint8Array)||slot.sampleData.length>16384||slot.sampleLength!==slot.sampleData.length)
      throw new Error('Slot '+physical+' has invalid audio or exceeds 16,384 samples.');
    output.set(slot.sampleData,physical*16384);});
  return output;
}
function downloadFile(name,data,type='application/octet-stream') {
  const blob=data instanceof Blob?data:new Blob([data],{type});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=String(name).replace(/[/\\\x00-\x1f]/g,'_').slice(0,180);link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function wavBytes(pcm,rate) {
  const output=new ArrayBuffer(44+pcm.length*2),view=new DataView(output);
  function text(at,value){for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));}
  text(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++)view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(pcm[i]*32768))),true);
  return output;
}
function exportSample(){return guarded(()=>{if(!editorSound)throw new Error('Load a sound first.');const rendered=renderEditorSelection(false);
  downloadFile(withoutExtension(sampleName)+'.wav',wavBytes(LumaSound.fromBytes(rendered.bytes,rendered.rate).pcm,rendered.rate),'audio/wav');});}
function exportBankAsRomMu(){return guarded(()=>downloadFile(cleanName(de('bank_name_mu').value,'Untitled')+'.bin',buildMuRomBank()));}
async function exportBankAsZip() {
  try {const {name,blob}=await buildBankZip();
    downloadFile(name+'.zip',blob);showMessage('Exported bank ZIP.');
  } catch(error){showMessage(error.message,true);}
}
async function buildBankZip() {
  {buildMuRomBank();const zip=new JSZip(),name=cleanName(de('bank_name_mu').value,'Untitled');zip.file('BANKNAME.TXT',name);
    zip.file('TUNING.JSON',JSON.stringify({version:1,playback_reference_hz:LUMA_REFERENCE_RATE,approximate:true},null,2));
    SLOT_ORDER.forEach((id,physical)=>{const slot=bank[id];if(!slot.sampleLength)return;
      const base='SLOT '+physical+'/'+withoutExtension(slot.name);zip.file(base+'.bin',slot.sampleData.slice());
      zip.file(base+'.wav',wavBytes(LumaSound.fromBytes(slot.sampleData,LUMA_REFERENCE_RATE).pcm,LUMA_REFERENCE_RATE));});
    return {name,blob:await zip.generateAsync({type:'blob',compression:'DEFLATE'})};
  }
}

function packProjectSound(zip,sound,key) {
  if(!sound)return null;
  const checked=LumaSound.clone(sound), bytes=new Uint8Array(checked.pcm.length*4),view=new DataView(bytes.buffer);
  for(let i=0;i<checked.pcm.length;i++)view.setFloat32(i*4,checked.pcm[i],true);
  zip.file(key+'.f32',bytes);
  const info={pcm:key+'.f32',rate:checked.rate,frames:checked.pcm.length};
  if(checked.rawBytes){info.raw=key+'.bin';zip.file(info.raw,checked.rawBytes);}
  if(checked.rawExact){info.mask=key+'.mask';zip.file(info.mask,checked.rawExact);}
  return info;
}
function createProjectZip() {
  buildMuRomBank();
  const zip=new JSZip(), project={format:'LumaToolsProject',version:1,referenceRate:LUMA_REFERENCE_RATE,
    bankName:cleanName(de('bank_name_mu').value,'Untitled'),selectedSlot:SLOT_ORDER.indexOf(selectedSlotId),
    editor:{sound:packProjectSound(zip,editorSound,'audio/editor'),name:cleanName(sampleName),pitch:editorPitch,
      selection:[editor_in_point,editor_out_point],view:[editorZoomLevel,editorViewStart],
      lpg:{decay:Number(de('percussion_decay').value),damping:Number(de('percussion_damping').value)}},
    slots:SLOT_ORDER.map((id,physical)=>{const slot=bank[id];return {slot:physical,name:cleanName(slot.name),
      pitch:slot.pitch||0,previewPitch:slot.previewPitch??slot.pitch??0,
      sound:slot.sampleLength?packProjectSound(zip,slot.source,'audio/slot-'+physical):null};})};
  if(lpgSession?.applied===editorSound&&editorSound)
    project.editor.lpgSession={base:packProjectSound(zip,lpgSession.base,'audio/editor-lpg-base'),range:[...lpgSession.range]};
  for(const slot of project.slots)if(bank[SLOT_ORDER[slot.slot]].sampleLength&&!slot.sound)
    throw new Error('A slot has no retained source and cannot be saved as a project.');
  zip.file('LUMA_PROJECT.json',JSON.stringify(project,null,2));
  return zip;
}
async function saveProject() {
  try{const name=cleanName(de('bank_name_mu').value,'Untitled');const zip=createProjectZip();
    downloadFile(name+'.luma.zip',await zip.generateAsync({type:'blob',compression:'DEFLATE'}));showMessage('Project saved with retained sources and applied edits.');
  }catch(error){showMessage(error.message,true);}
}
async function unpackProjectSound(archive,info,prefix) {
  if(info===null)return null;
  if(!info||typeof info!=='object'||!Number.isSafeInteger(info.frames)||info.frames<1||info.frames>LumaSound.MAX_FRAMES)
    throw new Error('Invalid saved sound length.');
  async function entry(name,expected){
    if(typeof name!=='string'||!/^audio\/[a-z0-9-]+\.(f32|bin|mask)$/.test(name))throw new Error('Invalid project audio entry.');
    const file=archive.entries.find(e=>e.name===prefix+name),bytes=await readZipEntry(file,archive.budget,expected);
    if(bytes.length!==expected)throw new Error('Incomplete project audio.');return bytes;
  }
  const bytes=await entry(info.pcm,info.frames*4),view=new DataView(bytes.buffer),pcm=new Float32Array(info.frames);
  for(let i=0;i<pcm.length;i++)pcm[i]=view.getFloat32(i*4,true);
  const sound=LumaSound.create(pcm,info.rate);
  if(info.raw!==undefined)sound.rawBytes=await entry(info.raw,info.frames);
  if(info.mask!==undefined)sound.rawExact=await entry(info.mask,info.frames);
  if(sound.rawBytes){const original=LumaSound.fromBytes(sound.rawBytes,sound.rate).pcm;
    for(let i=0;i<pcm.length;i++)if((sound.rawExact==null||sound.rawExact[i]===1)&&pcm[i]!==original[i])
      throw new Error('Saved original bytes do not match their retained audio.');}
  return LumaSound.clone(sound);
}
async function stageProject(archive,entry) {
  const project=JSON.parse(zipText(await readZipEntry(entry,archive.budget,65536)));
  if(!project||project.format!=='LumaToolsProject'||project.version!==1||project.referenceRate!==LUMA_REFERENCE_RATE)
    throw new Error('This project uses an unsupported format or calibration.');
  if(!Array.isArray(project.slots)||project.slots.length!==8||!project.editor||
      !Number.isInteger(project.selectedSlot)||project.selectedSlot<0||project.selectedSlot>7)
    throw new Error('Invalid project structure.');
  const prefix=entry.name.slice(0,-'LUMA_PROJECT.json'.length), staged=blankBank(),used=new Set();
  for(const slot of project.slots){
    if(!slot||!Number.isInteger(slot.slot)||slot.slot<0||slot.slot>7||used.has(slot.slot))throw new Error('Invalid project slot order.');
    used.add(slot.slot);validatePitch(slot.pitch);const proposal=validatePitch(slot.previewPitch??slot.pitch);
    const sound=await unpackProjectSound(archive,slot.sound,prefix);
    if(sound)staged[SLOT_ORDER[slot.slot]]={...preparedSlot(SLOT_ORDER[slot.slot],sound,slot.name,slot.pitch),previewPitch:proposal};
  }
  const editor=project.editor, sound=await unpackProjectSound(archive,editor.sound,prefix);
  validatePitch(editor.pitch);const display=sound?LumaSound.render(ensureEditorFits(sound),LUMA_REFERENCE_RATE,0):null;
  if(!Array.isArray(editor.selection)||editor.selection.length!==2||!editor.selection.every(Number.isSafeInteger)||
      (sound?(editor.selection[0]<0||editor.selection[1]<editor.selection[0]||editor.selection[1]>=display.bytes.length)
        :(editor.selection[0]!==0||editor.selection[1]!==-1)))throw new Error('Invalid saved selection.');
  if(!Array.isArray(editor.view)||editor.view.length!==2||!editor.view.every(Number.isFinite)||
      editor.view[0]<1||editor.view[0]>500||editor.view[1]<0||editor.view[1]>(display?.bytes.length||0))
    throw new Error('Invalid saved editor view.');
  if(!editor.lpg||![editor.lpg.decay,editor.lpg.damping].every(v=>Number.isFinite(v)&&v>=0&&v<=100))
    throw new Error('Invalid saved low-pass gate controls.');
  let session=null;
  if(editor.lpgSession!==undefined){
    const saved=editor.lpgSession;
    if(!saved||!sound||!Array.isArray(saved.range)||saved.range.length!==2||!saved.range.every(Number.isSafeInteger)||
        saved.range[0]<0||saved.range[1]<=saved.range[0]||saved.range[1]>sound.pcm.length)
      throw new Error('Invalid saved low-pass gate selection.');
    const base=await unpackProjectSound(archive,saved.base,prefix);
    if(!base||base.rate!==sound.rate||base.pcm.length!==sound.pcm.length)
      throw new Error('Invalid saved low-pass gate source.');
    session={base,range:[...saved.range],applied:sound};
  }
  return {kind:'project',bank:staged,name:cleanName(project.bankName,'Untitled'),selectedSlotId:SLOT_ORDER[project.selectedSlot],
    editor:{...editor,sound,name:cleanName(editor.name),session}};
}
function commitProject(staged) {
  stopPlayingSound();cancelEditorGesture();pushUndo('open project');
  bank=staged.bank;selectedSlotId=staged.selectedSlotId;de('bank_name_mu').value=staged.name;
  const editor=staged.editor;editorSound=editor.sound;editorPitch=editor.pitch;sampleName=editor.name;
  de('sample_name_mu').value=sampleName;lpgSession=editor.session;lpgPreviewCache=null;syncEditorDisplay();
  [editor_in_point,editor_out_point]=editor.selection;[editorZoomLevel,editorViewStart]=editor.view;
  de('percussion_decay').value=editor.lpg.decay;de('percussion_damping').value=editor.lpg.damping;
  de('percussion_decay_value').textContent=editor.lpg.decay+'%';de('percussion_damping_value').textContent=editor.lpg.damping+'%';
  refreshAll();
}
