import type { AudioEngine } from "./engine";
import type { AudioFeatures, SyncSettings } from "./types";
import { FeaturePipeline } from "./featurePipeline";

/**
 * Realtime analysis source: pulls AnalyserNode data each animation frame and
 * feeds the shared FeaturePipeline. Counterpart of OfflineAnalyzer (export).
 */
export class RealtimeAnalyzer {
  private engine: AudioEngine;
  private pipeline: FeaturePipeline;
  private magDb: Float32Array;
  private timeData: Float32Array;
  private lastFrameAt: number | null = null;

  constructor(engine: AudioEngine, binCount = 96) {
    this.engine = engine;
    const fftBins = engine.analyser.frequencyBinCount;
    this.magDb = new Float32Array(fftBins);
    this.timeData = new Float32Array(engine.analyser.fftSize);
    this.pipeline = new FeaturePipeline({
      sampleRate: engine.ctx.sampleRate,
      fftBins,
      binCount,
      // 3/4 window: the rest is trigger-search headroom (see FeaturePipeline)
      waveformLength: Math.floor((engine.analyser.fftSize * 3) / 4),
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
    this.engine.analyser.getFloatFrequencyData(this.magDb);
    this.engine.analyser.getFloatTimeDomainData(this.timeData);
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
