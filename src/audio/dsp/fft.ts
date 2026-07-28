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
  private blockDc: boolean;
  private windowSum = 0;

  /**
   * `blockDc` removes each window's DC component before transforming it.
   *
   * OFF by default, deliberately. A constant offset is not audible content —
   * it is a recording or decode artifact — but removing it changes every bin
   * near the bottom of the spectrum, and this class is shared by the whole-
   * track analysers (`beatGrid`, `keyDetect`, `sections`) as well as the two
   * feature paths. Defaulting it on would silently retune tempo, key and
   * section detection, and would break this class's stated contract of
   * matching a naive DFT, which `fft.test.ts` asserts.
   *
   * The feature paths (`realtimeSource`, `offlineSource`) opt in, because they
   * feed the DRAWN spectrum: with the analysed span dragged down to its 10 Hz
   * floor, a file with any offset used to peg the lowest bar permanently
   * (measured 0.956 against 0.2 for the same tone without an offset). `binAt`
   * has long excluded bin 0 for exactly this reason, but that only ever
   * addressed part of it — worth 0.65 % — because a Hann window leaks DC into
   * bin 1 at about -6 dB and it cannot reach that.
   */
  constructor(size: number, blockDc = false) {
    if ((size & (size - 1)) !== 0) throw new Error("FFT size must be power of 2");
    this.size = size;
    this.blockDc = blockDc;
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
      this.windowSum += this.window[i];
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
    // Optional DC block — see the `blockDc` constructor flag.
    //
    // The correction is the WINDOW-WEIGHTED mean, sum(w*x)/sum(w), not the
    // plain arithmetic mean. Bin 0 of the transform is sum(w*x), so this is
    // the only value that drives it to exactly zero; subtracting mean(x)
    // instead leaves a residue whose sign depends on where the signal's phase
    // happens to fall in the window, and measurably LIFTS the lowest bands on
    // material that had no offset to begin with.
    let dc = 0;
    if (this.blockDc) {
      let wx = 0;
      for (let i = 0; i < n; i++) wx += this.window[i] * input[i];
      dc = wx / this.windowSum;
    }
    for (let i = 0; i < n; i++) {
      re[i] = (input[i] - dc) * this.window[i];
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
