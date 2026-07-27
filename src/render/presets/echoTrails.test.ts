import { describe, expect, it } from "vitest";
import { echoTrails } from "./echoTrails";
import { SHADER_SOURCES } from "../webgpuRenderer";

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
 * The frame-rate law for the one preset that ACCUMULATES.
 *
 * Echo Trails feeds its own output back in, so its steady-state brightness is
 * injection / (1 - loopGain). Normalising the decay per second while leaving
 * the injection per rendered frame does not fix that ratio, it moves it into
 * the level: measured through the real export path at matched TRACK times,
 * the shipped Supernova style rendered at 0.64x the 60 Hz mean luminance at
 * 30 fps and 1.35x at 120 fps. That is preview-equals-export broken by the
 * frame rate alone, which is the app's one non-negotiable.
 *
 * shaderGolden freezes the WGSL text, so an unintended edit shows up there —
 * but a frozen string says nothing about whether the arithmetic is right.
 * These tests cover the two things the fix rests on and that a later edit
 * could quietly break: the exponent really is exactly zero at 60 fps (so the
 * compensation is a bit-exact no-op at the rate the looks were authored at),
 * and the shader's own compensation expression really does hold the
 * accumulator flat across frame rates.
 */
describe("echo-trails frame-rate compensation", () => {
  const body = echoTrails.wgsl;

  /**
   * The 60 fps no-op rests on an f32 identity, not on a comment: the shader
   * writes pow(x, fpsComp - 1.0) because pow(x, 0.0) is exactly 1.0, whereas
   * pow(x, 1.0) is exp2(log2(x)) on real hardware and does not round-trip.
   * That only holds if fpsComp lands on exactly 1.0 — a fact about the
   * export's time base (t = n / fps in f64, differenced, stored as the f32
   * `dt` uniform, multiplied by 60 in the shader), not about the shader.
   */
  it("fpsComp is exactly 1 / 2 / 0.5 at 60 / 30 / 120 fps", () => {
    const comps = (fps: number) => {
      const seen = new Set<number>();
      for (let n = 1; n <= 20000; n++) {
        // webgpuRenderer: dtRaw = time - lastRenderTime, written to an f32 uniform.
        const dt = Math.fround(n / fps - (n - 1) / fps);
        seen.add(Math.fround(dt * 60));
      }
      return [...seen];
    };
    expect(comps(60)).toEqual([1]);
    expect(comps(30)).toEqual([2]);
    expect(comps(120)).toEqual([0.5]);
    // ...and the identity every compensation term in the shader leans on.
    expect(Math.pow(0.93, 1 - 1)).toBe(1);
  });

  /**
   * Structural: anything ADDED into the accumulator has to carry the
   * compensation. That is precisely the regression that shipped — decay and
   * advection were normalised, the two `col +=` injections were not — and a
   * third source term is the obvious way for it to come back.
   */
  it("every source injected into the accumulator carries the compensation", () => {
    const loop = body.slice(body.indexOf("feedbackSample("), body.indexOf("col *= vg;"));
    expect(loop.length).toBeGreaterThan(0);
    const adds = loop.split("\n").filter((l) => /^\s*col \+=/.test(l));
    expect(adds.length).toBeGreaterThanOrEqual(2);
    for (const line of adds) {
      expect(line, `uncompensated injection: ${line.trim()}`).toContain("* deposit");
    }
    // `col = col + ...` would slip past the regex above.
    expect(loop).not.toMatch(/col\s*=\s*col\s*\+/);
    // The fed-back value carries the vignette's share of the loop gain — the
    // vignette multiply at the bottom is inside the loop, not a finishing step.
    expect(loop).toMatch(/feedbackSample\(puv\)[^\n]*\* vgFade;/);
    expect(body).toContain("let vgFade = select(pow(vg, fpsComp - 1.0), 1.0, authored);");
  });

  /**
   * Numeric: run the accumulator to steady state using the shader's OWN
   * expression for the injection scale, lifted out of the WGSL rather than
   * re-typed here. A test that restates the formula and then checks the
   * formula would only assert its own premise.
   */
  it("holds the accumulator level flat across frame rates", () => {
    const src = /let deposit = (.*);/.exec(body)?.[1];
    expect(src, "deposit expression not found in the WGSL").toBeTruthy();
    // WGSL select(falseVal, trueVal, cond) — the shader's 60 fps short circuit.
    const deposit = new Function(
      "loopGain",
      "fpsComp",
      `const pow = Math.pow, min = Math.min;
       const select = (f, t, c) => (c ? t : f);
       const authored = fpsComp === 1.0;
       return ${src};`,
    ) as (loopGain: number, fpsComp: number) => number;

    // Every shipped style's (trail length, vignette) pair, plus the defaults.
    const looks: Array<[number, number]> = [
      [0.92, 0.3],
      [0.97, 0.4],
      [0.9, 0.35],
      [0.87, 0.25],
      [0.98, 0.5],
      [0.91, 0.3],
      [0.96, 0.5],
      [0.93, 0.35],
    ];

    /** One pixel of the shader's loop: col = (col*decay^f*vg^(f-1) + I*deposit)*vg. */
    const settle = (decay: number, vg: number, f: number, compensate: boolean) => {
      const k = compensate ? deposit(Math.min(decay * vg, 0.999), f) : 1;
      const fade = compensate ? Math.pow(vg, f - 1) : 1;
      let col = 0;
      for (let n = 0; n < Math.round(6000 / f); n++)
        col = (col * Math.pow(decay, f) * fade + k) * vg;
      return col;
    };

    for (const [decay, vig] of looks) {
      // vignette() a quarter of the way out: 1 - d*d*amt.
      const vg = 1 - 0.25 * 0.25 * vig;
      const at60 = settle(decay, vg, 1, true);
      // 24, 30, 48, 120 fps — every rate the export offers, plus 144 Hz preview.
      for (const f of [2.5, 2, 1.25, 0.5, 60 / 144]) {
        expect(
          Math.abs(settle(decay, vg, f, true) / at60 - 1),
          `decay ${decay} vignette ${vig} at fpsComp ${f}`,
        ).toBeLessThan(1e-9);
      }
      // 60 fps is untouched: the compensation is exactly 1, not merely close.
      expect(deposit(Math.min(decay * vg, 0.999), 1)).toBe(1);
      // ...and none of this is vacuous — drop the compensation and 30 fps is
      // off by more than 10% on every one of these looks.
      expect(
        Math.abs(settle(decay, vg, 2, false) / at60 - 1),
        `decay ${decay} vignette ${vig}: uncompensated 30 fps should be far off`,
      ).toBeGreaterThan(0.1);
    }
  });
});

/**
 * The wrap seam — the UNFOLDED ring (Club mirror 1, the default and six of the
 * eight styles). The folded ring is a different mapping and has its own suite
 * below; every `folded` argument here is therefore false.
 *
 * Angle maps onto the spectrum linearly here, so the ring's two ends meet at
 * ang = pi with bin N-1 against bin 0 — and the feedback tunnel advects that
 * step outward every frame, which is what turned a one-pixel discontinuity
 * into the hard straight cut across the picture that the mode shipped with.
 *
 * These run the shader's OWN crossfade expressions, lifted out of the WGSL
 * exactly as the deposit test above does, over a realistic bass-heavy
 * spectrum. Restating the formula here and then checking the restatement
 * would assert nothing; pulling the source text means an edit that weakens
 * the blend fails the test instead of quietly agreeing with it.
 */
describe("echo-trails spectrum wrap seam", () => {
  const body = echoTrails.wgsl;

  /** A plausible spectrum: loud low end falling away to near-silent treble —
   * i.e. the case where the two ends of the sweep are furthest apart. */
  const bins = Array.from({ length: 64 }, (_, i) => Math.exp(-i / 9) * 0.95 + 0.02);
  const at = (x: number) =>
    bins[Math.min(bins.length - 1, Math.max(0, Math.round(x * bins.length - 0.5)))];

  /** Compile one `let <name> = <expr>;` line out of the shader into JS. */
  const lift = (name: string, args: string[]) => {
    const src = new RegExp(`let ${name} = ([^;]*);`).exec(body)?.[1];
    if (src === undefined) throw new Error(`${name} expression not found in the WGSL`);
    return new Function(
      ...args,
      `${WGSL_SHIM}
       return ${src.replace(/\s+/g, " ")};`,
    ) as (...a: never[]) => number;
  };

  const seamKof = lift("seamK", ["specX", "folded"]) as (specX: number, folded: boolean) => number;
  /** Club mirror 1: no fold, so the crossfade is live. */
  const seamK = (specX: number) => seamKof(specX, false);
  // binAt is the array sampler; the lifted `spec` line calls it by name.
  const specOf = (() => {
    const f = lift("spec", ["specX", "seamK", "binAt"]) as (
      specX: number,
      seamK: number,
      binAt: (x: number) => number,
    ) => number;
    return (x: number) => f(x, seamK(x), at);
  })();

  it("closes the ring: the two ends of the sweep meet at one value", () => {
    // Exactly equal, not merely close — this is the whole point of the blend.
    expect(specOf(0)).toBe(specOf(1));
    // ...and it is the mean of the two ends, so neither end is favoured.
    expect(specOf(0)).toBeCloseTo((at(0) + at(1)) / 2, 12);
  });

  /**
   * The ring is CONTINUOUS at the wrap now, not merely gentler there — which
   * is the difference between a fixed seam and a seam redrawn as a streak.
   *
   * Proved by refinement rather than by a slope threshold: sample the wrap
   * twice as finely and a true discontinuity keeps its full height, while a
   * continuous function's sampled step halves. That distinction is a property
   * of the blend alone, so it holds for any spectrum — unlike "is the arc
   * shallower than the rest of the ring", which depends entirely on how steep
   * the test's synthetic spectrum happens to be and would let a tuned-to-pass
   * input stand in for evidence. Whether the arc is WIDE enough to look right
   * is a judgement about rendered frames and is settled there, not here.
   */
  it("closes the seam continuously, not as a steeper ramp", () => {
    const stepAcrossWrap = (f: (x: number) => number, n: number) => Math.abs(f(1 - 1 / n) - f(0));
    const fine = stepAcrossWrap(specOf, 8192);
    expect(stepAcrossWrap(specOf, 4096) / fine).toBeGreaterThan(1.9);

    // Non-vacuity: the RAW mapping this replaced does not shrink at all under
    // the same refinement, because it is a genuine jump.
    const rawFine = stepAcrossWrap(at, 8192);
    expect(stepAcrossWrap(at, 4096) / rawFine).toBeCloseTo(1, 6);
    // ...and that jump is two orders of magnitude bigger than what is left.
    expect(rawFine / fine).toBeGreaterThan(100);
  });

  it("spends the arc the comment claims and leaves the rest untouched", () => {
    // Away from the arc the ring is the raw spectrum to within an ulp (mix()
    // at t=1 is a + (b-a), not literally b): the fix is LOCAL, not a global
    // smoothing of the mode's spectrum response.
    for (const x of [0.2, 0.35, 0.5, 0.65, 0.8]) expect(specOf(x)).toBeCloseTo(at(x), 15);
    // The blend is confined to 0.09 either side — 18% of the ring, no more.
    expect(seamK(0.09)).toBe(1);
    expect(seamK(0.91)).toBe(1);
    expect(seamK(0)).toBe(0);
  });

  it("crossfades the hue phase at the same joint, with the origin preserved", () => {
    // cosPalette has period 1, so a Hue spin sawtooth steps the palette by the
    // spin amount at ang = pi — a colour seam along the exact line the geometry
    // seam used to sit on. It is crossfaded by the same weight.
    const spinT = (specX: number, spin: number) =>
      spin * 0.5 + (specX * spin - spin * 0.5) * seamK(specX) - spin * 0.5;
    expect(body).toMatch(/mix\(spin \* 0\.5, specX \* spin, seamK\)/);
    for (const spin of [0.06, 0.2, 0.5, 0.8]) {
      // Continuous through the wrap...
      expect(spinT(0, spin)).toBeCloseTo(spinT(1, spin), 12);
      // ...and away from the arc it is still the plain ang/TAU sweep, so no
      // shipped style's colours rotate.
      for (const x of [0.2, 0.5, 0.8]) expect(spinT(x, spin)).toBeCloseTo((x - 0.5) * spin, 12);
    }
  });
});

/**
 * The club mirror and the spectrum.
 *
 * kaleido() collapses the whole circle onto one wedge, so the angle the preset
 * reads back is NOT in [-pi, pi] any more: it is in [-pi/2, pi/2] at mirror 2
 * and [0, pi/N] at N >= 3. Sending that through the unfolded
 * fract(ang / TAU + 0.5) addressed a slice of the bins and nothing else — 12 of
 * the 96 at the shipped Prism (mirror 4), 6 at the shipped Rose Window
 * (mirror 8), all of them mid. Both styles were blind to bass and treble.
 *
 * The mapping is composed here out of the shader's OWN two pieces — kaleido()'s
 * fold, lifted from the shared prelude, and the preset's specX line — so this
 * measures the shipped arithmetic rather than a restatement of it. Coverage is
 * counted through binAt()'s bin-centre anchor, i.e. the indices the ring can
 * actually address, not an interval in the abstract.
 */
describe("echo-trails club mirror spectrum coverage", () => {
  const body = echoTrails.wgsl;
  const BINS = 96; // featurePipeline's binCount

  const kaleidoSrc = /fn kaleido\(p: vec2f, segments: f32\) -> vec2f \{([\s\S]*?)\n\}/.exec(
    SHADER_SOURCES.header,
  )?.[1];

  it("the shared fold still has the shape this suite composes", () => {
    // Guards the transcription below: if kaleido()'s branch structure or its
    // reconstruction changes, this fails instead of the suite quietly measuring
    // a fold the renderer no longer performs.
    expect(kaleidoSrc, "kaleido() not found in the prelude").toBeTruthy();
    expect(kaleidoSrc).toContain("if (segments < 1.5) { return p; }");
    expect(kaleidoSrc).toContain("if (segments < 2.5) { return vec2f(abs(p.x), p.y); }");
    // The reconstruction is angle-preserving — it re-emits the folded angle at
    // the original radius — so folding the ANGLE is the whole of the fold as
    // far as a spectrum index is concerned, which is what lets this suite work
    // in angles rather than in vectors.
    expect(kaleidoSrc).toContain("return vec2f(cos(a), sin(a)) * length(p);");
    // ...and the preset's own thresholds have to agree with those two, or the
    // wedge it rescales is not the wedge the fold produced.
    expect(body).toContain("let folded = mirrorN >= 1.5;");
    expect(body).toMatch(/let foldLo = select\([^;]*mirrorN >= 2\.5\);/);
    expect(body).toMatch(/let foldSpan = select\([^;]*mirrorN >= 2\.5\);/);
  });

  /**
   * kaleido()'s angle fold. The N >= 3 branch is the prelude's own line, lifted;
   * the mirror-2 branch is vec2f(abs(p.x), p.y) expressed on the angle, which
   * is the one transcription here and is pinned by the text assertion above.
   */
  const foldAngle = (() => {
    const seg = /let seg = ([^;]*);/.exec(kaleidoSrc ?? "")?.[1];
    const fold = /\n\s*a = ([^;]*);/.exec(kaleidoSrc ?? "")?.[1];
    if (!seg || !fold) throw new Error("kaleido()'s fold not found in the prelude");
    return new Function(
      "a",
      "segments",
      `${WGSL_SHIM}
       if (segments < 1.5) { return a; }
       if (segments < 2.5) { return Math.atan2(Math.sin(a), Math.abs(Math.cos(a))); }
       const seg = ${seg};
       return ${fold.replace(/\s+/g, " ")};`,
    ) as (a: number, segments: number) => number;
  })();

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

  const specXof = liftChain(["folded", "foldLo", "foldSpan", "specX"], ["ang", "mirrorN"]) as (
    ang: number,
    mirrorN: number,
  ) => number;
  const foldedOf = liftChain(["folded"], ["mirrorN"]) as unknown as (m: number) => boolean;
  const seamKof = liftChain(["seamK"], ["specX", "folded"]) as (
    specX: number,
    folded: boolean,
  ) => number;

  /** The mapping this replaced, for the before/after contrast. */
  const sliced = (ang: number) => ang / TAU + 0.5 - Math.floor(ang / TAU + 0.5);

  /** binAt()'s bin-centre anchor: which index x actually addresses. */
  const binIndex = (x: number) =>
    Math.min(BINS - 1, Math.max(0, Math.round(Math.min(Math.max(x, 0), 0.999) * BINS - 0.5)));

  /** Every index the ring addresses over one full trip round the screen. */
  const reached = (map: (ang: number, m: number) => number, m: number, steps = 200_000) => {
    const hit = new Set<number>();
    for (let i = 0; i < steps; i++)
      hit.add(binIndex(map(foldAngle(-Math.PI + (TAU * i) / steps, m), m)));
    return hit;
  };

  it("every club-mirror setting now reaches the whole spectrum", () => {
    for (let m = 1; m <= 12; m++) {
      const hit = reached(specXof, m);
      expect(hit.size, `mirror ${m} reaches ${hit.size} of ${BINS} bins`).toBe(BINS);
    }
  });

  it("...and the mapping it replaced reached almost none of it", () => {
    // Non-vacuity, and the defect's actual size. Unfolded is unaffected (96);
    // every folded setting starved, and the harder the fold the worse it got.
    const before = (m: number) => reached((ang) => sliced(ang), m).size;
    expect(before(1)).toBe(96);
    expect(before(2)).toBe(48);
    expect(before(4)).toBe(12); // shipped Prism
    expect(before(8)).toBe(6); // shipped Rose Window
    expect(before(12)).toBe(4);
    // ...and it was a MID slice: the fold pins one edge of the window at the
    // exact centre of the spectrum, so neither end was ever within reach.
    for (const m of [3, 4, 6, 8, 12]) {
      const hit = [...reached((ang) => sliced(ang), m)];
      expect(Math.min(...hit), `mirror ${m} low edge`).toBe(48);
      expect(Math.max(...hit), `mirror ${m} high edge`).toBeLessThan(64);
    }
  });

  /**
   * The risk this change introduces is a seam at the wedge boundaries, so it is
   * measured rather than argued. Proved by refinement, the same way the wrap
   * suite above does it: sample the sweep twice as finely and a continuous
   * function's largest step halves, while a genuine jump keeps its height.
   */
  it("closes every wedge boundary — the fold makes bass meet bass", () => {
    const worstStep = (m: number, n: number) => {
      let worst = 0;
      let prev = specXof(foldAngle(-Math.PI, m), m);
      for (let i = 1; i <= n; i++) {
        const cur = specXof(foldAngle(-Math.PI + (TAU * i) / n, m), m);
        worst = Math.max(worst, Math.abs(cur - prev));
        prev = cur;
      }
      return worst;
    };
    for (const m of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(worstStep(m, 4096) / worstStep(m, 8192), `mirror ${m}`).toBeGreaterThan(1.9);
    }
    // Non-vacuity: the unfolded sweep does NOT halve, because its wrap at
    // ang = pi is a real discontinuity — which is exactly why mirror 1 keeps
    // the crossfade and the folded settings do not need it.
    expect(worstStep(1, 4096) / worstStep(1, 8192)).toBeCloseTo(1, 3);
  });

  it("leaves club mirror 1 on the exact mapping it always had", () => {
    // Bit-equal, not close: six of the eight shipped styles render through
    // this branch and none of them may move.
    expect(foldedOf(1)).toBe(false);
    for (let i = 0; i <= 512; i++) {
      const ang = -Math.PI + (TAU * i) / 512;
      expect(specXof(ang, 1)).toBe(sliced(ang));
    }
    // ...and the crossfade there is still the live smoothstep.
    expect(seamKof(0, false)).toBe(0);
    expect(seamKof(0.045, false)).toBeCloseTo(0.5, 12);
    expect(seamKof(0.5, false)).toBe(1);
  });

  it("switches the wrap crossfade off wherever the fold makes it wrong", () => {
    for (const m of [2, 4, 8, 12]) expect(foldedOf(m)).toBe(true);
    // 1 everywhere on a folded ring — no blend, the raw sweep.
    for (const x of [0, 0.02, 0.09, 0.5, 0.95, 1]) expect(seamKof(x, true)).toBe(1);

    // That is not a free choice. Left live under the full-range mapping the
    // crossfade would reach the ends of the spectrum for the first time and
    // replace each wedge's bass end with the bass/treble MEAN — throwing away
    // most of the dynamics the fold's rescale exists to restore, over 18% of
    // every wedge. A bass-heavy spectrum, i.e. the ordinary case:
    const bins = Array.from({ length: BINS }, (_, i) => Math.exp(-i / 9) * 0.95 + 0.02);
    const at = (x: number) => bins[binIndex(x)];
    const spec = liftChain(["spec"], ["specX", "seamK", "binAt"]) as unknown as (
      specX: number,
      seamK: number,
      binAt: (x: number) => number,
    ) => number;
    expect(spec(0, seamKof(0, true), at)).toBeCloseTo(at(0), 12);
    expect(spec(0, seamKof(0, false), at)).toBeLessThan(at(0) * 0.55);
    // Note this is NOT a behaviour change at mirror >= 2: under the old sliced
    // window min(specX, 1 - specX) never fell below 0.25, so seamK was already
    // pinned at 1 there and the crossfade could not engage even in principle.
    for (const m of [2, 3, 4, 8, 12]) {
      for (const x of reached((ang) => sliced(ang), m, 20_000)) {
        expect(seamKof((x + 0.5) / BINS, false), `mirror ${m} bin ${x}`).toBe(1);
      }
    }
  });
});
