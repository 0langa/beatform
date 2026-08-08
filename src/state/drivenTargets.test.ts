import { describe, expect, it } from "vitest";
import type { AudioFeatures } from "../audio/types";
import { presets } from "../render/presets";
import { defaultParams, type PresetDef } from "../render/types";
import { drivenParamKeys } from "./drivenTargets";
import { applyMods, type ModRoute } from "./modMatrix";

/**
 * The `driven` mark's derivation. The whole value of this function is that it
 * agrees with `applyMods` about which knobs actually move — a badge that
 * claims a knob is driven while the renderer skips the route is worse than no
 * badge at all, and both of the ways that can happen (an unknown key, a
 * `mod: "off"` spec) are silent in every other gate.
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
});
