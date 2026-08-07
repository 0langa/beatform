import { describe, expect, it } from "vitest";
import { echoTrails } from "./echoTrails";
import { allParams, defaultParams, groupParams, presetMasters } from "../types";
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

/**
 * Depth wave (Track B batch 3): source shapes, vortex pivot, warp fields.
 *
 * The wave's contract is default neutrality — at factory defaults the WGSL
 * must reproduce the pre-wave picture bit-for-bit. Device identity is the GPU
 * pixel matrix's half (echo-trails/@defaults and the eight legacy style
 * hashes must NOT move); what a Node test can reach is the arithmetic: every
 * new branch is unreachable at the defaults, and every expression the default
 * path flows through is either untouched or an exact IEEE identity. These
 * suites lift the shipped expressions out of the WGSL (the file's house
 * pattern) so an edit that weakens a claim fails instead of agreeing with it.
 */
describe("echo-trails depth wave: default neutrality", () => {
  const body = echoTrails.wgsl;
  const specs = new Map(allParams(echoTrails).map((p) => [p.key, p]));

  it("every new axis defaults to the legacy path, and no legacy style opts in", () => {
    expect(specs.get("source")!.default).toBe(0);
    expect(specs.get("warp")!.default).toBe(0);
    expect(specs.get("centerX")!.default).toBe(0);
    expect(specs.get("centerY")!.default).toBe(0);
    // The legacy deck must keep rendering through pre-wave code paths: with
    // the branch identities below, that is guaranteed iff no legacy style
    // writes a new key. This is the Node half of "existing device hashes
    // must not move".
    for (const id of [
      "tunnel",
      "roseWindow",
      "vortex",
      "supernova",
      "glacier",
      "magnetar",
      "smoke",
      "prism",
    ]) {
      const style = (echoTrails.styles ?? []).find((s) => s.id === id);
      expect(style, `legacy style ${id} is gone`).toBeDefined();
      for (const key of ["source", "warp", "centerX", "centerY"]) {
        expect(key in style!.values, `${id} writes new key ${key}`).toBe(false);
      }
    }
  });

  it("the pivot algebra is an exact identity at the 0,0 default", () => {
    // Text pins: the four lines the identity argument reads.
    expect(body).toContain("let pivot = vec2f(P_centerX() * u.aspect, P_centerY());");
    expect(body).toContain("let cq = (c - pivot) / zoom;");
    expect(body).toContain("var w = rot2(swirl) * cq;");
    expect(body).toContain(
      "let puv = vec2f((w.x + pivot.x) / u.aspect + 0.5, w.y + pivot.y + 0.5);",
    );
    // The arithmetic: at the default the pivot components are 0 * aspect = +0
    // and +0, so per component cq is (x - 0) / zoom and puv is
    // (x + 0) / aspect + 0.5 against the pre-wave x / aspect + 0.5. Subtracting
    // +0 is a bit-level identity for EVERY x (including -0); adding +0 can only
    // flip a -0 to +0, and the very next + 0.5 lands both signs of zero on the
    // same 0.5 — value-identical everywhere. Object.is distinguishes -0, so
    // these assertions prove the bit/value claims, not mere closeness; the
    // identities are width-independent (exact in f64 here, exact in f32 on
    // the GPU — aurora.test.ts's argument).
    const px = 0 * (16 / 9); // P_centerX() * u.aspect at the default
    expect(Object.is(px, 0)).toBe(true);
    for (const x of [0, -0, 1e-38, -1e-38, 0.37, -0.37, 0.5, -0.5, 1.0625e-7]) {
      expect(Object.is(x - px, x), `x - 0 must be x for ${x}`).toBe(true);
      for (const aspect of [1, 16 / 9, 21 / 9]) {
        expect(
          Object.is((x + px) / aspect + 0.5, x / aspect + 0.5),
          `puv identity at x=${x} aspect=${aspect}`,
        ).toBe(true);
      }
    }
  });

  it("warp field 0 is the shipped swirl, assigned before a branch that only rewrites w", () => {
    const iDefault = body.indexOf("var w = rot2(swirl) * cq;");
    const iBranch = body.indexOf("if (P_warp() > 0.5) {");
    const iPuv = body.indexOf("let puv =");
    expect(iDefault).toBeGreaterThan(-1);
    expect(iBranch).toBeGreaterThan(iDefault);
    expect(iPuv).toBeGreaterThan(iBranch);
    const branch = body.slice(iBranch, iPuv);
    expect(branch).toContain("w = vec2f(cq.x + cq.y * swirl * 2.0, cq.y);");
    expect(branch).toContain("w = rot2(swirl * 1.5 * cos(pr * 14.0)) * cq;");
    // Every bare assignment inside the branch writes w and nothing else, so
    // an off-default field can never leak into zoom/decay/puv structure.
    const bare = branch
      .split("\n")
      .filter((l) => /^\s*[a-zA-Z_]\w*(\.\w+)?\s*=[^=]/.test(l) && !/^\s*let\s/.test(l));
    expect(bare.length).toBe(2);
    for (const l of bare) expect(l).toMatch(/^\s*w\s*=/);
  });

  it("source 0 selects the ring for every cover state; only cover-with-art leaves it", () => {
    const src = /let useRing = ([^;]*);/.exec(body)?.[1];
    expect(src, "useRing expression not found in the WGSL").toBeTruthy();
    // Named ringSelected here only because a JS binding called useRing trips
    // the react-hooks lint rule; the WGSL name it lifts is useRing.
    const ringSelected = new Function("srcKind", "hasCover", `return ${src};`) as (
      k: number,
      has: () => boolean,
    ) => boolean;
    for (const has of [true, false]) expect(ringSelected(0, () => has)).toBe(true);
    expect(ringSelected(4, () => false)).toBe(true); // no art -> ring fallback, never black
    expect(ringSelected(4, () => true)).toBe(false);
    for (const k of [1, 2, 3]) expect(ringSelected(k, () => true)).toBe(false);
  });

  it("the useRing branch is the pre-wave ring block, expression for expression", () => {
    const start = body.indexOf("if (useRing) {");
    const end = body.indexOf("} else if (srcKind < 1.5) {");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = body.slice(start, end);
    for (const line of [
      "var shape = 1.0;",
      "if (P_sides() > 0.5) {",
      "let beatP = max(u.driveBeat, gridPulse(7.0));",
      "let lobe = cos(P_sides() * ang);",
      "let star = softLimit(0.11 + P_beatStar() * beatP * u.pulse * 0.5, 0.9);",
      "shape = 1.0 + star * lobe;",
      "let ringR = softLimit((P_radius() + spec * P_react() * (0.6 + u.bass * 0.8)) * shape, frameCircle());",
      "band = smoothstep(P_thick() + 0.02, 0.0, abs(rad - ringR));",
    ]) {
      expect(block, `pre-wave ring expression missing: ${line}`).toContain(line);
    }
    // ...and it never touches level, so the injection's (0.5 + level) is
    // (0.5 + spec) BY VALUE on the default path — same number, same bits.
    expect(block).not.toMatch(/\blevel\s*=/);
    expect(body).toContain("var level = spec;");
    expect(body).toContain("col += ringHot * band * (0.5 + level) * P_inject() * deposit;");
  });
});

/**
 * The cover source's stability law. An accumulator multiplies any steady
 * injection by 1 / (1 - loopGain) — injecting the raw image would settle the
 * whole disc ~10x hot and wash the frame white (the failure the preset's own
 * comments document for tonemap and the peak crown). The (1 - loopGain)
 * pre-scale is the unique factor whose fixed point is the art at its own
 * brightness, and deposit makes that fixed point exact at every frame rate:
 * (1 - L) * (1 - L^f) / (1 - L) is 1 - L^f, so S = art * vg for every f.
 */
describe("echo-trails cover source: bounded, frame-rate-exact fixed point", () => {
  const body = echoTrails.wgsl;

  it("the injection is pre-scaled by (1 - loopGain) and carries deposit", () => {
    const line = body.split("\n").find((l) => l.includes("col += coverSample"));
    expect(line, "cover injection line not found").toBeTruthy();
    expect(line).toContain("* (1.0 - loopGain)");
    expect(line).toContain("* deposit");
  });

  it("settles at art x vignette at every frame rate — and raw injection would not", () => {
    // The shader's OWN deposit expression, lifted exactly as the frame-rate
    // suite above lifts it.
    const src = /let deposit = (.*);/.exec(body)?.[1];
    expect(src, "deposit expression not found in the WGSL").toBeTruthy();
    const deposit = new Function(
      "loopGain",
      "fpsComp",
      `const pow = Math.pow, min = Math.min;
       const select = (f, t, c) => (c ? t : f);
       const authored = fpsComp === 1.0;
       return ${src};`,
    ) as (loopGain: number, fpsComp: number) => number;

    /** One disc pixel of the cover loop:
     *  col = (col*decay^f*vgFade + art*(1-L)*deposit)*vg, L = min(decay*vg, .999). */
    const settle = (art: number, decay: number, vg: number, f: number, scaled: boolean) => {
      const L = Math.min(decay * vg, 0.999);
      const k = scaled ? 1 - L : 1;
      const D = deposit(L, f);
      const fade = f === 1 ? 1 : Math.pow(vg, f - 1);
      let col = 0;
      for (let n = 0; n < Math.round(6000 / f); n++) {
        col = (col * Math.pow(decay, f) * fade + art * k * D) * vg;
      }
      return col;
    };

    const art = 0.73;
    for (const [decay, vig] of [
      [0.94, 0.4], // the Droste style's pair
      [0.92, 0.3], // the defaults
      [0.98, 0.5], // the longest shipped trail
    ]) {
      const vg = 1 - 0.25 * 0.25 * vig; // vignette() a quarter of the way out
      for (const f of [1, 2, 2.5, 1.25, 0.5, 60 / 144]) {
        expect(
          Math.abs(settle(art, decay, vg, f, true) - art * vg),
          `fixed point off at decay ${decay} vignette ${vig} fpsComp ${f}`,
        ).toBeLessThan(1e-6);
      }
      // Non-vacuity: the raw art settles 1/(1-L) hotter — the white-out the
      // pre-scale exists to prevent.
      expect(settle(art, decay, vg, 1, false) / (art * vg)).toBeGreaterThan(5);
    }
  });
});

/**
 * The waveform loop and the wrap. waveAt(0) and waveAt(1) are unrelated
 * samples, so the loop has exactly the seam the spectrum ring had — and it
 * borrows exactly the same fix, through the same seamK. Same lift-the-source
 * approach as the spectrum suite above.
 */
describe("echo-trails waveform loop: the wrap closes through the same crossfade", () => {
  const body = echoTrails.wgsl;

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
  const wvLifted = lift("wv", ["specX", "seamK", "waveAt"]) as (
    specX: number,
    seamK: number,
    waveAt: (x: number) => number,
  ) => number;

  /** An asymmetric trace: the two ends far apart — the worst wrap case. */
  const wave = (x: number) => Math.sin(x * 11.3) * 0.7 + (x - 0.5) * 0.8;
  const wv = (x: number) => wvLifted(x, seamKof(x, false), wave);

  it("closes the loop: both ends meet at one value, the mean of the two", () => {
    expect(wv(0)).toBe(wv(1));
    expect(wv(0)).toBeCloseTo((wave(0) + wave(1)) / 2, 12);
  });

  it("away from the arc the loop is the raw trace — the fix is local", () => {
    for (const x of [0.2, 0.35, 0.5, 0.65, 0.8]) expect(wv(x)).toBeCloseTo(wave(x), 15);
  });

  it("closes continuously, not as a steeper ramp (refinement, as the spectrum suite)", () => {
    const stepAcrossWrap = (f: (x: number) => number, n: number) => Math.abs(f(1 - 1 / n) - f(0));
    const fine = stepAcrossWrap(wv, 8192);
    expect(stepAcrossWrap(wv, 4096) / fine).toBeGreaterThan(1.9);
    // Non-vacuity: the raw trace's genuine jump dwarfs the residue the blend
    // leaves. (The trace is smooth in x, so its sampled step does not hold
    // its height to six digits the way the spectrum suite's piecewise-flat
    // bins do — the load-bearing contrast is jump vs residue, two orders.)
    expect(stepAcrossWrap(wave, 8192) / fine).toBeGreaterThan(100);
  });
});

/**
 * The star source's outline can never collapse: the spike depth soft-limits
 * against 0.9 exactly as the polygon's lobes do, so the deepest valley leaves
 * a positive radius even at full Beat bloom under the Pulse master's 200%.
 */
describe("echo-trails star source: the outline never collapses", () => {
  const body = echoTrails.wgsl;

  it("the prelude's softLimit still has the transcribed shape", () => {
    // Guards the JS transcription below, the kaleido suite's approach to
    // shared helpers.
    expect(SHADER_SOURCES.header).toContain("let knee = lim * 0.72;");
    expect(SHADER_SOURCES.header).toContain(
      "return knee + (lim - knee) * tanh((x - knee) / (lim - knee));",
    );
  });

  const softLimit = (x: number, lim: number) => {
    const knee = lim * 0.72;
    return x <= knee ? x : knee + (lim - knee) * Math.tanh((x - knee) / (lim - knee));
  };

  it("spike stays under 0.9 and the valley radius stays positive at Pulse 200%", () => {
    const spikeSrc = /let spike = ([^;]*);/.exec(body)?.[1];
    const shapeSrc = /let starShape = ([^;]*);/.exec(body)?.[1];
    expect(spikeSrc, "spike expression not found").toBeTruthy();
    expect(shapeSrc, "starShape expression not found").toBeTruthy();
    const spikeOf = new Function(
      "P_beatStar",
      "beatP",
      "u",
      "softLimit",
      `return ${spikeSrc};`,
    ) as (
      beatStar: () => number,
      beatP: number,
      u: { pulse: number },
      sl: typeof softLimit,
    ) => number;
    const shapeOf = new Function("spike", "sect", `return ${shapeSrc};`) as (
      spike: number,
      sect: number,
    ) => number;
    for (const beatStar of [0, 0.5, 1]) {
      for (const beatP of [0, 0.5, 1]) {
        for (const pulse of [0, 1, 2]) {
          const spike = spikeOf(() => beatStar, beatP, { pulse }, softLimit);
          expect(spike).toBeLessThan(0.9);
          for (const sect of [0, 0.25, 0.5, 0.75, 1]) {
            expect(shapeOf(spike, sect), `negative star radius at sect ${sect}`).toBeGreaterThan(
              0.1 - 1e-9,
            );
          }
        }
      }
    }
    // Non-vacuity: the points genuinely bloom on the beat...
    const calm = spikeOf(() => 1, 0, { pulse: 1 }, softLimit);
    const hit = spikeOf(() => 1, 1, { pulse: 1 }, softLimit);
    expect(hit).toBeGreaterThan(calm);
    // ...and a point outreaches a valley by construction.
    expect(shapeOf(calm, 1)).toBeGreaterThan(shapeOf(calm, 0));
  });

  it("Round falls back to a five-point star (a 0-point star is nothing)", () => {
    expect(body).toContain("let n = select(P_sides(), 5.0, P_sides() < 0.5);");
  });
});

/**
 * The bars source: quantization stays inside the spectrum, and the fill obeys
 * the accumulator budget (the tip silhouette is the bright part; the body is
 * deliberately dim so the zoom's self-feeding cannot run the wedges hot).
 */
describe("echo-trails bars source: quantization and budget", () => {
  const body = echoTrails.wgsl;

  it("48 cells sample bin centres, pinned at the top edge like bassCircle's", () => {
    const src = /let cell = ([^;]*);/.exec(body)?.[1];
    expect(src, "cell expression not found").toBeTruthy();
    const cellOf = new Function(
      "specX",
      `const floor = Math.floor, min = Math.min; return ${src};`,
    ) as (x: number) => number;
    // Every cell centre lands strictly inside [0, 1) — binAt addresses real
    // bins at every angle, folded wedges' exact specX = 1.0 included.
    for (let i = 0; i <= 4096; i++) {
      const c = cellOf(i / 4096);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(1);
    }
    expect(cellOf(1)).toBe(cellOf(1 - 1e-9)); // the top edge joins the last cell
    expect(cellOf(0)).toBeCloseTo(0.5 / 48, 15);
    // Non-vacuity: neighbouring cells address different centres.
    expect(cellOf(0.5 / 48)).not.toBe(cellOf(1.5 / 48));
  });

  it("the notch closes at every cell edge and opens mid-cell", () => {
    const src = /let gapM = ([^;]*);/.exec(body)?.[1];
    expect(src, "gapM expression not found").toBeTruthy();
    const gapOf = new Function(
      "fc",
      `${WGSL_SHIM}
       return ${src!.replace(/\s+/g, " ")};`,
    ) as (fc: number) => number;
    expect(gapOf(0)).toBe(0);
    expect(gapOf(1)).toBe(0);
    expect(gapOf(0.5)).toBe(1);
  });

  it("the tip band rides Ring thickness; the fill is dimmed for the budget", () => {
    expect(body).toContain("let tipBand = smoothstep(P_thick() + 0.02, 0.0, abs(rad - tip));");
    expect(body).toContain("band = gapM * (tipBand + fill * (0.14 + 0.3 * along * along));");
  });
});

describe("echo-trails depth wave: param + deck conventions", () => {
  const specs = new Map(allParams(echoTrails).map((p) => [p.key, p]));

  it("enums are mod-off with every option declared; centre sliders stay smooth", () => {
    const source = specs.get("source")!;
    expect(source.control).toBe("enum");
    expect(source.mod).toBe("off");
    expect(source.control === "enum" && source.options.map((o) => o.value)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    const warp = specs.get("warp")!;
    expect(warp.control).toBe("enum");
    expect(warp.mod).toBe("off");
    expect(warp.control === "enum" && warp.options.map((o) => o.value)).toEqual([0, 1, 2]);
    for (const key of ["centerX", "centerY"]) {
      expect(specs.get(key)!.mod, `${key} must stay a smooth mod target`).toBeUndefined();
    }
  });

  it("decay carries the log taper over 0.6..0.99 — display-only, value space untouched", () => {
    const decay = specs.get("decay")!;
    expect(decay.taper).toBe("log");
    expect(decay.min).toBe(0.6); // log taper requires min > 0, and the range is unchanged
    expect(decay.max).toBe(0.99);
    expect(decay.default).toBe(0.92);
  });

  it("every knob ships a hint", () => {
    for (const spec of allParams(echoTrails)) {
      expect(spec.hint, `${spec.key} has no hint`).toBeTruthy();
    }
  });

  it("the curated tier keeps the five-lens house, Source shape included", () => {
    const mainGroups = groupParams(echoTrails, echoTrails.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(mainGroups, `curated tier misses ${lens}`).toContain(lens);
    }
  });

  it("the masters footprint is unchanged (no accidental Detail flip)", () => {
    expect(presetMasters(echoTrails)).toEqual({
      rotation: true,
      pulse: true,
      detail: false,
      spectrumSmooth: true,
    });
  });
});

describe("echo-trails IDs are forever + the deck exercises the new axes", () => {
  it("the preset id and every pre-wave param key are unchanged", () => {
    expect(echoTrails.id).toBe("echo-trails");
    const keys = new Set(allParams(echoTrails).map((p) => p.key));
    for (const key of [
      "hue",
      "decay",
      "zoom",
      "swirl",
      "radius",
      "react",
      "inject",
      "beatZoom",
      "flowSwirl",
      "thick",
      "hueSpin",
      "hueDrift",
      "kickFlash",
      "vignette",
      "mirror",
      "echoHue",
      "sides",
      "beatStar",
    ]) {
      expect(keys.has(key), `pre-wave key "${key}" is gone`).toBe(true);
    }
  });

  it("the legacy deck keeps its ids; the six new identities join it", () => {
    const ids = (echoTrails.styles ?? []).map((s) => s.id);
    for (const id of [
      "tunnel",
      "roseWindow",
      "vortex",
      "supernova",
      "glacier",
      "magnetar",
      "smoke",
      "prism",
    ]) {
      expect(ids, `legacy style "${id}" is gone`).toContain(id);
    }
    for (const id of ["starfall", "pinwheel", "seismic", "droste", "riptide", "maelstrom"]) {
      expect(ids, `new style "${id}" missing`).toContain(id);
    }
    // First chip is still the defaults (the strip opens on an active chip).
    expect(echoTrails.styles?.[0]?.values).toEqual({});
  });

  it("every style writes only real params, inside their declared ranges", () => {
    const specs = new Map(allParams(echoTrails).map((p) => [p.key, p]));
    for (const style of echoTrails.styles ?? []) {
      for (const [key, v] of Object.entries(style.values)) {
        const spec = specs.get(key);
        expect(spec, `${style.id} writes unknown param "${key}"`).toBeDefined();
        expect(v, `${style.id}.${key} below min`).toBeGreaterThanOrEqual(spec!.min);
        expect(v, `${style.id}.${key} above max`).toBeLessThanOrEqual(spec!.max);
      }
    }
  });

  it("the deck exercises every option of both enums, plus the off-axis pivot", () => {
    const resolved = (echoTrails.styles ?? []).map(
      (s) => ({ ...defaultParams(echoTrails), ...s.values }) as Record<string, number>,
    );
    for (const v of [0, 1, 2, 3, 4]) {
      expect(
        resolved.some((r) => r.source === v),
        `no style exercises source ${v}`,
      ).toBe(true);
    }
    for (const v of [0, 1, 2]) {
      expect(
        resolved.some((r) => r.warp === v),
        `no style exercises warp ${v}`,
      ).toBe(true);
    }
    expect(resolved.some((r) => r.centerX !== 0 && r.centerY !== 0)).toBe(true);
  });
});
