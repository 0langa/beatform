import { describe, expect, it } from "vitest";
import { synthwave } from "./synthwave";
import { allParams, defaultParams, groupParams } from "../types";

/**
 * Synthwave depth wave (Track B, audit RP-24.14) — the mode-local contracts.
 *
 * The registry-wide rules (groups resolve, toggles are mod:"off", enums snap,
 * style values stay on their grids) live in paramModel.test.ts and
 * presetStyles.test.ts; the golden shader test freezes the assembled WGSL.
 * What THIS file pins is the wave's own promises: the new elements are
 * absent at the defaults, the banding params reproduce the pre-wave
 * constants exactly, the road shares the grid's time source, and the style
 * deck actually uses the new vocabulary.
 */
describe("synthwave depth wave", () => {
  const defaults = defaultParams(synthwave);
  const byKey = new Map(allParams(synthwave).map((p) => [p.key, p]));

  describe("default neutrality (the device pixel matrix enforces the pixels; this pins the mechanism)", () => {
    it("road and skyline are absent at the defaults", () => {
      expect(defaults.roadW).toBe(0);
      expect(defaults.skyline).toBe(0);
    });

    it("the road and skyline blocks are gated on their master params", () => {
      // The whole block sits behind the gate, so at the default 0 the new
      // code contributes exactly nothing — not "approximately nothing".
      expect(synthwave.wgsl).toContain("if (P_roadW() > 0.004)");
      expect(synthwave.wgsl).toContain("if (P_skyline() > 0.004)");
      expect(synthwave.wgsl).toContain("if (P_windows() > 0.004)");
    });

    it("sun banding defaults reproduce the pre-wave constants exactly", () => {
      // The pre-wave shader hardcoded: fract(scanPos * (28.0 + scanPos * 70.0))
      // behind step(0.5, ...), and a +45 degree gradient offset. The params
      // must resolve to the SAME numbers at their defaults...
      expect(defaults.scanCount).toBe(28);
      expect(defaults.scanWidth).toBe(0.5);
      expect(defaults.scanPhase).toBe(0);
      expect(defaults.sunWarm).toBe(1);
      // ...and the WGSL must consume them in the exactly-compatible shape:
      // count x 2.5 keeps the old widening 70 at count 28, 1 - width keeps
      // the old duty threshold 0.5, and shift/warmth enter as +0 and x1.
      expect(synthwave.wgsl).toContain("P_scanCount() + scanPos * (P_scanCount() * 2.5)");
      expect(synthwave.wgsl).toContain("step(1.0 - P_scanWidth()");
      expect(synthwave.wgsl).toContain("+ P_scanPhase()");
      expect(synthwave.wgsl).toContain("45.0 * P_sunWarm()");
    });

    it("sub-params of the gated elements default to neutral working values, not zero", () => {
      // Raising the single master param must land on the genre look at once —
      // the starDensity-behind-Stars pattern the mode already ships.
      expect(defaults.roadGlow).toBe(1);
      expect(defaults.roadLanes).toBe(1);
      expect(defaults.skyDensity).toBeGreaterThan(0);
      expect(defaults.windows).toBeGreaterThan(0);
    });
  });

  describe("determinism plumbing", () => {
    it("lane dashes ride the grid's own scroll variable", () => {
      // The road may not grow a second clock: dashes reuse `scroll` (beat-
      // locked or free, exactly as the grid resolved it) at a frequency that
      // stays continuous across the bar wrap (dens * 0.5 -> 4 beats always
      // advance an integer number of dash cycles).
      expect(synthwave.wgsl).toContain("fract((persp - scroll) * dens * 0.5)");
    });

    it("window glimmer reads the existing treble feature lane", () => {
      expect(synthwave.wgsl).toContain("u.treble");
    });
  });

  describe("curated tier (re-curation contract)", () => {
    it("main holds 10-12 knobs", () => {
      expect(synthwave.params.length).toBeGreaterThanOrEqual(10);
      expect(synthwave.params.length).toBeLessThanOrEqual(12);
    });

    it("main covers all five depth lenses: shape, color, motion, beat, texture", () => {
      const groups = new Set(groupParams(synthwave, synthwave.params).map((v) => v.group.id));
      for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
        expect(groups.has(lens), `main tier is missing the ${lens} lens`).toBe(true);
      }
    });

    it("the three horizon elements sit in the curated tier together", () => {
      const mainKeys = new Set(synthwave.params.map((p) => p.key));
      expect(mainKeys.has("roadW")).toBe(true);
      expect(mainKeys.has("skyline")).toBe(true);
      expect(mainKeys.has("mountains")).toBe(true);
    });
  });

  describe("new-param metadata (wave-0 conventions)", () => {
    it("band count snaps under modulation and tapers logarithmically", () => {
      const spec = byKey.get("scanCount")!;
      expect(spec.mod).toBe("snap");
      expect(spec.taper).toBe("log");
      expect(spec.step).toBe(1);
      expect(spec.min).toBeGreaterThan(0);
    });

    it("lane markers are a snapped enum covering 0..3", () => {
      const spec = byKey.get("roadLanes")!;
      expect(spec.control).toBe("enum");
      expect(spec.mod).toBe("snap");
      if (spec.control === "enum") {
        expect(spec.options.map((o) => o.value)).toEqual([0, 1, 2, 3]);
      }
    });

    it("the new continuous params stay smooth modulation targets", () => {
      for (const key of [
        "roadW",
        "roadGlow",
        "skyline",
        "skyDensity",
        "windows",
        "scanWidth",
        "scanPhase",
        "sunWarm",
      ]) {
        const spec = byKey.get(key);
        expect(spec, `param ${key} missing`).toBeDefined();
        expect(spec!.mod, `${key} must remain a continuous mod target`).toBeUndefined();
      }
    });

    it("every knob ships a hint in the app voice", () => {
      for (const spec of allParams(synthwave)) {
        expect(spec.hint, `${spec.key} has no hint`).toBeTruthy();
      }
    });
  });

  describe("style deck uses the new vocabulary", () => {
    const styles = synthwave.styles ?? [];

    it("ships the four depth-wave looks", () => {
      const ids = styles.map((s) => s.id);
      for (const id of ["outrun", "metropolis", "poster", "cityLimits"]) {
        expect(ids, `missing style ${id}`).toContain(id);
      }
    });

    it("some look drives the road, some raises the skyline, some restyles the bands", () => {
      expect(styles.some((s) => (s.values.roadW ?? 0) > 0)).toBe(true);
      expect(styles.some((s) => (s.values.skyline ?? 0) > 0)).toBe(true);
      expect(
        styles.some((s) => s.values.scanCount !== undefined || s.values.scanWidth !== undefined),
      ).toBe(true);
    });

    it("Midnight Drive finally has a road to drive", () => {
      const midnight = styles.find((s) => s.id === "midnight")!;
      expect(midnight.values.roadW ?? 0).toBeGreaterThan(0);
    });

    it("the road and skyline showcases exercise their sub-params", () => {
      const outrun = styles.find((s) => s.id === "outrun")!;
      expect(outrun.values.roadLanes).toBeDefined();
      expect(outrun.values.roadGlow).toBeDefined();
      const metropolis = styles.find((s) => s.id === "metropolis")!;
      expect(metropolis.values.skyDensity).toBeDefined();
      expect(metropolis.values.windows).toBeDefined();
    });
  });
});
