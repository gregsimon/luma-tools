// luma_sequencer.js — LM-1 Step Sequencer for luma.tools
// Integrates with luma_core.js (actx, bank[]), luma_audio.js (createAudioBufferFromBytes),
// luma_midi.js (writeRAMToDevice, ram_dump).

// Key-to-voice mapping
const SEQ_VKEYS=['q','w','e','r','t','y','u','i','o','p','[',']'];
const SEQ_VKEY_MAP={q:0,w:1,e:2,r:3,t:4,y:5,u:6,i:7,o:8,p:9,'[':10,']':11};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SEQ_NV = 12;           // number of voice rows
const SEQ_OFF = 0, SEQ_SOFT = 1, SEQ_LOUD = 2, SEQ_OPEN = 3;
const SEQ_AUTO_CORR = 12;    // LM-1 1/16th = 12 hardware ticks

// Voice row → bank[] slot mapping + playback rate
// Tom Hi/Lo and Conga Hi/Lo share one sample but play at different pitches
const SEQ_VOICE_BANK = [0,1,2,3,4,5, 6,   6,    7,   7,    8,  9];
const SEQ_VOICE_RATE = [1,1,1,1,1,1, 1.0, 0.72, 1.0, 0.72, 1,  1];

const SEQ_VLBL  = ['BAS','SNR','HH ','CLP','CBS','TMB','T.HI','T.LO','C.HI','C.LO','CWB','RS '];
const SEQ_VNAME = ['Bass','Snare','Hi-Hat','Claps','Cabasa','Tamb',
                   'Tom Hi','Tom Lo','Conga Hi','Conga Lo','Cowbell','Rimshot'];
const SEQ_BIN      = [0,0,0,1,0,0,1,1,1,1,1,1]; // binary (on/off) voices
const SEQ_HAS_OPEN = [0,0,1,0,0,0,0,0,0,0,0,0]; // voices with open state

const SEQ_CHAIN_BASE = 0x148; // A148h - A000h
const SEQ_TABLE_OFF  = 0x07E;
const SEQ_RAM_BASE   = 0xA000;
const SEQ_HEAP_BASE  = 0xA468;

const SEQ_SHUFFLE_PCT = [50,54,58,62,66,70]; // LM-1 ADJ SHFL LEDs
// LM-1 shuffle (manual: AUTO-CORRECT → Shuffle Settings). With AUTO CORR at 16, the odd-numbered
// 1/16 notes get X% of each 1/8 note, i.e. every second 1/16 is late by (X−50)% of a 1/8 note.
// With AUTO CORR at 8, the same applies to the 1/8 notes as a share of each 1/4 note.
// In ticks (12 per 1/16): 16 → 54%..70% = 1..5 ticks; 8 → 54%..70% = 2..10 ticks.
const SEQ_SHUFFLE_RES = [16, 8];
// Ratchet: repeats within one step. A step is 12 ticks, so only counts that divide 12 are exact.
const SEQ_RATCHETS = [1, 2, 3, 4, 6, 12];
const SEQ_MAX_NUDGE = 5;     // micro-offset range in ticks (±5/12 of a step)
const SEQ_HH_CODE = [0,1,3,2]; // SEQ value → D-register hi-hat bits (soft=1, open=2, loud=3)

// ─── STATE ───────────────────────────────────────────────────────────────────

let seqNS     = 16;           // pattern length in steps (1–32); steps beyond are inactive
let seqPitchMult = new Array(SEQ_NV).fill(1.0); // playback-rate factor, = 2^(seqTuneSt/12)
let seqTuneSt    = new Array(SEQ_NV).fill(0);   // per-voice tuning in semitones (±SEQ_TUNE_RANGE)
let seqVol       = new Array(SEQ_NV).fill(1.0); // per-voice volume 0..1.5 (editor playback only)
let seqVoiceBus  = new Array(SEQ_NV).fill(null); // per-voice GainNode → destination
let seqSynthOut  = null;                       // where the synth fallback of the current voice plays
const SEQ_TUNE_RANGE = 24;
let seqBpm    = 120;
let seqHhDecayMs = 250;  // HiHat decay ms (slider default)
let seqPlaying = false;
let seqPlayStep = 0;
let seqNextT   = 0;
let seqTimer   = null;
let seqSteps   = Array.from({length:SEQ_NV}, () => new Array(32).fill(0));
let seqShifts  = Array.from({length:SEQ_NV}, () => new Int8Array(32));
let seqRatchet = Array.from({length:SEQ_NV}, () => new Uint8Array(32).fill(1)); // repeats per hit
let seqActiveSlot  = -1;
let seqPlayingSlot = -1;
let seqQueuedSlot  = -1;
let seqChainMode      = false;
let seqSelectedChain  = -1;
let seqChainLinks     = [];
let seqChainLinkIdx   = 0;
let seqCurrentRam     = null; // Uint8Array copy of the current RAM
let seqEmuEnabled     = false; // Luma-Sim: play voices through the hardware emulation
let seqEmuKnob        = 0.49;  // Luma-Sim pitch knob 0..1 (0.49 = noon)
let seqEmuCache       = {};    // bank slot → {data, rate, knob, buf}; rendering is slow, so reuse
let seqHoverCell      = null; // {v,s} of the step under the mouse (target for ←/→ nudge)
let seqPaint          = null; // drag-painting along a row: {v, val, last}
let seqLenAdjust      = 0;    // ticks beyond seqNS*12 (−6..+5) for patterns that aren't whole steps
let seqExtraE         = new Map(); // abs tick → E-register bit 7 (meaning unknown; kept as found)
let seqLongPattern    = null; // {slot, steps} when the loaded pattern is longer than 32 steps
let seqRamSource      = '';   // shown next to the pattern count, e.g. the default bank's name
// Pattern bank used until RAM is read from the Luma-1 or loaded from a file: data/default_ram.js
// (Joe's card RAMBANKS/00/RAM_IMAGE_0F27.bin, "Pseudo-Factory Patts")
let seqRowShuffle     = Array.from({length:SEQ_NV}, () => ({res:16, pct:50})); // per instrument

// ─── AUDIO ───────────────────────────────────────────────────────────────────

// Pre-decode bank samples into AudioBuffers for zero-latency playback
// We create one buffer per voice row (Tom Hi/Lo at different rates)
let seqVoiceBuffers = new Array(SEQ_NV).fill(null);

// Pre-cache decoded AudioBuffers for each voice row from luma.tools bank[]
// Called by seqOnTabShown() and before first play so we always have fresh buffers.
function seqRefreshVoiceBuffers() {
  // actx lives in luma_core.js; if it hasn't been initialised yet (no user gesture)
  // just clear the cache — it will be rebuilt on the next play.
  seqVoiceBuffers = new Array(SEQ_NV).fill(null);
  if (typeof actx === 'undefined' || !actx) return;
  if (typeof bank === 'undefined' || !bank) return;

  for (let v = 0; v < SEQ_NV; v++) {
    const slot = SEQ_VOICE_BANK[v];
    const b = bank[slot];
    if (!b || !b.sampleData || b.sampleData.length === 0) continue;
    try {
      // createAudioBufferFromBytes is from luma_audio.js — decodes uLaw to float32 AudioBuffer
      const sampleRate = b.sample_rate || 12000;
      const buf = seqEmuEnabled ? seqEmulatedBuffer(slot, b.sampleData, sampleRate)
                                : createAudioBufferFromBytes(b.sampleData, sampleRate);
      if (buf) seqVoiceBuffers[v] = { buf, rate: SEQ_VOICE_RATE[v] };
    } catch (e) {
      // slot not loaded yet — synthesis fallback will be used
    }
  }
}

// Ticks the row's LM-1 shuffle adds to step s (0 for steps it doesn't move)
function seqShuffleTicks(v, s) {
  const {res,pct}=seqRowShuffle[v];
  if(pct<=50) return 0;
  if(res===16) return s%2===1 ? Math.round((pct-50)/100*2*SEQ_AUTO_CORR) : 0;
  return s%4===2 ? Math.round((pct-50)/100*4*SEQ_AUTO_CORR) : 0;
}
// Where a hit actually plays, in ticks from its grid step: row shuffle + micro offset
function seqHitOffset(v, s) {
  return seqShuffleTicks(v,s)+((seqShifts[v]&&seqShifts[v][s])||0);
}
// Tick offsets (from the grid step) of every repeat of a hit: the burst starts where the hit
// plays (shuffle + micro offset) and spreads its repeats evenly over one step.
function seqHitTimes(v, s) {
  const off=seqHitOffset(v,s), k=seqRatchet[v][s]||1, d=SEQ_AUTO_CORR/k;
  return Array.from({length:k},(_,j)=>off+j*d);
}

function seqShuffleLabel(sh) {
  return sh.pct<=50 ? '50%' : `${sh.res} · ${sh.pct}%`;
}

// Luma-Sim render of one bank slot (luma_audio.js), cached until the sample, rate or knob changes.
// Tom/Conga Hi and Lo share a slot, so they share one render.
function seqEmulatedBuffer(slot, data, rate) {
  const c=seqEmuCache[slot];
  if(c&&c.data===data&&c.rate===rate&&c.knob===seqEmuKnob) return c.buf;
  const buf=createEmulatedAudioBufferFromBytes(data, rate, seqEmuKnob);
  seqEmuCache[slot]={data,rate,knob:seqEmuKnob,buf};
  return buf;
}

function seqUpdateEmuLabel() {
  const lbl=document.getElementById('seqEmuPitchVal');
  if(!lbl) return;
  const st=knobToNoonSemitones(seqEmuKnob);
  lbl.textContent=`${(seqEmuKnob*100).toFixed(0)}% · ${st>=0?'+':''}${st.toFixed(1)} st`;
}

// Each voice plays through its own gain node, so its volume can change while a pattern plays
function seqVoiceOut(v) {
  let g=seqVoiceBus[v];
  if(!g||g.context!==actx){
    g=actx.createGain(); g.gain.value=seqVol[v]; g.connect(actx.destination);
    seqVoiceBus[v]=g;
  }
  return g;
}

// Play one voice hit.  Uses the pre-cached AudioBuffer if available; falls back to synthesis.
function seqPlayVoice(v, val, when) {
  // actx is owned by luma.tools — ensure it's running
  if (typeof actx === 'undefined' || !actx) return;
  if (actx.state === 'suspended') actx.resume();

  const vb = seqVoiceBuffers[v];
  if (vb && vb.buf) {
    const src = actx.createBufferSource();
    src.buffer = vb.buf;
    src.playbackRate.value = vb.rate * seqPitchMult[v];
    const gain = actx.createGain();
    const baseAmp = (val === SEQ_SOFT) ? 0.55 : 1.0;
    gain.gain.value = baseAmp;
    if (v === 2) {
      // HiHat sample: decay envelope via setTargetAtTime
      const decaySec = val===SEQ_OPEN ? (seqHhDecayMs*2)/1000 : seqHhDecayMs/1000;
      gain.gain.setTargetAtTime(0.0, when, decaySec/5);
    }
    src.connect(gain);
    gain.connect(seqVoiceOut(v));
    src.start(when);
  } else {
    // No sample loaded in this Voice Bank slot — use WebAudio synthesis
    seqSynthVoice(v, val, when);
  }
}

// WebAudio synthesis fallback (used when a Voice Bank slot has no sample loaded)
function seqSynthOsc(freq, type, when, dur, amp, glide) {
  if (typeof actx === 'undefined' || !actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, when + dur);
  g.gain.setValueAtTime(amp, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  o.connect(g); g.connect(seqSynthOut||actx.destination);
  o.start(when); o.stop(when + dur + 0.01);
}
function seqSynthNz(when, dur, amp, hp, decay) {
  if (typeof actx === 'undefined' || !actx) return;
  const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource(); src.buffer = buf;
  const filt = actx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = hp || 2000;
  const g = actx.createGain();
  g.gain.setValueAtTime(amp, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + (decay || dur));
  src.connect(filt); filt.connect(g); g.connect(seqSynthOut||actx.destination);
  src.start(when);
}
function seqSynthVoice(v, val, when) {
  seqSynthOut=seqVoiceOut(v);
  const a = val === SEQ_LOUD ? 1.0 : 0.55;
  switch (v) {
    case  0: seqSynthOsc(90*seqPitchMult[0],'sine',when,.4,a,42*seqPitchMult[0]); seqSynthNz(when,.04,a*.2,200,.5); break;
    case  1: seqSynthNz(when,.14,a*.7,1200,1); seqSynthOsc(200,'sine',when,.06,a*.3); break;
    case  2: {
      // HiHat: exponential decay baked into PCM samples — no AudioParam scheduling.
      const decaySec = val===SEQ_OPEN ? (seqHhDecayMs*2)/1000 : seqHhDecayMs/1000;
      const amp = val===SEQ_SOFT ? 0.28 : 0.50;
      const sr = actx.sampleRate;
      const nSamples = Math.ceil(sr * decaySec);
      const nb = actx.createBuffer(1, nSamples, sr);
      const nd = nb.getChannelData(0);
      const tau = nSamples / 6;
      let prev = 0;
      for(let i=0;i<nSamples;i++){
        const raw = Math.random()*2-1;
        prev = raw - 0.85*prev;
        nd[i] = prev * amp * Math.exp(-i/tau);
      }
      const nsrc=actx.createBufferSource(); nsrc.buffer=nb;
      nsrc.connect(seqSynthOut||actx.destination);
      nsrc.start(when);
      break;
    }
        case  3: for(let i=0;i<3;i++) seqSynthNz(when+i*.009,.07,.5,1400,1.5); break;
    case  4: seqSynthNz(when,.04,a*.5,3500); break;
    case  5: seqSynthNz(when,.09,a*.5,4500); seqSynthOsc(2200,'sine',when,.03,a*.12); break;
    case  6: seqSynthOsc(115*seqPitchMult[6],'sine',when,.28,a,50*seqPitchMult[6]); break;  // Tom Hi
    case  7: seqSynthOsc(78*seqPitchMult[7],'sine',when,.30,a,35*seqPitchMult[7]); break;   // Tom Lo
    case  8: seqSynthOsc(220*seqPitchMult[8],'sine',when,.18,a,90*seqPitchMult[8]); break;  // Conga Hi
    case  9: seqSynthOsc(140*seqPitchMult[9],'sine',when,.20,a,65*seqPitchMult[9]); break;  // Conga Lo
    case 10: seqSynthOsc(562*seqPitchMult[10],'square',when,.35,a); seqSynthOsc(845*seqPitchMult[10],'square',when,.35,a*.7); break;
    case 11: seqSynthNz(when,.045,.7,1100,2); seqSynthOsc(280,'sine',when,.03,.4); break; // Rimshot
  }
}

// ─── SEQUENCER SCHEDULER ──────────────────────────────────────────────────────

function seqSched(){
  if(!seqPlaying || typeof actx==='undefined' || !actx) return;
  const s = seqPlayStep;
  const when = actx.currentTime + 0.01;  // same offset as clicking a step
  const stepSec = 60/seqBpm/4, tickSec = stepSec/SEQ_AUTO_CORR;
  // On-grid and late hits of this step
  for(let v=0;v<SEQ_NV;v++){
    const val=seqSteps[v][s]; if(val===SEQ_OFF) continue;
    for(const t of seqHitTimes(v,s)) if(t>=0) seqPlayVoice(v, val, when+t*tickSec);
  }
  seqSetCur(s);
  seqPlayStep=(seqPlayStep+1)%seqNS;
  if(seqPlayStep===0){
    if(seqChainMode&&seqChainLinks.length>0&&seqCurrentRam){
      seqChainLinkIdx=(seqChainLinkIdx+1)%seqChainLinks.length;
      seqLoadSlotAtBoundary(seqChainLinks[seqChainLinkIdx]);
      seqUpdateChainProgress();
    } else if(seqQueuedSlot>=0&&seqCurrentRam){
      const slot=seqQueuedSlot;seqQueuedSlot=-1;
      seqLoadSlotAtBoundary(slot);
    }
  }
  // Early hits of the next step fall inside this step — schedule them now
  // (after any boundary load, so they come from the pattern that will play next)
  const n = seqPlayStep;
  for(let v=0;v<SEQ_NV;v++){
    const val=seqSteps[v][n]; if(val===SEQ_OFF) continue;
    for(const t of seqHitTimes(v,n)) if(t<0) seqPlayVoice(v, val, when+stepSec+t*tickSec);
  }
}

function seqSetCur(s) {
  document.querySelectorAll('.seq-st.seq-cur').forEach(e => e.classList.remove('seq-cur'));
  for (let v = 0; v < SEQ_NV; v++) {
    const el = document.getElementById('seqc_' + v + '_' + s);
    if (el) el.classList.add('seq-cur');
  }
}

function seqStartPlay() {
  if (typeof audio_init === 'function') audio_init();
  if (typeof actx === 'undefined' || !actx) return;
  seqRefreshVoiceBuffers();
  seqPlaying = true;
  seqPlayStep = 0;
  seqQueuedSlot = -1;
  seqPlayingSlot = seqActiveSlot;
  seqUpdatePickerStates();
  const btn = document.getElementById('seqPlayBtn');
  if (btn) { btn.value = '■ STOP'; btn.classList.add('seq-play-on'); }
  // Await context running before reading currentTime — Chrome auto-suspends after inactivity
  const doStart = () => {
    seqNextT = actx.currentTime + 0.05;
    const stepMs = 60000/seqBpm/4;
  seqTimer = setInterval(seqSched, stepMs);
  };
  if (actx.state === 'running') {
    doStart();
  } else {
    actx.resume().then(doStart);
  }
}

function seqStopPlay() {
  seqPlaying = false;
  clearInterval(seqTimer);
  seqQueuedSlot = -1;
  seqPlayingSlot = -1;
  // existing sounds die naturally (max ~400ms)

  if (seqChainMode) {
    seqChainMode = false; seqChainLinks = []; seqChainLinkIdx = 0;
    const cb = document.getElementById('seqPlayChainBtn');
    if (cb) { cb.value = '▶ PLAY CHAIN'; cb.classList.remove('seq-play-on'); }
    seqUpdateChainStates(); seqUpdateChainProgress();
  }
  document.querySelectorAll('.seq-st.seq-cur').forEach(e => e.classList.remove('seq-cur'));
  const btn = document.getElementById('seqPlayBtn');
  if (btn) { btn.value = '▶ PLAY'; btn.classList.remove('seq-play-on'); }
  seqUpdatePickerStates();
}

// ─── PATTERN ENCODING / DECODING ─────────────────────────────────────────────

// col = value of each voice (SEQ_OFF..SEQ_OPEN) at one tick
function seqBuildD(col) {
  const hv=SEQ_HH_CODE[col[2]]||0, ba=col[0], sn=col[1], cb=col[4];
  const cl=col[11]>0?1:0;
  const bv=ba?ba===SEQ_LOUD?2:1:0, sv=sn?sn===SEQ_LOUD?2:1:0, cv=cb?cb===SEQ_LOUD?2:1:0;
  const bsc=bv+sv*3+cv*9;
  if(!hv&&!cl&&!bsc) return 0;
  return(cl?0x80:0)|(hv<<5)|bsc;
}

function seqBuildE(col) {
  const cl=col[3]>0?1:0, cw=col[10]>0?1:0, tm=col[5];
  const tomHi=col[6]>0, tomLo=col[7]>0;
  const cgaHi=col[8]>0, cgaLo=col[9]>0;
  const tv=tomHi?2:tomLo?1:0, cv=cgaHi?2:cgaLo?1:0;
  const bv=tm?tm===SEQ_LOUD?2:1:0;
  const tct=tv+cv*3+bv*9;
  if(!cl&&!cw&&!tct) return 0;
  return(cl<<6)|(cw<<5)|tct;
}

// Each event fires its voices at the current tick, then advances delta+1 ticks.
// Hits are placed at step*12 + micro-offset; early hits on step 1 wrap to the pattern end.
function seqEncodePattern() {
  const total=seqNS*SEQ_AUTO_CORR+seqLenAdjust;
  const ticks=new Map(); // abs tick → column of voice values
  for(let v=0;v<SEQ_NV;v++) for(let s=0;s<seqNS;s++){
    const val=seqSteps[v][s]; if(val===SEQ_OFF) continue;
    for(const t of seqHitTimes(v,s)){
      const abs=((s*SEQ_AUTO_CORR+t)%total+total)%total;
      if(!ticks.has(abs)) ticks.set(abs,new Array(SEQ_NV).fill(SEQ_OFF));
      ticks.get(abs)[v]=val;
    }
  }
  for(const t of seqExtraE.keys()) if(t<total&&!ticks.has(t)) ticks.set(t,new Array(SEQ_NV).fill(SEQ_OFF));
  const active=[...ticks.keys()].sort((x,y)=>x-y).map(t=>{
    const col=ticks.get(t), e=seqBuildE(col)|(seqExtraE.get(t)||0);
    return{t,d:seqBuildD(col),e};
  }).filter(({t,d,e})=>t===0||d||e);
  if(!active.length||active[0].t>0) active.unshift({t:0,d:0,e:0}); // leading rest
  const evts=[];
  active.forEach(({t,d,e},K)=>{
    let gap=(K+1<active.length?active[K+1].t:total)-t;
    let delta=Math.min(gap,64)-1;
    const b0=delta|(e?0x40:0)|(d?0x80:0);
    const bts=[b0]; if(e)bts.push(e); if(d)bts.push(d);
    evts.push({bytes:bts,d,e,delta});
    gap-=delta+1;
    while(gap>0){delta=Math.min(gap,64)-1;evts.push({bytes:[delta],d:0,e:0,delta});gap-=delta+1;}
  });
  return evts;
}

function seqGetPatternBytes() {
  const evts=seqEncodePattern();
  const out=[];
  evts.forEach(ev=>ev.bytes.forEach(b=>out.push(b)));
  return new Uint8Array(out);
}

function seqDecodePatternBytes(bytes) {
  const grid=Array.from({length:SEQ_NV},()=>new Array(32).fill(0));
  const shiftArr=Array.from({length:SEQ_NV},()=>new Int8Array(32));
  const shuffle=Array.from({length:SEQ_NV},()=>({res:16,pct:50}));
  const ratchet=Array.from({length:SEQ_NV},()=>new Uint8Array(32).fill(1));
  const extraE=new Map();
  if(!bytes||!bytes.length) return{grid,shifts:shiftArr,shuffle,ratchet,extraE,numSteps:null,lenAdjust:0,fullSteps:0};
  const ns=seqPatternSteps(bytes), ticksTotal=seqPatternTicks(bytes);
  const hits=Array.from({length:SEQ_NV},()=>[]); // per voice: {val, abs}
  let abs_tick=0, i=0;
  const set=(v,val)=>hits[v].push({val,abs:abs_tick});
  while(i<bytes.length){
    const b0=bytes[i++];
    const hasE=(b0&0x40)!==0, hasD=(b0&0x80)!==0, delta=b0&0x3F;
    let ER=0,DR=0;
    if(hasE&&i<bytes.length){ER=bytes[i++];}
    if(hasD&&i<bytes.length){DR=bytes[i++];}
    if(DR){
      const hf=(DR>>5)&3,cl=(DR>>7)&1,bsc=DR&0x1F;
      const bv=bsc%3,sv=Math.floor(bsc/3)%3,cv=Math.floor(bsc/9)%3;
      const hh=[SEQ_OFF,SEQ_SOFT,SEQ_OPEN,SEQ_LOUD][hf]??SEQ_OFF;
      if(bv) set(0,bv===2?SEQ_LOUD:SEQ_SOFT);
      if(sv) set(1,sv===2?SEQ_LOUD:SEQ_SOFT);
      if(hh) set(2,hh);
      if(cl) set(11,SEQ_LOUD);
      if(cv) set(4,cv===2?SEQ_LOUD:SEQ_SOFT);
    }
    if(ER&0x80) extraE.set(abs_tick,0x80);
    if(ER){
      const clp=(ER>>6)&1,cw=(ER>>5)&1,tct=ER&0x1F;
      const tv=tct%3,cgv=Math.floor(tct/3)%3,tmv=Math.floor(tct/9)%3;
      if(clp) set(3,SEQ_LOUD);
      if(cw)  set(10,SEQ_LOUD);
      if(tv===2)  set(6,SEQ_LOUD);
      else if(tv===1) set(7,SEQ_LOUD);
      if(cgv===2) set(8,SEQ_LOUD);
      else if(cgv===1) set(9,SEQ_LOUD);
      if(tmv) set(5,tmv===2?SEQ_LOUD:SEQ_SOFT);
    }
    abs_tick+=delta+1;
  }
  // The RAM only holds times. For each row, pick the LM-1 shuffle setting that puts its hits
  // closest to the shuffled grid (straight wins ties; a shuffle needs two shuffled hits); what is
  // left over becomes the micro offset. Without this, an 8-note 70% shuffle (+10 ticks) would
  // land on the wrong step.
  // A pattern longer than the editor's 32 steps is shown cut at step 32 (hits after it are dropped)
  const total=ticksTotal>32*SEQ_AUTO_CORR?32*SEQ_AUTO_CORR:ticksTotal;
  if(ticksTotal>total) for(let v=0;v<SEQ_NV;v++) hits[v]=hits[v].filter(h=>h.abs<total-SEQ_AUTO_CORR/2);
  // Ratchets: k hits of the same level spaced exactly 12/k ticks apart (largest k first)
  for(let v=0;v<SEQ_NV;v++){
    const list=hits[v].slice().sort((a,b)=>a.abs-b.abs), at=new Map(list.map(h=>[h.abs,h]));
    const used=new Set(), out=[];
    for(const h of list){
      if(used.has(h)) continue;
      let k=1;
      for(const kk of SEQ_RATCHETS.slice(1).reverse()){
        const d=SEQ_AUTO_CORR/kk, run=[];
        for(let j=0;j<kk;j++){ const o=at.get(h.abs+j*d); if(!o||used.has(o)||o.val!==h.val) break; run.push(o); }
        if(run.length===kk){ k=kk; run.forEach(o=>used.add(o)); break; }
      }
      used.add(h);
      out.push({...h,k});
    }
    hits[v]=out;
  }
  const candidates=[{res:16,pct:50}];
  SEQ_SHUFFLE_RES.forEach(res=>SEQ_SHUFFLE_PCT.slice(1).forEach(pct=>candidates.push({res,pct})));
  const saved=seqRowShuffle;
  for(let v=0;v<SEQ_NV;v++){
    if(!hits[v].length) continue;
    let best=null;
    for(const c of candidates){
      seqRowShuffle=saved.map((x,k)=>k===v?c:x); // seqShuffleTicks reads the row setting
      let cost=c.pct>50?0.5:0, evidence=0; const placed=[], taken=new Set();
      for(const h of hits[v].slice().sort((a,b)=>a.abs-b.abs)){
        // nearest free step; a step already holding a hit is only reused if nothing is free
        let bs=0,bd=Infinity,free=false;
        for(let st=0;st<ns;st++) for(const k of [-1,0,1]){
          const d=h.abs+k*total-(st*SEQ_AUTO_CORR+seqShuffleTicks(v,st)), f=!taken.has(st);
          if((f&&!free)||(f===free&&Math.abs(d)<Math.abs(bd))){bd=d;bs=st;free=f;}
        }
        taken.add(bs);
        cost+=Math.abs(bd)+(Math.abs(bd)>6?100:0);
        if(seqShuffleTicks(v,bs)>0) evidence++;
        placed.push({st:bs,d:bd,val:h.val,k:h.k});
      }
      // One late hit is a nudge, not a shuffle: a shuffle needs at least two shuffled hits
      if(c.pct>50&&evidence<2) continue;
      if(!best||cost<best.cost) best={cost,c,placed};
    }
    seqRowShuffle=saved;
    shuffle[v]=best.c;
    for(const {st,d,val,k} of best.placed){
      grid[v][st]=val;
      shiftArr[v][st]=Math.max(-6,Math.min(6,Math.round(d)));
      ratchet[v][st]=k;
    }
  }
  return{grid,shifts:shiftArr,shuffle,ratchet,extraE,numSteps:ns,
    lenAdjust:ticksTotal>32*SEQ_AUTO_CORR?0:ticksTotal-ns*SEQ_AUTO_CORR,
    fullSteps:Math.round(ticksTotal/SEQ_AUTO_CORR)};
}

// Pattern length = sum of all event deltas (each event advances delta+1 ticks)
function seqPatternTicks(bytes) {
  let t=0, i=0;
  while(i<bytes.length){
    const b0=bytes[i++];
    if(b0&0x40) i++;
    if(b0&0x80) i++;
    t+=(b0&0x3F)+1;
  }
  return t;
}
function seqPatternSteps(bytes) {
  return Math.max(1,Math.min(32,Math.round(seqPatternTicks(bytes)/SEQ_AUTO_CORR)));
}

// ─── RAM ANALYSIS ────────────────────────────────────────────────────────────

function seqR16(ram, off) { return ram[off]|(ram[off+1]<<8); }

function seqAnalyzeRam(ram) {
  return Array.from({length:100},(_,slot)=>{
    const off=SEQ_TABLE_OFF+slot*2;
    const start=seqR16(ram,off), end=seqR16(ram,off+2);
    const size=end-start;
    const bytes=size>0?ram.slice(start-SEQ_RAM_BASE,end-SEQ_RAM_BASE):new Uint8Array(0);
    return{slot,size,hasData:size>0&&bytes.length>0&&bytes.some(b=>b!==0),bytes};
  });
}

function seqGetChainLinks(ram, chainNum) {
  const off=SEQ_CHAIN_BASE+(chainNum-1)*100;
  const raw=Array.from(ram.slice(off,off+100));
  if(raw.every(b=>b===0)) return [];
  const links=[];
  for(const b of raw){ if(b===0xAB) break; links.push(b); }
  return links;
}

function seqAnalyzeChains(ram) {
  return Array.from({length:8},(_,i)=>{
    const n=i+1, links=seqGetChainLinks(ram,n);
    return{chain:n,links,hasData:links.length>0};
  });
}

function seqParseRamFile(bytes) {
  if(bytes.length===8192) return new Uint8Array(bytes);
  // SYX: F0 69 ... F7 with 8-to-7 packing (32-byte header + 8192 data)
  if(bytes[0]===0xF0&&bytes[1]===0x69){
    const packed=bytes.slice(2,bytes.length-1);
    const unpacked=unpack_sysex(packed); // from codecs.mjs
    if(unpacked.length>=32+8192) return new Uint8Array(unpacked.slice(32,32+8192));
    if(unpacked.length===8192) return new Uint8Array(unpacked);
  }
  throw new Error('Expected 8192-byte RAM dump or SYX file');
}

// ─── SLOT LOADING ────────────────────────────────────────────────────────────

function seqLoadSlotIntoEditor(ram, slot) {
  if(!ram) return;
  const analysis=seqAnalyzeRam(ram);
  const info=analysis[slot];
  if(!info) return;
  const decoded=seqDecodePatternBytes(info.bytes);
  const {grid,numSteps}=decoded;
  for(let v=0;v<SEQ_NV;v++) for(let s=0;s<32;s++){
    seqSteps[v][s]=grid[v][s];
    if(decoded.shifts) seqShifts[v][s]=decoded.shifts[v]?.[s]||0;
    seqRatchet[v][s]=decoded.ratchet?.[v]?.[s]||1;
  }
  if(decoded.numSteps){
    seqRowShuffle=decoded.shuffle.map(x=>({...x}));
    seqExtraE=new Map(decoded.extraE);
  }
  seqActiveSlot=slot;
  const si=document.getElementById('seqSlotInput');
  if(si) si.value=slot;
  if(!seqPlaying) seqPlayingSlot=-1;
  seqUpdatePickerStates();
  if(numSteps) seqSetStepCount(numSteps); else seqBuildGrid();
  seqLenAdjust=numSteps?decoded.lenAdjust:0;
  seqLongPattern=decoded.fullSteps>32?{slot,steps:decoded.fullSteps}:null;
  seqEncodeAndShow(ram, slot, info.bytes);
  if(seqLongPattern) seqShowStatus(`Pattern ${String(slot).padStart(2,'0')} is ${seqLongPattern.steps} steps long; `+
    'the editor shows the first 32. Writing it back would shorten it.',true);
}

function seqLoadSlotAtBoundary(slot) {
  if(!seqCurrentRam) return;
  const analysis=seqAnalyzeRam(seqCurrentRam);
  const info=analysis[slot];
  if(!info) return;
  const decoded=seqDecodePatternBytes(info.bytes);
  const {grid,numSteps}=decoded;
  for(let v=0;v<SEQ_NV;v++) for(let s=0;s<32;s++){
    seqSteps[v][s]=grid[v][s];
    if(decoded.shifts) seqShifts[v][s]=decoded.shifts[v]?.[s]||0;
    seqRatchet[v][s]=decoded.ratchet?.[v]?.[s]||1;
  }
  if(decoded.numSteps){
    seqRowShuffle=decoded.shuffle.map(x=>({...x}));
    seqExtraE=new Map(decoded.extraE);
  }
  seqPlayingSlot=slot; seqActiveSlot=slot;
  const si=document.getElementById('seqSlotInput'); if(si) si.value=slot;
  if(numSteps) seqSetStepCount(numSteps); else seqBuildGrid();
  seqLenAdjust=numSteps?decoded.lenAdjust:0;
  seqUpdatePickerStates();
}

function seqSetStepCount(n) {
  seqNS=Math.max(1,Math.min(32,Math.round(n)||16));
  const sel=document.getElementById('seqLenSel');
  if(sel) sel.value=seqNS;
  if(seqPlayStep>=seqNS) seqPlayStep=0;
  seqBuildGrid();
}

// Number of hits in steps beyond the pattern length (kept in memory, not played/written)
function seqHiddenHits() {
  let n=0;
  for(let v=0;v<SEQ_NV;v++) for(let s=seqNS;s<32;s++) if(seqSteps[v][s]!==SEQ_OFF) n++;
  return n;
}

// ─── GRID UI ─────────────────────────────────────────────────────────────────

function seqStCls(v, val, s) {
  if(!val) return '';
  if(val===SEQ_OPEN) return ' seq-open';
  const off=s!==undefined?seqHitOffset(v,s):0, sh=Math.abs(off);
  if(off<0) return SEQ_BIN[v]?' seq-on seq-early':(val===SEQ_LOUD?' seq-loud seq-early':' seq-soft seq-early');
  if(sh>=4) return SEQ_BIN[v]?' seq-on seq-shuf4':(val===SEQ_LOUD?' seq-loud seq-shuf4':' seq-soft seq-shuf4');
  if(sh>=1) return SEQ_BIN[v]?' seq-on seq-shuf1':(val===SEQ_LOUD?' seq-loud seq-shuf1':' seq-soft seq-shuf1');
  if(SEQ_BIN[v]) return ' seq-on';
  return val===SEQ_LOUD?' seq-loud':' seq-soft';
}

// Inner HTML of a step cell: offset marker + label, and ‹ › nudge handles on active hits
function seqCellInner(v,s){
  if(seqSteps[v][s]===SEQ_OFF) return '';
  const sh=(seqShifts[v]&&seqShifts[v][s])||0, tot=seqHitOffset(v,s);
  let html='';
  if(tot){
    // marker = where the hit plays (shuffle + micro offset); label = the micro offset you set
    const pos=Math.max(4,Math.min(96,50+tot/SEQ_AUTO_CORR*100));
    html+=`<span class="seq-off-mark" style="left:${pos}%"></span>`;
    if(sh) html+=`<span class="seq-shuf-lbl">${sh>0?'+':''}${sh}</span>`;
  }
  const k=seqRatchet[v][s]||1;
  if(k>1) html+=`<span class="seq-ratchet" style="--k:${k}"></span><span class="seq-ratchet-lbl">x${k}</span>`;
  return html+'<span class="seq-nudge seq-nudge-l" data-d="-1">&#8249;</span>'+
              '<span class="seq-nudge seq-nudge-r" data-d="1">&#8250;</span>';
}

function seqShuffleOptions(cur) {
  const opt=(res,pct,label)=>{
    const on=pct===50?cur.pct<=50:(cur.res===res&&cur.pct===pct);
    return `<option value="${res}:${pct}"${on?' selected':''}>${label}</option>`;
  };
  let html=opt(16,50,'50%');
  SEQ_SHUFFLE_RES.forEach(res=>{
    html+=`<optgroup label="AUTO CORR ${res}">`;
    SEQ_SHUFFLE_PCT.slice(1).forEach(pct=>html+=opt(res,pct,`${res}·${pct}%`));
    html+='</optgroup>';
  });
  return html;
}

function seqSetRowShuffle(v, res, pct) {
  seqRowShuffle[v]={res,pct};
  for(let s=0;s<32;s++) seqUpdStep(v,s);
  const sel=document.querySelector(`.seq-shuf-sel[data-v="${v}"]`);
  if(sel) sel.classList.toggle('seq-shuf-on',pct>50);
  seqShowStatus(`${SEQ_VNAME[v]}: shuffle ${seqShuffleLabel(seqRowShuffle[v])}`+
    (pct>50?` — every 2nd 1/${res} note plays ${Math.round((pct-50)/100*(res===16?2:4)*SEQ_AUTO_CORR)} ticks late`:''));
}

// LM-1 AUTO-CORRECT without shuffle: every hit back on its 1/16 step, all shuffle set to 50%
function seqQuantize() {
  let moved=0;
  for(let v=0;v<SEQ_NV;v++) for(let s=0;s<32;s++)
    if(seqSteps[v][s]!==SEQ_OFF&&seqHitOffset(v,s)!==0) moved++;
  const shuffled=seqRowShuffle.filter(x=>x.pct>50).length;
  if(!moved&&!shuffled){ seqShowStatus('Already quantized — every hit is on the grid'); return; }
  if(!confirm(`Quantize: move ${moved} hit(s) back onto the 1/16 grid and set every instrument's shuffle to 50%?`)) return;
  for(let v=0;v<SEQ_NV;v++){ seqRowShuffle[v]={res:16,pct:50}; seqShifts[v].fill(0); }
  seqBuildGrid();
  seqShowStatus(`Quantized ${moved} hit(s) to the 1/16 grid; all shuffle set to 50%`);
}

function seqFmtSt(st){ return `${st>0?'+':''}${(+st).toFixed(1)} st`; }

function seqSetVolume(v, pct) {
  seqVol[v]=pct/100;
  const g=seqVoiceBus[v];
  if(g&&actx) g.gain.setTargetAtTime(seqVol[v], actx.currentTime, 0.01);
  const sl=document.querySelector(`.seq-vol-sl[data-v="${v}"]`);
  if(sl){ sl.value=pct; sl.title=`Volume ${pct}%`; }
  seqShowStatus(`${SEQ_VNAME[v]}: volume ${pct}%`);
}
function seqSetTune(v, st) {
  st=Math.max(-SEQ_TUNE_RANGE,Math.min(SEQ_TUNE_RANGE,Math.round(st*10)/10));
  seqTuneSt[v]=st; seqPitchMult[v]=Math.pow(2,st/12);
  const sl=document.querySelector(`.seq-pitch-sl[data-v="${v}"]`);
  if(sl){ sl.value=st; sl.title=`Pitch ${seqFmtSt(st)}`; }
  seqShowStatus(`${SEQ_VNAME[v]}: pitch ${seqFmtSt(st)} (×${seqPitchMult[v].toFixed(3)})`);
}

function seqUpdShiftLegend(){
  const anyShift=seqShifts.some(row=>row&&Array.from(row).some(v=>v!==0))||seqRowShuffle.some(x=>x.pct>50);
  const leg=document.getElementById('seqShufLegend');
  if(leg) leg.style.display=anyShift?'':'none';
}

function seqBuildGrid(){
  let html='<div class="seq-vrow seq-vrow-nums"><div class="seq-pitch-cell"><span class="seq-vlbl"></span>'+
    '<span class="seq-col-hdr seq-col-vol">VOL</span><span class="seq-col-hdr seq-col-pitch">PITCH</span>'+
    '<span class="seq-col-hdr seq-col-key"></span><span class="seq-col-hdr seq-col-shuf">SHUFFLE</span></div>';
  for(let s=0;s<32;s++){
    const bar=(s%16===0),beat=(s>0&&s%4===0&&!bar);
    const nStyle=bar?'border-left:2px solid rgba(255,255,255,.3);color:rgb(200,160,60);'
                :beat?'border-left:1px solid rgba(255,255,255,.12);':'';
    html+=`<div class="seq-sn${bar?' seq-bt':''}${s>=seqNS?' seq-st-x':''}" style="${nStyle}">${s+1}</div>`;
  }
  html+='</div>';
  for(let v=0;v<SEQ_NV;v++){
    html+=`<div class="seq-vrow"><div class="seq-pitch-cell">` +
      `<span class="seq-vlbl">${SEQ_VLBL[v]}</span>` +
      `<input type="range" class="seq-vol-sl" min="0" max="150" step="1" value="${Math.round(seqVol[v]*100)}" data-v="${v}" title="Volume ${Math.round(seqVol[v]*100)}%" data-tip="${SEQ_VNAME[v]} volume 0–150% (editor playback)\nDouble-click to reset to 100%">` +
      `<input type="range" class="seq-pitch-sl" min="${-SEQ_TUNE_RANGE}" max="${SEQ_TUNE_RANGE}" step="0.1" value="${seqTuneSt[v]}" data-v="${v}" title="Pitch ${seqFmtSt(seqTuneSt[v])}" data-tip="${SEQ_VNAME[v]} tuning ±${SEQ_TUNE_RANGE} semitones\nDouble-click to reset to 0">` +
      `<span class="seq-vkey-lbl">${SEQ_VKEYS[v]}</span>` +
      `<select class="seq-shuf-sel${seqRowShuffle[v].pct>50?' seq-shuf-on':''}" data-v="${v}" data-tip="${SEQ_VNAME[v]} shuffle (LM-1 ADJ SHFL)\n16: every 2nd 1/16 note gets late\n8: every 2nd 1/8 note gets late\n50% = straight">${seqShuffleOptions(seqRowShuffle[v])}</select>` +
      `</div>`;
    for(let s=0;s<32;s++){
      const val=seqSteps[v][s];
      const bst=s%16===0?'border-left:2px solid rgba(255,255,255,.18);':s%4===0&&s>0?'border-left:1px solid rgba(255,255,255,.08);':'';
      html+=`<div class="seq-st${seqStCls(v,val,s)}${s>=seqNS?' seq-st-x':''}" id="seqc_${v}_${s}" data-v="${v}" data-s="${s}" style="${bst}">${seqCellInner(v,s)}</div>`;
    }
    html+='</div>';
  }
  document.getElementById('seqGrid').innerHTML=html;
  seqUpdShiftLegend();
}
function seqUpdStep(v,s) {
  const el=document.getElementById('seqc_'+v+'_'+s);
  if(el){
    el.className='seq-st'+seqStCls(v,seqSteps[v][s],s)+(s>=seqNS?' seq-st-x':'');
    el.innerHTML=seqCellInner(v,s);
  }
  seqUpdShiftLegend();
}

// Move a hit off the grid by d ticks (1 tick = 1/12 step), clamped to ±SEQ_MAX_NUDGE
function seqNudgeStep(v,s,d) {
  if(seqSteps[v][s]===SEQ_OFF) return;
  const cur=seqShifts[v][s]||0;
  const nxt=cur+d;
  if(nxt===cur||(Math.abs(nxt)>SEQ_MAX_NUDGE&&Math.abs(nxt)>Math.abs(cur))) return;
  seqShifts[v][s]=nxt;
  seqUpdStep(v,s);
  const ms=nxt*60000/seqBpm/4/SEQ_AUTO_CORR;
  const shuf=seqShuffleTicks(v,s);
  const pct=shuf?` · plus ${seqShuffleLabel(seqRowShuffle[v])} shuffle (+${shuf})`:'';
  seqShowStatus(`${SEQ_VNAME[v]} step ${s+1}: `+
    (nxt?`${nxt>0?'+':''}${nxt}/12 step (${nxt>0?'late':'early'} ${Math.abs(ms).toFixed(0)} ms @ ${seqBpm} BPM)${pct}`:'on grid'));
}

function seqClickStep(v,s,shiftKey,altKey) {
  if(shiftKey){
    seqSteps[v][s]=SEQ_OFF; seqShifts[v][s]=0; seqRatchet[v][s]=1;
  } else if(altKey){
    if(seqSteps[v][s]!==SEQ_OFF){const sh=seqShifts[v][s]||0;seqShifts[v][s]=sh<0||sh>=5?0:sh+1;}
  } else {
    const c=seqSteps[v][s];
    seqSteps[v][s]=SEQ_HAS_OPEN[v]?[SEQ_SOFT,SEQ_LOUD,SEQ_OPEN,SEQ_OFF][c]??SEQ_OFF
      :SEQ_BIN[v]?c>0?SEQ_OFF:SEQ_LOUD
      :[SEQ_SOFT,SEQ_LOUD,SEQ_OFF][c]??SEQ_OFF;
    if(seqSteps[v][s]===SEQ_OFF){ seqShifts[v][s]=0; seqRatchet[v][s]=1; }
  }
  seqUpdStep(v,s);
  if(!actx&&typeof audio_init==='function') audio_init();
  seqRefreshVoiceBuffers();
  const val=seqSteps[v][s];
  if(val!==SEQ_OFF) seqPlayVoice(v,val,actx?actx.currentTime+0.01:0);
}

// Repeats within the step (1 = a single hit)
function seqSetRatchet(v,s,k) {
  if(seqSteps[v][s]===SEQ_OFF||!SEQ_RATCHETS.includes(k)) return;
  seqRatchet[v][s]=k;
  seqUpdStep(v,s);
  const ms=60000/seqBpm/4/k;
  seqShowStatus(`${SEQ_VNAME[v]} step ${s+1}: `+(k>1?`ratchet x${k} — every ${SEQ_AUTO_CORR/k} tick(s), ${ms.toFixed(0)} ms @ ${seqBpm} BPM`:'single hit'));
  if(actx){ const now=actx.currentTime+0.02, tick=60/seqBpm/4/SEQ_AUTO_CORR;
    seqHitTimes(v,s).forEach(t=>seqPlayVoice(v,seqSteps[v][s],now+(t-seqHitOffset(v,s))*tick)); }
}
function seqStepRatchet(v,s,dir) {
  const i=SEQ_RATCHETS.indexOf(seqRatchet[v][s]||1);
  seqSetRatchet(v,s,SEQ_RATCHETS[Math.max(0,Math.min(SEQ_RATCHETS.length-1,i+dir))]);
}

// Right-click menu on a hit: ratchet count + put back on the grid
function seqCloseHitMenu() { document.getElementById('seqHitMenu')?.remove(); }
function seqOpenHitMenu(v,s,x,y) {
  seqCloseHitMenu();
  const m=document.createElement('div'); m.id='seqHitMenu';
  const cur=seqRatchet[v][s]||1, off=seqShifts[v][s]||0;
  m.innerHTML=`<div class="seq-hm-title">${SEQ_VNAME[v]} · step ${s+1}</div>`+
    `<div class="seq-hm-row"><span>Ratchet</span>`+SEQ_RATCHETS.map(k=>
      `<button data-k="${k}" class="${k===cur?'on':''}">${k===1?'off':'x'+k}</button>`).join('')+`</div>`+
    `<div class="seq-hm-row"><span>Offset ${off>0?'+':''}${off}</span><button data-reset="1"${off?'':' disabled'}>back on grid</button></div>`;
  m.style.left=Math.min(x,window.innerWidth-260)+'px'; m.style.top=(y+8)+'px';
  m.addEventListener('pointerdown',e=>e.stopPropagation());
  m.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.k) seqSetRatchet(v,s,+b.dataset.k);
    else if(b.dataset.reset) seqNudgeStep(v,s,-(seqShifts[v][s]||0));
    seqCloseHitMenu();
  });
  document.body.appendChild(m);
  const tip=document.getElementById('seq-tip'); if(tip) tip.style.display='none';
}

// Drag-paint: the pressed step's new value is copied to every step the mouse passes over in
// that row (so a press that turned a step off erases). Skipped steps are filled in between.
function seqPaintTo(s) {
  const p=seqPaint; if(!p||s===p.last||s>=seqNS) return;
  const dir=s>p.last?1:-1;
  for(let t=p.last+dir;;t+=dir){
    if(seqSteps[p.v][t]!==p.val||(p.val!==SEQ_OFF&&seqRatchet[p.v][t]!==p.k)){
      seqSteps[p.v][t]=p.val;
      seqRatchet[p.v][t]=p.val===SEQ_OFF?1:p.k;
      if(p.val===SEQ_OFF) seqShifts[p.v][t]=0;
      seqUpdStep(p.v,t);
      if(p.val!==SEQ_OFF&&actx) seqPlayVoice(p.v,p.val,actx.currentTime+0.01);
    }
    if(t===s) break;
  }
  p.last=s;
}

// ─── PATTERN PICKER ──────────────────────────────────────────────────────────

function seqRenderPatternPicker(ram) {
  const analysis=seqAnalyzeRam(ram);
  const nonEmpty=analysis.filter(s=>s.hasData);
  const info=document.getElementById('seqPpInfo');
  if(info) info.textContent=nonEmpty.length+' patterns · heap end A'+
    (seqR16(ram,SEQ_TABLE_OFF+200)-SEQ_RAM_BASE).toString(16).toUpperCase().padStart(4,'0')+'h'+
    (seqRamSource?' · '+seqRamSource:'');
  let html='';
  analysis.forEach(({slot,size,hasData})=>{
    let cls='seq-pp-btn';
    if(hasData||size>0) cls+=' seq-pp-has';
    const lbl=slot.toString().padStart(2,'0');
    const sz=size>0?size+'B':'—';
    html+=`<button class="${cls}" data-slot="${slot}" title="Slot ${slot}: ${size} bytes">${lbl}<br><span class="seq-pp-sz">${sz}</span></button>`;
  });
  const grid=document.getElementById('seqPpGrid');
  if(grid){
    grid.innerHTML=html;
    seqUpdatePickerStates();
  }
}

function seqUpdatePickerStates() {
  document.querySelectorAll('.seq-pp-btn').forEach(b=>{
    const s=+b.dataset.slot;
    b.classList.remove('seq-pp-playing','seq-pp-queued','seq-pp-active');
    if(seqPlaying&&s===seqPlayingSlot) b.classList.add('seq-pp-playing');
    else if(seqPlaying&&s===seqQueuedSlot) b.classList.add('seq-pp-queued');
    else if(!seqPlaying&&s===seqActiveSlot) b.classList.add('seq-pp-active');
  });
}

// ─── CHAIN PICKER ────────────────────────────────────────────────────────────

function seqRenderChainPicker(ram) {
  const chains=seqAnalyzeChains(ram);
  const nonEmpty=chains.filter(c=>c.hasData).length;
  const info=document.getElementById('seqChInfo');
  if(info) info.textContent=nonEmpty+' chains with data';
  let html='';
  chains.forEach(({chain,links,hasData})=>{
    let cls='seq-ch-btn';
    if(hasData) cls+=' seq-ch-has';
    const lnkStr=hasData?links.length+' lnk':'—';
    const tip=hasData?`Chain ${chain}: [${links.map(p=>p.toString().padStart(2,'0')).join(' ')}]`:`Chain ${chain}: empty`;
    html+=`<button class="${cls}" data-chain="${chain}" title="${tip}">${chain}<br><span class="seq-pp-sz">${lnkStr}</span></button>`;
  });
  const grid=document.getElementById('seqChGrid');
  if(grid){
    grid.innerHTML=html;
    seqUpdateChainStates();
  }
}

function seqUpdateChainStates() {
  document.querySelectorAll('.seq-ch-btn').forEach(b=>{
    const n=+b.dataset.chain;
    b.classList.remove('seq-ch-active','seq-ch-playing');
    if(n===seqSelectedChain) b.classList.add(seqChainMode?'seq-ch-playing':'seq-ch-active');
  });
}

function seqUpdateChainProgress() {
  const el=document.getElementById('seqChProgress');
  if(!el) return;
  if(seqChainMode&&seqChainLinks.length>0){
    const slot=seqChainLinks[seqChainLinkIdx].toString().padStart(2,'0');
    el.textContent=`Link ${seqChainLinkIdx+1}\u202f/\u202f${seqChainLinks.length}  →  Patt ${slot}`;
  } else { el.textContent=''; }
}

function seqStartChainPlay() {
  if(!seqCurrentRam||seqSelectedChain<1) return;
  const links=seqGetChainLinks(seqCurrentRam,seqSelectedChain);
  if(!links.length){seqShowStatus('Chain '+seqSelectedChain+' is empty');return;}
  if(seqPlaying) seqStopPlay();
  seqChainMode=true; seqChainLinks=links; seqChainLinkIdx=0;
  seqLoadSlotIntoEditor(seqCurrentRam,links[0]);
  seqStartPlay();
  const btn=document.getElementById('seqPlayChainBtn');
  if(btn){btn.value='■ STOP CHAIN';btn.classList.add('seq-play-on');}
  seqUpdateChainStates(); seqUpdateChainProgress();
}

function seqStopChainPlay() {
  seqChainMode=false; seqChainLinks=[]; seqChainLinkIdx=0;
  if(seqPlaying) seqStopPlay();
  const btn=document.getElementById('seqPlayChainBtn');
  if(btn){btn.value='▶ PLAY CHAIN';btn.classList.remove('seq-play-on');}
  seqUpdateChainStates(); seqUpdateChainProgress();
}

// ─── HEX DUMP ────────────────────────────────────────────────────────────────

function seqH2(n){return n.toString(16).toUpperCase().padStart(2,'0');}
function seqH4(n){return n.toString(16).toUpperCase().padStart(4,'0');}

function seqDescEvt(b0,ER,DR){
  const parts=[];
  if(DR){
    const hf=(DR>>5)&3,cl=(DR>>7)&1,bsc=DR&0x1F;
    const bv=bsc%3,sv=Math.floor(bsc/3)%3,cv=Math.floor(bsc/9)%3;
    if(bv) parts.push(`<span class="seq-ev-v">${bv===2?'BAS!':'BAS.'}</span>`);
    if(sv) parts.push(`<span class="seq-ev-v">${sv===2?'SNR!':'SNR.'}</span>`);
    if(hf===1)parts.push('<span class="seq-ev-v">HH.</span>');
    else if(hf===2)parts.push('<span class="seq-ev-v">HHo</span>');
    else if(hf===3)parts.push('<span class="seq-ev-v">HH!</span>');
    if(cl) parts.push('<span class="seq-ev-v">RS</span>');
    if(cv) parts.push(`<span class="seq-ev-v">${cv===2?'CBS!':'CBS.'}</span>`);
  }
  if(ER){
    const clp=(ER>>6)&1,cw=(ER>>5)&1,tct=ER&0x1F;
    const tv=tct%3,cgv=Math.floor(tct/3)%3,tmv=Math.floor(tct/9)%3;
    if(clp) parts.push('<span class="seq-ev-v">CLP</span>');
    if(cw)  parts.push('<span class="seq-ev-v">CWB</span>');
    if(tv===2)parts.push('<span class="seq-ev-v">T.HI</span>');
    else if(tv===1)parts.push('<span class="seq-ev-v">T.LO</span>');
    if(cgv===2)parts.push('<span class="seq-ev-v">C.HI</span>');
    else if(cgv===1)parts.push('<span class="seq-ev-v">C.LO</span>');
    if(tmv)parts.push(`<span class="seq-ev-v">${tmv===2?'TMB!':'TMB.'}</span>`);
  }
  return parts.join(' ');
}

function seqEncodeAndShow(ram, slot, bytes) {
  const div=document.getElementById('seqHexContent');
  if(!div) return;
  if(!bytes||!bytes.length){div.innerHTML='<span style="color:#666">No pattern data</span>';return;}
  const baseAddr=slot<100?seqR16(ram,SEQ_TABLE_OFF+slot*2):SEQ_HEAP_BASE;
  const ns=seqPatternSteps(bytes);
  let html=`<div class="seq-hex-stitle">SLOT ${slot.toString().padStart(2,'0')} — ${bytes.length} bytes @ ${seqH4(baseAddr)}h — ${ns} steps (${seqPatternTicks(bytes)} ticks)</div>`;

  // Event-by-event decode
  let abs_tick=0, i=0, evNum=0;
  while(i<bytes.length){
    const b0=bytes[i++];
    const hasE=(b0&0x40)!==0,hasD=(b0&0x80)!==0,delta=b0&0x3F;
    const rstep=Math.round(abs_tick/SEQ_AUTO_CORR), off=abs_tick-rstep*SEQ_AUTO_CORR;
    const step=rstep%ns;
    let ER=0,DR=0;
    const byteSpan=`<span class="seq-b0c">${seqH2(b0)}</span>`;
    let extraBytes='';
    if(hasE&&i<bytes.length){ER=bytes[i++];extraBytes+=` <span class="seq-bec">${seqH2(ER)}</span>`;}
    if(hasD&&i<bytes.length){DR=bytes[i++];extraBytes+=` <span class="seq-bdc">${seqH2(DR)}</span>`;}
    const desc=seqDescEvt(b0,ER,DR);
    const hasDrums=desc.length>0;
    html+=`<div class="seq-ev-row${hasDrums?'':' seq-ev-empty'}">
      <span class="seq-ev-addr">${seqH4(baseAddr+evNum)}h</span>
      <span class="seq-ev-bytes">${byteSpan}${extraBytes}</span>
      <span class="seq-ev-meta">δ=${delta} abs=${abs_tick} step ${step+1}${off?(off>0?' +':' ')+off:''}</span>
      <span>${desc}</span>
    </div>`;
    abs_tick+=delta+1; evNum+=1+(hasE?1:0)+(hasD?1:0);
  }
  div.innerHTML=html;
}

// ─── RAM FILE I/O ─────────────────────────────────────────────────────────────

function seqInsertPattern(ramArr, slot, pb) {
  const TABLE_OFF=SEQ_TABLE_OFF;
  // Read current pattern boundaries
  const oldStart=seqR16(ramArr,TABLE_OFF+slot*2);
  const oldEnd=seqR16(ramArr,TABLE_OFF+slot*2+2);
  const oldSize=oldEnd-oldStart;
  const newSize=pb.length;
  const delta=newSize-oldSize;

  // Convert RAM to flat array for splice
  let data=Array.from(ramArr);
  const heapOff=oldStart-SEQ_RAM_BASE;
  data.splice(heapOff,oldSize,...Array.from(pb));

  // The table is 101 contiguous pointers (slot k = ptr[k]..ptr[k+1], ptr[100] = heap end).
  // Shift every pointer after this slot's start; this slot's own start stays put
  // (comparing addresses would also move it when the slot is empty, start == end).
  for(let k=slot+1;k<=100;k++){
    const off2=TABLE_OFF+k*2;
    const pk=seqR16(ramArr,off2)+delta;
    data[off2]=(pk&0xFF); data[off2+1]=(pk>>8)&0xFF;
  }

  return new Uint8Array(data.slice(0,8192));
}

// ─── STATUS ──────────────────────────────────────────────────────────────────

function seqShowStatus(msg, isErr) {
  const el=document.getElementById('seqStatus');
  if(!el) return;
  el.textContent=msg;
  el.style.color=isErr?'rgb(255,100,80)':'rgb(100,220,120)';
  clearTimeout(seqShowStatus._t);
  seqShowStatus._t=setTimeout(()=>{if(el) el.textContent='';},4000);
}

// ─── PUBLIC API (called by luma.tools) ───────────────────────────────────────

// Called by luma_midi.js when a RAM dump arrives (or file is loaded)
function seqOnRamReceived(ramData, source='') {
  seqRamSource=source;
  seqCurrentRam=new Uint8Array(ramData);
  seqRenderChainPicker(seqCurrentRam);
  seqRenderPatternPicker(seqCurrentRam);
  // Auto-load slot 00 (or first non-empty)
  const analysis=seqAnalyzeRam(seqCurrentRam);
  const first=analysis.find(s=>s.hasData);
  if(first) seqLoadSlotIntoEditor(seqCurrentRam, first.slot===0?0:first.slot);
  seqShowStatus('RAM loaded — '+analysis.filter(s=>s.hasData).length+' patterns found');
}

// Load the default pattern bank, unless RAM arrived from the Luma-1 or a file in the meantime
function seqLoadDefaultRam() {
  try {
    const def=window.LUMA_DEFAULT_RAM;
    if(!def) throw new Error('data/default_ram.js not loaded');
    const ram=Uint8Array.from(atob(def.base64),c=>c.charCodeAt(0));
    if(ram.length!==8192||ram[53]!==0x5A) throw new Error('not a Luma-1 RAM image');
    if(seqCurrentRam||ram_dump) return;
    ram_dump=ram; // so Write RAM To Device / Download work on it too
    seqOnRamReceived(ram,'default bank: '+def.name);
    seqShowStatus(`Default pattern bank "${def.name}" loaded — Read RAM from Device or load a .bin to replace it`);
  } catch(e) {
    console.warn('Default pattern bank not loaded:', e.message);
  }
}

// Called from Write RAM button
function seqWritePattern() {
  if(!seqCurrentRam){seqShowStatus('Load RAM first',true);return;}
  const slot=parseInt(document.getElementById('seqSlotInput')?.value||'0');
  if(slot<0||slot>99){seqShowStatus('Invalid slot',true);return;}
  if(seqLongPattern&&seqLongPattern.slot===slot&&
     !confirm(`Pattern ${String(slot).padStart(2,'0')} is ${seqLongPattern.steps} steps long, but the editor holds only ${seqNS}. Write the shortened version over it?`)) return;
  const pb=seqGetPatternBytes();
  const modRam=seqInsertPattern(new Uint8Array(seqCurrentRam),slot,pb);
  seqCurrentRam=modRam;
  // Update shared ram_dump for luma_midi.js writeRAMToDevice()
  ram_dump=modRam;
  seqRenderPatternPicker(seqCurrentRam);
  seqEncodeAndShow(seqCurrentRam,slot,pb);
  seqShowStatus('Pattern written to slot '+slot+'. Click "Write RAM To Device" to send.');
}

// Called from .bin file upload
function seqLoadBinFile(bytes, name='') {
  try {
    const ram=seqParseRamFile(new Uint8Array(bytes));
    ram_dump=ram; // keep luma.tools in sync
    seqOnRamReceived(ram, name);
  } catch(e) {
    seqShowStatus('File error: '+e.message, true);
  }
}

// ─── INIT ────────────────────────────────────────────────────────────────────


// ─── DRAG-AND-DROP .BIN ONTO SEQUENCER GRID ──────────────────────────────────
function seqDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='copy';
  document.getElementById('seqMachine').classList.add('seq-drag-over');
}
function seqDragLeave(e){
  document.getElementById('seqMachine').classList.remove('seq-drag-over');
}
async function seqDrop(e){
  e.preventDefault();
  document.getElementById('seqMachine').classList.remove('seq-drag-over');
  const file = Array.from(e.dataTransfer.files).find(f =>
    f.name.toLowerCase().endsWith('.bin') || f.name.toLowerCase().endsWith('.syx'));
  if(!file){ seqShowStatus('Drop a .bin or .syx file', true); return; }
  seqShowStatus('Reading '+file.name+'...', false);
  try{
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Validate: byte at 0xA035 (offset 0x35 from RAM base 0xA000) must be 0x5A
    let ram;
    try{ ram = seqParseRamFile(bytes); } catch(err){ seqShowStatus(err.message, true); return; }
    if(ram[53] !== 90){
      seqShowStatus('Not a valid LM-1 / Luma-1 memory file (bad magic at 0xA035)', true);
      return;
    }
    ram_dump = ram;  // keep luma.tools in sync
    seqOnRamReceived(ram, file.name);
    seqShowStatus('Loaded '+file.name, false);
  } catch(err){ seqShowStatus('Error: '+err.message, true); }
}

// Typing in a text field keeps its keys; everything else in the Pattern Editor is a shortcut
function seqIsTyping(el) {
  if(!el) return false;
  if(el.isContentEditable||el.tagName==='TEXTAREA') return true;
  return el.tagName==='INPUT'&&!['range','checkbox','radio','button','submit','reset','file','color'].includes(el.type);
}
function seqTabVisible() {
  const patTab=document.getElementById('pattern_editor_tab');
  return !!patTab&&patTab.style.display!=='none';
}

function seqInit() {
  // Pattern Editor shortcuts run first (capture phase), whatever has keyboard focus, so a
  // focused button, menu or slider can't swallow them — and the Sample Editor's Space
  // shortcut (luma_core.js) doesn't fire on this tab.
  window.addEventListener('keydown', e => {
    if(!seqTabVisible()||seqIsTyping(e.target)) return;
    const take=()=>{ e.preventDefault(); e.stopPropagation(); };
    // Space: play / stop from anywhere on the tab
    if(e.code==='Space'){
      take();
      if(e.repeat) return;
      if(typeof audio_init==='function') audio_init();
      seqPlaying?seqStopPlay():seqStartPlay();
      return;
    }
    if(e.key==='Escape'){ seqCloseHitMenu(); return; }
    // Arrows act on the hit under the mouse: ↑/↓ ratchet, ←/→ micro offset
    const arrow={ArrowUp:1,ArrowDown:-1,ArrowLeft:-1,ArrowRight:1}[e.key];
    if(arrow&&seqHoverCell){
      const {v,s}=seqHoverCell;
      if(seqSteps[v][s]===SEQ_OFF) return;
      take();
      if(e.key==='ArrowUp'||e.key==='ArrowDown') seqStepRatchet(v,s,arrow);
      else seqNudgeStep(v,s,arrow);
    }
  }, true);
  // Key preview: q w e r t y u i o p [ ] trigger corresponding voice
  document.addEventListener('keydown', e => {
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    if(e.target.matches('input:not([type=range]),select,textarea')) return;
    if(!seqTabVisible()) return;
    const v=SEQ_VKEY_MAP[e.key.toLowerCase()];
    if(v!==undefined){
      e.preventDefault();
      if(typeof audio_init==='function') audio_init();
      if(typeof actx==='undefined'||!actx) return;
      const doPlay=()=>{
        seqRefreshVoiceBuffers();
        seqPlayVoice(v,SEQ_LOUD,actx.currentTime+0.02);
      };
      if(actx.state==='running') doPlay();
      else actx.resume().then(doPlay);
      return;
    }
  });

  // Grid click
  // Pitch slider — event delegation
  document.getElementById('seqGrid')?.addEventListener('change', e => {
    const sel=e.target.closest('.seq-shuf-sel'); if(!sel) return;
    const [res,pct]=sel.value.split(':').map(Number);
    seqSetRowShuffle(+sel.dataset.v,res,pct);
    sel.blur();
  });
  document.getElementById('seqQuantizeBtn')?.addEventListener('click',seqQuantize);
  document.getElementById('seqGrid')?.addEventListener('input', e => {
    const p=e.target.closest('.seq-pitch-sl'); if(p) seqSetTune(+p.dataset.v,+p.value);
    const vl=e.target.closest('.seq-vol-sl'); if(vl) seqSetVolume(+vl.dataset.v,+vl.value);
  });
  document.getElementById('seqGrid')?.addEventListener('dblclick', e => {
    const p=e.target.closest('.seq-pitch-sl'); if(p) seqSetTune(+p.dataset.v,0);
    const vl=e.target.closest('.seq-vol-sl'); if(vl) seqSetVolume(+vl.dataset.v,100);
  });
  // Steps react on mouse press; keep holding and move along the row to paint more steps
  document.getElementById('seqGrid')?.addEventListener('pointerdown', e => {
    if(e.button!==0) return;
    const el=e.target.closest('.seq-st'); if(!el||+el.dataset.s>=seqNS) return;
    if(e.target.closest('.seq-nudge')) return; // ‹ › handles act on click
    e.preventDefault(); // no text selection while painting
    // preventDefault also keeps focus where it was (e.g. a menu that would grab the arrow keys)
    if(document.activeElement&&document.activeElement!==document.body) document.activeElement.blur();
    const v=+el.dataset.v, s=+el.dataset.s;
    seqClickStep(v,s,e.shiftKey,e.altKey);
    seqPaint=e.altKey?null:{v,val:seqSteps[v][s],k:seqRatchet[v][s]||1,last:s};
  });
  document.getElementById('seqGrid')?.addEventListener('pointerover', e => {
    if(!seqPaint) return;
    if(!(e.buttons&1)){ seqPaint=null; return; }
    const el=e.target.closest('.seq-st');
    if(el&&+el.dataset.v===seqPaint.v) seqPaint&&seqPaintTo(+el.dataset.s);
  });
  window.addEventListener('pointerup', () => { seqPaint=null; });
  window.addEventListener('pointerdown', seqCloseHitMenu);
  document.getElementById('seqGrid')?.addEventListener('contextmenu', e => {
    const el=e.target.closest('.seq-st'); if(!el||+el.dataset.s>=seqNS) return;
    const v=+el.dataset.v, s=+el.dataset.s;
    if(seqSteps[v][s]===SEQ_OFF) return;
    e.preventDefault();
    seqOpenHitMenu(v,s,e.clientX,e.clientY);
  });
  window.addEventListener('blur', () => { seqPaint=null; });
  document.getElementById('seqGrid')?.addEventListener('click', e => {
    const el=e.target.closest('.seq-st'); if(!el||+el.dataset.s>=seqNS) return;
    const nd=e.target.closest('.seq-nudge');
    if(nd) seqNudgeStep(+el.dataset.v,+el.dataset.s,+nd.dataset.d);
  });
  // Double-click a nudge handle: snap the hit back onto the grid
  document.getElementById('seqGrid')?.addEventListener('dblclick', e => {
    const nd=e.target.closest('.seq-nudge'); if(!nd) return;
    const el=nd.closest('.seq-st'); if(+el.dataset.s>=seqNS) return;
    const v=+el.dataset.v, s=+el.dataset.s;
    seqNudgeStep(v,s,-(seqShifts[v][s]||0));
  });
  // Track the hovered step so ←/→ can nudge it
  document.getElementById('seqGrid')?.addEventListener('mouseover', e => {
    const el=e.target.closest('.seq-st');
    seqHoverCell=el&&+el.dataset.s<seqNS?{v:+el.dataset.v,s:+el.dataset.s}:null;
  });
  document.getElementById('seqGrid')?.addEventListener('mouseleave', () => { seqHoverCell=null; });

  // Pattern picker click
  document.getElementById('seqPpGrid')?.addEventListener('click', e => {
    const btn=e.target.closest('.seq-pp-btn'); if(!btn||!seqCurrentRam) return;
    const slot=+btn.dataset.slot;
    if(seqPlaying){
      if(seqChainMode){seqShowStatus('Stop chain before selecting a pattern',true);return;}
      if(slot===seqPlayingSlot){seqQueuedSlot=-1;seqUpdatePickerStates();return;}
      seqQueuedSlot=slot; seqUpdatePickerStates();
    } else {
      seqLoadSlotIntoEditor(seqCurrentRam,slot);
    }
  });

  // Chain picker click
  document.getElementById('seqChGrid')?.addEventListener('click', e => {
    const btn=e.target.closest('.seq-ch-btn'); if(!btn||!seqCurrentRam) return;
    const n=+btn.dataset.chain;
    const links=seqGetChainLinks(seqCurrentRam,n);
    if(!links.length) return;
    seqSelectedChain=n; seqUpdateChainStates();
  });

  // Luma-Sim (in addition to the per-voice pitch sliders, which still apply on top)
  const emuCb=document.getElementById('seqEmuEnable'), emuKnob=document.getElementById('seqEmuPitch');
  emuCb?.addEventListener('change',()=>{
    seqEmuEnabled=emuCb.checked;
    const ctl=document.getElementById('seqEmuControls'); if(ctl) ctl.style.display=seqEmuEnabled?'inline-flex':'none';
    seqUpdateEmuLabel();
    seqRefreshVoiceBuffers();
  });
  emuKnob?.addEventListener('input',()=>{ seqEmuKnob=+emuKnob.value/100; seqUpdateEmuLabel(); });
  emuKnob?.addEventListener('change',()=>{ seqEmuKnob=+emuKnob.value/100; seqRefreshVoiceBuffers(); });
  emuKnob?.addEventListener('dblclick',()=>{
    emuKnob.value='49'; seqEmuKnob=0.49; seqUpdateEmuLabel(); seqRefreshVoiceBuffers();
  });

  // Control buttons
  document.getElementById('seqHhDecayR')?.addEventListener('input',e=>{
    seqHhDecayMs=+e.target.value||250;
    const lbl=document.getElementById('seqHhDecayLbl');
    if(lbl) lbl.textContent=seqHhDecayMs+'ms';
  });
  document.getElementById('seqPlayBtn')?.addEventListener('click',()=>{
    if(typeof audio_init==='function') audio_init();  // luma_audio.js
    seqPlaying?seqStopPlay():seqStartPlay();
  });
  document.getElementById('seqPlayChainBtn')?.addEventListener('click',()=>{
    if(typeof audio_init==='function') audio_init();  // luma_audio.js
    seqChainMode?seqStopChainPlay():seqStartChainPlay();
  });

  document.getElementById('seqClrBtn')?.addEventListener('click',()=>{
    for(let v=0;v<SEQ_NV;v++) for(let s=0;s<32;s++){seqSteps[v][s]=SEQ_OFF;seqShifts[v][s]=0;seqRatchet[v][s]=1;}
    seqRowShuffle=seqRowShuffle.map(()=>({res:16,pct:50}));
    seqLenAdjust=0; seqExtraE=new Map(); seqLongPattern=null;
    seqActiveSlot=-1; seqBuildGrid();
    document.querySelectorAll('.seq-pp-btn').forEach(b=>b.classList.remove('seq-pp-active'));
  });
  // Pattern length menu: 1–32 steps
  const lenSel=document.getElementById('seqLenSel');
  if(lenSel){
    lenSel.innerHTML=Array.from({length:32},(_,i)=>{
      const n=i+1, bars=n===16?' (1 bar)':n===32?' (2 bars)':'';
      return `<option value="${n}">${n} step${n>1?'s':''}${bars}</option>`;
    }).join('');
    lenSel.value=seqNS;
  }
  lenSel?.addEventListener('change',e=>{
    seqSetStepCount(+e.target.value);
    seqLenAdjust=0; seqLongPattern=null;
    const hidden=seqHiddenHits();
    seqShowStatus(`Pattern length: ${seqNS} steps`+
      (hidden?` — ${hidden} hit(s) after step ${seqNS} are kept but not played or written`:''));
  });
  document.getElementById('seqBpmIn')?.addEventListener('input',e=>{
    seqBpm=Math.max(40,Math.min(250,+e.target.value||120));
    const lbl=document.getElementById('seqBpmLbl'); if(lbl) lbl.textContent=seqBpm;
  });
  document.getElementById('seqWriteBtn')?.addEventListener('click',seqWritePattern);

  // .bin file upload
  document.getElementById('seqBinFile')?.addEventListener('change',async function(e){
    const file=e.target.files[0]; if(!file) return;
    try{
      const buf=await file.arrayBuffer();
      seqLoadBinFile(buf, file.name);
    }catch(err){seqShowStatus('File error: '+err.message,true);}
    this.value='';
  });

  // Initial grid render (empty)
  seqBuildGrid();
}

// Run init when the DOM is ready (called by luma1_init after tab setup)
// We hook into the Pattern Editor tab button so the grid init is deferred
// until first shown — this way actx may not exist yet.
function seqOnTabShown() {
  // DO NOT call audio_init() here — that would create an actx at 12000Hz
  // before the user has interacted with audio, poisoning luma.tools sample playback.
  // Voice buffers are built lazily in seqStartPlay() on first play press.
  // Only pick up a pending RAM dump if one was received on another tab.
  if(ram_dump && !seqCurrentRam){
    seqOnRamReceived(ram_dump);
  } else if(!ram_dump && !seqCurrentRam){
    seqLoadDefaultRam();
  }
}
