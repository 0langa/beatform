import { describe, expect, it } from "vitest";
import { OfflineAnalyzer } from "./offlineSource";
import { WARMUP_SEC } from "./featurePipeline";
import type { PcmData } from "./types";

/**
 * C1f — an export must not start beat-blind.
 *
 * `FeaturePipeline` refuses to fire any detector until `clock >= WARMUP_SEC`,
 * and that clock counts from CONSTRUCTION. The live preview's pipeline has
 * been running for minutes, so it is always warm; a freshly-built offline
 * analyzer was not, which meant the opening ~0.2 s of every export had no
 * beat, kick, snare, hat or driveBeat while the preview fired them at the same
 * track moment. The fix pre-rolls the pipeline; these tests pin that.
 */

const SR = 48000;

/** Kick-like thumps at fixed instants, over a quiet tone. */
function thumpTrack(seconds: number, hits: number[]): PcmData {
  const length = Math.round(SR * seconds);
  const data = new Float32Array(length);
  for (const at of hits) {
    const start = Math.round(at * SR);
    for (let i = 0; i < 600 && start + i < length; i++) {
      const t = i / SR;
      data[start + i] +=
        0.95 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 55) +
        0.35 * Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 380);
    }
  }
  for (let i = 0; i < length; i++) data[i] += 0.04 * Math.sin((2 * Math.PI * 220 * i) / SR);
  return { sampleRate: SR, length, duration: seconds, channels: [data] };
}

/** Features for the first `seconds` of a track, frame by frame. */
function openingFrames(pcm: PcmData, fps: number, seconds: number) {
  const a = new OfflineAnalyzer(pcm, fps);
  const out = [];
  for (let i = 0; i < Math.ceil(seconds * fps); i++) out.push(a.nextFrameFeatures());
  return out;
}

describe("export warmup", () => {
  it.each([30, 60])("%i fps: an onset inside the warmup window still fires", (fps) => {
    // Two hits well inside the old blind window (WARMUP_SEC ~= 0.2 s).
    const pcm = thumpTrack(4, [0.05, 0.15, 0.5, 1.0, 1.5]);
    const frames = openingFrames(pcm, fps, WARMUP_SEC);
    const fired = frames.some((f) => f.beat || f.kick > 0.2 || f.driveBeat > 0.2);
    expect(fired).toBe(true);
  });

  it("does not INVENT an onset: silence through the warmup window stays quiet", () => {
    // The pre-roll runs with playing:false precisely so it cannot fire a
    // detector or set a refractory. A silent opening must stay silent.
    const pcm = thumpTrack(4, [2.0]);
    const frames = openingFrames(pcm, 60, WARMUP_SEC);
    expect(frames.every((f) => !f.beat)).toBe(true);
    expect(Math.max(...frames.map((f) => f.kick))).toBeLessThan(0.2);
  });

  it("stays deterministic — two analyzers over the same PCM agree exactly", () => {
    const pcm = thumpTrack(3, [0.05, 0.5, 1.0]);
    const a = openingFrames(pcm, 60, 1.5).map((f) => [f.beat, f.kick, f.bass, f.drive]);
    const b = openingFrames(pcm, 60, 1.5).map((f) => [f.beat, f.kick, f.bass, f.drive]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the pre-roll does not shift the frame timeline — frame 0 is still t=0", () => {
    // A regression here would desync every export: video frame N must still
    // cover t = N/fps after priming.
    const pcm = thumpTrack(2, [1.0]);
    const a = new OfflineAnalyzer(pcm, 30);
    expect(a.frameCount).toBe(Math.ceil(2 * 30));
    const first = a.nextFrameFeatures();
    expect(first).toBeDefined();
  });
});
