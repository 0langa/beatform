import { describe, expect, it } from "vitest";
import { defaultParams, paramOr } from "./types";
import { spectrumScape } from "./presets/spectrumScape";

// M19: renderMesh3d used to hardcode a fallback literal for each of
// spectrum-scape's params (e.g. `params["camPitch"] ?? 32`). The literals
// happened to match the preset's own ParamSpec.default, but nothing enforced
// that — a designer changing a default in spectrumScape.ts would silently
// leave the renderer's copy stale. paramOr() is the single source of truth
// fix: it reads the fallback straight from the preset's own spec, so this
// test exercises the EXACT function renderMesh3d now calls, not a parallel
// reimplementation. The W1 depth wave grew the map from 13 keys to 27; every
// key renderMesh3d packs into the M3U uniform must appear here.
describe("paramOr", () => {
  it("falls back to spectrum-scape's own ParamSpec default for every key renderMesh3d reads", () => {
    const expected: Record<string, number> = {
      hue: 200,
      heightScale: 6,
      camPitch: 32,
      camDist: 15,
      camSpin: 12,
      emissive: 0.5,
      layout: 0,
      barShape: 0,
      saturation: 1,
      lightness: 1,
      hotBeat: 0.6,
      bandGlow: 0,
      fov: 50,
      hueRange: 120,
      barWidth: 0.42,
      spacing: 0.6,
      light: 0.9,
      camYaw: 30,
      targetY: 1,
      driveHeight: 0.7,
      hotDrive: 0.6,
      glowBeat: 0.5,
      hotWindow: 0.45,
      hueLift: 24,
      fillLight: 0.35,
      ambientLight: 1,
      fogDensity: 0.045,
    };
    for (const [key, value] of Object.entries(expected)) {
      expect(paramOr(spectrumScape, {}, key)).toBe(value);
    }
    // Cross-check against the preset's own defaultParams() too, so this test
    // would fail if spectrumScape.ts and this list ever drift apart.
    expect(defaultParams(spectrumScape)).toEqual(expected);
  });

  it("prefers an explicit param value over the spec default", () => {
    expect(paramOr(spectrumScape, { camPitch: 77 }, "camPitch")).toBe(77);
  });

  it("falls back to 0 for a key with no spec entry at all", () => {
    expect(paramOr(spectrumScape, {}, "doesNotExist")).toBe(0);
  });
});
