import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmData } from "../audio/types";

/**
 * AX-2: every export used to construct a SECOND full OfflineAnalyzer (a second
 * whole-track mono mixdown, ~1.4 GB on a 2 h track) and walk the entire
 * analysis DSP again at 60 Hz — solely to advance texture-feedback state that
 * only presets calling feedbackSample() ever read. The construction is now
 * gated on whether the base preset or any timeline scene's preset actually
 * uses feedback. These tests spy the constructor: exactly one analyzer for a
 * non-feedback job, exactly two (output-fps + 60 Hz feedback) when feedback
 * can render — so the gate can neither over- nor under-build.
 *
 * The renderer is a no-op stand-in (this is about what the core CONSTRUCTS,
 * not what the GPU draws) but presetUsesFeedback stays REAL — the WGSL scan is
 * the gate under test. The analyzers are the real class too, running real DSP
 * over a 0.2 s buffer.
 */

const analyzerSpy = vi.hoisted(() => ({ fpses: [] as number[] }));

vi.mock("../audio/offlineSource", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../audio/offlineSource")>();
  class CountingAnalyzer extends mod.OfflineAnalyzer {
    constructor(...args: ConstructorParameters<typeof mod.OfflineAnalyzer>) {
      super(...args);
      analyzerSpy.fpses.push(args[1]);
    }
  }
  return { ...mod, OfflineAnalyzer: CountingAnalyzer };
});

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
    setBuilderParams() {}
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

// Loaded AFTER the mocks so exportCore binds the counting/fake classes.
import { runExportJob, type ExportJob } from "./exportCore";

function makePcm(): PcmData {
  // 0.2 s of quiet noise — enough for a few frames of real analysis DSP.
  const n = 9600;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.sin(i * 0.05) * 0.2;
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
    presetId: "spectrum-bars", // no feedbackSample() in its WGSL
    params: {},
    bg: { mode: 0, color: [0, 0, 0] },
    // PNG mode: no muxer, no WebCodecs — the only lane that completes in Node.
    mode: "png",
    ...overrides,
  };
}

const hooks = () => ({ onFrame: async () => {} });

beforeEach(() => {
  analyzerSpy.fpses.length = 0;
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
        return null; // only the loop-crossfade blend canvas asks; not used here
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

describe("runExportJob feedback-analyzer gate (AX-2)", () => {
  it("a non-feedback preset builds exactly ONE analyzer, at output fps", async () => {
    await runExportJob(job(), hooks());
    expect(analyzerSpy.fpses).toEqual([30]);
  });

  it("a feedback preset builds the 60 Hz feedback analyzer too — exactly as before", async () => {
    await runExportJob(job({ presetId: "echo-trails" }), hooks());
    expect(analyzerSpy.fpses).toEqual([30, 60]);
  });

  it("a feedback preset reached only via a timeline scene still arms the walk", async () => {
    // The gate must scan the SCENES, not just the base preset: a job whose
    // base mode is feedback-free can still crossfade into echo-trails.
    await runExportJob(
      job({
        timeline: {
          enabled: true,
          scenes: [{ id: "s", name: "S", presetId: "echo-trails", start: 0.1 }],
          lanes: [],
        },
      }),
      hooks(),
    );
    expect(analyzerSpy.fpses).toEqual([30, 60]);
  });

  it("a disabled timeline's scenes do not arm the walk", async () => {
    // exportCore already strips disabled timelines at buildExportOptions, but
    // the job is untrusted input — the gate must honor `enabled` the same way
    // resolveActiveFrame does (a disabled timeline never yields a scene).
    await runExportJob(
      job({
        timeline: {
          enabled: false,
          scenes: [{ id: "s", name: "S", presetId: "echo-trails", start: 0 }],
          lanes: [],
        },
      }),
      hooks(),
    );
    expect(analyzerSpy.fpses).toEqual([30]);
  });

  it("emits setup heartbeats before the first progress message (AX-3)", async () => {
    const order: string[] = [];
    await runExportJob(job(), {
      ...hooks(),
      onHeartbeat: () => order.push("hb"),
      onProgress: () => order.push("progress"),
    });
    // At least one liveness ping lands before any progress — the watchdog's
    // view of setup is no longer pure silence. Exact counts are deliberately
    // not pinned (stages may move); the ordering is the contract.
    expect(order.indexOf("hb")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("hb")).toBeLessThan(order.indexOf("progress"));
  });
});
