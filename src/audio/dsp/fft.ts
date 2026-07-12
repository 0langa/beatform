/**
 * Radix-2 real FFT producing dB magnitudes, matching the shape of
 * AnalyserNode.getFloatFrequencyData output (fftSize/2 bins). Used by the
 * offline analysis path (MP4 export) where no realtime AnalyserNode exists.
 */
export class RealFFT {
  readonly size: number;
  private cosTable: Float32Array;
  private sinTable: Float32Array;
  private window: Float32Array;
  private re: Float32Array;
  private im: Float32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0) throw new Error("FFT size must be power of 2");
    this.size = size;
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }
    // Hann window (AnalyserNode uses Blackman; close enough — offline features
    // must be self-consistent, not bit-identical to the realtime path)
    this.window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /**
   * input: time-domain samples (length >= size, uses first `size`)
   * outDb: dB magnitudes, length size/2
   */
  magnitudesDb(input: Float32Array, outDb: Float32Array): void {
    const n = this.size;
    const { re, im } = this;
    for (let i = 0; i < n; i++) {
      re[i] = input[i] * this.window[i];
      im[i] = 0;
    }

    // bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const idx = k * step;
          const wr = this.cosTable[idx];
          const wi = -this.sinTable[idx];
          const xr = re[i + k + half] * wr - im[i + k + half] * wi;
          const xi = re[i + k + half] * wi + im[i + k + half] * wr;
          re[i + k + half] = re[i + k] - xr;
          im[i + k + half] = im[i + k] - xi;
          re[i + k] += xr;
          im[i + k] += xi;
        }
      }
    }

    // Magnitude -> dB. Scale: 2/N for one-sided spectrum, ~2x for Hann
    // coherent gain (sum(w)/N = 0.5).
    const scale = 4 / n;
    const bins = n >> 1;
    for (let i = 0; i < bins; i++) {
      const m = Math.hypot(re[i], im[i]) * scale;
      outDb[i] = m > 1e-10 ? 20 * Math.log10(m) : -Infinity;
    }
  }
}
