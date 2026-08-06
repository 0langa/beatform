import { describe, expect, it } from "vitest";
import { bassCircle } from "./bassCircle";
import { allParams, defaultParams, groupParams, paramSpecMap } from "../types";

/**
 * Bass Circle's Track B depth wave (B0 rank 6, batch 2) is three gated
 * features plus one tier promotion, under the program's hard law: factory
 * defaults must render pixel-identically to the pre-wave shader. The
 * registry-wide suites (paramModel, presetStyles, shaderGolden) already
 * enforce the generic contracts over every preset — what lives HERE is the
 * wave's own promises, the ones a later well-meaning edit is most likely to
 * undo without tripping anything else:
 *
 *  1. every pre-wave param key still exists with its pre-wave default —
 *     saved projects, looks and the Cover Story factory theme address these
 *     by key;
 *  2. the new features are gated OFF at their defaults, and the default
 *     frame is computed by the identical pre-wave expressions;
 *  3. the curated tier is the designed 13 with every lens represented
 *     (shape / color / motion / reaction / glow / image — motion was the B0
 *     hole: angle/spin/partFloat all sat in Advanced);
 *  4. the style deck exercises the new axes — including coverFit, which B0
 *     found exercised by NO style in either cover-art mode;
 *  5. the segment quantizer + notch mask (the wave's one piece of real
 *     arithmetic) behaves, proven on the shader's OWN lifted expressions.
 */
describe("bass-circle depth wave", () => {
  const specs = paramSpecMap(bassCircle);
  const defaults = defaultParams(bassCircle);
  const body = bassCircle.wgsl;

  /** Every param key the mode shipped BEFORE the wave, with its default —
   * frozen here as data, not as a re-blessable snapshot. A rename or retune
   * of any of these breaks saved documents / the Cover Story theme. */
  const PRE_WAVE_DEFAULTS: Record<string, number> = {
    hue: 280,
    saturation: 1,
    lightness: 1,
    radius: 0.18,
    pump: 0.18,
    barLen: 0.24,
    particles: 1,
    rimBright: 0.8,
    cover: 1,
    coverHue: 0,
    symmetry: 2,
    angle: 0,
    spin: 0,
    hueSpread: 60,
    beatPump: 0.16,
    gap: 0.02,
    barGlow: 0.5,
    partDensity: 7,
    partFill: 0.45,
    partFloat: 0.6,
    beatBurst: 0.7,
    coverMix: 0.9,
    coverBright: 0.85,
    coverFit: 0,
    coverZoom: 1,
    coverX: 0,
    coverY: 0,
    vignette: 0.3,
  };

  it("keeps every pre-wave key with its pre-wave default", () => {
    for (const [key, def] of Object.entries(PRE_WAVE_DEFAULTS)) {
      const spec = specs.get(key);
      expect(spec, `pre-wave param "${key}" is gone`).toBeDefined();
      expect(spec?.default, `pre-wave param "${key}" default moved`).toBe(def);
    }
  });

  it("adds exactly the wave's new params, all gated off or inert at default", () => {
    const newKeys = allParams(bassCircle)
      .map((p) => p.key)
      .filter((k) => !(k in PRE_WAVE_DEFAULTS));
    expect(newKeys.sort()).toEqual(["coreFill", "partBeat", "segGap", "segments"].sort());
    // The three feature gates: 0 = continuous ring / drifting bokeh / flat
    // fill. segGap is a tuning knob BEHIND the segments gate, so its default
    // cannot change pixels either.
    expect(defaults.segments).toBe(0);
    expect(defaults.partBeat).toBe(0);
    expect(defaults.coreFill).toBe(0);
  });

  it("computes the default frame through the identical pre-wave expressions", () => {
    // Feature gates in the WGSL, and the untouched default-path expressions
    // behind them. let -> var on xs/sz is the only default-path text change;
    // both keep their exact initializers, and no default-path value is ever
    // multiplied or offset by a gated term (no `* 1.0` neutrality claims —
    // the guarded branches simply never run).
    expect(body).toContain("if (P_segments() > 0.5)");
    expect(body).toContain("if (P_partBeat() > 0.001)");
    expect(body).toContain("if (P_coreFill() > 0.5)");
    expect(body).toContain("var xs = abs(seg * 2.0 - 1.0);");
    expect(body).toContain("var sz = (0.06 + h1 * 0.12) * (1.0 - fl * 0.2);");
    expect(body).toContain("var fill = presetColor(P_hue(), 0.5, 0.04 + u.drive * 0.07);");
    // The continuous ring's sampling lives in the else branch, verbatim.
    expect(body).toMatch(/\} else \{\s*v = binAt\(xs\);\s*\}/);
    // Cover art still wins exactly as before: same sample, same blend.
    expect(body).toContain("let art = coverSample(cuv).rgb * P_coverBright();");
    expect(body).toContain("fill = mix(fill, art, P_coverMix());");
  });

  it("curates the designed 13 with every lens represented in Essentials", () => {
    expect(bassCircle.params.map((p) => p.key)).toEqual([
      "hue",
      "saturation",
      "lightness",
      "radius",
      "pump",
      "barLen",
      "segments",
      "particles",
      "spin",
      "rimBright",
      "cover",
      "coreFill",
      "coverHue",
    ]);
    const mainGroups = groupParams(bassCircle, bassCircle.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "motion", "reaction", "glow", "image"]) {
      expect(mainGroups, `lens "${lens}" missing from Essentials`).toContain(lens);
    }
  });

  it("promotes spin with its spec unchanged — a tier move, not a retune", () => {
    expect(bassCircle.advanced?.some((p) => p.key === "spin")).toBe(false);
    expect(specs.get("spin")).toMatchObject({
      label: "Ring spin",
      group: "motion",
      min: -1,
      max: 1,
      step: 0.02,
      default: 0,
    });
  });

  it("tags the new params for modulation per the wave-0 conventions", () => {
    // Integer-stepped count snaps (3.7 segments is a shader accident)...
    expect(specs.get("segments")?.mod).toBe("snap");
    // ...the mode choice opts out entirely...
    expect(specs.get("coreFill")?.mod).toBe("off");
    // ...and the two continuous tuning knobs stay ordinary smooth targets.
    expect(specs.get("segGap")?.mod).toBeUndefined();
    expect(specs.get("partBeat")?.mod).toBeUndefined();
  });

  it("exercises every new axis across the style deck — coverFit included", () => {
    const styleValues = (key: string) =>
      new Set(
        (bassCircle.styles ?? [])
          .map((s) => s.values[key])
          .filter((v): v is number => v !== undefined),
      );
    expect(styleValues("segments")).toEqual(new Set([16]));
    expect(styleValues("partBeat")).toEqual(new Set([0.85]));
    // Both non-default core fills ship as looks (Polaroid's gradient doubles
    // as its letterbox backdrop; Pulse Core is the no-art headline).
    expect(styleValues("coreFill")).toEqual(new Set([1, 2]));
    // The B0 cross-mode finding: coverFit was set by NO style anywhere.
    expect(styleValues("coverFit")).toEqual(new Set([1]));
  });

  it("keeps the authored waveform trace inside the disc", () => {
    // The trace radius is a fixed 0.55 +- 0.12 band of the circle radius —
    // waveAt spans -1..1, so the extremes are 0.43..0.67 of circleR, well
    // inside the rim; the disc mask (inner) clips anything else. Lifted as
    // text so a rework that unbounds the band fails here instead of drawing
    // outside the circle.
    expect(body).toContain("let wr = circleR * (0.55 + waveAt(wx) * 0.12);");
    // Mirrored fold: the waveform's wrap seam can never show as a radial cut.
    expect(body).toContain("let wx = abs(fract(a / TAU + 0.5) * 2.0 - 1.0);");
  });

  // ---- The segment quantizer + notch mask, on the shader's own arithmetic —
  // lifted out of the WGSL the way tunnelRings.test.ts does, so an edit that
  // weakens the maths fails here instead of quietly agreeing with a
  // restatement. ----
  describe("segment quantizer + notch mask (lifted from the WGSL)", () => {
    const block = /if \(P_segments\(\) > 0\.5\) \{([\s\S]*?)\n {2}\} else \{/.exec(body)?.[1];
    if (!block) throw new Error("segments block not found in the WGSL");

    /** WGSL builtins the lifted expressions call, in the shader's spelling.
     * (WGSL round() is round-half-to-even; Math.round is half-up — the tests
     * below never sample exact halves, where the two differ.) */
    const SHIM = `const min = Math.min, max = Math.max, floor = Math.floor, round = Math.round;
      const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
      const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };`;

    const expr = (name: string) => {
      const src = new RegExp(`let ${name} = ([^;]*);`).exec(block)?.[1];
      if (src === undefined) throw new Error(`${name} expression not found in the segments block`);
      return src.replace(/\s+/g, " ");
    };
    // The xs reassignment — matched as an assignment (the declaration is
    // `var xs`, which the leading whitespace-only \s* cannot reach).
    const xqSrc = /\n\s*xs = ([^;]*);/.exec(block)?.[1];
    if (!xqSrc) throw new Error("xs quantize assignment not found in the segments block");

    const model = new Function(
      "xs",
      "segments",
      "segGap",
      `${SHIM}
       const n = ${expr("n").replace("P_segments()", "segments")};
       const cell = ${expr("cell")};
       const fc = ${expr("fc")};
       const xq = ${xqSrc.replace(/\s+/g, " ")};
       const gapHalf = ${expr("gapHalf").replace("P_segGap()", "segGap")};
       const notch = ${expr("notch")};
       return { n, cell, fc, xq, notch };`,
    ) as (
      xs: number,
      segments: number,
      segGap: number,
    ) => { n: number; cell: number; fc: number; xq: number; notch: number };

    const segGapSpec = specs.get("segGap")!;
    const GAPS = [segGapSpec.min, segGapSpec.default, segGapSpec.max];

    it("samples every position in a cell at the cell centre — piecewise constant", () => {
      // One spectrum value and one colour per cell: everything in cell 4 of
      // 16 lands on the same centre, and the centre is a fixed point.
      expect(model(0.26, 16, 0.22).xq).toBe(4.5 / 16);
      expect(model(0.3, 16, 0.22).xq).toBe(4.5 / 16);
      expect(model(4.5 / 16, 16, 0.22).xq).toBe(4.5 / 16);
      // Quantized positions stay strictly inside 0..1 even at the seam ends,
      // where the raw coordinate touches 0 and 1 exactly.
      for (const n of [1, 3, 16, 32]) {
        expect(model(0, n, 0.22).xq).toBe(0.5 / n);
        expect(model(1, n, 0.22).xq).toBe((n - 0.5) / n);
      }
    });

    it("closes the notch at every cell edge and lights the centre, at every gap", () => {
      for (const gap of GAPS) {
        // fc = 0 and fc = 1 are the cell edges: the mask is exactly 0 there
        // (smoothstep below its lower edge), so segments always separate.
        expect(model(0, 16, gap).notch, `gap ${gap} at edge`).toBe(0);
        expect(model(1, 16, gap).notch, `gap ${gap} at edge`).toBe(0);
        // The centre is fully lit for the whole spec range: gapHalf + 0.05
        // tops out at 0.30 < 0.5, so no gap can swallow its own segment.
        const centre = model(0.5 / 16, 16, gap);
        expect(centre.fc).toBeCloseTo(0.5, 12);
        expect(centre.notch, `gap ${gap} at centre`).toBe(1);
      }
    });

    it("cuts symmetrically — the notch cannot lean into one neighbour", () => {
      for (const fcTarget of [0.1, 0.2, 0.35, 0.45]) {
        const a = model(fcTarget / 16, 16, 0.3).notch;
        const b = model((1 - fcTarget) / 16, 16, 0.3).notch;
        expect(a, `fc ${fcTarget}`).toBeCloseTo(b, 12);
      }
    });

    it("widens the dark share monotonically with the Notch gap param", () => {
      const lit = (gap: number) => {
        let sum = 0;
        for (let i = 0; i <= 200; i++) sum += model(i / 200 / 16, 16, gap).notch;
        return sum;
      };
      expect(lit(0.05)).toBeGreaterThan(lit(0.22));
      expect(lit(0.22)).toBeGreaterThan(lit(0.5));
    });

    it("clamps the live count into 1..32 — crossfade-lerped fractions included", () => {
      // Transitions lerp param values, so P_segments() can be fractional
      // mid-crossfade; round() + clamp keep the count a real cell count.
      expect(model(0.3, 50, 0.22).n).toBe(32);
      expect(model(0.3, 0.6, 0.22).n).toBe(1);
      expect(model(0.3, 7.4, 0.22).n).toBe(7);
    });
  });
});
