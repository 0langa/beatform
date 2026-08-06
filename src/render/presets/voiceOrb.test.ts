import { describe, expect, it } from "vitest";
import { voiceOrb } from "./voiceOrb";
import { allParams, defaultParams, groupParams, paramSpecMap } from "../types";

/**
 * Voice Orb's Track B depth wave (audit RP-24.9 / B0 rank 1) was CURATION plus
 * two additive features, under one hard law: the pre-wave look must survive
 * untouched. The registry-wide suites (paramModel, presetStyles, shaderGolden)
 * already enforce the generic contracts over every preset — what lives HERE is
 * the wave's own promises, the ones a later well-meaning edit is most likely
 * to undo without tripping anything else:
 *
 *  1. every pre-wave param still exists, with the same default — saved
 *     projects and the "On Air" factory theme address these by key;
 *  2. the new features are NEUTRAL at their defaults and their WGSL is gated
 *     so the default frame is computed by the identical expressions;
 *  3. the curated tier stays the designed 12 with every lens represented
 *     (the B0 acceptance for this mode: shape/color/motion/reaction/glow);
 *  4. the style deck actually exercises the new enums — an option no style
 *     selects is invisible (B0 cross-mode finding 2).
 */
describe("voice-orb depth wave", () => {
  const specs = paramSpecMap(voiceOrb);
  const defaults = defaultParams(voiceOrb);

  /** Every param key the mode shipped BEFORE the wave, with its default —
   * frozen here as data, not as a re-blessable snapshot. A rename or retune
   * of any of these breaks saved documents / the On Air factory theme. */
  const PRE_WAVE_DEFAULTS: Record<string, number> = {
    hue: 195,
    size: 0.16,
    response: 0.6,
    wobble: 0.5,
    ring: 1,
    sparkle: 0.5,
    rmsBlend: 0.3,
    voiceFocus: 0.5,
    growth: 0.85,
    idleBreath: 0.012,
    wobScale: 0.03,
    mode1: 1,
    mode2: 0.7,
    mode3: 0.45,
    coreGlow: 0.18,
    texture: 0,
    breathGlow: 0.14,
    rimGlow: 0.3,
    ringDist: 1.45,
    ringWave: 0.045,
    sparkleScale: 34,
    bgLevel: 0.035,
    vignette: 0.45,
    flare: 0.5,
    mirror: 1,
  };

  it("keeps every pre-wave key with its pre-wave default", () => {
    for (const [key, def] of Object.entries(PRE_WAVE_DEFAULTS)) {
      const spec = specs.get(key);
      expect(spec, `pre-wave param "${key}" is gone`).toBeDefined();
      expect(spec?.default, `pre-wave param "${key}" default moved`).toBe(def);
    }
  });

  it("adds exactly the wave's new params, all neutral or additive-off at default", () => {
    const newKeys = allParams(voiceOrb)
      .map((p) => p.key)
      .filter((k) => !(k in PRE_WAVE_DEFAULTS));
    expect(newKeys.sort()).toEqual(
      ["ringCount", "ringStyle", "satDist", "satOrbit", "satSize", "satellites"].sort(),
    );
    // The two feature gates: 0 = off / classic line. Everything else is a
    // tuning knob behind those gates, so its default cannot change pixels.
    expect(defaults.satellites).toBe(0);
    expect(defaults.ringStyle).toBe(0);
  });

  it("computes the default frame through the identical pre-wave expressions", () => {
    const w = voiceOrb.wgsl;
    // Feature gates in the WGSL: satellites draw only above 0.5, and the
    // classic ring lines live in the ringStyle < 0.5 branch, verbatim.
    expect(w).toContain("if (P_satellites() > 0.5)");
    expect(w).toContain("if (P_ringStyle() < 0.5)");
    const lineBranch = /if \(P_ringStyle\(\) < 0\.5\) \{([\s\S]*?)\} else \{/.exec(w)?.[1];
    expect(lineBranch, "classic ring branch not found").toBeTruthy();
    // The two shipped ring lines, byte-for-byte (pixel identity at default).
    expect(lineBranch).toContain(
      "col += ringPal * smoothstep(0.004, 0.0008, dRing) * (0.35 + level * 0.5);",
    );
    expect(lineBranch).toContain("col += ringPal * exp(-dRing * 120.0) * 0.18;");
  });

  it("curates the designed 12 with every lens represented in Essentials", () => {
    expect(voiceOrb.params.map((p) => p.key)).toEqual([
      "hue",
      "size",
      "satellites",
      "ring",
      "ringStyle",
      "mirror",
      "texture",
      "response",
      "voiceFocus",
      "wobble",
      "sparkle",
      "flare",
    ]);
    // The B0 lens house for the curated tier: shape / color / motion /
    // reaction / glow all present (glow carries the texture lens; backdrop
    // stays expert-tier by roster convention).
    const mainGroups = groupParams(voiceOrb, voiceOrb.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(mainGroups, `lens "${lens}" missing from Essentials`).toContain(lens);
    }
  });

  it("tags the new params for modulation per the wave-0 conventions", () => {
    // Counts snap (fractional dots/orbs are shader-defined accidents)...
    expect(specs.get("satellites")?.mod).toBe("snap");
    expect(specs.get("ringCount")?.mod).toBe("snap");
    // ...mode choices and pure toggles opt out entirely...
    expect(specs.get("ringStyle")?.mod).toBe("off");
    expect(specs.get("ring")?.mod).toBe("off");
    // ...and the satellite tuning knobs stay ordinary smooth targets.
    for (const key of ["satSize", "satDist", "satOrbit"]) {
      expect(specs.get(key)?.mod, `${key} should be a smooth mod target`).toBeUndefined();
    }
  });

  it("exercises every flagship option of the new enums across the style deck", () => {
    const styleValues = (key: string) =>
      new Set(
        (voiceOrb.styles ?? [])
          .map((s) => s.values[key])
          .filter((v): v is number => v !== undefined),
      );
    // Ring styles: both non-default renderings have a named look.
    expect(styleValues("ringStyle")).toEqual(new Set([1, 2]));
    // Satellites: the panel (3) and the duo (2) both ship as looks.
    expect(styleValues("satellites")).toEqual(new Set([2, 3]));
    // The mirror fold is no longer a single-style enum (B0 cross-finding 2).
    expect(styleValues("mirror").size).toBeGreaterThanOrEqual(2);
  });

  it("keeps satellite geometry inside the frame law", () => {
    // The satellite body is hard-capped and its centre is soft-limited
    // against the frame circle MINUS that body — the same "edge stays inside"
    // law the orb and ring follow. Lifted as text so a rework that drops the
    // guard fails here rather than clipping on ultrawide exports.
    expect(voiceOrb.wgsl).toContain("frameCircle() * 0.22");
    expect(voiceOrb.wgsl).toContain("softLimit(radius * P_satDist(), frameCircle() * 0.97 - sr)");
  });
});
