import { describe, expect, it } from "vitest";
import {
  applyVirtualValues,
  BUILDER_FACTORY_STACKS,
  builderStackValues,
  builderVirtualGroups,
  builderVirtualParams,
  copyBuilderStack,
  defaultBuilderStack,
  isBuilderVirtualKey,
  newLayer,
  packBuilderFrame,
  packBuilderParams,
  rebuildBuilder2,
  sameF32,
  sameStackValues,
  validBuilderStack,
  LAYER_SLOTS,
  type BuilderStack,
} from "./builder2";
import { applyMods, type ModRoute } from "../state/modMatrix";
import { allParams, defaultParams, paramSpecMap } from "./types";
import type { AudioFeatures } from "../audio/types";

/**
 * RP-20, the Builder bridge: the compiled builder2 def carries a virtual
 * ParamSpec per storage slot (`l<i>.opacity|hue|hueSpread|<paramKey>`), the
 * store mirrors stack values into paramsByPreset["builder2"], and BOTH render
 * loops overlay the per-frame resolved record onto the stack pack through ONE
 * shared helper (packBuilderFrame). These tests pin the generated spec list,
 * the mirror, the overlay — including the default-neutrality byte-identity
 * proof — and the factory stacks.
 */

/** The default stack's layer types, for readable expectations below. */
const DEFAULT_TYPES = ["wash", "stars", "bars", "rings"];

function silentFeatures(over: Partial<AudioFeatures> = {}): AudioFeatures {
  return {
    rms: 0,
    energy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    voice: 0,
    drive: 0,
    driveBeat: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    width: 0,
    lufs: -70,
    beatPhase: 0,
    barPhase: 0,
    bpm: 0,
    time: 0,
    bins: new Float32Array(96),
    peaks: new Float32Array(96),
    waveform: new Float32Array(256),
    waveformL: new Float32Array(256),
    waveformR: new Float32Array(256),
    ...over,
  } as AudioFeatures;
}

describe("virtual ParamSpec generation", () => {
  it("emits the exact key list for the default stack, in slot order", () => {
    const keys = builderVirtualParams(defaultBuilderStack()).map((p) => p.key);
    expect(keys).toEqual([
      // wash
      "l0.opacity",
      "l0.hue",
      "l0.hueSpread",
      "l0.glow",
      "l0.flash",
      // stars
      "l1.opacity",
      "l1.hue",
      "l1.hueSpread",
      "l1.density",
      "l1.speed",
      "l1.streak",
      // bars
      "l2.opacity",
      "l2.hue",
      "l2.hueSpread",
      "l2.height",
      "l2.gap",
      "l2.glow",
      "l2.peaks",
      // rings
      "l3.opacity",
      "l3.hue",
      "l3.hueSpread",
      "l3.start",
      "l3.end",
      "l3.sharp",
      "l3.bright",
    ]);
    expect(DEFAULT_TYPES).toEqual(defaultBuilderStack().layers.map((l) => l.type));
  });

  it("defaults are the newLayer defaults (opacity 1, hue 210, spread 90, spec defaults)", () => {
    const specs = builderVirtualParams(defaultBuilderStack());
    const byKey = new Map(specs.map((p) => [p.key, p]));
    expect(byKey.get("l0.opacity")?.default).toBe(1);
    expect(byKey.get("l0.hue")?.default).toBe(210);
    expect(byKey.get("l0.hueSpread")?.default).toBe(90);
    expect(byKey.get("l0.glow")?.default).toBe(0.5);
    expect(byKey.get("l2.height")?.default).toBe(0.5);
  });

  it("hue is a hue control with a full-turn range; step-1 counts snap; nothing is mod:off", () => {
    const specs = builderVirtualParams(defaultBuilderStack());
    const byKey = new Map(specs.map((p) => [p.key, p]));
    const hue = byKey.get("l1.hue")!;
    expect(hue.control).toBe("hue");
    expect([hue.min, hue.max]).toEqual([0, 360]);
    // Step-1 counts/toggles quantize applied modulation (RP-2 law).
    expect(byKey.get("l1.density")?.mod).toBe("snap");
    expect(byKey.get("l2.peaks")?.mod).toBe("snap");
    // Continuous params keep the default smooth behaviour, and nothing opts
    // out entirely — every slot stays a modulation target.
    expect(byKey.get("l0.glow")?.mod).toBeUndefined();
    expect(specs.some((p) => p.mod === "off")).toBe(false);
  });

  it("labels read as 'L<n> <Type> · <Param>' and groups resolve per layer", () => {
    const specs = builderVirtualParams(defaultBuilderStack());
    const byKey = new Map(specs.map((p) => [p.key, p]));
    expect(byKey.get("l0.glow")?.label).toBe("L1 Background wash · Glow");
    expect(byKey.get("l2.peaks")?.label).toBe("L3 Spectrum bars · Peak caps");
    const groups = builderVirtualGroups(defaultBuilderStack());
    expect(groups.map((g) => g.id)).toEqual(["l0", "l1", "l2", "l3"]);
    expect(groups[2].label).toBe("Layer 3 · Spectrum bars");
    // Every spec lands in a declared group (paramModel's registry law).
    const groupIds = new Set(groups.map((g) => g.id));
    for (const p of specs) expect(groupIds.has(p.group ?? "")).toBe(true);
  });

  it("the compiled def carries the virtual list; value edits reuse the def, structural edits mint a new one", () => {
    const stack = defaultBuilderStack();
    const def = rebuildBuilder2(stack);
    expect(def.params.map((p) => p.key)).toEqual(builderVirtualParams(stack).map((p) => p.key));
    // Value edit: same def object -> the types.ts WeakMap caches stay valid.
    const tweaked: BuilderStack = {
      layers: stack.layers.map((l, i) => (i === 0 ? { ...l, opacity: 0.4, hue: 99 } : l)),
    };
    expect(rebuildBuilder2(tweaked)).toBe(def);
    expect(allParams(rebuildBuilder2(tweaked))).toBe(allParams(def));
    // Structural edit: a new def whose virtual list reflects the new layer.
    const grown: BuilderStack = { layers: [...stack.layers, newLayer("vignette")] };
    const def2 = rebuildBuilder2(grown);
    expect(def2).not.toBe(def);
    expect(def2.params.map((p) => p.key)).toContain("l4.amount");
    rebuildBuilder2(defaultBuilderStack());
  });
});

describe("mirror + virtual value routing", () => {
  it("builderStackValues mirrors the stack's raw values, defaults included", () => {
    expect(builderStackValues(defaultBuilderStack())).toEqual(
      defaultParams(rebuildBuilder2(defaultBuilderStack())),
    );
    const stack = defaultBuilderStack();
    stack.layers[0] = { ...stack.layers[0], opacity: 0.3, params: { glow: 0.9, flash: 0.1 } };
    const mirror = builderStackValues(stack);
    expect(mirror["l0.opacity"]).toBe(0.3);
    expect(mirror["l0.glow"]).toBe(0.9);
  });

  it("applyVirtualValues patches the addressed layer, clamped to the spec range", () => {
    const stack = defaultBuilderStack();
    const { stack: out, applied } = applyVirtualValues(stack, {
      "l0.glow": 0.8,
      "l1.hue": 400, // clamps to 360
      "l2.opacity": -1, // clamps to 0
    });
    expect(applied).toBe(3);
    expect(out).not.toBe(stack);
    expect(out.layers[0].params.glow).toBe(0.8);
    expect(out.layers[1].hue).toBe(360);
    expect(out.layers[2].opacity).toBe(0);
    // Untouched layers keep their object identity.
    expect(out.layers[3]).toBe(stack.layers[3]);
  });

  it("keys that don't resolve are dropped, and a no-op returns the SAME stack", () => {
    const stack = defaultBuilderStack();
    const { stack: out, applied } = applyVirtualValues(stack, {
      "l9.glow": 1, // no such layer
      "l0.nope": 1, // no such param on wash
      hue: 120, // not a virtual key at all
    });
    expect(applied).toBe(0);
    expect(out).toBe(stack);
    expect(isBuilderVirtualKey("l0.glow")).toBe(true);
    expect(isBuilderVirtualKey("hue")).toBe(false);
  });
});

describe("packBuilderFrame — the shared per-frame chokepoint", () => {
  it("DEFAULT NEUTRALITY: default stack + untouched mirror packs BYTE-IDENTICAL to packBuilderParams", () => {
    const stack = defaultBuilderStack();
    const baseline = packBuilderParams(stack);
    // The mirror record (what baseOf() resolves with no mods/automation)…
    const viaMirror = packBuilderFrame(stack, builderStackValues(stack));
    // …and the def-defaults record (a fresh document) must both be inert.
    const viaDefaults = packBuilderFrame(stack, defaultParams(rebuildBuilder2(stack)));
    expect(new Uint8Array(viaMirror.buffer)).toEqual(new Uint8Array(baseline.buffer));
    expect(new Uint8Array(viaDefaults.buffer)).toEqual(new Uint8Array(baseline.buffer));
    expect(sameF32(viaMirror, baseline)).toBe(true);
  });

  it("overlays exactly the addressed slots", () => {
    const stack = defaultBuilderStack();
    const baseline = packBuilderParams(stack);
    const packed = packBuilderFrame(stack, {
      ...builderStackValues(stack),
      "l0.glow": 0.9, // wash glow = layer 0, type-param slot 0 -> slot 3
      "l3.hue": 10, // rings hue -> layer 3 slot 1
    });
    const diffs: number[] = [];
    for (let i = 0; i < packed.length; i++) if (packed[i] !== baseline[i]) diffs.push(i);
    expect(diffs).toEqual([3, 3 * LAYER_SLOTS + 1]);
    expect(packed[3]).toBeCloseTo(0.9);
    expect(packed[3 * LAYER_SLOTS + 1]).toBe(10);
  });

  it("a muted layer stays muted no matter what the record says", () => {
    const stack = defaultBuilderStack();
    stack.layers[1] = { ...stack.layers[1], enabled: false };
    const packed = packBuilderFrame(stack, {
      ...builderStackValues(stack),
      "l1.opacity": 1,
    });
    expect(packed[LAYER_SLOTS]).toBe(0); // slot 0 of layer 1 = effective opacity
  });

  it("modulated values flow record -> pack (live and export share this exact path)", () => {
    const stack = defaultBuilderStack();
    const def = rebuildBuilder2(stack);
    const routes: ModRoute[] = [{ id: "r1", source: "kick", param: "l0.glow", amount: 1 }];
    const base = builderStackValues(stack);
    const modded = applyMods(def, base, routes, silentFeatures({ kick: 1 }));
    // kick=1, amount 1 over glow's 0..1 range from default 0.5 -> clamps to 1.
    expect(modded["l0.glow"]).toBe(1);
    const packed = packBuilderFrame(stack, modded);
    expect(packed[3]).toBe(1);
    // Identical inputs -> identical bytes, regardless of which loop calls:
    // this IS the preview/export parity argument, made executable.
    expect(sameF32(packed, packBuilderFrame(stack, modded))).toBe(true);
    // Snap metadata rides the same chokepoint: density (step 1) rounds.
    const specs = paramSpecMap(def);
    expect(specs.get("l1.density")?.mod).toBe("snap");
    const snapped = applyMods(
      def,
      base,
      [{ id: "r2", source: "kick", param: "l1.density", amount: 0.17 }],
      silentFeatures({ kick: 1 }),
    );
    expect(Number.isInteger(snapped["l1.density"])).toBe(true);
  });
});

describe("factory stacks", () => {
  it("ships 4-6 stacks with unique ids and names; the first ≙ the default stack", () => {
    expect(BUILDER_FACTORY_STACKS.length).toBeGreaterThanOrEqual(4);
    expect(BUILDER_FACTORY_STACKS.length).toBeLessThanOrEqual(6);
    const ids = BUILDER_FACTORY_STACKS.map((f) => f.id);
    const names = BUILDER_FACTORY_STACKS.map((f) => f.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(BUILDER_FACTORY_STACKS[0].id).toBe("classic");
    expect(sameStackValues(BUILDER_FACTORY_STACKS[0].stack, defaultBuilderStack())).toBe(true);
  });

  it("every factory stack passes validBuilderStack unchanged", () => {
    for (const f of BUILDER_FACTORY_STACKS) {
      // validBuilderStack clamps/normalizes untrusted input — a factory stack
      // must already be exactly the normalized form (values in range, every
      // spec param present), or applying it would render differently from
      // what shipped.
      expect(validBuilderStack(structuredClone(f.stack)), f.id).toEqual(f.stack);
    }
  });

  it("no two factory stacks resolve to the same look", () => {
    for (let i = 0; i < BUILDER_FACTORY_STACKS.length; i++) {
      for (let j = i + 1; j < BUILDER_FACTORY_STACKS.length; j++) {
        expect(
          sameStackValues(BUILDER_FACTORY_STACKS[i].stack, BUILDER_FACTORY_STACKS[j].stack),
          `${BUILDER_FACTORY_STACKS[i].id} duplicates ${BUILDER_FACTORY_STACKS[j].id}`,
        ).toBe(false);
      }
    }
  });

  it("copyBuilderStack mints fresh ids but keeps the look (active-chip contract)", () => {
    const f = BUILDER_FACTORY_STACKS[1];
    const copy = copyBuilderStack(f.stack);
    expect(sameStackValues(copy, f.stack)).toBe(true);
    for (let i = 0; i < copy.layers.length; i++) {
      expect(copy.layers[i].id).not.toBe(f.stack.layers[i].id);
      expect(copy.layers[i].params).not.toBe(f.stack.layers[i].params);
    }
  });
});
