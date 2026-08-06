import { describe, expect, it } from "vitest";
import { applyMods, applyPostMods, postTargetKey, validModRoutes } from "./modMatrix";
import { presets } from "../render/presets";
import { DEFAULT_POST, defaultParams } from "../render/types";
import type { AudioFeatures } from "../audio/types";

const preset = presets[0];
const spec = preset.params[0]; // first numeric param of the first preset

function features(partial: Partial<AudioFeatures>): AudioFeatures {
  return {
    bins: new Float32Array(96),
    peaks: new Float32Array(96),
    waveform: new Float32Array(512),
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
