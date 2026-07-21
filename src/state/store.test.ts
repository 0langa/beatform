import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * M17 regression: initApp's teardown only ever called services' own
 * dispose() (engine/analyzer/renderer/rAF loop) — everything the STORE
 * itself retained outside React state was left dangling: a retained
 * ImageBitmap (overlayBase), up to 240 decoded video-bg frames (~220 MB),
 * a live Web MIDI listener, a 5s autosave timer that fires AFTER teardown
 * and writes stale data to disk, and a prefetched AudioBuffer for the
 * session (libraryPrefetch — not covered here; see note below).
 *
 * services.ts, platform.ts's writeAutosave, midiInput.ts's startMidi, and
 * the overlay/video-bg decode functions are mocked because none of their
 * real implementations (WebGPU, Web Audio, Tauri fs, Web MIDI, real video
 * decode) exist in this test environment — that's orthogonal to the bug,
 * which is store.ts's own bookkeeping on the teardown path.
 *
 * libraryPrefetch is not exercised here: populating it goes through
 * prefetchNextLibraryTrack (library scan + Tauri file read + decode), which
 * would need a disproportionate amount of additional mocking for a single
 * `= null` assignment identical in shape to the ones proven below.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("./services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

const midiStop = vi.fn();
vi.mock("./midiInput", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./midiInput")>();
  return {
    ...actual,
    startMidi: vi.fn(async () => ({ stop: midiStop })),
  };
});

function fakeBitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap;
}
const overlayBitmap = fakeBitmap();
const composedBitmap = fakeBitmap();
vi.mock("../render/overlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/overlay")>();
  return { ...actual, rasterizeOverlay: vi.fn(async () => overlayBitmap) };
});
vi.mock("../render/dynamicOverlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/dynamicOverlay")>();
  return { ...actual, composeOverlayFrame: vi.fn(async () => composedBitmap) };
});

const videoFrame1 = fakeBitmap();
const videoFrame2 = fakeBitmap();
vi.mock("../render/videoBg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/videoBg")>();
  return {
    ...actual,
    // disposeVideoBgFrames stays real (pure — just calls .close() on each
    // frame, no browser deps) — only the actual video decode needs faking.
    decodeVideoBgFrames: vi.fn(async () => ({ frames: [videoFrame1, videoFrame2], fps: 30 })),
  };
});
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ blob: async () => new Blob() })),
);

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 1,
    height: 1,
    getBoundingClientRect: () => ({ width: 1, height: 1 }),
  } as unknown as HTMLCanvasElement;
}

/**
 * These drive the REAL initApp/teardown against mocked dependencies, so each
 * one does genuine async work (engine init, MIDI enable, bitmap teardown)
 * rather than pure computation. Under heavy parallel load — several vitest
 * workers plus a dev server plus a build on the same box — that occasionally
 * ran past vitest's 5 s default and failed as a timeout, not as a logic
 * error. Since a red suite now blocks a RELEASE and not just a PR, a
 * load-sensitive timeout is a shipping hazard rather than an annoyance. The
 * generous budget costs nothing when these pass in milliseconds, which they
 * normally do.
 */
describe("store initApp teardown", { timeout: 30_000 }, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the autosave timer, so it never fires and writes after teardown", async () => {
    vi.useFakeTimers();
    const { useVizStore } = await import("./store");
    const { writeAutosave } = await import("./platform");

    const dispose = useVizStore.getState().initApp(fakeCanvas());
    // Any record()-ing action schedules a 5s-debounced autosave.
    const other =
      useVizStore.getState().presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";
    useVizStore.getState().switchPreset(other);

    dispose();
    await vi.advanceTimersByTimeAsync(6000);

    expect(writeAutosave).not.toHaveBeenCalled();
  });

  it("stops the MIDI listener on teardown", async () => {
    const { useVizStore } = await import("./store");
    const dispose = useVizStore.getState().initApp(fakeCanvas());

    await useVizStore.getState().enableMidi();
    expect(useVizStore.getState().midiEnabled).toBe(true);
    expect(midiStop).not.toHaveBeenCalled();

    dispose();
    expect(midiStop).toHaveBeenCalledTimes(1);
  });

  it("closes the retained overlay base bitmap on teardown", async () => {
    const { useVizStore } = await import("./store");
    const dispose = useVizStore.getState().initApp(fakeCanvas());

    // Lyrics active -> overlayDynamics has dynamics -> refreshOverlay retains
    // the rasterized base (not just the composed copy) so it can recompose
    // per-frame without re-rasterizing static layers every time.
    useVizStore.setState({ lyrics: [{ t: 0, end: null, text: "hi" }] });
    useVizStore.getState().refreshOverlay();
    // 60ms debounce + the two mocked async steps.
    await new Promise((r) => setTimeout(r, 150));

    expect(overlayBitmap.close).not.toHaveBeenCalled();

    dispose();
    expect(overlayBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("disposes decoded video-background frames on teardown", async () => {
    const { useVizStore } = await import("./store");
    const { BG_VIDEO } = await import("../render/types");
    const dispose = useVizStore.getState().initApp(fakeCanvas());

    useVizStore.setState({
      assets: { "vid-1": { id: "vid-1", name: "clip", dataUrl: "data:video/mp4;base64,AA" } },
    });
    useVizStore.getState().setBg({
      mode: BG_VIDEO,
      color: [0, 0, 0],
      video: { assetId: "vid-1", dim: 0.4, blur: 0 },
    });
    // fetch -> blob -> decodeVideoBgFrames, all mocked but still microtask/
    // macrotask-async.
    await new Promise((r) => setTimeout(r, 50));

    expect(videoFrame1.close).not.toHaveBeenCalled();

    dispose();
    expect(videoFrame1.close).toHaveBeenCalledTimes(1);
    expect(videoFrame2.close).toHaveBeenCalledTimes(1);
  });
});

/**
 * L11 regression: `[`/`]` (stepPreset) used to call switchPreset directly,
 * bypassing the beat-quantize takeover that the number-key path
 * (queuePreset) already honoured — pressing `]` during quantized playback
 * jumped instantly instead of landing on the next beat/bar like "1"-"9" do.
 * Fixed by routing stepPreset through queuePreset too, so both live-
 * performance paths defer to the same pendingPresetId mechanism.
 */
describe("stepPreset honours beat-quantize like the number-key path (L11)", () => {
  it("queues a pending switch instead of jumping instantly when quantize is on and a future boundary exists", async () => {
    const { useVizStore } = await import("./store");
    const { presets } = await import("../render/presets");

    useVizStore.setState({
      presetId: presets[0].id,
      customDefs: [],
      switchQuantize: "beat",
      playback: { ...useVizStore.getState().playback, playing: true },
      beatGrid: { bpm: 120, beatTimes: Float32Array.from([0, 0.5, 1, 1.5, 2]), hopSec: 0.0116 },
      pendingPresetId: null,
    });

    useVizStore.getState().stepPreset(1);

    // Not switched yet — queued, exactly like the "1"-"9" number-key path
    // (queuePreset) already behaves.
    expect(useVizStore.getState().presetId).toBe(presets[0].id);
    expect(useVizStore.getState().pendingPresetId).toBe(presets[1].id);
  });

  it("still switches instantly when quantize is off (no false positive)", async () => {
    const { useVizStore } = await import("./store");
    const { presets } = await import("../render/presets");

    useVizStore.setState({
      presetId: presets[0].id,
      customDefs: [],
      switchQuantize: "off",
      pendingPresetId: null,
    });

    useVizStore.getState().stepPreset(1);

    expect(useVizStore.getState().presetId).toBe(presets[1].id);
    expect(useVizStore.getState().pendingPresetId).toBeNull();
  });
});
