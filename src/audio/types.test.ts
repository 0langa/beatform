import { describe, expect, it } from "vitest";
import { SYNC_TRIO_STEP } from "./types";

/**
 * C5(c): the sync-trio sliders (Smoothing/Attack/Release on the Sync page)
 * refined their shared step 0.01 -> 0.002 so the owner-approved "blacklight"
 * registry theme's `sync.attack = 0.012` — off the old 0.01 grid — becomes
 * reachable. Same on-grid check as factoryThemes.test.ts's `expectOnGrid`
 * (a value is legal iff (v - min) / step lands within float tolerance of a
 * whole number); reimplemented locally since that helper isn't exported —
 * blacklight itself lives in the gallery repo, not this one, so there is no
 * theme object here to run it against. This file pins the two properties
 * that make the refinement safe instead: the specific value the registry
 * needs, and the E5-style integer-divisor law that keeps every value already
 * reachable on the old grid reachable on the new one.
 */
function stepsFromZero(v: number, step: number): number {
  return v / step;
}
function isOnGrid(v: number, step: number): boolean {
  const steps = stepsFromZero(v, step);
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

describe("SYNC_TRIO_STEP (C5(c))", () => {
  it("puts blacklight's approved sync.attack = 0.012 on-grid", () => {
    expect(isOnGrid(0.012, SYNC_TRIO_STEP)).toBe(true);
    // Exactly 6 steps from 0, not merely "close enough" — nails down the
    // specific reachable value, not just the tolerance window around it.
    expect(stepsFromZero(0.012, SYNC_TRIO_STEP)).toBeCloseTo(6, 9);
  });

  it("was NOT reachable on the old 0.01 grid — the refinement has a reason to exist", () => {
    expect(isOnGrid(0.012, 0.01)).toBe(false);
  });

  it("old step (0.01) is an integer multiple of the new step — every value already on the old grid stays reachable", () => {
    const ratio = 0.01 / SYNC_TRIO_STEP;
    expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-6);
    expect(Math.round(ratio)).toBe(5);
  });

  it("every multiple of the old 0.01 grid across the full 0..1 sync range is still on-grid", () => {
    for (let i = 0; i <= 100; i++) {
      const v = Number((i * 0.01).toFixed(2));
      expect(isOnGrid(v, SYNC_TRIO_STEP), `${v} fell off the refined grid`).toBe(true);
    }
  });
});
