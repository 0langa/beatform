import { describe, expect, it } from "vitest";
import { crossedBoundary, hasFutureBoundary, isQuantizeMode } from "./quantize";

// Beats at 120 BPM: every 0.5 s. Bars (every 4th) at 0, 2, 4, 6 s.
const beats = new Float32Array([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);

describe("crossedBoundary", () => {
  it("never fires when off", () => {
    expect(crossedBoundary(beats, 0.4, 0.6, "off")).toBe(false);
  });

  it("fires on a beat inside (prev, cur]", () => {
    expect(crossedBoundary(beats, 0.4, 0.6, "beat")).toBe(true); // crosses 0.5
    expect(crossedBoundary(beats, 0.6, 0.9, "beat")).toBe(false); // no beat in window
  });

  it("is half-open: a beat exactly at prev does NOT re-fire, at cur does", () => {
    expect(crossedBoundary(beats, 0.5, 0.7, "beat")).toBe(false); // 0.5 == prev, excluded
    expect(crossedBoundary(beats, 0.3, 0.5, "beat")).toBe(true); // 0.5 == cur, included
  });

  it("bar mode fires only on every 4th beat (downbeats)", () => {
    // Crossing 1.5 s (beat index 3) is a beat but NOT a bar
    expect(crossedBoundary(beats, 1.4, 1.6, "beat")).toBe(true);
    expect(crossedBoundary(beats, 1.4, 1.6, "bar")).toBe(false);
    // Crossing 2.0 s (beat index 4) IS a bar
    expect(crossedBoundary(beats, 1.9, 2.1, "bar")).toBe(true);
  });

  it("never fires on a pause or backward seek (prev >= cur)", () => {
    expect(crossedBoundary(beats, 0.6, 0.6, "beat")).toBe(false); // paused
    expect(crossedBoundary(beats, 2.0, 0.1, "bar")).toBe(false); // seeked back
  });

  it("handles a window spanning several beats (only needs one hit)", () => {
    expect(crossedBoundary(beats, 0.1, 1.7, "beat")).toBe(true);
    expect(crossedBoundary(beats, 0.1, 1.7, "bar")).toBe(false); // no downbeat between 0.1 and 1.7 (next is 2.0)
  });
});

describe("hasFutureBoundary", () => {
  it("true when a boundary lies ahead", () => {
    expect(hasFutureBoundary(beats, 1.2, "beat")).toBe(true); // 1.5 ahead
    expect(hasFutureBoundary(beats, 1.2, "bar")).toBe(true); // 2.0 ahead
  });

  it("false past the last relevant boundary", () => {
    expect(hasFutureBoundary(beats, 4.1, "beat")).toBe(false); // last beat is 4.0
    expect(hasFutureBoundary(beats, 3.9, "bar")).toBe(true); // last downbeat (index 8) is 4.0, still ahead
    expect(hasFutureBoundary(beats, 4.1, "bar")).toBe(false); // past the 4.0 downbeat
  });

  it("false with no usable grid", () => {
    expect(hasFutureBoundary(new Float32Array([]), 0, "beat")).toBe(false);
    expect(hasFutureBoundary(new Float32Array([1]), 0, "beat")).toBe(false); // <2 beats
    expect(hasFutureBoundary(beats, 0, "off")).toBe(false);
  });
});

describe("isQuantizeMode", () => {
  it("accepts valid modes and rejects junk", () => {
    expect(isQuantizeMode("bar")).toBe(true);
    expect(isQuantizeMode("beat")).toBe(true);
    expect(isQuantizeMode("off")).toBe(true);
    expect(isQuantizeMode("bars")).toBe(false);
    expect(isQuantizeMode(null)).toBe(false);
  });
});
