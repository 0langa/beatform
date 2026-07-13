import type { AudioEngine } from "./engine";
import type { AudioFeatures, SyncSettings } from "./types";
import { FeaturePipeline } from "./featurePipeline";
import { RealFFT } from "./dsp/fft";

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
  private lastFrameAt: number | null = null;

  constructor(engine: AudioEngine, binCount = 96) {
    this.engine = engine;
    const fftSize = engine.analyser.fftSize;
    this.fft = new RealFFT(fftSize);
    this.magDb = new Float32Array(fftSize / 2);
    this.timeData = new Float32Array(fftSize);
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

  /** Call once per animation frame with a seconds timestamp. */
  update(now: number): AudioFeatures {
    const dt = this.lastFrameAt === null ? 1 / 60 : now - this.lastFrameAt;
    this.lastFrameAt = now;
    this.engine.analyser.getFloatTimeDomainData(this.timeData);
    this.fft.magnitudesDb(this.timeData, this.magDb);
    return this.pipeline.update({
      magDb: this.magDb,
      waveform: this.timeData,
      time: this.engine.currentTime,
      dt,
      playing: this.engine.playing,
      duration: this.engine.duration,
    });
  }
}
