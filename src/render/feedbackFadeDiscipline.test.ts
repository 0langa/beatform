import { afterEach, describe, expect, it, vi } from "vitest";
import { overgrowth } from "./presets/overgrowth";
import { spectroFalls } from "./presets/spectroFalls";
import { spectrumBars } from "./presets/spectrumBars";
import { demoFeatures } from "./thumbnails";
import { defaultParams } from "./types";
import type { ParamValues, PresetDef, TransitionState } from "./types";
import { WebGPURenderer } from "./webgpuRenderer";

/**
 * F3 — "the live timeline crossfade poisons the alpha data lane for every
 * feedback preset" (filed in BACKLOG.md's 2.103.0 entry by the Overgrowth
 * adversarial review).
 *
 * The contract under pin: feedback HISTORY only ever stores RAW preset
 * output. `composite()` replaces the alpha lane in every branch (forced 1.0
 * over opaque backgrounds, luma-derived over transparent) and bakes the
 * background/overlay into RGB — and the raw alpha lane IS the state for
 * Spectro Falls' record and Overgrowth's two-chemical field. A live rAF
 * frame that is both a feedback tick and inside a crossfade window
 * (services.ts sends `advance-and-present` with a transition) used to draw
 * the incoming preset inline-composited into fadeTexA and copy THAT into
 * histTex, feeding the recurrence its own composited picture ~60×/s for the
 * fade. The export walk never does this: it advances on raw advance-only
 * ticks with `transition: undefined` and presents fades without advancing
 * (exportCore.ts) — which is exactly the shape the renderer must produce
 * for a live ticked fade frame.
 *
 * The device is a recorder, not a GPU (transitionPipelineCache.test.ts /
 * particleSimIsolation.test.ts idiom): every observable this contract has is
 * a uniform write (slot 27 = the raw/composited flag, slot 9 = dt), a render
 * pass target, a texture→texture copy, or a queue submit. The recorded
 * stream pins WHICH frames become history and under WHICH uniform state —
 * pixels stay owned by the GPU matrix and the on-device fade walk.
 */

const FEEDBACK_DT_LINE = (1 / 60).toFixed(5); // "0.01667"

interface BufferStub {
  __idx: number;
  __size: number;
  destroy: () => void;
}

interface TexStub {
  __tex: string;
  createView: () => { __tex: string };
  destroy: () => void;
}

function toF32(data: ArrayBuffer | ArrayBufferView): Float32Array {
  return data instanceof ArrayBuffer
    ? new Float32Array(data)
    : new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
}

/**
 * Recorder tags:
 *  - `uni fb=<0|1> dt=<f>` — a write to the 144-byte scene uniform (the
 *    constructor's FIRST buffer): fb is slot 27 (fs_main: 1 = emit raw for
 *    the feedback/composite machinery, 0 = inline `composite()`), dt slot 9.
 *    In call order this always precedes the passes it governs, so "the last
 *    `uni` line above" is the uniform state a pass or copy ran under.
 *  - `draw target=T<n> pipe=<entry>` — a render pass that set a pipeline;
 *    entry is the fragment entry point (`fs_main`, `fs_composite`,
 *    `fs_final`; the blend pipeline is `fs_main@auto`, its layout is the
 *    only "auto" one).
 *  - `clear target=T<n>` — a pass that ended without a pipeline (the
 *    feedback-history clear is the only one).
 *  - `copy T<a> -> T<b>` — copyTextureToTexture.
 *  - `submit` — queue submission boundary.
 */
function recorderGpu() {
  const trace: string[] = [];
  let texSeq = 0;
  let bufSeq = 0;
  const texture = (): TexStub => {
    const id = `T${++texSeq}`;
    return { __tex: id, createView: () => ({ __tex: id }), destroy: () => {} };
  };
  const renderPass = (desc: { colorAttachments: { view: { __tex: string } }[] }) => {
    const target = desc.colorAttachments[0].view.__tex;
    let piped = false;
    return {
      setPipeline: (p: { __pipe: string }) => {
        piped = true;
        trace.push(`draw target=${target} pipe=${p.__pipe}`);
      },
      setBindGroup: () => {},
      setVertexBuffer: () => {},
      draw: () => {},
      end: () => {
        if (!piped) trace.push(`clear target=${target}`);
      },
    };
  };
  const device = {
    addEventListener: () => {},
    lost: new Promise(() => {}),
    queue: {
      writeBuffer: (buffer: BufferStub, _offset: number, data: ArrayBuffer | ArrayBufferView) => {
        // The scene uniform is the constructor's first allocation and the
        // only 144-byte buffer in these walks (no shadertoy preset is ever
        // set; the particle slot buffer is nine 256-byte slots).
        if (buffer.__idx === 0 && buffer.__size === 144) {
          const f32 = toF32(data);
          trace.push(`uni fb=${f32[27]} dt=${f32[9].toFixed(5)}`);
        }
      },
      writeTexture: () => {},
      submit: () => {
        trace.push("submit");
      },
      copyExternalImageToTexture: () => {},
      onSubmittedWorkDone: async () => {},
    },
    createBuffer: (d: { size: number }): BufferStub => ({
      __idx: bufSeq++,
      __size: d.size,
      destroy: () => {},
    }),
    createTexture: texture,
    createSampler: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipeline: (d: { layout: unknown; fragment?: { entryPoint?: string } }) => ({
      __pipe: `${d.fragment?.entryPoint ?? "?"}${d.layout === "auto" ? "@auto" : ""}`,
      getBindGroupLayout: () => ({}),
    }),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createCommandEncoder: () => ({
      beginRenderPass: renderPass,
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: () => {},
        end: () => {},
      }),
      copyTextureToTexture: (src: { texture: TexStub }, dst: { texture: TexStub }) => {
        trace.push(`copy ${src.texture.__tex} -> ${dst.texture.__tex}`);
      },
      finish: () => ({}),
    }),
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    destroy: () => {},
  };
  let swap: TexStub | null = null;
  const canvas = {
    width: 192,
    height: 108,
    getContext: (kind: string) =>
      kind === "webgpu"
        ? { configure: () => {}, getCurrentTexture: () => (swap ??= texture()) }
        : null,
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

/** The uniform state (raw/composited flag) a trace line ran under. */
function governingFb(trace: string[], i: number): string {
  for (let j = i - 1; j >= 0; j--) {
    const m = /^uni fb=(\d) dt=/.exec(trace[j]);
    if (m) return m[1];
  }
  return "none";
}

interface Copy {
  index: number;
  src: string;
  dst: string;
  fb: string;
}

function copies(trace: string[]): Copy[] {
  const out: Copy[] = [];
  trace.forEach((line, index) => {
    const m = /^copy (T\d+) -> (T\d+)$/.exec(line);
    if (m) out.push({ index, src: m[1], dst: m[2], fb: governingFb(trace, index) });
  });
  return out;
}

/** A raw fs_main pass drew `tex` under fb=1 somewhere before index `i`. */
function drawnRawBefore(trace: string[], tex: string, i: number): boolean {
  for (let j = 0; j < i; j++) {
    if (trace[j] === `draw target=${tex} pipe=fs_main` && governingFb(trace, j) === "1") {
      return true;
    }
  }
  return false;
}

const fadeInto = (incoming: PresetDef, outgoing: PresetDef = spectrumBars) => ({
  incoming,
  params: defaultParams(incoming),
  outgoing,
  transition: {
    params: defaultParams(outgoing),
    mix: 0.5,
    kind: 0,
  } satisfies TransitionState,
});

/** Warm the plain feedback path (advance-and-present, no transition): runs
 * the pending history clear and establishes histTex/visTex identities via
 * the shipped-correct raw copy. */
function warm(renderer: WebGPURenderer, params: ParamValues, frames = 1): void {
  for (let f = 0; f < frames; f++) {
    const t = f / 60;
    renderer.render(demoFeatures(t), t, params);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("feedback fade advance discipline (F3)", () => {
  it("instrument check: the plain feedback walk records raw-frame history copies", async () => {
    const { renderer, trace } = await makeRenderer();
    renderer.setPreset(spectroFalls);
    warm(renderer, defaultParams(spectroFalls), 3);
    renderer.dispose();

    // The recorder must actually see uniform writes, the first-frame history
    // clear, and one raw visTex→histTex copy per advance — otherwise every
    // "no composited copy" assertion below could pass on an empty trace.
    expect(trace.filter((l) => l.startsWith("uni fb="))).toHaveLength(3);
    expect(trace.filter((l) => l.startsWith("clear target="))).toHaveLength(1);
    const cs = copies(trace);
    expect(cs).toHaveLength(3);
    const hist = cs[0].dst;
    for (const c of cs) {
      expect(c.dst).toBe(hist);
      expect(c.fb).toBe("1");
      expect(drawnRawBefore(trace, c.src, c.index)).toBe(true);
    }
  });

  it("a ticked fade frame never copies a composited frame into feedback history", async () => {
    const { renderer, trace } = await makeRenderer();
    const walk = fadeInto(spectroFalls);
    renderer.setPreset(walk.incoming);
    renderer.setTransitionPreset(walk.outgoing);
    warm(renderer, walk.params);
    const boundary = trace.length;
    renderer.render(demoFeatures(1 / 60), 1 / 60, walk.params, walk.transition, {
      feedback: "advance-and-present",
    });
    renderer.dispose();

    // THE F3 CONTRACT. Under the defect this held exactly one entry: the
    // fadeTexA→histTex copy of the inline-composited (fb=0) fade frame.
    const composited = copies(trace).filter((c) => c.index >= boundary && c.fb !== "1");
    expect(composited).toEqual([]);
  });

  it("a ticked fade frame still advances state: one raw copy, from a raw-drawn frame", async () => {
    const { renderer, trace } = await makeRenderer();
    const walk = fadeInto(spectroFalls);
    renderer.setPreset(walk.incoming);
    renderer.setTransitionPreset(walk.outgoing);
    warm(renderer, walk.params);
    const hist = copies(trace)[0].dst;
    const before = copies(trace).length;
    renderer.render(demoFeatures(1 / 60), 1 / 60, walk.params, walk.transition, {
      feedback: "advance-and-present",
    });
    renderer.dispose();

    // Deleting the M14 copy outright would "fix" the poisoning by freezing
    // the incoming preset's state for the whole fade (the pre-M14 snap).
    // The fade must keep advancing — from RAW frames.
    const fadeCopies = copies(trace).slice(before);
    expect(fadeCopies).toHaveLength(1);
    expect(fadeCopies[0].dst).toBe(hist);
    expect(fadeCopies[0].fb).toBe("1");
    expect(drawnRawBefore(trace, fadeCopies[0].src, fadeCopies[0].index)).toBe(true);
  });

  it("a ticked fade frame's presentation never integrates (composited passes run dt=0)", async () => {
    const { renderer, trace } = await makeRenderer();
    const walk = fadeInto(spectroFalls);
    renderer.setPreset(walk.incoming);
    renderer.setTransitionPreset(walk.outgoing);
    warm(renderer, walk.params);
    const boundary = trace.length;
    renderer.render(demoFeatures(1 / 60), 1 / 60, walk.params, walk.transition, {
      feedback: "advance-and-present",
    });
    renderer.dispose();

    // Export presents fade frames with dt=0 over already-advanced state
    // (both feedback modes document dt=0 as an exact pass-through). A
    // composited fade evaluation with dt>0 is an integrating presentation —
    // the defect's other face. The advance must carry the fixed step.
    const fade = trace.slice(boundary);
    const unis = fade.filter((l) => l.startsWith("uni fb="));
    expect(unis).toContain(`uni fb=1 dt=${FEEDBACK_DT_LINE}`);
    for (const u of unis) {
      if (u.startsWith("uni fb=0")) expect(u).toBe("uni fb=0 dt=0.00000");
    }
  });

  it("a ticked fade frame is exactly the export shape: advance-only then present-only (Spectro Falls)", async () => {
    const walk = fadeInto(spectroFalls);
    const t = 1 / 60;

    const live = await makeRenderer();
    live.renderer.setPreset(walk.incoming);
    live.renderer.setTransitionPreset(walk.outgoing);
    warm(live.renderer, walk.params);
    live.renderer.render(demoFeatures(t), t, walk.params, walk.transition, {
      feedback: "advance-and-present",
    });
    live.renderer.dispose();

    // exportCore.ts's own two calls for the same instant: a raw advance tick
    // with NO transition, then the fade presented without advancing.
    const exp = await makeRenderer();
    exp.renderer.setPreset(walk.incoming);
    exp.renderer.setTransitionPreset(walk.outgoing);
    warm(exp.renderer, walk.params);
    exp.renderer.render(demoFeatures(t), t, walk.params, undefined, { feedback: "advance-only" });
    exp.renderer.render(demoFeatures(t), t, walk.params, walk.transition, {
      feedback: "present-only",
    });
    exp.renderer.dispose();

    expect(live.trace).toEqual(exp.trace);
  });

  it("a ticked fade frame is exactly the export shape (Overgrowth)", async () => {
    const walk = fadeInto(overgrowth);
    const t = 1 / 60;

    const live = await makeRenderer();
    live.renderer.setPreset(walk.incoming);
    live.renderer.setTransitionPreset(walk.outgoing);
    warm(live.renderer, walk.params);
    live.renderer.render(demoFeatures(t), t, walk.params, walk.transition, {
      feedback: "advance-and-present",
    });
    live.renderer.dispose();

    const exp = await makeRenderer();
    exp.renderer.setPreset(walk.incoming);
    exp.renderer.setTransitionPreset(walk.outgoing);
    warm(exp.renderer, walk.params);
    exp.renderer.render(demoFeatures(t), t, walk.params, undefined, { feedback: "advance-only" });
    exp.renderer.render(demoFeatures(t), t, walk.params, walk.transition, {
      feedback: "present-only",
    });
    exp.renderer.dispose();

    expect(live.trace).toEqual(exp.trace);
  });

  it("Overgrowth fade ticks advance raw and never store composited output", async () => {
    const { renderer, trace } = await makeRenderer();
    const walk = fadeInto(overgrowth);
    renderer.setPreset(walk.incoming);
    renderer.setTransitionPreset(walk.outgoing);
    warm(renderer, walk.params);
    const hist = copies(trace)[0].dst;
    const before = copies(trace).length;
    renderer.render(demoFeatures(1 / 60), 1 / 60, walk.params, walk.transition, {
      feedback: "advance-and-present",
    });
    renderer.dispose();

    const fadeCopies = copies(trace).slice(before);
    expect(fadeCopies).toHaveLength(1);
    expect(fadeCopies[0]).toMatchObject({ dst: hist, fb: "1" });
  });

  it("present-only fade frames never copy into history (non-tick live frames)", async () => {
    const { renderer, trace } = await makeRenderer();
    const walk = fadeInto(spectroFalls);
    renderer.setPreset(walk.incoming);
    renderer.setTransitionPreset(walk.outgoing);
    warm(renderer, walk.params);
    const before = copies(trace).length;
    renderer.render(demoFeatures(1 / 60), 1 / 60, walk.params, walk.transition, {
      feedback: "present-only",
    });
    renderer.dispose();

    expect(copies(trace).slice(before)).toEqual([]);
  });

  it("advance-only during a fade copies raw (the fps-cap discipline, unchanged)", async () => {
    const { renderer, trace } = await makeRenderer();
    const walk = fadeInto(spectroFalls);
    renderer.setPreset(walk.incoming);
    renderer.setTransitionPreset(walk.outgoing);
    warm(renderer, walk.params);
    const hist = copies(trace)[0].dst;
    const before = copies(trace).length;
    // services.ts passes the transition on capped frames too — the raw
    // branch must win over the fading branch for advance-only.
    renderer.render(demoFeatures(1 / 60), 1 / 60, walk.params, walk.transition, {
      feedback: "advance-only",
    });
    renderer.dispose();

    const capCopies = copies(trace).slice(before);
    expect(capCopies).toHaveLength(1);
    expect(capCopies[0]).toMatchObject({ dst: hist, fb: "1" });
    expect(drawnRawBefore(trace, capCopies[0].src, capCopies[0].index)).toBe(true);
  });

  it("fading OUT of a feedback mode leaves the frozen trail untouched (M14 semantics)", async () => {
    const { renderer, trace } = await makeRenderer();
    renderer.setPreset(spectroFalls);
    warm(renderer, defaultParams(spectroFalls), 2);
    // Cut to a non-feedback preset that crossfades FROM Spectro Falls: the
    // history is the outgoing preset's picture; nothing may write OR clear
    // it during the fade (the trail holds still under a falling blend).
    renderer.setPreset(spectrumBars);
    renderer.setTransitionPreset(spectroFalls);
    const boundary = trace.length;
    renderer.render(
      demoFeatures(2 / 60),
      2 / 60,
      defaultParams(spectrumBars),
      { params: defaultParams(spectroFalls), mix: 0.5, kind: 0 },
      { feedback: "advance-and-present" },
    );
    renderer.dispose();

    const fade = trace.slice(boundary);
    expect(fade.filter((l) => l.startsWith("copy "))).toEqual([]);
    expect(fade.filter((l) => l.startsWith("clear target="))).toEqual([]);
  });
});
