import { afterEach, describe, expect, it, vi } from "vitest";
import { particleFlow } from "./presets/particleFlow";
import { demoFeatures } from "./thumbnails";
import { defaultParams } from "./types";
import type { ParamValues } from "./types";
import { PARTICLE_UNIFORM_SIZE, WebGPURenderer } from "./webgpuRenderer";

/**
 * RP-4 — "a particle buffer that carries something across renderer instances".
 *
 * thumbnails.ts forbids its THUMB_PARAMS table from touching any param the
 * compute-particle SIM reads, on the strength of a measurement recorded in
 * commit da068f5: giving the thumbnail different sim params moved exactly one
 * frame of a later 90-frame export of the same mode. The conclusion drawn from
 * that measurement — a particle buffer carrying state between renderer
 * instances — is what this file exists to pin down, because a thumbnail is
 * chrome and must never be able to reach an exported frame.
 *
 * The claim is mechanically testable without a GPU. Every observable the
 * particle sim has is a queue write or a compute dispatch:
 *   - the seed upload into the 120k-particle state buffer,
 *   - one 144-byte uniform slot per catch-up step plus the draw slot, each
 *     carrying that step's own track time and the resolved sim params,
 *   - one dispatch per step, selecting its slot by dynamic offset.
 * Drive a REAL WebGPURenderer against a recording stub device and that stream
 * IS the sim's input history: if any state survived a renderer instance — or
 * survived a preset re-selection inside one — the stream would move.
 *
 * The device is a recorder, not a GPU (same idiom as
 * transitionPipelineCache.test.ts): this pins the state-isolation contract,
 * not pixels. The GPU pixel matrix owns pixels.
 *
 * Two guards keep the equality assertions from being three ways of comparing
 * two empty arrays. Every walk is shape-checked as it is recorded
 * (expectExportShape) — mutation testing found that trace equality ALONE is
 * blind to a leak that skews all runs the same way. And the first test is an
 * instrument check: it proves the trace actually resolves a sim-param change.
 */

/** pos.xy + vel.xy, all f32 — the whole particle state buffer. */
const STATE_BYTES = particleFlow.particles!.count * 16;

/** Thumbnail walk, verbatim from thumbnails.ts (SNAPSHOT_T / WARM_FRAMES). */
const SNAPSHOT_T = 11.53 + 14 / 30;
const PARTICLE_WARM_FRAMES = 120;

/** Export walk: the shape exportCore drives — 30 fps, forward from zero. */
const EXPORT_FPS = 30;
const EXPORT_FRAMES = 30;

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

interface BufferStub {
  __size: number;
  destroy: () => void;
}

/**
 * Stub device that records only the particle traffic.
 *
 * Discriminating the two particle buffers by SIZE rather than by creation
 * order keeps the recorder honest if the constructor is reordered:
 *   - the state buffer is the only allocation of `count * 16` bytes;
 *   - the sim uniform is the only buffer LARGER than one uniform block that
 *     ever receives an exactly-PARTICLE_UNIFORM_SIZE write (it holds nine
 *     256-byte slots; the scene uniform is a bare 144-byte block).
 * expectExportShape fails loudly if either stops holding, rather than letting
 * the trace quietly go empty.
 */
function recorderGpu() {
  const trace: string[] = [];
  const texture = () => ({ createView: () => ({}), destroy: () => {} });
  const pipeline = () => ({ getBindGroupLayout: () => ({}) });
  const renderPass = () => ({
    setPipeline: () => {},
    setBindGroup: () => {},
    setVertexBuffer: () => {},
    draw: () => {},
    end: () => {},
  });
  const computePass = () => {
    let dynamic = "";
    return {
      setPipeline: () => {},
      setBindGroup: (_index: number, _group: unknown, offsets?: number[]) => {
        dynamic = (offsets ?? []).join(",");
      },
      dispatchWorkgroups: (groups: number) => {
        trace.push(`dispatch slot=[${dynamic}] groups=${groups}`);
      },
      end: () => {},
    };
  };
  const device = {
    addEventListener: () => {},
    lost: new Promise(() => {}),
    queue: {
      writeBuffer: (buffer: BufferStub, offset: number, data: ArrayBuffer | ArrayBufferView) => {
        const bytes = toBytes(data);
        if (buffer.__size === STATE_BYTES) {
          trace.push(`seed off=${offset} len=${bytes.byteLength} h=${fnv1a(bytes)}`);
        } else if (
          bytes.byteLength === PARTICLE_UNIFORM_SIZE &&
          buffer.__size > PARTICLE_UNIFORM_SIZE
        ) {
          trace.push(`slot off=${offset} h=${fnv1a(bytes)}`);
        }
      },
      writeTexture: () => {},
      submit: () => {},
      copyExternalImageToTexture: () => {},
      onSubmittedWorkDone: async () => {},
    },
    createBuffer: (d: { size: number }): BufferStub => ({ __size: d.size, destroy: () => {} }),
    createTexture: texture,
    createSampler: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipeline: pipeline,
    createComputePipeline: pipeline,
    createCommandEncoder: () => ({
      beginRenderPass: renderPass,
      beginComputePass: computePass,
      copyTextureToTexture: () => {},
      finish: () => ({}),
    }),
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    destroy: () => {},
  };
  const canvas = {
    width: 192,
    height: 108,
    getContext: (kind: string) =>
      kind === "webgpu" ? { configure: () => {}, getCurrentTexture: () => texture() } : null,
  };
  return { device, canvas, trace };
}

function stubGpuGlobals(device: unknown) {
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: async () => ({ requestDevice: async () => device }),
      getPreferredCanvasFormat: () => "rgba8unorm",
    },
  });
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

async function makeRenderer(): Promise<{ renderer: WebGPURenderer; trace: string[] }> {
  const { device, canvas, trace } = recorderGpu();
  stubGpuGlobals(device);
  const renderer = await WebGPURenderer.create(canvas as unknown as OffscreenCanvas);
  renderer.resize(192, 108, 1);
  return { renderer, trace };
}

const defaults = (): ParamValues => defaultParams(particleFlow);

/**
 * Defaults with every SIM-side param moved — the exact table thumbnails.ts
 * forbids. Values are lifted from the preset's own "Galaxy" style, so they are
 * inside each spec's legal span and are a real configuration of the field.
 */
const simMoved = (): ParamValues => ({
  ...defaults(),
  flowScale: 0.7,
  flowStrength: 0.25,
  swirl: 1.7,
  gravity: 1.05,
  damping: 0.985,
  audioFlow: 1.2,
  beatBurst: 0.6,
  spawnRadius: 0.1,
});

function thumbnailWalk(renderer: WebGPURenderer, params: ParamValues): void {
  for (let f = 0; f <= PARTICLE_WARM_FRAMES; f++) {
    const t = SNAPSHOT_T * (f / PARTICLE_WARM_FRAMES);
    renderer.render(demoFeatures(t), t, params);
  }
}

function exportWalk(renderer: WebGPURenderer, params: ParamValues): void {
  for (let f = 0; f < EXPORT_FRAMES; f++) {
    const t = f / EXPORT_FPS;
    renderer.render(demoFeatures(t), t, params);
  }
}

/**
 * The shape EVERY export walk must have, asserted on every trace this file
 * compares rather than once at the top.
 *
 * Trace equality alone is blind to a leak that skews all runs the SAME way —
 * a process-global "already seeded" flag makes every run after the first
 * seedless, and three identical seedless traces still compare equal. Checking
 * the shape per run turns that into a failure on the run that skipped its
 * work. Frame 0 seeds and runs no step (target = 0); every later frame
 * advances the 60 Hz sim by exactly two steps at 30 fps, and each frame writes
 * one uniform slot per step plus the draw slot.
 */
function expectExportShape(trace: string[]): void {
  const seeds = trace.filter((line) => line.startsWith("seed"));
  expect(seeds).toHaveLength(1);
  // The seed covers the WHOLE state buffer from byte zero. ensureParticleBuffers
  // reuses an oversized buffer, so a partial re-seed would leave a live tail of
  // the previous preset's particles behind.
  expect(seeds[0]).toMatch(new RegExp(`^seed off=0 len=${STATE_BYTES} h=[0-9a-f]{8}$`));
  expect(trace.filter((line) => line.startsWith("dispatch"))).toHaveLength((EXPORT_FRAMES - 1) * 2);
  expect(trace.filter((line) => line.startsWith("slot"))).toHaveLength(1 + (EXPORT_FRAMES - 1) * 3);
}

/** One export on a renderer that has never rendered anything else. */
async function freshExportTrace(params: ParamValues = defaults()): Promise<string[]> {
  const { renderer, trace } = await makeRenderer();
  renderer.setPreset(particleFlow);
  exportWalk(renderer, params);
  renderer.dispose();
  expectExportShape(trace);
  return trace;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compute-particle sim isolation (RP-4)", () => {
  it("records real sim work and resolves a change to the simulation params", async () => {
    // freshExportTrace asserts the shape (see expectExportShape), so no
    // equality assertion in this file can pass on an empty or mis-tagged trace.
    const baseline = await freshExportTrace();

    // Instrument check: the same walk with the sim params moved MUST diverge,
    // otherwise the equality assertions below prove nothing.
    const moved = await freshExportTrace(simMoved());
    expect(moved).not.toEqual(baseline);
  });

  it("is byte-identical across two renderer instances given the same walk", async () => {
    const first = await freshExportTrace();
    const second = await freshExportTrace();
    expect(second).toEqual(first);
  });

  it("a thumbnail render on an earlier instance cannot touch a later export", async () => {
    const control = await freshExportTrace();

    // Exactly what renderPresetThumbnails() does, on its own throwaway
    // renderer + OffscreenCanvas — but with the sim params THUMB_PARAMS is
    // forbidden from setting, which is the configuration that was measured.
    const thumb = await makeRenderer();
    thumb.renderer.setPreset(particleFlow);
    thumbnailWalk(thumb.renderer, simMoved());
    thumb.renderer.dispose();

    expect(await freshExportTrace()).toEqual(control);
  });

  it("re-selecting the preset re-seeds: a thumbnail walk on the SAME renderer leaves nothing", async () => {
    const control = await freshExportTrace();

    const { renderer, trace } = await makeRenderer();
    renderer.setPreset(particleFlow);
    thumbnailWalk(renderer, simMoved());
    const boundary = trace.length;
    expect(boundary).toBeGreaterThan(0);
    renderer.setPreset(particleFlow);
    exportWalk(renderer, defaults());
    renderer.dispose();

    const after = trace.slice(boundary);
    expectExportShape(after);
    expect(after).toEqual(control);
  });
});
