import { afterEach, describe, expect, it, vi } from "vitest";
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
import { isRunComplete, retryFailed } from "./batch";

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
    doc: {} as unknown as ProjectDocument, // never read on the paths under test
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
