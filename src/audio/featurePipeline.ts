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
/**
 * How long a freshly-built pipeline stays silent before any detector may fire.
 * Exported so the offline path can PRE-ROLL exactly this much: without it the
 * first ~0.2 s of every export has no beat/kick/snare/hat while the live
 * preview — whose pipeline has been running for minutes — fires them at the
 * same track moment.
 */
export const WARMUP_SEC = 12 / 60; // ~0.2 s before the detector may fire

/**
 * Length of the time-domain waveform handed to the renderer, in samples.
 *
 * A FIXED count, deliberately not derived from the FFT size. It used to be
 * `fftSize * 3/4`, which looks harmless because the renderer downsamples the
 * waveform to a fixed 512 points anyway — but it does so by CHUNK MEAN, and
 * the chunk width is `length / 512`. Tie the length to the FFT size and any
 * change to the transform silently changes how much averaging the trace gets:
 * at 4096 the chunk is 6 samples, at 8192 it is 12, and the oscilloscope
 * visibly smooths out and loses amplitude without anything in the drawing code
 * having changed.
 *
 * 3072 is exactly what a 4096-point transform produced, so this is a no-op
 * today and stays a no-op when the FFT size becomes sample-rate aware.
 *
 * The remaining constraint is `WAVEFORM_LENGTH < fftSize`: the difference is
 * the search headroom the zero-crossing trigger needs (see `update`). Growing
 * the FFT only grows that headroom, and the trigger takes the FIRST rising
 * crossing, whose index does not move when there is more room to look.
 */
export const WAVEFORM_LENGTH = 3072;

/**
 * Onset detection runs at a FIXED cadence, independent of the rendered frame
 * rate. Continuous features (bins, peaks, bands, drive, envelopes) still update
 * every frame, so a 144 Hz display stays as smooth as it ever was.
 *
 * Spectral flux is a rectified frame-to-frame difference and is not band
 * limited: sampling it more often does not merely refine it, it makes every
 * extra frame another independent chance to cross the adaptive threshold. On
 * three real tracks the same 60 s of music produced 170 beats at 30 fps and
 * 299 at 144 — a project reacting ~75% more on a high-refresh display than in
 * its own export.
 *
 * The crossing probability PER FRAME is what stays constant (~15% at every
 * rate; flux/mean averages 0.99-1.04), which is why no local fix works. Two
 * cheaper candidates were measured and rejected: diffing against a fixed
 * 16.7 ms lag gave 277, causal peak-picking gave 287, against 299 shipping.
 * Neither removes trials, and trials are the problem.
 *
 * 60 Hz because that is what the golden trace and every existing project were
 * built at, so a 60 fps render is bit-identical.
 */
export const ANALYSIS_HZ = 60;
export const ANALYSIS_DT = 1 / ANALYSIS_HZ;

/**
 * Upper edge of the band the main beat detector measures flux over.
 *
 * Was written as `midRange[0] + 8`, i.e. eight FFT BINS above 150 Hz — and a
 * bin is not a fixed number of hertz. At 48 kHz/4096 that landed on bin 21
 * (~246 Hz); at 44.1 kHz the same expression reached bin 22 (~237 Hz). Nobody
 * chose that difference; it was a unit mismatch. 245 Hz reproduces bin 21
 * exactly at 48 kHz/4096, so the reference configuration is unchanged.
 */
const FLUX_HI_HZ = 245;

/**
 * Bins-per-hertz of the reference configuration (48 kHz, 4096-point).
 *
 * The detectors' flux is a SUM over the bins in a band, so its magnitude scales
 * with how many bins that band contains, while their absolute floors do not.
 * Normalising the floors by the ratio below keeps a floor meaning the same
 * thing on any transform — the same class of unit bug as the dt scaling, on the
 * other axis. Exactly 1.0 at the reference, so 48 kHz behaviour is untouched.
 *
 * Note this ratio stays 1.0 when the FFT size tracks the sample rate, since
 * holding the window duration constant holds bins-per-hertz constant. It earns
 * its keep at rates where the window cannot be held exactly — 44.1 kHz today.
 */
const REF_BINS_PER_HZ = 2048 / 24000;
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
  /**
   * Whether the ONSET DETECTORS should step this frame. Continuous features
   * update regardless. Callers drive this from a fixed ANALYSIS_DT clock; the
   * default keeps direct callers (and tests) on the old one-per-frame
   * behaviour, which at 60 fps is the same thing.
   */
  analysisTick?: boolean;
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
  private binScratch: Float32Array;
  private binScratch2: Float32Array;
  private prevMag: Float32Array;
  /** [start, end) FFT-bin edges per output bin, geometrically spaced and
   * FRACTIONAL. Integer edges used to be forced at least one bin wide, which
   * made every display band below ~40 Hz read the SAME FFT bin — five bars of
   * identical height, reported as "the bass line is very wide". Keeping the
   * edges fractional lets `bandLevel` interpolate a sub-bin band instead of
   * duplicating its neighbour. */
  private ranges: Array<[number, number]>;
  /** Hz covered by one FFT bin — the interpolation needs it alongside `ranges`. */
  private hzPerBin: number;
  /** Analysed span the current `ranges` were built for, so `setSync` only
   * rebuilds when the user actually moves the range. */
  private rangeSpan: [number, number] = [MIN_FREQ, MAX_FREQ];
  private bassRange: [number, number];
  private midRange: [number, number];
  private trebleRange: [number, number];
  private voiceRange: [number, number];
  private kickRange: [number, number];
  private snareRange: [number, number];
  private hatRange: [number, number];
  /** Upper FFT bin of the main beat detector's flux band (FLUX_HI_HZ). */
  private fluxHiBin: number;

  /** Scales every detector's absolute flux floor — see REF_BINS_PER_HZ. */
  private floorScale: number;

  private fluxHistory: number[] = [];
  private lastBeatAt = -Infinity;
  private clock = 0;
  /** Set by reset(): the next frame adopts its own spectrum as the reference
   * and fires no detector. See reset() for why zeroing prevMag is not an
   * option. */
  private priming = false;

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
    this.binScratch = new Float32Array(this.binCount);
    this.binScratch2 = new Float32Array(this.binCount);
    this.prevMag = new Float32Array(fftBins);

    const nyquist = config.sampleRate / 2;
    const hzPerBin = nyquist / fftBins;
    this.hzPerBin = hzPerBin;
    this.floorScale = fftBins / nyquist / REF_BINS_PER_HZ;
    const toBin = (hz: number) => Math.max(0, Math.min(fftBins - 1, Math.round(hz / hzPerBin)));

    this.ranges = this.buildRanges(MIN_FREQ, MAX_FREQ);
    this.bassRange = [toBin(30), toBin(150)];
    this.midRange = [toBin(150), toBin(2000)];
    this.trebleRange = [toBin(2000), toBin(16000)];
    this.voiceRange = [toBin(300), toBin(3400)];
    this.kickRange = [toBin(40), toBin(120)];
    this.snareRange = [toBin(180), toBin(2500)];
    this.hatRange = [toBin(5000), toBin(15000)];
    this.fluxHiBin = toBin(FLUX_HI_HZ);

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

  /**
   * Geometric (constant-ratio) frequency edges for the drawn spectrum,
   * expressed in FRACTIONAL FFT-bin space. Equal ratio per band is what makes
   * a musical octave occupy the same width everywhere, so the bars can then be
   * plotted at equal pixel width.
   */
  private buildRanges(freqMin: number, freqMax: number): Array<[number, number]> {
    // Remember what was ASKED for, not what survives clamping: `setSync`
    // compares against this to decide whether to rebuild, and storing the
    // clamped value would make every later call look like a change.
    this.rangeSpan = [freqMin, freqMax];
    // Nothing above Nyquist exists in the transform, and asking for it would
    // spend bands on bins that are always zero — a 22 kHz ceiling on a
    // 44.1 kHz track is a real user setting, so clamp rather than trust it.
    const nyquist = this.hzPerBin * this.mag.length;
    const hi = Math.min(freqMax, nyquist * 0.99);
    const lo = Math.min(freqMin, hi / 2);
    const ratio = hi / lo;
    const out: Array<[number, number]> = [];
    for (let i = 0; i < this.binCount; i++) {
      const f0 = lo * Math.pow(ratio, i / this.binCount);
      const f1 = lo * Math.pow(ratio, (i + 1) / this.binCount);
      out.push([f0 / this.hzPerBin, f1 / this.hzPerBin]);
    }
    return out;
  }

  /** The spectrum at a FRACTIONAL bin position, linearly interpolated. */
  private binAt(src: Float32Array, x: number): number {
    // Bin 0 is the DC term: a file with any DC offset would otherwise light
    // the lowest bar permanently once the low edge is dragged near 10 Hz.
    const c = Math.max(1, Math.min(src.length - 1, x));
    const i0 = Math.floor(c);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const t = c - i0;
    return (src[i0] ?? 0) * (1 - t) + (src[i1] ?? 0) * t;
  }

  /**
   * Level of one display band from fractional FFT-bin edges.
   *
   * ONE rule for every width, because two rules had two bugs. The band's own
   * edges are always sampled by interpolation — that is what resolves a band
   * NARROWER than one FFT bin (every band below ~40 Hz at 4096-point/48 kHz,
   * where a bin spans 11.7 Hz), which is what turned the bass into the flat,
   * over-wide block users reported. The whole bins strictly inside the band
   * then contribute their PEAK, because peaks are what reads musically.
   *
   * Interiors are half-open `[ceil(x0), ceil(x1))` so consecutive bands tile
   * the axis exactly: the earlier `floor(x1)` end left the bin containing a
   * fractional boundary in NEITHER band, silently dropping 61 of the 1364
   * bins in the default span — a tone landing in one read barely a third of
   * its true height. Sampling the edges also makes the value continuous as a
   * band grows through one bin wide, instead of jumping between two rules.
   */
  private bandLevel(src: Float32Array, x0: number, x1: number): number {
    let v = Math.max(this.binAt(src, x0), this.binAt(src, x1));
    const last = Math.ceil(x1);
    for (let b = Math.ceil(x0); b < last; b++) v = Math.max(v, src[b] ?? 0);
    return v;
  }

  update(input: PipelineInput): AudioFeatures {
    const f = this.features;
    const dt = Math.min(0.1, Math.max(0.0001, input.dt));
    // The detector clock advances on ANALYSIS ticks only, by ANALYSIS_DT. It is
    // what the warmup gate and every refractory are measured against, so it has
    // to track real time no matter how many times update() is called per
    // rendered frame — a 30 fps render calls it twice, and advancing by the
    // render dt each time ran it at double speed, expiring refractories early
    // and firing 305 beats where 60 fps found 228. At 60 fps ANALYSIS_DT is the
    // frame interval, so this is unchanged there.
    if (input.analysisTick ?? true) this.clock += ANALYSIS_DT;

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

    // A primed frame compares against ITSELF, so every band's delta is exactly
    // zero and no detector can fire on a discontinuity it did not hear. The
    // frame after this one measures a true single-frame delta again.
    if (this.priming) {
      this.prevMag.set(mag);
      this.priming = false;
    }

    // Log-spaced bins with asymmetric EMA + peak hold with gravity. Built from
    // magDisp so a loud master doesn't slam every bar to the ceiling.
    const attack = 1 - Math.exp(-dt * 35);
    const release = 1 - Math.exp(-dt * 9);
    const gravity = 0.55 * dt;
    const raw = this.binScratch;
    for (let i = 0; i < this.binCount; i++) {
      const [b0, b1] = this.ranges[i];
      raw[i] = this.bandLevel(magDisp, b0, b1);
    }

    // --- Spectrum SHAPE (drawn bins only; sync/bands read `mag`, untouched).
    // Applied to the instantaneous frame BEFORE the temporal EMA, so attack/
    // release feel is preserved and the peak caps ride the shaped curve.
    // All three default to a no-op — the neutral path is byte-identical.
    const n = this.binCount;
    // 1) Merge (Monstercat): two sweeps with an exponential falloff — each
    //    bar lifts its neighbors, melting isolated spikes into one shape.
    const merge = this.sync.shapeMerge ?? 0;
    if (merge > 0) {
      const k = 0.5 + merge * 0.47; // 0.5 (subtle) .. 0.97 (one mountain)
      let run = 0;
      for (let i = 0; i < n; i++) {
        run = Math.max(raw[i], run * k);
        raw[i] = run;
      }
      run = 0;
      for (let i = n - 1; i >= 0; i--) {
        run = Math.max(raw[i], run * k);
        raw[i] = run;
      }
    }
    // 2) Rounding: box blur, two passes ≈ triangular kernel. Real smoothing —
    //    the WGSL spline only interpolates BETWEEN values and keeps spikes.
    const round = this.sync.shapeRound ?? 0;
    if (round > 0) {
      const radius = Math.max(1, Math.round(round * 4));
      const tmp = this.binScratch2;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          let acc = 0;
          let cnt = 0;
          const lo = Math.max(0, i - radius);
          const hi = Math.min(n - 1, i + radius);
          for (let j = lo; j <= hi; j++) {
            acc += raw[j];
            cnt++;
          }
          tmp[i] = acc / cnt;
        }
        raw.set(tmp.subarray(0, n));
      }
    }
    // 3) Contrast: extra display gamma around the current baseline. 0.5 is
    //    exactly today's look; lower flattens (fuller bars), higher spikes.
    const contrast = this.sync.contrast ?? 0.5;
    if (contrast !== 0.5) {
      const g = Math.pow(2, (contrast - 0.5) * 1.7); // ~0.55x .. ~1.8x gamma
      for (let i = 0; i < n; i++) raw[i] = Math.pow(raw[i], g);
    }

    for (let i = 0; i < this.binCount; i++) {
      const v = raw[i];
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

    // Onset detection steps on the FIXED analysis clock; everything above
    // this point ran for the rendered frame. See ANALYSIS_HZ.
    const tick = input.analysisTick ?? true;
    const adt = ANALYSIS_DT;

    f.beat = false;
    if (tick) {
      // Spectral flux over the low end (kick/snare live here), adaptive threshold
      let flux = 0;
      const [lo, hi] = [this.bassRange[0], this.fluxHiBin];
      for (let b = lo; b < hi; b++) {
        const d = mag[b] - this.prevMag[b];
        if (d > 0) flux += d;
      }
      this.fluxHistory.push(flux);
      const win = fluxWindowFrames(adt);
      while (this.fluxHistory.length > win) this.fluxHistory.shift();
      const mean =
        this.fluxHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.fluxHistory.length);

      if (
        this.clock >= WARMUP_SEC &&
        flux > mean * 1.6 + 0.012 * this.floorScale &&
        this.clock - this.lastBeatAt > BEAT_REFRACTORY &&
        input.playing
      ) {
        f.beat = true;
        this.lastBeatAt = this.clock;
        f.beatIntensity = 1;
      }
    }
    // The pulse envelope decays on the RENDER clock so it stays smooth between
    // ticks on a high-refresh display.
    if (tick && !f.beat) f.beatIntensity *= Math.exp(-ANALYSIS_DT * BEAT_DECAY);

    f.voice = bandMean(mag, this.voiceRange);

    f.kick = this.kickDet.update(
      tick,
      mag,
      this.prevMag,
      this.kickRange,
      dt,
      this.clock,
      input.playing,
      this.floorScale,
    );
    f.snare = this.snareDet.update(
      tick,
      mag,
      this.prevMag,
      this.snareRange,
      dt,
      this.clock,
      input.playing,
      this.floorScale,
    );
    f.hat = this.hatDet.update(
      tick,
      mag,
      this.prevMag,
      this.hatRange,
      dt,
      this.clock,
      input.playing,
      this.floorScale,
    );

    this.updateSync(f, mag, dt, input.playing, tick);
    // prevMag is the reference for the NEXT tick, so it only advances on a
    // tick — otherwise a held frame would zero the next tick's flux.
    if (tick) this.prevMag.set(mag);

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

  /**
   * Tell the pipeline the audio it is about to see is not a continuation of
   * the audio it has been seeing.
   *
   * Without this, the first update after a seek diffs the NEW position's
   * spectrum against `prevMag` from the OLD one. That difference is arbitrary
   * and usually large, so scrubbing fired a phantom beat, kick, snare or hat
   * on the frame after almost every seek.
   *
   * The obvious fix — zero `prevMag` — is worse than the bug: flux is the sum
   * of POSITIVE bin deltas, so diffing against zeros yields the largest flux
   * the detector can ever see and fires on every band at once. Instead the
   * next frame PRIMES: it adopts that frame's own spectrum as the reference
   * and fires nothing, so the frame after it measures a true one-frame delta.
   *
   * `kind` matters, and the difference is deliberate:
   *
   *   "seek"   — same track, new time. Detector history and refractories are
   *              discarded (they describe a moment that is no longer adjacent)
   *              but the smoothed bins, peak caps and drive envelope are KEPT.
   *              Clearing those collapses the spectrum to zero and ramps it
   *              back, which reads as a visible flash on every scrub. The
   *              clock is kept too: restarting it would re-arm WARMUP_SEC and
   *              leave the visuals beat-blind for ~0.2 s after every drag.
   *
   *   "source" — different audio entirely (track load, entering or leaving
   *              live input). That IS a hard cut, so everything goes, warmup
   *              included.
   */
  reset(kind: "seek" | "source"): void {
    this.priming = true;
    this.fluxHistory.length = 0;
    this.syncFluxHistory.length = 0;
    this.lastBeatAt = -Infinity;
    this.lastSyncBeatAt = -Infinity;
    this.kickDet.reset();
    this.snareDet.reset();
    this.hatDet.reset();
    if (kind === "source") {
      this.clock = 0;
      this.features.bins.fill(0);
      this.features.peaks.fill(0);
      this.features.beatIntensity = 0;
      this.features.kick = 0;
      this.features.snare = 0;
      this.features.hat = 0;
      this.features.driveBeat = 0;
      this.features.drive = 0;
      this.features.energy = 0;
      this.features.rms = 0;
      this.driveValue = 0;
      this.syncBeatIntensity = 0;
    }
  }

  /**
   * The band the main beat detector measures flux over, in HERTZ.
   *
   * Exposed because it is the only way to check the property that matters:
   * this band must describe the same frequencies on every transform. It was
   * previously specified in FFT bins, which silently made it sample-rate
   * dependent, and no test could see that from the outside.
   */
  /**
   * Multiplier applied to every detector's absolute flux floor.
   *
   * Exposed for the same reason as `fluxBandHz`: its effect is a fraction of a
   * threshold and does not flip a detection on any material measured, so the
   * only way to guard it is to assert the number. The load-bearing property is
   * that it is EXACTLY 1.0 at the reference configuration — that is what keeps
   * 48 kHz behaviour, and the golden trace, bit-identical.
   */
  get absoluteFloorScale(): number {
    return this.floorScale;
  }

  get fluxBandHz(): [number, number] {
    return [this.bassRange[0] * this.hzPerBin, this.fluxHiBin * this.hzPerBin];
  }

  /** Choose what the visuals follow. Safe to call any time, with any input —
   * malformed settings are coerced rather than allowed to NaN the drive EMA. */
  setSync(sync: SyncSettings): void {
    const safe = sanitizeSync(sync);
    if (safe.mode !== this.sync.mode) {
      this.syncFluxHistory.length = 0;
      this.syncBeatIntensity = 0;
    }
    // The analysed span is a user setting, so the geometric edges have to be
    // rebuilt when it moves — but only then: this runs on every settings
    // change, and rebuilding 96 bands per frame would be pure waste.
    const freqMin = safe.freqMin ?? MIN_FREQ;
    const freqMax = safe.freqMax ?? MAX_FREQ;
    if (freqMin !== this.rangeSpan[0] || freqMax !== this.rangeSpan[1]) {
      this.ranges = this.buildRanges(freqMin, freqMax);
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

  private updateSync(
    f: AudioFeatures,
    mag: Float32Array,
    dt: number,
    playing: boolean,
    tick: boolean,
  ): void {
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

    // Onset pulse over the selected band. The FIRING decision steps on the
    // fixed analysis clock; the envelope decays on the render clock so it stays
    // smooth between ticks.
    let fired = false;
    if (tick) {
      const [lo, hi] = this.syncBand(mode);
      let flux = 0;
      for (let b = lo; b < hi; b++) {
        const d = mag[b] - this.prevMag[b];
        if (d > 0) flux += d;
      }
      this.syncFluxHistory.push(flux);
      const win = fluxWindowFrames(ANALYSIS_DT);
      while (this.syncFluxHistory.length > win) this.syncFluxHistory.shift();
      const mean =
        this.syncFluxHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.syncFluxHistory.length);

      if (
        this.clock >= WARMUP_SEC &&
        flux > mean * 1.6 + 0.012 * this.floorScale &&
        this.clock - this.lastSyncBeatAt > BEAT_REFRACTORY &&
        playing
      ) {
        this.lastSyncBeatAt = this.clock;
        this.syncBeatIntensity = 1;
        fired = true;
      }
    }
    if (tick && !fired) this.syncBeatIntensity *= Math.exp(-ANALYSIS_DT * BEAT_DECAY);
    f.driveBeat = this.syncBeatIntensity;
  }
}

function clamp01(v: number): number {
  // NaN fails both comparisons and used to fall through UNclamped (audit
  // A7): a NaN sample from a malformed fallback decode would flow into
  // rms/bands and stick in every EMA downstream. NaN now clamps to 0.
  return v > 0 ? (v > 1 ? 1 : v) : 0;
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

  /** Drop the adaptive-threshold history and refractory. The envelope is left
   * to decay on its own — cutting it to zero mid-pulse is a visible pop, and
   * it dies within ~100 ms anyway. */
  reset(): void {
    this.history.length = 0;
    this.lastAt = -Infinity;
  }

  update(
    tick: boolean,
    mag: Float32Array,
    prevMag: Float32Array,
    [lo, hi]: [number, number],
    dt: number,
    clock: number,
    playing: boolean,
    floorScale: number,
  ): number {
    let fired = false;
    if (tick) {
      let flux = 0;
      for (let b = lo; b < hi; b++) {
        const d = mag[b] - prevMag[b];
        if (d > 0) flux += d;
      }
      this.history.push(flux);
      const win = fluxWindowFrames(dt);
      while (this.history.length > win) this.history.shift();
      const mean = this.history.reduce((a, b) => a + b, 0) / Math.max(1, this.history.length);

      if (
        playing &&
        clock >= WARMUP_SEC &&
        flux > mean * 1.7 + 0.01 * floorScale &&
        clock - this.lastAt > 0.06
      ) {
        this.lastAt = clock;
        this.envelope = 1;
        fired = true;
      }
    }
    // Decays on the ANALYSIS clock, like every other time-based detector
    // quantity, so it advances at the same rate however often update() is
    // called per rendered frame.
    if (tick && !fired) this.envelope *= Math.exp(-ANALYSIS_DT * 10);
    return this.envelope;
  }
}
