// Retained-source audio operations. No function mutates the supplied sound.
// Store absolute pitch separately and always render from this source; never use
// a rendered ROM as the input to another pitch edit. PCM remains unquantized.
//
// Project shape: { pcm: Float32Array, rate, rawBytes: Uint8Array|null,
//                  rawExact?: Uint8Array|null }.
// rawBytes holds original inverted µ-law bytes. A missing/null rawExact means
// every byte is original; after editing, 1 marks bytes still valid at that frame.
// Serialize these fields together. Use clone/slice to preserve provenance.
(function (root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./resample_sinc.js').resampleSinc,
        require('./luma_percussion_dsp.js').renderPercussionEnvelope)
    : factory(root.resampleSinc, root.renderPercussionEnvelope);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LumaSound = api;
})(typeof globalThis === 'object' ? globalThis : this, function (resample, envelope) {
  'use strict';
  const MAX_FRAMES = 1048576;
  const MAX_FLOAT = 3.4028234663852886e38;
  const CODEC_PEAK = 32124 / 32768;

  function validRate(rate) {
    if (!Number.isFinite(rate) || rate < 1 || rate > 768000)
      throw new RangeError('Sample rate must be a finite number from 1 to 768000.');
    return rate;
  }
  function validPcm(pcm) {
    if ((!Array.isArray(pcm) && !ArrayBuffer.isView(pcm)) ||
        !Number.isSafeInteger(pcm.length) || pcm.length > MAX_FRAMES)
      throw new TypeError('PCM must be an array of at most 1048576 finite samples.');
    for (let i = 0; i < pcm.length; i++)
      if (!Number.isFinite(pcm[i]) || Math.abs(pcm[i]) > MAX_FLOAT)
        throw new RangeError('PCM must contain finite Float32 samples.');
    return pcm;
  }
  function validSound(sound) {
    if (!sound || typeof sound !== 'object') throw new TypeError('A sound is required.');
    validPcm(sound.pcm);
    validRate(sound.rate);
    if (sound.rawBytes != null && (!(sound.rawBytes instanceof Uint8Array) ||
        sound.rawBytes.length !== sound.pcm.length))
      throw new TypeError('Original bytes must match the PCM length.');
    if (sound.rawExact != null) {
      if (sound.rawBytes == null || !(sound.rawExact instanceof Uint8Array) ||
          sound.rawExact.length !== sound.pcm.length)
        throw new TypeError('Exact-byte mask must match the original bytes.');
      for (const bit of sound.rawExact)
        if (bit !== 0 && bit !== 1) throw new RangeError('Exact-byte mask must contain 0 or 1.');
    }
    return sound;
  }
  function range(sound, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || end < start || end > sound.pcm.length)
      throw new RangeError('Selection must have integer bounds within the sound.');
  }

  // Same inverted storage and G.711 rules as upstream codecs.mjs. That codec
  // derives from Steve Underwood's public-domain implementation and WebRTC's
  // bit-exact modification for negative samples. Keep the upstream notice there.
  function decodeByte(byte) {
    const value = (((byte & 15) << 3) + 132) << ((byte & 112) >> 4);
    return ((byte & 128) ? 132 - value : value - 132) / 32768;
  }
  function encodeSample(sample) {
    let linear = Math.round(Math.max(-1, Math.min(1, sample)) * 32768);
    linear = Math.max(-32768, Math.min(32767, linear));
    const negative = linear < 0;
    linear = negative ? 132 - linear - 1 : 132 + linear;
    const segment = 24 - Math.clz32(linear | 255);
    const code = segment >= 8 ? 127 : (segment << 4) | ((linear >> (segment + 3)) & 15);
    return code ^ (negative ? 128 : 0);
  }
  function create(pcm, rate) {
    validPcm(pcm);
    validRate(rate);
    return { pcm: Float32Array.from(pcm), rate, rawBytes: null };
  }
  function fromBytes(bytes, rate) {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FRAMES)
      throw new TypeError('ROM audio must be a Uint8Array of at most 1048576 bytes.');
    validRate(rate);
    return { pcm: Float32Array.from(bytes, decodeByte), rate, rawBytes: bytes.slice() };
  }
  function slice(sound, startFrame, endFrameExclusive) {
    validSound(sound);
    range(sound, startFrame, endFrameExclusive);
    const result = { pcm: Float32Array.from(sound.pcm.slice(startFrame, endFrameExclusive)),
      rate: sound.rate, rawBytes: sound.rawBytes?.slice(startFrame, endFrameExclusive) ?? null };
    if (sound.rawExact != null) result.rawExact = sound.rawExact.slice(startFrame, endFrameExclusive);
    return result;
  }
  function clone(sound) {
    validSound(sound);
    return slice(sound, 0, sound.pcm.length);
  }
  function replaceSelection(sound, start, end, replacement) {
    const result = clone(sound);
    for (let i = start; i < end; i++) {
      const next = replacement[i - start];
      if (next === result.pcm[i]) continue;
      result.pcm[i] = next;
      if (result.rawBytes != null) {
        if (result.rawExact == null) result.rawExact = new Uint8Array(result.pcm.length).fill(1);
        result.rawExact[i] = 0;
      }
    }
    return result;
  }
  function normalize(sound, startFrame = 0, endFrame = sound?.pcm?.length) {
    validSound(sound);
    range(sound, startFrame, endFrame);
    let peak = 0;
    for (let i = startFrame; i < endFrame; i++) peak = Math.max(peak, Math.abs(sound.pcm[i]));
    if (peak === 0 || peak === CODEC_PEAK) return clone(sound);
    const selection = new Float32Array(endFrame - startFrame);
    for (let i = 0; i < selection.length; i++) selection[i] = sound.pcm[startFrame + i] / peak * CODEC_PEAK;
    return replaceSelection(sound, startFrame, endFrame, selection);
  }
  function percussion(sound, startFrame, endFrame, settings = {}) {
    validSound(sound);
    range(sound, startFrame, endFrame);
    const selection = envelope(sound.pcm.slice(startFrame, endFrame), sound.rate, settings);
    return replaceSelection(sound, startFrame, endFrame, selection);
  }
  function render(sound, targetRate, pitchSemitones = 0) {
    validSound(sound);
    validRate(targetRate);
    if (!Number.isFinite(pitchSemitones) || Math.abs(pitchSemitones) > 96)
      throw new RangeError('Pitch must be a finite number from -96 to 96 semitones.');
    const length = sound.pcm.length ? Math.max(1, Math.round(sound.pcm.length * targetRate / sound.rate / 2 ** (pitchSemitones / 12))) : 0;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FRAMES)
      throw new RangeError('Rendered sound exceeds the 1048576-frame limit.');
    const pcm = resample(sound.pcm, length);
    let peak = 0;
    for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
    // Sinc interpolation can overshoot. One uniform gain correction preserves
    // the waveform instead of hard clipping at the final ROM boundary.
    const gain = peak > 1 ? 1 / peak : 1;
    if (gain < 1) for (let i = 0; i < pcm.length; i++) pcm[i] *= gain;
    const bytes = Uint8Array.from(pcm, encodeSample);
    if (gain === 1 && targetRate === sound.rate && pitchSemitones === 0 && sound.rawBytes)
      for (let i = 0; i < bytes.length; i++)
        if (sound.rawExact == null || sound.rawExact[i]) bytes[i] = sound.rawBytes[i];
    return { pcm, bytes, rate: targetRate, peakReductionDb: gain < 1 ? -20 * Math.log10(gain) : 0 };
  }
  return Object.freeze({ create, fromBytes, clone, slice, render, normalize, percussion, MAX_FRAMES, CODEC_PEAK });
});
