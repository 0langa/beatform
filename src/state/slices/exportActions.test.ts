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

/** A decoded track. Distinct OBJECTS matter here: the E3d guard below is an
 * identity comparison, so two tracks must never be two references to one. */
function decoded(duration: number): AudioBuffer {
  return {
    duration,
    sampleRate: 48_000,
    numberOfChannels: 2,
    length: duration * 48_000,
    getChannelData: () => new Float32Array(4096),
  } as unknown as AudioBuffer;
}

const TRACK_A = decoded(30);
const TRACK_B = decoded(45);

/** What the engine currently holds. `AudioEngine.loadArrayBuffer` commits the
 * decoded buffer by assigning this field (engine.ts), so a test that wants to
 * model "the decode landed" assigns it too. */
let engineBuffer: AudioBuffer | null = TRACK_A;
/** `startLiveInput` renames the track without touching the buffer — the one
 * engine-visible difference live mode makes to this action. */
let engineTrackName = "probe.wav";

const analyzer = { setSync: vi.fn(), setBeatGrid: vi.fn(), setSections: vi.fn(), reset: vi.fn() };

/** ONE engine object with LIVE accessors, because that is what production has:
 * `getEngine()` returns a module singleton (services.ts) and `audioBuffer` is a
 * getter over its private `buffer` field (engine.ts). A stub that handed out a
 * fresh object per call with a snapshotted buffer would make every re-read of
 * `audioBuffer` stale, which is precisely the thing under test. */
const engineStub = {
  ctx: { decodeAudioData: vi.fn() },
  get audioBuffer() {
    return engineBuffer;
  },
  get state() {
    return { trackName: engineTrackName };
  },
  currentTime: 0,
  duration: 30,
  playing: false,
  setVolume: vi.fn(),
  onEnded: null,
  dispose: vi.fn(),
};

vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => engineStub),
  getAnalyzer: vi.fn(() => analyzer),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return {
    ...actual,
    writeAutosave: vi.fn(async () => {}),
    // The desktop (isTauri() true) lane is opt-in per test via
    // mockReturnValueOnce/mockResolvedValueOnce — every other test never
    // touches these, so it keeps running the browser lane these defaults
    // describe, unchanged.
    isTauri: vi.fn(() => false),
    pickSavePath: vi.fn(async () => null),
    pickFolder: vi.fn(async () => null),
    diskSpace: vi.fn(async () => null),
    scratchDir: vi.fn(async () => null),
    // R2-12: the PNG-dir collision probe. Default "everything is free" keeps
    // every pre-existing test on the exact folder name it always asserted.
    dirNonEmpty: vi.fn(async () => false),
    animBegin: vi.fn(async () => {}),
    // FEAT-005: proresSetAudio/proresBegin/av1Begin/proresWrite are unmocked
    // by default (the ...actual spread above), which means the REAL wrapper
    // — an @tauri-apps/api/core invoke() call — runs unless a test opts in
    // here. That is fine for every OTHER test in this file (none of them
    // reach the proresMode/av1Mode branches: the sidecar-lane test above
    // uses "webp", deliberately staying on the already-mocked animBegin —
    // GIF/WebP carry no audio, so they never call proresSetAudio either),
    // but the new ProRes describe block below DOES reach them, and invoke()
    // has no Tauri bridge to call in this environment — so they need real
    // mocks, not just an opt-out.
    proresSetAudio: vi.fn(async () => {}),
    proresBegin: vi.fn(async () => {}),
    av1Begin: vi.fn(async () => {}),
    proresWrite: vi.fn(async () => {}),
    proresFinish: vi.fn(async () => {}),
    // R2-10: the finalize-span Cancel listener calls this; like the mocks
    // above, the real wrapper is a bridgeless invoke() in this environment.
    // Resolves with the sidecar log tail (R2-30e) — "" means "no session".
    proresAbort: vi.fn(async () => ""),
    // R2-30c: the buffered Canvas lane writes its finished blob here.
    writeBinaryToPath: vi.fn(async () => {}),
    // Real askConfirm goes through @tauri-apps/plugin-dialog (Tauri lane) or
    // window.confirm (browser lane, and `window` here is the plain stub
    // above with no `confirm`) — neither works in this environment. No
    // existing test below ever reaches the disk pre-flight's confirm
    // (destination stays null unless isTauri()+pickSavePath are both opted
    // in), so this default is inert for all of them; the E2-U5 tests opt in
    // per-call via mockReturnValueOnce/mockResolvedValueOnce, same idiom as
    // isTauri/pickSavePath above.
    askConfirm: vi.fn(async () => true),
  };
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
const { rasterizeOverlay } = await import("../../render/overlay");
const { analyzeTrack } = await import("../../audio/analysis/trackAnalysis");
const { ANALYSIS_TIMEOUT_MS } = await import("../batchRunner");
const { ANALYSIS_TIMEOUT_REASON } = await import("./exportActions");
const { shared } = await import("./shared");
const {
  isTauri,
  pickSavePath,
  pickFolder,
  dirNonEmpty,
  diskSpace,
  askConfirm,
  animBegin,
  proresBegin,
  av1Begin,
  proresWrite,
  proresFinish,
  proresAbort,
  writeBinaryToPath,
} = await import("../platform");

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
  // FEAT-005: cleared like exportVideo above (not left to survive file-wide,
  // unlike pickSavePath/diskSpace/etc.) because the new tests below assert on
  // CALL ARGUMENTS (mock.calls[0]), not just outcomes — a call left over from
  // an earlier test would make calls[0] point at the wrong test.
  vi.mocked(proresBegin).mockClear();
  vi.mocked(av1Begin).mockClear();
  vi.mocked(proresWrite).mockClear();
  // R2-10: the finalize-cancel tests assert call COUNTS on these two.
  vi.mocked(proresFinish).mockClear();
  vi.mocked(proresAbort).mockClear();
  // R2-11: the pixel-budget tests assert whether animBegin ran at all.
  vi.mocked(animBegin).mockClear();
  // R2-30c: the Canvas-lane tests assert calls[0] on this.
  vi.mocked(writeBinaryToPath).mockClear();
  // Back to "track A is loaded and playing".
  engineBuffer = TRACK_A;
  engineTrackName = "probe.wav";
  vi.mocked(rasterizeOverlay).mockReset();
  vi.mocked(rasterizeOverlay).mockImplementation(async () => null);
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
    exportDonePath: null,
    batchStatus: "idle",
    beatGrid: null,
    sections: [],
    analyzing: false,
    trackKey: null,
    lyrics: null,
    liveInputActive: false,
    trackMeta: { title: "Track A", artist: "A" },
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

/**
 * E3d — the export must encode the audio the store is describing.
 *
 * E3b made the export WAIT for analysis; E3c voids the previous track's
 * grid/key/sections/waveform the instant new audio reaches the engine. Both
 * enforce their rule with `shared.trackLoadGen`, and both leave the same hole.
 *
 *  - DISTANCE: the last generation check sits right after the analysis wait,
 *    but the reads that BUILD the job (trackMeta, coverArt, beatGrid, sections,
 *    stems, lyrics, waveformOverview) happen several awaits later — the sidecar
 *    audio handshake, the sidecar session, the overlay raster. A track landing
 *    in that gap was invisible.
 *
 *  - INVERSION: `loadFile` bumps `shared.trackLoadGen` on its FIRST line
 *    (store.ts) and only then parks on the decode, while the engine commits the
 *    new buffer only after that decode resolves (engine.ts). Between those two
 *    moments the generation is ALREADY the new load's while `audioBuffer` is
 *    still the old one — so an export starting there captures old audio under a
 *    new generation, and every later `genAtStart !== shared.trackLoadGen`
 *    compares two equal numbers. No counter check can ever fire.
 *
 * WHY THE FAILURE IS REACHABLE IN BOTH CASES BELOW: the swap is staged from
 * INSIDE `rasterizeOverlay`, which is a real await sitting downstream of the
 * last generation check and upstream of every store read that builds the job.
 * Nothing between those two points re-checks anything, so an unguarded
 * implementation genuinely proceeds and genuinely builds a mixed job — deleting
 * the identity guard turns both tests red rather than merely un-asserted.
 */
describe("the export encodes the audio the store describes (E3d)", () => {
  /** The moment a decode lands: new audio in the engine, and the store writes
   * the load path performs around it. */
  function newAudioLands() {
    engineBuffer = TRACK_B;
    useVizStore.setState({
      beatGrid: { ...GRID, bpm: 90 },
      sections: [0, 5],
      trackMeta: { title: "Track B", artist: "B" },
    });
  }

  it("refuses when new audio lands between the analysis gate and the job build", async () => {
    // Track A, fully analysed: the export sails past the E3b wait and the
    // generation check that follows it, which is exactly the case where the
    // remaining window is all there is.
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    vi.mocked(rasterizeOverlay).mockImplementationOnce(async () => {
      shared.trackLoadGen++; // the drop
      newAudioLands(); //      its decode
      return null;
    });

    await s().runExport();

    // Not "it exported the wrong thing" — it exported NOTHING.
    expect(exportVideo).not.toHaveBeenCalled();
    // Proof the run really reached the guard rather than bailing earlier (the
    // re-entrancy guard and the simplified-renderer guard both return before
    // the overlay raster, and neither writes this sentence).
    expect(rasterizeOverlay).toHaveBeenCalledTimes(1);
    expect(s().exportError).toContain("while the export was starting");
    // The slot is released, so the next export is not permanently blocked.
    expect(s().exporting).toBeNull();
    expect(shared.exportStarting).toBe(false);
  });

  it("refuses the counter-inversion case, where both generations are equal and only the audio differs", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    // The inversion, staged exactly as loadFile produces it: the new load has
    // ALREADY claimed its generation (store.ts's first line) and is parked on
    // its decode, so the engine still holds track A. The export starts HERE.
    shared.trackLoadGen++;
    const genAtStart = shared.trackLoadGen;
    // …and the decode resolves mid-export. No second generation bump: the load
    // that owns this audio bumped the counter before the export ever sampled
    // it, which is why no `trackLoadGen` comparison can see this.
    vi.mocked(rasterizeOverlay).mockImplementationOnce(async () => {
      newAudioLands();
      return null;
    });

    await s().runExport();

    // The predicate a generation check would have evaluated — both sides equal
    // for the whole run. This is the assertion that makes the mutation
    // "re-check `genAtStart !== shared.trackLoadGen` instead" provably green
    // on its own terms and still wrong.
    expect(shared.trackLoadGen).toBe(genAtStart);
    expect(exportVideo).not.toHaveBeenCalled();
    expect(rasterizeOverlay).toHaveBeenCalledTimes(1);
    expect(s().exportError).toContain("while the export was starting");
  });

  it("does not refuse when the document changes but the audio does not", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    // Ordinary churn in the same window — a title edit, a theme tweak. The
    // predicate is audio identity, not "nothing moved"; a guard that refused
    // here would break every export made while the user is still editing.
    vi.mocked(rasterizeOverlay).mockImplementationOnce(async () => {
      useVizStore.setState({ trackMeta: { title: "renamed", artist: "A" } });
      return null;
    });

    await s().runExport();

    expect(exportVideo).toHaveBeenCalledTimes(1);
    expect(jobOptions().beatGrid).toEqual(GRID);
    expect(s().exportError).toBeNull();
    expect(s().exportDone).toContain("MP4");
  });

  it("does not refuse a live-input export — live mode never swaps the engine's buffer", async () => {
    // What live mode really is, from this action's point of view. `startLiveInput`
    // re-points the analysis graph at the loopback worklet and renames the track
    // to "System audio" (engine.ts); `stopLiveInput` renames it back. NEITHER
    // touches `buffer`, so `audioBuffer` — the export's input — stays the track
    // that was loaded before live mode began, and identity holds trivially.
    // `toggleLiveInput` itself cannot run in this environment (it needs Tauri and
    // a loopback device), so its two effects on this action are staged directly:
    // the renamed track, and the store's live-mode analysis state (no grid, not
    // analysing — store.ts's settleAnalysis call in toggleLiveInput).
    engineTrackName = "System audio";
    useVizStore.setState({ liveInputActive: true, beatGrid: null, sections: [], analyzing: false });

    await s().runExport();

    // The export panel has no live-mode gate (its only `disabled` is
    // `simplifiedRenderer`), so this path is reachable by one click and a
    // false refusal here would be a worse regression than the bug above.
    expect(exportVideo).toHaveBeenCalledTimes(1);
    expect(s().exportError).toBeNull();
    expect(s().exportDone).toContain("MP4");
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

/**
 * `exportDonePath` is the machine-readable companion to the prose
 * `exportDone` sentence — the path "Show in folder" invokes the Rust command
 * with. It has to carry the SAME path the sentence names (not a derived or
 * re-parsed one), and it has to go stale the instant a new export starts, not
 * merely when the new one finishes — a button sitting on a completed toast
 * must not still open the PREVIOUS export's file once a new run is under way.
 */
describe("exportDonePath — the machine-readable companion to exportDone", () => {
  it("carries the exact save path for a desktop MP4 export", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\video.mp4");

    await s().runExport();

    expect(s().exportDonePath).toBe("C:\\exports\\video.mp4");
    expect(s().exportDone).toContain("C:\\exports\\video.mp4");
    // R2-30c pins the boundary from the other side: ordinary full-track
    // desktop exports still STREAM to the picked file (flat memory) — the
    // buffered-blob write is the Canvas lane's alone.
    expect(jobOptions().streamToPath).toBe("C:\\exports\\video.mp4");
    expect(writeBinaryToPath).not.toHaveBeenCalled();
  });

  it("carries the PNG sequence folder, not the (null) save path", async () => {
    const dir = "C:\\exports";
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "png", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickFolder).mockResolvedValueOnce(dir);

    await s().runExport();

    // Exactly runExport's own `${dir}/${baseName}_frames` construction —
    // engineTrackName is "probe.wav", and safeName strips the extension.
    expect(s().exportDonePath).toBe(`${dir}/probe_frames`);
    expect(s().exportDone).toContain("PNG sequence");
  });

  it("walks the PNG folder to _frames-2 when the first run's folder is non-empty (R2-12)", async () => {
    const dir = "C:\\exports";
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "png", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickFolder).mockResolvedValueOnce(dir);
    // The previous run's frames are sitting in `${dir}/probe_frames` — the
    // picker must walk past it, never write in among (or over) its files.
    vi.mocked(dirNonEmpty).mockImplementationOnce(async (p) => p === `${dir}/probe_frames`);

    await s().runExport();

    // The toast and "Show in folder" both carry the name that actually won.
    expect(s().exportDonePath).toBe(`${dir}/probe_frames-2`);
    expect(s().exportDone).toContain(`${dir}/probe_frames-2`);
  });

  it("carries the save path for a sidecar (ffmpeg) export too", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "webp", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\loop.webp");

    await s().runExport();

    expect(s().exportDonePath).toBe("C:\\exports\\loop.webp");
    expect(s().exportDone).toContain("WebP loop saved to C:\\exports\\loop.webp");
  });

  it("is null for a browser download, which has no path", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });

    await s().runExport();

    expect(s().exportDonePath).toBeNull();
    expect(s().exportDone).toContain("MP4");
  });

  it("clears a stale value the moment a new export starts, before the new result lands", async () => {
    useVizStore.setState({ exportDonePath: "C:\\old\\video.mp4" });
    const gate = startAnalysis();

    const run = s().runExport();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // Still mid-flight (analysis gate held open) — proves the clear happens
    // at the START of the run, not merely as a side effect of it finishing.
    expect(s().exporting).not.toBeNull();
    expect(s().exportDonePath).toBeNull();

    gate.resolve({ grid: GRID, key: null, sections: SECTIONS });
    await run;
  });

  it("clears a stale value when the renderer is too simplified to export", async () => {
    useVizStore.setState({ simplifiedRenderer: true, exportDonePath: "C:\\old\\video.mp4" });

    await s().runExport();

    expect(s().exportDonePath).toBeNull();
  });
});

/**
 * FEAT-005 — ProRes 4444 switches from the 8-bit PNG lane to the same
 * raw-rgba64le deep-color tap the AV1 10-bit lane already used, so ProRes's
 * "10-bit" pixels are no longer an 8-bit PNG ffmpeg merely widened.
 *
 * These are the first tests in this file to reach the proresMode/av1Mode
 * sidecar branches at all — every existing sidecar-lane test deliberately
 * used "webp" instead (see its own comment), because proresBegin/av1Begin/
 * proresWrite were unmocked: a real @tauri-apps/api/core invoke() call with
 * no Tauri bridge present. The platform mock above now covers all three.
 */
describe("FEAT-005 — ProRes 4444 deep-color lane", () => {
  it("stages audio and begins the sidecar session with width/height pinned, exactly like av1Begin", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: {
        ...s().exportSettings,
        mode: "video",
        format: "prores",
        codec: "h264",
        resIdx: 2, // 1440p (2560x1440) — a deliberately non-default choice
      },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\deep.mov");

    await s().runExport();

    // Raw video has no per-frame header — ffmpeg slices stdin purely by
    // `-s WxH` — so proresBegin needed the same width/height-at-spawn shape
    // av1Begin already has. A dropped width/height here renders garbage on
    // the very first frame, not a visible failure at export time.
    expect(proresBegin).toHaveBeenCalledTimes(1);
    expect(proresBegin).toHaveBeenCalledWith(60, 2560, 1440, "C:\\exports\\deep.mov");
    // Mutually exclusive with AV1's own begin command.
    expect(av1Begin).not.toHaveBeenCalled();

    expect(s().exportDonePath).toBe("C:\\exports\\deep.mov");
    expect(s().exportDone).toContain("ProRes 4444");
  });

  it("feeds the core deepColor + deepStraightAlpha and wires onRawFrame instead of onPngFrame", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "prores", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\deep.mov");

    await s().runExport();

    const opts = jobOptions();
    // The actual FEAT-005 switch: was onPngFrame (8-bit PNG, widened to
    // "10-bit" by ffmpeg), now onRawFrame off the same tap AV1 uses.
    expect(opts.deepColor).toBe(true);
    expect(opts.deepStraightAlpha).toBe(true);
    expect(opts.onPngFrame).toBeUndefined();
    expect(typeof opts.onRawFrame).toBe("function");
  });

  it("streams a raw frame through onRawFrame -> proresWrite as an exact byte view (rgba64le shape, correct stride)", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "prores", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\deep.mov");

    await s().runExport();

    // A 2x1 rgba64le-shaped frame: width*height*4 = 8 u16 words (16 bytes).
    const frame = new Uint16Array([0, 32768, 65535, 40000, 111, 222, 333, 444]);
    await jobOptions().onRawFrame!(frame);

    expect(proresWrite).toHaveBeenCalledTimes(1);
    const written = vi.mocked(proresWrite).mock.calls[0][0];
    // Exact byte VIEW of the same buffer, not a re-encoded or truncated copy
    // — this is the "raw byte view IS the rgba64le stream" assumption the
    // production code's own comment documents, pinned here.
    expect(written).toBeInstanceOf(Uint8Array);
    expect(written.buffer).toBe(frame.buffer);
    expect(written.byteOffset).toBe(frame.byteOffset);
    expect(written.byteLength).toBe(frame.byteLength);
    expect(
      Array.from(new Uint16Array(written.buffer, written.byteOffset, written.byteLength / 2)),
    ).toEqual(Array.from(frame));
  });

  it("still writes av1Begin (not proresBegin) with deepStraightAlpha absent, unaffected by the ProRes switch", async () => {
    // Regression guard for the shared rawSidecarMode/pngSidecarMode refactor
    // this feature required: AV1's own branch must come out exactly as it
    // was, byte for byte, not just "still present".
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: {
        ...s().exportSettings,
        mode: "video",
        format: "av1-10",
        codec: "h264",
        resIdx: 1, // 1080p — distinct from the ProRes test's resIdx above
      },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\deep.mp4");

    await s().runExport();

    expect(av1Begin).toHaveBeenCalledTimes(1);
    expect(av1Begin).toHaveBeenCalledWith(60, 1920, 1080, "C:\\exports\\deep.mp4");
    expect(proresBegin).not.toHaveBeenCalled();
    const opts = jobOptions();
    expect(opts.deepColor).toBe(true);
    expect(opts.deepStraightAlpha).toBeUndefined();
    expect(opts.onPngFrame).toBeUndefined();
    expect(typeof opts.onRawFrame).toBe("function");
  });
});

/**
 * R2-30c/d — the Canvas-loop lane.
 *
 * (c) Canvas loops render BUFFERED (progressive fastStart MP4) instead of
 * streaming fragmented MP4 to disk — owner verdict: the picky upload ingests
 * these loops exist for choke on fragmented files, and a ≤8 s clip fits in
 * memory trivially. The desktop save-dialog flow is unchanged: same picked
 * path, the finished blob written there once at the end.
 * (d) A track shorter than the 3 s spec floor is refused before any dialog.
 */
describe("Canvas loop exports (R2-30c/d)", () => {
  it("refuses a track shorter than 3 s before any dialog opens", async () => {
    engineBuffer = decoded(2.5);
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "canvas", format: "mp4", codec: "h264" },
    });
    vi.mocked(pickSavePath).mockClear();

    await s().runExport();

    expect(s().exportError).toBe("Spotify Canvas needs a 3-8 s loop; this track is 2.5 s");
    expect(pickSavePath).not.toHaveBeenCalled();
    expect(exportVideo).not.toHaveBeenCalled();
    // The claim is released — the next export is not blocked.
    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
  });

  it("renders buffered (no streamToPath) and writes the finished blob to the picked path", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "canvas", format: "mp4", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\clip-canvas.mp4");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
    vi.mocked(exportVideo).mockResolvedValueOnce({
      blob,
      bytes: 3,
      seconds: 8,
      audioCodec: "aac",
    });

    await s().runExport();

    const opts = jobOptions();
    // The actual R2-30c switch: buffered mode (blob out), not stream-to-disk.
    expect(opts.streamToPath).toBeUndefined();
    expect(opts.segment).toBeDefined();
    expect(writeBinaryToPath).toHaveBeenCalledTimes(1);
    expect(writeBinaryToPath).toHaveBeenCalledWith("C:\\exports\\clip-canvas.mp4", blob);
    expect(s().exportDonePath).toBe("C:\\exports\\clip-canvas.mp4");
    expect(s().exportDone).toContain("saved to C:\\exports\\clip-canvas.mp4");
    expect(s().exportError).toBeNull();
  });
});

/**
 * R2-11 — the GIF/WebP refusal caps PIXELS, not frames.
 *
 * Both loop encoders hold the whole animation in RAM (GIF palettegen buffers
 * every frame until EOF; libwebp_anim assembles the full animation before
 * writing), so what exhausts memory is frames × width × height. The old flat
 * 5400-frame cap modeled that only at the 1080p it was measured at — 4K cost
 * 4× the memory under the same cap — and it never covered WebP at all. The
 * budget is pinned to exactly what the old cap implied at 1080p.
 */
describe("GIF/WebP loop exports refuse on the pixel budget (R2-11)", () => {
  function armAnim(
    format: "gif" | "webp",
    resIdx: number,
    fps: number,
    durationSec: number,
    savePath: string,
  ) {
    engineBuffer = decoded(durationSec);
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format, codec: "h264", resIdx, fps },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce(savePath);
  }

  it("keeps the exact old 1080p budget: 181 s @30 is refused, 179 s runs", async () => {
    armAnim("gif", 1, 30, 181, "C:\\exports\\loop.gif"); // 5430 frames > old 5400
    await s().runExport();
    expect(s().exportError).toContain("GIF exports are limited to ~3 minutes at 1920x1080@30");
    // The message must say what to reduce, like the cap it replaces did.
    expect(s().exportError).toContain("Reduce the length, resolution or frame rate");
    expect(animBegin).not.toHaveBeenCalled();

    armAnim("gif", 1, 30, 179, "C:\\exports\\loop.gif"); // 5370 frames — inside
    await s().runExport();
    expect(animBegin).toHaveBeenCalledTimes(1);
    expect(s().exportError).toBeNull();
  });

  it("4K exhausts the same budget 4x sooner — and WebP is capped too now", async () => {
    // One minute at 4K@30 is ~14.9e9 px (over budget); the SAME minute at
    // 1080p is ~3.7e9 px (comfortably inside). A frame-count cap cannot
    // tell these apart — that is the whole finding.
    armAnim("webp", 3, 30, 60, "C:\\exports\\loop.webp");
    await s().runExport();
    expect(s().exportError).toContain(
      "Animated WebP exports are limited to ~45 seconds at 3840x2160@30",
    );
    expect(animBegin).not.toHaveBeenCalled();

    armAnim("webp", 1, 30, 60, "C:\\exports\\loop.webp");
    await s().runExport();
    expect(animBegin).toHaveBeenCalledTimes(1);
    expect(s().exportError).toBeNull();
  });
});

/**
 * R2-10 — Cancel must reach a sidecar session that is already FINALIZING.
 *
 * Once every frame is rendered, exportVideo resolves and nothing is listening
 * to the abort signal any more — yet proresFinish can legitimately run for
 * minutes (GIF paletteuse, a multi-GB ProRes flush; prores.rs allows 20).
 * Clicking Cancel in that span flipped a signal nobody read: the dialog sat
 * on "Finishing" until ffmpeg was done anyway. The finalize span now carries
 * its own abort listener wired to proresAbort, which the Rust side tolerates
 * mid-finalize by design (prores_finish then reports the cancel).
 */
describe("cancel during sidecar finalize reaches proresAbort (R2-10)", () => {
  it("a Cancel while ffmpeg finalizes aborts the session exactly once, and shows no error", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "webp", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\loop.webp");
    const finishGate = deferred<void>();
    vi.mocked(proresFinish).mockReturnValueOnce(finishGate.promise);

    const run = s().runExport();
    // The render is done (the exportVideo mock resolved) and the action is
    // parked inside proresFinish — the exact span where Cancel used to be
    // dead. waitFor rather than a fixed microtask drain: the path crosses
    // the analysis gate, animBegin, the overlay raster and exportVideo, each
    // its own await chain.
    await vi.waitFor(() => expect(proresFinish).toHaveBeenCalledTimes(1));
    expect(proresAbort).not.toHaveBeenCalled();

    s().cancelExport();
    await vi.waitFor(() => expect(proresAbort).toHaveBeenCalledTimes(1));

    // What the Rust side then does: prores_finish's wait sees the job gone
    // and rejects with its cancel sentence (a raw string — Tauri command
    // rejections are not Errors).
    finishGate.reject("Export cancelled while finishing");
    await run;

    // Exactly once — the catch path must await the listener's abort, not
    // fire a second one at an already-empty session.
    expect(proresAbort).toHaveBeenCalledTimes(1);
    // A user cancel is not an error and not a success: nothing is shown.
    expect(s().exportError).toBeNull();
    expect(s().exportDone).toBeNull();
    expect(s().exporting).toBeNull();
  });

  it("a dead sidecar's log tail reaches the export error (R2-30e)", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "webp", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\loop.webp");
    // The frame write into a dead ffmpeg: the pipe error says THAT it died,
    // only the stderr log (returned by the abort, read before cleanup
    // unlinks it) says WHY.
    vi.mocked(proresWrite).mockRejectedValueOnce("ffmpeg pipe write failed: os error 232");
    vi.mocked(proresAbort).mockResolvedValueOnce("[libwebp_anim @ 0x1] Conversion failed!");
    vi.mocked(exportVideo).mockImplementationOnce(async (_buf, o) => {
      // One frame into the dead sidecar: the chain records the failure and
      // trips the export's abort; the core then surfaces the AbortError,
      // exactly as the real render loop would.
      await o.onPngFrame!(new Uint8Array([1]), 0);
      const err = new Error("Export cancelled");
      err.name = "AbortError";
      throw err;
    });

    await s().runExport();

    expect(proresAbort).toHaveBeenCalledTimes(1);
    // Both halves surface: what broke, and ffmpeg's own account of why.
    expect(s().exportError).toContain("os error 232");
    expect(s().exportError).toContain("Conversion failed!");
  });

  it("a finalize that completes normally never arms an abort and still reports success", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "webp", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\loop.webp");

    await s().runExport();

    expect(proresFinish).toHaveBeenCalledTimes(1);
    expect(proresAbort).not.toHaveBeenCalled();
    expect(s().exportDone).toContain("WebP loop saved");
    expect(s().exportError).toBeNull();
  });
});

/**
 * E4b — the fps readout tracks the CURRENT rate, not the whole run's average.
 *
 * The old `speed` was a pure cumulative average (done/elapsed since the
 * export started): correct on average, but it rides the encoder-queue fill
 * at render speed for the first stretch and only decays toward the real
 * steady-state rate afterward — which is what the owner watched as "16 fps
 * -> 7 fps at 16%" (BACKLOG E4b), largely a measurement artifact rather than
 * a leak. This pins the fix: `speed` now windows to the last ~5 s of
 * onProgress samples, while `avgSpeed` keeps the old cumulative number
 * available (for ETA math, if a future caller wants it).
 */
describe("the export fps readout windows to the recent rate (E4b)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks a slow recent stretch instead of averaging it into a fast start", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    let onProgress: ((done: number, total: number) => void) | undefined;
    const gate = deferred<{ blob: undefined; bytes: number; seconds: number; audioCodec: "aac" }>();
    vi.mocked(exportVideo).mockImplementationOnce(async (_buf, options: ExportOptions) => {
      onProgress = options.onProgress;
      return gate.promise;
    });
    let mockNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => mockNow);

    const run = s().runExport();
    // Let runExport's pre-render awaits (analysis/overlay) settle so
    // exportVideo has actually been called and onProgress captured — same
    // microtask-drain idiom the E2-R2 tests above use.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(onProgress).toBeDefined();

    // Phase 1 — fast: 100 frames over 1000 ms (100 fps), onProgress every 10
    // frames like the real core (exportCore.ts).
    for (let i = 1; i <= 10; i++) {
      mockNow = i * 100;
      onProgress!(i * 10, 1000);
    }
    // Phase 2 — slow: 100 more frames spread over the NEXT 5800 ms (~16.7
    // fps) — long enough that the 5 s window has fully slid past phase 1 by
    // the last sample.
    for (let i = 1; i <= 10; i++) {
      mockNow = 1000 + i * 580;
      onProgress!(100 + i * 10, 1000);
    }

    const { speed, avgSpeed } = s().exporting!;
    // Windowed: close to phase 2's true rate (100 frames / 5.8 s).
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(14);
    expect(speed!).toBeLessThan(19);
    // Cumulative: 200 frames / 6.8 s — still dragged up by the fast start,
    // and clearly higher than the windowed reading above. This is the number
    // the OLD `speed` field would have shown for the whole run.
    expect(avgSpeed).not.toBeNull();
    const cumulative = 200 / ((1000 + 5800) / 1000);
    expect(avgSpeed!).toBeCloseTo(cumulative, 5);
    expect(avgSpeed!).toBeGreaterThan(speed! + 5);

    gate.resolve({ blob: undefined, bytes: 1000, seconds: 1, audioCodec: "aac" });
    await run;
  });

  it("is null on the very first sample — nothing recent to divide by yet", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    let onProgress: ((done: number, total: number) => void) | undefined;
    const gate = deferred<{ blob: undefined; bytes: number; seconds: number; audioCodec: "aac" }>();
    vi.mocked(exportVideo).mockImplementationOnce(async (_buf, options: ExportOptions) => {
      onProgress = options.onProgress;
      return gate.promise;
    });

    const run = s().runExport();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    onProgress!(10, 1000);

    expect(s().exporting!.speed).toBeNull();

    gate.resolve({ blob: undefined, bytes: 1000, seconds: 1, audioCodec: "aac" });
    await run;
  });
});

/**
 * E2-U5 — ExportDialog could be closed mid-preflight, orphaning the run.
 *
 * `shared.exportStarting` is claimed SYNCHRONOUSLY the moment runExport
 * passes its re-entrancy guard, but `exporting` — the only thing
 * ExportDialog's backdrop/close button used to gate dismissal on — is not
 * set until several awaits later: the native save dialog, then the disk
 * pre-flight (including its own "Low disk space?" confirm). Closing the
 * dialog anywhere in that window used to unmount it without stopping
 * runExport, which kept running to completion (or failure) with no UI
 * showing progress or the eventual error.
 *
 * `exportPreparing` is the reactive mirror of `shared.exportStarting` that
 * closes the gap — these tests pin its timing across every phase and every
 * early-return path, using the REAL runExport with pickSavePath/diskSpace/
 * askConfirm mocked controllably (the same deferred-promise idiom the E2-R2
 * and E4b describe blocks above already use for analysis/exportVideo).
 * ExportDialog's own reaction to the flag (backdrop no-op, close button
 * disabled+titled) is covered separately in ExportDialog.test.tsx, which
 * mounts the real dialog and sets the flag directly — no need to duplicate
 * runExport's whole async orchestration there too.
 */
describe("exportPreparing mirrors shared.exportStarting through the whole pre-encode window (E2-U5)", () => {
  it("is set synchronously and stays true through the native save-dialog window, well before `exporting` exists", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    const gate = deferred<string | null>();
    vi.mocked(pickSavePath).mockReturnValueOnce(gate.promise);

    expect(s().exportPreparing).toBe(false);
    const run = s().runExport();
    await Promise.resolve(); // one microtask turn: past the synchronous claim
    expect(s().exportPreparing).toBe(true);
    expect(shared.exportStarting).toBe(true);
    // The exact gap this finding is about: still nothing here for the
    // dialog's OLD gate (`!!exporting`) to have caught.
    expect(s().exporting).toBeNull();

    gate.resolve(null); // user cancels the native save dialog
    await run;

    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
    expect(exportVideo).not.toHaveBeenCalled();
  });

  it("stays true through the disk pre-flight's own confirm, and clears (with nothing rendered) if declined", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\video.mp4");
    // Zero free space comfortably triggers preflightWarning's shortfall
    // check for any non-zero bitrate estimate.
    vi.mocked(diskSpace).mockResolvedValueOnce({ freeBytes: 0, totalBytes: 1e9, root: "C:\\" });
    const gate = deferred<boolean>();
    vi.mocked(askConfirm).mockReturnValueOnce(gate.promise);

    const run = s().runExport();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(askConfirm).mock.calls[0][0])).toContain("Not enough disk space");
    // The confirm itself IS part of "preparing" — exportPreparing must not
    // have lapsed just because control is sitting inside askConfirm.
    expect(s().exportPreparing).toBe(true);
    expect(s().exporting).toBeNull();

    gate.resolve(false); // user declines — "Start it anyway?" answered no
    await run;

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
  });

  it("remains true once `exporting` takes over — one continuous claim, not a handoff — clearing only when the run truly ends", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    const gate = deferred<{ blob: undefined; bytes: number; seconds: number; audioCodec: "aac" }>();
    vi.mocked(exportVideo).mockImplementationOnce(async () => gate.promise);

    const run = s().runExport();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(s().exporting).not.toBeNull(); // encoding has genuinely begun
    expect(s().exportPreparing).toBe(true); // the SAME claim, still held

    gate.resolve({ blob: undefined, bytes: 1000, seconds: 1, audioCodec: "aac" });
    await run;

    expect(s().exportPreparing).toBe(false);
    expect(s().exporting).toBeNull();
  });

  it("clears on every early-return path, not just the ones covered above", async () => {
    // Cancelled PNG-folder picker (isTauri, pngMode) — a THIRD early-return
    // site distinct from the save-path-cancel and disk-pre-flight-decline
    // cases already covered, pinning that endExportPreparing was wired into
    // every one of runExport's bail-out points, not just some of them.
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "png", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickFolder).mockResolvedValueOnce(null); // user cancels the folder picker

    await s().runExport();

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
  });
});

/**
 * Whole-lane review, IMPORTANT on top of E2-U5: the native save dialog and
 * the disk pre-flight (pickFolder/pickSavePath/scratchDir/diskSpace/
 * askConfirm) are real Tauri plugin calls that CAN throw — the ACL-throw
 * precedent is real (ShaderEditor.tsx's own comment records askConfirm
 * throwing "not allowed by ACL" in an installed build) — and that whole
 * span used to sit OUTSIDE any try/catch. An uncaught throw there skipped
 * every endExportPreparing() call, leaving shared.exportStarting AND
 * exportPreparing stuck true forever: the exact same "permanently stuck"
 * class E2-U5 exists to prevent, just reached through an exception instead
 * of a dismissal click.
 */
describe("a throw during the save dialog or disk pre-flight still settles exportPreparing (whole-lane review, IMPORTANT)", () => {
  it("a thrown pickSavePath clears exportPreparing/shared.exportStarting and surfaces exportError", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    const boom = new Error("dialog plugin: not allowed by ACL");
    vi.mocked(pickSavePath).mockRejectedValueOnce(boom);

    await s().runExport();

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
    expect(s().exportError).toContain("Could not open the save dialog");
    expect(s().exportError).toContain("not allowed by ACL");
    // The slot is released — a later export is not permanently blocked.
    expect(s().exporting).toBeNull();
  });

  it("a thrown pickFolder (PNG sequence lane) is caught the same way", async () => {
    useVizStore.setState({
      beatGrid: GRID,
      sections: SECTIONS,
      analyzing: false,
      exportSettings: { ...s().exportSettings, mode: "video", format: "png", codec: "h264" },
    });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickFolder).mockRejectedValueOnce(new Error("folder picker crashed"));

    await s().runExport();

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
    expect(s().exportError).toContain("Could not open the save dialog");
  });

  it("a thrown diskSpace during the pre-flight clears exportPreparing/shared.exportStarting and surfaces exportError", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\video.mp4");
    vi.mocked(diskSpace).mockRejectedValueOnce(new Error("disk_space command failed"));

    await s().runExport();

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
    expect(s().exportError).toContain("Could not check disk space");
    expect(s().exportError).toContain("disk_space command failed");
  });

  it("a thrown askConfirm (low-disk-space prompt) is caught the same way", async () => {
    useVizStore.setState({ beatGrid: GRID, sections: SECTIONS, analyzing: false });
    vi.mocked(isTauri).mockReturnValueOnce(true);
    vi.mocked(pickSavePath).mockResolvedValueOnce("C:\\exports\\video.mp4");
    vi.mocked(diskSpace).mockResolvedValueOnce({ freeBytes: 0, totalBytes: 1e9, root: "C:\\" });
    vi.mocked(askConfirm).mockRejectedValueOnce(new Error("not allowed by ACL"));

    await s().runExport();

    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exportPreparing).toBe(false);
    expect(shared.exportStarting).toBe(false);
    expect(s().exportError).toContain("Could not check disk space");
  });
});

describe("setShowExport(true) clears a stale exportError (E2-U5)", () => {
  // codecSupport seeded non-null in every test below: setShowExport probes
  // it lazily when null, and the real probeCodecs() has nothing to work
  // with in this Node-environment test file.
  const codecSupport = { h264: true, hevc: false, av1: false, vp9a: false };

  it("opening the dialog clears a leftover exportError from a prior (possibly orphaned) run", () => {
    useVizStore.setState({ exportError: "boom", showExport: false, codecSupport });

    s().setShowExport(true);

    expect(s().exportError).toBeNull();
    expect(s().showExport).toBe(true);
  });

  it("closing the dialog does not touch exportError — only opening clears it", () => {
    useVizStore.setState({ exportError: "boom", showExport: true, codecSupport });

    s().setShowExport(false);

    expect(s().exportError).toBe("boom");
    expect(s().showExport).toBe(false);
  });

  it("is a harmless no-op while a run is genuinely still in flight (exportError is already null there)", () => {
    useVizStore.setState({
      exportError: null,
      exporting: { done: 1, total: 10, speed: null, avgSpeed: null },
      codecSupport,
    });

    s().setShowExport(true);

    expect(s().exportError).toBeNull();
  });

  /**
   * Whole-lane review, one-liner (a): the identical hazard shape as
   * exportError, one field over — exportDonePath feeds "Show in folder"
   * (ExportDialog.tsx), so a stale one left over from a PRIOR run would
   * happily reveal the wrong file's location on a later, unrelated reopen.
   */
  it("opening the dialog also clears a leftover exportDone/exportDonePath from a prior run", () => {
    useVizStore.setState({
      exportDone: "MP4 saved to C:\\old\\video.mp4",
      exportDonePath: "C:\\old\\video.mp4",
      showExport: false,
      codecSupport,
    });

    s().setShowExport(true);

    expect(s().exportDone).toBeNull();
    expect(s().exportDonePath).toBeNull();
  });

  it("closing the dialog does not touch exportDone/exportDonePath either", () => {
    useVizStore.setState({
      exportDone: "MP4 saved to C:\\old\\video.mp4",
      exportDonePath: "C:\\old\\video.mp4",
      showExport: true,
      codecSupport,
    });

    s().setShowExport(false);

    expect(s().exportDone).toBe("MP4 saved to C:\\old\\video.mp4");
    expect(s().exportDonePath).toBe("C:\\old\\video.mp4");
  });
});
