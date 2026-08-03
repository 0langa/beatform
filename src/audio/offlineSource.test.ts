import { describe, expect, it } from "vitest";
import { OfflineAnalyzer } from "./offlineSource";
import type { PcmData } from "./types";

const SAMPLE_RATE = 48000;
const DURATION = 2;
const FPS = 60;

/**
 * Deterministic synthetic track: a 440 Hz tone with a short, hard-decaying
 * 100 Hz "kick" burst every 0.5 s. No randomness, no Web Audio — pure math,
 * so the exact same buffer exists on every machine and every run. The kick is
 * kept short (50 ms, -35 dB by its end) because the beat detector works on
 * log-magnitude flux: long low-level tails oscillate audibly on the dB scale
 * and legitimately re-trigger it.
 */
function makeTestBuffer(): PcmData {
  const length = SAMPLE_RATE * DURATION;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    data[i] = 0.25 * Math.sin(2 * Math.PI * 440 * t);
    const sinceKick = t % 0.5;
    if (sinceKick < 0.05) {
      data[i] += 0.9 * Math.sin(2 * Math.PI * 100 * sinceKick) * Math.exp(-sinceKick * 80);
    }
  }
  return { sampleRate: SAMPLE_RATE, duration: DURATION, length, channels: [data] };
}

function collectTrace(analyzer: OfflineAnalyzer): {
  beatFrames: number[];
  trace: number[];
} {
  const beatFrames: number[] = [];
  const trace: number[] = [];
  for (let n = 0; n < analyzer.frameCount; n++) {
    const f = analyzer.nextFrameFeatures();
    if (f.beat) beatFrames.push(n);
    trace.push(f.rms, f.energy, f.bass, f.mid, f.treble, f.drive, f.beatIntensity, f.bins[24]);
  }
  return { beatFrames, trace };
}

/** Constant-amplitude sine PcmData with the given channel count. */
function toneBuffer(channels: number): PcmData {
  const length = SAMPLE_RATE * DURATION;
  const ch: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++)
      data[i] = 0.5 * Math.sin((2 * Math.PI * 997 * i) / SAMPLE_RATE);
    ch.push(data);
  }
  return { sampleRate: SAMPLE_RATE, duration: DURATION, length, channels: ch };
}

function finalLufs(pcm: PcmData): number {
  const a = new OfflineAnalyzer(pcm, FPS);
  let lufs = -70;
  for (let n = 0; n < a.frameCount; n++) lufs = a.nextFrameFeatures().lufs;
  return lufs;
}

describe("OfflineAnalyzer", () => {
  it("computes the expected frame count", () => {
    const analyzer = new OfflineAnalyzer(makeTestBuffer(), FPS);
    expect(analyzer.frameCount).toBe(DURATION * FPS);
  });

  it("measures mono LUFS as one channel (no phantom +3 LU over-read)", () => {
    // A mono tone and a dual-mono (identical L=R) tone must read the SAME
    // loudness: the realtime path feeds a SILENT right for mono, so offline
    // must not alias ch0 as a second channel (that would add +3.01 LU).
    const mono = finalLufs(toneBuffer(1));
    const dualMono = finalLufs(toneBuffer(2));
    // Stereo with two equal channels is genuinely +3 LU louder than mono
    expect(dualMono - mono).toBeGreaterThan(2.5);
    expect(dualMono - mono).toBeLessThan(3.5);
    // A -6 dBFS 997 Hz tone (amplitude 0.5) reads ≈ -9 LUFS mono
    expect(mono).toBeGreaterThan(-10);
    expect(mono).toBeLessThan(-8);
  });

  it("detects each kick once, within 3 frames of its onset", () => {
    const analyzer = new OfflineAnalyzer(makeTestBuffer(), FPS);
    const { beatFrames } = collectTrace(analyzer);
    // Kicks land at t = 0, 0.5, 1.0, 1.5 → frames 0, 30, 60, 90. Frame N's
    // window ends at t + ANALYSIS_LOOKAHEAD, so a kick starting exactly at
    // frame N fires IN frame N (see offlineSource.ts — pulses must land in
    // the frame where the transient is heard, not one later).
    //
    // The t=0 kick used to be undetectable: the detector warmup (~12 frames)
    // counted from the analyzer's construction, so every export opened blind
    // while the live preview — warm for minutes — fired at that same track
    // moment. OfflineAnalyzer now pre-rolls the pipeline, so t=0 is detected
    // like any other. See exportWarmup.test.ts.
    const kicks = [0, 30, 60, 90];
    expect(beatFrames.length).toBe(kicks.length);
    for (let i = 0; i < kicks.length; i++) {
      expect(beatFrames[i]).toBeGreaterThanOrEqual(kicks[i]);
      expect(beatFrames[i]).toBeLessThanOrEqual(kicks[i] + 2);
    }
  });

  it("is fully deterministic: two runs over the same buffer are identical", () => {
    const a = collectTrace(new OfflineAnalyzer(makeTestBuffer(), FPS));
    const b = collectTrace(new OfflineAnalyzer(makeTestBuffer(), FPS));
    expect(a.beatFrames).toEqual(b.beatFrames);
    expect(a.trace).toEqual(b.trace); // exact float equality, all 120 frames
  });

  it("uses a separate precise display FFT without retuning detector features", () => {
    const pcm = makeTestBuffer();
    const baseline = new OfflineAnalyzer(pcm, FPS);
    const precise = new OfflineAnalyzer(pcm, FPS, 96, {
      mode: "kick",
      smooth: 0.5,
      spectrumResolution: "precise",
      spectrumAxis: "linear",
      spectrumSampling: "measured",
      freqMin: 30,
      freqMax: 300,
    });
    for (let n = 0; n < precise.frameCount; n++) {
      const a = baseline.nextFrameFeatures();
      const b = precise.nextFrameFeatures();
      expect(b.bins).toHaveLength(92);
      expect({
        rms: b.rms,
        energy: b.energy,
        bass: b.bass,
        mid: b.mid,
        treble: b.treble,
        drive: b.drive,
        beat: b.beat,
        beatIntensity: b.beatIntensity,
        kick: b.kick,
        snare: b.snare,
        hat: b.hat,
      }).toEqual({
        rms: a.rms,
        energy: a.energy,
        bass: a.bass,
        mid: a.mid,
        treble: a.treble,
        drive: a.drive,
        beat: a.beat,
        beatIntensity: a.beatIntensity,
        kick: a.kick,
        snare: a.snare,
        hat: a.hat,
      });
    }
  });

  it("aligns the precise display spectrum with the audible click (export latency)", () => {
    // THE point of the asymmetric display window: before it, the display
    // window simply ended at the frame time, so a 341 ms symmetric window read
    // a click strongest ~half a window (~10 analysis ticks) after it was
    // heard. The window is now shifted so its peak weight lands on the frame's
    // analysis endpoint; the raw display spectrum must peak within ±1 tick of
    // the click's frame. Measured on the raw magnitudes on purpose — the
    // pipeline's attack/release EMA is a deliberate aesthetic layer shared by
    // preview and export, not acquisition latency.
    const length = SAMPLE_RATE * DURATION;
    const data = new Float32Array(length);
    const clickAt = SAMPLE_RATE; // t = 1.0 s → frame 60 at 60 fps
    for (let i = 0; i < 48; i++) data[clickAt + i] = 1; // 1 ms full-scale click
    const pcm: PcmData = { sampleRate: SAMPLE_RATE, duration: DURATION, length, channels: [data] };
    const analyzer = new OfflineAnalyzer(pcm, FPS, 96, {
      mode: "kick",
      smooth: 0.5,
      spectrumResolution: "precise",
      spectrumAxis: "linear",
      spectrumSampling: "measured",
      freqMin: 30,
      freqMax: 300,
    });
    let peakFrame = -1;
    let peakEnergy = 0;
    for (let n = 0; n < analyzer.frameCount; n++) {
      analyzer.nextFrameFeatures();
      const db = analyzer.displaySpectrumDb;
      expect(db).not.toBeNull();
      let energy = 0;
      for (const v of db as Float32Array) {
        if (v !== -Infinity) energy += Math.pow(10, v / 10);
      }
      if (energy > peakEnergy) {
        peakEnergy = energy;
        peakFrame = n;
      }
    }
    expect(peakEnergy).toBeGreaterThan(0);
    // One tick of slack covers the detector's shared 1/60 s analysis
    // lookahead; the symmetric window failed this by ~9 ticks.
    expect(Math.abs(peakFrame - 60)).toBeLessThanOrEqual(1);
  });

  it("matches the golden feature trace (regression pin)", () => {
    const analyzer = new OfflineAnalyzer(makeTestBuffer(), FPS);
    const { beatFrames, trace } = collectTrace(analyzer);
    // Round to 3 decimals: stable against last-ulp jitter, still sensitive to
    // any real change in binning, smoothing, or beat logic.
    const rounded = trace.map((v) => Math.round(v * 1000) / 1000);
    const summary = {
      beatFrames,
      firstFrames: rounded.slice(0, 8 * 5),
      kickFrame30: rounded.slice(8 * 30, 8 * 31),
      midFrames: rounded.slice(8 * 60, 8 * 62),
      lastFrame: rounded.slice(8 * 119),
    };
    expect(summary).toMatchSnapshot();
  });
});
