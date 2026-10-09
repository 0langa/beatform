import type { AudioEngine } from "./engine";
import type { AudioFeatures, SyncSettings } from "./types";
import { sanitizeSync } from "./types";
import { ANALYSIS_DT, FeaturePipeline, WAVEFORM_LENGTH } from "./featurePipeline";
import { RealFFT } from "./dsp/fft";
import { LoudnessMeter } from "./dsp/lufs";
import { stereoWidth } from "./dsp/stereo";
import { gridPhase, type BeatGrid } from "./analysis/beatGrid";
import { sectionStateAt } from "./analysis/sections";
import { vocalPresenceAt, type VocalSpan } from "./vocalPresence";
import { displaySpectrumFftSize, spectrumResolution } from "./dsp/displaySpectrum";

/**
 * Live-input silence gate, in dBFS PEAK over one analysis window.
 *
 * Only the live path has one, and only because only the live path needs one.
 * A muted or idle output device is not guaranteed to hand back digital zeros:
 * driver APOs and "audio enhancements" inject dither or mains hum, and exact
 * zeros are the one input the chain provably renders flat. Everything above
 * them it AMPLIFIES — the sync scale bottoms out at -90 dBFS, bandMean
 * multiplies by 1.6, attack is four times faster than release so every wiggle
 * reads as a pulse, and the flux detectors' absolute floors are low enough that
 * stationary noise crosses them by chance. That is the reported "pumping and
 * spikes with nothing playing" (BUG-002), and it is a floor problem, not a
 * detector problem.
 *
 * -60 dBFS peak is about 25 dB SPL at a normal listening level — under the
 * noise floor of a quiet room, and far under anything a user would call system
 * audio. Real programme material never sits there while audible. The 6 dB of
 * hysteresis plus the hold stop a floor that hovers near the line from
 * chattering the gate open and shut, which would look worse than the bug.
 *
 * Track playback is deliberately NOT gated: its export path has no gate, so a
 * hard nonlinearity on one side would add an avoidable preview/export
 * divergence. Live capture has no export counterpart and can afford one.
 */
const GATE_OPEN = Math.pow(10, -60 / 20);
const GATE_CLOSE = Math.pow(10, -66 / 20);
const GATE_HOLD_SEC = 0.35;

/**
 * Presentation ring depth, in update() calls. 64 covers ~1 s at 60 Hz and
 * ~440 ms at 144 Hz — more than the output latency plus the ±250 ms the A/V
 * offset preference allows. Each entry holds one AudioFeatures clone (~38 KB,
 * the three waveform lanes dominate), so the ring tops out near 2.5 MB.
 */
const RING_MAX = 64;

/** A structural copy of a features frame with its own arrays. */
function cloneFeatures(src: AudioFeatures): AudioFeatures {
  return {
    ...src,
    bins: new Float32Array(src.bins),
    peaks: new Float32Array(src.peaks),
    waveform: new Float32Array(src.waveform),
    waveformL: new Float32Array(src.waveformL),
    waveformR: new Float32Array(src.waveformR),
    ...(src.chroma ? { chroma: new Float32Array(src.chroma) } : {}),
  };
}

/** Copy an array feature, reallocating when a layout change resized it
 * (measured spectrum mode replaces `bins`/`peaks` with a shorter array). */
function setArr(dst: Float32Array, src: Float32Array): Float32Array {
  const d = dst.length === src.length ? dst : new Float32Array(src.length);
  d.set(src);
  return d;
}

/**
 * Copy every TAP-derived field (what the analyser measured on the audio) —
 * never the time-derived ones (time, grid, sections, lyrics), which
 * `present()` resolves for the frame being shown.
 */
function copyTapFields(dst: AudioFeatures, src: AudioFeatures): void {
  dst.bins = setArr(dst.bins, src.bins);
  dst.peaks = setArr(dst.peaks, src.peaks);
  dst.waveform = setArr(dst.waveform, src.waveform);
  dst.waveformL = setArr(dst.waveformL, src.waveformL);
  dst.waveformR = setArr(dst.waveformR, src.waveformR);
  if (src.chroma) dst.chroma = setArr(dst.chroma ?? new Float32Array(12), src.chroma);
  dst.rms = src.rms;
  dst.energy = src.energy;
  dst.voice = src.voice;
  dst.drive = src.drive;
  dst.driveBeat = src.driveBeat;
  dst.bass = src.bass;
  dst.mid = src.mid;
  dst.treble = src.treble;
  dst.width = src.width;
  dst.lufs = src.lufs;
  dst.kick = src.kick;
  dst.snare = src.snare;
  dst.hat = src.hat;
  dst.beat = src.beat;
  dst.beatIntensity = src.beatIntensity;
}

/**
 * Realtime analysis source: pulls the most recent fftSize time-domain samples
 * from the AnalyserNode each animation frame and runs the SAME RealFFT (Hann
 * window) the offline export path uses. Counterpart of OfflineAnalyzer.
 *
 * The AnalyserNode is used only as a time-domain tap — not for its frequency
 * data. Its Blackman window and native smoothingTimeConstant would make live
 * spectra differ from offline ones; doing the FFT ourselves keeps
 * Hann/FFT/bin math shared with export. Sample acquisition and frame timing
 * remain distinct (device-timed live tap versus indexed offline windows).
 */
export class RealtimeAnalyzer {
  private engine: AudioEngine;
  private pipeline: FeaturePipeline;
  private fft: RealFFT;
  private magDb: Float32Array;
  /** Optional long transform for drawn bins only. Null on legacy/default path. */
  private displayFft: RealFFT | null = null;
  private displayMagDb: Float32Array | null = null;
  private displayTimeData: Float32Array<ArrayBuffer> | null = null;
  private displayFftSize: number;
  private displayReady = false;
  // Pinned to <ArrayBuffer>, not the default <ArrayBufferLike>. These are
  // allocated below with a plain ArrayBuffer, and the Web Audio analyser
  // signatures require exactly that — ArrayBufferLike also admits
  // SharedArrayBuffer, which cannot back an analyser destination. Bare
  // Float32Array widens to ArrayBufferLike and fails to assign, which the
  // pinned TypeScript happens not to surface but a newer one does. Declaring
  // the truth here keeps the narrowing at the allocation site instead of
  // scattering casts across every getFloatTimeDomainData call.
  private timeData: Float32Array<ArrayBuffer>;
  private timeL: Float32Array<ArrayBuffer>;
  private timeR: Float32Array<ArrayBuffer>;
  private meter: LoudnessMeter;
  private grid: BeatGrid | null = null;
  /** Detected section boundaries (null = no analysis yet). */
  private sections: number[] | null = null;
  /** Timed-lyrics sung spans (null = no timed lyrics loaded). */
  private vocalSpans: VocalSpan[] | null = null;
  private lastFrameAt: number | null = null;
  /**
   * Time owed to the fixed analysis clock, seconds. Onset detection steps once
   * per ANALYSIS_DT of real time rather than once per animation frame, so a
   * 144 Hz display gets the same number of chances to fire as the 60 fps export
   * of the same project. See ANALYSIS_HZ in featurePipeline.
   */
  private sinceTick = 0;
  private lastUpdateTicked = false;
  /** Live-input silence gate: open = the capture is carrying real audio. */
  private gateOpen = false;
  private gateHold = 0;
  /** Handed to the pipeline in place of the tap while the gate is shut. */
  private silence: Float32Array;
  /**
   * The frame the visuals PRESENT — see `present()`. Its tap-derived fields
   * come from the snapshot ring delayed by the caller's presentation lag; its
   * time-derived fields are always this frame's.
   */
  private presented: AudioFeatures;
  /** Ring of recent pipeline frames (tap-derived fields only matter), each
   * stamped with the wall-clock `now` it was analysed at. */
  private ring: Array<{ at: number; f: AudioFeatures }> = [];
  private ringLen = 0;
  private ringHead = 0;

  constructor(engine: AudioEngine, binCount = 96) {
    this.engine = engine;
    const fftSize = engine.analyser.fftSize;
    this.displayFftSize = fftSize;
    this.fft = new RealFFT(fftSize, true);
    this.magDb = new Float32Array(fftSize / 2);
    this.timeData = new Float32Array(fftSize);
    this.timeL = new Float32Array(fftSize);
    this.timeR = new Float32Array(fftSize);
    this.silence = new Float32Array(fftSize);
    this.meter = new LoudnessMeter(engine.ctx.sampleRate, 2);
    this.pipeline = new FeaturePipeline({
      sampleRate: engine.ctx.sampleRate,
      fftBins: fftSize / 2,
      binCount,
      // Fixed, NOT derived from fftSize — see WAVEFORM_LENGTH. The rest of
      // the window is trigger-search headroom.
      waveformLength: WAVEFORM_LENGTH,
    });
    this.presented = cloneFeatures(this.pipeline.features);
  }

  /** Choose what the visuals follow. */
  setSync(sync: SyncSettings): void {
    const safe = sanitizeSync(sync);
    const fftSize = displaySpectrumFftSize(this.engine.ctx.sampleRate, spectrumResolution(safe));
    if (fftSize !== this.displayFftSize) {
      this.displayFftSize = fftSize;
      this.displayReady = false;
      this.pipeline.setDisplayFftBins(fftSize / 2);
      this.engine.displayAnalyser.fftSize = fftSize;
      if (fftSize === this.engine.analyser.fftSize) {
        this.displayFft = null;
        this.displayMagDb = null;
        this.displayTimeData = null;
      } else {
        // Independent AnalyserNode history: changing this cannot lengthen the
        // detector window or alter onset timing.
        //
        // Asymmetric display window (see RealFFT), same flag as the export
        // path. Live, the window necessarily still ENDS at the analyser's
        // "now" — a tap cannot read the future — so the remaining display lag
        // is the window's peak offset (E = round(N/8), the ~window/8 region:
        // ~21 ms detailed / ~43 ms precise at 48 kHz) MINUS the output
        // latency the tap already leads the speakers by (10–40 ms, device
        // dependent). The export path shifts the same window forward so its
        // peak lands ON the frame time (offlineSource.updateDisplaySpectrum);
        // live approximates that alignment as closely as physics allows.
        this.displayFft = new RealFFT(fftSize, true, true);
        this.displayMagDb = new Float32Array(fftSize / 2);
        this.displayTimeData = new Float32Array(fftSize);
      }
    }
    this.pipeline.setSync(safe);
  }

  /**
   * Tell the pipeline the next frame is not a continuation of the last one.
   *
   * "seek" = same track, new position. "source" = different audio entirely
   * (track load, entering or leaving live input). See FeaturePipeline.reset.
   *
   * Note what this CANNOT fix: the AnalyserNode keeps its own `fftSize`-long
   * ring, and recreating the buffer source does not flush it. So for roughly
   * one window (~85 ms, about 5 frames at 60 fps) after a seek the FFT still
   * straddles both positions. Resetting removes the false ONSET, which is the
   * visible symptom; the brief spectral blend is inherent to tapping the graph
   * and would need a different tap to remove.
   */
  reset(kind: "seek" | "source"): void {
    this.pipeline.reset(kind);
    this.lastFrameAt = null;
    this.sinceTick = 0;
    this.lastUpdateTicked = false;
    this.displayReady = false;
    // Shut, not open: entering live input has heard nothing yet, and the first
    // frame of real audio opens it anyway.
    this.gateOpen = false;
    this.gateHold = 0;
    // The ring describes audio that is no longer adjacent: presenting it
    // after a seek would show the OLD position for one latency's worth of
    // frames. Empty, the next update presents live until the ring refills.
    this.ringLen = 0;
    this.ringHead = 0;
  }

  /** Attach the track's beat grid once analysis lands (null = none yet). */
  setBeatGrid(grid: BeatGrid | null): void {
    this.grid = grid;
  }

  /** Attach the track's detected section boundaries (null = none yet).
   * Like the grid, the values derived from these resolve per-frame from
   * track time, so attach/detach never leaves envelope state behind. */
  setSections(sections: number[] | null): void {
    this.sections = sections;
  }

  /** Attach the timed-lyrics sung spans (`vocalSpansFromLyrics`; null =
   * no timed lyrics). Drives `features.vocal` as a pure function of track
   * time — the offline path resolves the identical value from the same
   * spans, so preview and export agree by construction. */
  setVocalSpans(spans: VocalSpan[] | null): void {
    this.vocalSpans = spans;
  }

  /**
   * Whether the latest update advanced the canonical 60 Hz feedback-state
   * clock — the live loop's ONLY license to advance texture-feedback state
   * (an advance directive steps Spectro Falls' record / Overgrowth's
   * chemistry by the fixed FEEDBACK_DT). Reported only while the engine is
   * playing: the internal detector clock keeps stepping on the wall clock
   * regardless (meters and bins keep decaying honestly), but a paused frame
   * must present, never advance — pre-gate, ~60 wall-clock ticks/s at frozen
   * track time scrolled one silence-recording slice each and drained the
   * whole record in ~3 s of pause (BACKLOG 2.103.0's filed finding).
   * `engine.playing` is `_playing || liveNode !== null`, so live capture
   * (no pause concept) always ticks, natural track end holds the record
   * like a pause, paused seeks can never advance (the seek carve-out KEEPS
   * on-screen history — PREVIEW-EXPORT-CONTRACT.md "Not promised"), and an
   * A-B wrap — playing throughout — cannot freeze the stream: there is no
   * track-time comparison to mishandle the backward jump.
   */
  get feedbackTicked(): boolean {
    return this.lastUpdateTicked;
  }

  /**
   * Latest feature snapshot. Read-only, per-frame, and MUTATED IN PLACE by
   * update(): read the scalars you need synchronously inside your own tick and
   * never retain the reference (or diff two "snapshots" — they are the same
   * object). A SUPPORTED contract as of v2.83.0, where the Modulation page's
   * source meters pull it through peekAnalyzer(); it read "for DEV
   * diagnostics" before that.
   */
  get features(): AudioFeatures {
    return this.presented;
  }

  /**
   * Whether an update() at wall-clock time `now` would advance the fixed
   * 60 Hz analysis clock (R2-25). A PURE prediction over the exact state
   * update() reads — the same first-frame dt fallback, the same accumulator,
   * the same epsilon — so `willTick(t)` IS update(t)'s own analysisTick
   * decision, and asking never moves the clock. (`sinceTick += dt` followed
   * by `sinceTick >= X` compares the identical rounded double this sum
   * produces, so the two cannot disagree even at the epsilon boundary.)
   *
   * The live frame loop uses it to skip whole feature updates on frames the
   * fps cap will not present anyway — WITHOUT ever skipping a canonical
   * analysis tick, which detectors and the texture-feedback advance license
   * live on. Skipped frames leave `lastFrameAt` alone, so the next call's dt
   * spans the gap and the accumulator owes the same total time either way:
   * tick timing is identical to the uncapped schedule by construction.
   */
  willTick(now: number): boolean {
    const dt = this.lastFrameAt === null ? 1 / 60 : now - this.lastFrameAt;
    return this.sinceTick + dt >= ANALYSIS_DT - 1e-9;
  }

  /**
   * Call once per animation frame. `now` is a wall-clock seconds timestamp
   * (drives dt only); `trackTime` is the track position the visuals present
   * this frame — the caller passes the output-latency-compensated clock so
   * grid phase and f.time align with what the ears hear (defaults to the
   * engine's raw clock).
   *
   * `presentLag` (seconds, ≥ 0) delays the TAP-derived features by that much
   * wall-clock time before they are presented — see `present()`. The caller
   * passes the same presentation lag it subtracted from the clock to get
   * `trackTime`, so onset pulses, bands and bins reach the eye at the moment
   * the ear hears the audio they were measured on. 0 presents live.
   */
  update(now: number, trackTime = this.engine.currentTime, presentLag = 0): AudioFeatures {
    const dt = this.lastFrameAt === null ? 1 / 60 : now - this.lastFrameAt;
    this.lastFrameAt = now;
    // Decide whether the detectors step this frame.
    //
    // Unlike the offline path this cannot replay missed ticks: the analyser is
    // a live tap exposing one window, and running several ticks against the
    // same samples would be inventing data, not recovering it. So a display
    // slower than 60 Hz analyses at its own rate — the honest ceiling — while
    // 60 Hz gets exactly one tick per frame (matching export) and anything
    // faster ticks on a subset of frames.
    this.sinceTick += dt;
    let analysisTick = false;
    if (this.sinceTick >= ANALYSIS_DT - 1e-9) {
      analysisTick = true;
      this.sinceTick -= ANALYSIS_DT;
      // Never build a backlog. A stall (hidden window, GC pause) would
      // otherwise leave the clock owing several ticks it can only pay with one
      // window of audio, firing repeatedly on a spectrum it has already seen.
      if (this.sinceTick > ANALYSIS_DT) this.sinceTick = 0;
    }
    // The tick is REPORTED as a feedback tick only while playback (or live
    // capture) is running — see feedbackTicked. The detectors below still
    // step on `analysisTick` itself while paused: their firing is already
    // gated on `playing` inside the pipeline, and the decay keeps paused
    // meters honest. Feedback state, by contrast, must hold at frozen track
    // time, so the advance license dries up the moment playback stops.
    const playing = this.engine.playing;
    this.lastUpdateTicked = analysisTick && playing;
    this.engine.analyser.getFloatTimeDomainData(this.timeData);
    this.engine.analyserL.getFloatTimeDomainData(this.timeL);
    this.engine.analyserR.getFloatTimeDomainData(this.timeR);
    // Live capture only — see GATE_OPEN. Track playback runs the branch below
    // exactly as it always did.
    const gated = this.engine.liveInput && !this.updateGate(dt);
    if (gated) {
      // -Infinity is what a genuinely silent bin looks like to the pipeline
      // (`dsp/fft.ts` emits it for a zero magnitude), so this is the same input
      // digital silence would have produced rather than a special case the
      // pipeline has to know about. Bins fall away on the release EMA, every
      // flux is zero, and no detector can fire.
      this.magDb.fill(-Infinity);
    } else {
      this.fft.magnitudesDb(this.timeData, this.magDb);
    }
    let displayMagDb: Float32Array | undefined;
    if (this.displayFft && this.displayMagDb && this.displayTimeData) {
      if (analysisTick || !this.displayReady) {
        this.engine.displayAnalyser.getFloatTimeDomainData(this.displayTimeData);
        if (gated) this.displayMagDb.fill(-Infinity);
        else this.displayFft.magnitudesDb(this.displayTimeData, this.displayMagDb);
        this.displayReady = true;
      }
      displayMagDb = this.displayMagDb;
    }
    // Feed the loudness meter only the NEW samples since last frame (the
    // analyser exposes a sliding window; overlap would double-count) — and
    // only while PLAYING (R2-32d). A paused tap decays to digital zeros, and
    // feeding those filled the 400 ms momentary window with silence: f.lufs
    // itself froze on pause (the pipeline's keep-previous rule, `lufs:
    // playing ? … : undefined` below), but the first ~400 ms after every
    // resume then read a dip the audio never contained. Skipping the feed
    // freezes the meter exactly like the readout it drives.
    if (playing) {
      const fresh = Math.min(
        this.timeL.length,
        Math.max(1, Math.round(dt * this.engine.ctx.sampleRate)),
      );
      this.meter.process([
        this.timeL.subarray(this.timeL.length - fresh),
        this.timeR.subarray(this.timeR.length - fresh),
      ]);
    }
    // Second waveform lane: the per-channel taps, but only when the SOURCE is
    // genuinely stereo. The ChannelSplitter up-mixes a mono track discretely,
    // feeding analyserR pure silence — while the offline path substitutes the
    // mono signal (`right = ch[1] ?? ch[0]`). Passing the silent tap here
    // would render a mono file's XY figure as a horizontal line live and a
    // diagonal in its own export, a preview/export divergence. Omitting the
    // pair makes the pipeline reuse the mono window for both lanes — the
    // exact offline arithmetic. Live capture is always stereo (the loopback
    // worklet declares outputChannelCount [2]); the gate omits too, so a
    // gated frame's lanes are the same silence the mono lane carries.
    const stereo =
      !gated && (this.engine.liveInput || (this.engine.audioBuffer?.numberOfChannels ?? 0) > 1);
    const live = this.pipeline.update({
      magDb: this.magDb,
      ...(displayMagDb ? { displayMagDb } : {}),
      waveform: gated ? this.silence : this.timeData,
      ...(stereo ? { waveformL: this.timeL, waveformR: this.timeR } : {}),
      time: trackTime,
      dt,
      analysisTick,
      playing,
      duration: this.engine.duration,
      // A noise floor's channels are uncorrelated, so stereoWidth reads it as
      // a WIDE signal — the one feature that would keep moving behind an
      // otherwise silent picture.
      width: gated ? 0 : stereoWidth(this.timeL, this.timeR),
      lufs: playing ? this.meter.momentary : undefined,
      ...(this.grid ? { bpm: this.grid.bpm, ...gridPhase(this.grid, trackTime) } : {}),
      ...(this.sections ? sectionStateAt(this.sections, trackTime) : {}),
      ...(this.vocalSpans ? { vocal: vocalPresenceAt(this.vocalSpans, trackTime) } : {}),
    });
    return this.present(live, now, presentLag);
  }

  /**
   * Align what the eye sees with what the ear hears.
   *
   * The analyser taps the graph HEAD, which the speakers play
   * `baseLatency + outputLatency` later (66 ms on the reference machine;
   * Bluetooth adds more than the browser reports). The loop already presents
   * the beat GRID at the compensated clock, but every tap-derived feature —
   * onset pulses, bands, bins, the waveform — was computed on audio the ear
   * has not heard yet, so a kick flashed on screen a few frames before it
   * was audible, and `max(driveBeat, gridPulse)` in the presets smeared into
   * two pulses one latency apart.
   *
   * Fix: keep a ring of recent frames and present the one analysed
   * `presentLag` ago. The grid, section and lyric fields are a pure function
   * of track time and are taken from the LIVE frame (already resolved at the
   * compensated clock), so nothing is compensated twice. Preview-only by
   * construction — the export path has no output latency and never calls
   * this — so the determinism law is untouched.
   *
   * If the ring does not reach back far enough (first frames after a reset,
   * or a lag longer than the ring), the oldest frame is presented: a lag
   * that is slightly short beats a visible jump.
   */
  private present(live: AudioFeatures, now: number, presentLag: number): AudioFeatures {
    const out = this.presented;
    if (presentLag > 0) {
      // Push this frame: into the next free slot while the ring fills, over
      // the OLDEST entry once it is full.
      let idx: number;
      if (this.ringLen < RING_MAX) {
        idx = (this.ringHead + this.ringLen) % RING_MAX;
        this.ringLen++;
      } else {
        idx = this.ringHead;
        this.ringHead = (this.ringHead + 1) % RING_MAX;
      }
      if (idx >= this.ring.length) {
        this.ring.push({ at: now, f: cloneFeatures(live) });
      } else {
        const slot = this.ring[idx];
        slot.at = now;
        copyTapFields(slot.f, live);
      }
      // The frame analysed NEAREST to now − lag. Nearest rather than
      // "newest at or before": frames are sampled on a jittery rAF clock, and
      // a floor would skip the one-frame pulse peak whenever the target fell
      // a hair before its stamp. Entries are stamped in increasing order, so
      // walk back from the newest and stop once the distance starts growing.
      const target = now - presentLag;
      let pick = this.ring[this.ringHead];
      let best = Infinity;
      for (let i = this.ringLen - 1; i >= 0; i--) {
        const e = this.ring[(this.ringHead + i) % RING_MAX];
        const d = Math.abs(e.at - target);
        if (d > best) break;
        best = d;
        pick = e;
      }
      copyTapFields(out, pick.f);
    } else {
      this.ringLen = 0;
      this.ringHead = 0;
      copyTapFields(out, live);
    }
    out.time = live.time;
    out.duration = live.duration;
    out.timeOrigin = live.timeOrigin;
    out.bpm = live.bpm;
    out.beatPhase = live.beatPhase;
    out.barPhase = live.barPhase;
    out.beatIndex = live.beatIndex;
    out.barIndex = live.barIndex;
    out.sectionIndex = live.sectionIndex;
    out.sectionPulse = live.sectionPulse;
    out.vocal = live.vocal;
    return out;
  }

  /**
   * Step the live-input silence gate and report whether it is open.
   *
   * Peak, not RMS: the question is whether ANY sample in the window reached an
   * audible level, and a peak answers it without a window-length dependence.
   * The hold is what makes the gate safe on real music — it only ever closes
   * after GATE_HOLD_SEC of continuous sub-threshold input, so a breath between
   * phrases cannot shut it, while opening is immediate on the first frame that
   * crosses GATE_OPEN, so nothing is lost coming back.
   */
  private updateGate(dt: number): boolean {
    let peak = 0;
    const w = this.timeData;
    for (let i = 0; i < w.length; i++) {
      const a = Math.abs(w[i]);
      if (a > peak) peak = a;
    }
    if (peak >= GATE_OPEN) {
      this.gateOpen = true;
      this.gateHold = GATE_HOLD_SEC;
    } else if (peak < GATE_CLOSE) {
      this.gateHold -= dt;
      if (this.gateHold <= 0) this.gateOpen = false;
    }
    return this.gateOpen;
  }
}
