import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormatPreset } from "../../export/buildExportOptions";
import type { BatchRun, BatchTrack } from "../batch";

/**
 * R2-13 (review fix 3) — the RETRY lane runs the summed disk pre-flight too.
 *
 * "Retry failed" re-runs exactly the jobs that may have just failed on a
 * full disk, so skipping the check there re-armed the very failure the user
 * is retrying out of. These tests drive the real retryFailedBatch through
 * the store with platform/runner mocks (the exportActions.test.ts idiom):
 * a low-space volume prompts ONCE with the same warn-and-override confirm
 * startBatch uses, and a decline leaves the store's run in its done state
 * byte-for-byte — the requeued copy is never committed.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    audioBuffer: null,
    state: { trackName: null },
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

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return {
    ...actual,
    writeAutosave: vi.fn(async () => {}),
    isTauri: vi.fn(() => false),
    diskSpace: vi.fn(async () => null),
    scratchDir: vi.fn(async () => null),
    askConfirm: vi.fn(async () => true),
  };
});

// The runner would decode real audio; a mock proves whether the retry
// PROCEEDED at all, which is the whole question here.
vi.mock("../batchRunner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../batchRunner")>();
  return { ...actual, runBatch: vi.fn(async () => {}) };
});

const { useVizStore } = await import("../store");
const { askConfirm, diskSpace } = await import("../platform");
const { runBatch } = await import("../batchRunner");
const { shared } = await import("./shared");

const s = () => useVizStore.getState();

const FMT: FormatPreset = {
  id: "primary",
  label: "1080p (1920×1080)",
  w: 1920,
  h: 1080,
  fps: 60,
  mbps: 12,
  format: "mp4",
  codec: "h264",
};

/** A finished run with one done job and one disk-failed job — the state the
 * panel shows when the user reaches for "Retry failed". */
function doneRun(): BatchRun {
  const track: BatchTrack = {
    id: "t1",
    file: { name: "a.mp3" } as unknown as File,
    meta: { title: "Track One", artist: "A" } as BatchTrack["meta"],
    metaFromTags: true,
    coverArt: null,
    duration: 240,
  };
  return {
    doc: {} as BatchRun["doc"],
    tracks: [track],
    formats: [{ ...FMT }],
    jobs: [
      {
        id: "j-done",
        trackId: "t1",
        formatId: "primary",
        outPath: "D:/out/Track One.mp4",
        totalFrames: 14400,
        status: { k: "done", bytes: 5, path: "D:/out/Track One.mp4" },
      },
      {
        id: "j-fail",
        trackId: "t1",
        formatId: "primary",
        outPath: "D:/out/Track One (2).mp4",
        totalFrames: 14400,
        status: { k: "failed", kind: "disk", message: "os error 112" },
      },
    ],
    outDir: "D:/out",
    startedAt: 1111,
  };
}

beforeEach(() => {
  vi.mocked(askConfirm).mockClear();
  vi.mocked(runBatch).mockClear();
  vi.mocked(diskSpace).mockReset();
  vi.mocked(diskSpace).mockResolvedValue(null);
  shared.exportStarting = false;
  shared.exportAbort = null;
  useVizStore.setState({
    batch: doneRun(),
    batchStatus: "done",
    batchError: null,
    exporting: null,
    simplifiedRenderer: false,
  });
});

describe("retryFailedBatch runs the summed disk pre-flight (R2-13, review fix 3)", () => {
  it("a low-space volume prompts once; declining leaves the done run untouched", async () => {
    // The retried job alone needs ~366 MB (240 s at 12 Mbps + audio); zero
    // free trips the same shortfall check the single lane uses.
    vi.mocked(diskSpace).mockResolvedValue({ freeBytes: 0, totalBytes: 500e9, root: "D:\\" });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);

    await s().retryFailedBatch();

    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(askConfirm).mock.calls[0][0])).toContain("Not enough disk space");
    // Declined: nothing ran, and the STORE still holds the original run —
    // the requeued copy was never committed, so the panel keeps showing the
    // done/failed state it had.
    expect(runBatch).not.toHaveBeenCalled();
    expect(s().batchStatus).toBe("done");
    expect(s().batch?.startedAt).toBe(1111);
    expect(s().batch?.jobs.map((j) => j.status.k)).toEqual(["done", "failed"]);
    expect(s().batchError).toBeNull();
  });

  it("confirming the warning lets the retry proceed", async () => {
    vi.mocked(diskSpace).mockResolvedValue({ freeBytes: 0, totalBytes: 500e9, root: "D:\\" });
    vi.mocked(askConfirm).mockResolvedValueOnce(true);

    await s().retryFailedBatch();

    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(runBatch).toHaveBeenCalledTimes(1);
    // The committed run is the requeued copy: fresh startedAt, failed job
    // back in the queue (the mocked runner leaves it there).
    expect(s().batch?.startedAt).not.toBe(1111);
    expect(s().batch?.jobs.map((j) => j.status.k)).toEqual(["done", "queued"]);
  });

  it("plenty of space asks nothing — the pre-flight stays silent, not chatty", async () => {
    vi.mocked(diskSpace).mockResolvedValue({ freeBytes: 400e9, totalBytes: 500e9, root: "D:\\" });

    await s().retryFailedBatch();

    expect(askConfirm).not.toHaveBeenCalled();
    expect(runBatch).toHaveBeenCalledTimes(1);
  });
});
