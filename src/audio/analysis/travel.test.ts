import { describe, expect, it } from "vitest";
import { shiftTravelCurve, travelAt, travelCurveOf, TRAVEL_HOP_SEC } from "./travel";

const SR = 48_000;

/** A tone whose amplitude is `amp(t)`, `seconds` long. */
function signal(seconds: number, amp: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = amp(t) * Math.sin(t * 440 * Math.PI * 2);
  }
  return out;
}

describe("travel curve", () => {
  it("is plain time for constant loudness", () => {
    const c = travelCurveOf(
      signal(4, () => 0.3),
      SR,
    )!;
    for (let t = 0; t <= 4; t += 0.37) expect(travelAt(c, t)).toBeCloseTo(t, 3);
  });

  it("is plain time for digital silence", () => {
    const c = travelCurveOf(new Float32Array(SR * 2), SR)!;
    expect(travelAt(c, 1.25)).toBeCloseTo(1.25, 6);
  });

  it("returns null when the audio is shorter than two hops", () => {
    expect(travelCurveOf(new Float32Array(10), SR)).toBeNull();
  });

  it("is monotonic, starts at 0, and covers exactly the track's duration on average", () => {
    const c = travelCurveOf(
      signal(10, (t) => (t < 5 ? 0.05 : 0.5)),
      SR,
    )!;
    expect(c.values[0]).toBe(0);
    for (let i = 1; i < c.values.length; i++) expect(c.values[i]).toBeGreaterThan(c.values[i - 1]);
    const end = (c.values.length - 1) * c.hopSec;
    expect(travelAt(c, end)).toBeCloseTo(end, 2);
  });

  it("moves slowly through the quiet half and surges through the loud half", () => {
    const c = travelCurveOf(
      signal(10, (t) => (t < 5 ? 0.05 : 0.5)),
      SR,
    )!;
    const quiet = travelAt(c, 5) - travelAt(c, 0);
    const loud = travelAt(c, 10) - travelAt(c, 5);
    // Amplitude ratio 10:1 → the loud half covers ~10× the travel.
    expect(loud / quiet).toBeGreaterThan(8);
    expect(loud / quiet).toBeLessThan(12);
    expect(quiet + loud).toBeCloseTo(10, 1);
  });

  it("never parks on a silent intro: the floor keeps a minimum rate", () => {
    const c = travelCurveOf(
      signal(6, (t) => (t < 3 ? 0 : 0.4)),
      SR,
    )!;
    const intro = travelAt(c, 3) - travelAt(c, 0);
    expect(intro).toBeGreaterThan(0.2);
    expect(intro).toBeLessThan(1.5);
  });

  it("interpolates linearly between hops and continues at 1 s/s past the end", () => {
    const c = { hopSec: TRAVEL_HOP_SEC, values: new Float32Array([0, 0.1, 0.3, 0.6]) };
    expect(travelAt(c, 0.025)).toBeCloseTo(0.05, 6);
    expect(travelAt(c, 0.1)).toBeCloseTo(0.3, 6);
    expect(travelAt(c, 0.15)).toBeCloseTo(0.6, 6);
    expect(travelAt(c, 0.25)).toBeCloseTo(0.7, 6);
    expect(travelAt(c, -1)).toBe(-1);
    expect(travelAt(c, 0)).toBe(0);
  });

  it("a shifted curve reads the same motion from its new origin", () => {
    const c = travelCurveOf(
      signal(8, (t) => 0.1 + 0.3 * (0.5 + 0.5 * Math.sin(t))),
      SR,
    )!;
    const start = 2.71;
    const s = shiftTravelCurve(c, start);
    expect(travelAt(s, 0)).toBe(0);
    for (const t of [0.013, 0.5, 1.337, 4]) {
      expect(travelAt(s, t)).toBeCloseTo(travelAt(c, start + t) - travelAt(c, start), 3);
    }
    expect(shiftTravelCurve(c, 0)).toBe(c);
  });
});
