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
    /** Mutable stand-in for the real getter — the loop's only license to
     * advance texture-feedback state (see the feedback-directive suite). */
    feedbackTicked = false;
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

import {
  getAnalyzer,
  getEngine,
  getLiveRouteValues,
  getLiveStemValues,
  getRenderer,
  initServices,
  type ServiceHooks,
} from "./services";
import { WebGPURenderer } from "../render/webgpuRenderer";
import type { PresetDef, BgSettings } from "../render/types";
import { DEFAULT_POST } from "../render/types";
import type { FrameResolveInput } from "./frameResolve";
import { EMPTY_TIMELINE } from "./timeline";
import { registerCustomPreset, unregisterCustomPreset } from "../render/presets/custom";
import type { ModRoute } from "./modMatrix";
import type { AudioFeatures } from "../audio/types";

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
    getPost: () => DEFAULT_POST,
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

/**
 * P-1 stage 3 (D7): the ONE loop-side publish the Modulation source meters
 * need. The meter must not call stemValuesAt() itself — that allocates a
 * second 28-key Record per frame AND resolves it at a track time the loop may
 * not have used, producing a meter that disagrees with the render for reasons
 * that look like a modulation bug. So the loop hands over the very object it
 * modulated with, in the shape presentedFrames is published in: one slot, one
 * assignment, one plain getter, no subscription and no store write.
 */
describe("services.ts frame loop — live stem publication (P-1 stage 3)", () => {
  const PRESET_ID = "custom-stem-publish-test";

  afterEach(() => {
    unregisterCustomPreset(PRESET_ID);
  });

  it("publishes the loop's OWN stem record per frame and drops it on teardown", async () => {
    registerCustomPreset({
      id: PRESET_ID,
      name: "S",
      params: [],
      wgsl: "// s",
    } as unknown as PresetDef);

    const rafBox: { cb: ((t: number) => void) | null } = { cb: null };
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: (t: number) => void) => {
        rafBox.cb = cb;
        return 1;
      }),
    );

    // Distinct object per call, so identity — not just deep equality — proves
    // the meter reads what the loop resolved rather than a lookalike.
    const records: Array<Record<string, number>> = [{ "stem1:kick": 0.25 }, { "stem1:kick": 0.75 }];
    let frame = 0;

    const dispose = initServices(
      fakeCanvas(),
      fakeHooks({
        getStemValues: () => records[Math.min(frame, records.length - 1)],
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
    await flush();

    rafBox.cb?.(16);
    expect(getLiveStemValues()).toBe(records[0]);

    frame = 1;
    rafBox.cb?.(32);
    expect(getLiveStemValues()).toBe(records[1]);

    // Teardown clears it: a meter mounted after the session ended must not
    // read a stale Record from a loop that no longer exists.
    dispose();
    expect(getLiveStemValues()).toBeUndefined();
  });

  it("reports undefined — never an empty object — when no stems are loaded", async () => {
    registerCustomPreset({
      id: PRESET_ID,
      name: "S",
      params: [],
      wgsl: "// s",
    } as unknown as PresetDef);

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
        // No getStemValues hook at all — the common case.
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
    await flush();

    rafBox.cb?.(16);
    // sourceValue()'s `stems?.[source] ?? 0` treats undefined as "no signal",
    // exactly like an unloaded stem — no branch needed at the meter.
    expect(getLiveStemValues()).toBeUndefined();

    dispose();
  });
});

/**
 * H9: the Modulation page's route meters read a value published straight out
 * of THIS frame's own evaluation — never a second call through the private,
 * memo-mutating routeValue(). These tests drive the REAL loop (mocking only
 * the analyzer's per-frame features, the same lever the stem tests above
 * use) so the published numbers are the loop's actual arithmetic, not a
 * stand-in for it, and the lag memory is the loop's own modEval — there is
 * no seam to reach it from outside, which is by design (T19 in
 * ModMeters.test.tsx forbids a src/ui file from importing it at all).
 */
describe("services.ts frame loop — live route-value publication (H9)", () => {
  const PRESET_ID = "custom-route-publish-test";
  const PARAM_KEY = "decay";
  const ROUTE_ID = "r1";
  // A PRESET-param target (never post:*): the mocked WebGPURenderer in this
  // file's top-level mock does not implement setPost, so a route that made
  // applyPostMods return a changed object would throw here. applyMods needs
  // no such method — render() alone covers it.
  const ROUTE: ModRoute = {
    id: ROUTE_ID,
    source: "bass",
    param: PARAM_KEY,
    amount: 0.5,
    attack: 1,
    release: 1,
  };

  afterEach(() => {
    unregisterCustomPreset(PRESET_ID);
  });

  /** Registers the shared preset, arms a manually-driven rAF and starts the
   *  loop; the caller wires the analyzer mock afterwards (it needs the
   *  instance initServices creates). */
  function rig(mods: ModRoute[]) {
    registerCustomPreset({
      id: PRESET_ID,
      name: "R",
      params: [{ key: PARAM_KEY, label: "Decay", min: 0, max: 1, step: 0.01, default: 0 }],
      wgsl: "// r",
    } as unknown as PresetDef);

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
            baseMods: mods,
            baseBg: {} as BgSettings,
            paramsByPreset: {},
            modsByPreset: {},
          }) as FrameResolveInput,
      }),
    );
    return { rafBox, dispose };
  }

  it("publishes the post-lag value mid-transient, distinct from the instant target", async () => {
    const { rafBox, dispose } = rig([ROUTE]);
    await flush();
    const state = { time: 0, bass: 0 };
    (getAnalyzer() as unknown as { update: ReturnType<typeof vi.fn> }).update.mockImplementation(
      () => ({ time: state.time, bass: state.bass }) as unknown as AudioFeatures,
    );

    // Frame 1 (t=0): first-ever evaluation of this route snaps to target —
    // by definition equal to the instant value, nothing to observe yet.
    rafBox.cb?.(16);
    expect(getLiveRouteValues().get(ROUTE_ID)).toBe(0);

    // The source jumps to 1 with a 1 s attack in effect: 50 ms later the
    // smoothed value can only have covered a small fraction of the gap.
    state.bass = 1;
    state.time = 0.05;
    rafBox.cb?.(66);

    const published = getLiveRouteValues().get(ROUTE_ID)!;
    const instant = 1; // shapedValue(undefined, bass) === bass: a linear route
    expect(published).toBeGreaterThan(0);
    expect(published).toBeLessThan(instant);
    expect(published).not.toBe(instant);
    // The exact EMA step routeValue()'s docblock in modMatrix.ts specifies:
    // value += (target - value) * (1 - exp(-dt/tau)), from value=0.
    expect(published).toBeCloseTo(1 - Math.exp(-0.05 / 1), 10);

    dispose();
  });

  it("never advances the memo beyond the loop's own frames — extra publish reads change nothing", async () => {
    const { rafBox, dispose } = rig([ROUTE]);
    await flush();
    const state = { time: 0, bass: 0 };
    (getAnalyzer() as unknown as { update: ReturnType<typeof vi.fn> }).update.mockImplementation(
      () => ({ time: state.time, bass: state.bass }) as unknown as AudioFeatures,
    );

    rafBox.cb?.(16); // frame 1, t=0: snaps to 0
    state.bass = 1;
    state.time = 0.05;
    rafBox.cb?.(66); // frame 2, t=0.05
    const afterFrame2 = getLiveRouteValues().get(ROUTE_ID)!;

    // "Tick the driver" several times between loop frames without the loop
    // itself running: getLiveRouteValues() is a Map read and nothing else,
    // so re-reading the publish must be exactly as inert as it looks.
    for (let i = 0; i < 5; i++) {
      expect(getLiveRouteValues().get(ROUTE_ID)).toBe(afterFrame2);
    }

    // Frame 3: another 0.05 s at the still-rising target. If the reads above
    // — or the publish step itself — had sneaked in an extra advance of
    // memo.value/memo.time, this frame would land somewhere other than the
    // one-EMA-step prediction from frame 2's own published value.
    state.time = 0.1;
    rafBox.cb?.(116);
    const predicted = afterFrame2 + (1 - afterFrame2) * (1 - Math.exp(-0.05 / 1));
    expect(getLiveRouteValues().get(ROUTE_ID)).toBeCloseTo(predicted, 9);

    dispose();
  });

  it("a lag-less route's published value is bit-exact with the instant curve computation", async () => {
    const LAGLESS_ID = "r2";
    const lagless: ModRoute = {
      id: LAGLESS_ID,
      source: "rms",
      param: PARAM_KEY,
      amount: 0.3,
      curve: "exp",
      // No attack/release: routeValue() returns the instant target and never
      // touches state.routes for this id — the v1 path, unconditionally.
    };
    const { rafBox, dispose } = rig([ROUTE, lagless]);
    await flush();
    (getAnalyzer() as unknown as { update: ReturnType<typeof vi.fn> }).update.mockImplementation(
      () => ({ time: 0, bass: 0, rms: 0.5 }) as unknown as AudioFeatures,
    );

    rafBox.cb?.(16);
    // exp curve: 0.5² = 0.25 — bit-exact, no attack/release ever touches it.
    expect(getLiveRouteValues().get(LAGLESS_ID)).toBe(0.25);

    dispose();
  });

  it("publishes one entry per active route and drops the Map's contents on teardown", async () => {
    const { rafBox, dispose } = rig([ROUTE]);
    await flush();
    (getAnalyzer() as unknown as { update: ReturnType<typeof vi.fn> }).update.mockImplementation(
      () => ({ time: 0, bass: 0 }) as unknown as AudioFeatures,
    );

    rafBox.cb?.(16);
    expect(getLiveRouteValues().get(ROUTE_ID)).toBe(0);
    expect(getLiveRouteValues().size).toBe(1);

    // Same contract as getLiveStemValues(): a meter mounted after the
    // session ended must not read a stale entry from a loop that is gone.
    dispose();
    expect(getLiveRouteValues().size).toBe(0);
  });
});

/**
 * Pause-tick gate wiring (2.104.2): the loop's texture-feedback advance
 * directives derive from `ana.feedbackTicked` and from NOTHING else — no
 * wall-clock, frame-count or rAF-cadence source of its own. The analyzer
 * gates that report on `engine.playing` (realtimeSource.test.ts pins the
 * gate itself); this suite pins the mapping so a paused analyzer — which
 * never reports a tick — can never see an advance directive leave the loop,
 * on the presented path or toward the perform mirror (which replays these
 * exact directives).
 */
describe("services.ts frame loop — feedback directives follow the analyzer's tick report", () => {
  const PRESET_ID = "custom-feedback-directive-test";

  afterEach(() => {
    unregisterCustomPreset(PRESET_ID);
  });

  it("ticked frames advance-and-present; untick-ed frames present-only — never advance", async () => {
    registerCustomPreset({
      id: PRESET_ID,
      name: "F",
      params: [],
      wgsl: "// f",
    } as unknown as PresetDef);

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
    await flush();

    const ana = getAnalyzer() as unknown as { feedbackTicked: boolean };
    const render = (getRenderer() as unknown as { render: ReturnType<typeof vi.fn> }).render;
    const directiveOf = (call: unknown[]) => (call[4] as { feedback: string }).feedback;
    const lastDirective = () => directiveOf(render.mock.calls[render.mock.calls.length - 1]);

    // A ticked frame is the canonical 60 Hz state step: advance-and-present.
    ana.feedbackTicked = true;
    rafBox.cb?.(16);
    expect(lastDirective()).toBe("advance-and-present");

    // Un-ticked frames — a paused analyzer reports every frame this way —
    // present the existing state and must NEVER advance it, no matter how
    // many wall-clock frames go by.
    ana.feedbackTicked = false;
    for (let n = 0; n < 10; n++) rafBox.cb?.(32 + n * 16);
    const unticked = render.mock.calls.slice(-10).map(directiveOf);
    expect(unticked).toEqual(Array(10).fill("present-only"));

    // Ticks resume (the resume-after-pause path): advance returns.
    ana.feedbackTicked = true;
    rafBox.cb?.(200);
    expect(lastDirective()).toBe("advance-and-present");

    dispose();
  });
});
