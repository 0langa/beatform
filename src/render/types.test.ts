import { describe, expect, it } from "vitest";
import { defaultParams, paramOr } from "./types";
import { spectrumScape } from "./presets/spectrumScape";

// M19: renderMesh3d used to hardcode a fallback literal for each of
// spectrum-scape's 13 params (e.g. `params["camPitch"] ?? 32`). The literals
// happened to match the preset's own ParamSpec.default, but nothing enforced
// that — a designer changing a default in spectrumScape.ts would silently
// leave the renderer's copy stale. paramOr() is the single source of truth
// fix: it reads the fallback straight from the preset's own spec, so this
// test exercises the EXACT function renderMesh3d now calls, not a parallel
// reimplementation.
describe("paramOr", () => {
  it("falls back to spectrum-scape's own ParamSpec default for every key renderMesh3d reads", () => {
    const expected: Record<string, number> = {
      hue: 200,
      heightScale: 6,
      camPitch: 32,
      camDist: 15,
      camSpin: 12,
      emissive: 0.5,
      fov: 50,
      hueRange: 120,
      barWidth: 0.42,
      spacing: 0.6,
      light: 0.9,
      camYaw: 30,
      targetY: 1,
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
