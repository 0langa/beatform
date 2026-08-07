import { describe, expect, it } from "vitest";
import { presetUsesFeedback } from "../webgpuRenderer";
import { allParams } from "../types";
import { metaballs } from "./metaballs";

/**
 * Metaballs depth wave (Track B batch 3): lava smear (texture feedback),
 * bass-weighted band response, per-blob eccentricity, gloss environments,
 * and the promoted beat-response knob.
 *
 * B0's audit called this mode's curated story the worst miss in the roster —
 * ZERO beat-response knobs in main, all five reaction params behind the
 * Advanced fold — and its ceiling "blobs vanish without residue". These tests
 * pin the wave's contract: the promoted knob is a PURE spec move, every depth
 * param is neutral-by-default and branch-gated in the WGSL (the default path
 * keeps the pre-wave expressions term for term), the smear rides the shared
 * fixed-clock feedback machinery, and every new enum option worth seeing has
 * a flagship style (B0 cross-mode finding #2).
 */
describe("metaballs depth wave", () => {
  const main = new Map(metaballs.params.map((p) => [p.key, p]));
  const advanced = new Map((metaballs.advanced ?? []).map((p) => [p.key, p]));
  const styles = metaballs.styles ?? [];

  it("beatSwell is promoted to main as a pure spec move — numbers verbatim", () => {
    const swell = main.get("beatSwell");
    expect(swell).toMatchObject({
      group: "reaction",
      min: 0,
      max: 0.6,
      step: 0.02,
      default: 0.2,
    });
    // A tier move, not a retune: the key must leave Advanced entirely, and
    // saved documents (addressed by key) resolve the identical spec.
    expect(advanced.has("beatSwell")).toBe(false);
  });

  it("curated tier covers all five lenses (the B0 hole this wave closes)", () => {
    const mainGroups = new Set(metaballs.params.map((p) => p.group));
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(mainGroups.has(lens), `main tier missing ${lens}`).toBe(true);
    }
    // Curated means curated: enough to define the mode, few enough to scan.
    expect(metaballs.params.length).toBeGreaterThanOrEqual(8);
    expect(metaballs.params.length).toBeLessThanOrEqual(10);
  });

  it("every depth param defaults to its neutral value", () => {
    // Default neutrality is the merge contract: at factory defaults the mode
    // must render the pre-wave picture (modulo the declared feedback-path
    // reclassification — see the feedback test below).
    expect(main.get("smear")).toMatchObject({ group: "motion", default: 0 });
    expect(advanced.get("bassWeight")).toMatchObject({ group: "reaction", default: 0 });
    expect(advanced.get("eccentric")).toMatchObject({ group: "shape", default: 0 });
    expect(advanced.get("environment")).toMatchObject({ group: "glow", default: 0 });
  });

  it("every depth feature is branch-gated so the default path keeps pre-wave expressions", () => {
    // The guards are the neutrality mechanism: each feature's math exists
    // only behind an off-at-default conditional, so the default path is the
    // pre-wave expression sequence term for term.
    expect(metaballs.wgsl).toContain("if (P_smear() > 0.0) {");
    expect(metaballs.wgsl).toContain("if (P_bassWeight() > 0.0) {");
    expect(metaballs.wgsl).toContain("if (P_eccentric() > 0.0) {");
    // Environment branches fire only above 0 (0 = Void = the pre-wave sheen).
    expect(metaballs.wgsl).toContain("if (env > 1.5) {");
    expect(metaballs.wgsl).toContain("} else if (env > 0.5) {");
    // The pre-wave return expression survives at default.
    expect(metaballs.wgsl).toContain("var outCol = max(col, vec3f(0.0));");
    expect(metaballs.wgsl).toContain("return vec4f(outCol, 1.0);");
  });

  it("smear opts into the texture-feedback path on the fixed track-time clock", () => {
    // feedbackSample() is the opt-in the renderer scans for; history then
    // advances on the fixed 60 Hz track-time clock (fixedFeedback.ts) — the
    // determinism contract every feedback preset shares. NOTE: the scan is
    // static, so the MODE classifies as feedback even at smear = 0 — the
    // declared ±1-LSB device-matrix class (16f visTex double-rounding), the
    // same class led-matrix's waterfall shipped with.
    expect(presetUsesFeedback(metaballs)).toBe(true);
    // The decay is dt-scaled: exactly one step per fixed state tick
    // (u.dt = 1/60), a no-op on presentation-only frames (u.dt = 0).
    expect(metaballs.wgsl).toContain(
      "let keep = pow(mix(0.62, 0.992, sqrt(P_smear())), u.dt * 60.0);",
    );
    // max-fold, never add: a max accumulator cannot compound, which is what
    // makes tonemap-inside-the-loop safe here.
    expect(metaballs.wgsl).toContain("outCol = max(outCol, feedbackSample(uv).rgb * keep);");
    // Exactly one call site, and it lives inside the smear guard — no
    // unguarded history read can leak into the default path.
    const calls = metaballs.wgsl.match(/feedbackSample\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("environment is a curated reflection choice: enum, no modulation, every option styled", () => {
    const env = advanced.get("environment");
    expect(env?.control).toBe("enum");
    // A reflection-model hop is a structural switch, not a performance move —
    // modulating it could only strobe between lighting rigs.
    expect(env?.mod).toBe("off");
    expect(env?.control === "enum" ? env.options.map((o) => o.value) : []).toEqual([0, 1, 2]);
    // Every off-default option worth seeing gets a flagship style, and a
    // gloss environment nobody can see is not worth shipping: the flagship
    // must also move Gloss itself.
    for (const value of [1, 2]) {
      const flagship = styles.filter((s) => s.values.environment === value);
      expect(flagship.length, `no style ships environment=${value}`).toBeGreaterThanOrEqual(1);
      for (const style of flagship) {
        expect(
          style.values.gloss,
          `${style.id}: environment flagship leaves gloss at default`,
        ).toBeDefined();
      }
    }
  });

  it("smear and eccentric each carry a flagship style that leads with them", () => {
    expect(
      styles.some((s) => (s.values.smear ?? 0) >= 0.5),
      "no style makes the lava smear the star",
    ).toBe(true);
    expect(
      styles.some((s) => (s.values.eccentric ?? 0) >= 0.5),
      "no style makes eccentricity the star",
    ).toBe(true);
  });

  it("tier moves and additions never drop a persisted key", () => {
    // Saved projects address params by key, forever.
    const keys = new Set(allParams(metaballs).map((p) => p.key));
    for (const key of [
      "hue",
      "count",
      "size",
      "speed",
      "glow",
      "threshold",
      "gloss",
      "orbitX",
      "orbitY",
      "radiusFloor",
      "energyGrow",
      "radiusBand",
      "beatSwell",
      "rimStart",
      "innerGrad",
      "hueField",
      "beatBright",
      "bgLevel",
      "vignette",
      "mirror",
      "lightAngle",
      "squash",
    ]) {
      expect(keys.has(key), `pre-wave key ${key} vanished`).toBe(true);
    }
  });

  it("ships the widened deck: ten named styles plus the defaults chip, counts well spread", () => {
    expect(styles.length).toBe(11);
    expect(Object.keys(styles[0].values)).toHaveLength(0);
    // The count enum should be a real axis of the deck, not a decoration:
    // every option appears in at least one shipped look (default count = 5).
    const counts = new Set(styles.map((s) => s.values.count ?? 5));
    for (const c of [2, 3, 4, 5, 6, 7]) {
      expect(counts.has(c), `no style ships count=${c}`).toBe(true);
    }
  });
});
