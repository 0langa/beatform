import { describe, expect, it } from "vitest";
import {
  applyMods,
  applyPostMods,
  createModEvalState,
  LFO_SOURCES,
  MOD_SOURCES,
  postTargetKey,
  reorderRoutes,
  sourceValue,
  validModRoutes,
  type ModRoute,
  type ModSource,
} from "./modMatrix";
import { presets } from "../render/presets";
import { DEFAULT_POST, defaultParams, type ParamValues } from "../render/types";
import type { AudioFeatures } from "../audio/types";

const preset = presets[0];
const spec = preset.params[0]; // first numeric param of the first preset

function features(partial: Partial<AudioFeatures>): AudioFeatures {
  return {
    bins: new Float32Array(96),
    peaks: new Float32Array(96),
    waveform: new Float32Array(512),
    waveformL: new Float32Array(512),
    waveformR: new Float32Array(512),
    rms: 0,
    energy: 0,
    voice: 0,
    drive: 0,
    driveBeat: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    width: 0,
    lufs: -70,
    kick: 0,
    snare: 0,
    hat: 0,
    bpm: 0,
    beatPhase: 0,
    barPhase: 0,
    beat: false,
    beatIntensity: 0,
    time: 0,
    duration: 0,
    ...partial,
  };
}

describe("modulation matrix", () => {
  it("returns base unchanged (same object) with no routes", () => {
    const base = defaultParams(preset);
    expect(applyMods(preset, base, [], features({ kick: 1 }))).toBe(base);
  });

  it("adds amount × range at feature = 1 and clamps to spec max", () => {
    const base = defaultParams(preset);
    const routes = [{ id: "r", source: "kick" as const, param: spec.key, amount: 1 }];
    const out = applyMods(preset, base, routes, features({ kick: 1 }));
    expect(out[spec.key]).toBe(spec.max); // default + full range clamps at max
    // Feature at 0 leaves the param alone
    const idle = applyMods(preset, base, routes, features({ kick: 0 }));
    expect(idle[spec.key]).toBe(base[spec.key]);
  });

  it("negative amounts subtract and clamp at min", () => {
    const base = defaultParams(preset);
    const routes = [{ id: "r", source: "rms" as const, param: spec.key, amount: -1 }];
    const out = applyMods(preset, base, routes, features({ rms: 1 }));
    expect(out[spec.key]).toBe(spec.min);
  });

  it("skips routes to params the preset doesn't have", () => {
    const base = defaultParams(preset);
    const routes = [{ id: "r", source: "kick" as const, param: "noSuchParam", amount: 1 }];
    const out = applyMods(preset, base, routes, features({ kick: 1 }));
    expect(out).toEqual(base);
  });

  it("stacks multiple routes onto one param", () => {
    const base = { ...defaultParams(preset), [spec.key]: spec.min };
    const quarter = 0.25;
    const routes = [
      { id: "a", source: "kick" as const, param: spec.key, amount: quarter },
      { id: "b", source: "bass" as const, param: spec.key, amount: quarter },
    ];
    const out = applyMods(preset, base, routes, features({ kick: 1, bass: 1 }));
    const expected = Math.min(spec.max, spec.min + 0.5 * (spec.max - spec.min));
    expect(out[spec.key]).toBeCloseTo(expected, 5);
  });

  it("validates: clamps amounts, drops unknown sources and empty params", () => {
    const routes = validModRoutes([
      { id: "a", source: "kick", param: "x", amount: 99 },
      { id: "b", source: "nope", param: "x", amount: 0.1 },
      { id: "c", source: "bass", param: "", amount: 0.1 },
      "garbage",
    ]);
    expect(routes).toHaveLength(1);
    expect(routes[0].amount).toBe(1);
  });
});

describe("param mod metadata on the apply path (RP-2 / RP-14)", () => {
  // Real tagged params, so these tests break if the tagging regresses:
  // nebula/kaleido is a segment-count enum (mod:"snap", 0..12 step 1),
  // spectrum-bars/mirror is a pure toggle (mod:"off").
  const nebula = presets.find((p) => p.id === "nebula")!;
  const bars = presets.find((p) => p.id === "spectrum-bars")!;

  it("fixture sanity: the offenders carry the metadata this suite exercises", () => {
    expect(nebula.params.find((p) => p.key === "kaleido")?.mod).toBe("snap");
    expect(bars.params.find((p) => p.key === "mirror")?.mod).toBe("off");
  });

  it("snap: applied modulation lands on whole numbers, not 3.7 segments", () => {
    const base = { ...defaultParams(nebula), kaleido: 2 };
    const routes = [{ id: "r", source: "bass" as const, param: "kaleido", amount: 0.3 }];
    // 2 + 0.55 * 0.3 * 12 = 3.98 -> 4. Unsnapped this was the fractional-enum
    // defect: the shader lerped between fold counts and strobed.
    const out = applyMods(nebula, base, routes, features({ bass: 0.55 }));
    expect(out.kaleido).toBe(4);
    // And every intermediate feature level still yields an integer.
    for (let v = 0; v <= 1; v += 0.07) {
      const stepped = applyMods(nebula, base, routes, features({ bass: v }));
      expect(Number.isInteger(stepped.kaleido), `feature ${v}`).toBe(true);
    }
  });

  it("snap: rounding happens before the clamp, so the top of the range is reachable and held", () => {
    const base = { ...defaultParams(nebula), kaleido: 11 };
    const routes = [{ id: "r", source: "bass" as const, param: "kaleido", amount: 1 }];
    const out = applyMods(nebula, base, routes, features({ bass: 0.9 }));
    expect(out.kaleido).toBe(12); // 11 + 10.8 -> 21.8 -> round -> clamp 12
  });

  it('off: a route to a mod:"off" param is inert — the strobing toggle cannot come back', () => {
    // A document saved before the metadata existed may still carry such a
    // route; it must do nothing rather than strobe, and a route list that is
    // ENTIRELY inert keeps the identity fast path (no per-frame clone).
    const barsBase = defaultParams(bars);
    const routes = [{ id: "r", source: "kick" as const, param: "mirror", amount: 1 }];
    expect(applyMods(bars, barsBase, routes, features({ kick: 1 }))).toBe(barsBase);
    // Mixed lists still apply the live routes and only the live routes.
    const mixed = [
      { id: "a", source: "kick" as const, param: "mirror", amount: 1 },
      { id: "b", source: "kick" as const, param: "hue", amount: 1 },
    ];
    const hueSpec = bars.params.find((p) => p.key === "hue")!;
    const out = applyMods(bars, { ...barsBase, mirror: 0 }, mixed, features({ kick: 1 }));
    expect(out.hue).toBe(hueSpec.max); // live route applied and clamped
    expect(out.mirror).toBe(0); // off route did nothing
  });
});

describe("post-processing modulation targets", () => {
  const post = { ...DEFAULT_POST };

  it("identifies namespaced post targets and ignores preset params", () => {
    expect(postTargetKey("post:chromatic")).toBe("chromatic");
    expect(postTargetKey("post:tonemap")).toBeNull(); // boolean — not modulatable
    expect(postTargetKey("post:nope")).toBeNull();
    expect(postTargetKey(spec.key)).toBeNull();
  });

  it("returns the SAME object when nothing targets post", () => {
    // Identity is load-bearing: both render loops use it to skip a redundant
    // per-frame GPU upload, so an unmodulated project costs nothing.
    const routes = validModRoutes([{ id: "a", source: "bass", param: spec.key, amount: 1 }]);
    expect(applyPostMods(post, routes, features({ bass: 1 }))).toBe(post);
    expect(applyPostMods(post, [], features({ bass: 1 }))).toBe(post);
  });

  it("drives chromatic from a feature and leaves the base untouched", () => {
    const routes = validModRoutes([
      { id: "a", source: "bass", param: "post:chromatic", amount: 1 },
    ]);
    const out = applyPostMods(post, routes, features({ bass: 0.5 }));
    expect(out).not.toBe(post);
    expect(out.chromatic).toBeCloseTo(0.5, 5); // range 0..1, amount 1, feature .5
    expect(post.chromatic).toBe(0); // pure — base object never mutated
  });

  it("clamps to the target's range in both directions", () => {
    const up = applyPostMods(
      { ...post, chromatic: 0.9 },
      validModRoutes([{ id: "a", source: "bass", param: "post:chromatic", amount: 1 }]),
      features({ bass: 1 }),
    );
    expect(up.chromatic).toBe(1);
    const down = applyPostMods(
      { ...post, bloom: 0.1 },
      validModRoutes([{ id: "b", source: "bass", param: "post:bloom", amount: -1 }]),
      features({ bass: 1 }),
    );
    expect(down.bloom).toBe(0);
  });

  it("stacks several post routes in one pass", () => {
    const out = applyPostMods(
      post,
      validModRoutes([
        { id: "a", source: "bass", param: "post:chromatic", amount: 1 },
        { id: "b", source: "treble", param: "post:grain", amount: 1 },
      ]),
      features({ bass: 1, treble: 1 }),
    );
    expect(out.chromatic).toBe(1);
    expect(out.grain).toBe(0.5); // grain range is 0..0.5
  });

  it("survives a project that routes to post while applyMods runs too", () => {
    // applyMods must simply skip post routes — they are not preset params.
    const routes = validModRoutes([
      { id: "a", source: "bass", param: "post:chromatic", amount: 1 },
    ]);
    const params = applyMods(preset, defaultParams(preset), routes, features({ bass: 1 }));
    expect(params).toEqual(defaultParams(preset));
  });
});

describe("applyMods lazy clone", () => {
  const routes = validModRoutes([
    { id: "a", source: "bass", param: "post:chromatic", amount: 1 },
    { id: "b", source: "treble", param: "post:bloom", amount: 1 },
  ]);

  it("returns base BY IDENTITY when every route targets post", () => {
    // A non-empty route list is not the same as a route that changes anything.
    // The eager `{ ...base }` cloned the param object every frame in both
    // render loops for zero effect, and destroyed the identity check callers
    // use to skip a redundant uniform upload.
    const base = defaultParams(preset);
    expect(applyMods(preset, base, routes, features({ bass: 1, treble: 1 }))).toBe(base);
  });

  it("returns base BY IDENTITY when every route names a param this preset lacks", () => {
    const base = defaultParams(preset);
    const foreign = validModRoutes([
      { id: "c", source: "bass", param: "definitelyNotAParamOfThisPreset", amount: 1 },
    ]);
    expect(applyMods(preset, base, foreign, features({ bass: 1 }))).toBe(base);
  });

  it("still clones (never mutates base) as soon as ONE route matches", () => {
    const base = defaultParams(preset);
    const before = { ...base };
    const mixed = validModRoutes([
      { id: "a", source: "bass", param: "post:chromatic", amount: 1 },
      { id: "b", source: "bass", param: spec.key, amount: 1 },
    ]);
    const out = applyMods(preset, base, mixed, features({ bass: 1 }));
    expect(out).not.toBe(base);
    expect(base).toEqual(before);
    expect(out[spec.key]).toBeGreaterThan(before[spec.key]);
  });
});

// ---------------------------------------------------------------------------
// Modulation engine v2 (P-16/P-7): curve, lag, LFO sources, validator.
// ---------------------------------------------------------------------------

/** Base with the target param parked at spec.min so mid-range expectations
 * never collide with the clamp. */
function minBase(): ParamValues {
  return { ...defaultParams(preset), [spec.key]: spec.min };
}
const range = spec.max - spec.min;

describe("mod v2: default neutrality (v2.78.0 bit-identity)", () => {
  it("v1-shaped routes resolve bit-identical with and without an eval state", () => {
    const routes = validModRoutes([
      { id: "a", source: "kick", param: spec.key, amount: 0.37 },
      { id: "b", source: "bass", param: "post:chromatic", amount: 0.4 },
    ]);
    const base = defaultParams(preset);
    const f = features({ kick: 0.83, bass: 0.6, time: 12.5 });
    const state = createModEvalState();
    const plain = applyMods(preset, base, routes, f);
    const stated = applyMods(preset, base, routes, f, undefined, state);
    expect(stated).toEqual(plain);
    expect(applyPostMods(DEFAULT_POST, routes, f, undefined, state)).toEqual(
      applyPostMods(DEFAULT_POST, routes, f),
    );
    // Lag-free routes never touch the state — zero per-frame churn.
    expect(state.routes.size).toBe(0);
  });

  it("identity fast path survives with an eval state passed", () => {
    const base = defaultParams(preset);
    const state = createModEvalState();
    expect(applyMods(preset, base, [], features({ kick: 1 }), undefined, state)).toBe(base);
    const postOnly = validModRoutes([
      { id: "a", source: "bass", param: "post:chromatic", amount: 1 },
    ]);
    expect(applyMods(preset, base, postOnly, features({ bass: 1 }), undefined, state)).toBe(base);
    const paramOnly = validModRoutes([{ id: "b", source: "bass", param: spec.key, amount: 1 }]);
    expect(applyPostMods(DEFAULT_POST, paramOnly, features({ bass: 1 }), undefined, state)).toBe(
      DEFAULT_POST,
    );
  });

  it("a v1 route round-trips with EXACTLY its v1 keys — an old app sees nothing new", () => {
    const [r] = validModRoutes([{ id: "a", source: "kick", param: "x", amount: 0.5 }]);
    expect(Object.keys(r).sort()).toEqual(["amount", "id", "param", "source"]);
  });

  it("every dropdown source reads 0..1 — the curve stage may assume it", () => {
    const maxed = features({
      drive: 1,
      driveBeat: 1,
      rms: 1,
      energy: 1,
      bass: 1,
      mid: 1,
      treble: 1,
      voice: 1,
      kick: 1,
      snare: 1,
      hat: 1,
      width: 1,
      beatPhase: 0.99,
      barPhase: 0.99,
    });
    const zeroed = features({});
    for (const s of MOD_SOURCES) {
      for (const f of [maxed, zeroed]) {
        const v = sourceValue(f, s.id);
        expect(v, s.id).toBeGreaterThanOrEqual(0);
        expect(v, s.id).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("mod v2: per-route curve", () => {
  it("exp squares the source value (0.5 → 0.25 of the range)", () => {
    const routes = validModRoutes([
      { id: "r", source: "bass", param: spec.key, amount: 1, curve: "exp" },
    ]);
    const out = applyMods(preset, minBase(), routes, features({ bass: 0.5 }));
    expect(out[spec.key]).toBeCloseTo(spec.min + 0.25 * range, 10);
  });

  it("smooth applies smoothstep: v²(3−2v), so 0.25 → 0.15625", () => {
    const routes = validModRoutes([
      { id: "r", source: "bass", param: spec.key, amount: 1, curve: "smooth" },
    ]);
    const out = applyMods(preset, minBase(), routes, features({ bass: 0.25 }));
    expect(out[spec.key]).toBeCloseTo(spec.min + 0.15625 * range, 10);
    // Endpoints are fixed points on every curve.
    expect(applyMods(preset, minBase(), routes, features({ bass: 1 }))[spec.key]).toBeCloseTo(
      spec.min + range,
      10,
    );
    expect(applyMods(preset, minBase(), routes, features({ bass: 0 }))[spec.key]).toBe(spec.min);
  });

  it("linear/absent passes the raw value through UNTOUCHED; shaped curves clamp to 0..1 first", () => {
    // A stem envelope is the one source we can feed out-of-range to prove the
    // contract: linear must not clamp (v1 behavior), curves must.
    const stems = { "stem1:kick": 1.5 };
    const linear = validModRoutes([
      { id: "r", source: "stem1:kick", param: spec.key, amount: 0.5 },
    ]);
    expect(applyMods(preset, minBase(), linear, features({}), stems)[spec.key]).toBeCloseTo(
      spec.min + 1.5 * 0.5 * range,
      10,
    );
    const curved = validModRoutes([
      { id: "r", source: "stem1:kick", param: spec.key, amount: 0.5, curve: "exp" },
    ]);
    expect(applyMods(preset, minBase(), curved, features({}), stems)[spec.key]).toBeCloseTo(
      spec.min + 1 * 0.5 * range,
      10,
    );
  });
});

describe("mod v2: per-route lag (attack/release EMA)", () => {
  const lagged = () =>
    validModRoutes([
      { id: "r", source: "kick", param: spec.key, amount: 0.5, attack: 0.2, release: 0.5 },
    ]);
  const valueAt = (out: ParamValues) => (out[spec.key] - spec.min) / (0.5 * range);

  it("follows alpha = 1 − exp(−dt/τ), attack up and release down", () => {
    const state = createModEvalState();
    const routes = lagged();
    // First evaluation snaps to the (curved) target — here 0.
    let out = applyMods(
      preset,
      minBase(),
      routes,
      features({ kick: 0, time: 0 }),
      undefined,
      state,
    );
    expect(out[spec.key]).toBe(spec.min);
    // Rising: dt=0.1, τ=attack=0.2 → s = 1 − e^(−0.5)
    const s1 = 1 - Math.exp(-0.1 / 0.2);
    out = applyMods(preset, minBase(), routes, features({ kick: 1, time: 0.1 }), undefined, state);
    expect(valueAt(out)).toBeCloseTo(s1, 10);
    // Falling: dt=0.2, τ=release=0.5 → s = s1 · e^(−0.4)
    const s2 = s1 * Math.exp(-0.2 / 0.5);
    out = applyMods(preset, minBase(), routes, features({ kick: 0, time: 0.3 }), undefined, state);
    expect(valueAt(out)).toBeCloseTo(s2, 10);
  });

  it("dt = 0 holds (paused preview), dt < 0 and dt > 1 s snap (seek/loop/track change)", () => {
    const state = createModEvalState();
    const routes = lagged();
    applyMods(preset, minBase(), routes, features({ kick: 0, time: 0 }), undefined, state);
    const rising = applyMods(
      preset,
      minBase(),
      routes,
      features({ kick: 1, time: 0.1 }),
      undefined,
      state,
    );
    // Same time again, source moved: the smoothed value holds.
    const held = applyMods(
      preset,
      minBase(),
      routes,
      features({ kick: 0.2, time: 0.1 }),
      undefined,
      state,
    );
    expect(held[spec.key]).toBe(rising[spec.key]);
    // Backwards: snap to the current target.
    const back = applyMods(
      preset,
      minBase(),
      routes,
      features({ kick: 0.3, time: 0.05 }),
      undefined,
      state,
    );
    expect(valueAt(back)).toBeCloseTo(0.3, 10);
    // Forward jump beyond 1 s: snap.
    const jump = applyMods(
      preset,
      minBase(),
      routes,
      features({ kick: 0.8, time: 5 }),
      undefined,
      state,
    );
    expect(valueAt(jump)).toBeCloseTo(0.8, 10);
  });

  it("is frame-rate independent toward a held target (same total time, any step split)", () => {
    const routes = validModRoutes([
      { id: "r", source: "kick", param: spec.key, amount: 0.5, attack: 0.4 },
    ]);
    const run = (steps: number[]) => {
      const state = createModEvalState();
      applyMods(preset, minBase(), routes, features({ kick: 0, time: 0 }), undefined, state);
      let t = 0;
      let out = minBase();
      for (const dt of steps) {
        t += dt;
        out = applyMods(
          preset,
          minBase(),
          routes,
          features({ kick: 1, time: t }),
          undefined,
          state,
        );
      }
      return out[spec.key];
    };
    const fine = run(Array.from({ length: 10 }, () => 0.05));
    const coarse = run([0.25, 0.25]);
    expect(fine).toBeCloseTo(coarse, 10);
  });

  it("without a state (or with attack/release 0) lag routes evaluate instantly", () => {
    const routes = lagged();
    const out = applyMods(preset, minBase(), routes, features({ kick: 1, time: 7 }));
    expect(valueAt(out)).toBeCloseTo(1, 10);
    const zeroLag = validModRoutes([
      { id: "r", source: "kick", param: spec.key, amount: 0.5, attack: 0, release: 0 },
    ]);
    const state = createModEvalState();
    const out2 = applyMods(
      preset,
      minBase(),
      zeroLag,
      features({ kick: 1, time: 7 }),
      undefined,
      state,
    );
    expect(valueAt(out2)).toBeCloseTo(1, 10);
    expect(state.routes.size).toBe(0);
  });

  it("two sequential walks with fresh states resolve identical frames (export-run determinism)", () => {
    const routes = validModRoutes([
      {
        id: "lag",
        source: "kick",
        param: spec.key,
        amount: 0.5,
        curve: "exp",
        attack: 0.05,
        release: 0.3,
      },
      { id: "lfoPost", source: "lfo:sine:1", param: "post:bloom", amount: 0.6, release: 0.2 },
    ]);
    const walk = () => {
      const state = createModEvalState();
      const outs: number[] = [];
      for (let n = 0; n < 90; n++) {
        const f = features({ time: n / 30, kick: (n % 7) / 6, bpm: 128 });
        outs.push(applyMods(preset, minBase(), routes, f, undefined, state)[spec.key]);
        outs.push(applyPostMods(DEFAULT_POST, routes, f, undefined, state).bloom);
      }
      return outs;
    };
    expect(walk()).toEqual(walk()); // exact float equality, not closeTo
  });

  /**
   * E2. The lag memo is CALLER-owned and SHARED between the two apply calls,
   * and the contract that makes that safe is written on applyPostMods: "a route
   * targets EITHER a preset param or a post key, never both, so one shared
   * state advances each route exactly once per frame across the two calls".
   * Nothing tested it.
   *
   * It holds only because both functions decide a route is theirs BEFORE they
   * call routeValue — applyMods' `specs.get` miss and its `spec.mod === "off"`
   * skip, applyPostMods' `postTargetKey` null. What that buys is checked here
   * against the MEMO, not against the value: a second evaluation inside one
   * frame happens to be a no-op today (dt === 0 holds), so a broken partition
   * shows up first as memos allocated for routes nothing drives — one per
   * inert route, in a Map the live loop only clears on a seek. The memo IS the
   * observable, so it is what this asserts.
   */
  describe("the two apply calls partition the routes over one shared ModEvalState", () => {
    const routes = validModRoutes([
      { id: "param", source: "kick", param: spec.key, amount: 0.5, attack: 0.2, release: 0.2 },
      { id: "post", source: "bass", param: "post:bloom", amount: 0.5, attack: 0.2, release: 0.2 },
      // Inert in BOTH: no spec on this preset, and not a post key either.
      { id: "inert", source: "bass", param: "notAKnobHere", amount: 1, attack: 0.2 },
    ]);

    it("each live route lands in exactly one memo; an inert route allocates none", () => {
      const pair = createModEvalState();
      const solo = createModEvalState();
      for (let n = 0; n < 40; n++) {
        const f = features({ time: n / 60, kick: 1, bass: 1 });
        applyMods(preset, minBase(), routes, f, undefined, pair);
        applyPostMods(DEFAULT_POST, routes, f, undefined, pair);
        // Reference: each live route handed only to the call that owns it.
        applyMods(preset, minBase(), [routes[0]], f, undefined, solo);
        applyPostMods(DEFAULT_POST, [routes[1]], f, undefined, solo);
      }
      expect(pair.routes.get("param")).toEqual(solo.routes.get("param"));
      expect(pair.routes.get("post")).toEqual(solo.routes.get("post"));
      expect(pair.routes.has("inert")).toBe(false);
      expect(pair.routes.size).toBe(2);
    });

    it('a route to a mod:"off" param is inert in the STATE too, not just in the value', () => {
      const off = preset.params.find((p) => p.mod === "off");
      expect(off, 'fixture: this preset must declare a mod:"off" param').toBeDefined();
      const state = createModEvalState();
      const r = validModRoutes([
        { id: "offRoute", source: "kick", param: off!.key, amount: 1, attack: 0.2 },
      ]);
      const f = features({ time: 0, kick: 1 });
      applyMods(preset, minBase(), r, f, undefined, state);
      applyPostMods(DEFAULT_POST, r, f, undefined, state);
      expect(state.routes.size).toBe(0);
    });
  });
});

describe("mod v2: tempo-locked LFO sources", () => {
  it("phase math: sine/saw/square at documented points (bpm 120)", () => {
    // time 0.25 s @120 BPM → beatPos 0.5 → phase 0.5 for R=1
    const f = features({ time: 0.25, bpm: 120 });
    expect(sourceValue(f, "lfo:sine:1")).toBeCloseTo(1, 10);
    expect(sourceValue(f, "lfo:saw:1")).toBeCloseTo(0.5, 10);
    expect(sourceValue(f, "lfo:square:1")).toBe(0); // high half is phase < 0.5
    // Cycle start: sine begins AT 0, square begins high.
    const f0 = features({ time: 0, bpm: 120 });
    expect(sourceValue(f0, "lfo:sine:1")).toBeCloseTo(0, 10);
    expect(sourceValue(f0, "lfo:saw:1")).toBe(0);
    expect(sourceValue(f0, "lfo:square:1")).toBe(1);
    // R=4: one cycle per 4 beats → 2 s @120 BPM lands back on phase 0.
    expect(sourceValue(features({ time: 2, bpm: 120 }), "lfo:sine:4")).toBeCloseTo(0, 10);
  });

  it("bpm 0 falls back to the 120-BPM-equivalent clock (beatPos = time × 2)", () => {
    const f = features({ time: 0.25, bpm: 0 });
    expect(sourceValue(f, "lfo:sine:1")).toBeCloseTo(1, 10);
  });

  it("is a pure function of time — seek-stable, no history", () => {
    const at = (time: number) => sourceValue(features({ time, bpm: 100 }), "lfo:sine:2");
    const direct = at(137.31);
    at(5);
    at(999.9);
    at(0);
    expect(at(137.31)).toBe(direct);
    // Output range: 0..1 for every wave/rate over a time sweep.
    for (const s of LFO_SOURCES) {
      for (let t = 0; t < 4; t += 0.13) {
        const v = sourceValue(features({ time: t, bpm: 97 }), s.id);
        expect(v, `${s.id} @ ${t}`).toBeGreaterThanOrEqual(0);
        expect(v, `${s.id} @ ${t}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("composes with curve like any source (saw 0.5 → exp → 0.25)", () => {
    const routes = validModRoutes([
      { id: "r", source: "lfo:saw:1", param: spec.key, amount: 1, curve: "exp" },
    ]);
    const out = applyMods(preset, minBase(), routes, features({ time: 0.5, bpm: 60 }));
    expect(out[spec.key]).toBeCloseTo(spec.min + 0.25 * range, 10);
  });
});

/**
 * E2-R1 — the LFO phase anchor.
 *
 * A segment export slices the audio so the clip starts at t=0, which rebases
 * every other time-bearing structure in the job. The LFOs anchored on
 * `features.time` moved with that rebase while nothing else about them did, so
 * the exported clip ran the whole cycle from a different starting phase than
 * the preview showed. `features.timeOrigin` carries the clip's t=0 back in
 * track time; the LFO reads `time + (timeOrigin ?? 0)`.
 */
describe("mod v2: the LFO anchor is ABSOLUTE track time (E2-R1)", () => {
  /**
   * 120 BPM, a segment starting 137 s in, 8 beats per cycle:
   *   274 beats / 8 = 34.25 cycles → phase 0.25 → sine 0.5.
   *
   * THE RATE IS LOAD-BEARING. At 0.25 / 0.5 / 1 / 2 beats per cycle this same
   * start lands on a whole number of cycles, i.e. phase 0 — which is exactly
   * what the defect produced. A test written at those rates passes against the
   * broken code, so these use 8 and assert the VALUE rather than "the two
   * differ".
   */
  const SEG_START = 137;
  const BPM = 120;
  const routes = validModRoutes([
    { id: "lfo", source: "lfo:sine:8", param: spec.key, amount: 0.5 },
  ]);
  const at = (f: AudioFeatures) => applyMods(preset, minBase(), routes, f)[spec.key];

  it("a segment export's frame 0 resolves what the preview shows at 137 s", () => {
    const exported = at(features({ time: 0, bpm: BPM, timeOrigin: SEG_START }));
    const preview = at(features({ time: SEG_START, bpm: BPM }));
    expect(exported).toBe(preview);
    // By VALUE too: sine at phase 0.25 is 0.5, halved by amount 0.5 → a
    // quarter of the range above the base. The defect resolved phase 0 → 0 →
    // exactly spec.min.
    expect(exported).toBeCloseTo(spec.min + 0.25 * range, 10);
    // Non-vacuity: both the correct value and the broken one are inside the
    // spec range, so nothing here is a clamp saturating at an endpoint.
    expect(exported).toBeGreaterThan(spec.min);
    expect(exported).toBeLessThan(spec.max);
  });

  it("holds for every wave, not just the one the defect was found on", () => {
    const exported = features({ time: 0, bpm: BPM, timeOrigin: SEG_START });
    const preview = features({ time: SEG_START, bpm: BPM });
    // Phase 0.25 → sine 0.5, saw 0.25, square 1 (the high half is phase < 0.5).
    expect(sourceValue(exported, "lfo:sine:8")).toBeCloseTo(0.5, 10);
    expect(sourceValue(exported, "lfo:saw:8")).toBeCloseTo(0.25, 10);
    expect(sourceValue(exported, "lfo:square:8")).toBe(1);
    for (const wave of ["sine", "saw", "square"] as const) {
      const id = `lfo:${wave}:8` as ModSource;
      expect(sourceValue(exported, id), wave).toBe(sourceValue(preview, id));
    }
  });

  it("splits the clip's origin off `time`, so a mid-clip frame still advances", () => {
    // The origin is a constant offset, not a replacement for clip time: frame
    // N of the clip must resolve the preview's value at SEG_START + N/fps.
    for (const dt of [0, 0.25, 1.5, 7.125]) {
      expect(
        at(features({ time: dt, bpm: BPM, timeOrigin: SEG_START })),
        `clip time ${dt}`,
      ).toBeCloseTo(at(features({ time: SEG_START + dt, bpm: BPM })), 10);
    }
  });

  it("an ABSENT timeOrigin is EXACT identity with an explicit 0 (the live path)", () => {
    // The live path never sets the field, so `?? 0` is what preserves today's
    // arithmetic bit-for-bit. bpm 0 exercises the 120-BPM-equivalent fallback
    // clock, which does its own multiply and would drift separately.
    const times = [0, 0.37, 1.11, 2.5, 4.73, 137, 137.31];
    const bpms = [0, 97, 120];
    let compared = 0;
    for (const s of LFO_SOURCES) {
      for (const bpm of bpms) {
        for (const t of times) {
          const f = features({ time: t, bpm });
          expect(sourceValue(f, s.id), `${s.id} @ ${t}s, bpm ${bpm}`).toBe(
            sourceValue({ ...f, timeOrigin: 0 }, s.id),
          );
          compared++;
        }
      }
    }
    // Non-vacuity: the sweep really did run over the whole family.
    expect(LFO_SOURCES.length).toBe(18);
    expect(compared).toBe(LFO_SOURCES.length * bpms.length * times.length);
  });
});

describe("mod v2: validator", () => {
  it("accepts the whole LFO id family and rejects near-misses", () => {
    const good = LFO_SOURCES.map((s, i) => ({
      id: `g${i}`,
      source: s.id,
      param: "x",
      amount: 0.2,
    }));
    expect(validModRoutes(good)).toHaveLength(LFO_SOURCES.length); // 3 waves × 6 rates
    const bad = ["lfo:sine:3", "lfo:tri:1", "lfo:sine:.25", "lfo:sine", "LFO:sine:1", "lfo::1"].map(
      (source, i) => ({ id: `b${i}`, source, param: "x", amount: 0.2 }),
    );
    expect(validModRoutes(bad)).toHaveLength(0);
  });

  it("keeps valid curves, strips garbage ones", () => {
    const routes = validModRoutes([
      { id: "a", source: "kick", param: "x", amount: 0.5, curve: "exp" },
      { id: "b", source: "kick", param: "x", amount: 0.5, curve: "smooth" },
      { id: "c", source: "kick", param: "x", amount: 0.5, curve: "linear" },
      { id: "d", source: "kick", param: "x", amount: 0.5, curve: "cubic" },
      { id: "e", source: "kick", param: "x", amount: 0.5, curve: 3 },
      { id: "f", source: "kick", param: "x", amount: 0.5, curve: null },
    ]);
    expect(routes.map((r) => r.curve)).toEqual([
      "exp",
      "smooth",
      "linear",
      undefined,
      undefined,
      undefined,
    ]);
    expect("curve" in routes[3]).toBe(false); // stripped, not set-to-undefined
  });

  it("clamps attack/release to 0..10 s and strips non-finite garbage", () => {
    const routes = validModRoutes([
      { id: "a", source: "kick", param: "x", amount: 0.5, attack: 0.3, release: 99 },
      { id: "b", source: "kick", param: "x", amount: 0.5, attack: -5 },
      { id: "c", source: "kick", param: "x", amount: 0.5, attack: NaN, release: Infinity },
      { id: "d", source: "kick", param: "x", amount: 0.5, attack: "fast", release: {} },
    ]);
    expect(routes[0].attack).toBe(0.3);
    expect(routes[0].release).toBe(10);
    expect(routes[1].attack).toBe(0);
    expect("attack" in routes[2]).toBe(false);
    expect("release" in routes[2]).toBe(false);
    expect("attack" in routes[3]).toBe(false);
    expect("release" in routes[3]).toBe(false);
  });

  it("v2 fields survive a validation round-trip unchanged", () => {
    const routes = validModRoutes([
      {
        id: "a",
        source: "lfo:square:0.5" satisfies ModSource,
        param: "post:bloom",
        amount: -0.4,
        curve: "smooth",
        attack: 0.08,
        release: 0.35,
      },
    ]);
    expect(routes).toEqual([
      {
        id: "a",
        source: "lfo:square:0.5",
        param: "post:bloom",
        amount: -0.4,
        curve: "smooth",
        attack: 0.08,
        release: 0.35,
      },
    ]);
    expect(validModRoutes(routes)).toEqual(routes);
  });
});

// ---------------------------------------------------------------------------
// H12: per-route mute + route reordering.
// ---------------------------------------------------------------------------

describe("H12: mute — validator", () => {
  it("keeps a boolean muted, strips a non-boolean one", () => {
    const routes = validModRoutes([
      { id: "a", source: "kick", param: "x", amount: 0.5, muted: true },
      { id: "b", source: "kick", param: "x", amount: 0.5, muted: false },
      { id: "c", source: "kick", param: "x", amount: 0.5, muted: "yes" },
      { id: "d", source: "kick", param: "x", amount: 0.5, muted: 1 },
      { id: "e", source: "kick", param: "x", amount: 0.5, muted: null },
    ]);
    expect(routes.map((r) => r.muted)).toEqual([true, false, undefined, undefined, undefined]);
    expect("muted" in routes[2]).toBe(false); // stripped, not set-to-undefined
  });

  it("a v1 route (muted absent) round-trips with exactly its v1 keys", () => {
    const [r] = validModRoutes([{ id: "a", source: "kick", param: "x", amount: 0.5 }]);
    expect(Object.keys(r).sort()).toEqual(["amount", "id", "param", "source"]);
  });

  it("muted survives alongside curve/attack, same as any other v2 field", () => {
    const routes = validModRoutes([
      { id: "a", source: "kick", param: "x", amount: 0.5, curve: "exp", attack: 0.1, muted: true },
    ]);
    expect(routes).toEqual([
      { id: "a", source: "kick", param: "x", amount: 0.5, curve: "exp", attack: 0.1, muted: true },
    ]);
    expect(validModRoutes(routes)).toEqual(routes);
  });
});

describe("H12: mute — evaluation", () => {
  it("applyMods skips a muted route — value equals base", () => {
    const base = defaultParams(preset);
    const routes = validModRoutes([
      { id: "r", source: "kick", param: spec.key, amount: 1, muted: true },
    ]);
    expect(applyMods(preset, base, routes, features({ kick: 1 }))).toEqual(base);
  });

  it("applyPostMods skips a muted route — value equals base", () => {
    const post = { ...DEFAULT_POST };
    const routes = validModRoutes([
      { id: "r", source: "bass", param: "post:chromatic", amount: 1, muted: true },
    ]);
    expect(applyPostMods(post, routes, features({ bass: 1 }))).toEqual(post);
  });

  it("identity fast path holds when EVERY route is muted (params and post)", () => {
    // The all-muted case matters as much as the all-off one (modMatrix's own
    // "applyMods lazy clone" describe block): callers use `out === base` to
    // skip a redundant GPU upload, so a project the user muted entirely must
    // not pay for a per-frame clone it no longer needs.
    const base = defaultParams(preset);
    const routes = validModRoutes([
      { id: "a", source: "kick", param: spec.key, amount: 1, muted: true },
      { id: "b", source: "bass", param: "post:chromatic", amount: 1, muted: true },
    ]);
    expect(applyMods(preset, base, routes, features({ kick: 1, bass: 1 }))).toBe(base);
    expect(applyPostMods(DEFAULT_POST, routes, features({ kick: 1, bass: 1 }))).toBe(DEFAULT_POST);
  });

  it("a mixed list applies only the live route — muting one leaves the other exactly as before", () => {
    // amount 1 with a single live route at kick=1 saturates to spec.max
    // regardless of whether a SECOND route is also (wrongly) contributing —
    // a route reaching the clamp cannot show whether anything else added to
    // it, so that shape passes even with the mute skip deleted. 0.05 from
    // minBase() never saturates: a live-only route lands at
    // min + 0.05·range, and a broken skip that let the muted route ALSO
    // apply would sum to min + 0.10·range instead — a different, checkable
    // number, not a coincidental shared edge.
    const mixed = validModRoutes([
      { id: "a", source: "kick", param: spec.key, amount: 0.05, muted: true },
      { id: "b", source: "kick", param: spec.key, amount: 0.05 },
    ]);
    const liveOnly = validModRoutes([{ id: "b", source: "kick", param: spec.key, amount: 0.05 }]);
    const out = applyMods(preset, minBase(), mixed, features({ kick: 1 }));
    expect(out).toEqual(applyMods(preset, minBase(), liveOnly, features({ kick: 1 })));
    // Non-vacuity: pin the actual number too, so a future edit could not
    // make both sides wrong the same way and still pass the equality above.
    expect(out[spec.key]).toBeCloseTo(spec.min + 0.05 * range, 10);
  });

  it("a muted route's lag memo is never touched — no state entry, not just no value change", () => {
    // Mirrors "a route to a mod:'off' param is inert in the STATE too" above:
    // mute has to be inert in the STATE too, or an attack/release route would
    // keep gliding toward a target nobody sees while muted, and the memo
    // would desync from what the (also-frozen) publisher expects.
    const state = createModEvalState();
    const routes = validModRoutes([
      { id: "r", source: "kick", param: spec.key, amount: 1, attack: 0.2, muted: true },
    ]);
    applyMods(
      preset,
      defaultParams(preset),
      routes,
      features({ kick: 1, time: 0 }),
      undefined,
      state,
    );
    applyMods(
      preset,
      defaultParams(preset),
      routes,
      features({ kick: 1, time: 5 }),
      undefined,
      state,
    );
    expect(state.routes.size).toBe(0);
  });
});

describe("H12: reorderRoutes", () => {
  const r = (id: string, param: string): ModRoute => ({ id, source: "kick", param, amount: 0.5 });

  it("moves within-card order; routes of other params keep their exact index (identity)", () => {
    const a = r("a", "hue");
    const b = r("b", "size"); // a DIFFERENT param, interleaved on purpose
    const c = r("c", "hue");
    const d = r("d", "hue");
    const routes = [a, b, c, d];
    // "hue"'s own subsequence is [a, c, d] at full-array indices [0, 2, 3].
    // Move a (subsequence index 0) to the end of that subsequence (index 2).
    const out = reorderRoutes(routes, "hue", 0, 2);
    expect(out.map((x) => x.id)).toEqual(["c", "b", "d", "a"]);
    // Not just equal VALUES — the untouched route is the SAME object, at the
    // SAME index, and the moved ones are the same objects too (no clone).
    expect(out[1]).toBe(b);
    expect(out[0]).toBe(c);
    expect(out[2]).toBe(d);
    expect(out[3]).toBe(a);
  });

  it("out-of-range or equal indices return the array BY IDENTITY", () => {
    const routes = [r("a", "hue"), r("b", "hue")];
    expect(reorderRoutes(routes, "hue", 0, 0)).toBe(routes);
    expect(reorderRoutes(routes, "hue", -1, 1)).toBe(routes);
    expect(reorderRoutes(routes, "hue", 0, 2)).toBe(routes);
    expect(reorderRoutes(routes, "nope", 0, 1)).toBe(routes); // no route has this param
  });

  it("a lone route on the param is always a no-op", () => {
    const routes = [r("a", "hue"), r("b", "size")];
    expect(reorderRoutes(routes, "hue", 0, 0)).toBe(routes);
  });
});
