import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveActiveFrame, type FrameResolveInput } from "./frameResolve";
import {
  evalTimeline,
  laneValue,
  TRANSITION_KINDS,
  validTimeline,
  type AutomationLane,
  type Keyframe,
  type Scene,
  type Timeline,
} from "./timeline";
import { validBg, validParamsByPreset } from "./project";
import { presets } from "../render/presets";
import { BG_IMAGE, BG_PRESET, BG_VIDEO, type ParamValues } from "../render/types";

/**
 * Property fuzzing of the live/export frame-resolution chokepoint (BACKLOG
 * E2, gap (b) — same lane as modMatrixFuzz.test.ts, surface 2 of 3).
 *
 * `resolveActiveFrame` is, by its own doc comment, "the single source of
 * truth for what should render at track time t... used by BOTH the live loop
 * and the export loop. Sharing one pure function is what guarantees preview
 * and file are identical." Its own imports pull in `evalTimeline`/
 * `laneValue` from timeline.ts, whose doc comments make several of their own
 * order-independence claims ("Resolved by TIME, never by array position");
 * this file pins THOSE claims directly, not just resolveActiveFrame's
 * surface, because a live-drag can hand the render loop an unsorted scenes/
 * keyframes array (TimelinePanel moves a dragged item in place and only
 * re-sorts on release — see laneValue's own comment) and the promise those
 * two functions make is what keeps that safe.
 *
 * Same two disciplines as the modMatrix and (persistence/audio) precedents:
 * generators cover the REACHABLE alphabet, and every property was
 * MUTATION-CHECKED — the guard broken, confirmed red, reverted.
 *
 * ── WHY `t` IS FUZZED WITH NaN/±Infinity HERE BUT NOT IN modMatrixFuzz ─────
 *
 * modMatrixFuzz.test.ts deliberately does NOT fuzz `features.time` with
 * non-finite values, because that field is a scalar of `AudioFeatures`,
 * which `featurePipelineFuzz.test.ts` already fuzzes end-to-end and proves
 * cannot be non-finite coming out of the real pipeline. `resolveActiveFrame`'s
 * `t` has no such sibling proof: it is computed independently per caller
 * (`services.ts`'s live loop reads engine/analyzer time; `exportCore.ts`
 * computes `frame / fps` per tick) and nothing validates it before it
 * reaches this chokepoint. So unlike modMatrix's `time`, generating NaN/
 * ±Infinity for `t` here is testing a genuinely unproven boundary, not a
 * scenario a sibling suite already rules out.
 *
 * ── WHY `baseParams`/`paramsByPreset` STAY FINITE-ONLY ──────────────────────
 *
 * These travel into `resolveActiveFrame` already resolved from the document
 * (`resolveParams`/`validParamsByPreset` in the real caller) — this file's
 * job is resolveActiveFrame's OWN arithmetic, not re-litigating
 * `validParamsByPreset`'s finiteness guarantee (project.ts already commits
 * to `Number.isFinite` there, and store-action-level hostile input is
 * Surface 3's job). `paramsByPreset` is built by running raw JSON through
 * the REAL `validParamsByPreset`, matching the "validated-then-mutated
 * shapes" input the task specifies.
 */

const RUNS = { numRuns: 200, seed: 0x9a5e_f00d };

const PROTO_KEYS = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString"];

const REAL_PRESET_IDS = [presets[0].id, presets[1].id, presets[2].id] as const;

/** `t`: normal playback range, huge/negative (seek/loop/track-change), and
 * the non-finite values nothing upstream of this function rules out. */
const tArb = fc.oneof(
  { weight: 5, arbitrary: fc.double({ min: 0, max: 600, noNaN: true }) },
  { weight: 2, arbitrary: fc.double({ min: -1e6, max: 1e6, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(0, -0) },
  { weight: 2, arbitrary: fc.constantFrom(NaN, Infinity, -Infinity) },
);

const finiteNumberArb = fc.double({ min: -1e6, max: 1e6, noNaN: true });

/** A finite-only ParamValues bag — see the file header for why baseParams
 * itself is not the hostile-number surface in this file. */
const paramValuesArb = fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), finiteNumberArb, {
  maxKeys: 6,
});

/**
 * Raw scene JSON, biased toward shapes `validTimeline` actually accepts
 * (real preset ids, in-range starts) — an unbiased `fc.jsonValue()` would
 * almost never produce a scene at all (`validTimeline` requires id/presetId/
 * start to all line up), which is exactly the vacuity trap
 * featurePipelineFuzz.test.ts's own header warns about for its span
 * generator. Every field independently possibly-hostile so partial damage
 * (a bad `start` on an otherwise-good scene) is as reachable as total junk.
 */
const rawSceneArb = fc.record(
  {
    id: fc.oneof(fc.uuid(), fc.constantFrom(...PROTO_KEYS), fc.string()),
    presetId: fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...REAL_PRESET_IDS) },
      { weight: 1, arbitrary: fc.string() },
    ),
    start: fc.oneof(
      { weight: 5, arbitrary: fc.double({ min: 0, max: 600, noNaN: true }) },
      { weight: 1, arbitrary: fc.constantFrom(NaN, -1, Infinity, -Infinity) },
    ),
    fadeSec: fc.oneof(fc.double({ min: 0, max: 20, noNaN: true }), fc.constant(undefined)),
    transition: fc.oneof(fc.constantFrom(...TRANSITION_KINDS), fc.constant(undefined), fc.string()),
    params: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), finiteNumberArb, {
      maxKeys: 4,
    }),
  },
  { requiredKeys: [] },
);

const rawKeyframeArb = fc.record(
  {
    id: fc.oneof(fc.uuid(), fc.constant(undefined)),
    t: fc.oneof(
      { weight: 5, arbitrary: fc.double({ min: 0, max: 600, noNaN: true }) },
      { weight: 1, arbitrary: fc.constantFrom(NaN, -1, Infinity) },
    ),
    value: fc.oneof(finiteNumberArb, fc.constant(NaN)),
    curve: fc.constantFrom("linear", "hold", "smooth", "garbage"),
  },
  { requiredKeys: [] },
);

const rawLaneArb = fc.record(
  {
    param: fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.constantFrom(...PROTO_KEYS)),
    keyframes: fc.array(rawKeyframeArb, { maxLength: 6 }),
  },
  { requiredKeys: [] },
);

const rawTimelineArb = fc.record(
  {
    enabled: fc.boolean(),
    scenes: fc.array(rawSceneArb, { maxLength: 5 }),
    lanes: fc.array(rawLaneArb, { maxLength: 4 }),
  },
  { requiredKeys: [] },
);

/** Every raw timeline goes through the REAL validator — "validated-then-
 * mutated shapes", not hand-typed Timeline objects the validator never
 * touched. */
const timelineArb = rawTimelineArb.map((raw) => validTimeline(raw));

const rawBgArb = fc.oneof(
  fc.record(
    {
      mode: fc.constantFrom(0, 1, 2, 3, 4),
      color: fc.array(finiteNumberArb, { minLength: 3, maxLength: 3 }),
    },
    { requiredKeys: [] },
  ),
  fc.record(
    {
      mode: fc.constant(BG_IMAGE),
      color: fc.array(finiteNumberArb, { minLength: 3, maxLength: 3 }),
      image: fc.record({
        assetId: fc.constantFrom("as-1", "as-missing"),
        dim: finiteNumberArb,
        blur: finiteNumberArb,
      }),
    },
    { requiredKeys: [] },
  ),
  fc.record(
    {
      mode: fc.constant(BG_VIDEO),
      color: fc.array(finiteNumberArb, { minLength: 3, maxLength: 3 }),
      video: fc.record({
        assetId: fc.constantFrom("as-1", "as-missing"),
        dim: finiteNumberArb,
        blur: finiteNumberArb,
      }),
    },
    { requiredKeys: [] },
  ),
);
const bgArb = rawBgArb.map((raw) => validBg(raw));

const paramsByPresetArb = fc
  .dictionary(fc.constantFrom(...REAL_PRESET_IDS, ...PROTO_KEYS), paramValuesArb, { maxKeys: 4 })
  .map((raw) => validParamsByPreset(raw));

function frameInputArb(): fc.Arbitrary<FrameResolveInput> {
  return fc.record({
    timeline: timelineArb,
    basePresetId: fc.oneof(
      fc.constantFrom(...REAL_PRESET_IDS),
      fc.string(),
      fc.constantFrom(...PROTO_KEYS),
    ),
    baseParams: paramValuesArb,
    baseMods: fc.constant([]),
    baseBg: bgArb,
    paramsByPreset: paramsByPresetArb,
    modsByPreset: fc.constant({}),
  });
}

/** Every numeric value in a ParamValues bag; null when all are finite. */
function firstNonFiniteParam(p: ParamValues): string | null {
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "number" && !Number.isFinite(v)) return `${k}=${v}`;
  }
  return null;
}

describe("resolveActiveFrame property fuzz: never throws", { timeout: 30_000 }, () => {
  /**
   * MUTATION-CHECKED: removed the `frame.scene` null guard (changed
   * `if (frame.scene)` to unconditional access of `frame.scene.presetId`)
   * — RED with a TypeError (`Cannot read properties of null`) on the very
   * first no-scene case. Reverted.
   */
  it("never throws, for any validated timeline and any t (including non-finite)", () => {
    fc.assert(
      fc.property(frameInputArb(), tArb, (input, t) => {
        resolveActiveFrame(input, t);
      }),
      RUNS,
    );
  });
});

describe(
  "resolveActiveFrame property fuzz: output stays finite and in-contract",
  { timeout: 30_000 },
  () => {
    /**
     * MUTATION-CHECK, HONEST RESULT — three single-guard removals tried
     * against the crossfade `mix` computation, NONE independently went red:
     * dropping the final `Math.min(1, Math.max(0, ...))` clamp, and dropping
     * the entry condition's `fade > 0` conjunct. Root cause, verified by
     * reading rather than assumed: the crossfade branch requires `scene &&
     * prev && fade > 0 && t < scene.start + fade`, and the ACTIVE `scene` is
     * selected as "the latest one starting at or before t" a few lines above
     * — i.e. `scene.start <= t` holds by construction of the selection loop
     * itself, for every scene evalTimeline can ever choose. That single fact
     * makes both the lower bound (`t - scene.start >= 0`) and, combined with
     * the entry condition's own `t < scene.start + fade`, the upper bound
     * (`(t - scene.start)/fade < 1`) hold BEFORE the clamp ever runs — the
     * clamp and the `fade > 0` guard are redundant with the surrounding
     * invariants, not merely redundant with each other, so removing either
     * one alone changes nothing reachable. Recorded as a genuine result, not
     * swept under a fabricated mutation: this property still pins something
     * real (a future change to the SELECTION invariant, e.g. loosening
     * `s.start <= t`, would surface here immediately, and the params-
     * finiteness half below IS independently meaningful), it is simply
     * over-determined rather than fragile in the current source. The one
     * mutation that DOES need this property — the scene null-guard removal —
     * is covered by the "never throws" describe block above (same
     * counterexample class, caught there first).
     */
    it("params/prev.params are always finite, mix is always 0..1, transitionKind is always a valid index", () => {
      fc.assert(
        fc.property(frameInputArb(), tArb, (input, t) => {
          const rf = resolveActiveFrame(input, t);
          const bad = firstNonFiniteParam(rf.params);
          if (bad) throw new Error(`params.${bad}`);
          if (rf.prev) {
            const prevBad = firstNonFiniteParam(rf.prev.params);
            if (prevBad) throw new Error(`prev.params.${prevBad}`);
          }
          if (!Number.isFinite(rf.mix)) throw new Error(`mix=${rf.mix}`);
          if (rf.mix < 0 || rf.mix > 1) throw new Error(`mix=${rf.mix} outside 0..1`);
          if (!Number.isInteger(rf.transitionKind)) {
            throw new Error(`transitionKind=${rf.transitionKind} not an integer`);
          }
          if (rf.transitionKind < 0 || rf.transitionKind >= TRANSITION_KINDS.length) {
            throw new Error(`transitionKind=${rf.transitionKind} out of range`);
          }
        }),
        RUNS,
      );
    });
  },
);

describe("resolveActiveFrame property fuzz: purity", { timeout: 30_000 }, () => {
  /**
   * MUTATION-CHECKED: changed `params = { ...params, ...frame.automation };`
   * to `Object.assign(params, frame.automation)` — RED: when no scene is
   * active, `params` at that point is `baseParams` BY IDENTITY (`let params
   * = baseParams;` a few lines up, never reassigned before this line), so
   * `Object.assign` mutated the caller's object in place — the fuzzed
   * `input.baseParams` snapshot no longer matched the object after the call.
   * Reverted.
   */
  it("never mutates the input's baseParams object, under any timeline/t", () => {
    fc.assert(
      fc.property(frameInputArb(), tArb, (input, t) => {
        const snapshot = { ...input.baseParams };
        resolveActiveFrame(input, t);
        expect(input.baseParams).toEqual(snapshot);
      }),
      RUNS,
    );
  });

  /**
   * The task's own named invariant for this surface: "automation spread
   * never injects non-spec keys into rendering." `AutomationLane.param` is
   * an unrestricted string (`validTimeline` slices to 64 chars, no
   * denylist), and `evalTimeline` writes `automation[lane.param] = v` where
   * `automation = Object.create(null)` — so a lane can genuinely be named
   * "__proto__" or "constructor". `params = { ...params, ...automation }`
   * then spreads that into a normal-prototype object.
   *
   * NON-VACUITY / analysis, not assumed: spread (`{...source}`) copies via
   * `CreateDataPropertyOrThrow` (`[[DefineOwnProperty]]`), never `[[Set]]` —
   * unlike `obj.__proto__ = x` or `obj["__proto__"] = x` (direct
   * assignment), which DOES invoke the inherited accessor and can reassign
   * a prototype when `x` is an object. Automation values are always
   * NUMBERS (`laneValue` returns `number | null`, and only the non-null
   * case is ever assigned), and assigning a primitive through spread's
   * `[[DefineOwnProperty]]` path can only ever create an inert OWN property
   * literally named `"__proto__"` — it cannot reassign `params`'s actual
   * prototype. Confirmed empirically, not just reasoned: this property
   * passes at 200 runs. MUTATION-CHECK: same as modMatrix's equivalent
   * proto-pollution suite, this pins behavior that is ALREADY safe by
   * construction (a Map/Object.create(null)-and-spread combination
   * mirrored across both files) — no realistic single-line mutation to
   * THIS file makes a NUMBER-valued spread pollute a prototype, for the
   * same reason removing `Object.create(null)` from `validModsByPreset`
   * (modMatrixFuzz.test.ts) needed a genuinely OBJECT-valued write to
   * demonstrate: this file never constructs one. Recorded as a verified
   * pin, not a padded mutation.
   */
  it("an automation lane named after a prototype key pollutes nothing", () => {
    const before = Object.keys(Object.prototype);
    fc.assert(
      fc.property(
        fc.constantFrom("__proto__", "constructor", "prototype", "hasOwnProperty", "toString"),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (protoParam, value, t) => {
          const tl: Timeline = {
            enabled: true,
            scenes: [],
            lanes: [{ param: protoParam, keyframes: [{ t: 0, value, curve: "hold" }] }],
          };
          const input: FrameResolveInput = {
            timeline: tl,
            basePresetId: REAL_PRESET_IDS[0],
            baseParams: { hue: 1 },
            baseMods: [],
            baseBg: { mode: 0, color: [0, 0, 0] },
            paramsByPreset: {},
            modsByPreset: {},
          };
          const rf = resolveActiveFrame(input, t);
          expect(Object.getPrototypeOf(rf.params)).toBe(Object.prototype);
          expect(Object.keys(Object.prototype)).toEqual(before);
          expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        },
      ),
      RUNS,
    );
    expect(Object.keys(Object.prototype)).toEqual(before);
  });
});

describe(
  "resolveActiveFrame property fuzz: AX-6 asset-mode background degrade",
  { timeout: 30_000 },
  () => {
    /**
     * MUTATION-CHECKED: `resolveSceneBg`'s `assetMode && sceneBg.mode !==
     * baseBg.mode` condition weakened to always-false (`false &&
     * sceneBg.mode !== baseBg.mode`) — RED: an image-asset scene bg over a
     * non-image base stopped degrading, `rf.bg.mode` stayed BG_IMAGE with no
     * texture behind it (the exact black-hole/wrong-degrade AX-6 exists to
     * prevent). Reverted.
     */
    it("an asset-mode scene bg degrades to the preset background unless the base runs the SAME asset mode", () => {
      fc.assert(
        fc.property(
          bgArb,
          bgArb,
          fc.constantFrom(...REAL_PRESET_IDS),
          (sceneBg, baseBg, presetId) => {
            const tl: Timeline = {
              enabled: true,
              scenes: [{ id: "s", name: "S", presetId, start: 0, bg: sceneBg }],
              lanes: [],
            };
            const input: FrameResolveInput = {
              timeline: tl,
              basePresetId: REAL_PRESET_IDS[0],
              baseParams: {},
              baseMods: [],
              baseBg,
              paramsByPreset: {},
              modsByPreset: {},
            };
            const rf = resolveActiveFrame(input, 1);
            const isAssetMode = sceneBg.mode === BG_IMAGE || sceneBg.mode === BG_VIDEO;
            if (isAssetMode && sceneBg.mode !== baseBg.mode) {
              if (rf.bg.mode !== BG_PRESET) {
                throw new Error(`expected degrade to BG_PRESET, got mode=${rf.bg.mode}`);
              }
            } else {
              expect(rf.bg).toEqual(sceneBg);
            }
          },
        ),
        RUNS,
      );
    });
  },
);

describe(
  "timeline property fuzz: scene selection is order-independent",
  { timeout: 30_000 },
  () => {
    /**
     * evalTimeline's own doc comment: "Order-independent: the active scene is
     * the latest one starting at or before t... Scanning by time (not array
     * order) means an unsorted scenes[] ... still resolves the right
     * crossfade source." A live drag hands the render loop exactly this
     * shape (TimelinePanel moves a dragged scene in place, re-sorts only on
     * release).
     *
     * MUTATION-CHECKED: changed evalTimeline's scene scan from
     * `s.start > scene.start` (latest-by-TIME wins) to unconditionally
     * overwriting on every iteration (`for (const s of timeline.scenes) if
     * (s.start <= t) scene = s;`, i.e. latest-by-ARRAY-POSITION wins) — RED:
     * shuffling a 3-scene timeline changed `resolveActiveFrame`'s resolved
     * `presetId` at the same `t` under the very first shuffle fast-check
     * tried. Reverted.
     */
    it("shuffling the scenes array never changes the resolved preset/params at a fixed t", () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.constantFrom(...REAL_PRESET_IDS, "extra-a", "extra-b"), {
            minLength: 2,
            maxLength: 4,
          }),
          fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 2, maxLength: 4 }),
          fc.double({ min: 0, max: 100, noNaN: true }),
          (ids, starts, t) => {
            const n = Math.min(ids.length, starts.length);
            const scenes: Scene[] = Array.from({ length: n }, (_, i) => ({
              id: `s${i}`,
              name: `S${i}`,
              presetId: presets.some((p) => p.id === ids[i]) ? ids[i] : REAL_PRESET_IDS[0],
              start: starts[i],
            }));
            const tl: Timeline = { enabled: true, scenes, lanes: [] };
            const shuffled: Timeline = { enabled: true, scenes: [...scenes].reverse(), lanes: [] };
            const a = evalTimeline(tl, t);
            const b = evalTimeline(shuffled, t);
            expect(b.scene?.id).toBe(a.scene?.id);
            expect(b.prevScene?.id).toBe(a.prevScene?.id);
            expect(b.mix).toBeCloseTo(a.mix, 10);
          },
        ),
        RUNS,
      );
    });
  },
);

describe(
  "timeline property fuzz: lane automation is order-independent",
  { timeout: 30_000 },
  () => {
    /**
     * laneValue's own doc comment: "Resolved by TIME, never by array
     * position... for the length of any drag that crosses a neighbour the
     * render loop reads an out-of-order lane" — this is the regression a
     * binary-search implementation could not survive (see the comment's own
     * account) and the property this test exists to keep pinned.
     *
     * MUTATION-CHECKED: replaced `laneValue`'s single linear pass with a
     * naive "assume sorted" version (`ks[0]`/`ks[ks.length-1]` for the pad
     * ends, a plain index walk with an early `break` on the first `kt > t`
     * for the interpolation pair) — RED: an out-of-order (post-drag-mid-swap)
     * keyframe array produced a different value than the sorted one at the
     * same t, first fast-check case. Reverted.
     */
    it("shuffling one lane's keyframes never changes laneValue at a fixed t", () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.double({ min: 0, max: 100, noNaN: true }), {
            minLength: 2,
            maxLength: 6,
          }),
          fc.array(fc.double({ min: -50, max: 50, noNaN: true }), { minLength: 2, maxLength: 6 }),
          fc.constantFrom("linear" as const, "hold" as const, "smooth" as const),
          fc.double({ min: 0, max: 100, noNaN: true }),
          (times, values, curve, t) => {
            const n = Math.min(times.length, values.length);
            const keyframes: Keyframe[] = Array.from({ length: n }, (_, i) => ({
              id: `k${i}`,
              t: times[i],
              value: values[i],
              curve,
            }));
            const lane: AutomationLane = { param: "hue", keyframes };
            const shuffledLane: AutomationLane = {
              param: "hue",
              keyframes: [...keyframes].reverse(),
            };
            const a = laneValue(lane, t);
            const b = laneValue(shuffledLane, t);
            if (a === null || b === null) throw new Error("unexpected null (non-empty keyframes)");
            expect(b).toBeCloseTo(a, 9);
          },
        ),
        RUNS,
      );
    });
  },
);
