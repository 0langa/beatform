import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmData } from "../audio/types";

/**
 * RP-20, the Builder bridge — the EXPORT walk. Builder values reach the GPU
 * via the builderLayers storage buffer, uploaded per frame through the SAME
 * packBuilderFrame helper the live loop uses. These tests spy the renderer's
 * setBuilderParams:
 *  - no mods/automation -> exactly ONE upload (setup), byte-equal to the
 *    plain stack pack: the dirty check plus the default-neutrality law;
 *  - a mod route to a virtual key -> per-frame uploads whose bytes differ
 *    from the stack pack in exactly the routed slot.
 *
 * The renderer is a no-op stand-in (same harness as the feedback-gate tests);
 * builder2's def/pack machinery and applyMods stay REAL — they are the thing
 * under test.
 */

const uploadSpy = vi.hoisted(() => ({ packs: [] as Float32Array[] }));

vi.mock("../render/webgpuRenderer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../render/webgpuRenderer")>();
  class FakeRenderer {
    onDeviceLost: ((reason: string) => void) | null = null;
    static create = async () => new FakeRenderer();
    setDeepCapture() {}
    setPreset() {}
    setBackground() {}
    setOverlay() {}
    setSmoothSpectrum() {}
    setPost() {}
    setMotion() {}
    setBuilderParams(data: Float32Array) {
      uploadSpy.packs.push(data.slice());
    }
    setCoverArt() {}
    setBackgroundImage() {}
    updateBackgroundVideoFrame() {}
    setTransitionPreset() {}
    resize() {}
    render() {}
    async gpuDone() {}
    async readbackDeepFrame() {
      return new Uint16Array(0);
    }
    dispose() {}
  }
  return { ...mod, WebGPURenderer: FakeRenderer };
});

// Loaded AFTER the mock so exportCore binds the fake renderer.
import { runExportJob, type ExportJob } from "./exportCore";
import { defaultBuilderStack, packBuilderParams } from "../render/builder2";

function makePcm(): PcmData {
  // 0.2 s of tone — enough for a few frames of real analysis DSP, with
  // energy so a drive-driven route actually moves.
  const n = 9600;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.sin(i * 0.05) * 0.5;
  return { sampleRate: 48000, length: n, duration: n / 48000, channels: [ch] };
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    pcm: makePcm(),
    width: 32,
    height: 32,
    fps: 30,
    // A full-track job: the clip IS the track, so its origin is 0. Required
    // rather than defaulted, so a job that forgets it cannot render silently at
    // the wrong moment (E2-R1).
    timeOrigin: 0,
    bitrate: 1_000_000,
    presetId: "builder2",
    params: {},
    bg: { mode: 0, color: [0, 0, 0] },
    builderStack: defaultBuilderStack(),
    // PNG mode: no muxer, no WebCodecs — the only lane that completes in Node.
    mode: "png",
    ...overrides,
  };
}

const hooks = () => ({ onFrame: async () => {} });

beforeEach(() => {
  uploadSpy.packs.length = 0;
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return null;
      }
      async convertToBlob() {
        return new Blob([new Uint8Array([0x89, 0x50])]);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runExportJob builder frame chokepoint (RP-20)", () => {
  it("an unmodulated builder export uploads the pack exactly once, byte-equal to the stack pack", async () => {
    await runExportJob(job(), hooks());
    // The setup upload is the dirty-check baseline; with no mods/automation
    // every frame resolves to the mirror values, so the per-frame overlay is
    // byte-identical and never re-uploads — default neutrality, observed at
    // the GPU boundary.
    expect(uploadSpy.packs).toHaveLength(1);
    expect(Array.from(uploadSpy.packs[0])).toEqual(
      Array.from(packBuilderParams(defaultBuilderStack())),
    );
  });

  it("a mod route to a virtual key re-uploads with exactly that slot changed", async () => {
    const stack = defaultBuilderStack();
    await runExportJob(
      job({
        builderStack: stack,
        params: {}, // baseParams: exportCore resolves defaults per spec
        mods: [{ id: "r1", source: "drive", param: "l0.glow", amount: 1 }],
      }),
      hooks(),
    );
    expect(uploadSpy.packs.length).toBeGreaterThan(1);
    const baseline = packBuilderParams(stack);
    const last = uploadSpy.packs[uploadSpy.packs.length - 1];
    const diffs: number[] = [];
    for (let i = 0; i < last.length; i++) if (last[i] !== baseline[i]) diffs.push(i);
    // Only layer 0's glow slot (fixed slots 0..2, then type params -> 3).
    expect(diffs).toEqual([3]);
    expect(last[3]).toBeGreaterThan(baseline[3]);
  });
});
