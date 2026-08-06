import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "./webgpuRenderer";
import { presets } from "./presets";
import type { PresetDef } from "./types";

/**
 * RP-1: setTransitionPreset used to cache its compiled pipeline by preset.id,
 * while the main pipeline cache is keyed by def OBJECT precisely because "an
 * edited custom preset arrives as a NEW object and correctly recompiles". An
 * edited custom def keeps its id, so a crossfade away from it re-used the
 * pipeline compiled from the OLD WGSL while render() packed the transition
 * params in the NEW def's ABI order — wrong shader and wrong param mapping for
 * the fade. The cache now keys on object identity; these tests drive the real
 * renderer against a stub GPUDevice and count shader-module compiles.
 *
 * The device is a recorder, not a GPU: every create* returns an inert stub, so
 * this pins the CACHING contract (when a compile happens and from which
 * source), not pixels — the GPU matrix owns those.
 */

function fakeGpu() {
  const compiled: string[] = [];
  const texture = () => ({ createView: () => ({}), destroy: () => {} });
  const device = {
    addEventListener: () => {},
    lost: new Promise(() => {}),
    queue: {
      writeBuffer: () => {},
      writeTexture: () => {},
      submit: () => {},
      copyExternalImageToTexture: () => {},
      onSubmittedWorkDone: async () => {},
    },
    createBuffer: () => ({ destroy: () => {} }),
    createTexture: texture,
    createSampler: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createShaderModule: (d: { code: string }) => {
      compiled.push(d.code);
      return { getCompilationInfo: async () => ({ messages: [] }) };
    },
    createRenderPipeline: () => ({}),
    createComputePipeline: () => ({}),
    pushErrorScope: () => {},
    popErrorScope: async () => null,
  };
  const canvas = {
    width: 64,
    height: 64,
    getContext: (kind: string) => (kind === "webgpu" ? { configure: () => {} } : null),
  };
  return { device, canvas, compiled };
}

function stubGpuGlobals(device: unknown) {
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: async () => ({ requestDevice: async () => device }),
      getPreferredCanvasFormat: () => "rgba8unorm",
    },
  });
  // Bit-flag namespaces the constructor ORs together — values are irrelevant
  // to the stub device, they only need to exist.
  vi.stubGlobal("GPUBufferUsage", {
    UNIFORM: 1,
    STORAGE: 2,
    VERTEX: 4,
    COPY_DST: 8,
    COPY_SRC: 16,
    MAP_READ: 32,
  });
  vi.stubGlobal("GPUTextureUsage", {
    TEXTURE_BINDING: 1,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 4,
    COPY_SRC: 8,
  });
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
}

const customDef = (wgsl: string): PresetDef => ({
  id: "custom-edited",
  name: "Edited",
  params: [],
  wgsl,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setTransitionPreset pipeline cache (RP-1)", () => {
  it("recompiles for an edited def (same id, new object); caches by identity otherwise", async () => {
    const { device, canvas, compiled } = fakeGpu();
    stubGpuGlobals(device);
    const renderer = await WebGPURenderer.create(canvas as unknown as OffscreenCanvas);
    expect(compiled).toHaveLength(0); // construction compiles nothing — deltas below are all setTransitionPreset's

    const v1 = customDef("fn preset(uv: vec2f) -> vec4f { return vec4f(0.111); }");
    renderer.setTransitionPreset(v1);
    expect(compiled).toHaveLength(1);
    renderer.setTransitionPreset(v1); // same object -> cached
    expect(compiled).toHaveLength(1);

    // The RP-1 case: the user edits the custom preset mid-fade. Same id, new
    // def object, DIFFERENT WGSL — the fade must render the new source, not
    // the stale module (which render() would pack new-ABI params against).
    const v2 = customDef("fn preset(uv: vec2f) -> vec4f { return vec4f(0.222); }");
    renderer.setTransitionPreset(v2);
    expect(compiled).toHaveLength(2);
    expect(compiled[1]).toContain("0.222");
    expect(compiled[1]).not.toContain("0.111");
  });

  it("built-in singletons still cache across a fade, and null clears the slot", async () => {
    const { device, canvas, compiled } = fakeGpu();
    stubGpuGlobals(device);
    const renderer = await WebGPURenderer.create(canvas as unknown as OffscreenCanvas);

    const builtin = presets[0]; // module singleton — identity is stable
    renderer.setTransitionPreset(builtin);
    renderer.setTransitionPreset(builtin);
    expect(compiled).toHaveLength(1); // the A→B→A live case stays one compile

    renderer.setTransitionPreset(null); // fade ended — slot cleared
    renderer.setTransitionPreset(builtin);
    expect(compiled).toHaveLength(2); // single-slot cache, rebuilt after clear
  });
});
