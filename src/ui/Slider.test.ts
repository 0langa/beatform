import { describe, expect, it } from "vitest";
import { logPos, logVal, snapToStep, taperStep } from "./Slider";

/**
 * The log-taper position math (ParamSpec.taper === "log", RP-14).
 *
 * The slider runs its native input in a normalized 0..1 POSITION domain and
 * maps position <-> value exponentially; everything downstream (documents,
 * modulation, MIDI, the shader ABI) keeps raw values. These tests pin the
 * mapping itself and the two properties the component build relies on:
 * grid-stable round trips, and keyboard notches that always advance.
 */

/** The proving case: nebula's Scale (0.8..6, declared step 0.1). */
const MIN = 0.8;
const MAX = 6;
const STEP = 0.1;

describe("logPos / logVal", () => {
  it("maps the endpoints exactly onto 0 and 1 (and back)", () => {
    expect(logPos(MIN, MIN, MAX)).toBe(0);
    expect(logPos(MAX, MIN, MAX)).toBe(1);
    expect(logVal(0, MIN, MAX)).toBe(MIN);
    expect(logVal(1, MIN, MAX)).toBeCloseTo(MAX, 10);
  });

  it("round-trips position <-> value across the whole range", () => {
    for (let i = 0; i <= 200; i++) {
      const v = MIN + ((MAX - MIN) * i) / 200;
      expect(logVal(logPos(v, MIN, MAX), MIN, MAX)).toBeCloseTo(v, 9);
    }
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      expect(logPos(logVal(t, MIN, MAX), MIN, MAX)).toBeCloseTo(t, 9);
    }
  });

  it("is monotonic, and gives equal ratios equal travel", () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const p = logPos(MIN + ((MAX - MIN) * i) / 100, MIN, MAX);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
    // The taper's whole point: doubling the value costs the same travel
    // anywhere on the track.
    const low = logPos(2, MIN, MAX) - logPos(1, MIN, MAX);
    const high = logPos(4.8, MIN, MAX) - logPos(2.4, MIN, MAX);
    expect(low).toBeCloseTo(high, 9);
    // ...and the crowded bottom of the linear track gets real room: 0.8..2
    // was 23% of a linear slider, and is ~45% of the log one.
    expect(logPos(2, MIN, MAX)).toBeGreaterThan(0.44);
  });

  it("clamps out-of-range inputs instead of extrapolating", () => {
    expect(logPos(0.1, MIN, MAX)).toBe(0);
    expect(logPos(99, MIN, MAX)).toBe(1);
    expect(logVal(-1, MIN, MAX)).toBe(MIN);
    expect(logVal(2, MIN, MAX)).toBeCloseTo(MAX, 10);
  });

  it("degrades safely on ranges a log cannot describe (min <= 0)", () => {
    // The component falls back to linear for these; the math must still
    // return finite anchors rather than NaN if called anyway.
    expect(logPos(0.5, 0, 1)).toBe(0);
    expect(logVal(0.5, 0, 1)).toBe(0);
    expect(logPos(0.5, -1, 1)).toBe(0);
  });
});

describe("taperStep", () => {
  it("refines nebula's 0.1 grid to 0.01 so the low end stays keyboard-reachable", () => {
    // One UA keyboard notch on a step="any" input is 1% of the position
    // range; at v = min that covers 0.8 * ln(7.5) * 0.01 ≈ 0.016 of value —
    // under half the declared 0.1 step, so snapping to the declared grid
    // would round every press back where it started.
    expect(taperStep(MIN, MAX, STEP)).toBeCloseTo(0.01, 12);
  });

  it("keeps a declared step that keyboard notches can already reach", () => {
    // A 20..20000 Hz edge with step 1: the worst notch is 20 * ln(1000) * 1%
    // ≈ 1.38 ≥ 1, so the declared grid stays.
    expect(taperStep(20, 20000, 1)).toBe(1);
  });

  it("passes degenerate inputs through unchanged", () => {
    expect(taperStep(0, 1, 0.1)).toBe(0.1);
    expect(taperStep(1, 1, 0.1)).toBe(0.1);
    expect(taperStep(1, 2, 0)).toBe(0);
  });
});

describe("taper + snap, as the slider composes them", () => {
  const grid = taperStep(MIN, MAX, STEP);

  it("round-trips every grid value through the thumb exactly", () => {
    // A stored value on the effective grid must survive value -> position ->
    // value -> snap byte-identically, or merely rendering the row would
    // rewrite the document.
    const steps = Math.round((MAX - MIN) / grid);
    for (let i = 0; i <= steps; i++) {
      const v = snapToStep(MIN + i * grid, MIN, MAX, grid);
      const back = snapToStep(logVal(logPos(v, MIN, MAX), MIN, MAX), MIN, MAX, grid);
      expect(back).toBe(v);
    }
  });

  it("a 1% keyboard notch always advances the snapped value", () => {
    // The property taperStep exists to guarantee: nowhere on the track can
    // an arrow press round back to where it started (dead keys).
    const steps = Math.round((MAX - MIN) / grid);
    for (let i = 0; i < steps; i++) {
      const v = snapToStep(MIN + i * grid, MIN, MAX, grid);
      const next = snapToStep(logVal(logPos(v, MIN, MAX) + 0.01, MIN, MAX), MIN, MAX, grid);
      expect(next, `arrow from ${v}`).toBeGreaterThan(v);
    }
  });
});
