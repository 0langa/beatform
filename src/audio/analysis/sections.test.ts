import { describe, expect, it } from "vitest";
import { detectSections, SECTION_PULSE_DECAY, sectionStateAt } from "./sections";

const SR = 48000;

/** Deterministic pseudo-noise via summed detuned sines (no Math.random). */
function fillTexture(
  out: Float32Array,
  from: number,
  to: number,
  freqs: number[],
  amp: number,
): void {
  for (const f of freqs) {
    for (let i = from; i < to; i++) {
      out[i] += amp * Math.sin((2 * Math.PI * f * i) / SR + f);
    }
  }
}

describe("section detection", () => {
  it("finds the boundary in a two-part track (quiet lows → loud highs)", () => {
    const seconds = 60;
    const data = new Float32Array(SR * seconds);
    fillTexture(data, 0, SR * 30, [110, 165, 220], 0.15); // mellow low half
    fillTexture(data, SR * 30, SR * 60, [2000, 3100, 4400, 6500], 0.4); // bright loud half
    const bounds = detectSections(data, SR);
    expect(bounds.length).toBeGreaterThanOrEqual(1);
    const nearest = bounds.reduce((a, b) => (Math.abs(b - 30) < Math.abs(a - 30) ? b : a));
    expect(Math.abs(nearest - 30)).toBeLessThan(4);
  });

  it("finds two boundaries in a three-part track", () => {
    const seconds = 90;
    const data = new Float32Array(SR * seconds);
    fillTexture(data, 0, SR * 30, [110, 220], 0.2);
    fillTexture(data, SR * 30, SR * 60, [3000, 4500, 6000], 0.45);
    fillTexture(data, SR * 60, SR * 90, [110, 220], 0.2);
    const bounds = detectSections(data, SR);
    expect(bounds.length).toBeGreaterThanOrEqual(2);
    const near30 = bounds.some((b) => Math.abs(b - 30) < 4);
    const near60 = bounds.some((b) => Math.abs(b - 60) < 4);
    expect(near30).toBe(true);
    expect(near60).toBe(true);
  });

  it("reports no boundaries for homogeneous audio", () => {
    const data = new Float32Array(SR * 60);
    fillTexture(data, 0, data.length, [440, 660], 0.3);
    expect(detectSections(data, SR)).toEqual([]);
  });

  it("returns empty for very short tracks", () => {
    const data = new Float32Array(SR * 5);
    fillTexture(data, 0, data.length, [440], 0.3);
    expect(detectSections(data, SR)).toEqual([]);
  });

  it("is deterministic", () => {
    const data = new Float32Array(SR * 40);
    fillTexture(data, 0, SR * 20, [110], 0.2);
    fillTexture(data, SR * 20, SR * 40, [4000, 5000], 0.4);
    expect(detectSections(data, SR)).toEqual(detectSections(data, SR));
  });
});

describe("sectionStateAt (P-15)", () => {
  const bounds = [30, 62.5, 100];

  it("indexes sections by counting crossed boundaries", () => {
    expect(sectionStateAt(bounds, 0).sectionIndex).toBe(0);
    expect(sectionStateAt(bounds, 29.999).sectionIndex).toBe(0);
    expect(sectionStateAt(bounds, 30).sectionIndex).toBe(1);
    expect(sectionStateAt(bounds, 75).sectionIndex).toBe(2);
    expect(sectionStateAt(bounds, 500).sectionIndex).toBe(3);
  });

  it("an empty boundary list is one whole-track section, pulse-free", () => {
    expect(sectionStateAt([], 42)).toEqual({ sectionIndex: 0, sectionPulse: 0 });
  });

  it("pulses to 1 at a boundary and decays exponentially after", () => {
    expect(sectionStateAt(bounds, 30).sectionPulse).toBe(1);
    const at250ms = sectionStateAt(bounds, 30.25).sectionPulse;
    expect(at250ms).toBeCloseTo(Math.exp(-0.25 * SECTION_PULSE_DECAY), 10);
    // Effectively gone within ~1.5 s, long before the next boundary.
    expect(sectionStateAt(bounds, 31.5).sectionPulse).toBeLessThan(0.01);
    // No pulse before the FIRST boundary — the track start is not a change.
    expect(sectionStateAt(bounds, 5).sectionPulse).toBe(0);
  });

  it("is a pure function of (bounds, t): seek-stable by construction", () => {
    // Same t, any visit order — byte-identical results.
    const a = sectionStateAt(bounds, 62.7);
    sectionStateAt(bounds, 5);
    sectionStateAt(bounds, 400);
    expect(sectionStateAt(bounds, 62.7)).toEqual(a);
  });
});
