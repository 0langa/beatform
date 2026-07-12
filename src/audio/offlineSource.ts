import type { AudioFeatures } from "./types";
import { FeaturePipeline } from "./featurePipeline";
import { RealFFT } from "./dsp/fft";

const FFT_SIZE = 4096;

/**
 * Offline analysis source for export rendering: walks a decoded AudioBuffer
 * frame-by-frame at a fixed fps and produces the exact same AudioFeatures the
 * realtime path would — but deterministically, decoupled from wall-clock.
 *
 * Frame N covers t = N / fps. The FFT window is the FFT_SIZE samples ending
 * at t (mirrors AnalyserNode, which reports the most recent fftSize samples).
 *
 * This is the sync backbone of MP4 export: video frame timestamps and audio
 * sample positions both derive from the same decoded buffer, so drift is
 * structurally impossible. See docs/EXPORT-DESIGN.md.
 */
export class OfflineAnalyzer {
  readonly frameCount: number;
  readonly fps: number;

  private mono: Float32Array;
  private sampleRate: number;
  private fft: RealFFT;
  private pipeline: FeaturePipeline;
  private magDb: Float32Array;
  private windowBuf: Float32Array;
  private nextFrame = 0;
  private duration: number;

  constructor(buffer: AudioBuffer, fps: number, binCount = 96) {
    this.fps = fps;
    this.sampleRate = buffer.sampleRate;
    this.duration = buffer.duration;
    this.frameCount = Math.ceil(buffer.duration * fps);

    // Mono mixdown once up front
    this.mono = new Float32Array(buffer.length);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) this.mono[i] += data[i];
    }
    if (buffer.numberOfChannels > 1) {
      const g = 1 / buffer.numberOfChannels;
      for (let i = 0; i < this.mono.length; i++) this.mono[i] *= g;
    }

    this.fft = new RealFFT(FFT_SIZE);
    this.magDb = new Float32Array(FFT_SIZE / 2);
    this.windowBuf = new Float32Array(FFT_SIZE);
    this.pipeline = new FeaturePipeline({
      sampleRate: buffer.sampleRate,
      fftBins: FFT_SIZE / 2,
      binCount,
      waveformLength: FFT_SIZE,
    });
  }

  /** Sequential frame analysis (pipeline smoothing/beat state is stateful). */
  nextFrameFeatures(): AudioFeatures {
    const n = this.nextFrame++;
    const t = n / this.fps;
    const end = Math.min(this.mono.length, Math.round(t * this.sampleRate));
    const start = Math.max(0, end - FFT_SIZE);
    this.windowBuf.fill(0);
    this.windowBuf.set(this.mono.subarray(start, end), FFT_SIZE - (end - start));
    this.fft.magnitudesDb(this.windowBuf, this.magDb);
    return this.pipeline.update({
      magDb: this.magDb,
      waveform: this.windowBuf,
      time: t,
      dt: 1 / this.fps,
      playing: true,
      duration: this.duration,
    });
  }
}
