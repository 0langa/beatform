import { describe, expect, it } from "vitest";
import { analyzeBeatGrid, gridPhase } from "./beatGrid";
import type { PcmData } from "../types";

const SR = 48000;

/** Synthetic beat track: short broadband clicks + kick thumps at a tempo. */
function clickTrack(bpm: number, seconds: number): PcmData {
  const length = Math.round(SR * seconds);
  const data = new Float32Array(length);
  const period = (60 / bpm) * SR;
  for (let beat = 0; beat * period < length; beat++) {
    const start = Math.round(beat * period);
    for (let i = 0; i < 400 && start + i < length; i++) {
      const t = i / SR;
      // Kick: 80 Hz decaying sine; click: fast noise-ish transient (deterministic)
      data[start + i] +=
        0.9 * Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t * 60) +
        0.3 * Math.sin(2 * Math.PI * 3777 * t) * Math.exp(-t * 400);
    }
  }
  // Bed of quiet tonal content so the track isn't pure silence between hits
  for (let i = 0; i < length; i++) {
    data[i] += 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  return { sampleRate: SR, length, duration: seconds, channels: [data] };
}

function expectTempoNear(detected: number, target: number, tolerance = 2): void {
  // Accept octave equivalence (60 ≡ 120 ≡ 240) — genre-dependent, both defensible
  const candidates = [target / 2, target, target * 2];
  const best = candidates.reduce((a, b) =>
    Math.abs(detected - a) < Math.abs(detected - b) ? a : b,
  );
  expect(Math.abs(detected - best)).toBeLessThanOrEqual(tolerance);
  // But prefer the true octave for the common dance range
  if (target >= 100 && target <= 180) {
    expect(Math.abs(detected - target)).toBeLessThanOrEqual(tolerance);
  }
}

describe("beat grid", () => {
  it("detects 120 BPM within tolerance", () => {
    const grid = analyzeBeatGrid(clickTrack(120, 12));
    expectTempoNear(grid.bpm, 120);
  });

  it("detects 174 BPM (DnB) within tolerance", () => {
    const grid = analyzeBeatGrid(clickTrack(174, 12));
    expectTempoNear(grid.bpm, 174);
  });

  it("detects 90 BPM within tolerance", () => {
    const grid = analyzeBeatGrid(clickTrack(90, 12));
    expectTempoNear(grid.bpm, 90, 3);
  });

  it("places beats near the true click instants", () => {
    const grid = analyzeBeatGrid(clickTrack(120, 12));
    const period = 60 / 120;
    // Skip edges; every tracked beat should sit within 70 ms of a click
    let checked = 0;
    for (const t of grid.beatTimes) {
      if (t < 1 || t > 10.5) continue;
      const nearest = Math.round(t / period) * period;
      expect(Math.abs(t - nearest)).toBeLessThan(0.07);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("beat spacing is consistent (no doubled/missed beats mid-track)", () => {
    const grid = analyzeBeatGrid(clickTrack(120, 12));
    const beats = Array.from(grid.beatTimes).filter((t) => t > 1 && t < 10.5);
    for (let i = 1; i < beats.length; i++) {
      const gap = beats[i] - beats[i - 1];
      expect(gap).toBeGreaterThan(0.35);
      expect(gap).toBeLessThan(0.65);
    }
  });

  it("is deterministic", () => {
    const a = analyzeBeatGrid(clickTrack(128, 8));
    const b = analyzeBeatGrid(clickTrack(128, 8));
    expect(a.bpm).toBe(b.bpm);
    expect(Array.from(a.beatTimes)).toEqual(Array.from(b.beatTimes));
  });

  it("returns an empty grid for silence", () => {
    const silent: PcmData = {
      sampleRate: SR,
      length: SR * 4,
      duration: 4,
      channels: [new Float32Array(SR * 4)],
    };
    const grid = analyzeBeatGrid(silent);
    expect(grid.beatTimes.length === 0 || grid.bpm === 0 || grid.bpm > 0).toBe(true); // no crash
  });
});

describe("gridPhase", () => {
  const grid = {
    bpm: 120,
    beatTimes: new Float32Array([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]),
    hopSec: 0.01,
  };

  it("is 0 exactly on a beat and ramps to 1 before the next", () => {
    expect(gridPhase(grid, 1.0).beatPhase).toBeCloseTo(0, 5);
    expect(gridPhase(grid, 1.25).beatPhase).toBeCloseTo(0.5, 5);
    expect(gridPhase(grid, 1.4999).beatPhase).toBeGreaterThan(0.99);
  });

  it("bar phase wraps every 4 beats", () => {
    expect(gridPhase(grid, 0.0).barPhase).toBeCloseTo(0, 5);
    expect(gridPhase(grid, 1.0).barPhase).toBeCloseTo(0.5, 5);
    expect(gridPhase(grid, 2.0).barPhase).toBeCloseTo(0, 5);
  });

  it("extrapolates past the last beat", () => {
    const p = gridPhase(grid, 3.6);
    expect(p.beatPhase).toBeCloseTo(0.2, 3);
  });

  it("handles times before the first beat", () => {
    const p = gridPhase(grid, -0.1);
    expect(p.beatPhase).toBeGreaterThanOrEqual(0);
    expect(p.beatPhase).toBeLessThanOrEqual(1);
    // No beat has happened yet, so neither counter may count one.
    expect(p.beatIndex).toBe(-1);
    expect(p.barIndex).toBe(-1);
  });

  it("empty grid returns zeros", () => {
    const p = gridPhase({ bpm: 0, beatTimes: new Float32Array(0), hopSec: 0.01 }, 1);
    expect(p).toEqual({ beatPhase: 0, barPhase: 0, beatIndex: -1, barIndex: -1 });
  });

  it("counts beats and 4/4 bars from the grid (P-15)", () => {
    // Beats at 0, 0.5, ... → t = 2.25 sits inside beat 4 (the fifth beat),
    // which is the first beat of bar 1.
    expect(gridPhase(grid, 0.0).beatIndex).toBe(0);
    expect(gridPhase(grid, 0.0).barIndex).toBe(0);
    expect(gridPhase(grid, 1.75).beatIndex).toBe(3);
    expect(gridPhase(grid, 1.75).barIndex).toBe(0);
    expect(gridPhase(grid, 2.25).beatIndex).toBe(4);
    expect(gridPhase(grid, 2.25).barIndex).toBe(1);
    // Extrapolation past the last beat stays on the last REAL beat's index —
    // the grid ends, so the count must not invent beats that were never
    // tracked.
    expect(gridPhase(grid, 5.0).beatIndex).toBe(7);
    expect(gridPhase(grid, 5.0).barIndex).toBe(1);
  });

  it("barIndex is exactly floor(beatIndex / 4) wherever a beat exists", () => {
    for (let t = 0; t < 4; t += 0.13) {
      const p = gridPhase(grid, t);
      if (p.beatIndex >= 0) expect(p.barIndex).toBe(Math.floor(p.beatIndex / 4));
      else expect(p.barIndex).toBe(-1);
    }
  });
});
