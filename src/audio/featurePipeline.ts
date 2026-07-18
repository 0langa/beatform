import type { AudioFeatures, SyncMode, SyncSettings } from "./types";
import { DEFAULT_SYNC, sanitizeSync } from "./types";

export const MIN_FREQ = 30;
export const MAX_FREQ = 16000;
export const MIN_DB = -90;
export const MAX_DB = -22;
/**
 * Window for the DRAWN spectrum only, independent of the −90..−22 sync scale.
 *
 * Ceiling −8 dBFS: −22 (the sync/beat ceiling) pins every band to full on a
 * loud master (a −7 LUFS track's bass sits well above −22), so drawn bars read
 * as clipped. −8 gives headroom so only a genuine peak tops out.
 *
 * Floor −80 dBFS (vs the −90 sync floor): most musical content sits well above
 * −90, so mapping from −90 crowds every audible band into the top of the range
 * where they all look the same height — "mush". Lifting the floor to −80 drops
 * the near-silent bins toward zero and spreads the rest across the full height.
 *
 * Gamma 1.3 EXPANDS contrast (x^1.3 < x for x in 0..1): it pulls the mid bins
 * down relative to the peaks, so the spectrum reads as clear spikes over low
 * bars instead of a flat wall. (The old 0.8 lifted mids toward the ceiling,
 * which is what made the bars bunch together.) >1 also can't re-clip: it only
 * ever lowers a value, so a loud master stays dynamic rather than maxing out.
 */
export const DISPLAY_MAX_DB = -8;
export const DISPLAY_MIN_DB = -80;
const DISPLAY_GAMMA = 1.3;

/**
 * Adaptive beat threshold windows, in SECONDS (not frames) so detection is
 * frame-rate independent — a 30 fps export must fire beats on the same track
 * moments as a 60 fps preview (WYSIWYG). The values equal the old 60 fps
 * frame counts (43 and 12 frames), so 60 fps behaviour is unchanged.
 */
const FLUX_WINDOW_SEC = 43 / 60; // ~0.717 s of flux history for the mean
const WARMUP_SEC = 12 / 60; // ~0.2 s before the detector may fire
/** Flux-history ring size for the current frame interval. */
function fluxWindowFrames(dt: number): number {
  return Math.max(4, Math.round(FLUX_WINDOW_SEC / Math.max(1e-4, dt)));
}
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
  /** Raw stereo width for this frame (undefined = keep previous). */
  width?: number;
  /** Momentary LUFS for this frame (undefined = keep previous). */
  lufs?: number;
  /** Beat-grid readouts for this frame (undefined = keep previous). */
  bpm?: number;
  beatPhase?: number;
  barPhase?: number;
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
  /** Same magnitudes as `mag`, but on the DISPLAY scale (more headroom): the
   * drawn spectrum only. `mag` (the −22 dBFS ceiling) still drives bands,
   * flux and beats, so sync feel is unchanged by the display headroom. */
  private magDisp: Float32Array;
  private prevMag: Float32Array;
  /** [start, end) FFT-bin range per output bin, geometrically spaced */
  private ranges: Array<[number, number]>;
  private bassRange: [number, number];
  private midRange: [number, number];
  private trebleRange: [number, number];
  private voiceRange: [number, number];
  private kickRange: [number, number];
  private snareRange: [number, number];
  private hatRange: [number, number];

  private fluxHistory: number[] = [];
  private lastBeatAt = -Infinity;
  private clock = 0;

  // Onset-class detectors: independent flux trackers per drum band
  private kickDet = new OnsetClassDetector();
  private snareDet = new OnsetClassDetector();
  private hatDet = new OnsetClassDetector();

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
    this.magDisp = new Float32Array(fftBins);
    this.prevMag = new Float32Array(fftBins);

    const nyquist = config.sampleRate / 2;
    const hzPerBin = nyquist / fftBins;
    const toBin = (hz: number) => Math.max(0, Math.min(fftBins - 1, Math.round(hz / hzPerBin)));

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
    this.kickRange = [toBin(40), toBin(120)];
    this.snareRange = [toBin(180), toBin(2500)];
    this.hatRange = [toBin(5000), toBin(15000)];

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
      width: 0,
      lufs: -70,
      kick: 0,
      snare: 0,
      hat: 0,
      bpm: 0,
      beatPhase: 0,
      barPhase: 0,
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

    // dB -> 0..1 magnitudes. `mag` keeps the −22 dBFS ceiling (bands, flux,
    // beats); `magDisp` uses the display ceiling + gamma (the drawn bars only).
    const mag = this.mag;
    const magDisp = this.magDisp;
    const dispRange = DISPLAY_MAX_DB - DISPLAY_MIN_DB;
    for (let i = 0; i < mag.length; i++) {
      const db = input.magDb[i];
      if (db === -Infinity) {
        mag[i] = 0;
        magDisp[i] = 0;
      } else {
        mag[i] = clamp01((db - MIN_DB) / (MAX_DB - MIN_DB));
        magDisp[i] = Math.pow(clamp01((db - DISPLAY_MIN_DB) / dispRange), DISPLAY_GAMMA);
      }
    }

    // Log-spaced bins with asymmetric EMA + peak hold with gravity. Built from
    // magDisp so a loud master doesn't slam every bar to the ceiling.
    const attack = 1 - Math.exp(-dt * 35);
    const release = 1 - Math.exp(-dt * 9);
    const gravity = 0.55 * dt;
    for (let i = 0; i < this.binCount; i++) {
      const [b0, b1] = this.ranges[i];
      let v = 0;
      for (let b = b0; b < b1; b++) v = Math.max(v, magDisp[b]);
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
    const win = fluxWindowFrames(dt);
    while (this.fluxHistory.length > win) this.fluxHistory.shift();
    const mean = this.fluxHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.fluxHistory.length);

    f.beat = false;
    if (
      this.clock >= WARMUP_SEC &&
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

    f.kick = this.kickDet.update(mag, this.prevMag, this.kickRange, dt, this.clock, input.playing);
    f.snare = this.snareDet.update(
      mag,
      this.prevMag,
      this.snareRange,
      dt,
      this.clock,
      input.playing,
    );
    f.hat = this.hatDet.update(mag, this.prevMag, this.hatRange, dt, this.clock, input.playing);

    this.updateSync(f, mag, dt, input.playing);
    // Both onset detectors diff against the previous frame — update it last
    this.prevMag.set(mag);

    if (input.width !== undefined) {
      // Smooth like the bins: widths jump frame to frame, visuals shouldn't
      f.width += (input.width - f.width) * (1 - Math.exp(-dt * 8));
    }
    if (input.lufs !== undefined) f.lufs = input.lufs;
    if (input.bpm !== undefined) f.bpm = input.bpm;
    if (input.beatPhase !== undefined) f.beatPhase = input.beatPhase;
    if (input.barPhase !== undefined) f.barPhase = input.barPhase;

    f.time = input.time;
    f.duration = input.duration;
    return f;
  }

  /** Choose what the visuals follow. Safe to call any time, with any input —
   * malformed settings are coerced rather than allowed to NaN the drive EMA. */
  setSync(sync: SyncSettings): void {
    const safe = sanitizeSync(sync);
    if (safe.mode !== this.sync.mode) {
      this.syncFluxHistory.length = 0;
      this.syncBeatIntensity = 0;
    }
    this.sync = safe;
  }

  private syncBand(mode: SyncMode): [number, number] {
    switch (mode) {
      case "melody":
        return this.midRange;
      case "voice":
        return this.voiceRange;
      case "treble":
        return this.trebleRange;
      case "snare":
        return this.snareRange;
      case "hats":
        return this.hatRange;
      default:
        return this.bassRange; // energy/bass/kick pulse on the low end
    }
  }

  private updateSync(f: AudioFeatures, mag: Float32Array, dt: number, playing: boolean): void {
    const { mode, smooth } = this.sync;
    // Attack/Release fall back to the overall smoothing macro when unset, so
    // existing projects behave identically. Both are 0 (instant) .. 1 (slow).
    const atkK = this.sync.attack ?? smooth;
    const relK = this.sync.release ?? smooth;

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
      case "snare":
        raw = f.snare;
        break;
      case "hats":
        raw = f.hat;
        break;
      case "kick":
      case "energy":
      default:
        raw = f.energy;
        break;
    }

    // Smoothing: 0 = snappy, 1 = long glide. Attack (rise) and release (fall)
    // can be tuned independently — e.g. fast attack + slow release for punchy
    // hits that ease out.
    const attack = 1 - Math.exp(-dt * (30 - atkK * 26));
    const release = 1 - Math.exp(-dt * (10 - relK * 8.5));
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
    const win = fluxWindowFrames(dt);
    while (this.syncFluxHistory.length > win) this.syncFluxHistory.shift();
    const mean =
      this.syncFluxHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.syncFluxHistory.length);

    if (
      this.clock >= WARMUP_SEC &&
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

/**
 * One drum-band onset detector: positive spectral flux over a band with an
 * adaptive threshold (like the main beat detector, tighter refractory), and
 * a decaying 0..1 pulse envelope as output. Deterministic.
 */
class OnsetClassDetector {
  private history: number[] = [];
  private lastAt = -Infinity;
  private envelope = 0;

  update(
    mag: Float32Array,
    prevMag: Float32Array,
    [lo, hi]: [number, number],
    dt: number,
    clock: number,
    playing: boolean,
  ): number {
    let flux = 0;
    for (let b = lo; b < hi; b++) {
      const d = mag[b] - prevMag[b];
      if (d > 0) flux += d;
    }
    this.history.push(flux);
    const win = fluxWindowFrames(dt);
    while (this.history.length > win) this.history.shift();
    const mean = this.history.reduce((a, b) => a + b, 0) / Math.max(1, this.history.length);

    if (playing && clock >= WARMUP_SEC && flux > mean * 1.7 + 0.01 && clock - this.lastAt > 0.06) {
      this.lastAt = clock;
      this.envelope = 1;
    } else {
      this.envelope *= Math.exp(-dt * 10);
    }
    return this.envelope;
  }
}
