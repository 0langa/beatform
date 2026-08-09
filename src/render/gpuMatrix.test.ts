import { describe, expect, it } from "vitest";
import {
  BUILDER_FACTORY_STACKS,
  currentBuilder2Def,
  currentBuilderStack,
  defaultBuilderStack,
  newLayer,
  packBuilderParams,
  rebuildBuilder2,
  sameF32,
  type BuilderStack,
} from "./builder2";
import { runBuilderStackCases, type GpuPixelCase } from "./gpuMatrix";

/**
 * G6 — the GPU matrix's Builder leg BORROWS module state. `rebuildBuilder2`
 * writes the global the live render loop packs against, and the leg used to
 * hand back `defaultBuilderStack()` instead of whatever it took: run
 * `window.__runGpuMatrix()` with an edited Builder and the render layer was
 * left describing a stack the document no longer had.
 *
 * A default starting stack proves nothing here — the bug IS "it always
 * restores the default" — so every case below starts from an edited stack
 * whose structure no factory stack shares.
 *
 * The pixel matrix itself needs a real GPU and is a device gate; what is
 * testable in Node is exactly the contract this leg owes its caller.
 */

/** Enough of a case for the leg to stitch an id onto — pixels are the device
 *  gate's business, not this file's. */
const PROBE: Omit<GpuPixelCase, "id"> = {
  hash: "00000000",
  signature: "",
  meanLuma: 0,
  litFraction: 0,
};

/** An edited Builder: two layers, non-default values, and a structure key
 *  (`orb.normal|waveline.screen`) that none of the factory stacks mint — so a
 *  restored def cannot be one the loop happened to leave behind. */
function editedStack(): BuilderStack {
  return {
    layers: [
      { ...newLayer("orb"), hue: 12, opacity: 0.42 },
      { ...newLayer("waveline"), blend: "screen" as const, hueSpread: 7 },
    ],
  };
}

/** The four renderer methods the leg drives, plus a record of what it saw. */
function stubRenderer() {
  const packs: Float32Array[] = [];
  const stacksSeen: BuilderStack[] = [];
  return {
    setPreset: () => {
      // Sampled here rather than after the run: this is the proof the leg
      // actually re-pointed the module, without which "restored" is vacuous.
      stacksSeen.push(currentBuilderStack());
    },
    setBuilderParams: (data: Float32Array) => {
      packs.push(data);
    },
    render: () => {},
    gpuDone: async () => undefined,
    packs,
    stacksSeen,
  };
}

describe("builder factory-stack leg", () => {
  it("hands back the stack it borrowed, not the default one", async () => {
    const start = editedStack();
    const startDef = rebuildBuilder2(start);
    const renderer = stubRenderer();

    const cases = await runBuilderStackCases(renderer, async () => PROBE);

    expect(cases.map((c) => c.id)).toEqual(
      BUILDER_FACTORY_STACKS.map((f) => `builder2/stack/${f.id}`),
    );
    expect(renderer.stacksSeen).toHaveLength(BUILDER_FACTORY_STACKS.length);
    renderer.stacksSeen.forEach((seen, i) => {
      expect(seen).toBe(BUILDER_FACTORY_STACKS[i].stack);
    });

    // Both halves of the module global: the stack services.ts packs against
    // every frame, and the def object identity the render loop and the
    // pipeline cache key on.
    expect(currentBuilderStack()).toBe(start);
    expect(currentBuilder2Def()).toBe(startDef);
  });

  it("hands the stack back even when a case blows up", async () => {
    const start = editedStack();
    rebuildBuilder2(start);

    await expect(
      runBuilderStackCases(stubRenderer(), async () => {
        throw new Error("pixel read failed");
      }),
    ).rejects.toThrow("pixel read failed");

    expect(currentBuilderStack()).toBe(start);
  });

  it("leaves the renderer's builder buffer on the pack that seeded the run", async () => {
    rebuildBuilder2(editedStack());
    const renderer = stubRenderer();

    await runBuilderStackCases(renderer, async () => PROBE);

    // Deliberately NOT the borrowed stack: runGpuPixelMatrix seeds this
    // buffer with the default pack before the first case, so handing back
    // anything else would change what every later case in the run renders
    // through — i.e. move baseline hashes.
    const last = renderer.packs[renderer.packs.length - 1];
    expect(sameF32(last, packBuilderParams(defaultBuilderStack()))).toBe(true);
  });
});
