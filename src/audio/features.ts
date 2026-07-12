import type { AudioFeatures } from "./types";
import type { AudioEngine } from "./engine";

const MIN_FREQ = 30;
const MAX_FREQ = 16000;
const MIN_DB = -90;
const MAX_DB = -22;

/** Frames of spectral-flux history for the adaptive beat threshold (~0.7 s at 60 fps). */
const FLUX_WINDOW = 43;
/** Minimum seconds between detected beats. */
const BEAT_REFRACTORY = 0.14;
/** beatIntensity halves roughly every 90 ms. */
const BEAT_DECAY = 8;

/**
 * Turns raw AnalyserNode data into renderer-ready AudioFeatures:
 *  - log-spaced bins (linear FFT bins misrepresent hearing: bass would get
 *    2 bars, treble 90% of the screen)
 *  - asymmetric EMA smoothing (fast attack, slow release) + peak hold
 *  - band energies and spectral-flux beat detection on the low end
 */
export class FeatureExtractor {
  readonly binCount: number;

  private engine: AudioEngine;
  private freqData: Float32Array;
  private timeData: Float32Array;
  private prevMag: Float32Array;
  /** [start, end) FFT-bin range per output bin, geometrically spaced */
  private ranges: Array<[number, number]>;
  private bassRange: [number, number];
  private midRange: [number, number];
  private trebleRange: [number, number];

  private fluxHistory: number[] = [];
  private lastBeatAt = -Infinity;
  private lastFrameAt: number | null = null;

  readonly features: AudioFeatures;

  constructor(engine: AudioEngine, binCount = 96) {
    this.engine = engine;
    this.binCount = binCount;
    const fftBins = engine.analyser.frequencyBinCount;
    this.freqData = new Float32Array(fftBins);
    this.timeData = new Float32Array(engine.analyser.fftSize);
    this.prevMag = new Float32Array(fftBins);

    const nyquist = engine.ctx.sampleRate / 2;
    const hzPerBin = nyquist / fftBins;
    const toBin = (hz: number) =>
      Math.max(0, Math.min(fftBins - 1, Math.round(hz / hzPerBin)));

    // Geometric frequency edges -> FFT bin ranges, each at least 1 bin wide.
    this.ranges = [];
    const ratio = MAX_FREQ / MIN_FREQ;
    for (let i = 0; i < binCount; i++) {
      const f0 = MIN_FREQ * Math.pow(ratio, i / binCount);
      const f1 = MIN_FREQ * Math.pow(ratio, (i + 1) / binCount);
      const b0 = toBin(f0);
      const b1 = Math.max(b0 + 1, toBin(f1));
      this.ranges.push([b0, b1]);
    }
    this.bassRange = [toBin(30), toBin(150)];
    this.midRange = [toBin(150), toBin(2000)];
    this.trebleRange = [toBin(2000), toBin(16000)];

    this.features = {
      bins: new Float32Array(binCount),
      peaks: new Float32Array(binCount),
      waveform: new Float32Array(this.timeData.length),
      rms: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      beat: false,
      beatIntensity: 0,
      time: 0,
      duration: 0,
    };
  }

  /** Call once per animation frame. Mutates and returns this.features. */
  update(now: number): AudioFeatures {
    const dt = this.lastFrameAt === null ? 1 / 60 : Math.min(0.1, now - this.lastFrameAt);
    this.lastFrameAt = now;

    const f = this.features;
    this.engine.analyser.getFloatFrequencyData(this.freqData);
    this.engine.analyser.getFloatTimeDomainData(this.timeData);

    // dB -> 0..1 magnitudes
    const mag = this.freqData;
    for (let i = 0; i < mag.length; i++) {
      const db = mag[i];
      mag[i] = db === -Infinity ? 0 : clamp01((db - MIN_DB) / (MAX_DB - MIN_DB));
    }

    // Log-spaced bins with asymmetric EMA + peak hold with gravity
    const attack = 1 - Math.exp(-dt * 35);
    const release = 1 - Math.exp(-dt * 9);
    const gravity = 0.55 * dt;
    for (let i = 0; i < this.binCount; i++) {
      const [b0, b1] = this.ranges[i];
      let v = 0;
      for (let b = b0; b < b1; b++) v = Math.max(v, mag[b]);
      const prev = f.bins[i];
      f.bins[i] = prev + (v - prev) * (v > prev ? attack : release);
      f.peaks[i] = Math.max(f.peaks[i] - gravity, f.bins[i]);
    }

    f.waveform.set(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) sum += this.timeData[i] ** 2;
    f.rms = clamp01(Math.sqrt(sum / this.timeData.length) * 2.5);

    f.bass = bandMean(mag, this.bassRange);
    f.mid = bandMean(mag, this.midRange);
    f.treble = bandMean(mag, this.trebleRange);

    // Spectral flux over the low end (kick/snare live here), adaptive threshold
    let flux = 0;
    const [lo, hi] = [this.bassRange[0], this.midRange[0] + 8];
    for (let b = lo; b < hi; b++) {
      const d = mag[b] - this.prevMag[b];
      if (d > 0) flux += d;
    }
    this.prevMag.set(mag);
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > FLUX_WINDOW) this.fluxHistory.shift();
    const mean =
      this.fluxHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.fluxHistory.length);

    f.beat = false;
    if (
      this.fluxHistory.length >= 12 &&
      flux > mean * 1.6 + 0.012 &&
      now - this.lastBeatAt > BEAT_REFRACTORY &&
      this.engine.playing
    ) {
      f.beat = true;
      this.lastBeatAt = now;
      f.beatIntensity = 1;
    } else {
      f.beatIntensity *= Math.exp(-dt * BEAT_DECAY);
    }

    f.time = this.engine.currentTime;
    f.duration = this.engine.duration;
    return f;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function bandMean(mag: Float32Array, [b0, b1]: [number, number]): number {
  let s = 0;
  const n = Math.max(1, b1 - b0);
  for (let b = b0; b < b1; b++) s += mag[b];
  return clamp01((s / n) * 1.6);
}
