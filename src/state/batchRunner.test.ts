import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchRun, BatchTrack, JobStatus } from "./batch";
import type { FormatPreset } from "../export/buildExportOptions";
import type { ProjectDocument } from "./project";

vi.mock("./services", () => ({
  getEngine: vi.fn(),
  setLiveRenderPaused: vi.fn(),
}));

vi.mock("../audio/analysis/trackAnalysis", () => ({
  analyzeTrack: vi.fn(),
}));

// Only needed for the L19 "coherent state after cancel" tests below, which
// let one track's job actually succeed so there's a real "done" to protect
// from being swept up by the cancel-cleanup fix.
vi.mock("../export/videoExporter", () => ({
  exportVideo: vi.fn(),
}));
vi.mock("../export/buildExportOptions", () => ({
  buildExportOptions: vi.fn(() => ({}) as unknown),
}));
vi.mock("../render/overlay", () => ({
  rasterizeOverlay: vi.fn(() => Promise.resolve(null)),
}));

import { runBatch, ANALYSIS_TIMEOUT_MS, type BatchRunnerHooks } from "./batchRunner";
import { getEngine } from "./services";
import { analyzeTrack } from "../audio/analysis/trackAnalysis";
import { exportVideo } from "../export/videoExporter";
import { buildExportOptions } from "../export/buildExportOptions";
import { isRunComplete, retryFailed } from "./batch";
import { DEFAULT_AUDIOGRAM } from "./audiogram";

/**
 * M12 regression: neither decodeAudioData nor analyzeTrack ever saw
 * shouldStop(), and analyzeTrack's promise (trackAnalysis.ts) has no
 * rejection path for a worker that simply never replies — so a hung decode
 * or analysis blocked the whole batch loop forever, and Cancel/Skip were
 * both inert until it finished on its own (never, in the hang case).
 *
 * getEngine and analyzeTrack are mocked so these tests control exactly when
 * (and whether) decode/analysis "returns" without needing a real
 * AudioContext or analysis worker, neither of which exist in this test
 * environment.
 */

function fakeTrack(id: string): BatchTrack {
  return {
    id,
    file: {
      name: `${id}.mp3`,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as File,
    meta: { title: id, artist: "" },
    metaFromTags: false,
    coverArt: null,
    duration: 10,
  };
}

const fmt: FormatPreset = {
  id: "primary",
  label: "test",
  w: 64,
  h: 64,
  fps: 30,
  mbps: 1,
  format: "mp4",
  codec: "h264",
};

function fakeRun(tracks: BatchTrack[]): BatchRun {
  const jobs = tracks.map((t) => ({
    id: `job-${t.id}`,
    trackId: t.id,
    formatId: fmt.id,
    outPath: `/out/${t.id}.mp4`,
    totalFrames: 300,
    status: { k: "queued" } as JobStatus,
  }));
  return {
    // Only what the runner reads off the doc itself (R2-05 made the
    // audiogram one of those reads); everything else stays absent.
    doc: { audiogram: DEFAULT_AUDIOGRAM } as unknown as ProjectDocument,
    tracks,
    formats: [fmt],
    jobs,
    outDir: "/out",
    startedAt: Date.now(),
  };
}

function hooks(overrides: Partial<BatchRunnerHooks> = {}): {
  hooks: BatchRunnerHooks;
  statuses: Map<string, JobStatus>;
  trackControllers: Map<string, AbortController>;
} {
  const statuses = new Map<string, JobStatus>();
  const trackControllers = new Map<string, AbortController>();
  const hooks: BatchRunnerHooks = {
    onJobUpdate: (id, status) => statuses.set(id, status),
    onJobStart: () => {},
    onTrackStart: (trackId, ac) => trackControllers.set(trackId, ac),
    shouldStop: () => false,
    ...overrides,
  };
  return { hooks, statuses, trackControllers };
}

describe("runBatch decode/analysis interruption", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getEngine).mockReset();
    vi.mocked(analyzeTrack).mockReset();
  });

  it("does not hang forever when the batch is cancelled mid-decode, and marks the track skipped", async () => {
    vi.useFakeTimers();
    // decodeAudioData never resolves — simulates a wedged decode.
    vi.mocked(getEngine).mockReturnValue({
      ctx: { decodeAudioData: () => new Promise<AudioBuffer>(() => {}) },
    } as unknown as ReturnType<typeof getEngine>);

    const track = fakeTrack("t1");
    const run = fakeRun([track]);
    let stopped = false;
    const { hooks: h, statuses } = hooks({ shouldStop: () => stopped });

    const done = runBatch(run, h);
    let settled = false;
    void done.finally(() => {
      settled = true;
    });

    // Let the loop reach the decode call, then cancel the batch.
    await vi.advanceTimersByTimeAsync(0);
    stopped = true;
    // The stop is only noticed on the next poll tick (STOP_POLL_MS), which is
    // far shorter than the analysis timeout — prove THAT'S what fires.
    await vi.advanceTimersByTimeAsync(500);

    expect(settled).toBe(true);
    await done; // must not throw — the loop swallows per-track failures
    expect(statuses.get(`job-${track.id}`)).toEqual({ k: "skipped" });
  });

  it("fails (not hangs) when analysis never replies, after the timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(getEngine).mockReturnValue({
      ctx: { decodeAudioData: () => Promise.resolve({} as AudioBuffer) },
    } as unknown as ReturnType<typeof getEngine>);
    // analyzeTrack's own promise never settles — the exact "worker never
    // replies" case trackAnalysis.ts has no rejection path for.
    vi.mocked(analyzeTrack).mockReturnValue({
      id: 1,
      result: new Promise(() => {}),
    });

    const track = fakeTrack("t1");
    const run = fakeRun([track]);
    const { hooks: h, statuses } = hooks();

    const done = runBatch(run, h);
    let settled = false;
    void done.finally(() => {
      settled = true;
    });

    // Derived from the constant, not a copy of it: the timeout is sized for
    // real-world slow machines and long mixes and will be retuned, and a
    // hard-coded 59_000 here would silently start asserting nothing.
    await vi.advanceTimersByTimeAsync(ANALYSIS_TIMEOUT_MS - 1_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(true);
    await done;
    const status = statuses.get(`job-${track.id}`);
    expect(status?.k).toBe("failed");
  });

  it("Skip (the per-track controller) interrupts a hung decode without stopping the rest of the batch", async () => {
    vi.useFakeTimers();
    // t1's decode hangs forever; t2's never settles either (irrelevant to
    // this test — it just needs to be OBSERVABLY attempted).
    const decodeAudioData = vi.fn().mockReturnValue(new Promise<AudioBuffer>(() => {}));
    vi.mocked(getEngine).mockReturnValue({
      ctx: { decodeAudioData },
    } as unknown as ReturnType<typeof getEngine>);
    vi.mocked(analyzeTrack).mockReturnValue({
      id: 1,
      result: new Promise(() => {}),
    });

    const t1 = fakeTrack("t1");
    const t2 = fakeTrack("t2");
    const run = fakeRun([t1, t2]);
    let stopped = false;
    const { hooks: h, statuses, trackControllers } = hooks({ shouldStop: () => stopped });

    const done = runBatch(run, h);
    // Let the loop start decoding t1 and register its track controller.
    await vi.advanceTimersByTimeAsync(0);
    expect(trackControllers.has("t1")).toBe(true);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    // "Skip": abort just this track's controller, not the whole batch.
    trackControllers.get("t1")!.abort();
    await vi.advanceTimersByTimeAsync(200); // one poll tick — t1 gives up

    // t2's decode must still be ATTEMPTED — the batch as a whole was never
    // stopped, only t1's own window was aborted.
    await vi.advanceTimersByTimeAsync(0);
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
    expect(statuses.get(`job-${t1.id}`)).toEqual({ k: "skipped" });

    // Clean up: t2's decode is still hanging (by design) — cancel the whole
    // batch so the loop (and its timers) actually exit before the test ends.
    stopped = true;
    await vi.advanceTimersByTimeAsync(200);
    await done;
  });
});

/**
 * L19 regression: a cancelled run stranded any job the loop hadn't reached
 * yet as "queued" forever — isRunComplete (batch.ts) requires every job to
 * be in a terminal state, so batchStatus fell back to "idle" (never "done"),
 * and retryFailed only ever re-queues "failed" jobs, so that work had no
 * path back at all. A cancel must leave a COHERENT state: every job in a
 * terminal state, with the ones the run actually finished left untouched.
 */
describe("runBatch cancel leaves a coherent state", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getEngine).mockReset();
    vi.mocked(analyzeTrack).mockReset();
    vi.mocked(exportVideo).mockReset();
  });

  it("sweeps every never-reached job to skipped, without touching one that already finished", async () => {
    vi.useFakeTimers();
    vi.mocked(getEngine).mockReturnValue({
      // t1's decode succeeds immediately; t2's hangs forever.
      ctx: {
        decodeAudioData: vi
          .fn()
          .mockImplementationOnce(() => Promise.resolve({} as AudioBuffer))
          .mockImplementationOnce(() => new Promise<AudioBuffer>(() => {})),
      },
    } as unknown as ReturnType<typeof getEngine>);
    vi.mocked(analyzeTrack).mockReturnValue({
      id: 1,
      result: Promise.resolve({ grid: null, key: null, sections: [] }),
    });
    vi.mocked(exportVideo).mockResolvedValue({
      bytes: 1234,
      seconds: 10,
      audioCodec: "aac",
    });

    const t1 = fakeTrack("t1");
    const t2 = fakeTrack("t2");
    const t3 = fakeTrack("t3"); // never reached at all — batch cancels first
    const run = fakeRun([t1, t2, t3]);
    let stopped = false;
    const { hooks: h, statuses } = hooks({ shouldStop: () => stopped });

    const done = runBatch(run, h);
    // t1 decodes, analyses and exports synchronously-ish (all mocked to
    // resolve) — let that fully settle.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.get(`job-${t1.id}`)).toMatchObject({ k: "done" });

    // Now t2 is mid-decode (hanging). Cancel the whole batch.
    stopped = true;
    await vi.advanceTimersByTimeAsync(200); // one poll tick

    await done;

    // t1: actually finished this run — must NOT be touched by the sweep.
    expect(statuses.get(`job-${t1.id}`)).toMatchObject({ k: "done" });
    // t2: mid-flight when cancelled — resolved via the decode catch block.
    expect(statuses.get(`job-${t2.id}`)).toEqual({ k: "skipped" });
    // t3: its track was never even reached — this is exactly what the fix
    // adds: previously this stayed "queued" forever with nothing to ever
    // revisit it.
    expect(statuses.get(`job-${t3.id}`)).toEqual({ k: "skipped" });

    // Reconstruct what the store would hold (each onJobUpdate applied onto
    // the run) and confirm the run now reads as complete, not stuck at
    // "idle" forever, and that a subsequent "retry failed" correctly has
    // nothing to do (skipped jobs are left alone on purpose).
    const finalRun: BatchRun = {
      ...run,
      jobs: run.jobs.map((j) => ({ ...j, status: statuses.get(j.id) ?? j.status })),
    };
    expect(isRunComplete(finalRun)).toBe(true);
    expect(retryFailed(finalRun, Date.now())).toBe(finalRun); // no failed jobs -> no-op
  });
});

/**
 * R2-05: the batch lane dropped two inputs the interactive export carries —
 * the analysis `sections` (drives features.sectionIndex / sectionPulse in the
 * export walk) and the document's audiogram overlay — so a batched track
 * rendered with section reactions dead and the audiogram missing while a
 * single export of the same track/document showed both. One document, one
 * render: assert the built job receives them.
 */
describe("runBatch carries sections + audiogram into the job build (R2-05)", () => {
  beforeEach(() => {
    // Earlier describes in this file also drive buildExportOptions; these
    // tests read mock.calls[0], so start each from a clean call log.
    vi.mocked(buildExportOptions).mockClear();
  });
  afterEach(() => {
    vi.mocked(getEngine).mockReset();
    vi.mocked(analyzeTrack).mockReset();
    vi.mocked(exportVideo).mockReset();
  });

  function primeDecodeAnalyse(sections: number[], channel: Float32Array) {
    vi.mocked(getEngine).mockReturnValue({
      ctx: {
        decodeAudioData: () =>
          Promise.resolve({ getChannelData: () => channel } as unknown as AudioBuffer),
      },
    } as unknown as ReturnType<typeof getEngine>);
    vi.mocked(analyzeTrack).mockReturnValue({
      id: 1,
      result: Promise.resolve({ grid: null, key: null, sections }),
    });
    vi.mocked(exportVideo).mockResolvedValue({ bytes: 1, seconds: 1, audioCodec: "aac" });
  }

  it("passes the track's analysis sections and the doc audiogram with a per-track waveform", async () => {
    const sections = [0, 12.5, 34.9];
    primeDecodeAnalyse(sections, new Float32Array([0, 0.5, -1, 0.25]));

    const run = fakeRun([fakeTrack("t1")]);
    run.doc = {
      audiogram: { ...DEFAULT_AUDIOGRAM, waveformStrip: true },
    } as unknown as ProjectDocument;
    await runBatch(run, hooks().hooks);

    expect(vi.mocked(buildExportOptions)).toHaveBeenCalledTimes(1);
    const track = vi.mocked(buildExportOptions).mock.calls[0][2];
    expect(track.sections).toEqual(sections);
    // The document's audiogram settings ride through as-is...
    expect(track.audiogram?.settings).toEqual(run.doc.audiogram);
    // ...and the waveform is THIS track's peak-envelope overview: the same
    // 4096-bucket |peak| shape analyzeCurrentTrack feeds the live strip.
    const wf = track.audiogram?.waveform;
    expect(wf).toBeInstanceOf(Float32Array);
    expect(wf).toHaveLength(4096);
    expect(Array.from(wf!.slice(0, 4))).toEqual([0, 0.5, 1, 0.25]);
    expect(wf![4]).toBe(0);
  });

  it("an audiogram with every element off stays undefined, like the interactive lane", async () => {
    primeDecodeAnalyse([], new Float32Array(4));
    const run = fakeRun([fakeTrack("t1")]);
    await runBatch(run, hooks().hooks);
    expect(vi.mocked(buildExportOptions).mock.calls[0][2].audiogram).toBeUndefined();
  });
});

/**
 * F2 regression: on a machine with no WebGPU, every job's export worker throws
 * GpuInitError — a property of the MACHINE, not of the track. The loop's "one
 * job's failure is one job's failure" rule (correct for a bad file, a full
 * disk, a lost device) turned that into 20 identical red errors, each paid for
 * with a full decode + analysis of a track that was never going to render.
 * The queue must give up on the first one instead.
 */
describe("runBatch aborts the whole run when WebGPU is unavailable (F2)", () => {
  afterEach(() => {
    vi.mocked(getEngine).mockReset();
    vi.mocked(analyzeTrack).mockReset();
    vi.mocked(exportVideo).mockReset();
  });

  it("stops after the first GpuInitError and never decodes the remaining tracks", async () => {
    const decodeAudioData = vi.fn(() => Promise.resolve({} as AudioBuffer));
    vi.mocked(getEngine).mockReturnValue({
      ctx: { decodeAudioData },
    } as unknown as ReturnType<typeof getEngine>);
    vi.mocked(analyzeTrack).mockReturnValue({
      id: 1,
      result: Promise.resolve({ grid: null, key: null, sections: [] }),
    });
    // Exactly what exportCore throws when WebGPURenderer.create() fails.
    vi.mocked(exportVideo).mockImplementation(() => {
      const err = new Error("Export requires WebGPU, which is unavailable on this system");
      err.name = "GpuInitError";
      return Promise.reject(err);
    });

    const tracks = ["t1", "t2", "t3"].map(fakeTrack);
    const run = fakeRun(tracks);
    const { hooks: h, statuses } = hooks();

    await runBatch(run, h);

    // Track 1 paid for its decode and carries the real reason...
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(statuses.get("job-t1")).toMatchObject({ k: "failed", kind: "gpu" });
    // ...and 2 and 3 were never attempted. "skipped" (via the cancel sweep),
    // not "failed": nothing about those tracks went wrong, and a red row per
    // track would be 20 lies about 20 files.
    expect(statuses.get("job-t2")).toEqual({ k: "skipped" });
    expect(statuses.get("job-t3")).toEqual({ k: "skipped" });
    expect(vi.mocked(exportVideo)).toHaveBeenCalledTimes(1);

    // The run still reads as complete (every job terminal), and the one real
    // failure is re-runnable on hardware that can render it.
    const finalRun: BatchRun = {
      ...run,
      jobs: run.jobs.map((j) => ({ ...j, status: statuses.get(j.id) ?? j.status })),
    };
    expect(isRunComplete(finalRun)).toBe(true);
    expect(retryFailed(finalRun, Date.now())).not.toBe(finalRun);
  });

  it("still isolates an ordinary per-job failure — one bad track costs one track", async () => {
    // The guard above must not have widened into "any GPU-ish error ends the
    // night": a device lost mid-job, or a codec the machine lacks, is exactly
    // the case the loop's isolation exists for.
    const decodeAudioData = vi.fn(() => Promise.resolve({} as AudioBuffer));
    vi.mocked(getEngine).mockReturnValue({
      ctx: { decodeAudioData },
    } as unknown as ReturnType<typeof getEngine>);
    vi.mocked(analyzeTrack).mockReturnValue({
      id: 1,
      result: Promise.resolve({ grid: null, key: null, sections: [] }),
    });
    vi.mocked(exportVideo)
      .mockImplementationOnce(() => {
        const err = new Error("GPU device lost during export: reset");
        err.name = "GpuDeviceLostError";
        return Promise.reject(err);
      })
      .mockResolvedValue({ bytes: 10, seconds: 1, audioCodec: "aac" });

    const run = fakeRun(["t1", "t2"].map(fakeTrack));
    const { hooks: h, statuses } = hooks();

    await runBatch(run, h);

    expect(statuses.get("job-t1")).toMatchObject({ k: "failed", kind: "gpu" });
    expect(statuses.get("job-t2")).toMatchObject({ k: "done" });
    expect(decodeAudioData).toHaveBeenCalledTimes(2);
  });
});

/** Decode + analysis succeed at once; the job itself is the test's business. */
function primeDecodeOk() {
  vi.mocked(getEngine).mockReturnValue({
    ctx: {
      decodeAudioData: () =>
        Promise.resolve({ getChannelData: () => new Float32Array(4) } as unknown as AudioBuffer),
    },
  } as unknown as ReturnType<typeof getEngine>);
  vi.mocked(analyzeTrack).mockReturnValue({
    id: 1,
    result: Promise.resolve({ grid: null, key: null, sections: [] }),
  });
}

/**
 * HD-03 — the determinism direction the law actually protects here.
 *
 * Stems and lyrics are imported per loaded track (loadFile clears both), so
 * an interactive export of any batch track — loaded fresh — carries neither.
 * The runner must therefore NOT reach for the session's stems/lyrics (those
 * belong to whatever track is loaded in the editor) and paint them onto
 * twenty other songs. The built TrackInput stays free of both; the panel's
 * pre-flight warning (batchInertSources) is where the limit becomes visible.
 */
describe("runBatch never carries another track's stems or lyrics (HD-03)", () => {
  afterEach(() => {
    vi.mocked(getEngine).mockReset();
    vi.mocked(analyzeTrack).mockReset();
    vi.mocked(exportVideo).mockReset();
    vi.mocked(buildExportOptions).mockClear();
  });

  it("builds every job with stems, lyrics and vocalLines absent", async () => {
    primeDecodeOk();
    vi.mocked(exportVideo).mockResolvedValue({ bytes: 1, seconds: 1, audioCodec: "aac" });
    // Earlier describes in this file also drive buildExportOptions; this
    // test counts calls, so start from a clean log.
    vi.mocked(buildExportOptions).mockClear();

    await runBatch(fakeRun(["t1", "t2"].map(fakeTrack)), hooks().hooks);

    expect(vi.mocked(buildExportOptions)).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(buildExportOptions).mock.calls) {
      const track = call[2];
      expect(track.stems).toBeUndefined();
      expect(track.lyrics).toBeUndefined();
      expect(track.vocalLines).toBeUndefined();
    }
  });
});

/**
 * HD-24 — a failed batch job gets the single lane's diagnosis, not a raw
 * classification. runExport re-measures the scratch volume at failure time
 * and folds translateExportError over the error; the runner only ever ran
 * classifyError, so the row said whatever the thrower said. The hook
 * `measureScratch` is the store's fresh reading; without it the raw text
 * stands (nothing is invented from a stale pre-flight snapshot).
 */
describe("runBatch describes a failed job the way the single lane does (HD-24)", () => {
  afterEach(() => {
    vi.mocked(getEngine).mockReset();
    vi.mocked(analyzeTrack).mockReset();
    vi.mocked(exportVideo).mockReset();
  });

  const failedMessage = (s: JobStatus | undefined) =>
    s?.k === "failed" ? s.message : `not failed: ${JSON.stringify(s)}`;

  it("translates a Windows disk-full into the actionable sentence, kind disk", async () => {
    primeDecodeOk();
    vi.mocked(exportVideo).mockRejectedValue(
      new Error("There is not enough space on the disk. (os error 112)"),
    );
    const { hooks: h, statuses } = hooks();
    await runBatch(fakeRun([fakeTrack("t1")]), h);
    expect(statuses.get("job-t1")).toMatchObject({ k: "failed", kind: "disk" });
    expect(failedMessage(statuses.get("job-t1"))).toMatch(/ran out of space while writing/);
  });

  it("re-measures scratch at failure time: a NotReadableError on a full scratch drive is a disk failure", async () => {
    primeDecodeOk();
    vi.mocked(exportVideo).mockRejectedValue(
      new DOMException("The requested file could not be read", "NotReadableError"),
    );
    const measureScratch = vi.fn(async () => ({
      freeBytes: 50e6,
      totalBytes: 500e9,
      root: "C:\\",
    }));
    const { hooks: h, statuses } = hooks({ measureScratch });
    await runBatch(fakeRun([fakeTrack("t1")]), h);
    expect(measureScratch).toHaveBeenCalledTimes(1);
    expect(statuses.get("job-t1")).toMatchObject({ k: "failed", kind: "disk" });
    expect(failedMessage(statuses.get("job-t1"))).toMatch(/working space on C:\\/);
  });

  it("with no scratch reading, the raw text stands — nothing is diagnosed from thin air", async () => {
    primeDecodeOk();
    vi.mocked(exportVideo).mockRejectedValue(
      new DOMException("The requested file could not be read", "NotReadableError"),
    );
    const { hooks: h, statuses } = hooks();
    await runBatch(fakeRun([fakeTrack("t1")]), h);
    expect(statuses.get("job-t1")).toEqual({
      k: "failed",
      kind: "unknown",
      message: "The requested file could not be read",
    });
  });

  it("a throwing scratch measurement never turns a failure into a crash", async () => {
    primeDecodeOk();
    vi.mocked(exportVideo).mockRejectedValue(new Error("something else"));
    const { hooks: h, statuses } = hooks({
      measureScratch: vi.fn(async () => {
        throw new Error("forbidden path");
      }),
    });
    await runBatch(fakeRun([fakeTrack("t1")]), h);
    expect(statuses.get("job-t1")).toMatchObject({ k: "failed", kind: "unknown" });
  });
});

/**
 * HD-24 — the per-job readout carries BOTH rates the single lane computes.
 * The runner's old `fps` was done / seconds-since-job-start: a cumulative
 * average dressed as the current rate (the E4b artifact, per job). Now `fps`
 * is the windowed recent rate and `avgFps` the job's cumulative average, from
 * the shared SpeedMeter, so the panel can show one beside the other.
 */
describe("runBatch reports a windowed rate and the job average (HD-24)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getEngine).mockReset();
    vi.mocked(analyzeTrack).mockReset();
    vi.mocked(exportVideo).mockReset();
    // Back to this file's module-level `{}` stub (mockReset restores the
    // implementation vi.fn was created with).
    vi.mocked(buildExportOptions).mockReset();
  });

  it("fps tracks the recent stretch while avgFps remembers the whole job", async () => {
    primeDecodeOk();
    let mockNow = 0;
    vi.spyOn(performance, "now").mockImplementation(() => mockNow);
    // buildExportOptions is stubbed to `{}` in this file — hand the io object
    // through so exportVideo can drive its onProgress.
    vi.mocked(buildExportOptions).mockImplementation(
      (_doc, _fmt, _track, _overlay, io) => io as never,
    );
    vi.mocked(exportVideo).mockImplementation(async (_buf, opts) => {
      // Fast: 100 frames in 1000 ms; slow: 100 more over the next 5800 ms.
      for (let i = 1; i <= 10; i++) {
        mockNow = i * 100;
        opts.onProgress!(i * 10, 300);
      }
      for (let i = 1; i <= 10; i++) {
        mockNow = 1000 + i * 580;
        opts.onProgress!(100 + i * 10, 300);
      }
      return { bytes: 1, seconds: 1, audioCodec: "aac" };
    });
    const seen: JobStatus[] = [];
    const { hooks: h } = hooks({ onJobUpdate: (_id, s) => seen.push(s) });

    await runBatch(fakeRun([fakeTrack("t1")]), h);

    const running = seen.filter(
      (s): s is Extract<JobStatus, { k: "running" }> => s.k === "running",
    );
    const last = running[running.length - 1];
    expect(last.done).toBe(200);
    expect(last.fps).not.toBeNull();
    expect(last.fps!).toBeGreaterThan(14);
    expect(last.fps!).toBeLessThan(19);
    expect(last.avgFps).toBeCloseTo(200 / 6.8, 5);
  });
});
