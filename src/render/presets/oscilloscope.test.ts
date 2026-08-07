import { describe, expect, it } from "vitest";
import { oscilloscope } from "./oscilloscope";
import { SHADER_SOURCES } from "../webgpuRenderer";
import { FEEDBACK_DT, FixedFeedbackClock, isFeedbackTick } from "../fixedFeedback";
import { advancedKeys, allParams, defaultParams, groupParams, presetMasters } from "../types";

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

  const decay = (persist: number, dt: number) => decayOf(() => persist, { dt });

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
   * State advances on 60 Hz ticks only; presentation frames never feed back.
   */
  it("holds the afterglow level flat across frame rates", () => {
    // Every shipped style's Persistence value, plus the slider's extremes.
    const persists = [0.4, 0.5, 0.32, 0.6, 0.28, 0.45, 0.0001, 0.98];
    // A trail pixel, three quarters of the way out where the vignette bites.
    const vg = 1 - 0.75 * 0.75 * 0.55;

    /** The loop, both ways round. `posted` is the shipped order. */
    const settle = (persist: number, fps: number, seconds: number, posted: boolean) => {
      let v = tonemap(0.9 * vg * 1.1); // one bright sweep, already graded
      const clock = new FixedFeedbackClock();
      const advance = (ticks: number[]) => {
        for (const _tick of ticks) {
          const d = decay(persist, FEEDBACK_DT);
          v = posted ? v * d : tonemap(v * d * vg * 1.1);
        }
      };
      for (let n = 0; n < Math.round(seconds * fps); n++) {
        advance(clock.drainThrough(n / fps));
      }
      advance(clock.drainThrough(seconds - FEEDBACK_DT / 2));
      return v;
    };

    for (const p of persists) {
      const at60 = settle(p, 60, 0.5, true);
      for (const fps of [24, 30, 48, 60, 90, 120, 144]) {
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
    const old = (() => {
      const run = (fps: number) => {
        let v = tonemap(0.9 * vg * 1.1);
        const d = Math.pow(0.4, 60 / fps);
        for (let n = 0; n < Math.round(0.5 * fps); n++) v = tonemap(v * d * vg * 1.1);
        return v;
      };
      return [run(30), run(60)];
    })();
    expect(Math.abs(old[0] / old[1] - 1), "30 vs 60 fps before the fix").toBeGreaterThan(0.25);
  });

  it("uses one authored decay on state ticks and none on presentation-only frames", () => {
    for (const p of [0.0001, 0.28, 0.4, 0.6, 0.98]) {
      expect(decay(p, FEEDBACK_DT)).toBeCloseTo(p, 12);
      expect(decay(p, 0)).toBe(1);
    }
    expect(isFeedbackTick(1 / 60)).toBe(true);
    expect(isFeedbackTick(1 / 120)).toBe(false);
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
    const d = decay(0.4, FEEDBACK_DT);
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

/**
 * Oscilloscope depth wave (Track B batch 3) — the mode's ceiling was one mono
 * trace on one horizontal axis with one graticule. The wave's contract is that
 * every new axis (band-split lanes, dot/sample-hold beam modes, graticule
 * faces, the Pulse/Detail master handles) lands WITHOUT moving a single
 * default pixel: each generalisation reduces to an exact IEEE identity
 * (multiply by 1, add 0, select's false arm) or to a branch that cannot be
 * entered at the defaults. These tests prove the parts of that contract a Node
 * test can reach — by lifting the shipped expressions out of the WGSL, not by
 * restating them — and the device GPU pixel matrix holds the rest
 * (oscilloscope/@defaults and the seven legacy style hashes must NOT move).
 */

const wgsl = oscilloscope.wgsl;

/** Extract the right-hand side of one `<head> <expr>;` in the shader (head
 * includes the `=`), so the measurements below track the shipped line instead
 * of quietly going stale (spectrumBars.test.ts precedent). */
const rhs = (head: string): string => {
  const esc = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc} ([^;]+);`).exec(wgsl);
  if (!m) throw new Error(`expression not found in the WGSL: ${head}`);
  return m[1].replace(/\s+/g, " ").trim();
};

/** softLimit(), lifted straight out of the shared prelude — its body is
 * letter-for-letter valid JS once tanh is in scope, so it is EVALUATED rather
 * than re-derived (same spirit as the tonemap lift above). */
const softLimit = (() => {
  const src = /fn softLimit\(x: f32, lim: f32\) -> f32 \{([\s\S]*?)\n\}/.exec(
    SHADER_SOURCES.header,
  )?.[1];
  if (!src) throw new Error("softLimit() not found in the prelude");
  return new Function("x", "lim", `const tanh = Math.tanh; ${src}`) as (
    x: number,
    lim: number,
  ) => number;
})();

describe("single-trace neutrality: the lane kit at exact-identity arguments", () => {
  it("the traces branch routes the default through (0.5, 1.0, 0.0, 0.0, 1.0)", () => {
    // Literal arguments, asserted as text: center 0.5 (the shipped centre
    // line), hscale 1.0, band 0.0 (full-range signal), hueOff 0.0, dim 1.0.
    const single = wgsl.indexOf(
      "col = traceLayer(col, fuv, wx, xs, 0.5, 1.0, 0.0, 0.0, 1.0, gain, beatP);",
    );
    const gate = wgsl.indexOf("if (P_traces() < 1.5) {");
    expect(gate).toBeGreaterThan(0);
    expect(single).toBeGreaterThan(gate);
    // ...and it is the FIRST branch, so traces=1 never reaches the multi arms.
    expect(single).toBeLessThan(wgsl.indexOf("P_traces() < 2.5"));
  });

  it("colIn is threaded by value: adds land on the running colour in shipped order", () => {
    // IEEE addition does not associate, so "sum the lane, add it once" would
    // drift by ulps against the pre-wave inline sequence. The structure that
    // prevents it: traceLayer copies colIn and every beam add is `col +=`.
    expect(wgsl).toContain("fn traceLayer(colIn: vec3f");
    expect(wgsl).toContain("var col = colIn;");
    expect(wgsl).toContain("col += beam * P_traceBright() * dim;");
  });

  it("amp: the lane height scale is an exact *1.0 at the single call", () => {
    const expr = rhs("let amp =");
    expect(expr).toBe("sign(raw) * softLimit(abs(raw), P_traceClamp()) * hscale");
    const ampOf = new Function(
      "raw",
      "P_traceClamp",
      "hscale",
      "sign",
      "softLimit",
      "abs",
      `return ${expr};`,
    ) as (
      raw: number,
      clampP: () => number,
      hscale: number,
      sign: (x: number) => number,
      soft: typeof softLimit,
      abs: (x: number) => number,
    ) => number;
    for (const clampV of [0.2, 0.3, 0.44, 0.5]) {
      for (const raw of [-0.9, -0.44, -0.1, -1e-8, -0, 0, 1e-8, 0.05, 0.317, 0.44, 2.5]) {
        const preWave = Math.sign(raw) * softLimit(Math.abs(raw), clampV);
        expect(ampOf(raw, () => clampV, 1.0, Math.sign, softLimit, Math.abs)).toBe(preWave);
      }
    }
    // Non-vacuity: a stacked lane genuinely scales.
    expect(ampOf(0.3, () => 0.44, 0.55, Math.sign, softLimit, Math.abs)).toBeCloseTo(
      0.55 * softLimit(0.3, 0.44),
      15,
    );
  });

  it("traceHue: the lane hue offset is an exact +0.0 at the single call", () => {
    const expr = rhs("let traceHue =");
    expect(expr).toBe("P_hue() + hueOff + w * P_hueWave() + sweep * P_hueWave() * 0.4");
    const hueOf = new Function("P_hue", "hueOff", "w", "P_hueWave", "sweep", `return ${expr};`) as (
      hue: () => number,
      hueOff: number,
      w: number,
      hueWave: () => number,
      sweep: number,
    ) => number;
    for (const hue of [0, 160, 285, 359.5]) {
      for (const w of [-1.3, -0.2, 0, 0.7, 1.1]) {
        for (const sweep of [-1, -0.35, 0, 0.42, 1]) {
          // The pre-wave association: ((hue + w*hw) + sweep*hw*0.4). Adding a
          // leading exact +0 term cannot move it: (hue + 0) === hue in IEEE.
          const preWave = hue + w * 24 + sweep * 24 * 0.4;
          expect(
            hueOf(
              () => hue,
              0.0,
              w,
              () => 24,
              sweep,
            ),
          ).toBe(preWave);
        }
      }
    }
  });

  it("the ghost and fill read the lane centre and drawn profile", () => {
    // At the single call these are the shipped 0.5 / y / amp exactly (yP and
    // ampP initialise from the vector-mode y and amp, center is 0.5).
    expect(wgsl).toContain("let ym = center - ampP;");
    expect(wgsl).toContain(
      "let between = step(min(yP, center), fuv.y) * step(fuv.y, max(yP, center));",
    );
    expect(wgsl).toContain("let fade = 1.0 - abs(fuv.y - center) / max(abs(ampP), 0.001);");
    expect(wgsl).toContain("var yP = y;");
    expect(wgsl).toContain("var ampP = amp;");
  });
});

describe("laneWave: the fragment-local band split", () => {
  const calmSrc = /fn calmWave\(x: f32, calm: f32\) -> f32 \{([\s\S]*?)\n\}/.exec(wgsl)?.[1];
  const laneSrc = /fn laneWave\(x: f32, band: f32\) -> f32 \{([\s\S]*?)\n\}/.exec(wgsl)?.[1];
  if (!calmSrc || !laneSrc) throw new Error("calmWave/laneWave not found in the WGSL");

  // Both bodies are valid JS: evaluate the shipped source, not a restatement.
  const calmOf = new Function("x", "calm", "waveAt", calmSrc) as (
    x: number,
    calm: number,
    waveAt: (x: number) => number,
  ) => number;
  const laneOf = new Function("x", "band", "calmWave", "P_calm", "u", laneSrc) as (
    x: number,
    band: number,
    calmWave: (x: number, calm: number) => number,
    calm: () => number,
    u: { bass: number; mid: number; treble: number },
  ) => number;

  // A two-component groove like the demo's: one low (4 cycles/window) and one
  // high (17 cycles) sinusoid. Integer cycle counts make the discrete
  // projections below exact (orthogonal over 512 uniform samples), and the
  // box blur only phase-symmetrically shifts taps, so each lane stays an
  // exact multiple of these two components.
  const low = (x: number) => Math.sin(2 * Math.PI * 4 * x);
  const high = (x: number) => Math.sin(2 * Math.PI * 17 * x);
  const waveAt = (x: number) => 0.45 * low(x) + 0.2 * high(x);
  const u = { bass: 0.7, mid: 0.5, treble: 0.42 };
  const calmW = (x: number, c: number) => calmOf(x, c, waveAt);
  const lane = (x: number, band: number) => laneOf(x, band, calmW, () => 0.55, u);
  const project = (f: (x: number) => number, g: (x: number) => number) => {
    let s = 0;
    const N = 512;
    for (let i = 0; i < N; i++) s += f(i / N) * g(i / N);
    return (2 * s) / N;
  };

  it("band 0 returns the shipped signal bit-exactly, before any band math runs", () => {
    // Structural: the early return sits directly after base's declaration, so
    // no band arithmetic can touch the single-trace path even by rounding.
    expect(
      /let base = calmWave\(x, P_calm\(\)\);\s*if \(band < 0\.5\) \{ return base; \}/.test(laneSrc),
    ).toBe(true);
    // Behavioural: composed through the lifted calmWave, bit-equal everywhere.
    for (let i = 0; i <= 512; i++) {
      const x = i / 512;
      expect(lane(x, 0)).toBe(calmW(x, 0.55));
    }
  });

  it("the bass lane sheds the high component and keeps the low one", () => {
    const bassHigh = project((x) => lane(x, 3), high);
    const bassLow = project((x) => lane(x, 3), low);
    expect(Math.abs(bassLow)).toBeGreaterThan(0.15); // the bassline survives
    expect(Math.abs(bassHigh)).toBeLessThan(0.15 * Math.abs(bassLow)); // the hats do not
  });

  it("the treble lane is dominated by the detail the blur sheds", () => {
    const trebHigh = project((x) => lane(x, 2), high);
    const trebLow = project((x) => lane(x, 2), low);
    expect(Math.abs(trebHigh)).toBeGreaterThan(0.15);
    expect(Math.abs(trebHigh)).toBeGreaterThan(Math.abs(trebLow));
  });

  it("the 2-lane low shelf is low-dominated, and the lanes genuinely differ", () => {
    const lowsHigh = project((x) => lane(x, 1), high);
    const lowsLow = project((x) => lane(x, 1), low);
    expect(Math.abs(lowsHigh)).toBeLessThan(0.1 * Math.abs(lowsLow));
    // Non-vacuity across the deck: every band produces its own signal.
    const at = (band: number) => lane(0.137, band);
    const values = [at(0), at(1), at(2), at(3), at(4)];
    expect(new Set(values.map((v) => v.toFixed(12))).size).toBe(values.length);
  });

  it("every lane still answers to Calm (the cuts ride on top of it)", () => {
    // Smoothing the scope smooths the whole bench: at a higher Calm the
    // treble residual weakens, because the base itself sheds detail.
    const laneCalm = (x: number, band: number, c: number) => laneOf(x, band, calmW, () => c, u);
    const trebAt = (c: number) => Math.abs(project((x) => laneCalm(x, 2, c), high));
    expect(trebAt(1)).toBeLessThan(trebAt(0.1));
  });
});

describe("beam modes: sampled fields behind a branch vector mode never enters", () => {
  it("the vector distance field is computed first, the gate after it", () => {
    const dAt = wgsl.indexOf("var d = abs(fuv.y - y);");
    const gateAt = wgsl.indexOf("if (P_renderMode() > 0.5) {");
    expect(dAt).toBeGreaterThan(0);
    expect(gateAt).toBeGreaterThan(dAt);
  });

  it("the dot width factor sits in select's TRUE arm only", () => {
    // select's false arm hands the untouched accessor through: at the default
    // renderMode 0 the condition is false and cw IS P_coreWidth() — the same
    // value the pre-wave smoothstep read, no multiply applied.
    const expr = rhs("let cw =");
    expect(expr).toBe(
      "select(P_coreWidth(), P_coreWidth() * 2.6, P_renderMode() > 0.5 && P_renderMode() < 1.5)",
    );
    const cwOf = new Function("P_coreWidth", "P_renderMode", "select", `return ${expr};`) as (
      coreWidth: () => number,
      renderMode: () => number,
      select: <T>(f: T, t: T, c: boolean) => T,
    ) => number;
    const select = <T>(f: T, t: T, c: boolean) => (c ? t : f);
    for (const cwv of [0.001, 0.0035, 0.01]) {
      expect(
        cwOf(
          () => cwv,
          () => 0,
          select,
        ),
      ).toBe(cwv); // vector: untouched
      expect(
        cwOf(
          () => cwv,
          () => 1,
          select,
        ),
      ).toBe(cwv * 2.6); // dots: pips
      expect(
        cwOf(
          () => cwv,
          () => 2,
          select,
        ),
      ).toBe(cwv); // hold: line width
    }
    // ...and the beam core reads cw where it used to read the accessor.
    expect(wgsl).toContain("let core = smoothstep(cw, cw * 0.23, d);");
  });

  it("sample density rides the Motion Detail master, with a floor", () => {
    const expr = rhs("let n =");
    expect(expr).toBe("max(floor(select(96.0, 44.0, P_renderMode() > 1.5) * u.detail), 6.0)");
    // Inside the renderMode branch: vector mode never evaluates a density.
    expect(wgsl.indexOf("let n = max(floor(")).toBeGreaterThan(
      wgsl.indexOf("if (P_renderMode() > 0.5) {"),
    );
  });

  it("both sampled modes reuse the shipped limiter chain on their samples", () => {
    // The held/dot profile passes through the same sign/softLimit/hscale
    // chain as the vector trace — a sampled beam obeys the same ceiling.
    expect(wgsl).toContain(
      "let hamp = sign(hraw) * softLimit(abs(hraw), P_traceClamp()) * hscale;",
    );
    expect(wgsl).toContain(
      "let sy = center + sign(sraw) * softLimit(abs(sraw), P_traceClamp()) * hscale;",
    );
    expect(wgsl).toContain(
      "let ny = center + sign(nraw) * softLimit(abs(nraw), P_traceClamp()) * hscale;",
    );
    // Sample-hold joins treads with square risers rather than torn gaps.
    expect(wgsl).toContain("let side = select(-1.0, 1.0, fract(wx * n) > 0.5);");
    expect(wgsl).toContain("let dy = max(max(min(yP, ny) - fuv.y, fuv.y - max(yP, ny)), 0.0);");
  });
});

describe("graticule faces: the default face is the shipped mesh, verbatim", () => {
  it("face 0 contains the pre-wave graticule lines, and runs first", () => {
    const gate = wgsl.indexOf("if (P_graticule() < 0.5) {");
    expect(gate).toBeGreaterThan(0);
    const branch = wgsl.slice(gate, wgsl.indexOf("} else if", gate));
    // The exact shipped construction: `var grid = 0.0;` overwritten by `=`
    // (not accumulated), so the value chain is identical to the pre-wave
    // `var grid = <mesh>` declaration.
    expect(wgsl).toContain("var grid = 0.0;");
    for (const line of [
      "let dv = vec2f(fuv.x * 10.0, fuv.y * 8.0);",
      "let gl = abs(fract(dv) - 0.5);",
      "grid = smoothstep(0.05, 0.0, gl.x) + smoothstep(0.05, 0.0, gl.y);",
      "grid += smoothstep(0.006, 0.0, abs(fuv.x - 0.5)) * 1.6",
      "+ smoothstep(0.006, 0.0, abs(fuv.y - 0.5)) * 1.6;",
    ]) {
      expect(branch, `face 0 lost the shipped line: ${line}`).toContain(line);
    }
  });

  it("face 1 (None) falls through every branch: grid stays 0, the add is exact", () => {
    // Branch conditions at graticule=1: <0.5 no, >2.5 no, >1.5 no — nothing
    // assigns, grid remains 0.0, and `col += anything * 0 * ...` adds +0,
    // which is the identity on every finite colour component.
    expect(wgsl).toContain("} else if (P_graticule() > 2.5) {");
    expect(wgsl).toContain("} else if (P_graticule() > 1.5) {");
    expect(wgsl).not.toContain("P_graticule() > 0.5"); // no fourth arm
    for (const col of [0, 0.028, 0.31, 1]) {
      expect(col + 0.32 * 0 * 0.06 * 1.4).toBe(col);
    }
  });

  it("faces 2 and 3 exist and share the beat-flash light", () => {
    // One col += line for every face: the furniture changes, the light does
    // not, so gridLevel and gridBeat keep meaning on all four faces.
    const adds = wgsl.match(/col \+= hsl2rgb\(P_hue\(\), 0\.25, 0\.32\) \* grid/g);
    expect(adds).toHaveLength(1);
  });
});

describe("motion masters: Pulse and Detail get their first handles", () => {
  it("every beat-driven brightness term rides u.pulse (exact 1x at default)", () => {
    for (const line of [
      "let hot = smoothstep(0.45, 0.95, core) * (0.75 + beatP * 0.5 * u.pulse);",
      "* (0.35 + P_glow() * 0.75) * (1.0 + beatP * 0.6 * u.pulse) * P_traceBright() * dim;",
      "col *= 1.0 + beatP * P_beatLift() * u.pulse;",
      "* P_gridLevel() * (1.0 + beatP * P_gridBeat() * u.pulse);",
    ]) {
      expect(wgsl, `pulse handle missing from: ${line}`).toContain(line);
    }
    // The identity the wiring rests on: (x * k) * 1 === x * k, bit-exactly.
    const hotExpr = /let hot = smoothstep\(0\.45, 0\.95, core\) \* \(([^;]+)\);/.exec(wgsl)?.[1];
    expect(hotExpr).toBeTruthy();
    const hotOf = new Function("beatP", "u", `return ${hotExpr};`) as (
      beatP: number,
      u: { pulse: number },
    ) => number;
    for (const beatP of [0, 0.31, 0.777, 1]) {
      expect(hotOf(beatP, { pulse: 1 })).toBe(0.75 + beatP * 0.5);
      expect(hotOf(beatP, { pulse: 0 })).toBe(0.75); // and it genuinely acts
    }
  });

  it("the mode now advertises pulse + detail, and still no rotation/spline", () => {
    expect(presetMasters(oscilloscope)).toEqual({
      rotation: false,
      pulse: true,
      detail: true,
      spectrumSmooth: false,
    });
  });
});

describe("param specs: conventions of the wave", () => {
  const specs = new Map(allParams(oscilloscope).map((p) => [p.key, p]));

  it("persist is promoted to the curated tier with its spec intact", () => {
    expect(advancedKeys(oscilloscope).has("persist")).toBe(false);
    const spec = oscilloscope.params.find((p) => p.key === "persist");
    expect(spec).toBeDefined();
    expect(spec!.group).toBe("motion");
    // The v2.53 ceiling measurement and the default both survive the move.
    expect([spec!.min, spec!.max, spec!.step, spec!.default]).toEqual([0, 0.6, 0.02, 0.4]);
  });

  it("the curated tier now covers all five lenses (motion was missing)", () => {
    const mainGroups = groupParams(oscilloscope, oscilloscope.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(mainGroups, `curated tier misses ${lens}`).toContain(lens);
    }
  });

  it("the new enums declare mod off with defaults on today's look", () => {
    for (const [key, values, def] of [
      ["traces", [1, 2, 3], 1],
      ["renderMode", [0, 1, 2], 0],
      ["graticule", [0, 1, 2, 3], 0],
    ] as const) {
      const spec = specs.get(key)!;
      expect(spec.control, key).toBe("enum");
      expect(spec.mod, key).toBe("off");
      expect(spec.control === "enum" && spec.options.map((o) => o.value)).toEqual([...values]);
      expect(spec.default, key).toBe(def);
    }
  });

  it("continuous new params stay smooth modulation targets", () => {
    for (const key of ["traceSpread", "bandHue", "bandDim"]) {
      const spec = specs.get(key);
      expect(spec, `missing param ${key}`).toBeDefined();
      expect(spec!.mod, `${key} must stay a smooth mod target`).toBeUndefined();
    }
    // Their defaults describe the stacked bench, inert while traces=1.
    expect(specs.get("traceSpread")!.default).toBe(0.25); // two divisions off centre
    expect(specs.get("traces")!.default).toBe(1);
  });

  it("every knob ships a hint", () => {
    for (const spec of allParams(oscilloscope)) {
      expect(spec.hint, `${spec.key} has no hint`).toBeTruthy();
    }
  });

  it("mirror stays the ghost trace (RP-7): key and disambiguating hints hold", () => {
    // This mode's `mirror` is a GHOST TRACE, unlike every fold-`mirror`
    // elsewhere — the key is forever, the hints carry the disambiguation.
    const mirror = specs.get("mirror")!;
    expect(mirror.control).toBe("toggle");
    expect(mirror.hint).toMatch(/ghost/i);
    expect(specs.get("kaleido")!.hint).toMatch(/fold/i);
  });
});

describe("IDs are forever: preset id, param keys and legacy styles survive", () => {
  it("the preset id and every pre-wave param key are unchanged", () => {
    expect(oscilloscope.id).toBe("oscilloscope");
    const keys = new Set(allParams(oscilloscope).map((p) => p.key));
    for (const key of [
      "hue",
      "gain",
      "calm",
      "glow",
      "traceBright",
      "fill",
      "mirror",
      "traceClamp",
      "coreWidth",
      "agFloor",
      "agRange",
      "hueWave",
      "ghostDim",
      "fillDim",
      "gridLevel",
      "gridBeat",
      "scanline",
      "beatLift",
      "bgLevel",
      "vignette",
      "persist",
      "kaleido",
    ]) {
      expect(keys.has(key), `pre-wave key "${key}" is gone`).toBe(true);
    }
  });

  it("the legacy deck keeps its ids; the four new identities join it", () => {
    const ids = (oscilloscope.styles ?? []).map((s) => s.id);
    for (const id of ["neon", "lissajous", "amber", "ribbon", "laser", "ecg", "smoke"]) {
      expect(ids, `legacy style "${id}" is gone`).toContain(id);
    }
    for (const id of ["bench", "sampler", "logic", "fireflies"]) {
      expect(ids, `new style "${id}" missing`).toContain(id);
    }
    // First chip is still the defaults (the strip opens on an active chip).
    expect(oscilloscope.styles?.[0]?.values).toEqual({});
  });
});

describe("styles: the deck exercises every new axis", () => {
  const resolved = (oscilloscope.styles ?? []).map(
    (s) => ({ ...defaultParams(oscilloscope), ...s.values }) as Record<string, number>,
  );

  it("both stacked layouts, both sampled beam modes, all three new faces", () => {
    expect(resolved.some((v) => v.traces === 2)).toBe(true); // logic pair
    expect(resolved.some((v) => v.traces === 3)).toBe(true); // the bench
    expect(resolved.some((v) => v.renderMode === 1)).toBe(true); // dots
    expect(resolved.some((v) => v.renderMode === 2)).toBe(true); // sample-hold
    for (const face of [1, 2, 3]) {
      expect(
        resolved.some((v) => v.graticule === face),
        `no style exercises graticule face ${face}`,
      ).toBe(true);
    }
  });

  it("the kaleido fold now has two genuinely different exercises", () => {
    // The enum has exactly two options (Off is every other style's default,
    // and the in-shader rationale caps the fold at bilateral); broader deck
    // coverage means option 2 carried by two different instruments — the
    // line figure (Lissajous) and the dot swarm (Fireflies).
    const folded = resolved.filter((v) => v.kaleido === 2);
    expect(folded.length).toBeGreaterThanOrEqual(2);
    expect(new Set(folded.map((v) => v.renderMode)).size).toBeGreaterThanOrEqual(2);
  });
});
