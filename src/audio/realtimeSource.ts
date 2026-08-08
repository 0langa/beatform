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

  /** Whether latest update advanced canonical 60 Hz detector/state clock. */
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
    return this.pipeline.features;
  }

  /**
   * Call once per animation frame. `now` is a wall-clock seconds timestamp
   * (drives dt only); `trackTime` is the track position the visuals present
   * this frame — the caller passes the output-latency-compensated clock so
   * grid phase and f.time align with what the ears hear (defaults to the
   * engine's raw clock).
   */
  update(now: number, trackTime = this.engine.currentTime): AudioFeatures {
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
    this.lastUpdateTicked = analysisTick;
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
    // analyser exposes a sliding window; overlap would double-count)
    const fresh = Math.min(
      this.timeL.length,
      Math.max(1, Math.round(dt * this.engine.ctx.sampleRate)),
    );
    this.meter.process([
      this.timeL.subarray(this.timeL.length - fresh),
      this.timeR.subarray(this.timeR.length - fresh),
    ]);
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
    return this.pipeline.update({
      magDb: this.magDb,
      ...(displayMagDb ? { displayMagDb } : {}),
      waveform: gated ? this.silence : this.timeData,
      ...(stereo ? { waveformL: this.timeL, waveformR: this.timeR } : {}),
      time: trackTime,
      dt,
      analysisTick,
      playing: this.engine.playing,
      duration: this.engine.duration,
      // A noise floor's channels are uncorrelated, so stereoWidth reads it as
      // a WIDE signal — the one feature that would keep moving behind an
      // otherwise silent picture.
      width: gated ? 0 : stereoWidth(this.timeL, this.timeR),
      lufs: this.engine.playing ? this.meter.momentary : undefined,
      ...(this.grid ? { bpm: this.grid.bpm, ...gridPhase(this.grid, trackTime) } : {}),
      ...(this.sections ? sectionStateAt(this.sections, trackTime) : {}),
      ...(this.vocalSpans ? { vocal: vocalPresenceAt(this.vocalSpans, trackTime) } : {}),
    });
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
