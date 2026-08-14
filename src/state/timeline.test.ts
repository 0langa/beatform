import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  deriveTimelineEnabled,
  evalTimeline,
  laneValue,
  validTimeline,
  type AutomationLane,
  type Keyframe,
  type Timeline,
} from "./timeline";
import { presets } from "../render/presets";

const P0 = presets[0].id;
const P1 = presets[1].id;

const timeline: Timeline = {
  enabled: true,
  scenes: [
    { id: "a", name: "Intro", presetId: P0, start: 0 },
    { id: "b", name: "Drop", presetId: P1, start: 30, params: { intensity: 1 } },
  ],
  lanes: [
    {
      param: "hue",
      keyframes: [
        { t: 0, value: 100, curve: "linear" },
        { t: 10, value: 200, curve: "smooth" },
        { t: 20, value: 200, curve: "hold" },
        { t: 25, value: 50, curve: "linear" },
      ],
    },
  ],
};

describe("timeline evaluation", () => {
  it("picks the latest scene whose start has passed", () => {
    expect(evalTimeline(timeline, 5).scene?.id).toBe("a");
    expect(evalTimeline(timeline, 30).scene?.id).toBe("b");
    expect(evalTimeline(timeline, 300).scene?.id).toBe("b");
  });

  it("returns null scene before the first scene start", () => {
    const late: Timeline = { ...timeline, scenes: [{ ...timeline.scenes[1], start: 30 }] };
    expect(evalTimeline(late, 10).scene).toBeNull();
  });

  it("interpolates linear keyframes", () => {
    expect(laneValue(timeline.lanes[0], 5)).toBeCloseTo(150, 5);
  });

  it("smooth curve eases (midpoint matches, quarter-point lags linear)", () => {
    const lane = {
      param: "x",
      keyframes: [
        { t: 10, value: 0, curve: "smooth" as const },
        { t: 20, value: 100, curve: "linear" as const },
      ],
    };
    expect(laneValue(lane, 15)).toBeCloseTo(50, 5);
    expect(laneValue(lane, 12.5)).toBeLessThan(25);
  });

  it("hold keeps the value until the next keyframe", () => {
    expect(laneValue(timeline.lanes[0], 22)).toBe(200);
    expect(laneValue(timeline.lanes[0], 24.999)).toBe(200);
    expect(laneValue(timeline.lanes[0], 25)).toBeCloseTo(50, 5);
  });

  it("pads with first/last values outside the keyframe range", () => {
    expect(laneValue(timeline.lanes[0], -5)).toBe(100);
    expect(laneValue(timeline.lanes[0], 999)).toBeCloseTo(50, 5);
  });

  it("disabled timeline evaluates to nothing", () => {
    const off = { ...timeline, enabled: false };
    expect(evalTimeline(off, 35)).toEqual({
      scene: null,
      prevScene: null,
      mix: 1,
      transitionKind: 0,
      automation: {},
    });
  });

  it("carries the scene's transition kind during its fade (linear progress for cut)", () => {
    const tl: Timeline = {
      enabled: true,
      scenes: [
        { id: "a", name: "A", presetId: "spectrum-bars", start: 0 },
        { id: "b", name: "B", presetId: "radial-burst", start: 10, fadeSec: 2, transition: "cut" },
      ],
      lanes: [],
    };
    const mid = evalTimeline(tl, 11); // halfway through the 2s fade
    expect(mid.transitionKind).toBe(6); // "cut" index
    expect(mid.mix).toBeCloseTo(0.5, 5); // linear, not eased
    expect(mid.prevScene?.id).toBe("a");
    // Outside the fade window: kind resets to 0.
    expect(evalTimeline(tl, 15).transitionKind).toBe(0);
  });

  it("crossfade: mix ramps smoothly and prevScene is the outgoing scene", () => {
    const tl: Timeline = {
      enabled: true,
      scenes: [
        { id: "a", name: "A", presetId: P0, start: 0 },
        { id: "b", name: "B", presetId: P1, start: 10, fadeSec: 2 },
      ],
      lanes: [],
    };
    const before = evalTimeline(tl, 9.9);
    expect(before.scene?.id).toBe("a");
    expect(before.prevScene).toBeNull();
    const mid = evalTimeline(tl, 11);
    expect(mid.scene?.id).toBe("b");
    expect(mid.prevScene?.id).toBe("a");
    expect(mid.mix).toBeCloseTo(0.5, 5); // smoothstep(0.5) = 0.5
    const early = evalTimeline(tl, 10.2);
    expect(early.mix).toBeLessThan(0.2);
    const after = evalTimeline(tl, 12.5);
    expect(after.prevScene).toBeNull();
    expect(after.mix).toBe(1);
  });

  it("no fadeSec means hard cut (no prevScene ever)", () => {
    expect(evalTimeline(timeline, 30.1).prevScene).toBeNull();
    expect(evalTimeline(timeline, 30.1).mix).toBe(1);
  });

  it("resolves the crossfade source by START TIME, not array order (unsorted scenes)", () => {
    // Scenes appended out of order (add C@20, then B@15) — array is [C, B].
    const unsorted: Timeline = {
      enabled: true,
      scenes: [
        { id: "c", name: "C", presetId: P0, start: 20, fadeSec: 2 },
        { id: "b", name: "B", presetId: P1, start: 15 },
      ],
      lanes: [],
    };
    const rf = evalTimeline(unsorted, 21); // inside C's fade window
    expect(rf.scene?.id).toBe("c");
    // prev must be B (the true predecessor), not null — the fade crossfades
    // FROM B even though B appears after C in the array.
    expect(rf.prevScene?.id).toBe("b");
    expect(rf.mix).toBeGreaterThan(0);
    expect(rf.mix).toBeLessThan(1);
  });

  it("automation values land keyed by param", () => {
    expect(evalTimeline(timeline, 5).automation.hue).toBeCloseTo(150, 5);
  });
});

/**
 * P-5 task 1: the "Enabled" toggle is gone from the UI — `enabled` is now
 * derived from content at every WRITE site (setTimeline/autoArrangeTimeline
 * in store.ts), never hand-set. This is the one formula both call sites
 * share. It is deliberately NOT used by `validTimeline` — see that describe
 * block below, specifically "an explicit false survives even with content"
 * (the direction that actually matters for this claim: `validTimeline`'s
 * `raw.enabled === true && hasContent` AND can trivially narrow a stray
 * `true` to `false` — "an enabled flag with no content stays disabled"
 * already pinned that half, before this task existed. PRESERVING an
 * explicit `false` against non-empty content is the other half, the one
 * this whole design leans on, and it went untested until the fix-wave
 * review caught the gap: the doc comment here used to cite the wrong one
 * of the two as evidence) — and the lane log for why load and write must
 * stay on separate rules.
 */
describe("deriveTimelineEnabled (write-time derivation, P-5)", () => {
  it("false with no scenes and no lanes", () => {
    expect(deriveTimelineEnabled({ scenes: [], lanes: [] })).toBe(false);
  });

  it("true with at least one scene, even with no lanes", () => {
    expect(
      deriveTimelineEnabled({
        scenes: [{ id: "a", name: "A", presetId: P0, start: 0 }],
        lanes: [],
      }),
    ).toBe(true);
  });

  it("true with at least one lane, even with no scenes (H11: a lane alone drives its param)", () => {
    expect(
      deriveTimelineEnabled({
        scenes: [],
        lanes: [{ param: "hue", keyframes: [{ t: 0, value: 1, curve: "linear" }] }],
      }),
    ).toBe(true);
  });

  it("true with both", () => {
    expect(deriveTimelineEnabled(timeline)).toBe(true);
  });
});

describe("timeline validation", () => {
  it("round-trips a valid timeline", () => {
    const clean = validTimeline(JSON.parse(JSON.stringify(timeline)));
    expect(clean.scenes).toHaveLength(2);
    expect(clean.lanes).toHaveLength(1);
    expect(clean.enabled).toBe(true);
  });

  it("drops scenes with unknown presets or bad starts, sorts by start", () => {
    const clean = validTimeline({
      enabled: true,
      scenes: [
        { id: "z", name: "B", presetId: P0, start: 50 },
        { id: "y", name: "A", presetId: P0, start: 10 },
        { id: "x", name: "Bad", presetId: "nope", start: 0 },
        { id: "w", name: "Neg", presetId: P0, start: -5 },
      ],
      lanes: [],
    });
    expect(clean.scenes.map((s) => s.id)).toEqual(["y", "z"]);
  });

  it("sorts keyframes and defaults bad curves to linear", () => {
    const clean = validTimeline({
      enabled: true,
      scenes: [],
      lanes: [
        {
          param: "hue",
          keyframes: [
            { t: 10, value: 2, curve: "banana" },
            { t: 0, value: 1, curve: "hold" },
          ],
        },
      ],
    });
    expect(clean.lanes[0].keyframes.map((k) => k.t)).toEqual([0, 10]);
    expect(clean.lanes[0].keyframes[1].curve).toBe("linear");
  });

  it("an enabled flag with no content stays disabled", () => {
    expect(validTimeline({ enabled: true, scenes: [], lanes: [] }).enabled).toBe(false);
  });

  it("an explicit false survives even with content — a legacy paused document stays paused on load (P-5)", () => {
    // The compat promise P-5's derived-enabled design (deriveTimelineEnabled,
    // above) rests on: a document saved with enabled:false while scenes
    // still exist on it (a user's deliberate "pause the arrangement, keep
    // the scenes") must not come back to life just because it happens to
    // load through the same validator as everything else. The formula is
    // an AND, so it can only ever narrow a stray `true` to `false` (the
    // sibling test above) — it can never resurrect an explicit `false`.
    // The obvious future refactor (validTimeline calling
    // deriveTimelineEnabled instead of keeping its own formula) would flip
    // every legacy paused document to playing on load, and no OTHER test
    // in this file would notice: this is the one that would.
    expect(
      validTimeline({
        enabled: false,
        scenes: [{ id: "a", name: "A", presetId: P0, start: 0 }],
        lanes: [],
      }).enabled,
    ).toBe(false);
  });

  it("garbage becomes the empty timeline", () => {
    expect(validTimeline("junk")).toEqual({ enabled: false, scenes: [], lanes: [] });
  });

  // L9: keyframe list keys were the array INDEX, and the editor re-sorts the
  // array by `t` on every drag release / arrow-key nudge — so crossing a
  // neighbour reshuffled indices and React reconciled the wrong DOM node
  // (and its focus) onto the wrong keyframe. Fix: keyframes carry a stable
  // `id`, backfilled here for anything that predates the field.
  it("backfills a stable, unique id for keyframes that don't have one (pre-existing schema v8 files)", () => {
    const clean = validTimeline({
      enabled: true,
      scenes: [],
      lanes: [
        {
          param: "hue",
          keyframes: [
            { t: 0, value: 1, curve: "linear" },
            { t: 10, value: 2, curve: "linear" },
          ],
        },
      ],
    });
    const ids = clean.lanes[0].keyframes.map((k) => k.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("preserves an existing keyframe id instead of replacing it", () => {
    const clean = validTimeline({
      enabled: true,
      scenes: [],
      lanes: [
        {
          param: "hue",
          keyframes: [{ id: "kf-mine", t: 0, value: 1, curve: "linear" }],
        },
      ],
    });
    expect(clean.lanes[0].keyframes[0].id).toBe("kf-mine");
  });
});

describe("prototype-key hygiene", () => {
  // Inert today (consumers only spread and Object.keys these maps), but they
  // are keyed straight off an untrusted project file, and the next consumer
  // that does `automation[key] ?? default` would read a Function instead.
  it("builds the automation map with a null prototype", () => {
    const frame = evalTimeline(timeline, 5);
    expect(Object.getPrototypeOf(frame.automation)).toBeNull();
    expect((frame.automation as Record<string, unknown>).constructor).toBeUndefined();
  });

  it("builds validated scene params with a null prototype", () => {
    const clean = validTimeline({
      enabled: true,
      scenes: [{ id: "a", presetId: P0, start: 0, params: { hue: 1 } }],
      lanes: [],
    });
    const params = clean.scenes[0].params!;
    expect(Object.getPrototypeOf(params)).toBeNull();
    expect((params as Record<string, unknown>).toString).toBeUndefined();
    // Still a plain value map for every legitimate consumer.
    expect(params.hue).toBe(1);
    expect(JSON.parse(JSON.stringify(params))).toEqual({ hue: 1 });
  });
});

/**
 * E2. `laneValue` is read by the LIVE loop every frame straight off the store's
 * timeline, and TimelinePanel publishes a dragged keyframe IN PLACE
 * (moveDragged: "no re-sort while dragging, so drag.index keeps pointing at the
 * same keyframe" — the sort happens in endDrag/onPointerCancel). So for the
 * length of any drag that crosses a neighbour the evaluator is handed an
 * out-of-order array, and the binary search it used to do could not read one:
 * the `t >= ks[last].t` end-pad tested the last keyframe BY ARRAY POSITION, so
 * the lane flat-lined on it for the whole tail of the track while the user was
 * dragging against the preview.
 *
 * Two properties, and they carry the whole fix between them: order-independence
 * (the new behaviour) and sorted-input identity (proof the fix cannot move a
 * single shipped frame — every stored lane is sorted by validTimeline).
 */
describe("laneValue resolves by time, not by array position", () => {
  /** Exactly the pre-fix implementation, kept as the identity oracle. */
  function binarySearchLaneValue(lane: AutomationLane, t: number): number | null {
    const ks = lane.keyframes;
    if (ks.length === 0) return null;
    if (t <= ks[0].t) return ks[0].value;
    if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].value;
    let lo = 0;
    let hi = ks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ks[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    const k0 = ks[lo];
    const k1 = ks[lo + 1];
    if (k0.curve === "hold") return k0.value;
    const span = Math.max(1e-9, k1.t - k0.t);
    let f = Math.min(1, Math.max(0, (t - k0.t) / span));
    if (k0.curve === "smooth") f = f * f * (3 - 2 * f);
    return k0.value + (k1.value - k0.value) * f;
  }

  const kf = (t: number, value: number, curve: Keyframe["curve"] = "linear"): Keyframe => ({
    id: `k${t}-${value}`,
    t,
    value,
    curve,
  });
  const sortedCopy = (lane: AutomationLane): AutomationLane => ({
    ...lane,
    keyframes: [...lane.keyframes].sort((a, b) => a.t - b.t),
  });

  it("the exact mid-drag array: a keyframe dragged from t=3 to t=8, not yet re-sorted", () => {
    const dragging: AutomationLane = {
      param: "hue",
      keyframes: [kf(0, 0), kf(8, 1), kf(5, 0.5)],
    };
    // The tail is what broke: before the fix every t >= 5 read 0.5 (the value
    // of whatever sat LAST in the array) instead of ramping toward 1.
    expect(laneValue(dragging, 6)).toBeCloseTo(2 / 3, 12);
    expect(laneValue(dragging, 7)).toBeCloseTo(5 / 6, 12);
    expect(laneValue(dragging, 8)).toBe(1);
    expect(laneValue(dragging, 99)).toBe(1);
    // ...and the head, which read the wrong RIGHT neighbour (8 instead of 5).
    expect(laneValue(dragging, 4)).toBeCloseTo(0.4, 12);
    // Every reading equals the sorted array's, which is the whole contract.
    for (const t of [0, 1, 4, 4.9, 5, 6, 8, 99]) {
      expect(laneValue(dragging, t)).toBe(laneValue(sortedCopy(dragging), t));
    }
  });

  it("the pre-fix implementation FAILS that array — the property is not vacuous", () => {
    const dragging: AutomationLane = {
      param: "hue",
      keyframes: [kf(0, 0), kf(8, 1), kf(5, 0.5)],
    };
    expect(binarySearchLaneValue(dragging, 6)).toBe(0.5);
    expect(binarySearchLaneValue(dragging, 6)).not.toBe(laneValue(dragging, 6));
  });

  it("the ends pad from the earliest/latest keyframe in TIME, whatever the order", () => {
    const lane: AutomationLane = { param: "x", keyframes: [kf(9, 90), kf(1, 10), kf(5, 50)] };
    expect(laneValue(lane, -1)).toBe(10);
    expect(laneValue(lane, 1)).toBe(10);
    expect(laneValue(lane, 9)).toBe(90);
    expect(laneValue(lane, 1000)).toBe(90);
  });

  /**
   * Times are drawn mostly from a TINY pool, so duplicate `t` is the common
   * case rather than a measure-zero accident of `fc.double`. Ties are the only
   * input that can tell the tie-breaking apart, and a continuous generator
   * never produces one — the property would pass while testing nothing about
   * it (mutation-checked below: flipping a tie-break makes both properties
   * fail, and with a continuous generator neither did).
   */
  const tArb = fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(0, 1, 1, 2, 2, 5, 5, 10) },
    { weight: 1, arbitrary: fc.double({ min: 0, max: 12, noNaN: true }) },
  );
  const keyframesArb = fc.array(
    fc.record({
      t: tArb,
      value: fc.double({ min: -1000, max: 1000, noNaN: true }),
      curve: fc.constantFrom("linear" as const, "hold" as const, "smooth" as const),
    }),
    { minLength: 1, maxLength: 10 },
  );
  /** Probe times that land ON the pool values as well as between them. */
  const probeArb = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(-1, 0, 0.5, 1, 1.5, 2, 5, 7, 10, 11) },
    { weight: 1, arbitrary: fc.double({ min: -2, max: 14, noNaN: true }) },
  );

  it("PROPERTY: any permutation of a lane reads exactly like its sorted form", () => {
    fc.assert(
      fc.property(
        keyframesArb.chain((ks) =>
          fc.tuple(
            fc.constant(ks),
            // A real permutation, so equal times shuffle among themselves too.
            fc.shuffledSubarray(
              ks.map((_, i) => i),
              { minLength: ks.length, maxLength: ks.length },
            ),
          ),
        ),
        probeArb,
        ([ks, order], t) => {
          const withIds = ks.map((k, i) => ({ ...k, id: `k${i}` }));
          const permuted: AutomationLane = {
            param: "x",
            keyframes: order.map((i) => withIds[i]),
          };
          expect(laneValue(permuted, t)).toBe(laneValue(sortedCopy(permuted), t));
        },
      ),
      { numRuns: 700, seed: 0x51ac_0f21 },
    );
  });

  it("PROPERTY: on SORTED input it is bit-identical to the binary search it replaced", () => {
    // The guard against this fix moving a shipped frame: validTimeline sorts
    // every stored lane, so this is the only input a saved document can have.
    fc.assert(
      fc.property(keyframesArb, probeArb, (ks, t) => {
        const lane: AutomationLane = {
          param: "x",
          keyframes: ks.map((k, i) => ({ ...k, id: `k${i}` })).sort((a, b) => a.t - b.t),
        };
        expect(laneValue(lane, t)).toBe(binarySearchLaneValue(lane, t));
      }),
      { numRuns: 700, seed: 0x51ac_0f22 },
    );
  });
});
