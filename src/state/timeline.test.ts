import { describe, expect, it } from "vitest";
import { evalTimeline, laneValue, validTimeline, type Timeline } from "./timeline";
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
