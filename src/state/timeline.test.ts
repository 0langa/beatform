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
    expect(evalTimeline(off, 35)).toEqual({ scene: null, automation: {} });
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
});
