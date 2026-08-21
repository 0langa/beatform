import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Track-generation guard on the lyrics sidecar actions (SS-1): a result
 * computed from track A's audio must never land on track B. generateLyrics
 * runs for MINUTES — plenty of time to load another track — and loadFile
 * clears lyrics per-track on purpose; a stale result landing after that clear
 * would re-fill it under the new track's name, with a success toast. Same
 * convention as addStem: capture `shared.trackLoadGen` with the buffer,
 * compare before applying. The sidecar itself is mocked — under test is the
 * store's own staleness bookkeeping.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("../services", () => {
  // ONE engine object across getEngine() calls: generateLyrics reads
  // audioBuffer at entry and state.trackName at completion.
  const engine = {
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
    audioBuffer: null as AudioBuffer | null,
    state: { trackName: "Track A.mp3" },
  };
  return {
    initServices: vi.fn(() => vi.fn()),
    getEngine: vi.fn(() => engine),
    getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
    peekAnalyzer: vi.fn(() => null),
    getRenderer: vi.fn(() => null),
    setLiveRenderPaused: vi.fn(),
    remeasure: vi.fn(),
  };
});

// Deferred sidecar results: the tests resolve these by hand so a "track
// load" can happen while the job is still in flight.
const h = vi.hoisted(() => ({
  resolveGenerate: null as ((lrc: string) => void) | null,
  resolveAlign: null as
    ((words: { t: number; end: number; conf: number; text: string }[]) => void) | null,
  // Captured so tests can feed synthetic progress/stageDone/result lines
  // through the SAME onLine the real Tauri Channel would call — this is
  // what lets stage-transition (a) and measured-RTF (b) be tested against
  // the actual store wiring, not just the pure lyricsGen.ts reducers.
  onLine: null as ((line: string) => void) | null,
}));

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return {
    ...actual,
    isTauri: () => true,
    askConfirm: vi.fn(async () => true),
    writeAutosave: vi.fn(async () => {}),
    // The tier-download surface (R2-31g): probe answers "unknown volume" by
    // default (no confirm), downloads settle instantly, and the state
    // refresh hands back whatever a test staged in the store.
    diskSpace: vi.fn(async () => null),
    lyricsModelDownload: vi.fn(async () => {}),
    lyricsModelsState: vi.fn(async () => useVizStore.getState().lyricsGen.models!),
    lyricsDownloadCancel: vi.fn(async () => {}),
    lyricsStageAudio: vi.fn(async () => {}),
    lyricsGenerate: vi.fn(
      (_opts: unknown, onLine: (line: string) => void) =>
        new Promise<string>((resolve) => {
          h.resolveGenerate = resolve;
          h.onLine = onLine;
        }),
    ),
    lyricsAlignLine: vi.fn(
      () =>
        new Promise<{ t: number; end: number; conf: number; text: string }[]>((resolve) => {
          h.resolveAlign = resolve;
        }),
    ),
  };
});

// Dynamic import: a static one would hoist above the global stubs (the
// store.test.ts discipline).
const { useVizStore } = await import("../store");
const { getEngine } = await import("../services");
const { shared } = await import("./shared");
const { askConfirm, lyricsStageAudio } = await import("../platform");
const { LYRICS_MAX_TRACK_SEC } = await import("./lyricsGenActions");
const { getPrefs, setPrefs } = await import("../prefs");
const { NO_MEASURED_RTF } = await import("../lyricsGen");

const LRC =
  "[00:12.00]Out of my mind\n" + "[00:19.65]Plain fallback line\n" + "[00:24.00]Third line here\n";

/** Minimal AudioBuffer stand-in for pcmFromAudioBuffer/wavFromPcm. */
function fakeBuffer(durationSec: number, sampleRate = 100): AudioBuffer {
  const length = Math.round(durationSec * sampleRate);
  return {
    numberOfChannels: 1,
    sampleRate,
    length,
    duration: durationSec,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

const engine = getEngine() as unknown as { audioBuffer: AudioBuffer | null };
const s = () => useVizStore.getState();

/** Poll until the mocked sidecar call has been reached (a few macrotasks). */
async function until(cond: () => boolean) {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
}

beforeEach(() => {
  engine.audioBuffer = fakeBuffer(60);
  s().clearLyrics();
  useVizStore.setState({ notice: null, error: null });
  h.resolveGenerate = null;
  h.resolveAlign = null;
  h.onLine = null;
  vi.mocked(askConfirm).mockClear();
  vi.mocked(lyricsStageAudio).mockClear();
  // measuredRtf is a module-level singleton (prefs.ts), not store state —
  // reset it directly so one test's persisted RTF can never leak into the
  // next one's estimate.
  setPrefs({ measuredRtf: NO_MEASURED_RTF });
});

describe("generateLyrics track guard", () => {
  it("discards the result, with an honest notice, when a new track loaded mid-run", async () => {
    const done = s().generateLyrics("small", "auto");
    await until(() => h.resolveGenerate !== null);
    // A new track lands while the sidecar runs: loadFile bumps the generation
    // and clears the per-track lyrics.
    shared.trackLoadGen++;
    useVizStore.setState({ lyrics: null, lyricFileName: null });
    h.resolveGenerate!(LRC);
    await done;

    expect(s().lyrics).toBeNull(); // track B never receives track A's lines
    expect(s().lyricFileName).toBeNull();
    expect(s().notice).toBe("Track changed — generated lyrics discarded");
    expect(s().lyricsGen.phase).toBe("idle"); // finally still resets
  });

  it("applies normally when the track did not change", async () => {
    const done = s().generateLyrics("small", "auto");
    await until(() => h.resolveGenerate !== null);
    h.resolveGenerate!(LRC);
    await done;

    expect(s().lyrics).toHaveLength(3);
    expect(s().lyricFileName).toBe("Track A (generated).lrc");
    expect(s().lyricsGen.phase).toBe("idle");
  });
});

describe("generateLyrics track length ceiling", () => {
  it("refuses a track over the 90-minute limit before staging anything", async () => {
    engine.audioBuffer = fakeBuffer(LYRICS_MAX_TRACK_SEC + 1); // 5401s, one second over
    await s().generateLyrics("small", "auto");

    expect(s().error).toBe(
      "This track is 1 h 31 min — automatic lyrics support tracks up to 90 minutes.",
    );
    expect(s().lyricsGen.phase).toBe("idle");
    expect(lyricsStageAudio).not.toHaveBeenCalled();
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("proceeds past the gate at exactly the 90-minute limit (5400s)", async () => {
    engine.audioBuffer = fakeBuffer(LYRICS_MAX_TRACK_SEC);
    const done = s().generateLyrics("small", "auto");
    await until(() => h.resolveGenerate !== null);

    expect(lyricsStageAudio).toHaveBeenCalledTimes(1);
    expect(s().error).toBeNull();
    h.resolveGenerate!(LRC);
    await done;

    expect(s().lyricsGen.phase).toBe("idle");
  });

  it("refuses an over-limit track without the replace-lyrics prompt, even with lyrics already loaded", async () => {
    s().loadLyricsText("song.lrc", LRC);
    engine.audioBuffer = fakeBuffer(LYRICS_MAX_TRACK_SEC + 1);
    await s().generateLyrics("small", "auto");

    expect(s().error).toBe(
      "This track is 1 h 31 min — automatic lyrics support tracks up to 90 minutes.",
    );
    expect(s().lyricsGen.phase).toBe("idle");
    expect(askConfirm).not.toHaveBeenCalled(); // refusal precedes the replace prompt
    expect(lyricsStageAudio).not.toHaveBeenCalled();
    expect(s().lyrics).toHaveLength(3); // untouched — never even asked to replace
  });
});

describe("realignLyricLine track guard", () => {
  it("drops a stale alignment even when the new lyrics repeat the text at the same index", async () => {
    s().loadLyricsText("song.lrc", LRC);

    const done = s().realignLyricLine(2); // "Third line here"
    await until(() => h.resolveAlign !== null);
    // Track swap mid-align, then the same lyrics file loaded for the new
    // track — text identical at the same index, audio entirely different, so
    // the line-text check alone would let these words through.
    shared.trackLoadGen++;
    s().loadLyricsText("song.lrc", LRC);
    // The freshly loaded sheet (fresh session row ids and all, R2-31k) is
    // the exact state the stale result must leave untouched.
    const reloaded = JSON.stringify(s().lyrics);
    h.resolveAlign!([
      { t: 0.7, end: 1.0, conf: 0.9, text: "Third" },
      { t: 1.0, end: 1.3, conf: 0.9, text: "line" },
      { t: 1.4, end: 1.9, conf: 0.9, text: "here" },
    ]);
    await done;

    expect(JSON.stringify(s().lyrics)).toBe(reloaded); // timings from track A never applied
    expect(s().lyrics![2].words).toBeUndefined(); // ...word-for-word: nothing attached
    expect(s().lyricsRealign).toBeNull();
  });
});

/**
 * FEAT-004 follow-up (a): the store's onLine handler is thin wiring around
 * lyricsGen.ts's pure reduceGenProgress (unit-tested directly in
 * lyricsGen.test.ts). This is the wiring itself — real sidecar lines fed
 * through the SAME onLine callback lyricsGenerate would call, proving the
 * store actually reaches the reducer rather than, say, still running the
 * old inline stageDone handling beside it.
 */
describe("generateLyrics stage-transition display", () => {
  it('shows "starting <next stage>" the instant a stage completes, and clears once real progress arrives', async () => {
    const done = s().generateLyrics("small", "auto");
    await until(() => h.onLine !== null);

    h.onLine!(JSON.stringify({ type: "stageDone", stage: "vad", wallSec: 12 }));
    expect(s().lyricsGen.gen?.stage).toBe("transcribe");
    expect(s().lyricsGen.gen?.starting).toBe(true);
    expect(s().lyricsGen.gen?.pct).toBeNull();
    expect(s().lyricsGen.gen?.etaSec).toBeNull();

    h.onLine!(JSON.stringify({ type: "progress", stage: "transcribe", pct: 15, etaSec: 90 }));
    expect(s().lyricsGen.gen?.stage).toBe("transcribe");
    expect(s().lyricsGen.gen?.starting).toBe(false);
    expect(s().lyricsGen.gen?.pct).toBe(15);
    expect(s().lyricsGen.gen?.etaSec).toBe(90);

    h.resolveGenerate!(LRC);
    await done;
    expect(s().lyricsGen.phase).toBe("idle");
  });

  it("the terminal stage (assemble) keeps the old 100%-and-done shape — nothing to transition to", async () => {
    const done = s().generateLyrics("small", "auto");
    await until(() => h.onLine !== null);

    h.onLine!(JSON.stringify({ type: "stageDone", stage: "assemble", wallSec: 1 }));
    expect(s().lyricsGen.gen?.stage).toBe("assemble");
    expect(s().lyricsGen.gen?.starting).toBe(false);
    expect(s().lyricsGen.gen?.pct).toBe(100);

    h.resolveGenerate!(LRC);
    await done;
  });
});

/**
 * FEAT-004 follow-up (b): measured RTF persisted after a completed run,
 * through the real generateLyrics action end to end (staged isolate/
 * transcribe/align stageDone events, a result event carrying `ep`, then the
 * resolved LRC) — proving the wiring reaches setPrefs with the right keys.
 * The blend arithmetic itself (EWMA, the estimate blend) is pinned with
 * exact numbers in lyricsGen.test.ts; this file only owns "does the store
 * actually call it, with the right key, at the right time."
 */
describe("generateLyrics measured-RTF persistence", () => {
  function feedStageRtf() {
    h.onLine!(
      JSON.stringify({
        type: "stageDone",
        stage: "isolate",
        wallSec: 30,
        rtf: 0.5,
        detail: "DirectML",
      }),
    );
    h.onLine!(JSON.stringify({ type: "stageDone", stage: "vad", wallSec: 1 })); // no rtf — untracked stage
    h.onLine!(JSON.stringify({ type: "stageDone", stage: "transcribe", wallSec: 18, rtf: 0.3 }));
    h.onLine!(JSON.stringify({ type: "stageDone", stage: "align", wallSec: 9, rtf: 0.15 }));
  }

  it("blends isolate/transcribe/align RTF into the right MeasuredRtf keys (DML + small tier)", async () => {
    const done = s().generateLyrics("small", "auto");
    await until(() => h.onLine !== null);
    feedStageRtf();
    h.onLine!(
      JSON.stringify({
        type: "result",
        lrcPath: "x.lrc",
        lines: 3,
        vocalSec: 50,
        ep: "dml",
        language: "en",
      }),
    );
    h.resolveGenerate!(LRC);
    await done;

    const rtf = getPrefs().measuredRtf;
    expect(rtf.isolateDml).toBe(0.5); // ep: "dml" -> the DML slot, not CPU
    expect(rtf.isolateCpu).toBeNull();
    expect(rtf.whisperSmall).toBe(0.3); // tier: "small" -> the small slot, not medium
    expect(rtf.whisperMedium).toBeNull();
    expect(rtf.align).toBe(0.15); // align never splits
  });

  it("keys isolate/whisper on CPU + medium when that is what the run actually used", async () => {
    const done = s().generateLyrics("medium", "auto");
    await until(() => h.onLine !== null);
    feedStageRtf();
    h.onLine!(
      JSON.stringify({
        type: "result",
        lrcPath: "x.lrc",
        lines: 3,
        vocalSec: 50,
        ep: "cpu",
        language: "en",
      }),
    );
    h.resolveGenerate!(LRC);
    await done;

    const rtf = getPrefs().measuredRtf;
    expect(rtf.isolateCpu).toBe(0.5);
    expect(rtf.isolateDml).toBeNull();
    expect(rtf.whisperMedium).toBe(0.3);
    expect(rtf.whisperSmall).toBeNull();
  });

  it("a second completed run blends (EWMA) rather than overwriting the first", async () => {
    setPrefs({ measuredRtf: { ...NO_MEASURED_RTF, align: 0.2 } });
    const done = s().generateLyrics("small", "auto");
    await until(() => h.onLine !== null);
    h.onLine!(JSON.stringify({ type: "stageDone", stage: "align", wallSec: 4, rtf: 0.3 }));
    h.onLine!(
      JSON.stringify({
        type: "result",
        lrcPath: "x.lrc",
        lines: 1,
        vocalSec: 10,
        ep: "dml",
        language: "en",
      }),
    );
    h.resolveGenerate!(LRC);
    await done;

    // 0.2 + 0.3*(0.3-0.2) = 0.23 — same alpha=0.3 EWMA pinned exactly in
    // lyricsGen.test.ts; here it only matters that it moved TOWARD the new
    // sample without jumping straight to it.
    expect(getPrefs().measuredRtf.align).toBeCloseTo(0.23, 9);
  });

  it("never persists anything when the run never produced a result event", async () => {
    // A run that reaches loadLyricsText but whose result line was dropped —
    // there is no `ep` to key isolate on, so nothing should be written at
    // all rather than guessed.
    const done = s().generateLyrics("small", "auto");
    await until(() => h.onLine !== null);
    feedStageRtf();
    h.resolveGenerate!(LRC);
    await done;

    expect(getPrefs().measuredRtf).toEqual(NO_MEASURED_RTF);
  });

  it("discarded runs (track changed mid-generation) do not persist RTF either", async () => {
    const done = s().generateLyrics("small", "auto");
    await until(() => h.onLine !== null);
    feedStageRtf();
    h.onLine!(
      JSON.stringify({
        type: "result",
        lrcPath: "x.lrc",
        lines: 3,
        vocalSec: 50,
        ep: "dml",
        language: "en",
      }),
    );
    shared.trackLoadGen++;
    useVizStore.setState({ lyrics: null, lyricFileName: null });
    h.resolveGenerate!(LRC);
    await done;

    expect(getPrefs().measuredRtf).toEqual(NO_MEASURED_RTF);
  });
});

/**
 * R2-31g: downloadLyricsTier checked `phase === "idle"` and only THEN awaited
 * the disk probe before flipping the phase — two rapid clicks both passed the
 * check and started the same multi-hundred-MB download twice. The phase is
 * now claimed synchronously before the first await (enableMidi's midiStarting
 * claim, in phase form), and every exit restores idle through the finally.
 */
describe("downloadLyricsTier double-activation (R2-31g)", () => {
  function modelInfo(id: string, installed: boolean) {
    return {
      id,
      fileName: `${id}.bin`,
      bytes: 100,
      sha256: "x",
      role: "isolation",
      installed,
      partBytes: 0,
    };
  }
  const modelsFixture = () => ({
    modelsDir: "C:/models",
    models: [
      modelInfo("mdx-voc-ft", false), // the one missing file
      modelInfo("wav2vec2-align", true),
      modelInfo("wav2vec2-vocab", true),
      modelInfo("whisper-small", true),
    ],
  });

  it("a second click during the disk probe is refused — one download, not two", async () => {
    const { diskSpace, lyricsModelDownload } = await import("../platform");
    vi.mocked(lyricsModelDownload).mockClear();
    useVizStore.setState({
      lyricsGen: { ...s().lyricsGen, phase: "idle", download: null, models: modelsFixture() },
    });
    let releaseProbe!: (v: null) => void;
    vi.mocked(diskSpace).mockImplementationOnce(
      () =>
        new Promise((r) => {
          releaseProbe = r;
        }),
    );

    const first = s().downloadLyricsTier("small");
    const second = s().downloadLyricsTier("small"); // the double click
    releaseProbe(null);
    await Promise.all([first, second]);

    expect(lyricsModelDownload).toHaveBeenCalledTimes(1);
    expect(s().lyricsGen.phase).toBe("idle"); // the finally restored it
  });

  it("declining the low-disk confirm releases the claim", async () => {
    const { askConfirm, diskSpace, lyricsModelDownload } = await import("../platform");
    vi.mocked(lyricsModelDownload).mockClear();
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    vi.mocked(diskSpace).mockResolvedValueOnce({ root: "C:", freeBytes: 0, totalBytes: 1 });
    useVizStore.setState({
      lyricsGen: { ...s().lyricsGen, phase: "idle", download: null, models: modelsFixture() },
    });

    await s().downloadLyricsTier("small");

    expect(lyricsModelDownload).not.toHaveBeenCalled();
    expect(s().lyricsGen.phase).toBe("idle"); // a decline never wedges the UI
  });
});
