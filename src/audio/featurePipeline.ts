import type { AudioFeatures, SyncMode, SyncSettings } from "./types";
import { DEFAULT_SYNC } from "./types";

export const MIN_FREQ = 30;
export const MAX_FREQ = 16000;
export const MIN_DB = -90;
export const MAX_DB = -22;

/** Frames of spectral-flux history for the adaptive beat threshold (~0.7 s at 60 fps). */
const FLUX_WINDOW = 43;
/** Minimum seconds between detected beats. */
const BEAT_REFRACTORY = 0.14;
/** beatIntensity halves roughly every 90 ms. */
const BEAT_DECAY = 8;

export interface PipelineConfig {
  sampleRate: number;
  /** FFT bin count (fftSize / 2) */
  fftBins: number;
  /** Output spectrum bins (log-spaced) */
  binCount?: number;
  /** Time-domain samples exposed as features.waveform */
  waveformLength: number;
}

export interface PipelineInput {
  /** dB magnitudes per FFT bin (AnalyserNode or RealFFT output) */
  magDb: Float32Array;
  /** Time-domain samples, -1..1 */
  waveform: Float32Array;
  /** Playback position, seconds */
  time: number;
  /** Seconds since previous frame — pass exactly 1/fps for offline rendering */
  dt: number;
  playing: boolean;
  duration: number;
}

/**
 * Source-agnostic feature extraction. Consumes raw spectrum + waveform frames
 * and produces renderer-ready AudioFeatures:
 *  - log-spaced bins (linear FFT bins misrepresent hearing: bass would get
 *    2 bars, treble 90% of the screen)
 *  - asymmetric EMA smoothing (fast attack, slow release) + peak hold
 *  - band energies and spectral-flux beat detection on the low end
 *
 * Deterministic: state depends only on the sequence of update() inputs, so
 * the offline (export) path replays a track frame-by-frame and gets identical
 * visuals for identical audio.
 */
export class FeaturePipeline {
  readonly binCount: number;
  readonly features: AudioFeatures;

  private mag: Float32Array;
  private prevMag: Float32Array;
  /** [start, end) FFT-bin range per output bin, geometrically spaced */
  private ranges: Array<[number, number]>;
  private bassRange: [number, number];
  private midRange: [number, number];
  private trebleRange: [number, number];
  private voiceRange: [number, number];

  private fluxHistory: number[] = [];
  private lastBeatAt = -Infinity;
  private clock = 0;

  // Sync-source state: a second onset detector over the selected band and
  // an independently smoothed drive scalar
  private sync: SyncSettings = { ...DEFAULT_SYNC };
  private syncFluxHistory: number[] = [];
  private lastSyncBeatAt = -Infinity;
  private syncBeatIntensity = 0;
  private driveValue = 0;

  constructor(config: PipelineConfig) {
    this.binCount = config.binCount ?? 96;
    const fftBins = config.fftBins;
    this.mag = new Float32Array(fftBins);
    this.prevMag = new Float32Array(fftBins);

    const nyquist = config.sampleRate / 2;
    const hzPerBin = nyquist / fftBins;
    const toBin = (hz: number) =>
      Math.max(0, Math.min(fftBins - 1, Math.round(hz / hzPerBin)));

    // Geometric frequency edges -> FFT bin ranges, each at least 1 bin wide.
    this.ranges = [];
    const ratio = MAX_FREQ / MIN_FREQ;
    for (let i = 0; i < this.binCount; i++) {
      const f0 = MIN_FREQ * Math.pow(ratio, i / this.binCount);
      const f1 = MIN_FREQ * Math.pow(ratio, (i + 1) / this.binCount);
      const b0 = toBin(f0);
      const b1 = Math.max(b0 + 1, toBin(f1));
      this.ranges.push([b0, b1]);
    }
    this.bassRange = [toBin(30), toBin(150)];
    this.midRange = [toBin(150), toBin(2000)];
    this.trebleRange = [toBin(2000), toBin(16000)];
    this.voiceRange = [toBin(300), toBin(3400)];

    this.features = {
      bins: new Float32Array(this.binCount),
      peaks: new Float32Array(this.binCount),
      waveform: new Float32Array(config.waveformLength),
      rms: 0,
      energy: 0,
      voice: 0,
      drive: 0,
      driveBeat: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      beat: false,
      beatIntensity: 0,
      time: 0,
      duration: 0,
    };
  }

  update(input: PipelineInput): AudioFeatures {
    const f = this.features;
    const dt = Math.min(0.1, Math.max(0.0001, input.dt));
    this.clock += dt;

    // dB -> 0..1 magnitudes
    const mag = this.mag;
    for (let i = 0; i < mag.length; i++) {
      const db = input.magDb[i];
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

    // Oscilloscope-style trigger: start the displayed waveform at the first
    // rising zero-crossing so the trace is phase-stable frame to frame
    // (untriggered waveforms jitter/flicker at any volume). The search
    // headroom is input.length - output.length, guaranteed by the sources
    // passing waveformLength < fftSize.
    const wIn = input.waveform;
    const wOut = f.waveform;
    const headroom = Math.max(0, wIn.length - wOut.length);
    let trig = 0;
    for (let i = 1; i < headroom; i++) {
      if (wIn[i - 1] <= 0 && wIn[i] > 0) {
        trig = i;
        break;
      }
    }
    wOut.set(wIn.subarray(trig, trig + wOut.length));

    let sum = 0;
    for (let i = 0; i < wIn.length; i++) sum += wIn[i] ** 2;
    f.rms = clamp01(Math.sqrt(sum / wIn.length) * 2.5);
    // Slow envelope (~0.8 s time constant): calm baseline for motion speeds
    f.energy += (f.rms - f.energy) * (1 - Math.exp(-dt * 1.2));

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
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > FLUX_WINDOW) this.fluxHistory.shift();
    const mean =
      this.fluxHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.fluxHistory.length);

    f.beat = false;
    if (
      this.fluxHistory.length >= 12 &&
      flux > mean * 1.6 + 0.012 &&
      this.clock - this.lastBeatAt > BEAT_REFRACTORY &&
      input.playing
    ) {
      f.beat = true;
      this.lastBeatAt = this.clock;
      f.beatIntensity = 1;
    } else {
      f.beatIntensity *= Math.exp(-dt * BEAT_DECAY);
    }

    f.voice = bandMean(mag, this.voiceRange);

    this.updateSync(f, mag, dt, input.playing);
    // Both onset detectors diff against the previous frame — update it last
    this.prevMag.set(mag);

    f.time = input.time;
    f.duration = input.duration;
    return f;
  }

  /** Choose what the visuals follow. Safe to call any time. */
  setSync(sync: SyncSettings): void {
    if (sync.mode !== this.sync.mode) {
      this.syncFluxHistory.length = 0;
      this.syncBeatIntensity = 0;
    }
    this.sync = { ...sync };
  }

  private syncBand(mode: SyncMode): [number, number] {
    switch (mode) {
      case "melody":
        return this.midRange;
      case "voice":
        return this.voiceRange;
      case "treble":
        return this.trebleRange;
      default:
        return this.bassRange; // energy/bass/kick pulse on the low end
    }
  }

  private updateSync(f: AudioFeatures, mag: Float32Array, dt: number, playing: boolean): void {
    const { mode, smooth } = this.sync;

    // Raw drive value for the selected source
    let raw: number;
    switch (mode) {
      case "bass":
        raw = f.bass;
        break;
      case "melody":
        raw = f.mid;
        break;
      case "voice":
        raw = f.voice;
        break;
      case "treble":
        raw = f.treble;
        break;
      case "kick":
      case "energy":
      default:
        raw = f.energy;
        break;
    }

    // Smoothing knob: 0 = snappy (fast attack/release), 1 = long glide
    const attack = 1 - Math.exp(-dt * (30 - smooth * 26));
    const release = 1 - Math.exp(-dt * (10 - smooth * 8.5));
    this.driveValue += (raw - this.driveValue) * (raw > this.driveValue ? attack : release);
    f.drive = this.driveValue;

    // Onset pulse over the selected band (spectral flux, adaptive threshold)
    const [lo, hi] = this.syncBand(mode);
    let flux = 0;
    for (let b = lo; b < hi; b++) {
      const d = mag[b] - this.prevMag[b];
      if (d > 0) flux += d;
    }
    this.syncFluxHistory.push(flux);
    if (this.syncFluxHistory.length > FLUX_WINDOW) this.syncFluxHistory.shift();
    const mean =
      this.syncFluxHistory.reduce((a, b) => a + b, 0) /
      Math.max(1, this.syncFluxHistory.length);

    if (
      this.syncFluxHistory.length >= 12 &&
      flux > mean * 1.6 + 0.012 &&
      this.clock - this.lastSyncBeatAt > BEAT_REFRACTORY &&
      playing
    ) {
      this.lastSyncBeatAt = this.clock;
      this.syncBeatIntensity = 1;
    } else {
      this.syncBeatIntensity *= Math.exp(-dt * BEAT_DECAY);
    }
    f.driveBeat = this.syncBeatIntensity;
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
