import type { AudioFeatures, PcmData, SyncSettings } from "./types";
import { FeaturePipeline } from "./featurePipeline";
import { RealFFT } from "./dsp/fft";
import { LoudnessMeter } from "./dsp/lufs";
import { stereoWidth } from "./dsp/stereo";
import { gridPhase, type BeatGrid } from "./analysis/beatGrid";

const FFT_SIZE = 4096;

/**
 * Analysis lookahead, seconds. The FFT window ends at t + LOOKAHEAD instead
 * of t: a transient landing exactly on a frame's timestamp has zero Hann
 * weight in a window ending at t, so every beat/onset pulse fired one full
 * frame late (measured: exactly +33 ms at 30 fps, +17 ms at 60 fps on
 * synthetic kicks). One 60 fps frame of lookahead lands the pulse in the
 * frame where the transient is heard. The live path needs no counterpart:
 * its analyser taps the audio graph ahead of the speakers by the output
 * latency, which plays the same role.
 */
const ANALYSIS_LOOKAHEAD = 1 / 60;

/** Extract plain PCM from a decoded AudioBuffer (main thread only). */
export function pcmFromAudioBuffer(buffer: AudioBuffer): PcmData {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  return {
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    duration: buffer.duration,
    channels,
  };
}

/**
 * Offline analysis source for export rendering: walks decoded PCM
 * frame-by-frame at a fixed fps and produces the exact same AudioFeatures the
 * realtime path would — but deterministically, decoupled from wall-clock.
 *
 * Frame N covers t = N / fps. The FFT window is the FFT_SIZE samples ending
 * at t (mirrors the realtime path, which analyzes the most recent fftSize
 * samples from the AnalyserNode tap).
 *
 * This is the sync backbone of MP4 export: video frame timestamps and audio
 * sample positions both derive from the same decoded buffer, so drift is
 * structurally impossible. See docs/EXPORT-DESIGN.md.
 */
export class OfflineAnalyzer {
  readonly frameCount: number;
  readonly fps: number;

  private mono: Float32Array;
  private left: Float32Array;
  private right: Float32Array;
  private meter: LoudnessMeter;
  private meterChannels = 2;
  private meterFed = 0;
  private sampleRate: number;
  private fft: RealFFT;
  private pipeline: FeaturePipeline;
  private magDb: Float32Array;
  private windowBuf: Float32Array;
  private nextFrame = 0;
  private duration: number;

  private grid: BeatGrid | null;

  constructor(
    pcm: PcmData,
    fps: number,
    binCount = 96,
    sync?: SyncSettings,
    grid: BeatGrid | null = null,
  ) {
    this.grid = grid;
    this.fps = fps;
    this.sampleRate = pcm.sampleRate;
    this.duration = pcm.duration;
    this.frameCount = Math.ceil(pcm.duration * fps);

    // Mono mixdown once up front
    this.mono = new Float32Array(pcm.length);
    for (const data of pcm.channels) {
      for (let i = 0; i < data.length; i++) this.mono[i] += data[i];
    }
    if (pcm.channels.length > 1) {
      const g = 1 / pcm.channels.length;
      for (let i = 0; i < this.mono.length; i++) this.mono[i] *= g;
    }
    this.left = pcm.channels[0];
    this.right = pcm.channels[1] ?? pcm.channels[0];
    // Meter with the REAL channel count. A mono track measured as one channel
    // matches the realtime path (whose ChannelSplitter feeds a SILENT right
    // for mono) and the BS.1770 mono convention — aliasing ch0 as a phantom
    // second channel would over-read by +3 LU and break preview==export.
    this.meterChannels = Math.min(2, pcm.channels.length);
    this.meter = new LoudnessMeter(pcm.sampleRate, this.meterChannels);

    this.fft = new RealFFT(FFT_SIZE);
    this.magDb = new Float32Array(FFT_SIZE / 2);
    this.windowBuf = new Float32Array(FFT_SIZE);
    this.pipeline = new FeaturePipeline({
      sampleRate: pcm.sampleRate,
      fftBins: FFT_SIZE / 2,
      binCount,
      // 3/4 window: the rest is trigger-search headroom (see FeaturePipeline)
      waveformLength: Math.floor((FFT_SIZE * 3) / 4),
    });
    if (sync) this.pipeline.setSync(sync);
  }

  /** Sequential frame analysis (pipeline smoothing/beat state is stateful). */
  nextFrameFeatures(): AudioFeatures {
    const n = this.nextFrame++;
    const t = n / this.fps;
    const end = Math.min(this.mono.length, Math.round((t + ANALYSIS_LOOKAHEAD) * this.sampleRate));
    const start = Math.max(0, end - FFT_SIZE);
    this.windowBuf.fill(0);
    this.windowBuf.set(this.mono.subarray(start, end), FFT_SIZE - (end - start));
    this.fft.magnitudesDb(this.windowBuf, this.magDb);
    // Meter gets the contiguous new samples up to this frame's true end —
    // loudness stays on the un-shifted timeline, only analysis looks ahead
    const meterEnd = Math.min(this.mono.length, Math.round(t * this.sampleRate));
    if (meterEnd > this.meterFed) {
      const ch =
        this.meterChannels === 1
          ? [this.left.subarray(this.meterFed, meterEnd)]
          : [
              this.left.subarray(this.meterFed, meterEnd),
              this.right.subarray(this.meterFed, meterEnd),
            ];
      this.meter.process(ch);
      this.meterFed = meterEnd;
    }
    return this.pipeline.update({
      magDb: this.magDb,
      waveform: this.windowBuf,
      time: t,
      dt: 1 / this.fps,
      playing: true,
      duration: this.duration,
      width: stereoWidth(this.left.subarray(start, end), this.right.subarray(start, end)),
      lufs: this.meter.momentary,
      ...(this.grid ? { bpm: this.grid.bpm, ...gridPhase(this.grid, t) } : {}),
    });
  }
}
