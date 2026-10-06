// Windowed-sinc resampler, based on the supplied permissively licensed version.
// Decode once, resample in linear PCM, encode once at the final ROM boundary.
// Endpoints use held-edge extension; phase-wise gain normalization preserves DC.
function resampleSinc(input, outLen, quality = 16) {
  if (!Number.isSafeInteger(outLen) || outLen < 0 || outLen > 1048576)
    throw new RangeError('Output length must be an integer from 0 to 1048576.');
  if ((!Array.isArray(input) && !ArrayBuffer.isView(input)) ||
      !Number.isSafeInteger(input.length) || input.length < 0 || input.length > 1048576)
    throw new RangeError('Input must contain at most 1048576 samples.');
  if (!Number.isInteger(quality) || quality < 4 || quality > 64)
    throw new RangeError('Quality must be an integer from 4 to 64.');
  const inLen = input.length;
  for (let i = 0; i < inLen; i++)
    if (!Number.isFinite(input[i]) || Math.abs(input[i]) > 3.4028234663852886e38)
      throw new TypeError('Input audio must contain finite Float32 samples.');
  if (outLen === 0 || inLen === 0) return new Float32Array(0);
  if (outLen === inLen) return Float32Array.from(input);
  if (inLen === 1) return new Float32Array(outLen).fill(input[0]);
  const ratio = outLen / inLen;
  const cutoff = Math.min(1, ratio) * 0.945;
  // A 48-lobe minimum when decimating places the existing 0.945-Nyquist
  // transition fully in the stopband by the new Nyquist boundary. Interpolation
  // and exact-length copies retain their previous quality/identity behavior.
  const filterQuality = ratio < 1 ? Math.max(48, quality) : quality;
  const halfTaps = Math.ceil(filterQuality / Math.min(1, ratio));
  const beta = 8;
  function i0(x) {
    let s = 1, t = 1;
    for (let k = 1; k < 30; k++) {
      t *= (x / (2 * k)) ** 2;
      s += t;
      if (t < 1e-12 * s) break;
    }
    return s;
  }
  const i0beta = i0(beta);
  // Long decimation jobs otherwise evaluate sine/Bessel functions hundreds of
  // millions of times on the editor thread. The even kernel is smooth, so a
  // bounded table with linear interpolation retains the response below the
  // numerical/codec noise floor while making large jobs substantially faster.
  // 1024 intervals per sinc lobe; at the maximum quality this is about 0.5 MiB.
  const kernelSize = filterQuality * 1024;
  const useKernel = ratio < 1 && outLen * halfTaps > 131072;
  const kernel = useKernel ? new Float64Array(kernelSize + 1) : null;
  const kernelScale = kernelSize / halfTaps;
  if (kernel) {
    for (let j = 0; j <= kernelSize; j++) {
      const d = j / kernelScale, x = Math.PI * d * cutoff, u = j / kernelSize;
      const sinc = x === 0 ? 1 : Math.sin(x) / x;
      kernel[j] = sinc * i0(beta * Math.sqrt(1 - u * u)) / i0beta;
    }
    // Keep the analytic one-sided limit at the last table entry; the lookup
    // returns zero at/outside the actual support. Forcing the table limit to
    // zero would smear the small Kaiser endpoint discontinuity into the FIR.
  }
  const out = new Float32Array(outLen);
  for (let n = 0; n < outLen; n++) {
    const center = n / ratio;
    const k0 = Math.ceil(center - halfTaps), k1 = Math.floor(center + halfTaps);
    let acc = 0, wsum = 0;
    for (let k = k0; k <= k1; k++) {
      const d = k - center;
      let coeff;
      if (kernel) {
        const at = Math.abs(d) * kernelScale, index = Math.floor(at);
        coeff = index >= kernelSize ? 0 : kernel[index] + (kernel[index + 1] - kernel[index]) * (at - index);
      } else {
        const x = Math.PI * d * cutoff, u = d / halfTaps;
        const sinc = x === 0 ? 1 : Math.sin(x) / x;
        const w = u * u >= 1 ? 0 : i0(beta * Math.sqrt(1 - u * u)) / i0beta;
        coeff = sinc * w;
      }
      acc += input[Math.max(0, Math.min(inLen - 1, k))] * coeff;
      wsum += coeff;
    }
    out[n] = wsum !== 0 ? acc / wsum : 0;
    if (!Number.isFinite(out[n])) throw new RangeError('Resampled audio exceeds Float32 range.');
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = { resampleSinc };
