import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDocument } from "./project";

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
  peekAnalyzer: vi.fn(() => null),
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

/**
 * R2-22 (owner verdict): stepping is a WALK, not a toggle. stepPreset used to
 * compute from the CURRENT mode even with a queue pending, so the second `]`
 * re-targeted the already-pending chip and queuePreset's cancel-toggle ate it
 * — `]]` under quantize meant "queue, then cancel" instead of "two along".
 * Steps now compute from the pending target when one exists (bypassing the
 * cancel branch by construction); a direct chip tap on the pending target
 * keeps its cancel-toggle untouched.
 */
describe("stepPreset walks from the pending target under quantize (R2-22)", () => {
  /** Steps walk the STRIP order, which diverges from the registry array —
   * expectations must come from the same orderedPresets the action reads. */
  async function queuedPosture() {
    const { useVizStore } = await import("./store");
    const { orderedPresets } = await import("./presetOrder");
    const strip = orderedPresets(useVizStore.getState().presetOrder, []);
    useVizStore.setState({
      presetId: strip[0].id,
      customDefs: [],
      switchQuantize: "beat",
      playback: { ...useVizStore.getState().playback, playing: true },
      beatGrid: { bpm: 120, beatTimes: Float32Array.from([0, 0.5, 1, 1.5, 2]), hopSec: 0.0116 },
      pendingPresetId: null,
    });
    return { useVizStore, strip };
  }

  it("two steps queue two modes ahead, not a cancel", async () => {
    const { useVizStore, strip } = await queuedPosture();

    useVizStore.getState().stepPreset(1);
    useVizStore.getState().stepPreset(1);

    expect(useVizStore.getState().presetId).toBe(strip[0].id); // still queued
    expect(useVizStore.getState().pendingPresetId).toBe(strip[2].id);
  });

  it("a step back after a step forward cancels the queue (back where you are)", async () => {
    const { useVizStore, strip } = await queuedPosture();

    useVizStore.getState().stepPreset(1);
    useVizStore.getState().stepPreset(-1);

    expect(useVizStore.getState().presetId).toBe(strip[0].id);
    expect(useVizStore.getState().pendingPresetId).toBeNull();
  });

  it("a chip tap on the pending target still cancel-toggles (chip semantics preserved)", async () => {
    const { useVizStore, strip } = await queuedPosture();

    useVizStore.getState().stepPreset(1);
    expect(useVizStore.getState().pendingPresetId).toBe(strip[1].id);
    useVizStore.getState().queuePreset(strip[1].id); // the chip's own tap

    expect(useVizStore.getState().presetId).toBe(strip[0].id);
    expect(useVizStore.getState().pendingPresetId).toBeNull();
  });
});

/**
 * F2 regression: the export worker builds its own WebGPU device, so on the
 * Canvas2D fallback exportCore throws GpuInitError — but it only got there
 * after the native save dialog, the overlay raster and a full decode, and a
 * batch paid that price once per queued track. Both entry points must refuse
 * BEFORE any of that, so the file picker never opens for a file that was
 * never going to be written.
 *
 * rasterizeOverlay is the sentinel: it is the first real work runExport does
 * after the dialog, so its call count not moving is the proof that nothing
 * started. Counts are read as deltas, not absolutes, because refreshOverlay
 * (exercised above) shares the mock.
 */
describe("export and batch refuse to start on the simplified renderer (F2)", () => {
  afterEach(async () => {
    const { useVizStore } = await import("./store");
    useVizStore.setState({
      simplifiedRenderer: false,
      exportError: null,
      batchError: null,
      batch: null,
    });
  });

  it("runExport sets the reason and does no work at all", async () => {
    const { useVizStore } = await import("./store");
    const { rasterizeOverlay } = await import("../render/overlay");
    const { SIMPLIFIED_EXPORT_REASON } = await import("./exportConfig");

    useVizStore.setState({ simplifiedRenderer: true, exportError: null, exporting: null });
    const before = vi.mocked(rasterizeOverlay).mock.calls.length;

    await useVizStore.getState().runExport();

    expect(useVizStore.getState().exportError).toBe(SIMPLIFIED_EXPORT_REASON);
    expect(useVizStore.getState().exporting).toBeNull();
    expect(vi.mocked(rasterizeOverlay).mock.calls.length).toBe(before);
  });

  it("startBatch refuses before the output-folder dialog, leaving the queue intact", async () => {
    const { useVizStore } = await import("./store");
    const { SIMPLIFIED_EXPORT_REASON } = await import("./exportConfig");

    const track = {
      id: "t1",
      file: new File([], "a.mp3"),
      meta: { title: "a", artist: "" },
      metaFromTags: false,
      coverArt: null,
      duration: 10,
    };
    useVizStore.setState({
      simplifiedRenderer: true,
      batchError: null,
      batchStatus: "idle",
      batch: {
        // Never read: startBatch returns long before runBatch touches it.
        doc: {} as unknown as ProjectDocument,
        tracks: [track],
        formats: [],
        outDir: "",
        startedAt: 0,
        jobs: [],
      },
    });

    await useVizStore.getState().startBatch();

    // The reason lands in batchError — the surface the batch panel renders
    // (SS-3) — never in exportError, which only ExportDialog shows.
    expect(useVizStore.getState().batchError).toBe(SIMPLIFIED_EXPORT_REASON);
    expect(useVizStore.getState().exportError).toBeNull();
    // Nothing was consumed: the tracks the user queued are still queued, so
    // this reads as "not yet", not "your list is gone".
    expect(useVizStore.getState().batchStatus).toBe("idle");
    expect(useVizStore.getState().batch?.tracks).toHaveLength(1);
    expect(useVizStore.getState().batch?.jobs).toHaveLength(0);
  });

  it("leaves both paths untouched when hardware rendering is available", async () => {
    const { useVizStore } = await import("./store");

    // The guards are the ONLY thing this fix adds to these actions, so the
    // control case is that neither fires: startBatch falls through to the
    // pre-existing desktop-only guard instead of the WebGPU one.
    useVizStore.setState({
      simplifiedRenderer: false,
      batchError: null,
      batchStatus: "idle",
      batch: {
        // Never read: startBatch returns long before runBatch touches it.
        doc: {} as unknown as ProjectDocument,
        tracks: [
          {
            id: "t1",
            file: new File([], "a.mp3"),
            meta: { title: "a", artist: "" },
            metaFromTags: false,
            coverArt: null,
            duration: 10,
          },
        ],
        formats: [],
        outDir: "",
        startedAt: 0,
        jobs: [],
      },
    });

    await useVizStore.getState().startBatch();

    expect(useVizStore.getState().batchError).toBe(
      "Batch render needs the desktop app (it writes files to a folder)",
    );
  });
});

/**
 * P-1 / R11 regression: stage mode used to CLOSE Visuals
 * (`set({ showPanel: false })`). That was a raw destructive write — it
 * bypassed setShowPanel, so prefs kept the old value and there was no restore
 * on the way out: every demo, every capture, every S-keypress cost the user
 * their open workspace.
 *
 * The dock is suppressed by layout instead (`.app.stage-mode` zeroes
 * --visuals-w and `.app.stage-mode .chrome` hides it), which is stateless,
 * so the only thing left to assert is that the store does not touch
 * `showPanel` in EITHER branch. Asserting the exit branch matters too: the
 * tempting "fix" is setShowPanel(true) on exit, which would write
 * panelOpen: true for users who never opened the dock at all.
 */
describe("stage mode leaves Visuals alone (P-1)", () => {
  it("keeps an open dock open through a full S / S round-trip", async () => {
    const { useVizStore } = await import("./store");

    useVizStore.setState({ showPanel: true, stageMode: false, blackout: false });

    useVizStore.getState().setStageMode(true);
    expect(useVizStore.getState().showPanel).toBe(true);
    expect(useVizStore.getState().stageMode).toBe(true);
    // The panels stage mode DOES close are unchanged by this fix.
    expect(useVizStore.getState().showTimeline).toBe(false);
    expect(useVizStore.getState().showHelp).toBe(false);

    useVizStore.getState().setStageMode(false);
    expect(useVizStore.getState().showPanel).toBe(true);
    expect(useVizStore.getState().stageMode).toBe(false);
  });

  it("does not open a closed dock on the way out", async () => {
    const { useVizStore } = await import("./store");

    useVizStore.setState({ showPanel: false, stageMode: false, blackout: true });

    useVizStore.getState().setStageMode(true);
    expect(useVizStore.getState().showPanel).toBe(false);

    useVizStore.getState().setStageMode(false);
    expect(useVizStore.getState().showPanel).toBe(false);
    // Leaving stage still clears blackout — untouched by this change.
    expect(useVizStore.getState().blackout).toBe(false);
  });
});

/**
 * Strip display order. The store owns it because three surfaces have to agree
 * on one sequence — the chips, the N/P step keys, and the 1-9 number keys —
 * and because a change has to reach the strip immediately, not on next launch.
 */
describe("preset display order", () => {
  it("persists a custom order into prefs, reconciled", async () => {
    const { useVizStore } = await import("./store");
    const { getPrefs } = await import("./prefs");
    const { defaultPresetOrder, stripPresetIds } = await import("./presetOrder");

    // A partial, slightly dirty list — what a caller (or an older build's
    // stored value) can realistically hand over.
    useVizStore.getState().setPresetOrder(["synthwave", "aurora", "gone-in-this-build"]);

    const order = useVizStore.getState().presetOrder;
    expect(order.slice(0, 2)).toEqual(["synthwave", "aurora"]);
    expect(order).not.toContain("gone-in-this-build");
    // Nothing may go missing: every mode still has a chip.
    expect([...order].sort()).toEqual([...stripPresetIds()].sort());
    expect(getPrefs().presetOrder).toEqual(order);

    useVizStore.getState().resetPresetOrder();
    expect(useVizStore.getState().presetOrder).toEqual(defaultPresetOrder());
    // Stored EMPTY, not the resolved list: "never customised" has to keep
    // meaning "follow whatever order the app ships", including after an update
    // that changes the default.
    expect(getPrefs().presetOrder).toEqual([]);
  });

  it("steps along the strip's order, not the registry array", async () => {
    const { useVizStore } = await import("./store");

    useVizStore.getState().setPresetOrder(["synthwave", "aurora"]);
    useVizStore.setState({
      presetId: "synthwave",
      customDefs: [],
      switchQuantize: "off",
      pendingPresetId: null,
    });

    useVizStore.getState().stepPreset(1);

    // Registry order would have gone synthwave -> bass-circle.
    expect(useVizStore.getState().presetId).toBe("aurora");

    useVizStore.getState().resetPresetOrder();
  });
});
