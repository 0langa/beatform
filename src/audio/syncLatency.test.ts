import { describe, expect, it } from "vitest";
import { analyzeBeatGrid } from "./analysis/beatGrid";
import { OfflineAnalyzer } from "./offlineSource";
import type { PcmData } from "./types";

/**
 * Sync-latency regression tests: beats detected by the grid and onset pulses
 * emitted by the offline analyzer must land ON the audible transients, not a
 * window-length or a frame after them. Both offsets were measured and fixed
 * (beat grid ~30 ms early from window-start timestamps; offline pulses
 * exactly one frame late from the zero-weight Hann edge) — these tests pin
 * the corrected behaviour.
 */

const SR = 48000;

/** Synthetic beat track: kick thump + click at exact metronome instants. */
function clickTrack(bpm: number, seconds: number): PcmData {
  const length = Math.round(SR * seconds);
  const data = new Float32Array(length);
  const period = (60 / bpm) * SR;
  for (let beat = 0; beat * period < length; beat++) {
    const start = Math.round(beat * period);
    for (let i = 0; i < 400 && start + i < length; i++) {
      const t = i / SR;
      data[start + i] +=
        0.9 * Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t * 60) +
        0.3 * Math.sin(2 * Math.PI * 3777 * t) * Math.exp(-t * 400);
    }
  }
  for (let i = 0; i < length; i++) {
    data[i] += 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  return { sampleRate: SR, length, duration: seconds, channels: [data] };
}

/** Signed offsets of detected times vs the nearest true metronome instant. */
function offsets(times: number[], bpm: number): number[] {
  const period = 60 / bpm;
  return times.filter((t) => t > 1 && t < 10.5).map((t) => t - Math.round(t / period) * period);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

describe("beat grid latency", () => {
  it.each([90, 120, 174])("%i BPM: beats land within 8 ms of the transients", (bpm) => {
    const grid = analyzeBeatGrid(clickTrack(bpm, 12));
    const off = offsets(Array.from(grid.beatTimes), bpm);
    expect(off.length).toBeGreaterThan(10);
    expect(Math.abs(mean(off))).toBeLessThan(0.008);
    for (const o of off) expect(Math.abs(o)).toBeLessThan(0.012);
  });
});

describe("offline analyzer pulse latency", () => {
  it.each([30, 60])("%i fps: beat/driveBeat/kick fire in the transient's frame", (fps) => {
    const bpm = 120; // beats every 0.5 s — frame-aligned at 30 and 60 fps
    const pcm = clickTrack(bpm, 12);
    const ana = new OfflineAnalyzer(pcm, fps);
    const beatT: number[] = [];
    const kickT: number[] = [];
    const driveBeatT: number[] = [];
    let prevKick = 0;
    let prevDriveBeat = 0;
    for (let n = 0; n < ana.frameCount; n++) {
      const f = ana.nextFrameFeatures();
      const t = n / fps;
      if (f.beat) beatT.push(t);
      if (f.kick === 1 && prevKick !== 1) kickT.push(t);
      if (f.driveBeat === 1 && prevDriveBeat !== 1) driveBeatT.push(t);
      prevKick = f.kick;
      prevDriveBeat = f.driveBeat;
    }
    for (const [name, times] of [
      ["beat", beatT],
      ["driveBeat", driveBeatT],
      ["kick", kickT],
    ] as const) {
      const off = offsets(times, bpm);
      expect(off.length, `${name} pulse count`).toBeGreaterThan(10);
      // Frame-aligned transients must fire in exactly their own frame
      expect(Math.abs(mean(off)), `${name} mean offset`).toBeLessThan(0.001);
    }
  });

  it("35 fps (frames not beat-aligned): pulses stay within one frame of the transient", () => {
    const fps = 35;
    const bpm = 120;
    const ana = new OfflineAnalyzer(clickTrack(bpm, 12), fps);
    const beatT: number[] = [];
    for (let n = 0; n < ana.frameCount; n++) {
      const f = ana.nextFrameFeatures();
      if (f.beat) beatT.push(n / fps);
    }
    const off = offsets(beatT, bpm);
    expect(off.length).toBeGreaterThan(10);
    for (const o of off) expect(Math.abs(o)).toBeLessThan(1 / fps);
  });
});
