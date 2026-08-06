import { describe, expect, it } from "vitest";
import { nebula, NEBULA_SAT_AUTHORED } from "./nebula";
import { allParams, defaultParams, groupParams } from "../types";

/**
 * Nebula depth wave (B0 batch 2). Two contracts live here:
 *
 *  - RP-6: the advanced `saturation` moved from a raw 0..1 palette mix to
 *    the roster colour-tier scaler (0..2, neutral 1) — the ONE sanctioned
 *    non-neutral change of the wave, made user-invisible by anchoring the
 *    shader on the old authored point and migrating stored values by the
 *    exact inverse (schema v14, state/project.ts). This file proves the
 *    inverse really is exact where it must be: at the old grid's boundary
 *    values the round-trip is bit-identical in f64 AND under f32 rounding,
 *    and across the whole old grid it stays far below quantization.
 *  - Depth axes (two-tone palette, star parallax, directional wind): all
 *    absent at their defaults behind explicit gates, so the factory frame is
 *    pixel-identical. The device GPU pixel matrix holds the rest
 *    (nebula/@defaults must NOT move; style hashes move by design — the
 *    deck was reworked onto the new axes).
 */

// --- Lift the shipped arithmetic out of the WGSL (aurora.test.ts's
// technique): if the shader line changes, the measurement below changes with
// it instead of quietly going stale.

/** The third mix() argument of the chroma line — the saturation term. */
const satExpr = /let chroma = mix\(0\.06, 0\.5, ([^;]*)\);/.exec(nebula.wgsl)?.[1];
const satTOf = (() => {
  if (!satExpr) throw new Error("chroma line not found in the WGSL");
  return new Function("P_saturation", `return ${satExpr};`) as (p: () => number) => number;
})();
/** satT the NEW shader computes for a stored scaler value (f64 lane). */
const satT = (scaler: number) => satTOf(() => scaler);

describe("RP-6: saturation is the roster colour-tier scaler", () => {
  const specs = new Map(allParams(nebula).map((p) => [p.key, p]));
  const spec = specs.get("saturation")!;

  it("spec carries the contract shape (0..2, neutral 1) in the colour lens", () => {
    expect([spec.min, spec.max, spec.default]).toEqual([0, 2, 1]);
    expect(spec.group).toBe("color");
    // Alignment, not promotion: the knob stays in the expert tier.
    expect(nebula.advanced!.some((p) => p.key === "saturation")).toBe(true);
  });

  it("the shader anchors the scaler on the shipped authored point", () => {
    // The interpolated constant is the SAME one the v14 migration divides
    // by (state/project.ts imports it) — asserted here so neither side can
    // drift from the other, or from the shipped WGSL text.
    expect(NEBULA_SAT_AUTHORED).toBe(0.75);
    expect(nebula.wgsl).toContain(`P_saturation() * ${NEBULA_SAT_AUTHORED}`);
  });

  it("neutral 1 feeds mix() the exact old-default argument — f64 and f32 alike", () => {
    // The old shader loaded 0.75 from the params buffer; the new one loads
    // 1 and multiplies by 0.75. Multiply-by-one is exact in IEEE at any
    // width, so mix() receives a bit-identical third argument and the
    // default frame cannot move.
    expect(satT(1)).toBe(0.75);
    expect(Math.fround(Math.fround(1) * Math.fround(NEBULA_SAT_AUTHORED))).toBe(0.75);
  });

  it("the v14 remap (v / 0.75) is the exact inverse at the old boundary values", () => {
    // 0 (old floor), 0.75 (old default), 1 (old ceiling). The middle one is
    // v/v = 1 exactly; the ends round-trip through ties-to-even to the exact
    // old satT in f64, and through f32 rounding on the GPU lane.
    for (const oldV of [0, 0.75, 1]) {
      const migrated = oldV / NEBULA_SAT_AUTHORED;
      expect(satT(migrated)).toBe(oldV);
      const gpu = Math.fround(Math.fround(migrated) * Math.fround(NEBULA_SAT_AUTHORED));
      expect(gpu).toBe(Math.fround(oldV));
    }
    expect(0.75 / NEBULA_SAT_AUTHORED).toBe(1);
    expect(1 / NEBULA_SAT_AUTHORED).toBe(4 / 3);
  });

  it("...and user-invisibly identical across the whole old 0.02 grid", () => {
    for (let i = 0; i <= 50; i++) {
      const oldV = i * 0.02;
      // f64 lane: the migration's own arithmetic.
      expect(satT(oldV / NEBULA_SAT_AUTHORED)).toBeCloseTo(oldV, 15);
      // f32 lane: what the GPU actually computes from the stored value.
      const gpu = Math.fround(
        Math.fround(oldV / NEBULA_SAT_AUTHORED) * Math.fround(NEBULA_SAT_AUTHORED),
      );
      // Within ~1 ulp at 1.0 — three orders of magnitude below the 8-bit
      // output quantum even before the 0.44 chroma slope shrinks it.
      expect(Math.abs(gpu - Math.fround(oldV))).toBeLessThanOrEqual(1.2e-7);
    }
  });
});

describe("depth-wave axes: neutral at default, behind explicit gates", () => {
  const specs = new Map(allParams(nebula).map((p) => [p.key, p]));

  it("two-tone defaults to a single ramp, gated inside the palette family", () => {
    expect(specs.get("duo")!.default).toBe(0);
    // The absence is a branch that returns the caller's colour untouched —
    // no blend arithmetic at all — not a mix toward zero downstream.
    expect(nebula.wgsl).toContain("if (P_duo() < 0.001) { return palIn; }");
    // Definition + BOTH palette call sites (front filaments and the depth
    // layer) route through the family, so a split cloud stays split in depth.
    expect(nebula.wgsl.match(/duoPal\(/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("hue2 is a full-turn hue wheel", () => {
    const h2 = specs.get("hue2")!;
    expect(h2.control).toBe("hue");
    expect([h2.min, h2.max]).toEqual([0, 360]);
  });

  it("stars default off behind a branch and ride the shared flow offset", () => {
    expect(specs.get("stars")!.default).toBe(0);
    expect(nebula.wgsl).toContain("if (P_stars() > 0.001)");
    // Parallax comes from the same track-time flow the clouds ride (wind
    // included) — never a wall clock, never a per-frame reroll.
    expect(nebula.wgsl).toContain("flowOff * ((0.5 - fs * 0.25) * 3.0)");
  });

  it("wind defaults off behind a branch; the angle is a full-turn dial", () => {
    expect(specs.get("windStrength")!.default).toBe(0);
    // Strength 0 never takes the branch, so the drift math IS the shipped
    // churn — vec2f(tFlow, -tFlow * 0.7) — untouched.
    expect(nebula.wgsl).toContain("if (P_windStrength() > 0.001)");
    expect(nebula.wgsl).toContain("var flowOff = vec2f(tFlow, -tFlow * 0.7);");
    const wa = specs.get("windAngle")!;
    expect(wa.control).toBe("angle");
    expect([wa.min, wa.max]).toEqual([0, 360]);
  });

  it("every new axis stays a smooth modulation target", () => {
    for (const key of ["duo", "hue2", "stars", "windStrength", "windAngle", "saturation"]) {
      const spec = specs.get(key);
      expect(spec, `missing param ${key}`).toBeDefined();
      expect(spec!.mod, `${key} must stay a smooth mod target`).toBeUndefined();
    }
  });

  it("every knob ships a hint", () => {
    for (const spec of allParams(nebula)) {
      expect(spec.hint, `${spec.key} has no hint`).toBeTruthy();
    }
  });

  it("the curated tier covers all six lenses, backdrop included", () => {
    expect(nebula.params).toHaveLength(11);
    const mainGroups = groupParams(nebula, nebula.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "motion", "reaction", "glow", "backdrop"]) {
      expect(mainGroups, `curated tier misses ${lens}`).toContain(lens);
    }
  });
});

describe("depth-wave deck: complete keys, and the new territory is used", () => {
  const keys = new Set(allParams(nebula).map((p) => p.key));
  const styles = nebula.styles ?? [];

  it("every style writes only real params", () => {
    for (const style of styles) {
      for (const key of Object.keys(style.values)) {
        expect(keys.has(key), `${style.id} writes unknown param "${key}"`).toBe(true);
      }
    }
  });

  it("the deck exercises every new axis", () => {
    const resolved = styles.map(
      (s) => ({ ...defaultParams(nebula), ...s.values }) as Record<string, number>,
    );
    expect(resolved.some((v) => v.duo > 0)).toBe(true); // two-tone
    expect(resolved.some((v) => v.stars > 0)).toBe(true); // star field
    expect(resolved.some((v) => v.windStrength > 0)).toBe(true); // wind
    // The two-tone flagship shows the split on natural (unfolded) clouds.
    expect(resolved.some((v) => v.duo > 0 && v.kaleido === 0)).toBe(true);
    // ...and the deck reaches a fold count it never shipped before.
    expect(resolved.some((v) => v.kaleido === 5)).toBe(true);
  });

  it("the four new identities exist and the first chip stays the defaults", () => {
    const ids = styles.map((s) => s.id);
    for (const id of ["emission", "nursery", "stellarWind", "pinwheel"]) {
      expect(ids).toContain(id);
    }
    expect(styles[0]?.values).toEqual({});
  });

  it("existing styles carry their look across RP-6 (remapped onto the new grid)", () => {
    // Every pre-wave style's stored saturation was re-authored as
    // oldValue / 0.75 snapped to the 0.02 grid. Solar's 0.9 lands exactly on
    // 1.2; the rest sit within half a step of the exact remap — a chroma
    // shift below the 8-bit output quantum.
    const sat = (id: string) => styles.find((s) => s.id === id)!.values.saturation!;
    expect(sat("solar")).toBe(1.2);
    const olds: Array<[string, number]> = [
      ["stainedGlass", 1],
      ["ink", 0.08],
      ["fractalIce", 0.5],
      ["mandala", 0.8],
      ["oilSlick", 0.94],
      ["deepSpace", 0.68],
    ];
    for (const [id, oldV] of olds) {
      expect(
        Math.abs(sat(id) - oldV / NEBULA_SAT_AUTHORED),
        `${id}: saturation strayed from the remap`,
      ).toBeLessThanOrEqual(0.011);
    }
  });
});
