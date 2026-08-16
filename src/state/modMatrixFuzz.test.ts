import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyMods,
  applyPostMods,
  createModEvalState,
  LFO_SOURCES,
  MOD_LAG_MAX_SEC,
  MOD_SOURCES,
  sourceValue,
  validModRoutes,
  validModsByPreset,
  type ModRoute,
  type ModSource,
} from "./modMatrix";
import { presets } from "../render/presets";
import { DEFAULT_POST, defaultParams, paramSpecMap, type ParamValues } from "../render/types";
import type { AudioFeatures } from "../audio/types";

/**
 * Property fuzzing of the modulation matrix (BACKLOG E2, gap (b) — the
 * "deep-state remainder" wave 1 named and did not cover: modMatrix,
 * frameResolve and the store slices).
 *
 * Same two disciplines `featurePipelineFuzz.test.ts` established:
 *
 *  1. Generators cover the REACHABLE alphabet (real route JSON goes through
 *     `validModRoutes` — same chokepoint every project/theme/localStorage
 *     load uses — before reaching the evaluator; `sourceValue` is ALSO
 *     fuzzed directly with a raw cast string, because it is exported and
 *     called with an already-typed `ModSource` elsewhere, so its own
 *     defenses against a value that slipped past the type system are a
 *     separate, real question from "does the validator reject it").
 *  2. Every property below was MUTATION-CHECKED — the guard it covers was
 *     broken and the property confirmed red before being reverted. The note
 *     above each property records the mutation and the failure it produced.
 */

const RUNS = { numRuns: 200, seed: 0x6d0d_fa22 };

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

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Names whose bracket-assignment invokes an inherited accessor/prototype
 * member if a validator or evaluator ever used `{}` naively instead of
 * `Object.create(null)` / a real `Map`. Fed into every string-shaped field
 * (id, source, param) a hostile document controls. */
const PROTO_KEYS = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString"];

const realSourceArb = fc.constantFrom(...MOD_SOURCES.map((s) => s.id));
const lfoSourceArb = fc.constantFrom(...LFO_SOURCES.map((s) => s.id));
const stemSourceArb = fc
  .tuple(
    fc.integer({ min: 1, max: 4 }),
    fc.constantFrom("energy", "bass", "mid", "treble", "kick", "snare", "hat"),
  )
  .map(([n, b]) => `stem${n}:${b}`);
/** Near-misses of the LFO/stem grammars, plus outright garbage — every one of
 * these must be REJECTED by isValidSource/validModRoutes (P-16's comment:
 * "PERSISTED FOREVER" grammar), never partially matched. */
const nearMissSourceArb = fc.constantFrom(
  "lfo:sine:3",
  "lfo:tri:1",
  "lfo:sine:.25",
  "lfo:sine",
  "LFO:sine:1",
  "lfo::1",
  "stem0:kick",
  "stem5:kick",
  "stem1:bogus",
  "STEM1:kick",
  "",
  "kick ",
  " kick",
);
const hostileSourceArb = fc.oneof(fc.string(), fc.constantFrom(...PROTO_KEYS), nearMissSourceArb);
const sourceArb = fc.oneof(
  { weight: 3, arbitrary: realSourceArb },
  { weight: 2, arbitrary: lfoSourceArb },
  { weight: 2, arbitrary: stemSourceArb },
  { weight: 2, arbitrary: hostileSourceArb },
);

/** Numbers a hostile document, a NaN upstream computation, or a hand edit can
 * plausibly carry for amount/attack/release — mirrors featurePipelineFuzz's
 * dbValue/sampleValue mix of a real range plus named extremes. */
const hostileNumberArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: -1000, max: 1000, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(NaN, Infinity, -Infinity, -0, 1e308, -1e308, 99, -99),
  },
);

const paramArb = (specKey: string) =>
  fc.oneof(
    { weight: 3, arbitrary: fc.constant(specKey) },
    { weight: 2, arbitrary: fc.constantFrom("post:chromatic", "post:bloom", "post:tonemap") },
    { weight: 2, arbitrary: fc.constantFrom(...PROTO_KEYS) },
    { weight: 2, arbitrary: fc.string() },
    { weight: 1, arbitrary: fc.constant("") },
  );

const curveArb = fc.oneof(
  fc.constantFrom("linear", "exp", "smooth", "cubic", ""),
  fc.double(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constantFrom(...PROTO_KEYS),
);

const mutedArb = fc.oneof(
  fc.boolean(),
  fc.constant(undefined),
  fc.constantFrom("yes", "true", 1, 0, null),
);

/** A raw route object as it would arrive from an untrusted .bfproj/.bftheme/
 * localStorage read — every field independently possibly-missing
 * (`requiredKeys: []`, same idiom featurePipelineFuzz's syncArb uses) so
 * partially-shaped hand edits are as reachable as fully hostile ones. */
function rawRouteArb(specKey: string) {
  return fc.record(
    {
      id: fc.oneof(fc.string(), fc.uuid(), fc.constantFrom(...PROTO_KEYS)),
      source: sourceArb,
      param: paramArb(specKey),
      amount: hostileNumberArb,
      curve: curveArb,
      attack: fc.oneof(hostileNumberArb, fc.constant(undefined), fc.string()),
      release: fc.oneof(hostileNumberArb, fc.constant(undefined), fc.string()),
      muted: mutedArb,
    },
    { requiredKeys: [] },
  );
}

/** Whatever `Array.isArray` accepts as one element: a shaped route, or total
 * garbage (persistenceFuzz's own "garbage" idiom: a validator's very first
 * job is surviving the entries that are not even the right TYPE). */
function routesArrayArb(specKey: string) {
  return fc.array(
    fc.oneof(
      { weight: 5, arbitrary: rawRouteArb(specKey) },
      {
        weight: 1,
        arbitrary: fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.array(fc.anything())),
      },
    ),
    { minLength: 0, maxLength: 8 },
  );
}

/** Per-frame stem envelope map: hostile keys (proto names, near-miss stem
 * ids) and hostile values (NaN/Infinity are NOT excluded — nothing in
 * `sourceValue`'s stem branch checks them, see the property below). */
const stemsArb = fc.dictionary(
  fc.oneof(stemSourceArb, fc.constantFrom(...PROTO_KEYS), fc.string()),
  hostileNumberArb,
  { maxKeys: 6 },
);

/**
 * Track-time sequence a caller-owned ModEvalState walks: negative jumps
 * (seek back), huge jumps (loop/track change), repeats (dt=0, paused
 * preview), alongside ordinary forward playback — but always FINITE.
 *
 * NOT NaN/Infinity: `time` is a scalar of the SAME `AudioFeatures` object
 * `featurePipelineFuzz.test.ts` already fuzzes end-to-end (it is in that
 * file's own `SCALARS` list) and proves can never be non-finite coming out
 * of the real pipeline — both modMatrix callers (services.ts live loop,
 * exportCore.ts's OfflineAnalyzer) feed it FeaturePipeline output, never a
 * hand-built frame. Generating NaN for it here would be exactly the
 * vacuity trap this file's header warns about in reverse: not "the
 * property never bites", but "the property bites a scenario nothing can
 * produce", which the first draft of this file did (see the lag-state
 * property below, which failed on `time: NaN` until this was narrowed).
 */
const timeArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 0, max: 600, noNaN: true }) },
  { weight: 2, arbitrary: fc.constantFrom(0, -0) },
  { weight: 2, arbitrary: fc.double({ min: -1e6, max: 1e6, noNaN: true }) },
);

/**
 * kick/bass/treble-shaped AudioFeatures scalars: finite (same proven
 * FeaturePipeline contract as `timeArb` above — these are in
 * featurePipelineFuzz's `SCALARS` list too), including a finite-but-outside-
 * 0..1 tail, because that range is NOT formally proven anywhere (only
 * finiteness is) and modMatrix's curve stage has its own clamp to check.
 * NOT NaN/Infinity, for the same reachability reason `timeArb` excludes them.
 */
const unitFeatureArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
  { weight: 2, arbitrary: fc.double({ min: -5, max: 5, noNaN: true }) },
);

const frameArb = fc.record({
  time: timeArb,
  kick: unitFeatureArb,
  bass: unitFeatureArb,
  treble: unitFeatureArb,
  bpm: fc.oneof(fc.double({ min: 0, max: 300, noNaN: true }), fc.constantFrom(0, -1)),
});

/** Every numeric value on a ParamValues bag; null when all are finite. */
function firstNonFiniteParam(p: ParamValues): string | null {
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "number" && !Number.isFinite(v)) return `${k}=${v}`;
  }
  return null;
}

const preset = presets[0];
const spec = preset.params[0];
const nebula = presets.find((p) => p.id === "nebula")!;
const bars = presets.find((p) => p.id === "spectrum-bars")!;
const kaleidoSpec = nebula.params.find((p) => p.key === "kaleido")!; // mod:"snap"
const mirrorKey = bars.params.find((p) => p.key === "mirror")!.key; // mod:"off"

describe(
  "modMatrix property fuzz: validated routes through the evaluator",
  { timeout: 30_000 },
  () => {
    /**
     * MUTATION-CHECKED: removed `applyMods`' `Math.min(spec.max, Math.max(spec.min, next))`
     * clamp (replaced with bare `next`) — RED immediately, `out[spec.key]` a
     * value far outside [spec.min, spec.max] under the very first extreme
     * `amount`/hostile-number case fast-check shrinks to. Reverted.
     */
    it("never throws and never emits a non-finite or out-of-range param, for any validated route list", () => {
      fc.assert(
        fc.property(
          routesArrayArb(spec.key),
          frameArb,
          stemsArb,
          fc.boolean(), // with vs without a lag state
          (rawRoutes, frame, stems, withState) => {
            const routes = validModRoutes(rawRoutes);
            const state = withState ? createModEvalState() : undefined;
            const f = features({
              time: frame.time,
              kick: frame.kick,
              bass: frame.bass,
              treble: frame.treble,
              bpm: frame.bpm,
            });
            const base = defaultParams(preset);
            const out = applyMods(preset, base, routes, f, stems, state);
            const bad = firstNonFiniteParam(out);
            if (bad) throw new Error(`applyMods produced ${bad}`);
            const specs = paramSpecMap(preset);
            for (const [k, v] of Object.entries(out)) {
              const s = specs.get(k);
              if (s && typeof v === "number") {
                if (v < s.min - 1e-9 || v > s.max + 1e-9) {
                  throw new Error(`${k}=${v} outside [${s.min}, ${s.max}]`);
                }
              }
            }
            const postOut = applyPostMods(DEFAULT_POST, routes, f, stems, state);
            const postBad = firstNonFiniteParam(postOut as unknown as ParamValues);
            if (postBad) throw new Error(`applyPostMods produced ${postBad}`);
          },
        ),
        RUNS,
      );
    });

    /**
     * MUTATION-CHECKED: changed `shapedValue`'s exp branch to skip clamping
     * (`return raw * raw;` instead of clamping first) — RED with `stacked
     * routes produced NaN`. Needed the fixed stem fixture raised to 1e200 (not
     * the original 1e30) to actually reproduce: squaring 1e30 unclamped still
     * fits in a double, but squaring 1e200 overflows to Infinity, and
     * `Infinity * amount * range` for an `amount` the generator lands on 0 (or
     * -0, both in `hostileNumberArb`) is `Infinity * 0` = NaN — the applyMods
     * clamp (untouched by this mutation) cannot rescue a NaN once one exists.
     * Reverted; 1e200 kept as the fixture so the property stays non-vacuous.
     */
    it("stacking many extreme-amount routes on one param still clamps to the spec range", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              source: sourceArb,
              amount: hostileNumberArb,
              curve: fc.constantFrom("linear", "exp", "smooth", undefined),
            }),
            { minLength: 1, maxLength: 12 },
          ),
          frameArb,
          (specs, frame) => {
            const routes: ModRoute[] = validModRoutes(
              specs.map((s, i) => ({
                id: `r${i}`,
                source: s.source,
                param: spec.key,
                amount: s.amount,
                curve: s.curve,
              })),
            );
            const f = features({
              time: frame.time,
              kick: frame.kick,
              bass: frame.bass,
              treble: frame.treble,
              bpm: frame.bpm,
            });
            const out = applyMods(preset, defaultParams(preset), routes, f, {
              "stem1:kick": 1e200,
              "stem2:bass": -1e200,
            });
            const v = out[spec.key];
            if (!Number.isFinite(v)) throw new Error(`stacked routes produced ${v}`);
            if (v < spec.min - 1e-9 || v > spec.max + 1e-9)
              throw new Error(`stacked routes produced ${v} outside range`);
          },
        ),
        RUNS,
      );
    });
  },
);

describe(
  "modMatrix property fuzz: lag state across hostile time sequences",
  { timeout: 30_000 },
  () => {
    /**
     * MUTATION-CHECKED: removed routeValue's `dt < 0 || dt > LAG_SNAP_SEC`
     * snap branch (left only `tau <= 0`) — RED: a backward time jump produced
     * `memo.value` outside [0,1] almost immediately (a negative `dt` flips the
     * sign inside the EMA and walks the value past the target with no ceiling).
     * Reverted.
     */
    it("a caller-owned lag state never accumulates a non-finite or out-of-unit value, across ANY time sequence", () => {
      fc.assert(
        fc.property(
          fc.array(frameArb, { minLength: 1, maxLength: 30 }),
          fc.double({ min: 0, max: MOD_LAG_MAX_SEC, noNaN: true }),
          fc.double({ min: 0, max: MOD_LAG_MAX_SEC, noNaN: true }),
          (frames, attack, release) => {
            const routes = validModRoutes([
              { id: "lag", source: "kick", param: spec.key, amount: 0.5, attack, release },
            ]);
            const state = createModEvalState();
            for (const frame of frames) {
              const f = features({
                time: frame.time,
                kick: frame.kick,
                bass: frame.bass,
                bpm: frame.bpm,
              });
              const out = applyMods(preset, defaultParams(preset), routes, f, undefined, state);
              const v = out[spec.key];
              if (!Number.isFinite(v)) throw new Error(`memo produced ${v} at time=${frame.time}`);
              if (v < spec.min - 1e-6 || v > spec.max + 1e-6) {
                throw new Error(
                  `memo produced ${v} outside [${spec.min}, ${spec.max}] at time=${frame.time}`,
                );
              }
            }
          },
        ),
        RUNS,
      );
    });
  },
);

describe("modMatrix property fuzz: mute + snap + post interplay", { timeout: 30_000 }, () => {
  /**
   * MUTATION-CHECKED: deleted applyMods' `if (route.muted === true) continue;`
   * line — RED immediately: a muted-but-live-amount route stacked onto the
   * unmuted sibling in the "mixed list" case below, producing a different
   * (larger) number than the muted route contributing zero. Reverted.
   */
  it("a muted route contributes exactly zero, however extreme its own fields are, in a fuzzed mixed list", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            source: realSourceArb,
            amount: hostileNumberArb,
            curve: fc.constantFrom("linear", "exp", "smooth", undefined),
            attack: fc.constantFrom(0, 0.2, undefined),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        frameArb,
        (specsIn, frame) => {
          const muted: ModRoute[] = validModRoutes(
            specsIn.map((s, i) => ({
              id: `m${i}`,
              source: s.source,
              param: spec.key,
              amount: s.amount,
              curve: s.curve,
              attack: s.attack,
              muted: true,
            })),
          );
          const f = features({
            time: frame.time,
            kick: frame.kick,
            bass: frame.bass,
            treble: frame.treble,
            bpm: frame.bpm,
          });
          const base = defaultParams(preset);
          const withMuted = applyMods(preset, base, muted, f);
          const withoutAny = applyMods(preset, base, [], f);
          expect(withMuted).toEqual(withoutAny);
        },
      ),
      RUNS,
    );
  });

  /**
   * MUTATION-CHECKED: removed applyMods' `if (spec.mod === "snap") next = Math.round(next);`
   * line — RED with a fractional `kaleido` value under the first fast-check
   * case (any non-zero amount/feature combination lands off-grid). Reverted.
   */
  it("a snap-tagged param is always a whole number, for any fuzzed amount/feature", () => {
    fc.assert(
      fc.property(hostileNumberArb, unitFeatureArb, (amount, bassFeature) => {
        const routes = validModRoutes([
          { id: "r", source: "bass", param: kaleidoSpec.key, amount },
        ]);
        const out = applyMods(
          nebula,
          defaultParams(nebula),
          routes,
          features({ bass: bassFeature }),
        );
        const v = out[kaleidoSpec.key];
        if (!Number.isFinite(v)) throw new Error(`kaleido=${v}`);
        if (!Number.isInteger(v)) throw new Error(`kaleido=${v} not an integer`);
        if (v < kaleidoSpec.min || v > kaleidoSpec.max)
          throw new Error(`kaleido=${v} outside range`);
      }),
      RUNS,
    );
  });

  /**
   * MUTATION-CHECKED: removed applyMods' `if (spec.mod === "off") continue;`
   * line — RED: an "off"-tagged param (mirror) moved away from its base
   * value under the first live route the property generated. Reverted.
   */
  it('a mod:"off" param never moves, for any fuzzed route touching it', () => {
    fc.assert(
      fc.property(hostileNumberArb, unitFeatureArb, mutedArb, (amount, kickFeature, muted) => {
        const routes = validModRoutes([
          { id: "r", source: "kick", param: mirrorKey, amount, muted },
        ]);
        const base = defaultParams(bars);
        const out = applyMods(bars, base, routes, features({ kick: kickFeature }));
        expect(out[mirrorKey]).toBe(base[mirrorKey]);
      }),
      RUNS,
    );
  });

  /**
   * MUTATION-CHECKED: applyPostMods' own mute skip removed — RED, a muted
   * post route moved `chromatic` away from the base value. Reverted.
   * Also pins the H12 partition contract (applyMods/applyPostMods docs: "a
   * route targets EITHER a preset param or a post key, never both") under a
   * fuzzed mixed list — the shared ModEvalState must end up with exactly one
   * memo per LIVE route, none for inert/muted ones.
   */
  it("param and post routes partition one shared lag state correctly under a fuzzed mixed list", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            kind: fc.constantFrom("param", "post", "inert"),
            source: realSourceArb,
            amount: hostileNumberArb,
            muted: fc.boolean(),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        frameArb,
        (specsIn, frame) => {
          const raw = specsIn.map((s) => ({
            id: s.id,
            source: s.source,
            param:
              s.kind === "param"
                ? spec.key
                : s.kind === "post"
                  ? "post:chromatic"
                  : "not-a-real-knob",
            amount: s.amount,
            attack: 0.2,
            muted: s.muted,
          }));
          const routes = validModRoutes(raw);
          const state = createModEvalState();
          const f = features({
            time: frame.time,
            kick: frame.kick,
            bass: frame.bass,
            bpm: frame.bpm,
          });
          applyMods(preset, defaultParams(preset), routes, f, undefined, state);
          applyPostMods(DEFAULT_POST, routes, f, undefined, state);
          const liveCount = routes.filter(
            (r) => r.muted !== true && r.param !== "not-a-real-knob",
          ).length;
          if (state.routes.size !== liveCount) {
            throw new Error(`expected ${liveCount} memos, found ${state.routes.size}`);
          }
        },
      ),
      RUNS,
    );
  });
});

describe(
  "modMatrix property fuzz: hostile ids never touch Object.prototype",
  { timeout: 30_000 },
  () => {
    /**
     * FIRST DRAFT WAS DOUBLY VACUOUS (both caught empirically, not reasoned):
     * (1) fuzzing `param` from PROTO_KEYS too meant `specs.get(route.param)`
     * (applyMods) and `postTargetKey(route.param)` (applyPostMods) NEVER
     * matched — both bail out via their existing "unknown param" `continue`
     * BEFORE routeValue ever runs, so the ModEvalState code path this test
     * exists to check was never reached, for ANY generated case. Fixed by
     * pinning `param` to a real target (spec.key / "post:chromatic") so the
     * route is actually live, and hostile-ness lives entirely in `id`.
     * (2) confirmed the remaining claim ("assigning a NUMBER through the
     * inherited __proto__ setter cannot reassign a prototype") empirically —
     * true, but ALSO discovered it is stronger than that: a route whose param
     * is a bare prototype key can never even reach `out[route.param] = ...`
     * in the first place, because it can never match a real spec or
     * "post:"-prefixed key. That is simply the existing "skip an unmatched
     * param" behavior, already covered by the main property above; this test
     * no longer re-asserts it separately.
     *
     * MUTATION-CHECKED (the property this test actually pins): swapped
     * `createModEvalState`'s `new Map()` for a plain object bag, `.get`/`.set`
     * for bracket access — RED: `Object.prototype.time`/`.value` became real
     * OWN properties (`Object.keys(Object.prototype)` gained them), because
     * reading `{}["__proto__"]` returns `Object.prototype` itself BY
     * REFERENCE, and the lag code's `memo.time = now` / `memo.value += ...`
     * then wrote straight onto it — global pollution, not merely a wrong
     * value. Reverted; Map-backed code stays green because Map keys (however
     * spelled) are ordinary key/value pairs with no accessor semantics.
     */
    it("a route id that is a prototype key never pollutes anything through the lag state", () => {
      const before = Object.keys(Object.prototype);
      fc.assert(
        fc.property(
          fc.constantFrom(...PROTO_KEYS),
          fc.constantFrom(spec.key, "post:chromatic"),
          // Finite on purpose, unlike hostileNumberArb elsewhere in this file:
          // `validModRoutes` drops the WHOLE route object when `amount` fails
          // `Number.isFinite` (amount, unlike curve/attack/release, gates
          // whether the route is constructed at all) — a NaN/Infinity amount
          // here would make the route vanish before ever reaching routeValue,
          // silently emptying the very case this test exists to drive. `id`
          // is the one hostile field under test.
          fc.double({ min: -1, max: 1, noNaN: true }),
          frameArb,
          (id, param, amount, frame) => {
            const routes = validModRoutes([
              { id, source: "kick", param, amount, attack: 0.1, release: 0.1 },
            ]);
            const state = createModEvalState();
            const f = features({ time: frame.time, kick: frame.kick, bpm: frame.bpm });
            const out = applyMods(preset, defaultParams(preset), routes, f, undefined, state);
            const postOut = applyPostMods(DEFAULT_POST, routes, f, undefined, state);
            // Non-vacuity guard, inside the property so a future refactor that
            // re-widens the parent skip cannot silently make this vacuous
            // again: the route must actually have reached routeValue.
            expect(state.routes.size, "route never reached the lag state").toBeGreaterThan(0);
            expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
            expect(Object.getPrototypeOf(postOut)).toBe(Object.prototype);
            expect(Object.keys(Object.prototype)).toEqual(before);
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();
          },
        ),
        RUNS,
      );
      expect(Object.keys(Object.prototype)).toEqual(before);
    });

    /**
     * MUTATION-CHECKED: `validModsByPreset`'s `Object.create(null)` swapped for
     * `{}` — RED, `Object.getPrototypeOf(out)` was no longer `null` (first
     * attempt at this test built `junk` as a source-level object LITERAL with
     * a `__proto__:` key, which is the ECMAScript B.3.1 special case — it sets
     * the literal's OWN prototype at construction time rather than creating a
     * property named "__proto__", so `JSON.stringify` never even emitted the
     * key and the mutation went undetected. `JSON.parse` on a STRING does not
     * special-case it — same construction persistenceFuzz.test.ts uses, and
     * the actually-reachable shape: a `.bfproj` is bytes, parsed once). With
     * the fix reverted the object-literal version is silently vacuous either
     * way, which is why this one parses text instead.
     */
    it("validModsByPreset never lets a __proto__ preset-id key reach Object.prototype", () => {
      const out = validModsByPreset(
        JSON.parse(
          '{"__proto__":[{"id":"a","source":"kick","param":"x","amount":0.5}],' +
            '"constructor":[{"id":"b","source":"kick","param":"x","amount":0.5}],' +
            '"normal":[{"id":"c","source":"kick","param":"x","amount":0.5}]}',
        ),
      );
      expect((Object.prototype as unknown as Record<string, unknown>).bfPolluted).toBeUndefined();
      expect(out.normal).toHaveLength(1);
      expect(Object.getPrototypeOf(out)).toBeNull();
    });
  },
);

describe(
  "modMatrix property fuzz: sourceValue against the raw (unvalidated) grammar",
  { timeout: 30_000 },
  () => {
    /**
     * MUTATION-CHECKED: removed `isValidSource`'s `STEM_SOURCE_RE.test(v)`
     * disjunct — RED, `validModRoutes` accepted a route sourced "stem9:kick"
     * (there is no 5th-9th stem slot) under the first near-miss case fast-check
     * tried. Reverted. sourceValue itself is exercised directly (a raw string
     * cast, bypassing the validator) because it is exported and called with an
     * already-typed value elsewhere in the codebase — its OWN defense against
     * an off-grammar string reaching it is a separate question from whether
     * the validator rejects one first.
     */
    it("never throws for any string, and returns 0..1 for the documented alphabet", () => {
      fc.assert(
        fc.property(sourceArb, frameArb, stemsArb, (src, frame, stems) => {
          const f = features({
            time: frame.time,
            kick: frame.kick,
            bass: frame.bass,
            bpm: frame.bpm,
          });
          // Deliberately bypassing the ModSource type: sourceValue is exported
          // and called elsewhere with an already-typed value, so its OWN
          // defense against a string that slipped past the type system (a
          // near-miss grammar id, a stray prototype key) is a separate
          // question from whether validModRoutes rejects one first.
          const v = sourceValue(f, src as unknown as ModSource, stems);
          if (typeof v !== "number" || Number.isNaN(v))
            throw new Error(`sourceValue(${src}) = ${v}`);
          const known =
            MOD_SOURCES.some((s) => s.id === src) ||
            LFO_SOURCES.some((s) => s.id === src) ||
            /^stem[1-4]:(energy|bass|mid|treble|kick|snare|hat)$/.test(src);
          if (known && (v < 0 || v > 1)) {
            throw new Error(`sourceValue(${src}) = ${v} outside 0..1`);
          }
        }),
        RUNS,
      );
    });

    /**
     * FINDING, FIXED (see modMatrix.ts's sourceValue): a stem source's value is
     * read as `stems?.[source] ?? 0` — `??` only replaces null/undefined, so a
     * NaN or ±Infinity stem envelope sample (not excluded by anything upstream
     * of this function — stems are a general `Record<string, number>` the
     * caller supplies, not something this module validates) passed straight
     * through, uncurved, into `routeValue`'s `value * amount * range`
     * arithmetic. `shapedValue`'s exp/smooth clamps do not catch it either:
     * `raw < 0 ? 0 : raw > 1 ? 1 : raw` both comparisons are false for NaN, so
     * the ternary's final `: raw` branch returns the NaN unclamped — the exact
     * "both branches false, clamp doesn't fire" shape featurePipelineFuzz.
     * test.ts's own header comment warns about for `clamp01`.
     *
     * MUTATION-CHECKED (this is the red/green pair for the fix, not a
     * hypothetical): reverting sourceValue's stem branch to the original bare
     * `stems?.[source] ?? 0` reproduces RED on this exact property —
     * `applyMods` output `NaN` for the target param whenever the fuzzed stems
     * map contained a NaN/Infinity entry for the routed stem id, which
     * fast-check finds well within `numRuns`.
     */
    it("a non-finite stem envelope value never reaches a param — the source reads as silent (0), not NaN", () => {
      fc.assert(
        fc.property(
          stemSourceArb,
          fc.constantFrom(NaN, Infinity, -Infinity),
          fc.constantFrom("linear" as const, "exp" as const, "smooth" as const, undefined),
          hostileNumberArb,
          (stemId, poison, curve, amount) => {
            const routes = validModRoutes([
              { id: "r", source: stemId, param: spec.key, amount, curve },
            ]);
            const out = applyMods(preset, defaultParams(preset), routes, features({}), {
              [stemId]: poison,
            });
            const v = out[spec.key];
            if (!Number.isFinite(v)) throw new Error(`stem poison ${poison} reached param as ${v}`);
          },
        ),
        RUNS,
      );
    });
  },
);
