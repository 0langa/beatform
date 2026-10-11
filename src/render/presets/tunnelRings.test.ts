import { describe, expect, it } from "vitest";
import { tunnelRings } from "./tunnelRings";
import { allParams, isModTarget } from "../types";
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

  it("slipstream is the one factory look on the fade path; every other style stays off it", () => {
    // Pre-wave this asserted NO style set colorFade. The v2.76 deck closes
    // the B0 finding ("the newest param, untouched by the deck") with
    // exactly one look built on it — everything else still renders the
    // guarded default path bit-identically.
    for (const style of tunnelRings.styles ?? []) {
      if (style.id === "slipstream") {
        expect(style.values.colorFade).toBe(1);
      } else {
        expect(style.values, `style ${style.id}`).not.toHaveProperty("colorFade");
      }
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

/**
 * The v2.76 depth wave: wall materials, cover wall, beat junctions, the
 * centerGlow promotion and the six-style deck extension.
 *
 * Neutrality doctrine (same as the wave's other modes): at factory defaults
 * the frame must be bit-identical to pre-wave. Where a Node test can reach,
 * that is proven on the shader's OWN text and lifted expressions — the
 * default path keeps its exact initializers, every new block is guarded off
 * at its 0 default, and the guards' locality is proven on the lifted math
 * rather than restated in prose.
 */
describe("tunnel depth wave (v2.76)", () => {
  const body = tunnelRings.wgsl;
  const specs = new Map(allParams(tunnelRings).map((p) => [p.key, p]));

  /** Pre-wave key -> default, frozen as data: a retune of ANY shipped knob is
   * a pixel change on every saved document, and must be its own deliberate
   * commit — never a depth-wave side effect. */
  const PRE_WAVE_DEFAULTS: Record<string, number> = {
    hue: 15,
    hueSpread: 70,
    colorFade: 0,
    // 0.15 through 2.112; retuned to 0.45 by the 3.0 travel rework (its own
    // deliberate commit, with the whole tunnel re-blessed): with the loudness
    // and beat shoves gone from the camera POSITION, the cruise is the
    // motion, and 0.15 idled. Saved documents keep their stored value.
    speed: 0.45,
    rings: 7,
    spokes: 12,
    beatPulse: 0.7,
    curve: 0,
    cruiseFloor: 0.35,
    curveScale: 1,
    cruiseEnergy: 0.9,
    beatSpeed: 0.08,
    tileLevel: 0.1,
    tileSpectrum: 0.25,
    pulseWidth: 9,
    tileSat: 0.75,
    checker: 0.06,
    groutWidth: 0.055,
    groutLevel: 0.1,
    fogNear: 0.012,
    fogFar: 0.7,
    centerGlow: 0.2,
    vignette: 0.3,
    mirror: 1,
    twist: 0.8,
    roundness: 0.6,
    surfaceWarp: 1.2,
    beatBright: 0.15,
  };

  it("every pre-wave param keeps its key and default", () => {
    for (const [key, def] of Object.entries(PRE_WAVE_DEFAULTS)) {
      expect(specs.get(key)?.default, key).toBe(def);
    }
  });

  it("adds exactly the three wave params (the HD-06 colour pair, and the 3.0 travel trio) on top of the pre-wave set", () => {
    // saturation/lightness are the strip-wide pair every mode carries since
    // 2.111.0 — not part of the wave, but part of the census. sway/lamps/dust
    // are the 3.0 travel rework's three opt-in cues.
    expect(
      allParams(tunnelRings)
        .map((p) => p.key)
        .sort(),
    ).toEqual(
      [
        ...Object.keys(PRE_WAVE_DEFAULTS),
        "material",
        "coverWall",
        "junction",
        "saturation",
        "lightness",
        "sway",
        "lamps",
        "dust",
        "roll",
      ].sort(),
    );
  });

  it("the legacy nine styles head the deck, untouched by any wave param", () => {
    const styles = tunnelRings.styles ?? [];
    expect(styles.slice(0, 9).map((s) => s.id)).toEqual([
      "ember",
      "wireframe",
      "corkscrew",
      "cathedral",
      "hyper",
      "kaleidoTube",
      "iceCave",
      "waterslide",
      "foundry",
    ]);
    for (const style of styles.slice(0, 9)) {
      for (const key of ["material", "coverWall", "junction"]) {
        expect(style.values, `${style.id} sets ${key}`).not.toHaveProperty(key);
      }
    }
  });

  it("material is a mode-choice enum: mod off, tiles default, values 0..3", () => {
    const spec = tunnelRings.params.find((p) => p.key === "material");
    expect(spec).toMatchObject({ group: "shape", control: "enum", mod: "off", default: 0 });
    expect(spec?.control === "enum" ? spec.options.map((o) => o.value) : []).toEqual([0, 1, 2, 3]);
  });

  it("coverWall and junction are opt-in smooth mod targets in their lenses", () => {
    for (const key of ["coverWall", "junction"] as const) {
      const spec = specs.get(key);
      expect(spec, key).toMatchObject({ min: 0, max: 1, step: 0.01, default: 0 });
      // Smooth (absent mod): a route may breathe the mosaic or the stations.
      expect(spec?.mod, key).toBeUndefined();
      expect(spec !== undefined && isModTarget(spec), key).toBe(true);
    }
    expect(specs.get("coverWall")?.group).toBe("image");
    expect(specs.get("junction")?.group).toBe("reaction");
  });

  it("centerGlow is promoted to the curated tier with an unchanged spec", () => {
    const spec = tunnelRings.params.find((p) => p.key === "centerGlow");
    expect(spec).toMatchObject({
      label: "Center glow",
      group: "glow",
      min: 0,
      max: 1,
      step: 0.02,
      default: 0.2,
    });
    expect(tunnelRings.advanced?.some((p) => p.key === "centerGlow")).toBe(false);
  });

  it("the curated tier covers every lens", () => {
    const groups = new Set(tunnelRings.params.map((p) => p.group));
    for (const lens of ["shape", "color", "motion", "reaction", "glow", "image"]) {
      expect(groups, lens).toContain(lens);
    }
  });

  // ---- Default-path neutrality, on the shader's own text -------------------

  it("keeps the tile wall as the untaken-branch default path", () => {
    // The shipped tile initializers, verbatim — now vars so materials can
    // rewrite them WITHOUT touching the default expressions' text.
    expect(body).toContain("var lit = P_tileLevel() * (0.55 + ringParity * P_checker() * ringVis)");
    expect(body).toContain("var seam = max(ringLine * ringVis, fluteLine);");
    expect(body).toContain("var seamLevel = P_groutLevel();");
    // Materials only run above 0.5 — Tiles (0) takes no branch at all.
    expect(body).toContain("let wallMat = P_material();");
    expect(body).toContain("if (wallMat > 2.5) {");
    // The seam composite reads the vars in the original arithmetic shape.
    expect(body).toContain("col += pal * seam * seamLevel * (0.6 + v * 1.6);");
    expect(body).toContain("col += vec3f(1.0, 0.98, 0.94) * seam * pk * pk * seamLevel * 1.4;");
  });

  it("guards cover wall and junctions off at their 0 defaults", () => {
    expect(body).toContain("let cwall = P_coverWall();");
    expect(body).toContain("if (cwall > 1e-4 && hasCover()) {");
    expect(body).toContain("let jAmt = P_junction();");
    expect(body).toContain("if (jAmt > 1e-4) {");
  });

  it("maps the cover onto the shared cell grid through the shared fit machinery", () => {
    // Per-cell mosaic: the cell-local coordinates (flipped so the art reads
    // right way up on the floor), cropped by the SAME fitUV the other cover
    // modes use (no bespoke fitting math to drift)...
    expect(body).toContain(
      "fitUV(vec2f(1.0 - fluteD, 1.0 - ringD), coverAspect(), 1.0, 0.0, 1.0, vec2f(0.0))",
    );
    // ...and lit by the wall's own light + cylinder shade, never flat.
    expect(body).toContain("art * (0.3 + lit * 1.4) * round");
  });

  // ---- Lifted-expression proofs -------------------------------------------

  /** The colorFade suite's lift, rebuilt here with floor added: compile a
   * chain of the shader's own `let <name> = <expr>;` lines into one fn. */
  const WAVE_SHIM = `${WGSL_SHIM}
    const floor = Math.floor, exp = Math.exp;`;
  const lift = (names: string[], args: string[]) => {
    const decls = names.map((n) => {
      const src = new RegExp(`let ${n} = ([^;]*);`).exec(body)?.[1];
      if (src === undefined) throw new Error(`${n} expression not found in the WGSL`);
      return `const ${n} = ${src.replace(/\s+/g, " ")};`;
    });
    return new Function(
      ...args,
      `${WAVE_SHIM}
       ${decls.join("\n       ")}
       return ${names[names.length - 1]};`,
    ) as (...a: number[]) => number;
  };

  it("junction stations are a pure function of travel with an exact mod-128 wrap", () => {
    // Stations are features OF THE TUBE (travel-anchored, like the rings) —
    // no event state — and the hashed index wraps into [0, 128) as exact
    // integers, including the negative travels a parked camera can hold.
    const jWOf = lift(["jF", "jI", "jW"], ["travel"]);
    for (const travel of [0, 3.4, 426.9, 5000.1, -12.7, 12345.6]) {
      const w = jWOf(travel);
      expect(Number.isInteger(w), `travel ${travel}`).toBe(true);
      const raw = Math.floor(travel * 0.3);
      expect(w, `travel ${travel}`).toBe(((raw % 128) + 128) % 128);
    }
  });

  const mouthOf = lift(["dAng", "mouthA", "mouthD", "mouth"], ["aTwist", "jAng", "jD"]);

  it("the mouth is local: 1 dead centre, exactly 0 away from its station", () => {
    // Dead centre of a station: full mouth.
    expect(mouthOf(1.3, 1.3, 0.5)).toBe(1);
    // Opposite wall: exactly 0 (the inverted smoothstep's flat end) — so
    // junction 1 leaves every fragment outside a mouth bit-identical.
    expect(mouthOf(1.3, 1.3 + Math.PI, 0.5)).toBe(0);
    // Between stations in depth: exactly 0 even dead-ahead in angle.
    expect(mouthOf(1.3, 1.3, 0.05)).toBe(0);
    expect(mouthOf(1.3, 1.3, 0.95)).toBe(0);
  });

  it("the mouth's angular distance is continuous across the angle wrap", () => {
    // A station parked just inside +pi: fragments on either side of the wrap
    // must see the same mouth — the triangle fold, not a clamp.
    const jAng = Math.PI - 0.05;
    const eps = 1e-4;
    const before = mouthOf(Math.PI - eps, jAng, 0.5);
    const after = mouthOf(-Math.PI + eps, jAng, 0.5);
    expect(before).toBeGreaterThan(0); // non-vacuous: the mouth spans the wrap
    expect(Math.abs(before - after)).toBeLessThan(1e-2);
  });

  it("hex per-cell seeds wrap exactly — one tone per cell across the angle seam", () => {
    // fract(rawIndex / spokes) differs across the wrap by f32 rounding (the
    // two sides compute different bit patterns for the same physical cell);
    // the integer mod the shader uses instead is EXACT on both sides.
    const ixwOf = lift(["ixw"], ["ix", "spokeN"]);
    for (const spokes of [4, 12, 24]) {
      for (const ix of [-7, -1, 0, 3, 11, 23]) {
        expect(ixwOf(ix, spokes), `ix ${ix} spokes ${spokes}`).toBe(ixwOf(ix + spokes, spokes));
        expect(ixwOf(ix, spokes)).toBeGreaterThanOrEqual(0);
        expect(ixwOf(ix, spokes)).toBeLessThan(spokes);
      }
    }
    // Row index wraps mod 64 — mantissa hygiene for hour-long tracks (the
    // same argument as grain()'s fract(u.time)).
    const iywOf = lift(["iyw"], ["iy"]);
    for (const iy of [-3, 0, 17, 63, 64, 6401]) {
      expect(iywOf(iy), `iy ${iy}`).toBe(((iy % 64) + 64) % 64);
    }
  });

  it("hexEdge is the honeycomb min(d, 1-d): 0.5 at a centre, 0 on every border", () => {
    // Lift the helper's own return expression and run it against the lattice
    // geometry the material builds (pitch (1, sqrt(3)), half-offset rows).
    const src = /fn hexEdge\(p: vec2f\) -> f32 \{\s*let q = abs\(p\);\s*return ([^;]+);/.exec(
      body,
    )?.[1];
    if (!src) throw new Error("hexEdge return expression not found in the WGSL");
    const hexEdge = (px: number, py: number): number =>
      (
        new Function(
          "q",
          `const vec2f = (x, y) => ({ x, y });
           const dot = (a, b) => a.x * b.x + a.y * b.y;
           const max = Math.max;
           return ${src.replace(/\s+/g, " ")};`,
        ) as (q: { x: number; y: number }) => number
      )({ x: Math.abs(px), y: Math.abs(py) });
    expect(hexEdge(0, 0)).toBeCloseTo(0.5, 6);
    // Midpoints toward all six neighbours lie exactly on the border: the row
    // neighbours at (±1, 0) and the diagonal rows at (±0.5, ±sqrt(3)/2).
    expect(hexEdge(0.5, 0)).toBeCloseTo(0, 6);
    expect(hexEdge(0.25, 0.4330127)).toBeCloseTo(0, 6);
    expect(hexEdge(-0.25, 0.4330127)).toBeCloseTo(0, 6);
    // The hex corner pokes past the border midpoints' radius...
    expect(hexEdge(0, 0.5)).toBeGreaterThan(0);
    // ...and beyond a border is the neighbour's territory.
    expect(hexEdge(0.6, 0)).toBeLessThan(0);
  });

  it("the six wave styles land after the legacy deck and exercise every new axis", () => {
    const styles = tunnelRings.styles ?? [];
    const byId = new Map(styles.map((s) => [s.id, s]));
    expect(styles.map((s) => s.id).slice(9)).toEqual([
      "honeycomb",
      "vector",
      "gullet",
      "gallery",
      "interchange",
      "slipstream",
      "metro",
    ]);
    expect(byId.get("honeycomb")?.values.material).toBe(1);
    expect(byId.get("vector")?.values.material).toBe(2);
    expect(byId.get("gullet")?.values.material).toBe(3);
    expect(byId.get("gallery")?.values.coverWall).toBe(1);
    expect(byId.get("interchange")?.values.junction).toBe(1);
    // Every material option is worn by some chip (0 by the defaults chip).
    const spec = tunnelRings.params.find((p) => p.key === "material");
    const used = new Set(styles.map((s) => s.values.material ?? 0));
    for (const opt of spec?.control === "enum" ? spec.options : []) {
      expect(used, `material ${opt.value} has no look`).toContain(opt.value);
    }
  });
});

/**
 * The 3.0 travel rework: continuous flight. Loudness and beats used to be
 * added to the camera's POSITION, so the wall ran backwards when the music
 * dropped and every kick shoved-then-slid. These tests run the prelude's own
 * beatRide() and the shader's off-axis unwrap, lifted from the WGSL, so a
 * regression toward position shoves fails here, not on the owner's screen.
 */
describe("tunnel travel rework (3.0)", () => {
  const body = tunnelRings.wgsl;
  const specs = new Map(allParams(tunnelRings).map((p) => [p.key, p]));

  it("the Detail master thins flutes and rings, passing the authored counts through bit-exactly at 1", () => {
    expect(body).toContain(
      "let spokeCount = select(P_spokes(), mix(4.0, P_spokes(), u.detail), u.detail < 0.999);",
    );
    expect(body).toContain(
      "let ringCount = select(P_rings(), mix(3.0, P_rings(), u.detail), u.detail < 0.999);",
    );
    // Every count read goes through the master — no raw P_spokes()/P_rings()
    // survives outside the two select() lines.
    const raw = body.replace(/let (spokeCount|ringCount) = select\([^\n]*\n/g, "");
    expect(raw).not.toContain("P_spokes()");
    expect(raw).not.toContain("P_rings()");
  });

  it("travel is the blended clock plus the beat ride — never a position offset", () => {
    expect(body).toContain("let cruiseMix = clamp(P_cruiseEnergy() * 0.5, 0.0, 1.0);");
    expect(body).toContain(
      "let cruiseT = mix(u.time, u.travel, cruiseMix) * P_speed() * P_cruiseFloor() * 2.2;",
    );
    expect(body).toContain(
      "let travelT = cruiseT + beatRide() * softLimit(P_beatSpeed() * u.pulse, 0.4);",
    );
    // The old shoves are gone for good.
    expect(body).not.toContain("u.drive * P_cruiseEnergy()");
    expect(body).not.toContain("kickPos");
  });

  /** The prelude's beatRide(), lifted, on a fake uniform block. */
  const beatRide = (() => {
    const src = /fn beatRide\(\) -> f32 \{([\s\S]*?)\n\}/.exec(SHADER_SOURCES.header)?.[1];
    if (!src) throw new Error("beatRide not found in the prelude");
    const js = src
      .replace(/let /g, "const ")
      .replace(
        /if \(u\.bpm < 1\.0\) \{ return u\.driveBeat; \}/,
        "if (u.bpm < 1) return u.driveBeat;",
      );
    return new Function(
      "u",
      `${WGSL_SHIM}
       const exp = Math.exp, floor = Math.floor;
       ${js}`,
    ) as (u: { bpm: number; beatCount: number; driveBeat: number }) => number;
  })();

  it("beatRide climbs exactly one unit per beat, continuous and monotonic across every boundary", () => {
    const ride = (c: number) => beatRide({ bpm: 120, beatCount: c, driveBeat: 0 });
    // Integers at the beat boundaries...
    for (const c of [-1, 0, 1, 2, 17]) expect(ride(c)).toBeCloseTo(c, 6);
    // ...no step at the wrap (the ease is normalised to land exactly at 1)...
    expect(ride(3 - 1e-6)).toBeCloseTo(ride(3), 4);
    // ...monotonic through the whole lead-in and the first few beats...
    let prev = ride(-1);
    for (let c = -1; c < 4; c += 0.01) {
      const v = ride(c);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    // ...and front-loaded: most of a beat's stride is spent in its first fifth.
    expect(ride(0.2)).toBeGreaterThan(0.65);
    expect(ride(0.5)).toBeGreaterThan(0.94);
  });

  it("beatRide falls back to the bounded onset nudge without a grid", () => {
    expect(beatRide({ bpm: 0, beatCount: -1, driveBeat: 0.37 })).toBe(0.37);
  });

  it("the three cues are opt-in: default 0, guarded, in their lenses", () => {
    for (const [key, group] of [
      ["sway", "motion"],
      ["lamps", "glow"],
      ["dust", "backdrop"],
    ] as const) {
      const spec = specs.get(key);
      expect(spec, key).toMatchObject({ min: 0, max: 1, step: 0.01, default: 0, group });
      expect(spec !== undefined && isModTarget(spec), key).toBe(true);
    }
    expect(body).toContain("if (swayAmt > 1e-4) {");
    expect(body).toContain("if (lampAmt > 1e-4) {");
    expect(body).toContain("if (dustAmt > 1e-4) {");
    // Roll is the fourth: a signed slider (not a degree dial), gated by the
    // Rotation master so Motion → Rotation 0 still means a dead-still frame.
    expect(specs.get("roll")).toMatchObject({ min: -1, max: 1, default: 0, group: "motion" });
    expect(specs.get("roll")?.control).toBeUndefined();
    expect(body).toContain("if (abs(rollAmt) > 1e-4) {");
    expect(body).toContain("let ra = u.time * rollAmt * u.spin * 0.35;");
    // The pinhole depth stands untouched outside the drift branch.
    expect(body).toContain("var depth = 1.0 / r;");
  });

  it("the off-axis unwrap is exact: the wall sits at radius 1, and cam 0 is the pinhole depth", () => {
    // |q*z + cam| = 1 solved for z, as the shader writes it.
    const unwrap = (q: [number, number], cam: [number, number]) => {
      const qq = Math.max(q[0] * q[0] + q[1] * q[1], 4e-6);
      const qc = q[0] * cam[0] + q[1] * cam[1];
      const disc = Math.max(qc * qc - qq * (cam[0] * cam[0] + cam[1] * cam[1] - 1), 0);
      const z = (-qc + Math.sqrt(disc)) / qq;
      return { z, w: [q[0] * z + cam[0], q[1] * z + cam[1]] };
    };
    for (const q of [
      [0.3, 0.1],
      [-0.45, 0.2],
      [0.05, -0.6],
    ] as [number, number][]) {
      for (const cam of [
        [0, 0],
        [0.2, -0.1],
        [-0.33, 0.29],
      ] as [number, number][]) {
        const { z, w } = unwrap(q, cam);
        expect(z).toBeGreaterThan(0);
        expect(Math.hypot(w[0], w[1])).toBeCloseTo(1, 9);
      }
      expect(unwrap(q, [0, 0]).z).toBeCloseTo(1 / Math.hypot(q[0], q[1]), 9);
    }
    // The drift amplitude in the shader keeps |cam| under the bore radius.
    expect(body).toContain("* swayAmt * 0.22;");
  });

  it("hue is a rotation of the finished palette, not a phase inside its drift", () => {
    expect(body).toContain("let t = fract(travel * 0.05);");
    expect(body).toContain("pal = hueRotate(pal, P_hue());");
    expect(body).not.toContain("travel * 0.05 + P_hue()");
  });

  /** The prelude's hueRotate, lifted. */
  const hueRotate = (() => {
    const src = /fn hueRotate\(c: vec3f, deg: f32\) -> vec3f \{([\s\S]*?)\n\}/.exec(
      SHADER_SOURCES.header,
    )?.[1];
    if (!src) throw new Error("hueRotate not found in the prelude");
    expect(src).toContain("let k = vec3f(0.57735027);");
    return (c: [number, number, number], deg: number): [number, number, number] => {
      const a = (deg * TAU) / 360;
      const k = 0.57735027;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const cross = [k * c[2] - k * c[1], k * c[0] - k * c[2], k * c[1] - k * c[0]];
      const d = k * (c[0] + c[1] + c[2]);
      return [0, 1, 2].map((i) => c[i] * cs + cross[i] * sn + k * d * (1 - cs)) as [
        number,
        number,
        number,
      ];
    };
  })();

  it("hueRotate walks the wheel: red → green at 120°, blue at 240°, identity at 0 and 360", () => {
    const red: [number, number, number] = [1, 0, 0];
    expect(hueRotate(red, 0)).toEqual(red);
    const g = hueRotate(red, 120);
    expect(g[1]).toBeCloseTo(1, 6);
    expect(g[0]).toBeCloseTo(0, 6);
    expect(g[2]).toBeCloseTo(0, 6);
    const b = hueRotate(red, 240);
    expect(b[2]).toBeCloseTo(1, 6);
    expect(hueRotate(red, 360)[0]).toBeCloseTo(1, 6);
    // Grey is on the axis: untouched at any angle.
    const grey = hueRotate([0.4, 0.4, 0.4], 77);
    for (const ch of grey) expect(ch).toBeCloseTo(0.4, 6);
  });

  it("Metro wears all three cues; Hyperdrive and Waterslide each adopt one", () => {
    const byId = new Map((tunnelRings.styles ?? []).map((s) => [s.id, s]));
    expect(byId.get("metro")?.values).toMatchObject({ sway: 0.5, lamps: 0.85, dust: 0.35 });
    expect(byId.get("hyper")?.values.dust).toBe(0.7);
    expect(byId.get("waterslide")?.values.sway).toBe(0.35);
  });
});
