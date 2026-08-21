import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Renderer } from "../render/types";
import { DEFAULT_MOTION, DEFAULT_POST } from "../render/types";
import type { AudioFeatures } from "../audio/types";
import type {
  PerformChannel,
  PerformFrameMsg,
  PerformLiveMsg,
  PerformSceneMsg,
} from "../state/performBridge";
import {
  degradeFeedback,
  nextPresentPolicy,
  startPerformRuntime,
  DEGRADE_LAG_MS,
  RECOVER_LAG_MS,
  type PerformRuntimeCallbacks,
} from "./performRuntime";

/**
 * FEAT-009 receiver contract: hello on boot, frames become the primary's
 * own renderer-call sequence (with the same identity caching), state tiers
 * re-prime, and the backpressure policy degrades presentation — never
 * feedback STATE. The channel and renderer are injected; the real GPU +
 * BroadcastChannel pair is device-verified.
 */

class FakeChannel implements PerformChannel {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  postMessage(msg: unknown): void {
    this.sent.push(msg);
  }
  close(): void {
    this.closed = true;
  }
  deliver(msg: unknown): void {
    this.onmessage?.({ data: msg } as MessageEvent);
  }
}

function fakeRenderer(): Renderer {
  return {
    kind: "webgpu",
    render: vi.fn(),
    setTransitionPreset: vi.fn(),
    resize: vi.fn(),
    setPreset: vi.fn(),
    setBackground: vi.fn(),
    setOverlay: vi.fn(),
    setCoverArt: vi.fn(),
    setLyricPlate: vi.fn(),
    setBuilderParams: vi.fn(),
    setBackgroundImage: vi.fn(),
    updateBackgroundVideoFrame: vi.fn(),
    setSmoothSpectrum: vi.fn(),
    setDeepCapture: vi.fn(),
    readbackDeepFrame: vi.fn(() => Promise.reject(new Error("n/a"))),
    setMotion: vi.fn(),
    setPost: vi.fn(),
    dispose: vi.fn(),
  } as unknown as Renderer;
}

function fakeFeatures(): AudioFeatures {
  return {
    bins: new Float32Array(4),
    peaks: new Float32Array(4),
    waveform: new Float32Array(4),
    waveformL: new Float32Array(4),
    waveformR: new Float32Array(4),
    rms: 0,
    energy: 0,
    voice: 0,
    drive: 0,
    driveBeat: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    width: 0,
    lufs: -70,
    kick: 0,
    snare: 0,
    hat: 0,
    bpm: 0,
    beatPhase: 0,
    barPhase: 0,
    beat: false,
    beatIntensity: 0,
    time: 0,
    duration: 60,
  };
}

let clock = 1_000_000;

function frameMsg(overrides: Partial<PerformFrameMsg> = {}): PerformFrameMsg {
  return {
    type: "frame",
    seq: 0,
    sentAt: clock,
    t: 1,
    features: fakeFeatures(),
    presetId: "nebula",
    params: {},
    prevPresetId: null,
    prevParams: null,
    mix: 1,
    transitionKind: 0,
    bg: { mode: 0, color: [0, 0, 0] },
    post: DEFAULT_POST,
    builderPack: null,
    feedback: "present-only",
    ...overrides,
  };
}

function liveMsg(overrides: Partial<PerformLiveMsg> = {}): PerformLiveMsg {
  return {
    type: "live",
    blackout: false,
    hud: false,
    aspect: "free",
    motion: DEFAULT_MOTION,
    smoothSpectrum: false,
    ...overrides,
  };
}

function sceneMsg(overrides: Partial<PerformSceneMsg> = {}): PerformSceneMsg {
  return {
    type: "scene",
    customDefs: [],
    builderStack: { layers: [] } as never,
    bgImageParams: null,
    bgVideoParams: null,
    overlay: { layers: [], meta: { title: "", artist: "" } },
    lyrics: null,
    audiogram: null,
    waveformOverview: null,
    ...overrides,
  };
}

function callbacks(): PerformRuntimeCallbacks & {
  statuses: string[];
  scenes: unknown[];
  names: string[];
} {
  const statuses: string[] = [];
  const scenes: unknown[] = [];
  const names: string[] = [];
  return {
    statuses,
    scenes,
    names,
    onStatus: (s) => statuses.push(s.phase),
    onScene: (v) => scenes.push(v),
    onPresetName: (n) => names.push(n),
  };
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 640,
    height: 360,
    style: {},
    getBoundingClientRect: () => ({ width: 640, height: 360 }) as DOMRect,
    parentElement: null,
  } as unknown as HTMLCanvasElement;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  clock = 1_000_000;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function start(renderer: Renderer, cb = callbacks(), channel = new FakeChannel()) {
  const handle = startPerformRuntime(fakeCanvas(), cb, {
    channelFactory: () => channel,
    createRenderer: () => Promise.resolve(renderer),
    now: () => clock,
  });
  return { handle, channel, cb };
}

describe("perform runtime", () => {
  it("says hello on boot and re-hellos when the publisher announces itself", () => {
    const { channel } = start(fakeRenderer());
    expect(channel.sent).toEqual([{ type: "hello" }]);
    channel.deliver({ type: "hi" });
    expect(channel.sent).toEqual([{ type: "hello" }, { type: "hello" }]);
  });

  it("buffers a frame that lands before the renderer exists and applies it on install", async () => {
    const r = fakeRenderer();
    const { channel, cb } = start(r);
    channel.deliver(frameMsg());
    expect(r.render).not.toHaveBeenCalled();
    await flush();
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(r.setPost).toHaveBeenCalledWith(DEFAULT_POST);
    expect(cb.statuses).toContain("live");
  });

  it("caches the preset def — one setPreset per mode, HUD name on change only", async () => {
    const r = fakeRenderer();
    const { channel, cb } = start(r);
    await flush();

    channel.deliver(frameMsg({ presetId: "nebula" }));
    channel.deliver(frameMsg({ presetId: "nebula" }));
    channel.deliver(frameMsg({ presetId: "aurora" }));

    expect(r.setPreset).toHaveBeenCalledTimes(2);
    expect(cb.names).toEqual(["Kaleido Nebula", "Aurora"]);
  });

  it("sets and clears the transition preset around a crossfade window", async () => {
    const r = fakeRenderer();
    const { channel } = start(r);
    await flush();

    channel.deliver(
      frameMsg({ prevPresetId: "aurora", prevParams: { hue: 1 }, mix: 0.5, transitionKind: 2 }),
    );
    expect(r.setTransitionPreset).toHaveBeenCalledTimes(1);
    const render = r.render as ReturnType<typeof vi.fn>;
    expect(render.mock.calls[0][3]).toEqual({ params: { hue: 1 }, mix: 0.5, kind: 2 });

    channel.deliver(frameMsg());
    expect(r.setTransitionPreset).toHaveBeenLastCalledWith(null);
    expect(render.mock.calls[1][3]).toBeUndefined();
  });

  it("dedupes builder packs by bytes, not identity (messages arrive cloned)", async () => {
    const r = fakeRenderer();
    const { channel } = start(r);
    await flush();

    channel.deliver(frameMsg({ builderPack: new Float32Array([1, 2]) }));
    channel.deliver(frameMsg({ builderPack: new Float32Array([1, 2]) }));
    channel.deliver(frameMsg({ builderPack: new Float32Array([1, 3]) }));

    expect(r.setBuilderParams).toHaveBeenCalledTimes(2);
  });

  it("applies live state to the renderer and surfaces blackout/hud/aspect to the host", async () => {
    const r = fakeRenderer();
    const { channel, cb } = start(r);
    await flush();

    channel.deliver(liveMsg({ blackout: true, hud: true, aspect: "16:9" }));

    expect(cb.scenes[cb.scenes.length - 1]).toEqual({ blackout: true, hud: true, aspect: "16:9" });
    expect(r.setMotion).toHaveBeenCalled();
    expect(r.setSmoothSpectrum).toHaveBeenCalledWith(false);
  });

  it("registers scene customDefs once — an identical re-send must not re-pipeline the active mode", async () => {
    const r = fakeRenderer();
    const { channel } = start(r);
    await flush();

    const def = {
      id: "custom-perform-test",
      name: "Perform Test",
      params: [],
      wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }",
    };
    channel.deliver(sceneMsg({ customDefs: [def] }));
    channel.deliver(frameMsg({ presetId: "custom-perform-test" }));
    expect(r.setPreset).toHaveBeenCalledTimes(1);

    // Same def again (fresh clone, same content): no identity churn, so the
    // next frame must not re-push the preset.
    channel.deliver(sceneMsg({ customDefs: [{ ...def }] }));
    channel.deliver(frameMsg({ presetId: "custom-perform-test" }));
    expect(r.setPreset).toHaveBeenCalledTimes(1);

    // A CHANGED def re-registers and re-pushes.
    channel.deliver(
      sceneMsg({
        customDefs: [
          { ...def, wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(0.0, uv, 1.0); }" },
        ],
      }),
    );
    channel.deliver(frameMsg({ presetId: "custom-perform-test" }));
    expect(r.setPreset).toHaveBeenCalledTimes(2);
  });

  it("degraded mode thins presentation but never advance ticks", async () => {
    const r = fakeRenderer();
    const { channel, handle } = start(r);
    await flush();

    // Sustained lag: sentAt far behind the receiver clock. The EMA needs a
    // few samples to cross DEGRADE_LAG_MS.
    for (let i = 0; i < 80; i++) {
      channel.deliver(frameMsg({ sentAt: clock - 400, feedback: "advance-and-present" }));
    }
    expect(handle.getStats().degraded).toBe(true);

    const render = r.render as ReturnType<typeof vi.fn>;
    render.mock.calls.length = 0;
    for (let i = 0; i < 9; i++) {
      channel.deliver(frameMsg({ sentAt: clock - 400, feedback: "advance-and-present" }));
    }
    const modes = render.mock.calls.map((c) => (c[4] as { feedback: string }).feedback);
    // Every tick still advanced state; only some presented.
    expect(modes).toHaveLength(9);
    expect(modes.filter((m) => m === "advance-and-present")).toHaveLength(3);
    expect(modes.filter((m) => m === "advance-only")).toHaveLength(6);
  });

  it("goes back to waiting (and knocks again) when frames stop", async () => {
    vi.useFakeTimers();
    try {
      const r = fakeRenderer();
      const cb = callbacks();
      const channel = new FakeChannel();
      start(r, cb, channel);
      await vi.advanceTimersByTimeAsync(0);

      channel.deliver(frameMsg());
      expect(cb.statuses).toContain("live");

      clock += 5000;
      await vi.advanceTimersByTimeAsync(1100);
      expect(cb.statuses[cb.statuses.length - 1]).toBe("waiting");
      expect(
        channel.sent.filter((m) => (m as { type: string }).type === "hello").length,
      ).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose says bye, closes the channel and disposes the renderer", async () => {
    const r = fakeRenderer();
    const { channel, handle } = start(r);
    await flush();

    handle.dispose();

    expect(channel.sent[channel.sent.length - 1]).toEqual({ type: "bye" });
    expect(channel.closed).toBe(true);
    expect(r.dispose).toHaveBeenCalled();
  });

  /**
   * R2-03: the overlay dedupe key used to omit lyric/audiogram state, so when
   * dynamics stopped (captions toggled off, lyrics removed, audiogram
   * disabled) applyOverlay early-outed on an unchanged key and the renderer
   * kept presenting the last COMPOSED frame — a baked caption, forever
   * (applySceneToRenderer clears only the lyric plate). The inactive
   * transition must push one dynamics-free overlay, mirroring the main
   * window's refreshOverlay else-branch.
   */
  it("captions off replaces the composed overlay with a clean one, not a stale key hit", async () => {
    // The compose path rasterizes through OffscreenCanvas; a minimal 2D
    // stand-in is enough — the assertions are about setOverlay traffic.
    const ctx2d = {
      measureText: () => ({ width: 10 }),
      save() {},
      restore() {},
      translate() {},
      scale() {},
      beginPath() {},
      rect() {},
      clip() {},
      strokeText() {},
      fillText() {},
      fillRect() {},
      drawImage() {},
    };
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return ctx2d;
        }
        transferToImageBitmap() {
          return { close: vi.fn() };
        }
      },
    );
    const r = fakeRenderer();
    const { channel } = start(r);
    await flush();
    const setOverlay = r.setOverlay as ReturnType<typeof vi.fn>;

    const lyrics = {
      lines: [{ t: 0, end: 10, text: "hello world" }],
      style: {
        enabled: true,
        position: "bottom" as const,
        size: 1,
        color: "#ffffff",
        fadeSec: 0.15,
        anim: "plain" as const,
      },
    };
    channel.deliver(sceneMsg({ lyrics }));
    await flush();
    // No overlay layers: the raster is null and the compose path owns pushes.
    expect(setOverlay).not.toHaveBeenCalled();

    channel.deliver(frameMsg({ t: 1 }));
    await flush();
    // Captions on: a composed overlay (caption baked in) reached the renderer.
    expect(setOverlay).toHaveBeenCalledTimes(1);
    expect(setOverlay.mock.calls[0][0]).not.toBeNull();

    channel.deliver(sceneMsg({ lyrics: null }));
    await flush();
    // Captions off: a NEW setOverlay lands, and it is the clean (caption-free)
    // overlay — with no static layers that means null, which clears.
    expect(setOverlay).toHaveBeenCalledTimes(2);
    expect(setOverlay.mock.calls[1][0]).toBeNull();

    channel.deliver(frameMsg({ t: 2 }));
    await flush();
    // ...and the frame stream composes nothing further.
    expect(setOverlay).toHaveBeenCalledTimes(2);
  });

  /**
   * R2-31i: the asset fingerprint used to sample length+head+tail, which
   * collides for same-length data URLs differing only in the middle (two
   * crops of one image, two re-encodes of one frame) — the receiver then
   * kept showing the OLD asset. The key is now FNV-1a over the full string.
   */
  it("same-length different-middle asset URLs get different keys (R2-31i)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ blob: async () => ({}) })),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ close: vi.fn() })),
    );
    const r = fakeRenderer();
    const { channel } = start(r);
    await flush();
    // Boot pushed the initial null clear — only the decode path counts.
    (r.setCoverArt as ReturnType<typeof vi.fn>).mockClear();

    // Same length, same first 48 chars, same last 16 — only the middle moves.
    const head = "data:image/png;base64,";
    const a = `${head}${"A".repeat(60)}X${"A".repeat(60)}`;
    const b = `${head}${"A".repeat(60)}Y${"A".repeat(60)}`;
    channel.deliver({
      type: "assets",
      coverUrl: a,
      bgImageUrl: null,
      bgVideoUrl: null,
      overlayAssets: {},
    });
    await flush();
    channel.deliver({
      type: "assets",
      coverUrl: b,
      bgImageUrl: null,
      bgVideoUrl: null,
      overlayAssets: {},
    });
    await flush();

    // Both covers were decoded and bound — the second was not deduped away.
    expect(r.setCoverArt).toHaveBeenCalledTimes(2);
  });
});

describe("present policy (pure)", () => {
  it("degrades above the high-water mark and recovers below the low one", () => {
    expect(nextPresentPolicy(false, DEGRADE_LAG_MS + 1)).toBe(true);
    expect(nextPresentPolicy(false, DEGRADE_LAG_MS - 1)).toBe(false);
    // Hysteresis: between the marks, the current state holds.
    expect(nextPresentPolicy(true, RECOVER_LAG_MS + 1)).toBe(true);
    expect(nextPresentPolicy(true, RECOVER_LAG_MS - 1)).toBe(false);
  });

  it("degrade keeps advance work and sheds presents", () => {
    expect(degradeFeedback("advance-and-present", true)).toBe("advance-and-present");
    expect(degradeFeedback("advance-and-present", false)).toBe("advance-only");
    expect(degradeFeedback("advance-only", false)).toBe("advance-only");
    expect(degradeFeedback("present-only", false)).toBeNull();
    expect(degradeFeedback("present-only", true)).toBe("present-only");
  });
});
