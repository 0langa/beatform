import { describe, expect, it } from "vitest";
import { tunnelRings } from "./tunnelRings";
import { SHADER_SOURCES } from "../webgpuRenderer";

/** The prelude's own TAU, so nothing here can drift from the shader's. */
const TAU = Number(/const TAU: f32 = ([0-9.]+);/.exec(SHADER_SOURCES.header)?.[1]);

/** WGSL builtins the lifted expressions call, in the shader's spelling. */
const WGSL_SHIM = `const TAU = ${TAU};
  const min = Math.min, max = Math.max, abs = Math.abs, cos = Math.cos;
  const mix = (a, b, t) => a + (b - a) * t;
  const select = (f, t, c) => (c ? t : f);
  const fract = (x) => x - Math.floor(x);
  const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };`;

/**
 * The tunnel's colour-fade seam (v2.68 owner feedback).
 *
 * The wall palette is cosPalette(fract(travel * 0.05 + hue), ...) with a
 * NON-INTEGER frequency vector (`spread`), so cosPalette(1-) != cosPalette(0+)
 * and the fract wrap is a hard colour step. `travel = depth + travelT` is
 * per-pixel, so the step is a ring in screen space that sweeps outward as
 * travelT advances — the "abrupt colour switch" the Color fade slider fixes.
 *
 * These tests run the shader's OWN blend expressions, lifted out of the WGSL
 * the way echoTrails.test.ts does, so an edit that weakens the blend fails
 * here instead of quietly agreeing with a restatement.
 */
describe("tunnel color fade", () => {
  const body = tunnelRings.wgsl;

  it("is a headline color control with a pixel-neutral default", () => {
    const def = tunnelRings.params.find((p) => p.key === "colorFade");
    expect(def).toMatchObject({
      label: "Color fade",
      group: "color",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    });
    // Main params list, not advanced — it is the owner's requested control.
    expect(tunnelRings.advanced?.some((p) => p.key === "colorFade")).toBe(false);
  });

  it("no factory style sets it, so every shipped look renders the default path", () => {
    for (const style of tunnelRings.styles ?? []) {
      expect(style.values, `style ${style.id}`).not.toHaveProperty("colorFade");
    }
  });

  it("keeps the default path as the untouched palette expression behind a guard", () => {
    // Bit-identity at colorFade 0 rests on the branch never running: the
    // palette `pal` is still the exact pre-fade expression, and the blend is
    // gated so fade 0 cannot touch it.
    expect(body).toContain(
      "var pal = cosPalette(t, vec3f(0.5), vec3f(0.5), vec3f(1.0) * spread, vec3f(0.0, 0.33, 0.67));",
    );
    expect(body).toContain("let fadeW = P_colorFade();");
    expect(body).toContain("if (fadeW > 1e-4) {");
    expect(body).toContain("pal = mix(pal, palIn, mw);");
    // ...and the fade costs exactly one extra cosPalette eval, inside the
    // guard (count assignments, not the comment's mentions of the name).
    expect(body.match(/(?:let|var) \w+ = cosPalette\(/g)).toHaveLength(2);
  });

  /** Compile a chain of `let <name> = <expr>;` lines, in order, into one fn. */
  const liftChain = (names: string[], args: string[]) => {
    const decls = names.map((n) => {
      const src = new RegExp(`let ${n} = ([^;]*);`).exec(body)?.[1];
      if (src === undefined) throw new Error(`${n} expression not found in the WGSL`);
      return `const ${n} = ${src.replace(/\s+/g, " ")};`;
    });
    return new Function(
      ...args,
      `${WGSL_SHIM}
       ${decls.join("\n       ")}
       return ${names[names.length - 1]};`,
    ) as (...a: never[]) => number;
  };

  /** The blend weight of the incoming period, as the shader computes it. */
  const mwOf = liftChain(["hw", "uw", "m", "mw"], ["t", "fadeW"]) as (
    t: number,
    fadeW: number,
  ) => number;

  /** The incoming endpoint's phase — lifted from palIn's own argument. */
  const tInOf = (() => {
    const src = /let palIn = cosPalette\((t - select\([^)]*\)),/.exec(body)?.[1];
    if (!src) throw new Error("palIn's phase argument not found in the WGSL");
    return new Function(
      "t",
      `${WGSL_SHIM}
       return ${src};`,
    ) as (t: number) => number;
  })();

  /** The prelude's cosPalette at the preset's coefficients, per channel. */
  const D = [0.0, 0.33, 0.67];
  const palRaw = (t: number, spread: number) =>
    D.map((d) => 0.5 + 0.5 * Math.cos(TAU * (spread * t + d)));

  it("palRaw mirrors the prelude's cosPalette, so the model below is honest", () => {
    expect(SHADER_SOURCES.header).toContain("return a + b * cos(TAU * (c * t + d));");
  });

  /** The full faded wall palette: shader control flow, lifted arithmetic. */
  const faded = (x: number, fade: number, spread: number) => {
    const t = x - Math.floor(x);
    const pal = palRaw(t, spread);
    if (!(fade > 1e-4)) return pal;
    const mw = mwOf(t, fade);
    const palIn = palRaw(tInOf(t), spread);
    return pal.map((p, i) => p + (palIn[i] - p) * mw);
  };

  /** Largest channel step across the wrap when sampled n times per period. */
  const stepAcrossWrap = (f: (x: number) => number[], n: number) => {
    const lo = f(1 - 1 / n);
    const hi = f(0);
    return Math.max(...lo.map((v, i) => Math.abs(v - hi[i])));
  };

  // hueSpread's UI range is [0, 240] with a 0.08 floor: spread in [0.08, 2/3].
  const SPREADS = [0.08, 0.3, 240 / 360];

  it("closes the wrap continuously for any fade > 0, at every spread", () => {
    // Proved by refinement, as in echoTrails: sample the wrap twice as finely
    // and a continuous function's sampled step halves, while a genuine jump
    // keeps its full height whatever the sampling.
    for (const spread of SPREADS) {
      for (const fade of [0.05, 0.3, 1]) {
        const f = (x: number) => faded(x, fade, spread);
        const fine = stepAcrossWrap(f, 8192);
        expect(stepAcrossWrap(f, 4096) / fine, `fade ${fade} spread ${spread}`).toBeGreaterThan(
          1.9,
        );
      }
      // Non-vacuity: the unfaded palette does not shrink under the same
      // refinement, because its wrap is a real discontinuity...
      const raw = (x: number) => faded(x, 0, spread);
      const rawFine = stepAcrossWrap(raw, 8192);
      expect(stepAcrossWrap(raw, 4096) / rawFine, `spread ${spread}`).toBeCloseTo(1, 3);
      // ...orders of magnitude bigger than what any live fade leaves behind.
      expect(rawFine / stepAcrossWrap((x) => faded(x, 0.3, spread), 8192)).toBeGreaterThan(100);
    }
  });

  it("meets the seam at the even mean of outgoing and incoming colour", () => {
    // At the wrap the weight is exactly 1/2, so neither period is favoured —
    // this is what makes the two one-sided limits agree.
    expect(mwOf(0, 0.3)).toBeCloseTo(0.5, 12);
    for (const spread of SPREADS) {
      const seam = faded(0, 0.3, spread);
      const mean = palRaw(0, spread).map((p, i) => (p + palRaw(1, spread)[i]) / 2);
      for (let i = 0; i < 3; i++) expect(seam[i]).toBeCloseTo(mean[i], 12);
    }
  });

  it("spends only the requested window and leaves the rest bit-identical", () => {
    // fade 0.4 = a window of half-width 0.2 around the wrap. Everywhere
    // outside it the weight is exactly 0 and mix(p, q, 0) returns p exactly:
    // the fade is LOCAL, not a global desaturation of the wall.
    for (const t of [0.25, 0.4, 0.5, 0.6, 0.75]) {
      expect(mwOf(t, 0.4), `t ${t}`).toBe(0);
      const raw = palRaw(t, 0.3);
      const out = faded(t, 0.4, 0.3);
      for (let i = 0; i < 3; i++) expect(out[i]).toBe(raw[i]);
    }
    // ...and just inside the window the blend is live.
    expect(mwOf(0.05, 0.4)).toBeGreaterThan(0);
    expect(mwOf(0.95, 0.4)).toBeGreaterThan(0);
  });

  it("at fade 1 the wall is permanently mid-crossfade", () => {
    // The window spans the whole period: the blend weight only touches zero
    // at the single midpoint, so one colour has always begun fading in
    // before the previous has finished fading out.
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      if (Math.abs(t - 0.5) < 1e-9) continue;
      expect(mwOf(t, 1), `t ${t}`).toBeGreaterThan(0);
    }
  });

  it("blends the SAME curve exactly one period apart", () => {
    // The incoming endpoint is cosPalette at t -/+ 1 — outgoing colour against
    // incoming colour on one palette, never a second palette.
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      expect(Math.abs(tInOf(t) - t), `t ${t}`).toBeCloseTo(1, 12);
    }
  });
});
