import { describe, expect, it } from "vitest";
import {
  BUILDER2_DEF_CACHE_MAX,
  BUILDER_LAYER_TYPES,
  newLayer,
  rebuildBuilder2,
  stackStructureKey,
  type BuilderBlend,
  type BuilderStack,
} from "./builder2";

const BLENDS: BuilderBlend[] = ["normal", "add", "screen"];
/** Distinct (type, blend) pairs available for one layer. */
const SHAPES = BUILDER_LAYER_TYPES.length * BLENDS.length;

function layerAt(k: number) {
  return {
    ...newLayer(BUILDER_LAYER_TYPES[k % BUILDER_LAYER_TYPES.length].type),
    blend: BLENDS[Math.floor(k / BUILDER_LAYER_TYPES.length) % BLENDS.length],
  };
}

/**
 * A stack with a structure key unique to `n`. TWO layers on purpose: one layer
 * only spans 27 shapes, and these tests share module state, so a single-layer
 * encoding would let one test's indices wrap onto another's cache entries.
 */
function stackAt(n: number): BuilderStack {
  return { layers: [layerAt(n % SHAPES), layerAt(Math.floor(n / SHAPES) % SHAPES)] };
}

describe("builder2 def cache", () => {
  it("mints a distinct structure key per stack shape", () => {
    const keys = new Set(Array.from({ length: 300 }, (_, i) => stackStructureKey(stackAt(i))));
    expect(keys.size).toBe(300);
  });

  it("reuses the compiled def for a structure it has seen (the M5 lesson)", () => {
    const a = rebuildBuilder2(stackAt(0));
    const b = rebuildBuilder2(stackAt(1));
    expect(rebuildBuilder2(stackAt(0))).toBe(a);
    expect(rebuildBuilder2(stackAt(1))).toBe(b);
  });

  it("does not recompile when only VALUES change", () => {
    // Per-instance params live in the storage buffer, so a tweak must not
    // change the def's object identity — that identity is what drives the
    // render loop's recompile.
    const stack = stackAt(2);
    const first = rebuildBuilder2(stack);
    const tweaked: BuilderStack = {
      layers: [
        { ...stack.layers[0], opacity: 0.3, hue: 12, params: { glow: 0.9 } },
        { ...stack.layers[1], enabled: false },
      ],
    };
    expect(rebuildBuilder2(tweaked)).toBe(first);
  });

  it("is BOUNDED — an evicted structure recompiles to a NEW def", () => {
    // The renderer's pipeline cache is a WeakMap on purpose: an unbounded Map
    // here strong-references every structure compiled this session, so an
    // edited preset's GPUShaderModule + pipelines could never be collected.
    const first = rebuildBuilder2(stackAt(100));
    for (let i = 101; i <= 100 + BUILDER2_DEF_CACHE_MAX; i++) rebuildBuilder2(stackAt(i));
    const again = rebuildBuilder2(stackAt(100));
    expect(again).not.toBe(first);
    expect(again.wgsl).toBe(first.wgsl); // same code, freshly compiled def
  });

  it("evicts least-RECENTLY-used, not least-recently-inserted", () => {
    const keep = rebuildBuilder2(stackAt(200));
    // Fill the rest of the cache, then touch `keep` so it is the newest entry.
    for (let i = 201; i < 200 + BUILDER2_DEF_CACHE_MAX; i++) rebuildBuilder2(stackAt(i));
    expect(rebuildBuilder2(stackAt(200))).toBe(keep);
    // One more structure evicts something — and it must not be the shape the
    // user keeps coming back to.
    rebuildBuilder2(stackAt(200 + BUILDER2_DEF_CACHE_MAX));
    expect(rebuildBuilder2(stackAt(200))).toBe(keep);
  });
});
