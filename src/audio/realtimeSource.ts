import type { AudioEngine } from "./engine";
import type { AudioFeatures, SyncSettings } from "./types";
import { FeaturePipeline } from "./featurePipeline";
import { RealFFT } from "./dsp/fft";
import { LoudnessMeter } from "./dsp/lufs";
import { stereoWidth } from "./dsp/stereo";
import { gridPhase, type BeatGrid } from "./analysis/beatGrid";

/**
 * Realtime analysis source: pulls the most recent fftSize time-domain samples
 * from the AnalyserNode each animation frame and runs the SAME RealFFT (Hann
 * window) the offline export path uses. Counterpart of OfflineAnalyzer.
 *
 * The AnalyserNode is used only as a time-domain tap — not for its frequency
 * data. Its Blackman window and native smoothingTimeConstant would make live
 * spectra differ from offline ones; doing the FFT ourselves makes live and
 * export pixels come from identical math (WYSIWYG), the only remaining
 * difference being frame timing (live dt varies, offline dt = 1/fps).
 */
export class RealtimeAnalyzer {
  private engine: AudioEngine;
  private pipeline: FeaturePipeline;
  private fft: RealFFT;
  private magDb: Float32Array;
  private timeData: Float32Array;
  private timeL: Float32Array;
  private timeR: Float32Array;
  private meter: LoudnessMeter;
  private grid: BeatGrid | null = null;
  private lastFrameAt: number | null = null;

  constructor(engine: AudioEngine, binCount = 96) {
    this.engine = engine;
    const fftSize = engine.analyser.fftSize;
    this.fft = new RealFFT(fftSize);
    this.magDb = new Float32Array(fftSize / 2);
    this.timeData = new Float32Array(fftSize);
    this.timeL = new Float32Array(fftSize);
    this.timeR = new Float32Array(fftSize);
    this.meter = new LoudnessMeter(engine.ctx.sampleRate, 2);
    this.pipeline = new FeaturePipeline({
      sampleRate: engine.ctx.sampleRate,
      fftBins: fftSize / 2,
      binCount,
      // 3/4 window: the rest is trigger-search headroom (see FeaturePipeline)
      waveformLength: Math.floor((fftSize * 3) / 4),
    });
  }

  /** Choose what the visuals follow. */
  setSync(sync: SyncSettings): void {
    this.pipeline.setSync(sync);
  }

  /** Attach the track's beat grid once analysis lands (null = none yet). */
  setBeatGrid(grid: BeatGrid | null): void {
    this.grid = grid;
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
    this.engine.analyser.getFloatTimeDomainData(this.timeData);
    this.engine.analyserL.getFloatTimeDomainData(this.timeL);
    this.engine.analyserR.getFloatTimeDomainData(this.timeR);
    this.fft.magnitudesDb(this.timeData, this.magDb);
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
    return this.pipeline.update({
      magDb: this.magDb,
      waveform: this.timeData,
      time: trackTime,
      dt,
      playing: this.engine.playing,
      duration: this.engine.duration,
      width: stereoWidth(this.timeL, this.timeR),
      lufs: this.engine.playing ? this.meter.momentary : undefined,
      ...(this.grid ? { bpm: this.grid.bpm, ...gridPhase(this.grid, trackTime) } : {}),
    });
  }
}
