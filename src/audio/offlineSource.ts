import type { AudioFeatures, PcmData, SyncSettings } from "./types";
import { FeaturePipeline, WARMUP_SEC, WAVEFORM_LENGTH } from "./featurePipeline";
import { RealFFT } from "./dsp/fft";
import { analysisFftSize } from "./dsp/fftSize";
import { LoudnessMeter } from "./dsp/lufs";
import { stereoWidth } from "./dsp/stereo";
import { gridPhase, type BeatGrid } from "./analysis/beatGrid";

/**
 * Analysis lookahead, seconds. The FFT window ends at t + LOOKAHEAD instead
 * of t: a transient landing exactly on a frame's timestamp has zero Hann
 * weight in a window ending at t, so every beat/onset pulse fired one full
 * frame late (measured: exactly +33 ms at 30 fps, +17 ms at 60 fps on
 * synthetic kicks). One 60 fps frame of lookahead lands the pulse in the
 * frame where the transient is heard.
 *
 * The live path needs no explicit counterpart because its analyser taps the
 * graph ahead of the speakers by the output latency, which plays the same
 * role — but the two are ANALOGOUS, not equal, and it is worth being precise
 * about that. This lookahead is a constant 16.67 ms; the live lead is
 * `baseLatency + outputLatency`, typically 10-40 ms, device-dependent and
 * EMA-smoothed. So preview and export can sit up to ~20 ms apart on where a
 * transient lands. That residual is well inside the ITU-R BT.1359 A/V sync
 * window (-125 ms to +45 ms), so it is not audible-grade — but it is a real
 * difference, and any future claim of "identical math" here would be wrong.
 */
const ANALYSIS_LOOKAHEAD = 1 / 60;

/**
 * The analyser runs at a FIXED rate, independent of the rendered frame rate.
 *
 * Spectral flux is a rectified frame-to-frame difference, so it is not band
 * limited: sample it more often and it does not merely get finer, it gets
 * NOISIER, and every extra frame is another independent chance to cross the
 * adaptive threshold. Measured on three real tracks, the same 60 s of music
 * produced 170 beats at 30 fps and 299 at 144 — the identical project reacting
 * ~75% more on a high-refresh display than in its own export.
 *
 * The crossing PROBABILITY PER FRAME is what stays constant (~15% at every
 * rate, with flux/mean averaging 0.99-1.04), which is why no local fix to the
 * detector works. Both cheaper candidates were measured and rejected: diffing
 * against a fixed 16.7 ms lag instead of the previous frame gave 277, and
 * causal peak-picking gave 287, against 299 for the shipping code. Neither
 * removes trials, and trials are the problem.
 *
 * Pinning the analysis cadence removes it at the source: the detector sees the
 * same sequence of updates for a given track no matter what fps is rendered.
 * 60 Hz is chosen because it is the rate the golden trace and every existing
 * project were built at, so rendering at 60 fps stays bit-identical.
 */
const ANALYSIS_HZ = 60;
const ANALYSIS_DT = 1 / ANALYSIS_HZ;

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
 * Frame N covers t = N / fps. The FFT window is the fftSize samples ending
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
  private fftSize: number;
  private nextFrame = 0;
  /**
   * Index of the next fixed-rate analysis tick. An INDEX, not an accumulated
   * time: `analysisTime += ANALYSIS_DT` drifts, and over the ~3600 ticks of a
   * 60 s track the drift was enough to move a tick across a frame boundary and
   * lose about 4% of drum-onset edges at 144 fps relative to 60. Deriving the
   * time as `index / ANALYSIS_HZ` keeps every rate on exactly the same grid.
   */
  private tickIndex = 0;
  /** Track time of the previous pipeline update, so `dt` is the REAL gap. */
  /** Starts one tick BEFORE zero so frame 0 sees a full ANALYSIS_DT, exactly
   * as it did when dt was the frame interval. */
  private lastUpdateTime = -1 / 60;
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

    // Sized from the track's rate so the analysis WINDOW, not the bin count,
    // is what stays constant across devices. See analysisFftSize.
    const fftSize = analysisFftSize(pcm.sampleRate);
    this.fftSize = fftSize;
    this.fft = new RealFFT(fftSize, true);
    this.magDb = new Float32Array(fftSize / 2);
    this.windowBuf = new Float32Array(fftSize);
    this.pipeline = new FeaturePipeline({
      sampleRate: pcm.sampleRate,
      fftBins: fftSize / 2,
      binCount,
      // Fixed, NOT derived from the FFT size — see WAVEFORM_LENGTH. The rest of
      // the window is trigger-search headroom.
      waveformLength: WAVEFORM_LENGTH,
    });
    if (sync) this.pipeline.setSync(sync);
    this.primePipeline();
  }

  /**
   * Warm the pipeline so frame 0 is not beat-blind.
   *
   * `FeaturePipeline` gates every detector on `clock >= WARMUP_SEC`, where the
   * clock counts from CONSTRUCTION. Live that is minutes-since-analyzer-start,
   * so the preview is always warm; offline it is zero, so the first ~0.2 s of
   * every export had no beat, kick, snare, hat or driveBeat pulse while the
   * preview fired them at the same track moment.
   *
   * The pre-roll runs the frames leading UP TO t=0 with `playing: false`. That
   * flag is the key: flux history, the adaptive means and the peak-hold EMAs
   * all update (so the first real frame compares against a populated window
   * rather than ramping from silence), but no detector may fire, so the
   * pre-roll cannot invent an onset or set a refractory that suppresses a real
   * beat at t=0.
   *
   * Before t=0 there is no audio — for a full-track export because the track
   * starts there, for a segment export because the PCM handed to us is already
   * sliced. Those windows come through as silence, which is the honest input.
   * It is also deterministic: the same track always primes the same way, so
   * exports stay byte-reproducible.
   */
  private primePipeline(): void {
    // Pre-roll at the ANALYSIS rate, not the render rate: the pipeline it is
    // warming now only ever sees ANALYSIS_DT steps.
    const frames = Math.ceil(WARMUP_SEC * ANALYSIS_HZ);
    const dt = ANALYSIS_DT;
    for (let i = frames; i >= 1; i--) {
      const t = -i * dt;
      const end = Math.min(
        this.mono.length,
        Math.round((t + ANALYSIS_LOOKAHEAD) * this.sampleRate),
      );
      const start = Math.max(0, end - this.fftSize);
      this.windowBuf.fill(0);
      if (end > start)
        this.windowBuf.set(this.mono.subarray(start, end), this.fftSize - (end - start));
      this.fft.magnitudesDb(this.windowBuf, this.magDb);
      this.pipeline.update({
        magDb: this.magDb,
        waveform: this.windowBuf,
        time: t,
        dt,
        // The whole point: warm the continuous state, fire nothing.
        playing: false,
        analysisTick: true,
        duration: this.duration,
        width: 0,
        lufs: -Infinity,
      });
    }
  }

  /**
   * One rendered frame.
   *
   * Onset detection steps on a fixed ANALYSIS_DT clock, so the number of
   * chances to fire depends on the track and not the frame rate. A 30 fps
   * render consumes two ticks per frame; a 144 fps render finds a tick due on
   * roughly two frames in five and updates only the continuous features on the
   * rest. At 60 fps it is exactly one tick per frame, which is why a 60 fps
   * render is bit-identical.
   *
   * Events cannot just be read off the last tick. `beat` is an instant, so one
   * landing on the first of two ticks would vanish if the second reported
   * false; instants are LATCHED and the onset envelopes take their maximum, so
   * a 30 fps export cannot drop a hit that happened between its frames.
   */
  nextFrameFeatures(): AudioFeatures {
    const n = this.nextFrame++;
    const t = n / this.fps;
    let beat = false;
    let beatIntensity = 0;
    let kick = 0;
    let snare = 0;
    let hat = 0;
    let driveBeat = 0;
    let ticked = false;

    // `<=` plus an epsilon keeps 60 fps at exactly one tick per frame despite
    // float accumulation.
    while (this.tickIndex / ANALYSIS_HZ <= t + 1e-9) {
      const f = this.step(this.tickIndex / ANALYSIS_HZ, true);
      ticked = true;
      beat = beat || f.beat;
      beatIntensity = Math.max(beatIntensity, f.beatIntensity);
      kick = Math.max(kick, f.kick);
      snare = Math.max(snare, f.snare);
      hat = Math.max(hat, f.hat);
      driveBeat = Math.max(driveBeat, f.driveBeat);
      this.tickIndex++;
    }

    if (!ticked) {
      // Rendering faster than the analysis clock: refresh the continuous
      // features for this frame so a high-refresh display stays smooth, but do
      // not give the detectors another chance to fire.
      return this.step(t, false);
    }
    const f = this.pipeline.features;
    f.beat = beat;
    f.beatIntensity = beatIntensity;
    f.kick = kick;
    f.snare = snare;
    f.hat = hat;
    f.driveBeat = driveBeat;
    // Time is per RENDERED frame: it drives u.time, the timeline and
    // automation, all of which must advance at the render rate.
    f.time = t;
    return f;
  }

  /** Window, transform and pipeline update for one rendered frame. */
  private step(t: number, analysisTick: boolean): AudioFeatures {
    const end = Math.min(this.mono.length, Math.round((t + ANALYSIS_LOOKAHEAD) * this.sampleRate));
    const start = Math.max(0, end - this.fftSize);
    this.windowBuf.fill(0);
    this.windowBuf.set(this.mono.subarray(start, end), this.fftSize - (end - start));
    this.fft.magnitudesDb(this.windowBuf, this.magDb);
    const prevUpdate = this.lastUpdateTime;
    this.lastUpdateTime = t;
    void prevUpdate;
    // Meter gets the contiguous new samples up to this tick's true end —
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
      // Time since the PREVIOUS update call, not the frame interval. update()
      // no longer runs exactly once per frame — a 30 fps render calls it twice
      // — and passing the frame interval each time advanced every continuous
      // EMA at double speed (cross-rate spectrum similarity fell to 0.973).
      dt: Math.max(1e-6, t - prevUpdate),
      analysisTick,
      playing: true,
      duration: this.duration,
      width: stereoWidth(this.left.subarray(start, end), this.right.subarray(start, end)),
      lufs: this.meter.momentary,
      ...(this.grid ? { bpm: this.grid.bpm, ...gridPhase(this.grid, t) } : {}),
    });
  }
}
