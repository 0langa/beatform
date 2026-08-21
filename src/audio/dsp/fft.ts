/**
 * Radix-2 real FFT producing dB magnitudes, matching the shape of
 * AnalyserNode.getFloatFrequencyData output (fftSize/2 bins). Used by the
 * offline analysis path (MP4 export) where no realtime AnalyserNode exists.
 */
/**
 * Fall length E of the asymmetric display window: the last E samples carry the
 * half-Hann fall, everything before them the rise. Shared with
 * `spectrumDiagnostics` so the UI reports the same latency the transform has.
 */
export function asymmetricWindowFallLength(size: number): number {
  return Math.round(size / 8);
}

export class RealFFT {
  readonly size: number;
  /**
   * Distance in samples from the window END to the sample of maximum weight —
   * where a transient reads strongest, and therefore the display's effective
   * latency when the window simply ends at "now".
   *
   * Symmetric Hann peaks at its centre: (N−1)/2, the familiar half-window lag.
   * The asymmetric window peaks E = round(N/8) samples from the end.
   *
   * Deliberately the PEAK, not the first moment. The first-moment centroid
   * sum(i·w)/sum(w) of the rise/fall shape sits ≈0.35·N from the end (the long
   * rise carries most of the mass), but the drawn bar for a transient maxes
   * out when the transient sits under the window's peak weight — aligning the
   * first moment instead would make exported bars peak ~4–5 analysis ticks
   * BEFORE the audible hit. The click-alignment test in offlineSource.test.ts
   * pins the peak definition.
   */
  readonly peakOffsetSamples: number;
  private cosTable: Float32Array;
  private sinTable: Float32Array;
  private window: Float32Array;
  private re: Float32Array;
  private im: Float32Array;
  private blockDc: boolean;
  private scale: number;
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
   *
   * `asymmetricWindow` (same opt-in style, display paths only) swaps the
   * symmetric Hann for a half-Hann RISE over the first N−E samples and a
   * half-Hann FALL over the last E = round(N/8): most of the window's weight
   * moves next to its end, so the analyzer-length windows (85/171/341 ms) stop
   * dragging the drawn bars half a window behind the audible transient. The
   * detector transforms never set it — beat/onset timing stays byte-identical
   * (fft.test.ts pins the default window against a naive DFT).
   */
  constructor(size: number, blockDc = false, asymmetricWindow = false) {
    if ((size & (size - 1)) !== 0) throw new Error("FFT size must be power of 2");
    this.size = size;
    this.blockDc = blockDc;
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.window = new Float32Array(size);
    if (asymmetricWindow) {
      const fall = asymmetricWindowFallLength(size);
      const rise = size - fall;
      for (let i = 0; i < rise; i++) {
        this.window[i] = 0.5 * (1 - Math.cos((Math.PI * i) / (rise - 1)));
      }
      for (let j = 0; j < fall; j++) {
        this.window[rise + j] = 0.5 * (1 + Math.cos((Math.PI * (j + 1)) / fall));
      }
      this.peakOffsetSamples = fall; // unique maximum (weight 1) at index rise−1
    } else {
      // Hann window (AnalyserNode uses Blackman; close enough — offline
      // features must be self-consistent, not bit-identical to the realtime
      // path)
      for (let i = 0; i < size; i++) {
        this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
      }
      this.peakOffsetSamples = (size - 1) / 2;
    }
    for (let i = 0; i < size; i++) this.windowSum += this.window[i];
    // Magnitude normalization: 2/sum(w) puts a full-scale bin-centred sine at
    // 0 dB for ANY window (one-sided factor 2, coherent gain sum(w)). For the
    // default Hann, sum(w) is exactly (N−1)/2, so 2/sum(w) = 4/(N−1) — which
    // is NOT the shipped 4/N (2.4e-4 relative at N=4096, far beyond float
    // noise). The detector spectra are pinned byte-for-byte by fft.test.ts and
    // the offline golden trace, so the symmetric case keeps the literal 4/N
    // and only the new asymmetric window uses the general form.
    this.scale = asymmetricWindow ? 2 / this.windowSum : 4 / size;
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

    // Magnitude -> dB. Scale: 2/N for one-sided spectrum times the window's
    // coherent gain — see the constructor for why the symmetric case keeps the
    // historical literal 4/N.
    //
    // sqrt(re²+im²), NOT Math.hypot (R2-08): hypot's overflow/underflow
    // guards cost ~43x per call on this hot instruction, and they guard
    // against inputs this loop can never see. re/im are sums of at most N
    // windowed PCM samples (|x| ≤ 1, window weights ≤ 1), so |re|,|im| ≤ N ≤
    // 32768 — squares stay below ~1.1e9, astronomically far from float64's
    // ~1.8e308 overflow and from squared-subnormal underflow mattering (a
    // magnitude that tiny is -Infinity dB either way). sqrt and hypot agree
    // to ≤1 ulp on this domain.
    const scale = this.scale;
    const bins = n >> 1;
    for (let i = 0; i < bins; i++) {
      const m = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * scale;
      outDb[i] = m > 1e-10 ? 20 * Math.log10(m) : -Infinity;
    }
  }
}
