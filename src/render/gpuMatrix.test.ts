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
import {
  deepCaseMetrics,
  expectedMatrixCaseIds,
  feedbackCasePresets,
  runBuilderStackCases,
  type GpuPixelCase,
} from "./gpuMatrix";
import { presets } from "./presets";
import { presetUsesFeedback } from "./webgpuRenderer";
import { TRANSITION_KINDS } from "../state/timeline";

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

/**
 * R2-16 — the enumeration, tested where no GPU is needed. runGpuPixelMatrix
 * self-checks its produced case ids against expectedMatrixCaseIds(), so
 * these tests describe the device run itself, not a mirror of it.
 */
describe("matrix case enumeration (R2-16)", () => {
  it("has no duplicate ids", () => {
    const ids = expectedMatrixCaseIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the full id list is the census — additions and removals bless deliberately", () => {
    // Same role as shaderGolden's preset census: growing the matrix (new
    // preset, new probe family) trips this first, as a prompt to re-record
    // on device rather than discover the drift there.
    expect(expectedMatrixCaseIds()).toMatchSnapshot();
  });

  it("every feedback-declaring preset gets its export-shaped case", () => {
    const family = feedbackCasePresets();
    // The renderer's own scan is the source of truth...
    expect(family.map((p) => p.id)).toEqual(presets.filter(presetUsesFeedback).map((p) => p.id));
    // ...and the audit's named modes are all in it (particle-flow is NOT:
    // its sim is the `particles` lane, and its WGSL never samples feedback
    // history — checked, not assumed).
    for (const id of ["echo-trails", "spectro-falls", "overgrowth"]) {
      expect(family.map((p) => p.id)).toContain(id);
    }
    expect(family.length).toBeGreaterThanOrEqual(3);
    const ids = expectedMatrixCaseIds();
    for (const preset of family) expect(ids).toContain(`${preset.id}/feedback/export-walk`);
  });

  it("covers all seven transition kinds, the three background probes and deep capture", () => {
    const ids = expectedMatrixCaseIds();
    expect(TRANSITION_KINDS).toHaveLength(7);
    for (const kind of TRANSITION_KINDS) expect(ids).toContain(`transition/${kind}/mid`);
    for (const bg of ["bg/solid", "bg/transparent", "bg/image"]) expect(ids).toContain(bg);
    expect(ids).toContain("deep/spectrum-bars");
    expect(ids).toContain("builder/@defaults"); // R2-15 rides the same census
  });
});

/**
 * R2-16 — the deep-capture case's metric arithmetic (its readPixels
 * replacement). Pure, so the whole contract is Node-testable: hashes over
 * the exact sidecar bytes, luma on the canvas metrics' 0..255 scale, a
 * nearest-neighbour 16x9 signature with no canvas smoothing involved.
 */
describe("deepCaseMetrics", () => {
  const frame = (w: number, h: number, fill: number) => new Uint16Array(w * h * 4).fill(fill);

  it("full-scale white reads meanLuma 255, everything lit", () => {
    const m = deepCaseMetrics(frame(4, 2, 65535), 4, 2);
    expect(m.meanLuma).toBeCloseTo(255, 3);
    expect(m.litFraction).toBe(1);
    // Signature samples are the high byte of each channel.
    const rgb = Buffer.from(m.signature, "base64");
    expect(rgb).toHaveLength(16 * 9 * 3);
    expect([...new Set(rgb)]).toEqual([255]);
  });

  it("black reads 0/0 and hashes differently from white", () => {
    const black = deepCaseMetrics(frame(4, 2, 0), 4, 2);
    expect(black.meanLuma).toBe(0);
    expect(black.litFraction).toBe(0);
    expect(black.hash).not.toBe(deepCaseMetrics(frame(4, 2, 65535), 4, 2).hash);
  });

  it("a single-value flip anywhere moves the hash — raw-byte strictness", () => {
    const a = frame(4, 2, 32768);
    const b = frame(4, 2, 32768);
    b[b.length - 1] = 32769; // one alpha u16, one ulp
    expect(deepCaseMetrics(a, 4, 2).hash).not.toBe(deepCaseMetrics(b, 4, 2).hash);
  });
});
