import { describe, expect, it } from "vitest";
import { aurora } from "./aurora";
import { oscilloscope } from "./oscilloscope";
import { tunnelRings } from "./tunnelRings";
import { SHADER_SOURCES } from "../webgpuRenderer";

/**
 * The club mirror and the audio index — three consumers, one defect.
 *
 * `kaleido()` collapses the whole circle (or, for the two presets that fold a
 * point on the x axis, the whole width) onto ONE fundamental domain. It is
 * correct: folding geometry is what it exists for. What was wrong is what each
 * consumer did next — it kept feeding the folded coordinate to a mapping
 * written for the unfolded range, so the audio index swept only the fraction of
 * the spectrum (or of the waveform buffer) that the fold left reachable:
 *
 *   tunnelRings   mirror 6 = the shipped Kaleido Tube   bins 0-15 of 96
 *   aurora        mirror 2 = the shipped Cathedral      front curtain lost its
 *                                                       whole low half
 *   oscilloscope  kaleido 2 = the shipped Lissajous     buffer [0.5, 1] only
 *
 * echoTrails had the same defect and was fixed first; its own suite covers it.
 * This file measures the other three through THEIR OWN shipped arithmetic: the
 * fold is lifted out of the shared prelude, each preset's mapping is lifted out
 * of its WGSL, and the two are composed. Nothing here restates a formula that
 * the shader also states — where a number is asserted it was produced by
 * running the shipped source, not by copying it.
 */

/** The prelude's own TAU, so nothing here can drift from the shader's. */
const TAU = Number(/const TAU: f32 = ([0-9.]+);/.exec(SHADER_SOURCES.header)?.[1]);

/** WGSL builtins the lifted expressions call, in the shader's spelling. */
const WGSL_SHIM = `const TAU = ${TAU};
  const min = Math.min, max = Math.max, abs = Math.abs, floor = Math.floor;
  const mix = (a, b, t) => a + (b - a) * t;
  const select = (f, t, c) => (c ? t : f);
  const fract = (x) => x - Math.floor(x);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };`;

/**
 * Compile a chain of `let <name> = <expr>;` lines out of a preset body, in
 * order, into one function returning the last of them. Lifting rather than
 * restating is the whole point: if the shader's line changes, the measurement
 * below changes with it instead of quietly going stale.
 */
const liftChain = (body: string, names: string[], args: string[]) => {
  const decls = names.map((n) => {
    const src = new RegExp(`let ${n} = ([^;]*);`).exec(body)?.[1];
    if (src === undefined) throw new Error(`${n} expression not found in the WGSL`);
    return `const ${n} = ${src.replace(/\s+/g, " ")};`;
  });
  return new Function(
    ...args,
    `${WGSL_SHIM}
     ${decls.join("\n     ")}
     return ${names[names.length - 1]};`,
  ) as (...a: never[]) => number;
};

const kaleidoSrc = /fn kaleido\(p: vec2f, segments: f32\) -> vec2f \{([\s\S]*?)\n\}/.exec(
  SHADER_SOURCES.header,
)?.[1];

describe("the shared fold this file composes against", () => {
  it("still has the shape the shims below reconstruct", () => {
    // Guards every transcription in this file: if kaleido()'s branch structure
    // or its reconstruction changes, this fails instead of the suites quietly
    // measuring a fold the renderer no longer performs.
    expect(kaleidoSrc, "kaleido() not found in the prelude").toBeTruthy();
    expect(kaleidoSrc).toContain("if (segments < 1.5) { return p; }");
    expect(kaleidoSrc).toContain("if (segments < 2.5) { return vec2f(abs(p.x), p.y); }");
    expect(kaleidoSrc).toContain("return vec2f(cos(a), sin(a)) * length(p);");
  });
});

/**
 * kaleido() on a plain {x, y}. The wedge branch is the prelude's own two lines,
 * lifted; the two early returns are transcribed and pinned by the assertions
 * above. The reconstruction is angle-preserving (it re-emits the folded angle at
 * the original radius), which is what lets the tunnel suite work in angles.
 */
const kaleidoVec = (() => {
  const seg = /let seg = ([^;]*);/.exec(kaleidoSrc ?? "")?.[1];
  const fold = /\n\s*a = ([^;]*);/.exec(kaleidoSrc ?? "")?.[1];
  if (!seg || !fold) throw new Error("kaleido()'s fold not found in the prelude");
  return new Function(
    "p",
    "segments",
    `${WGSL_SHIM}
     if (segments < 1.5) { return p; }
     if (segments < 2.5) { return { x: Math.abs(p.x), y: p.y }; }
     const seg = ${seg};
     let a = Math.atan2(p.y, p.x);
     a = ${fold.replace(/\s+/g, " ")};
     const len = Math.hypot(p.x, p.y);
     return { x: Math.cos(a) * len, y: Math.sin(a) * len };`,
  ) as (p: { x: number; y: number }, segments: number) => { x: number; y: number };
})();

/** The same fold expressed on an angle, which is all a spectrum index sees. */
const foldAngle = (a: number, segments: number) => {
  const p = kaleidoVec({ x: Math.cos(a), y: Math.sin(a) }, segments);
  return Math.atan2(p.y, p.x);
};

const BINS = 96; // featurePipeline's binCount
/** binAt()'s bin-centre anchor: which index x actually addresses. */
const binIndex = (x: number) =>
  Math.min(BINS - 1, Math.max(0, Math.round(Math.min(Math.max(x, 0), 0.999) * BINS - 0.5)));

/**
 * Largest step of a sampled sweep, and the same sweep sampled twice as finely.
 * A continuous function halves its largest step under refinement; a genuine
 * discontinuity keeps its height. This is how "no seam" is measured rather than
 * argued — see each caller for what is being swept.
 */
const refinementRatio = (at: (t: number) => number, n: number) => {
  const worstStep = (steps: number) => {
    let worst = 0;
    let prev = at(0);
    for (let i = 1; i <= steps; i++) {
      const cur = at(i / steps);
      worst = Math.max(worst, Math.abs(cur - prev));
      prev = cur;
    }
    return worst;
  };
  return worstStep(n) / worstStep(n * 2);
};

// ---------------------------------------------------------------------------

/**
 * Tunnel — the spectrum around the tube's circumference.
 *
 * The wall angle is read off the coordinate AFTER kaleido() folded it, so it is
 * in [-pi/2, pi/2] at mirror 2 and [0, pi/N] at N >= 3. The unfolded mapping,
 * abs(fract(a / TAU + 0.5) * 2 - 1), is a triangle over the FULL circle, so on a
 * folded angle it only ever climbed the first 1/N of its own ramp.
 */
describe("tunnel club mirror spectrum coverage", () => {
  const body = tunnelRings.wgsl;

  it("keys its branch off the same two thresholds the fold does", () => {
    // 1.5 = fold at all, 2.5 = radial wedges rather than a plain left/right
    // mirror. If the preset's thresholds and kaleido()'s disagree, the domain
    // it rescales is not the domain the fold produced.
    expect(body).toContain("let folded = mirrorN >= 1.5;");
    expect(body).toMatch(/let foldLo = select\([^;]*mirrorN >= 2\.5\);/);
    expect(body).toMatch(/let foldSpan = select\([^;]*mirrorN >= 2\.5\);/);
  });

  const xsOf = liftChain(body, ["folded", "foldLo", "foldSpan", "xs"], ["a", "mirrorN"]) as (
    a: number,
    mirrorN: number,
  ) => number;

  /**
   * The mapping this replaced, verbatim from the pre-change source line. Stated
   * once, here, because a before/after contrast needs a `before` that the file
   * under test no longer contains.
   */
  const sliced = (a: number) => Math.abs((a / TAU + 0.5 - Math.floor(a / TAU + 0.5)) * 2 - 1);

  /** Every bin the wall addresses over one full trip round the frame. */
  const reached = (map: (a: number, m: number) => number, m: number, steps = 200_000) => {
    const hit = new Set<number>();
    for (let i = 0; i < steps; i++)
      hit.add(binIndex(map(foldAngle(-Math.PI + (TAU * i) / steps, m), m)));
    return hit;
  };

  it("every club-mirror setting now reaches the whole spectrum", () => {
    for (let m = 1; m <= 12; m++) {
      const hit = reached(xsOf, m);
      expect(hit.size, `mirror ${m} reaches ${hit.size} of ${BINS} bins`).toBe(BINS);
    }
  });

  it("...and the mapping it replaced reached a bass-only slice", () => {
    // Non-vacuity, and the defect's actual size. Unfolded is unaffected; every
    // folded setting starved, and the harder the fold the worse it got.
    const before = (m: number) => [...reached((a) => sliced(a), m)];
    expect(before(1).length).toBe(96);
    expect(before(2).length).toBe(48);
    expect(before(6).length).toBe(16); // shipped Kaleido Tube
    expect(before(12).length).toBe(8);
    // ...and it was the BOTTOM of the spectrum every time: the fold pins one
    // edge of the window at bin 0, so a folded tunnel saw the kick and nothing
    // above it. Kaleido Tube's own entry calls it "spectrum-lit stained glass".
    for (const m of [2, 3, 4, 6, 8, 12]) {
      expect(Math.min(...before(m)), `mirror ${m} low edge`).toBe(0);
      expect(Math.max(...before(m)), `mirror ${m} high edge`).toBe(Math.round(96 / m) - 1);
    }
  });

  it("closes every wedge boundary — the fold makes bass meet bass", () => {
    // Swept over the true screen angle, so every wedge edge in the frame is
    // crossed. The fold is a mirror, so the folded angle runs 0 -> span -> 0
    // and a linear rescale of it is a triangle: continuous at every edge.
    for (const m of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const at = (t: number) => xsOf(foldAngle(-Math.PI + TAU * t, m), m);
      expect(refinementRatio(at, 4096), `mirror ${m}`).toBeGreaterThan(1.9);
    }
    // Non-vacuity: the unfolded sweep is a triangle too — this preset always
    // wrote its own mirror — so it halves as well. The ratio is measuring
    // continuity, and both branches have it; what changed is the RANGE.
    expect(refinementRatio((t) => xsOf(foldAngle(-Math.PI + TAU * t, 1), 1), 4096)).toBeGreaterThan(
      1.9,
    );
  });

  it("leaves club mirror 1 on the exact mapping it always had", () => {
    // Bit-equal, not close: seven of the eight shipped styles render through
    // this branch and none of them may move.
    for (let i = 0; i <= 4096; i++) {
      const a = -Math.PI + (TAU * i) / 4096;
      expect(xsOf(a, 1)).toBe(sliced(a));
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Aurora — the per-curtain spectrum window.
 *
 * This preset folds a point on the x axis rather than an angle, so the fold
 * lands the screen coordinate in [0.5, 1] and the curtain windows moved with
 * it. The fix gives the spectrum its own coordinate; the geometry keeps the
 * folded one, which is what the Symmetric switch is for.
 */
describe("aurora symmetric fold spectrum coverage", () => {
  const body = aurora.wgsl;
  const ASPECT = 16 / 9;

  const xOf = liftChain(body, ["cx", "foldedX", "x"], ["uv", "u", "kaleido", "vec2f", "P_mirror"]);
  const specXOf = liftChain(
    body,
    ["cx", "foldedX", "x", "specX"],
    ["uv", "u", "kaleido", "vec2f", "P_mirror"],
  );
  /** The window line, unchanged by this fix — only WHICH coordinate feeds it. */
  const sxOf = liftChain(body, ["sx"], ["specX", "fi"]) as (specX: number, fi: number) => number;

  const evalAt = (f: (...a: never[]) => number, uvx: number, mirror: number) =>
    (
      f as unknown as (
        uv: { x: number },
        u: { aspect: number },
        k: typeof kaleidoVec,
        v: (x: number, y: number) => { x: number; y: number },
        pm: () => number,
      ) => number
    )(
      { x: uvx },
      { aspect: ASPECT },
      kaleidoVec,
      (x, y) => ({ x, y }),
      () => mirror,
    );

  /** Every bin curtain `fi` addresses over the full width of the frame. */
  const reached = (
    coord: (uvx: number, m: number) => number,
    m: number,
    fi: number,
    steps = 100_000,
  ) => {
    const hit = new Set<number>();
    for (let i = 0; i <= steps; i++) hit.add(binIndex(sxOf(coord(i / steps, m), fi)));
    return hit;
  };
  const after = (uvx: number, m: number) => evalAt(specXOf, uvx, m);
  const before = (uvx: number, m: number) => evalAt(xOf, uvx, m);
  const span = (s: Set<number>) => [Math.min(...s), Math.max(...s), s.size];

  it("Mirrored dropped the bottom of every curtain's window", () => {
    // Non-vacuity and the defect's size, measured through the shipped window
    // line with the coordinate it used to be handed.
    expect(span(reached(before, 1, 0))).toEqual([0, 78, 79]);
    expect(span(reached(before, 2, 0))).toEqual([39, 78, 40]);
    expect(span(reached(before, 2, 1))).toEqual([48, 87, 40]);
    expect(span(reached(before, 2, 2))).toEqual([56, 95, 40]);
    // The union over the whole shipped 3-curtain stack, which is what Cathedral
    // renders: everything below bin 39 was unreachable by any curtain.
    const union = new Set([0, 1, 2].flatMap((fi) => [...reached(before, 2, fi)]));
    expect(span(union)).toEqual([39, 95, 57]);
  });

  it("...and Mirrored now reads exactly what unmirrored reads", () => {
    for (const fi of [0, 1, 2]) {
      expect(span(reached(after, 2, fi))).toEqual(span(reached(after, 1, fi)));
    }
    expect(span(reached(after, 2, 0))).toEqual([0, 78, 79]);
    const union = new Set([0, 1, 2].flatMap((fi) => [...reached(after, 2, fi)]));
    expect(span(union)).toEqual([0, 95, 96]);
  });

  it("closes the mirror line — bass meets bass down the centre", () => {
    // Swept across the whole frame, so the one interior boundary the fold
    // creates (uv.x = 0.5) is crossed. specX is 0 from both sides there.
    expect(refinementRatio((t) => after(t, 2), 4096)).toBeGreaterThan(1.9);
    expect(after(0.5, 2)).toBe(0);
  });

  it("leaves Symmetric = Off on the exact coordinate it always had", () => {
    for (let i = 0; i <= 4096; i++) {
      const uvx = i / 4096;
      expect(after(uvx, 1)).toBe(before(uvx, 1));
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Oscilloscope — the waveform sweep.
 *
 * Not a spectrum index: both halves of a waveform window carry the same
 * frequencies, so the case against the old mapping is not deafness. It is that
 * the discarded half is the one holding the trigger — the rising zero crossing
 * the pipeline aligns sample 0 to so the trace stands still — and that the
 * folded scope drew half the sweep in the same screen area as the unfolded one
 * drew all of it.
 */
describe("oscilloscope kaleido fold waveform sweep", () => {
  const body = oscilloscope.wgsl;
  const WAVE = 512; // webgpuRenderer's WAVE_POINTS
  const ASPECT = 16 / 9;

  const fuvxOf = liftChain(
    body,
    ["kp", "fuv"],
    ["uv", "u", "kaleido", "centered", "vec2f", "P_kaleido"],
  );
  const wxOf = liftChain(
    body,
    ["kp", "fuv", "wx"],
    ["uv", "u", "kaleido", "centered", "vec2f", "P_kaleido"],
  );

  const evalAt = (f: (...a: never[]) => number, uvx: number, k: number) =>
    (
      f as unknown as (
        uv: { x: number; y: number },
        u: { aspect: number },
        kal: typeof kaleidoVec,
        centered: (uv: { x: number; y: number }) => { x: number; y: number },
        vec2f: (x: number, y: number) => { x: number; y: number },
        pk: () => number,
      ) => number
    )(
      { x: uvx, y: 0.5 },
      { aspect: ASPECT },
      kaleidoVec,
      (uv) => ({ x: (uv.x - 0.5) * ASPECT, y: uv.y - 0.5 }),
      (x, y) => ({ x, y }),
      () => k,
    );
  // `fuv` is a vec2f in the shader; the shim's constructor returns {x, y}, so
  // the lifted chain hands back the pair and the sweep coordinate is .x.
  const fuvx = (uvx: number, k: number) => (evalAt(fuvxOf, uvx, k) as unknown as { x: number }).x;
  const wx = (uvx: number, k: number) => evalAt(wxOf, uvx, k);

  /** waveAt()'s two taps: the sample pair x actually mixes between. */
  const waveTaps = (x: number) => {
    const fi = Math.min(Math.max(x, 0), 0.999) * (WAVE - 1);
    const i = Math.floor(fi);
    return [i, Math.min(i + 1, WAVE - 1)];
  };
  const reached = (coord: (uvx: number, k: number) => number, k: number, steps = 100_000) => {
    const hit = new Set<number>();
    for (let i = 0; i <= steps; i++) for (const t of waveTaps(coord(i / steps, k))) hit.add(t);
    return hit;
  };

  it("Mirrored drew only the buffer's second half, trigger discarded", () => {
    // Non-vacuity. The centre tap only — calmWave() also reaches +-2 * calm *
    // 0.012 of the buffer around it, which at Lissajous' Calm 0.35 is ~4 points
    // and does not change the picture.
    const b = [...reached(fuvx, 2)];
    expect([Math.min(...b), Math.max(...b), b.length]).toEqual([255, 511, 257]);
    // Sample 0 is the trigger. It sat outside the drawn window entirely, and
    // what landed on the mirror line — the apex of the figure, on the
    // graticule's bright centre column — was the arbitrary middle of the buffer.
    expect(fuvx(0.5, 2)).toBe(0.5);
  });

  it("...and now draws the whole buffer with the trigger on the mirror line", () => {
    const a = [...reached(wx, 2)];
    expect([Math.min(...a), Math.max(...a), a.length]).toEqual([0, 511, 512]);
    expect(wx(0.5, 2)).toBe(0);
    // Same reach as unfolded, in half the width: that is the cost this buys the
    // coverage with, and it is 2x samples per pixel, not more.
    expect([...reached(wx, 1)].length).toBe(512);
  });

  it("closes the mirror line — the sweep meets itself at the trigger", () => {
    expect(refinementRatio((t) => wx(t, 2), 4096)).toBeGreaterThan(1.9);
  });

  it("leaves Kaleidoscope = Off on the exact coordinate it always had", () => {
    for (let i = 0; i <= 4096; i++) {
      const uvx = i / 4096;
      expect(wx(uvx, 1)).toBe(fuvx(uvx, 1));
    }
  });
});
