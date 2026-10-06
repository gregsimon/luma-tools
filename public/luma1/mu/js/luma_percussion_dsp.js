// Offline, LPG-inspired percussion shaping. This is not a Buchla circuit model.
// Parker & D'Angelo, "A Digital Model of the Buchla Lowpass-Gate", DAFx 2013,
// describe a fast opening, slower closing response with linked level and tone.
// Here a curved decay and a stable, nonresonant closing filter provide that
// musical behavior without emulating the circuit or adding analog distortion.
//
// decay:   0 = short/snappy, 1 = long/ringing, relative to the selection length.
// damping: 0 = level fade only, 1 = strongest darkening as the sound decays.
// Always render from retained source PCM when a control changes. This function
// never mutates, normalizes, clips or retains state between calls.
function renderPercussionEnvelope(pcm, sampleRate, options = {}) {
  if ((!Array.isArray(pcm) && !ArrayBuffer.isView(pcm)) || !Number.isSafeInteger(pcm.length))
    throw new TypeError('Percussion input must be an array of finite PCM samples.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new RangeError('Percussion sample rate must be positive and finite.');
  if (!options || typeof options !== 'object')
    throw new TypeError('Percussion controls must be an options object.');
  const { decay = 0.55, damping = 0.55 } = options;
  for (const value of [decay, damping]) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('Percussion decay and damping must be numbers from 0 to 1.');
  }
  // Float32 output must be able to represent every input magnitude. Audio above
  // 1 is allowed: preserving existing floating-point headroom is not clipping.
  const float32Max = 3.4028234663852886e38;
  for (let i = 0; i < pcm.length; i++) {
    if (!Number.isFinite(pcm[i]) || Math.abs(pcm[i]) > float32Max)
      throw new RangeError('Percussion PCM samples must be finite Float32 values.');
  }
  const output = new Float32Array(pcm.length);
  // There is no interior between the silent boundaries at these lengths.
  if (pcm.length <= 2) return output;

  const last = pcm.length - 1;
  const attackFrames = Math.max(1, Math.min(Math.round(sampleRate * 0.00025), Math.floor(last * 0.01)));
  const tailFrames = Math.max(1, Math.min(Math.round(sampleRate * 0.002), Math.floor(last * 0.05)));
  const tau = 0.045 * Math.pow(12, decay);
  const slowTau = tau * 2.5;
  const floor = 0.82 * Math.exp(-1 / tau) + 0.18 * Math.exp(-1 / slowTau);
  const envelopeScale = 1 / (1 - floor);
  // Work in cycles/sample so even extreme positive rates cannot underflow
  // the cutoff ratio or overflow the coefficient calculation.
  const openCutoff = Math.min(18000 / sampleRate, 0.45);
  const closedCutoff = Math.min(180 / sampleRate, openCutoff * 0.1);
  const cutoffRatio = openCutoff / closedCutoff;
  let firstState = pcm[0], secondState = pcm[0];

  for (let i = 0; i < pcm.length; i++) {
    const time = i / last;
    // Two smooth exponential components retain a softer tail behind the initial
    // decay. Subtracting their end level brings every setting to exact silence.
    const envelope = Math.max(0, (0.82 * Math.exp(-time / tau) + 0.18 * Math.exp(-time / slowTau) - floor) * envelopeScale);
    let sample = pcm[i];
    if (damping > 0) {
      const cutoff = closedCutoff * Math.pow(cutoffRatio, envelope);
      // Positive one-pole updates are convex combinations of input and state.
      // This remains bounded under changing cutoff; no resonant gain, clipping,
      // normalization or coefficient-switch transient is needed. Separated poles
      // make a gentler response than two coincident low-pass poles.
      const firstGain = -Math.expm1(-2 * Math.PI * cutoff);
      const secondGain = -Math.expm1(-2 * Math.PI * Math.min(cutoff * 4, 0.475));
      firstState += firstGain * (sample - firstState);
      secondState += secondGain * (firstState - secondState);
      sample = (1 - damping) * sample + damping * secondState;
    }
    // Only the leading fraction of a millisecond is rounded, preserving the hit.
    const attack = i < attackFrames ? Math.sin((i / attackFrames) * Math.PI / 2) ** 2 : 1;
    const tailPosition = Math.min(1, (last - i) / tailFrames);
    const tail = tailPosition * tailPosition * (3 - 2 * tailPosition);
    output[i] = sample * envelope * attack * tail;
  }
  // Explicit endpoints also avoid negative zero when the input ends negative.
  output[0] = 0;
  output[last] = 0;
  return output;
}
if (typeof module !== 'undefined') module.exports = { renderPercussionEnvelope };
