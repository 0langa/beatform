import { describe, expect, it } from "vitest";
import type { AudioFeatures } from "../audio/types";
import { presets } from "../render/presets";
import { allParams, defaultParams, paramSpecMap, type PresetDef } from "../render/types";
import { drivenParamKeys } from "./drivenTargets";
import { resolveActiveFrame } from "./frameResolve";
import type { AutomationLane, Timeline } from "./timeline";
import { applyMods, type ModRoute } from "./modMatrix";

/**
 * The `driven` mark's derivation. The whole value of this function is that it
 * agrees with the two engines that actually move a knob — `applyMods` and
 * `resolveActiveFrame` — about which ones move. A badge that claims a knob is
 * driven while the renderer skips it is worse than no badge at all, and every
 * way that can happen (an unknown key, a `mod: "off"` spec, a disabled
 * timeline, a lane with no keyframes) is silent in every other gate.
 *
 * The two engines have DIFFERENT inert rules, which is the trap this file
 * exists to catch: `mod: "off"` stops a route dead and does not stop a lane
 * (frameResolve spreads automation over the params wholesale). Each half is
 * asserted against the real function, never against a re-implementation.
 */

const preset = (id: string): PresetDef => presets.find((p) => p.id === id)!;

const route = (param: string, over: Partial<ModRoute> = {}): ModRoute => ({
  id: `r-${param}`,
  source: "kick",
  param,
  amount: 0.5,
  ...over,
});

/** A frame with every source pinned high, so any live route provably moves. */
const FEATURES = {
  time: 1,
  bpm: 120,
  kick: 1,
  snare: 1,
  hat: 1,
  bass: 1,
  mid: 1,
  treble: 1,
  voice: 1,
  rms: 1,
  energy: 1,
  drive: 1,
  driveBeat: 1,
  width: 1,
  beatPhase: 0.5,
  barPhase: 0.5,
} as unknown as AudioFeatures;

/** The keys applyMods PROVABLY moves for these routes — the ground truth this
 *  function has to reproduce without calling the renderer. */
function keysAppliedByEngine(p: PresetDef, mods: ModRoute[]): Set<string> {
  const base = defaultParams(p);
  const out = applyMods(p, base, mods, FEATURES);
  if (out === base) return new Set();
  return new Set(Object.keys(out).filter((k) => out[k] !== base[k]));
}

/** A one-keyframe lane that provably moves `key` on `p`: its value is the
 *  factory default plus one, so "did the resolved frame change?" is decidable
 *  for every spec in the registry without knowing any of their ranges. */
const laneOn = (p: PresetDef, key: string): AutomationLane => ({
  param: key,
  keyframes: [{ id: `k-${key}`, t: 0, value: (defaultParams(p)[key] ?? 0) + 1, curve: "linear" }],
});

const timeline = (lanes: AutomationLane[], enabled = true): Timeline => ({
  enabled,
  scenes: [],
  lanes,
});

/**
 * The keys `resolveActiveFrame` — the determinism-law chokepoint both render
 * loops call — PROVABLY moves on this preset. Restricted to keys the preset
 * declares, because that is the question the mark answers: automation happily
 * carries `automation["knobOfSomeOtherMode"]` through into the params record,
 * but no uniform and no row is keyed by it.
 */
function keysMovedByTimeline(p: PresetDef, tl: Timeline, t = 3): Set<string> {
  const base = defaultParams(p);
  const rf = resolveActiveFrame(
    {
      timeline: tl,
      basePresetId: p.id,
      baseParams: base,
      baseMods: [],
      baseBg: { mode: 0, color: [0, 0, 0] },
      paramsByPreset: {},
      modsByPreset: {},
    },
    t,
  );
  const specs = paramSpecMap(p);
  return new Set(Object.keys(rf.params).filter((k) => specs.has(k) && rf.params[k] !== base[k]));
}

describe("drivenParamKeys", () => {
  it("D1: names the param a live route drives", () => {
    const p = preset("spectrum-bars");
    expect([...drivenParamKeys(p, [route("hue")])]).toEqual(["hue"]);
  });

  it('D2: a route to a mod:"off" param is NOT driven — applyMods skips it', () => {
    // R-5. `mirror` is a pure on/off toggle; modulating it could only strobe,
    // so the target lists never offer it and applyMods `continue`s past any
    // route an old document still carries. The mark must agree.
    const p = preset("spectrum-bars");
    const mods = [route("mirror")];
    expect(drivenParamKeys(p, mods).size).toBe(0);
    expect(keysAppliedByEngine(p, mods).size).toBe(0);
  });

  it("D3: a route to a param of a DIFFERENT preset is not driven here", () => {
    // R-5's other half. Routes are stored per preset id, but a document can be
    // reopened against an edited registry, and every preset shares the same
    // route shape — the key simply does not resolve, exactly as in applyMods.
    const p = preset("spectrum-bars");
    const mods = [route("__not-a-param-of-anything")];
    expect(drivenParamKeys(p, mods).size).toBe(0);
    expect(keysAppliedByEngine(p, mods).size).toBe(0);
  });

  it('D4: a "post:" route is excluded — those are not preset params', () => {
    // post targets are applied by applyPostMods against PostSettings and never
    // pass through ParamGroups; marking them is the Scene page's job. They fall
    // out through the same "no spec" rule as D3, not a special case.
    const p = preset("spectrum-bars");
    const mods = [route("post:chromatic"), route("hue")];
    expect([...drivenParamKeys(p, mods)]).toEqual(["hue"]);
  });

  it("D5: reports the union, once per key, across stacked and multiple routes", () => {
    const p = preset("spectrum-bars");
    const mods = [
      route("hue", { id: "a" }),
      route("hue", { id: "b", source: "rms", amount: -0.3 }),
      route("mirror", { id: "c" }),
      route("saturation", { id: "d", source: "bass" }),
    ];
    const driven = drivenParamKeys(p, mods);
    expect([...driven].sort()).toEqual(["hue", "saturation"]);
  });

  it("D6: agrees with applyMods across every built-in preset", () => {
    // The standing guard on the two implementations drifting. One route per
    // modulatable-looking key on every preset: whatever applyMods moves, the
    // mark claims, and nothing else.
    for (const p of presets) {
      const mods = [...p.params, ...(p.advanced ?? [])].map((s, i) =>
        route(s.key, { id: `${p.id}-${i}`, amount: 1 }),
      );
      const claimed = [...drivenParamKeys(p, mods)].sort();
      const applied = [...keysAppliedByEngine(p, mods)].sort();
      // applyMods only MOVES a key when amount x range is non-zero and the
      // value is not already pinned at the clamp edge, so `applied` is a subset
      // of `claimed`; what must never happen is a claim the engine skips by
      // rule. Both directions are checked with the two inert rules removed.
      const inert = new Set(
        [...p.params, ...(p.advanced ?? [])].filter((s) => s.mod === "off").map((s) => s.key),
      );
      for (const key of claimed) expect(inert.has(key)).toBe(false);
      for (const key of applied) expect(claimed).toContain(key);
    }
  });

  it("D7: no routes returns a stable empty set, allocating nothing", () => {
    // The mark is derived in a useMemo whose deps include the route array; a
    // fresh Set per call would be a new prop identity on every preset switch.
    const p = preset("spectrum-bars");
    expect(drivenParamKeys(p, [])).toBe(drivenParamKeys(p, []));
    expect(drivenParamKeys(p, [route("post:bloom")])).toBe(drivenParamKeys(p, []));
  });

  it("D8: the third argument is optional and defaults to the mods-only reading", () => {
    // H11 widened the signature; every pre-H11 call site and test above still
    // means exactly what it meant, and an omitted timeline is not "enabled".
    const p = preset("spectrum-bars");
    expect([...drivenParamKeys(p, [route("hue")])]).toEqual([
      ...drivenParamKeys(p, [route("hue")], { enabled: false, lanes: [laneOn(p, "size")] }),
    ]);
  });

  it("D9 (H12): a muted route is NOT driven — applyMods skips it", () => {
    const p = preset("spectrum-bars");
    const mods = [route("hue", { muted: true })];
    expect(drivenParamKeys(p, mods).size).toBe(0);
    expect(keysAppliedByEngine(p, mods).size).toBe(0);
    // A mixed stack: only the live route's target is driven.
    const stacked = [route("hue", { id: "a", muted: true }), route("hue", { id: "b" })];
    expect([...drivenParamKeys(p, stacked)]).toEqual(["hue"]);
  });
});

/**
 * H11 — the same mark for timeline automation lanes. The vocabulary was chosen
 * for this in v2.83.0 ("driven", not "modulated"), so nothing renamed; what had
 * to be got right is WHICH lanes count, and the answer comes from
 * `frameResolve.ts`, never from TimelinePanel.
 */
describe("drivenParamKeys: automation lanes", () => {
  it("L1: names the param an enabled lane drives, and resolveActiveFrame agrees", () => {
    const p = preset("spectrum-bars");
    const tl = timeline([laneOn(p, "hue")]);
    expect([...drivenParamKeys(p, [], tl)]).toEqual(["hue"]);
    expect([...keysMovedByTimeline(p, tl)]).toEqual(["hue"]);
  });

  it("L2: a lane still drives OUTSIDE its keyframe range — laneValue pads both ends", () => {
    // Why the mark is time-independent: a single keyframe at t=0 pins the param
    // for the whole track, so there is no "before the automation starts" window
    // in which the slider is telling the truth.
    const p = preset("spectrum-bars");
    const tl = timeline([
      {
        param: "hue",
        keyframes: [
          { id: "a", t: 10, value: defaultParams(p).hue + 1, curve: "linear" },
          { id: "b", t: 20, value: defaultParams(p).hue + 2, curve: "linear" },
        ],
      },
    ]);
    expect([...drivenParamKeys(p, [], tl)]).toEqual(["hue"]);
    expect([...keysMovedByTimeline(p, tl, 0)]).toEqual(["hue"]);
    expect([...keysMovedByTimeline(p, tl, 999)]).toEqual(["hue"]);
  });

  it('L3: a lane on a mod:"off" param IS driven — the rule that stops a ROUTE does not stop a lane', () => {
    // The asymmetry, and the whole reason this function could not just forward
    // lanes into the modulation loop. `mirror` is `mod: "off"` so applyMods
    // skips it (D2) — but frameResolve spreads `automation` over the resolved
    // params with no spec check at all, and TimelinePanel offers every param of
    // the mode as a lane target, this one included. It moves; say so.
    const p = preset("spectrum-bars");
    expect(paramSpecMap(p).get("mirror")?.mod).toBe("off");
    const tl = timeline([laneOn(p, "mirror")]);
    expect([...drivenParamKeys(p, [], tl)]).toEqual(["mirror"]);
    expect([...keysMovedByTimeline(p, tl)]).toEqual(["mirror"]);
    // …while the route to the same knob is still inert, in the same call.
    expect([...drivenParamKeys(p, [route("mirror")], tl)]).toEqual(["mirror"]);
    expect(keysAppliedByEngine(p, [route("mirror")]).size).toBe(0);
  });

  it("L4: lanes of a DISABLED timeline are inert — evalTimeline's first line", () => {
    // The master switch in the timeline toolbar. A project can carry a dozen
    // tuned lanes and render none of them; the mark has to disappear with them.
    const p = preset("spectrum-bars");
    const tl = timeline([laneOn(p, "hue")], false);
    expect(drivenParamKeys(p, [], tl).size).toBe(0);
    expect(keysMovedByTimeline(p, tl).size).toBe(0);
  });

  it("L5: a lane with no keyframes is inert — laneValue returns null", () => {
    // validTimeline drops these on load, but `setTimeline` takes any Timeline
    // (themes, tests, future callers) and laneValue's own guard is the rule
    // that actually decides. Mirroring it here costs one line.
    const p = preset("spectrum-bars");
    const tl = timeline([{ param: "hue", keyframes: [] }]);
    expect(drivenParamKeys(p, [], tl).size).toBe(0);
    expect(keysMovedByTimeline(p, tl).size).toBe(0);
  });

  it("L6: a lane for a param of a DIFFERENT mode marks nothing here", () => {
    // Lanes are global to the timeline while routes are per preset, so this is
    // the common case rather than the corner one: switch modes and every lane
    // whose key the new mode does not declare has no row to mark. frameResolve
    // does carry the value through — it just lands on nothing.
    const p = preset("spectrum-bars");
    const tl = timeline([laneOn(p, "__not-a-param-of-anything")]);
    expect(drivenParamKeys(p, [], tl).size).toBe(0);
    expect(keysMovedByTimeline(p, tl).size).toBe(0);
    expect(paramSpecMap(p).has("__not-a-param-of-anything")).toBe(false);
  });

  it("L7: routes and lanes are one union, counted once per key", () => {
    const p = preset("spectrum-bars");
    // `hue` is under both a route and a lane — one entry, because the mark is a
    // fact about the knob and not a count of what is pointed at it.
    const tl = timeline([laneOn(p, "hue"), laneOn(p, "glow")]);
    const driven = drivenParamKeys(p, [route("hue"), route("saturation")], tl);
    expect([...driven].sort()).toEqual(["glow", "hue", "saturation"]);
  });

  it("L8: no routes and no live lanes returns the same stable empty set", () => {
    // D7's contract, unchanged by the third argument: this is a useMemo result
    // handed to ParamGroups as a prop, and a fresh Set per call would be a new
    // identity on every store notification the panel hears.
    const p = preset("spectrum-bars");
    const none = drivenParamKeys(p, []);
    expect(drivenParamKeys(p, [], timeline([]))).toBe(none);
    expect(drivenParamKeys(p, [], timeline([laneOn(p, "hue")], false))).toBe(none);
    expect(drivenParamKeys(p, [], timeline([{ param: "hue", keyframes: [] }]))).toBe(none);
  });

  it("L9: agrees with resolveActiveFrame across every built-in preset", () => {
    // The standing guard on the lane half drifting from the chokepoint, the way
    // D6 is for the modulation half. Exact equality in BOTH directions is
    // available here where D6 only gets a subset: automation writes the value
    // straight in, with no amount, no range and no clamp to lose it to.
    for (const p of presets) {
      const lanes = allParams(p).map((s) => laneOn(p, s.key));
      lanes.push(laneOn(p, "__not-a-param-of-anything"));
      const tl = timeline(lanes);
      expect([...drivenParamKeys(p, [], tl)].sort()).toEqual(
        [...keysMovedByTimeline(p, tl)].sort(),
      );
    }
  });
});
