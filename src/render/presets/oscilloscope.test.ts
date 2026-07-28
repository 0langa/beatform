import { describe, expect, it } from "vitest";
import { oscilloscope } from "./oscilloscope";
import { SHADER_SOURCES } from "../webgpuRenderer";

/**
 * The frame-rate law for the second preset that feeds itself.
 *
 * Oscilloscope's phosphor trail is a max() union rather than Echo Trails'
 * accumulating `+=`, so it has no runaway to bound — but it shared the same
 * defect: the preset's return value IS next frame's feedbackSample(), so a post
 * chain applied after the union is re-applied to every persisted pixel, once
 * per RENDERED frame, while the decay it is fighting is expressed per SECOND.
 *
 * shaderGolden freezes the WGSL text, so an unintended edit shows up there —
 * but a frozen string says nothing about whether the recurrence is right. These
 * run the shader's OWN expressions, lifted out of the WGSL and out of the
 * shared prelude, rather than restating them here.
 */
describe("oscilloscope phosphor persistence", () => {
  const body = oscilloscope.wgsl;

  /** tonemap()'s scalar form, with the prelude's own coefficients. */
  const tonemap = (() => {
    const src = /fn tonemap\(x: vec3f\) -> vec3f \{([\s\S]*?)\n\}/.exec(SHADER_SOURCES.header)?.[1];
    if (!src) throw new Error("tonemap() not found in the prelude");
    const num = (name: string) => {
      const m = new RegExp(`let ${name} = ([0-9.]+);`).exec(src);
      if (!m) throw new Error(`tonemap coefficient ${name} not found`);
      return Number(m[1]);
    };
    const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(num);
    return (x: number) => Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e)));
  })();

  /** The shipped decay expression, lifted. */
  const decayOf = (() => {
    const src = /let decay = ([^;]*);/.exec(body)?.[1];
    if (!src) throw new Error("decay expression not found in the WGSL");
    return new Function(
      "P_persist",
      "u",
      `const pow = Math.pow, clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x)), max = Math.max;
       return ${src.replace(/\s+/g, " ")};`,
    ) as (persist: () => number, u: { dt: number }) => number;
  })();

  const decay = (persist: number, fps: number) => decayOf(() => persist, { dt: 1 / fps });

  /**
   * Structural, and the thing a later edit is most likely to undo: the three
   * finishing steps must all sit ABOVE the feedback line. Any one of them below
   * it re-enters the loop.
   */
  it("posts the frame before unioning it with the trail", () => {
    const feedbackAt = body.indexOf("feedbackSample(uv)");
    expect(feedbackAt).toBeGreaterThan(0);
    for (const step of ["P_vignette()", "tonemap(", "grain("]) {
      const at = body.indexOf(step);
      expect(at, `${step} must be applied before the persistence union`).toBeGreaterThan(0);
      expect(at, `${step} must be applied before the persistence union`).toBeLessThan(feedbackAt);
    }
    // ...and nothing may follow the union except the negative clamp.
    const after = body.slice(feedbackAt);
    expect(after).not.toMatch(/tonemap\(|grain\(|P_vignette\(\)/);
  });

  /**
   * Numeric: a pixel the beam has left behind is carried by the loop alone.
   * Sample it at a matched TRACK time and every frame rate has to agree.
   */
  it("holds the afterglow level flat across frame rates", () => {
    // Every shipped style's Persistence value, plus the slider's extremes.
    const persists = [0.4, 0.5, 0.32, 0.6, 0.28, 0.45, 0.0001, 0.98];
    // A trail pixel, three quarters of the way out where the vignette bites.
    const vg = 1 - 0.75 * 0.75 * 0.55;

    /** The loop, both ways round. `posted` is the shipped order. */
    const settle = (persist: number, fps: number, seconds: number, posted: boolean) => {
      let v = tonemap(0.9 * vg * 1.1); // one bright sweep, already graded
      const d = decay(persist, fps);
      for (let n = 0; n < Math.round(seconds * fps); n++) {
        v = posted ? v * d : tonemap(v * d * vg * 1.1);
      }
      return v;
    };

    for (const p of persists) {
      const at60 = settle(p, 60, 0.5, true);
      // 24, 30, 48 fps — every export rate at or below the authored 60.
      for (const fps of [24, 30, 48]) {
        // Relative to at60 itself — the shortest persistence settles to a
        // denormal-small number, and clamping the denominator would compare a
        // real value against a floor rather than against its own 60 fps twin.
        const v = settle(p, fps, 0.5, true);
        const rel = Math.abs(v - at60) / Math.max(Math.abs(at60), 1e-300);
        expect(rel, `persist ${p} at ${fps} fps`).toBeLessThan(1e-9);
      }
    }

    // Non-vacuity, and the defect's actual size: with the post chain inside the
    // loop, the same trail at the same track time differs by tens of percent
    // between a 30 fps export and its own 60 fps preview.
    const old60 = settle(0.4, 60, 0.5, false);
    const old30 = settle(0.4, 30, 0.5, false);
    expect(Math.abs(old30 / old60 - 1), "30 vs 60 fps before the fix").toBeGreaterThan(0.25);
  });

  /**
   * The other half of the defect: a persisted pixel used to be graded once per
   * frame it survived rather than once when it was drawn, so the afterglow was
   * pre-darkened and pre-tonemapped relative to the brightness it was authored
   * at. Fresh pixels were always graded once — that is what must not move.
   */
  it("grades a pixel exactly once, in the frame it was fresh", () => {
    const vg = 1 - 0.5 * 0.5 * 0.55;
    const fresh = tonemap(0.6 * vg * 1.1);
    const d = decay(0.4, 60);
    // Six frames of pure trail: the shipped loop is fresh * d^6, full stop.
    let posted = fresh;
    let inLoop = fresh;
    for (let n = 0; n < 6; n++) {
      posted *= d;
      inLoop = tonemap(inLoop * d * vg * 1.1);
    }
    expect(posted).toBeCloseTo(fresh * Math.pow(d, 6), 12);
    // The old loop's own re-grading moved it, and not by a rounding error.
    expect(Math.abs(inLoop / posted - 1)).toBeGreaterThan(0.5);
  });
});
