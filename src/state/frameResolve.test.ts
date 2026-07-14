import { describe, expect, it } from "vitest";
import { resolveActiveFrame, type FrameResolveInput } from "./frameResolve";
import type { Timeline } from "./timeline";
import { presets } from "../render/presets";

const A = presets[0].id;
const B = presets[1].id;

function baseInput(timeline: Timeline, over: Partial<FrameResolveInput> = {}): FrameResolveInput {
  return {
    timeline,
    basePresetId: A,
    baseParams: { hue: 100 },
    baseMods: [{ id: "m0", source: "bass", param: "hue", amount: 0.1 }],
    baseBg: { mode: 0, color: [0, 0, 0] },
    paramsByPreset: { [B]: { intensity: 0.7 } },
    modsByPreset: { [B]: [{ id: "m1", source: "kick", param: "intensity", amount: 0.5 }] },
    ...over,
  };
}

const OFF: Timeline = { enabled: false, scenes: [], lanes: [] };

describe("resolveActiveFrame", () => {
  it("timeline off → base preset/params/mods/bg, no fade", () => {
    const rf = resolveActiveFrame(baseInput(OFF), 10);
    expect(rf.presetId).toBe(A);
    expect(rf.params).toEqual({ hue: 100 });
    expect(rf.mods[0].id).toBe("m0");
    expect(rf.prev).toBeNull();
    expect(rf.mix).toBe(1);
  });

  it("before the first scene → still base (the stuck-preset bug is impossible)", () => {
    const tl: Timeline = {
      enabled: true,
      scenes: [{ id: "s", name: "B", presetId: B, start: 5 }],
      lanes: [],
    };
    const before = resolveActiveFrame(baseInput(tl), 2);
    expect(before.presetId).toBe(A);
    const during = resolveActiveFrame(baseInput(tl), 6);
    expect(during.presetId).toBe(B);
    // Seek back before the scene: MUST revert to base A (regression guard)
    const back = resolveActiveFrame(baseInput(tl), 2);
    expect(back.presetId).toBe(A);
  });

  it("a scene resolves its OWN preset's base params + its own mods", () => {
    const tl: Timeline = {
      enabled: true,
      scenes: [{ id: "s", name: "B", presetId: B, start: 0, params: { intensity: 1 } }],
      lanes: [],
    };
    const rf = resolveActiveFrame(baseInput(tl), 1);
    expect(rf.presetId).toBe(B);
    // defaults(B) + paramsByPreset[B]{intensity:0.7} + scene override {intensity:1}
    expect(rf.params.intensity).toBe(1);
    // B's own mods, not A's
    expect(rf.mods[0].id).toBe("m1");
    expect(rf.bg).toEqual(baseInput(tl).baseBg);
  });

  it("scene background override is applied; absent → base bg", () => {
    const withBg: Timeline = {
      enabled: true,
      scenes: [{ id: "s", name: "B", presetId: B, start: 0, bg: { mode: 1, color: [1, 0, 0] } }],
      lanes: [],
    };
    expect(resolveActiveFrame(baseInput(withBg), 1).bg).toEqual({ mode: 1, color: [1, 0, 0] });
  });

  it("automation overrides params on whichever preset is active", () => {
    const tl: Timeline = {
      enabled: true,
      scenes: [],
      lanes: [{ param: "hue", keyframes: [{ t: 0, value: 42, curve: "hold" }] }],
    };
    expect(resolveActiveFrame(baseInput(tl), 5).params.hue).toBe(42);
  });

  it("crossfade exposes prev with its own base params and the mix", () => {
    const tl: Timeline = {
      enabled: true,
      scenes: [
        { id: "a", name: "A", presetId: A, start: 0 },
        { id: "b", name: "B", presetId: B, start: 10, fadeSec: 2 },
      ],
      lanes: [],
    };
    const rf = resolveActiveFrame(baseInput(tl), 11); // mid-fade
    expect(rf.presetId).toBe(B);
    expect(rf.prev?.presetId).toBe(A);
    expect(rf.prev?.params).toEqual({ hue: 100 }); // A's base
    expect(rf.mix).toBeCloseTo(0.5, 5);
  });

  it("does not mutate the input baseParams object", () => {
    const input = baseInput({
      enabled: true,
      scenes: [],
      lanes: [{ param: "hue", keyframes: [{ t: 0, value: 9, curve: "hold" }] }],
    });
    const snapshot = { ...input.baseParams };
    resolveActiveFrame(input, 1);
    expect(input.baseParams).toEqual(snapshot);
  });
});
