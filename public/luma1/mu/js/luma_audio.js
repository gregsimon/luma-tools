// Playback and the original approximate nonlinear Luma listening model.
function audio_init() {
  if (!actx) actx = new classAudioContext({sampleRate:48000,latencyHint:'interactive'});
  if (actx.state === 'suspended') actx.resume();
}
function createAudioBufferFromBytes(bytes,rate=LUMA_REFERENCE_RATE) {
  if (!bytes?.length) return null;
  const buffer=actx.createBuffer(1,bytes.length,rate),pcm=buffer.getChannelData(0);
  for(let i=0;i<bytes.length;i++)pcm[i]=ulaw_to_linear(~bytes[i])/32768;
  return buffer;
}
// ========================= AM6072+555 Emulation (Luma-Mu hardware preview) =========================

const CLOCK_WANDER_CENTS = 1.5;   // slow thermal drift (std, sub-Hz)
const CLOCK_JITTER_SEC = 150e-9;  // per-cycle period noise (std), constant in TIME

// Measured knob taper: [position 0..1, semitones re as-prepped pitch].
const KNOB_TAPER = [
  [0.000, -16.25], [0.143, -15.20], [0.286, -12.77], [0.429, -9.57],
  [0.490, -7.11], [0.571, -4.78], [0.714, 1.52], [0.857, 8.97],
  [1.000, 16.10],
];

function knobToSemitones(pos) {
  pos = Math.max(0, Math.min(1, pos));
  for (let i = 1; i < KNOB_TAPER.length; i++) {
    const [p0, s0] = KNOB_TAPER[i - 1], [p1, s1] = KNOB_TAPER[i];
    if (pos <= p1) return s0 + (s1 - s0) * (pos - p0) / (p1 - p0);
  }
  return KNOB_TAPER[KNOB_TAPER.length - 1][1];
}

function mulawCompand(x) {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    const mag = Math.abs(v) * 8031;
    const biased = Math.min(mag + 33, 8191);
    const chord = Math.max(0, Math.min(7, Math.floor(Math.log2(biased)) - 5));
    const step = Math.max(0, Math.min(15,
        Math.floor(biased / Math.pow(2, chord + 1)) - 16));
    const dec = Math.pow(2, chord) * (2 * step + 33) - 33;
    out[i] = Math.sign(v) * dec / 8031;
  }
  return out;
}

function gauss() {  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function zohRender(rom, clock, outRate,
                    wanderCents = CLOCK_WANDER_CENTS,
                    jitterSec = CLOCK_JITTER_SEC) {
  const n = rom.length;
  if (n < 2) return new Float32Array(1);
  // slow wander at the clock rate
  let acc = new Float64Array(n);
  if (wanderCents > 0) {
    const a = 1 - Math.exp(-2 * Math.PI * 0.3 / clock);
    let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      p1 += a * (gauss() - p1);
      p2 += a * (p1 - p2);
      acc[i] = p2;
    }
    let m = 0, s = 0;
    for (let i = 0; i < n; i++) m += acc[i];
    m /= n;
    for (let i = 0; i < n; i++) s += (acc[i] - m) * (acc[i] - m);
    s = Math.sqrt(s / n);
    const target = (wanderCents / 1200) * Math.LN2;
    if (s > 0) for (let i = 0; i < n; i++) acc[i] *= target / s;
  }
  const jitFrac = jitterSec * clock;
  const base = outRate / clock;
  // edge times (output-rate units)
  const edges = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    let per = base * (1 - acc[i] + jitFrac * gauss());
    if (per < 0.05 * base) per = 0.05 * base;
    t += per;
    edges[i] = t;
  }
  const nOut = Math.floor(edges[n - 1]);
  if (nOut < 2) return new Float32Array(1);
  const y = new Float64Array(nOut);
  // naive hold: forward walk
  let k = 0;
  for (let m2 = 0; m2 < nOut; m2++) {
    while (k < n - 1 && edges[k] <= m2) k++;
    y[m2] = rom[Math.min(k, n - 1)];
  }
  // polyBLEP bandlimited correction at every transition
  for (let e = 0; e < n - 1; e++) {
    const et = edges[e];
    if (et <= 0 || et >= nOut - 1) continue;
    const dv = rom[e + 1] - rom[e];
    const i = Math.floor(et);
    const f = et - i;
    y[i] += dv * (1 - f) * (1 - f) / 2;
    y[i + 1] -= dv * f * f / 2;
  }
  return Float32Array.from(y);
}

function simulate(rom, knobPos, outRate, romRate) {
  const st = knobToSemitones(knobPos) - knobToSemitones(0.49);
  const clock = romRate * Math.pow(2, st / 12);
  return zohRender(mulawCompand(rom), clock, outRate);
}

function createEmulatedAudioBufferFromBytes(sampleData, playbackSampleRate) {
  if (!sampleData || sampleData.length === 0) return null;

  const numSamples = sampleData.length;
  const rom = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    let ulaw = sampleData[i];
    ulaw = ~ulaw; // Invert from storage format
    const linear = ulaw_to_linear(ulaw);
    rom[i] = linear / 32768.0; // Convert to [-1, 1]
  }

  // Get current pitch setting (0..100) -> 0..1
  const pitchInput = document.getElementById("emu_pitch");
  const pos = pitchInput ? parseFloat(pitchInput.value) / 100 : 0.49;
  const outRate = actx.sampleRate; // Browser's native AudioContext sample rate

  // Run the emulation chain
  const emulatedData = simulate(rom, pos, outRate, playbackSampleRate);

  // Create AudioBuffer at the browser's native sample rate
  const audioBuffer = actx.createBuffer(1, emulatedData.length, outRate);
  audioBuffer.copyToChannel(emulatedData, 0);

  return audioBuffer;
}

function createPlaybackAudioBuffer(sampleData, playbackSampleRate) {
  const emuCheckbox = document.getElementById('emu_enable');
  const isEmuEnabled = emuCheckbox && emuCheckbox.checked;

  if (isEmuEnabled) {
    return createEmulatedAudioBufferFromBytes(sampleData, playbackSampleRate);
  } else {
    return createAudioBufferFromBytes(sampleData, playbackSampleRate);
  }
}

function stopPlayingSound() {
  const previous=playingSound;playingSound=null;
  if(previous){previous.onended=null;try{previous.stop();}catch{}previous.disconnect();}
  if(animationFrameId)cancelAnimationFrame(animationFrameId);animationFrameId=null;
  drawEditorCanvas();
}
function startAudio(bytes,tag,{loop=false,slotId=null}={}) {
  if(!bytes?.length)return false;
  audio_init();stopPlayingSound();
  const buffer=createPlaybackAudioBuffer(bytes,LUMA_REFERENCE_RATE);
  const node=actx.createBufferSource();node.buffer=buffer;node.loop=loop;node.connect(actx.destination);
  node.tag=tag;node.slotId=slotId;node.isEditorSound=['editor','lpg','lpg-before'].includes(tag);
  node.selectionStart=editor_in_point;node.selectionCount=editor_out_point-editor_in_point+1;
  node.startOffset=editor_in_point/LUMA_REFERENCE_RATE;
  node.playbackOffset=node.startOffset;node.loopDuration=buffer.duration;
  node.pitchScale=node.selectionCount/LUMA_REFERENCE_RATE/buffer.duration;
  playingSound=node;playbackStartTime=actx.currentTime;
  node.onended=()=>{node.disconnect();if(playingSound===node){playingSound=null;if(animationFrameId)cancelAnimationFrame(animationFrameId);animationFrameId=null;drawEditorCanvas();}};
  node.start();
  const cursor=()=>{if(playingSound!==node)return;drawEditorCanvas();animationFrameId=requestAnimationFrame(cursor);};cursor();
  return true;
}
function playAudio() {
  if(playingSound?.tag==='editor'){stopPlayingSound();return;}
  return guarded(()=>{if(!editorSound)return false;const proposal=renderEditorSelection();return startAudio(proposal.bytes,'editor',{loop:de('loop_playback_button').classList.contains('loop_active')});});
}
function playSlotAudio(id) {
  return guarded(()=>{if(!SLOT_ORDER.includes(id)||!bank[id].sampleLength)return false;const s=bank[id];const bytes=s.previewPitch===s.pitch?s.sampleData:LumaSound.render(s.source,LUMA_REFERENCE_RATE,s.previewPitch).bytes;if(bytes.length>16384)throw Error('This pitch exceeds the slot. Raise pitch or shorten the sound.');return startAudio(bytes,'slot',{slotId:id});});
}
function toggleSlotAudio(id) {if(playingSound?.tag==='slot'&&playingSound.slotId===id)stopPlayingSound();else playSlotAudio(id);}
function toggleLoopPlayback(){const button=de('loop_playback_button'),enabled=button.classList.toggle('loop_active');button.textContent='Loop: '+(enabled?'On':'Off');if(playingSound?.isEditorSound)playingSound.loop=enabled;}
function toggleZeroCrossingSnap(){snapToZeroCrossing=!snapToZeroCrossing;de('zero_crossing_snap_button').textContent='Snap Zero: '+(snapToZeroCrossing?'On':'Off');de('zero_crossing_snap_button').classList.toggle('loop_active',snapToZeroCrossing);}
function updateEmuPitchLabel(){const pos=Number(de('emu_pitch').value),st=knobToSemitones(pos/100)-knobToSemitones(.49);de('emu_pitchval').textContent=`${pos.toFixed(0)}% · ${st>=0?'+':''}${st.toFixed(1)} st`;}
function resetEmuPitch(){de('emu_pitch').value='49';updateEmuPitchLabel();stopPlayingSound();}
function initEmuControls(){de('emu_enable').onchange=()=>{stopPlayingSound();de('emu_controls').hidden=!de('emu_enable').checked;};de('emu_pitch').oninput=()=>{stopPlayingSound();updateEmuPitchLabel();};updateEmuPitchLabel();}
function getLinearSample(index){return editorSampleData&&index>=0&&index<editorSampleLength?ulaw_to_linear(~editorSampleData[index]):0;}
function getSampleSlope(index){return Math.sign(getLinearSample(index+1)-getLinearSample(index));}
function findNearestZeroCrossing(target,preferredSlope=0){
  if(!editorSampleLength)return 0;target=Math.max(0,Math.min(editorSampleLength-1,Math.round(target)));
  for(let distance=0;distance<Math.min(512,editorSampleLength);distance++)for(const i of [target-distance,target+distance]){
    if(i<0||i>=editorSampleLength-1)continue;const a=getLinearSample(i),b=getLinearSample(i+1);
    if((a===0||a*b<0)&&(!preferredSlope||getSampleSlope(i)===preferredSlope))return i;
  }return target;
}
