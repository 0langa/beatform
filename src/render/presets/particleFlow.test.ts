import { describe, expect, it } from "vitest";
import {
  PARTICLE_PARAM_KEYS,
  PARTICLE_UNIFORM_SIZE,
  presetUsesFeedback,
  SHADER_SOURCES,
} from "../webgpuRenderer";
import { allParams } from "../types";
import { particleFlow } from "./particleFlow";

/**
 * Particle Flow depth wave (Track B): field families (curl flow / jet stream /
 * vortex street / orbital), attractor geometry (point / ring / line), opt-in
 * mid->swirl and treble->jitter audio routings, vertex-stage ribbon streaks,
 * the backdrop pair (vignette + bgLevel — this mode shipped with ZERO backdrop
 * control), and the RP-6 whole-visual colour tier.
 *
 * B0's audit summarized the mode as "one force field forever: curl-noise +
 * center pull; audio routing fixed; memoryless points". These tests pin the
 * wave's contract: every new control is one appended lane in the particle
 * uniform ABI (the PU growth protocol — append-only, mirrored key order,
 * audio lanes after the param block), every depth feature is branch-gated so
 * the factory default path keeps the pre-wave expressions term for term, and
 * every off-default enum option worth seeing carries a flagship style.
 *
 * True feedback trails remain out of scope by design: the ribbon param is a
 * pure function of the current sim state (elongation, not history).
 */
describe("particle-flow depth wave", () => {
  const main = new Map(particleFlow.params.map((p) => [p.key, p]));
  const advanced = new Map((particleFlow.advanced ?? []).map((p) => [p.key, p]));
  const styles = particleFlow.styles ?? [];

  /** The pre-wave ABI, frozen verbatim: these 16 lanes may never move. */
  const PRE_WAVE_KEYS = [
    "hue",
    "flowScale",
    "flowStrength",
    "swirl",
    "damping",
    "gravity",
    "size",
    "sizePulse",
    "brightness",
    "beatBurst",
    "hueSpread",
    "speedColor",
    "spawnRadius",
    "density",
    "audioFlow",
    "sat",
  ];

  it("declares exactly the particle uniform ABI, new keys appended after the frozen prefix", () => {
    // The renderer copies ParamValues[key] into the PU field at the key's
    // index — the preset's param set and PARTICLE_PARAM_KEYS must be the same
    // set, and growth is append-only (F[8 + idx] packing is positional).
    const declared = new Set(allParams(particleFlow).map((p) => p.key));
    expect(declared).toEqual(new Set(PARTICLE_PARAM_KEYS));
    expect([...PARTICLE_PARAM_KEYS.slice(0, 16)]).toEqual(PRE_WAVE_KEYS);
    expect([...PARTICLE_PARAM_KEYS.slice(16)]).toEqual([
      "field",
      "attractor",
      "midSwirl",
      "trebleJitter",
      "ribbon",
      "vignette",
      "bgLevel",
      "saturation",
      "lightness",
    ]);
  });

  it("PU struct mirrors the ABI: fixed prefix, params in key order, audio lanes last", () => {
    // 8 fixed lanes, then PARTICLE_PARAM_KEYS in order, then the explicitly
    // packed extra audio lanes — the layout writeParticleSlot assumes. Parsed
    // from the literal WGSL compiled at runtime, for both modules (they must
    // share the struct or sim and draw read different offsets).
    const expected = [
      "dt",
      "time",
      "aspect",
      "count",
      "bass",
      "drive",
      "driveBeat",
      "kick",
      ...PARTICLE_PARAM_KEYS,
      "mid",
      "treble",
    ];
    for (const source of [SHADER_SOURCES.particleSim, SHADER_SOURCES.particleDraw]) {
      const struct = source.match(/struct PU \{([^}]+)\}/)?.[1] ?? "";
      const lanes = [...struct.matchAll(/(\w+)\s*:\s*(?:f32|u32)/g)].map((m) => m[1]);
      expect(lanes).toEqual(expected);
    }
    // Silent-failure guard: a lane appended without the size bump writes past
    // the Float32Array view, which TypedArrays swallow without an error. The
    // block must also stay under the 256-byte dynamic-offset slot stride.
    expect(PARTICLE_UNIFORM_SIZE).toBeGreaterThanOrEqual(4 * expected.length);
    expect(PARTICLE_UNIFORM_SIZE).toBeLessThanOrEqual(256);
  });

  it("every depth param defaults to its neutral value", () => {
    // Default neutrality is the merge contract: at factory defaults the mode
    // must render the pre-wave picture bit for bit.
    expect(main.get("field")).toMatchObject({ group: "motion", default: 0 });
    expect(main.get("ribbon")).toMatchObject({ group: "shape", default: 0 });
    expect(advanced.get("attractor")).toMatchObject({ group: "motion", default: 0 });
    expect(advanced.get("midSwirl")).toMatchObject({ group: "reaction", default: 0 });
    expect(advanced.get("trebleJitter")).toMatchObject({ group: "reaction", default: 0 });
    expect(advanced.get("vignette")).toMatchObject({ group: "backdrop", default: 0 });
    expect(advanced.get("bgLevel")).toMatchObject({ group: "backdrop", default: 0 });
    expect(main.get("saturation")).toMatchObject({ group: "color", default: 1 });
    expect(main.get("lightness")).toMatchObject({ group: "color", default: 1 });
  });

  it("every depth feature is branch-gated or exact-identity so the default path keeps pre-wave math", () => {
    const sim = SHADER_SOURCES.particleSim;
    // Field families branch on the enum; the default (else) arm is the
    // original curl force with its audio gain hoisted unchanged.
    expect(sim).toContain(
      "let audioAmp = 1.0 + pu.bass * pu.audioFlow * 0.4 + pu.drive * pu.audioFlow;",
    );
    expect(sim).toContain("force = curl(fp) * pu.flowStrength * 0.04 * audioAmp;");
    // Mid->swirl routing: the default arm keeps the authored term verbatim.
    expect(sim).toContain("if (pu.midSwirl > 0.0) {");
    expect(sim).toContain("force += vec2f(-pos.y, pos.x) * pu.swirl * 0.4;");
    // Attractor geometry: the default (else) arm is the original point spring.
    expect(sim).toContain("force += -pos * pu.gravity * 0.3;");
    // Treble jitter only exists behind its opt-in guard.
    expect(sim).toContain("if (pu.trebleJitter > 0.0) {");

    const draw = SHADER_SOURCES.particleDraw;
    expect(draw).toContain("if (pu.ribbon > 0.0) {");
    expect(draw).toContain("if (pu.vignette > 0.0) {");
  });

  it("colour tier: main-tier specs (the matrix contract) routed at the draw chokepoint", () => {
    // Spec shape and hints are the RP-6 roster contract. They MUST live in
    // the main params: gpuMatrix.ts auto-adds the two grayscale cases
    // (saturation 0 / saturation 0 + lightness 2) only when preset.params
    // carries both keys — declared new device-matrix cases for this wave.
    for (const key of ["saturation", "lightness"] as const) {
      expect(main.get(key)).toMatchObject({ group: "color", min: 0, max: 2, default: 1 });
      expect(advanced.has(key)).toBe(false);
    }
    // colorControls.test.ts pins the FRAGMENT-preset routing contract
    // (P_saturation()/colorScale in preset.wgsl); this mode's wgsl is an
    // unused stub, so the routing is pinned here instead: the colorScale form
    // (min(value * control, 1)) at the draw shader's single authored-HSL
    // chokepoint. Exact-identity at defaults: multiply by 1.0 is exact and
    // pu.sat <= 1 / 0.6 < 1 keep both min() folds inert.
    const draw = SHADER_SOURCES.particleDraw;
    expect(draw).toContain(
      "hsl2rgb(hue, min(pu.sat * pu.saturation, 1.0), min(0.6 * pu.lightness, 1.0))",
    );
    expect(draw.match(/hsl2rgb\(hue/g)).toHaveLength(1);
  });

  it("field and attractor are curated structural switches: enums, no modulation", () => {
    const field = main.get("field");
    expect(field?.control).toBe("enum");
    expect(field?.mod).toBe("off");
    expect(field?.control === "enum" ? field.options.map((o) => o.value) : []).toEqual([
      0, 1, 2, 3,
    ]);
    const attractor = advanced.get("attractor");
    expect(attractor?.control).toBe("enum");
    expect(attractor?.mod).toBe("off");
    expect(attractor?.control === "enum" ? attractor.options.map((o) => o.value) : []).toEqual([
      0, 1, 2,
    ]);
  });

  it("every off-default enum option carries a flagship style (B0 cross-mode finding #2)", () => {
    for (const value of [1, 2, 3]) {
      expect(
        styles.filter((s) => s.values.field === value).length,
        `no style ships field=${value}`,
      ).toBeGreaterThanOrEqual(1);
    }
    for (const value of [1, 2]) {
      expect(
        styles.filter((s) => s.values.attractor === value).length,
        `no style ships attractor=${value}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("ribbon and the treble routing each carry a flagship style that leads with them", () => {
    expect(
      styles.some((s) => (s.values.ribbon ?? 0) >= 0.5),
      "no style makes ribbons the star",
    ).toBe(true);
    const jitterFlagships = styles.filter((s) => (s.values.trebleJitter ?? 0) >= 1);
    expect(jitterFlagships.length, "no style makes treble jitter the star").toBeGreaterThanOrEqual(
      1,
    );
    // The routing flagship should demo BOTH new audio routes, not one.
    expect(
      jitterFlagships.some((s) => (s.values.midSwirl ?? 0) > 0),
      "the jitter flagship leaves the mid->swirl route untouched",
    ).toBe(true);
  });

  it("feedback stays structurally closed — ribbons are elongation, not history", () => {
    // The compute-particle path never rides the texture-feedback machinery
    // (webgpuRenderer's `special` gate), and nothing in this wave may opt in:
    // the WGSL scan must stay silent for the stub AND the built-in modules.
    expect(presetUsesFeedback(particleFlow)).toBe(false);
    expect(SHADER_SOURCES.particleSim).not.toContain("feedbackSample(");
    expect(SHADER_SOURCES.particleDraw).not.toContain("feedbackSample(");
  });

  it("tier moves and additions never drop a persisted key, and the sim stays 120k", () => {
    // Saved projects address params by key, forever. `sat` in particular was
    // only RELABELLED (Palette saturation) when the tier's `saturation`
    // arrived — the key and its numbers are untouched.
    const keys = new Set(allParams(particleFlow).map((p) => p.key));
    for (const key of PRE_WAVE_KEYS) {
      expect(keys.has(key), `pre-wave key ${key} vanished`).toBe(true);
    }
    expect(advanced.get("sat")).toMatchObject({ min: 0, max: 1, step: 0.02, default: 0.8 });
    expect(particleFlow.particles).toEqual({ count: 120_000 });
  });

  it("ships the widened deck: thirteen named styles plus the defaults chip", () => {
    expect(styles.length).toBe(14);
    expect(Object.keys(styles[0].values)).toHaveLength(0);
    // The backdrop pair actually appears in shipped looks (a knob nobody can
    // see a use for is not worth shipping).
    expect(styles.some((s) => (s.values.vignette ?? 0) > 0)).toBe(true);
    expect(styles.some((s) => (s.values.bgLevel ?? 0) > 0)).toBe(true);
  });
});
