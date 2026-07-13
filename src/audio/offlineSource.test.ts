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

describe("OfflineAnalyzer", () => {
  it("computes the expected frame count", () => {
    const analyzer = new OfflineAnalyzer(makeTestBuffer(), FPS);
    expect(analyzer.frameCount).toBe(DURATION * FPS);
  });

  it("detects each kick once, within 3 frames of its onset", () => {
    const analyzer = new OfflineAnalyzer(makeTestBuffer(), FPS);
    const { beatFrames } = collectTrace(analyzer);
    // Kicks land at t = 0, 0.5, 1.0, 1.5 → frames 0, 30, 60, 90. Frame N's
    // window is the audio ENDING at t = N/fps, so a kick starting exactly at
    // frame N first contributes energy to frame N+1. The t=0 kick falls inside
    // the detector warmup (~12 frames of flux history) and is not detectable.
    const kicks = [30, 60, 90];
    expect(beatFrames.length).toBe(kicks.length);
    for (let i = 0; i < kicks.length; i++) {
      expect(beatFrames[i]).toBeGreaterThan(kicks[i]);
      expect(beatFrames[i]).toBeLessThanOrEqual(kicks[i] + 3);
    }
  });

  it("is fully deterministic: two runs over the same buffer are identical", () => {
    const a = collectTrace(new OfflineAnalyzer(makeTestBuffer(), FPS));
    const b = collectTrace(new OfflineAnalyzer(makeTestBuffer(), FPS));
    expect(a.beatFrames).toEqual(b.beatFrames);
    expect(a.trace).toEqual(b.trace); // exact float equality, all 120 frames
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
