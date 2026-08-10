import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Type-only: erased at compile time, so these never hoist a module body above
// the global stubs below (the reason the value imports are dynamic).
import type { BeatGrid } from "../../audio/analysis/beatGrid";
import type { TrackAnalysis } from "../../audio/analysis/trackAnalysis";
import type { ExportOptions } from "../../export/videoExporter";

/**
 * E2-R2 — the interactive export must not build its job from a HALF-ANALYSED
 * track.
 *
 * `analyzeTrack` is async: loading a track sets `{ beatGrid: null,
 * sections: [], analyzing: true }` and only fills them in when the worker
 * replies. `runExport` read `get().beatGrid` at that instant, `null` included,
 * so an export fired right after a load rendered with no grid at all — bpm 0,
 * no beatPhase/barPhase, no beatIndex/barIndex, no sectionIndex/sectionPulse,
 * and (since v2.90.0) tempo-locked LFOs on their 120-BPM-equivalent fallback
 * clock — while the preview a moment later had the real grid. Measured on
 * device: 120/120 frames differed between an export fired immediately and the
 * same export after analysis; with analysis awaited first, 0/120.
 *
 * The batch runner has always got this right (batchRunner.ts:197-215 awaits
 * `analyzeTrack` per track and passes the grid into the job); these tests pin
 * the same rule onto the interactive path.
 *
 * WHY THE FAILURE IS REACHABLE IN EVERY CASE BELOW: the store is never
 * hand-posed into "mid-analysis". Each test calls the REAL
 * `analyzeCurrentTrack()` — the function `loadFile`/`loadDemo`/`playLibraryTrack`
 * all call — and holds the analysis promise open, which is byte-for-byte the
 * state a user has between dropping a file and the worker replying. Only
 * `analyzeTrack` itself (the worker facade) is faked, because a Worker does
 * not exist in this environment.
 *
 * Same mock surface as store.test.ts: services/overlay/videoExporter are faked
 * because WebGPU, Web Audio and a real encoder do not exist here, which is
 * orthogonal to the ordering under test.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
// `isTauri()` is `"__TAURI_INTERNALS__" in window` — a plain object answers
// false, which puts runExport on the browser lane: no save dialog, no disk
// preflight, so the analysis wait is the FIRST await in the action and the
// assertions below cannot be satisfied by some other pause.
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

const audioBuffer = {
  duration: 30,
  sampleRate: 48_000,
  numberOfChannels: 2,
  length: 30 * 48_000,
  getChannelData: () => new Float32Array(4096),
} as unknown as AudioBuffer;

const analyzer = { setSync: vi.fn(), setBeatGrid: vi.fn(), setSections: vi.fn(), reset: vi.fn() };

vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    audioBuffer,
    state: { trackName: "probe.wav" },
    currentTime: 0,
    duration: 30,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => analyzer),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

vi.mock("../../render/overlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../render/overlay")>();
  return { ...actual, rasterizeOverlay: vi.fn(async () => null) };
});

vi.mock("../../export/videoExporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../export/videoExporter")>();
  return {
    ...actual,
    exportVideo: vi.fn(async () => ({ blob: null, bytes: 1_000, audioCodec: "aac" })),
  };
});

vi.mock("../../audio/analysis/trackAnalysis", () => ({ analyzeTrack: vi.fn() }));

const { useVizStore } = await import("../store");
const { exportVideo } = await import("../../export/videoExporter");
const { analyzeTrack } = await import("../../audio/analysis/trackAnalysis");
const { ANALYSIS_TIMEOUT_MS } = await import("../batchRunner");
const { ANALYSIS_TIMEOUT_REASON } = await import("./exportActions");
const { shared } = await import("./shared");

const s = () => useVizStore.getState();

const GRID: BeatGrid = {
  bpm: 128,
  beatTimes: Float32Array.from([0, 0.469, 0.938, 1.406]),
  hopSec: 0.0116,
};
const SECTIONS = [0, 12.5, 25];

/** A promise whose settling this test owns — the analysis worker's reply. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The options object the export JOB was actually built from. */
function jobOptions(): ExportOptions {
  return vi.mocked(exportVideo).mock.calls[0][1];
}

/** Start a real analysis whose worker reply this test controls. */
function startAnalysis() {
  const gate = deferred<TrackAnalysis>();
  vi.mocked(analyzeTrack).mockReturnValue({ id: 1, result: gate.promise });
  s().analyzeCurrentTrack();
  return gate;
}

beforeEach(() => {
  vi.mocked(exportVideo).mockClear();
  vi.mocked(analyzeTrack).mockReset();
  // Every "no job was built" assertion below would pass VACUOUSLY if runExport
  // bailed at its re-entrancy guard instead of at the thing under test, and a
  // test that left an export in flight would arm exactly that. Clear the claim
  // between tests, and pair each such assertion with proof the action really
  // reached its progress state.
  shared.exportStarting = false;
  shared.exportAbort = null;
  useVizStore.setState({
    simplifiedRenderer: false,
    exporting: null,
    exportError: null,
    exportDone: null,
    batchStatus: "idle",
    beatGrid: null,
    sections: [],
    analyzing: false,
    trackKey: null,
    lyrics: null,
    exportSettings: { ...s().exportSettings, mode: "video", format: "mp4", codec: "h264" },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an export started mid-analysis waits for the grid (E2-R2)", () => {
  it("builds the job from the ANALYSED grid, never the pre-analysis null", async () => {
    const gate = startAnalysis();
    // Exactly what loadFile leaves behind while the worker is busy.
    expect(s().analyzing).toBe(true);
    expect(s().beatGrid).toBeNull();
    expect(s().sections).toEqual([]);

    const run = s().runExport();
    // Several microtask turns: enough for the whole (mocked) export to have
    // built and finished its job had nothing been waiting on. Deliberately no
    // assertion here — the claim is about the JOB's payload, so let an
    // unguarded implementation build its job and be judged on what is in it.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    gate.resolve({ grid: GRID, key: null, sections: SECTIONS });
    await run;

    expect(exportVideo).toHaveBeenCalledTimes(1);
    expect(jobOptions().beatGrid).toEqual(GRID);
    expect(jobOptions().sections).toEqual(SECTIONS);
    expect(s().exportError).toBeNull();
  });

  it("has not started the render while analysis is still in flight", async () => {
    const gate = startAnalysis();

    const run = s().runExport();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(exportVideo).not.toHaveBeenCalled();
    // …and the panel is already in its progress state, so the wait happens
    // behind a visible Cancel rather than a dead button.
    expect(s().exporting).not.toBeNull();

    gate.resolve({ grid: GRID, key: null, sections: SECTIONS });
    await run;
  });

  it("still exports immediately when the track is already analysed", async () => {
    // Analysis complete: the wait must be a no-op, not merely a short one.
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    // A real (unfaked) timer, armed BEFORE the export: microtasks all drain
    // before any macrotask, so if this flag is still false when runExport has
    // resolved, the action never waited on a clock at all.
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);

    await s().runExport();

    expect(macrotaskRan).toBe(false);
    expect(exportVideo).toHaveBeenCalledTimes(1);
    expect(jobOptions().beatGrid).toEqual(GRID);
    expect(s().exportDone).toContain("MP4");
    expect(s().exportError).toBeNull();
  });
});

describe("the wait is bounded and interruptible", () => {
  it("refuses the export when analysis never lands, rather than hanging or rendering gridless", async () => {
    vi.useFakeTimers();
    startAnalysis(); // never resolved: the wedged-worker case

    const run = s().runExport();
    await vi.advanceTimersByTimeAsync(ANALYSIS_TIMEOUT_MS - 1);
    expect(s().exporting).not.toBeNull(); // really waiting, not bailed early
    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportError).toBeNull();

    await vi.advanceTimersByTimeAsync(2);
    await run; // resolves — the whole point: a bounded wait, not a hang

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportError).toBe(ANALYSIS_TIMEOUT_REASON);
    // The slot is released, so the next export is not permanently blocked.
    expect(s().exporting).toBeNull();
  });

  it("lets Cancel end the wait, with no error toast and no job", async () => {
    startAnalysis();

    const run = s().runExport();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(s().exporting).not.toBeNull(); // the panel is showing Cancel

    s().cancelExport();
    await run;

    expect(exportVideo).not.toHaveBeenCalled();
    // A user cancel is not an error — runExport deliberately shows nothing.
    expect(s().exportError).toBeNull();
    expect(s().exporting).toBeNull();
  });

  it("refuses the export when a new track lands while the old one was analysed", async () => {
    const gate = startAnalysis();

    const run = s().runExport();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(s().exporting).not.toBeNull(); // really waiting, not bailed early
    // A drop during the wait. `buf` was captured from the OLD track; letting
    // the export continue would render old audio against new analysis.
    shared.trackLoadGen++;
    gate.resolve({ grid: GRID, key: null, sections: SECTIONS });
    await run;

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportError).toContain("track changed");
  });
});

describe("`analyzing` can never stick true (the gate must not become a hang)", () => {
  it("clears it when the analysis promise rejects", async () => {
    const gate = deferred<TrackAnalysis>();
    vi.mocked(analyzeTrack).mockReturnValue({ id: 1, result: gate.promise });
    s().analyzeCurrentTrack();
    expect(s().analyzing).toBe(true);

    // postMessage throwing (a structured-clone failure) is the one way
    // trackAnalysis can reject rather than resolve nulls.
    gate.reject(new Error("DataCloneError"));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(s().analyzing).toBe(false);
    // And a later export is not gated on the job that died.
    await expect(s().awaitAnalysis()).resolves.toBeUndefined();
  });

  it("stops gating the moment the store stops expecting a grid", async () => {
    startAnalysis(); // never resolved

    // `toggleLiveInput` (store.ts:1953) supersedes an in-flight job and writes
    // `analyzing: false` — the promise from that job may never settle, and
    // waiting on it would turn "no grid expected" into a five-minute stall.
    useVizStore.setState({ analyzing: false, beatGrid: null, sections: [] });

    await expect(s().awaitAnalysis()).resolves.toBeUndefined();
  });

  it("clears it when analyzeTrack throws synchronously, and still reports the failure", async () => {
    // The PCM copy inside analyzeTrack allocates a second full buffer, so a
    // long enough track throws before there is any promise to await.
    vi.mocked(analyzeTrack).mockImplementation(() => {
      throw new RangeError("Array buffer allocation failed");
    });

    expect(() => s().analyzeCurrentTrack()).toThrow(RangeError);
    expect(s().analyzing).toBe(false);
    await expect(s().awaitAnalysis()).resolves.toBeUndefined();
  });
});
