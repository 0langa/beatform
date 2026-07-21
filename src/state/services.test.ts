import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M16 regression: `engine` was identity-guarded on teardown
 * (`if (engine === eng) engine = null`), but `disposeLoop`, `renderer` and
 * `analyzer` were not. An overlapping lifecycle — a fast re-init before the
 * previous instance's own teardown has run, e.g. a React StrictMode
 * double-invoke racing an async device install — let instance A's stale
 * teardown null out instance B's still-live renderer/analyzer, and (since
 * disposeLoop is what stops the rAF loop) kill B's frame loop too, after
 * which every getAnalyzer() throws for a session the UI still thinks is
 * running fine.
 *
 * AudioEngine, RealtimeAnalyzer, WebGPURenderer and Canvas2DRenderer are
 * mocked because none of their real implementations exist in this (Node,
 * no DOM/WebGPU/Web Audio) test environment — that's orthogonal to the bug,
 * which is pure module-level bookkeeping in services.ts.
 */

vi.mock("../audio/engine", () => {
  class AudioEngine {
    onStateChange: unknown = null;
    onEnded: unknown = null;
    playing = false;
    currentTime = 0;
    outputLatency = 0;
    duration = 0;
    dispose = vi.fn();
    setVolume = vi.fn();
  }
  return { AudioEngine };
});

vi.mock("../audio/realtimeSource", () => {
  class RealtimeAnalyzer {
    constructor(
      public engine: unknown,
      public binCount?: number,
    ) {}
    setSync = vi.fn();
    update = vi.fn(() => ({ lufs: 0, width: 0 }) as unknown);
  }
  return { RealtimeAnalyzer };
});

vi.mock("../render/webgpuRenderer", () => {
  class WebGPURenderer {
    kind = "webgpu" as const;
    onDeviceLost: (() => void) | null = null;
    dispose = vi.fn();
    setPreset = vi.fn();
    setBackground = vi.fn();
    setTransitionPreset = vi.fn();
    resize = vi.fn();
    render = vi.fn();
    static create = vi.fn(() => Promise.resolve(new WebGPURenderer()));
  }
  return { WebGPURenderer };
});

vi.mock("../render/canvas2dRenderer", () => {
  class Canvas2DRenderer {
    kind = "canvas2d" as const;
    constructor(public canvas: unknown) {}
    dispose = vi.fn();
    setPreset = vi.fn();
    setBackground = vi.fn();
    setTransitionPreset = vi.fn();
    resize = vi.fn();
    render = vi.fn();
  }
  return { Canvas2DRenderer };
});

import { getAnalyzer, getEngine, getRenderer, initServices, type ServiceHooks } from "./services";
import { WebGPURenderer } from "../render/webgpuRenderer";
import type { PresetDef, BgSettings } from "../render/types";
import type { FrameResolveInput } from "./frameResolve";
import { EMPTY_TIMELINE } from "./timeline";
import { registerCustomPreset, unregisterCustomPreset } from "../render/presets/custom";

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 640,
    height: 360,
    style: {},
    getBoundingClientRect: () => ({ width: 640, height: 360 }) as DOMRect,
    parentElement: null,
  } as unknown as HTMLCanvasElement;
}

function fakeHooks(overrides: Partial<ServiceHooks> = {}): ServiceHooks {
  return {
    getPreset: () => ({}) as unknown as PresetDef,
    getFrameInput: () => ({}) as unknown as FrameResolveInput,
    getBackground: () => ({}) as unknown as BgSettings,
    getSync: () => ({ mode: "kick", smooth: 0.5 }),
    isSeeking: () => false,
    onPlayback: () => {},
    onRendererChanged: () => {},
    ...overrides,
  };
}

// requestAnimationFrame is intentionally a no-op that never invokes its
// callback: these tests are about teardown bookkeeping, not the render
// loop, and letting the loop actually tick would need a lot more of
// resolveActiveFrame/presetById's real machinery mocked for no benefit here.
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // installRenderer reads window.devicePixelRatio synchronously during
  // install, before the render loop (which would need a lot more of
  // window/resolveActiveFrame's world) ever runs.
  vi.stubGlobal("window", { devicePixelRatio: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Flush the microtask (WebGPURenderer.create's resolved promise) and any
 * zero-delay timer so a just-called initServices has fully installed its
 * renderer before the test inspects module state. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

/** The mocked WebGPURenderer's `dispose` is a vi.fn — reach it without
 * fighting the real Renderer type, which doesn't know about mock methods. */
function disposeMock(r: unknown): ReturnType<typeof vi.fn> {
  return (r as { dispose: ReturnType<typeof vi.fn> }).dispose;
}

describe("services.ts overlapping-lifecycle teardown", () => {
  it("a stale instance's dispose does not null out a newer instance's renderer/analyzer or kill its loop", async () => {
    const disposeA = initServices(fakeCanvas(), fakeHooks());
    await flush();
    const rendererA = getRenderer();
    expect(rendererA).toBeInstanceOf(WebGPURenderer);
    const analyzerA = getAnalyzer(); // must not throw

    // A second instance starts WITHOUT the first being disposed first —
    // the overlapping-lifecycle scenario this guard exists for.
    const disposeB = initServices(fakeCanvas(), fakeHooks());
    await flush();
    const rendererB = getRenderer();
    const analyzerB = getAnalyzer();
    expect(rendererB).not.toBe(rendererA);
    expect(analyzerB).not.toBe(analyzerA);

    // Instance A's stale teardown runs LATE, after B has already taken over.
    disposeA();

    // B's renderer/analyzer must be completely unaffected: same references,
    // not disposed, getAnalyzer() still resolves.
    expect(getRenderer()).toBe(rendererB);
    expect(getAnalyzer()).toBe(analyzerB);
    expect(disposeMock(rendererB)).not.toHaveBeenCalled();

    // A must still have cleaned up its OWN resources, though — disposeA
    // doesn't get to skip that just because it's stale.
    expect(disposeMock(rendererA)).toHaveBeenCalled();
    expect(getEngine()).toBeDefined(); // sanity: services are still up (B's)

    // B can still be torn down normally afterwards.
    disposeB();
    expect(getRenderer()).toBeNull();
    expect(() => getAnalyzer()).toThrow();
  });

  it("normal (non-overlapping) teardown still fully releases renderer/analyzer/engine", async () => {
    const dispose = initServices(fakeCanvas(), fakeHooks());
    await flush();
    expect(getRenderer()).not.toBeNull();

    dispose();

    expect(getRenderer()).toBeNull();
    expect(() => getAnalyzer()).toThrow();
    expect(() => getEngine()).toThrow();
  });
});

/**
 * L8 regression: the frame loop used to cache the ACTIVE preset by its
 * string id (`rf.presetId !== currentPresetId`). Saving an edited custom
 * preset in the Shader Editor re-registers a brand-new object under the
 * SAME id (render/presets/custom.ts's registry just replaces the map
 * entry) — so whenever that id was already what the loop had cached (e.g.
 * a scene elsewhere in the timeline reusing the same custom preset), the
 * id-keyed comparison never noticed the def had changed, and the renderer
 * kept the stale, already-compiled pipeline. The fix caches the RESOLVED
 * DEF (by reference) instead of the id string.
 *
 * The loop's requestAnimationFrame is driven manually here (capture the
 * callback, invoke it directly) instead of letting it free-run, so each
 * "frame" is deterministic and the test can mutate the registry BETWEEN
 * two ticks and assert exactly what got pushed to the (mocked) renderer.
 */
describe("services.ts frame loop — custom preset def cache (L8)", () => {
  const PRESET_ID = "custom-l8-test";

  afterEach(() => {
    unregisterCustomPreset(PRESET_ID);
  });

  it("re-pushes an edited custom preset to the renderer even though its id is unchanged across frames", async () => {
    const defA = { id: PRESET_ID, name: "A", params: [], wgsl: "// A" } as unknown as PresetDef;
    registerCustomPreset(defA);

    // A plain mutable box, not a reassigned `let`: captured-and-reassigned
    // closure variables trip up some TS control-flow-narrowing edge cases
    // (the assignment lives inside a callback passed to vi.fn, not in this
    // function's own linear flow) — a box sidesteps that entirely.
    const rafBox: { cb: ((t: number) => void) | null } = { cb: null };
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: (t: number) => void) => {
        rafBox.cb = cb;
        return 1;
      }),
    );

    const dispose = initServices(
      fakeCanvas(),
      fakeHooks({
        getFrameInput: () =>
          ({
            timeline: EMPTY_TIMELINE,
            basePresetId: PRESET_ID,
            baseParams: {},
            baseMods: [],
            baseBg: {} as BgSettings,
            paramsByPreset: {},
            modsByPreset: {},
          }) as FrameResolveInput,
      }),
    );
    await flush(); // installRenderer resolves and arms the first rAF

    const setPreset = (getRenderer() as unknown as { setPreset: ReturnType<typeof vi.fn> })
      .setPreset;

    // Frame 1: first time this preset id is seen — must push defA.
    rafBox.cb?.(16);
    expect(setPreset).toHaveBeenLastCalledWith(defA);
    const callsAfterFrame1 = setPreset.mock.calls.length;

    // Frame 2: same id, same (unedited) def — must NOT re-push.
    rafBox.cb?.(32);
    expect(setPreset).toHaveBeenCalledTimes(callsAfterFrame1);

    // The user edits the shader and saves — re-registered under the SAME
    // id, but as a genuinely new object (exactly what saveCustomPreset does
    // in store.ts via validCustomPreset + registerCustomPreset).
    const defB = {
      id: PRESET_ID,
      name: "A",
      params: [],
      wgsl: "// B, edited",
    } as unknown as PresetDef;
    registerCustomPreset(defB);

    // Frame 3: id is STILL unchanged from frames 1/2 — only the fix (caching
    // by resolved def reference, not id) makes this push the fresh def.
    rafBox.cb?.(48);
    expect(setPreset).toHaveBeenLastCalledWith(defB);

    dispose();
  });
});
