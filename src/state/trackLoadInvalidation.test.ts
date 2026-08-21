import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Type-only: erased at compile time, so these never hoist a module body above
// the global stubs below (the reason the value imports are dynamic).
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { KeyEstimate } from "../audio/analysis/keyDetect";
import type { TrackAnalysis } from "../audio/analysis/trackAnalysis";
import type { LibraryTrack } from "./platform";
import type { ExportOptions } from "../export/videoExporter";

/**
 * E3c — the window between the NEW audio reaching the engine and the analysis
 * of it starting, in which the store still held the PREVIOUS track's grid.
 *
 * E3b (v2.91.0) made an interactive export wait for analysis, keyed on
 * `analyzing`. But `loadFile` installs and PLAYS the new audio, then awaits a
 * tag scan, and only then calls `analyzeCurrentTrack()` — which is where
 * `analyzing` used to become true. In between, `beatGrid` / `trackKey` /
 * `sections` / `waveformOverview` were not missing, they were the last song's,
 * and `analyzing` was false, so E3b's gate saw nothing to wait for. An export
 * fired there rendered the previous song's beat grid over this song's audio.
 * `advanceLibrary`'s near-gapless path has the same shape and needs no click at
 * all: the app moves to the next track by itself. `loadDemo` is the third, and
 * the one a first-time user reaches before any of the others.
 *
 * WHY EVERY FAILURE BELOW IS REACHABLE: nothing here hand-poses a "mid-load"
 * store. Each test drives the REAL `loadFile` / `loadDemo` / `advanceLibrary`
 * and holds open exactly the await a user's machine holds open (the decode, the
 * demo's offline render, the tag scan, the analysis worker's reply), so the
 * state under assertion is byte-for-byte what a load produces. The previous
 * track's grid — and its KEY — are put there by the REAL
 * `analyzeCurrentTrack()`, not by `setState`.
 *
 * Same mock surface as store.test.ts / exportActions.test.ts: services,
 * overlay, videoExporter, trackMeta and the analysis worker facade are faked
 * because WebGPU, Web Audio, a real encoder, music-metadata's Blob reader and
 * Worker do not exist in this environment — all orthogonal to the ordering
 * under test.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
// `isTauri()` is `"__TAURI_INTERNALS__" in window` — a plain object answers
// false, which puts runExport on the browser lane: no save dialog, no disk
// preflight, so the analysis wait is the FIRST await in the action.
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

function fakeBuffer(seconds: number): AudioBuffer {
  return {
    duration: seconds,
    sampleRate: 48_000,
    numberOfChannels: 2,
    length: seconds * 48_000,
    getChannelData: () => new Float32Array(4096),
  } as unknown as AudioBuffer;
}
const OLD_AUDIO = fakeBuffer(30);
const NEW_AUDIO = fakeBuffer(45);

/** A promise whose settling this test owns. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The engine, with the two moments this bug lives between under the test's
 * control: when the decode resolves (the new audio becomes `audioBuffer`) and
 * when playback starts.
 */
const engineState = {
  buffer: OLD_AUDIO,
  decode: deferred(),
  play: deferred(),
};
const engine = {
  ctx: { decodeAudioData: vi.fn(), sampleRate: 48_000 },
  get audioBuffer() {
    return engineState.buffer;
  },
  state: { trackName: "probe.wav" },
  currentTime: 0,
  duration: 30,
  playing: false,
  loadFile: vi.fn(async () => {
    await engineState.decode.promise;
    engineState.buffer = NEW_AUDIO; // engine.loadArrayBuffer's `this.buffer =`
  }),
  loadBuffer: vi.fn((buffer: AudioBuffer) => {
    engineState.buffer = buffer;
  }),
  play: vi.fn(async () => {
    await engineState.play.promise;
  }),
  pause: vi.fn(),
  setVolume: vi.fn(),
  onEnded: null,
  dispose: vi.fn(),
};

const analyzer = { setSync: vi.fn(), setBeatGrid: vi.fn(), setSections: vi.fn(), reset: vi.fn() };

vi.mock("./services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => engine),
  getAnalyzer: vi.fn(() => analyzer),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

vi.mock("../render/overlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../render/overlay")>();
  return { ...actual, rasterizeOverlay: vi.fn(async () => null) };
});

vi.mock("../export/videoExporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/videoExporter")>();
  return {
    ...actual,
    exportVideo: vi.fn(async () => ({ blob: null, bytes: 1_000, audioCodec: "aac" })),
  };
});

/**
 * The tag scan is the long half of the window — music-metadata parses the
 * file's header — so the test owns when it lands. One deferred PER CALL, not
 * one shared: two overlapping loads each park on their own scan, and the
 * supersession tests turn on releasing one while the other is still open. Both
 * `store.ts` and `libraryActions.ts` import this one module.
 */
const tagScans: Array<ReturnType<typeof deferred<string>>> = [];
vi.mock("../audio/trackMeta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audio/trackMeta")>();
  return {
    ...actual,
    readTrackMeta: vi.fn(async () => {
      const gate = deferred<string>();
      tagScans.push(gate);
      const title = await gate.promise;
      return { meta: { title, artist: "" }, fromTags: true, coverArt: null, duration: null };
    }),
  };
});

/**
 * A demo track is synthesized through `OfflineAudioContext.startRendering()`,
 * which does not exist here — and it is also the await that opens `loadDemo`'s
 * window, so the test owns when it lands. Only `render` is replaced: the ids
 * and names come from the real registry, so a renamed demo breaks this file
 * rather than quietly testing a track the app does not have.
 */
const demoRenders: Array<ReturnType<typeof deferred<AudioBuffer>>> = [];
vi.mock("../audio/demoTrack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audio/demoTrack")>();
  return {
    ...actual,
    demos: actual.demos.map((d) => ({
      ...d,
      render: vi.fn(() => {
        const gate = deferred<AudioBuffer>();
        demoRenders.push(gate);
        return gate.promise;
      }),
    })),
  };
});

vi.mock("../audio/analysis/trackAnalysis", () => ({ analyzeTrack: vi.fn() }));

const { useVizStore } = await import("./store");
const { exportVideo } = await import("../export/videoExporter");
const { analyzeTrack } = await import("../audio/analysis/trackAnalysis");
const { demos } = await import("../audio/demoTrack");
const { shared } = await import("./slices/shared");

const s = () => useVizStore.getState();

const OLD_GRID: BeatGrid = {
  bpm: 128,
  beatTimes: Float32Array.from([0, 0.469, 0.938, 1.406]),
  hopSec: 0.0116,
};
const NEW_GRID: BeatGrid = {
  bpm: 90,
  beatTimes: Float32Array.from([0, 0.667, 1.333, 2.0]),
  hopSec: 0.0116,
};
const OLD_SECTIONS = [0, 12.5, 25];
const NEW_SECTIONS = [0, 30];
/**
 * The previous track's key must be NON-NULL or the `trackKey` assertions below
 * cannot fail: `beforeEach` resets the field to null, so a fixture that
 * resolved `key: null` would leave every "the stale key is gone" expectation
 * true before the code under test ran. It is a real staleness channel —
 * `selectKeyName` (selectors.ts) feeds the key badge in PanelFooterBadges — so
 * during the load window the previous song's key would sit on screen next to
 * the new song's audio.
 */
const OLD_KEY: KeyEstimate = { tonic: 6, mode: "minor", confidence: 0.81, name: "F# minor" };
const NEW_KEY: KeyEstimate = { tonic: 0, mode: "major", confidence: 0.74, name: "C major" };

const track = (name: string): LibraryTrack => ({
  path: `/music/${name}`,
  fileName: name,
  title: null,
  artist: null,
  album: null,
  durationSec: null,
});

/** Drain the microtask queue far past any chain a load path builds. */
async function flush(turns = 20) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/**
 * Wait for a CONDITION, not for a number of turns — and yield real macrotasks
 * between polls so a step scheduled off the timer/IO queue can actually land.
 *
 * `flush(n)` is a guess about how far an action has progressed, and it is only
 * ever right by accident: it holds for `runExport` today because the browser
 * export lane happens to contain no `await` between the action's first line and
 * the analysis wait. Put one real async step in front of that wait — a lazy
 * `import()`, a timer, a disk probe — and a fixed microtask drain returns while
 * the action is still upstream of the thing the test came to observe. Whether
 * that matters then depends on wall-clock timing, which is how a deterministic
 * ordering bug in a test presents as a 1-in-N flake under load.
 *
 * The budget is wall-clock generous on purpose. Every condition below is
 * reached in microtasks of actual WORK, so the budget bounds nothing but a
 * genuine hang; a loaded machine does not trip it, and the enclosing `it` is
 * given a larger explicit timeout so this reports the named condition rather
 * than dying as an anonymous vitest timeout.
 */
async function until(what: string, predicate: () => boolean, budgetMs = 5_000) {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${budgetMs}ms elapsed and ${what} never happened`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The store's own `awaitAnalysis`, captured once, plus the barrier an export
 * was actually handed.
 *
 * `watchTheBarrier()` installs a PASS-THROUGH wrapper: it calls the real action
 * and returns its exact promise, so nothing about the state under assertion
 * changes. All it buys is that "the export is now parked on THIS barrier"
 * becomes an observed fact instead of an assumption about microtask counts —
 * and that is the precondition the supersede-release scenario stands on, since
 * an export that has not taken A's barrier yet will take B's instead and the
 * release under test never applies to it.
 */
const realAwaitAnalysis = useVizStore.getState().awaitAnalysis;
let barrierTaken: Promise<void> | null = null;
function watchTheBarrier() {
  barrierTaken = null;
  useVizStore.setState({
    awaitAnalysis: () => {
      const barrier = realAwaitAnalysis();
      barrierTaken ??= barrier;
      return barrier;
    },
  });
}

/** The options object the export JOB was actually built from. */
function jobOptions(): ExportOptions {
  return vi.mocked(exportVideo).mock.calls[0][1];
}

/** Arm the analysis worker's reply for the NEXT analyzeCurrentTrack(). */
function armAnalysis() {
  const gate = deferred<TrackAnalysis>();
  vi.mocked(analyzeTrack).mockReturnValue({ id: 1, result: gate.promise });
  return gate;
}

/**
 * Put a REAL, fully-analysed previous track in the store, the way a completed
 * load leaves it — grid, key, sections and waveform overview all present, and
 * `analyzing` back to false. Hand-writing those with setState would prove
 * nothing about the state a load actually produces.
 */
async function loadAndAnalysePreviousTrack() {
  engineState.buffer = OLD_AUDIO;
  const analysis = armAnalysis();
  s().analyzeCurrentTrack();
  analysis.resolve({ grid: OLD_GRID, key: OLD_KEY, sections: OLD_SECTIONS });
  await flush();
  expect(s().beatGrid).toEqual(OLD_GRID);
  expect(s().sections).toEqual(OLD_SECTIONS);
  expect(s().waveformOverview).not.toBeNull();
  // The key is asserted HERE too, not only after the window: a fixture that
  // resolved `key: null` (as this one did) leaves the window's
  // `expect(trackKey).toBeNull()` unable to fail — proven by deleting
  // `trackKey: null` from invalidateAnalysis and watching the suite stay green.
  expect(s().trackKey).toEqual(OLD_KEY);
  expect(s().analyzing).toBe(false);
  vi.mocked(analyzeTrack).mockReset(); // the NEXT analysis is the one under test
}

/**
 * Start a real `loadFile` and stop inside the E3c window: the new audio is the
 * engine's buffer and playing, the tag scan has not landed.
 *
 * The handle comes back WRAPPED. Returning the promise itself from an async
 * helper makes the caller's `await` unwrap it, parking the test on the very
 * load it means to observe mid-flight.
 */
async function loadFileIntoTheWindow(name = "next.mp3") {
  const load = s().loadFile(new File([], name));
  engineState.decode.resolve(); // engine.buffer = NEW_AUDIO
  engineState.play.resolve();
  await flush();
  // Proof this is really the window and not somewhere past it: the load is
  // parked on the tag scan, the await that makes the window seconds long.
  expect(tagScans).toHaveLength(1);
  expect(engine.audioBuffer).toBe(NEW_AUDIO);
  return { load };
}

/** The same window, reached with no user input at all: `engine.onEnded` fires
 * and the library advances itself into the prefetched next track. */
async function advanceIntoTheWindow() {
  useVizStore.setState({
    library: { dir: "/music", tracks: [track("a.mp3"), track("b.mp3")] },
    libraryActivePath: "/music/a.mp3",
    libraryAutoAdvance: true,
  });
  shared.libraryPrefetch = {
    path: "/music/b.mp3",
    file: new File([], "b.mp3"),
    buffer: NEW_AUDIO,
  };
  const advance = s().advanceLibrary();
  engineState.play.resolve();
  await flush();
  expect(tagScans).toHaveLength(1);
  expect(engine.audioBuffer).toBe(NEW_AUDIO);
  return { advance };
}

/**
 * The same window, reached the way a first-time user reaches it: the empty
 * state's demo buttons. `loadDemo` has no tag scan — its window is bounded by
 * `engine.play()`, which is why the deferred left open here is that one.
 */
async function loadDemoIntoTheWindow(id = "groove") {
  const load = s().loadDemo(id);
  expect(demoRenders).toHaveLength(1);
  demoRenders[0].resolve(NEW_AUDIO); // OfflineAudioContext.startRendering lands
  await flush();
  // Proof this is the window: the demo's audio is installed and playing, and
  // the analysis of it has not been asked for yet.
  expect(engine.audioBuffer).toBe(NEW_AUDIO);
  expect(engine.loadBuffer).toHaveBeenCalledTimes(1);
  expect(analyzeTrack).not.toHaveBeenCalled();
  return { load };
}

/** Land the tag scan, then the analysis worker's reply for the new track. */
async function completeTheLoad(
  grid: BeatGrid = NEW_GRID,
  sections = NEW_SECTIONS,
  key: KeyEstimate = NEW_KEY,
) {
  const analysis = armAnalysis();
  tagScans[0].resolve("Next");
  await flush();
  analysis.resolve({ grid, key, sections });
  await flush();
}

beforeEach(async () => {
  vi.mocked(exportVideo).mockClear();
  vi.mocked(analyzeTrack).mockReset();
  engineState.buffer = OLD_AUDIO;
  engineState.decode = deferred();
  engineState.play = deferred();
  tagScans.length = 0;
  demoRenders.length = 0;
  analyzer.setBeatGrid.mockClear();
  analyzer.setSections.mockClear();
  engine.loadBuffer.mockClear();
  engine.play.mockClear();
  // A stale claim would make every "no job was built" assertion pass vacuously
  // at runExport's re-entrancy guard instead of at the thing under test.
  shared.exportStarting = false;
  shared.exportAbort = null;
  shared.libraryPrefetch = null;
  useVizStore.setState({
    simplifiedRenderer: false,
    exporting: null,
    exportError: null,
    exportDone: null,
    batchStatus: "idle",
    beatGrid: null,
    trackKey: null,
    sections: [],
    waveformOverview: null,
    analyzing: false,
    lyrics: null,
    error: null,
    library: null,
    libraryActivePath: null,
    libraryAutoAdvance: true,
    exportSettings: { ...s().exportSettings, mode: "video", format: "mp4", codec: "h264" },
  });
  // store.ts's analysis bookkeeping (the outstanding-analysis barrier and the
  // unclaimed-invalidation id) is module scope: it outlives a `setState`
  // reset, and a leak from one test would be REUSED by the next test's load
  // and silently disable its invalidation. Run one real analysis to completion
  // so every test starts with nothing outstanding.
  const drain = armAnalysis();
  s().analyzeCurrentTrack();
  drain.resolve({ grid: OLD_GRID, key: null, sections: OLD_SECTIONS });
  await flush();
  expect(s().analyzing).toBe(false);
  vi.mocked(analyzeTrack).mockReset();
  useVizStore.setState({ beatGrid: null, trackKey: null, sections: [], waveformOverview: null });
});

afterEach(() => {
  vi.useRealTimers();
  // Put the real action back: the barrier watcher is an observer, and no test
  // may inherit another test's wrapper.
  useVizStore.setState({ awaitAnalysis: realAwaitAnalysis });
  barrierTaken = null;
});

describe("a load voids the previous track's analysis at the audio, not at the tag scan", () => {
  it("leaves no stale grid observable once the new audio is in the engine", async () => {
    await loadAndAnalysePreviousTrack();

    const { load } = await loadFileIntoTheWindow();

    // The whole defect: every one of these described the song that just
    // stopped, while the engine was already playing the new one. `trackKey`
    // is one of them and not a formality — it was `OLD_KEY` one line ago, and
    // the key badge reads it straight out of the store.
    expect(s().beatGrid).toBeNull();
    expect(s().trackKey).toBeNull();
    expect(s().sections).toEqual([]);
    expect(s().waveformOverview).toBeNull();
    // …and the live analyzer's copy, which drives the preview's beat pulses.
    expect(analyzer.setBeatGrid).toHaveBeenLastCalledWith(null);
    expect(analyzer.setSections).toHaveBeenLastCalledWith(null);
    // The gate E3b reads is closed, so the window is not merely empty — it is
    // declared. (Both halves matter: nulls with `analyzing: false` is E3b's
    // bug, and the old grid with `analyzing: false` is this one.)
    expect(s().analyzing).toBe(true);

    await completeTheLoad();
    await load;

    expect(s().beatGrid).toEqual(NEW_GRID);
    expect(s().sections).toEqual(NEW_SECTIONS);
    expect(s().trackKey).toEqual(NEW_KEY); // this song's key, not the last one's
    expect(s().waveformOverview).not.toBeNull();
    expect(s().analyzing).toBe(false);
  });

  it("does the same on the near-gapless auto-advance, which needs no click", async () => {
    await loadAndAnalysePreviousTrack();

    const { advance } = await advanceIntoTheWindow();

    expect(s().beatGrid).toBeNull();
    expect(s().trackKey).toBeNull();
    expect(s().sections).toEqual([]);
    expect(s().waveformOverview).toBeNull();
    expect(s().analyzing).toBe(true);

    await completeTheLoad();
    await advance;

    expect(s().beatGrid).toEqual(NEW_GRID);
    expect(s().trackKey).toEqual(NEW_KEY);
    expect(s().analyzing).toBe(false);
    expect(s().libraryActivePath).toBe("/music/b.mp3");
  });

  it("the gapless advance resets the analyzer source like every other load path (R2-32b)", async () => {
    await loadAndAnalysePreviousTrack();
    analyzer.reset.mockClear();

    const { advance } = await advanceIntoTheWindow();

    // Different audio entirely: detector history, peak caps, the drive
    // envelope and the grid readouts (bpm/phases — R2-32a) all describe the
    // song that just ended. loadFile and loadDemo have always fired this at
    // the moment the new audio lands; the prefetch advance was the one load
    // path that skipped it, so the first frames of the next song ran on the
    // dead track's analyser state.
    expect(analyzer.reset).toHaveBeenCalledWith("source");
    // Ordered like its siblings: the reset lands with the buffer swap,
    // before playback starts.
    expect(analyzer.reset.mock.invocationCallOrder[0]).toBeLessThan(
      engine.play.mock.invocationCallOrder[0],
    );

    await completeTheLoad();
    await advance;
  });

  it("does the same for a demo track, the third load path and the first one a new user takes", async () => {
    await loadAndAnalysePreviousTrack();

    const { load } = await loadDemoIntoTheWindow();

    expect(s().beatGrid).toBeNull();
    expect(s().trackKey).toBeNull();
    expect(s().sections).toEqual([]);
    expect(s().waveformOverview).toBeNull();
    expect(analyzer.setBeatGrid).toHaveBeenLastCalledWith(null);
    expect(analyzer.setSections).toHaveBeenLastCalledWith(null);
    expect(s().analyzing).toBe(true);

    // Let playback start; the demo's own analysis then lands on top.
    const analysis = armAnalysis();
    engineState.play.resolve();
    await flush();
    analysis.resolve({ grid: NEW_GRID, key: NEW_KEY, sections: NEW_SECTIONS });
    await load;
    await flush();

    expect(s().beatGrid).toEqual(NEW_GRID);
    expect(s().trackKey).toEqual(NEW_KEY);
    expect(s().sections).toEqual(NEW_SECTIONS);
    expect(s().waveformOverview).not.toBeNull();
    expect(s().analyzing).toBe(false);
    expect(s().trackMeta.title).toBe(demos[0].name);
  });
});

describe("an export fired inside the window (E3c composed with E3b's gate)", () => {
  it("waits, then builds the job from the NEW track's grid — never the old one, never null", async () => {
    await loadAndAnalysePreviousTrack();
    const { load } = await loadFileIntoTheWindow();

    const run = s().runExport();
    // Several microtask turns: enough for the whole (mocked) export to have
    // built and finished its job had nothing been waiting on. No assertion on
    // the payload here — let an unguarded implementation build its job and be
    // judged on what is in it.
    await flush(10);
    expect(exportVideo).not.toHaveBeenCalled();
    // …and it waits behind a visible Cancel, not a frozen button.
    expect(s().exporting).not.toBeNull();
    // The audio it will render is already the NEW track's — which is why the
    // old grid would have been a mixed-track render, not a merely stale one.
    expect(engine.audioBuffer).toBe(NEW_AUDIO);

    await completeTheLoad();
    await load;
    await run;

    expect(exportVideo).toHaveBeenCalledTimes(1);
    expect(jobOptions().beatGrid).toEqual(NEW_GRID);
    expect(jobOptions().sections).toEqual(NEW_SECTIONS);
    expect(s().exportError).toBeNull();
  });

  it("waits inside the auto-advance window too, and never bakes in the finished track's grid", async () => {
    await loadAndAnalysePreviousTrack();
    const { advance } = await advanceIntoTheWindow();

    const run = s().runExport();
    await flush(10);
    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exporting).not.toBeNull();

    await completeTheLoad();
    await advance;
    await run;

    expect(exportVideo).toHaveBeenCalledTimes(1);
    expect(jobOptions().beatGrid).toEqual(NEW_GRID);
    expect(jobOptions().sections).toEqual(NEW_SECTIONS);
    expect(s().exportError).toBeNull();
  });
});

describe("`analyzing` is never left stuck by the earlier invalidation", () => {
  it("clears it when the load fails after the audio landed (an AudioContext that will not resume)", async () => {
    await loadAndAnalysePreviousTrack();

    const load = s().loadFile(new File([], "next.mp3"));
    engineState.decode.resolve();
    await flush();
    expect(s().analyzing).toBe(true); // invalidated: the gate is closed
    // `engine.play()` awaits `ctx.resume()`, which rejects when the context
    // cannot be resumed (device yanked, autoplay policy) — a real failure
    // AFTER the new audio is installed, i.e. inside the window.
    engineState.play.reject(new Error("The AudioContext was not allowed to start"));
    await load;
    await flush();

    expect(s().error).toContain("Could not decode");
    expect(s().analyzing).toBe(false);
    await expect(s().awaitAnalysis()).resolves.toBeUndefined();

    // And the export that follows is not sentenced to the full timeout: a real
    // (unfaked) timer armed BEFORE it proves no macrotask was ever awaited.
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);
    await s().runExport();
    expect(macrotaskRan).toBe(false);
    expect(exportVideo).toHaveBeenCalledTimes(1);
  });

  it("clears it when the auto-advance fails after the buffer is installed", async () => {
    await loadAndAnalysePreviousTrack();
    useVizStore.setState({
      library: { dir: "/music", tracks: [track("a.mp3"), track("b.mp3")] },
      libraryActivePath: "/music/a.mp3",
    });
    shared.libraryPrefetch = {
      path: "/music/b.mp3",
      file: new File([], "b.mp3"),
      buffer: NEW_AUDIO,
    };

    const advance = s().advanceLibrary();
    await flush();
    expect(s().analyzing).toBe(true);
    engineState.play.reject(new Error("The AudioContext was not allowed to start"));
    // It must not reject either: `engine.onEnded` calls this as a floating
    // promise, so a throw here is an unhandled rejection.
    await expect(advance).resolves.toBeUndefined();
    await flush();

    expect(s().error).toContain("Could not play");
    expect(s().analyzing).toBe(false);
    await expect(s().awaitAnalysis()).resolves.toBeUndefined();
  });

  it("clears it when the demo cannot start playing — the path with nothing else to close the gate", async () => {
    // `loadDemo`'s only await between its invalidation and the analysis job is
    // `engine.play()`, and that is the one that fails on a real machine: an
    // AudioContext the autoplay policy will not resume, or a device pulled out
    // under it. Nothing downstream runs, so this exit is the ONLY thing that
    // can reopen the gate — and since E3b a stuck gate does not show up as a
    // spinner, it shows up as every later export sitting out the full analysis
    // timeout and then being refused.
    await loadAndAnalysePreviousTrack();

    const load = s().loadDemo("groove");
    demoRenders[0].resolve(NEW_AUDIO);
    await flush();
    expect(s().analyzing).toBe(true); // invalidated: the gate is closed
    engineState.play.reject(new Error("The AudioContext was not allowed to start"));
    await load;
    await flush();

    expect(s().error).toContain("Demo failed");
    expect(s().analyzing).toBe(false);
    await expect(s().awaitAnalysis()).resolves.toBeUndefined();

    // The symptom, stated as the user would meet it: the next export runs,
    // and a real (unfaked) timer armed before it proves nothing macrotask-
    // scheduled — i.e. no timeout race — was ever awaited.
    let macrotaskRan = false;
    setTimeout(() => {
      macrotaskRan = true;
    }, 0);
    await s().runExport();
    expect(macrotaskRan).toBe(false);
    expect(exportVideo).toHaveBeenCalledTimes(1);
    expect(s().exportError).toBeNull();
  });

  it("leaves the flag alone when a decode fails while the CURRENT track is still analysing", async () => {
    // The over-clearing trap: this load never installed audio, so the engine
    // still holds the track being analysed and that analysis is still coming.
    // Clearing here would re-open E3b's null-grid window on a live track.
    const analysis = armAnalysis();
    s().analyzeCurrentTrack();
    expect(s().analyzing).toBe(true);

    const load = s().loadFile(new File([], "corrupt.mp3"));
    engineState.decode.reject(new Error("Unable to decode audio data"));
    await load;
    await flush();

    expect(s().error).toContain("Could not decode");
    expect(s().analyzing).toBe(true); // still coming — do not open the gate
    analysis.resolve({ grid: NEW_GRID, key: null, sections: NEW_SECTIONS });
    await flush();
    expect(s().analyzing).toBe(false);
    expect(s().beatGrid).toEqual(NEW_GRID);
  });

  it("clears it when a superseding load fails before installing any audio of its own", async () => {
    // A invalidates and is then superseded by B, so A returns at its
    // generation guard and never analyses; B's decode then fails, so B never
    // invalidates either. Nobody is left to clear the flag A closed — unless
    // the exit rule is "an invalidation no job claimed", which is what makes B
    // responsible for A's.
    await loadAndAnalysePreviousTrack();
    const loadA = s().loadFile(new File([], "a.mp3"));
    engineState.decode.resolve();
    engineState.play.resolve();
    await flush();
    expect(s().analyzing).toBe(true);
    expect(tagScans).toHaveLength(1); // A is parked on its tag scan

    engineState.decode = deferred(); // B gets its own decode
    const loadB = s().loadFile(new File([], "b.mp3"));
    engineState.decode.reject(new Error("Unable to decode audio data"));
    // A's tag scan lands after B claimed the generation: A must return without
    // touching state, so B's failure is the only exit left to clear the flag.
    tagScans[0].resolve("A");
    await Promise.all([loadA, loadB]);
    await flush();

    expect(s().error).toContain("Could not decode");
    expect(s().analyzing).toBe(false);
    await expect(s().awaitAnalysis()).resolves.toBeUndefined();
    expect(analyzeTrack).not.toHaveBeenCalled(); // A really never analysed
  });

  it("does not let a superseded load clear the flag its successor now owns", async () => {
    await loadAndAnalysePreviousTrack();
    const loadA = s().loadFile(new File([], "a.mp3"));
    engineState.decode.resolve();
    engineState.play.resolve();
    await flush();
    expect(tagScans).toHaveLength(1);

    // B claims the generation and installs its own audio.
    engineState.decode = deferred();
    engineState.play = deferred();
    const loadB = s().loadFile(new File([], "b.mp3"));
    engineState.decode.resolve();
    engineState.play.resolve();
    // A's tag scan now lands: A exits at its generation guard. If that exit
    // cleared the flag, B would sit in its own window with `analyzing: false`
    // over null grids — E3b's bug, handed back.
    tagScans[0].resolve("A");
    await loadA;
    await flush();

    expect(tagScans).toHaveLength(2); // B is parked on its own scan
    expect(s().analyzing).toBe(true);
    expect(s().beatGrid).toBeNull();

    // B completes normally on top of it.
    const analysis = armAnalysis();
    tagScans[1].resolve("B");
    await flush();
    analysis.resolve({ grid: NEW_GRID, key: null, sections: NEW_SECTIONS });
    await loadB;
    await flush();

    expect(s().trackMeta.title).toBe("B");
    expect(s().beatGrid).toEqual(NEW_GRID);
    expect(s().analyzing).toBe(false);
  });
});

describe("a superseding load releases the waiter it inherits", () => {
  // Explicit budget, deliberately larger than `until`'s 5 s: the failure this
  // test exists to catch is a waiter nobody releases, and it should report that
  // condition by name instead of dying as an anonymous vitest timeout — the
  // same reasoning (and the same remedy) as dspCharacterization's budgets.
  it("wakes an export parked on the analysis it just superseded, instead of stranding it until the timeout", async () => {
    await loadAndAnalysePreviousTrack();

    // A goes all the way to a STARTED analysis job. That is the only state in
    // which a later load reaches the supersede-release at all: an invalidation
    // no job has claimed yet is REUSED by the next load, not replaced, so the
    // barrier is only ever swapped out from under a job that is running.
    const jobA = armAnalysis();
    const { load: loadA } = await loadFileIntoTheWindow("a.mp3");
    tagScans[0].resolve("A");
    await loadA;
    await flush();
    expect(analyzeTrack).toHaveBeenCalledTimes(1);
    expect(s().analyzing).toBe(true); // A's job is in flight

    // A REAL waiter, holding the exact promise object the release has to
    // settle — `awaitAnalysis()` handed runExport A's barrier.
    watchTheBarrier();
    const run = s().runExport();
    // ENFORCED, not assumed. The export must ALREADY be holding A's barrier
    // when the superseding load appears — an export that has not reached the
    // wait yet takes B's barrier instead, which no supersede releases, and
    // this test then fails with `exportError` still null. That is a fixed
    // property of the interleaving, but a `flush(n)` here turns it into a
    // wall-clock race the machine decides.
    await until("the export to take the analysis barrier", () => barrierTaken !== null);
    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().exporting).not.toBeNull();
    // …and it is a REAL wait. An already-resolved promise here would mean the
    // export sailed straight through the gate, and everything below would be
    // proving nothing. Read after a macrotask hop, which always drains the
    // microtask queue first.
    let barrierSettled = false;
    void barrierTaken?.then(() => {
      barrierSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(barrierSettled).toBe(false);

    // B installs its own audio and supersedes A's analysis…
    engineState.decode = deferred();
    engineState.play = deferred();
    const loadB = s().loadFile(new File([], "b.mp3"));
    engineState.decode.resolve();
    engineState.play.resolve();
    await flush();
    // …and A's worker then replies into a store that DROPS the result at
    // `id !== analysisId`. Nobody downstream of A settles anything after that,
    // which is precisely why the superseding load has to do it.
    jobA.resolve({ grid: OLD_GRID, key: OLD_KEY, sections: OLD_SECTIONS });

    // Woken by the release, and refused rather than rendered: `buf` is A's
    // audio and everything read after the wait would be B's. Waited for by
    // CONDITION — a stranded export never satisfies it and fails by name well
    // inside this test's budget, instead of hanging out the 300 s timeout.
    await until("the superseded export to be refused", () => s().exportError !== null);
    // WHICH refusal matters as much as that there is one, and it is the part
    // no clock can make wrong: the track-changed refusal means the release
    // woke it, the timeout refusal would mean it was stranded and rescued by
    // the clock. The full phrase, too — "The track changed" alone is also the
    // opening of the identity check further down runExport.
    expect(s().exportError).toContain("The track changed while it was being analyzed");
    expect(s().exportError).not.toContain("did not finish within");
    expect(exportVideo).not.toHaveBeenCalled();
    expect(s().beatGrid).toBeNull(); // A's superseded result never landed
    await run;

    // B completes normally on top, leaving the module-scope analysis
    // bookkeeping closed for whatever test runs next.
    const jobB = armAnalysis();
    tagScans[1].resolve("B");
    await flush();
    jobB.resolve({ grid: NEW_GRID, key: NEW_KEY, sections: NEW_SECTIONS });
    await loadB;
    await flush();
    expect(s().beatGrid).toEqual(NEW_GRID);
    expect(s().trackKey).toEqual(NEW_KEY);
    expect(s().analyzing).toBe(false);
  }, 30_000);
});
