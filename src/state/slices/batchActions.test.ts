import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackMetaResult } from "../../audio/trackMeta";
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

// The tag reader would import music-metadata and parse real bytes; the R2-31f
// suite below hands each call a promise it resolves BY HAND, because the whole
// question there is what the counter reads while two scans overlap.
vi.mock("../../audio/trackMeta", () => ({ readTrackMeta: vi.fn() }));

const { useVizStore } = await import("../store");
const { askConfirm, diskSpace } = await import("../platform");
const { runBatch } = await import("../batchRunner");
const { readTrackMeta } = await import("../../audio/trackMeta");
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

/**
 * R2-04: batchStatus only flips to "running" after retryFailedBatch's awaits
 * (the outDir readDir, then the R2-13 pre-flight), so a double-activation —
 * double-click, Enter+click — passed the status guard twice and launched two
 * runs writing to the same folder. The fix is the same synchronous
 * `batchStarting` claim startBatch takes, released on every exit.
 */
describe("retryFailedBatch claims the start slot synchronously (R2-04)", () => {
  it("two synchronous back-to-back calls launch exactly one run", async () => {
    const first = s().retryFailedBatch();
    const second = s().retryFailedBatch(); // fired before any await settles
    await Promise.all([first, second]);

    expect(runBatch).toHaveBeenCalledTimes(1);
  });

  it("a declined pre-flight releases the claim — the next retry can start", async () => {
    vi.mocked(diskSpace).mockResolvedValue({ freeBytes: 0, totalBytes: 500e9, root: "D:\\" });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await s().retryFailedBatch();
    expect(runBatch).not.toHaveBeenCalled();

    // Space freed up; the user tries again — a stuck claim would eat this.
    vi.mocked(diskSpace).mockResolvedValue(null);
    await s().retryFailedBatch();
    expect(runBatch).toHaveBeenCalledTimes(1);
  });

  it("a throwing pre-flight releases the claim too", async () => {
    vi.mocked(diskSpace).mockRejectedValueOnce(new Error("forbidden path"));
    await s().retryFailedBatch();
    expect(runBatch).not.toHaveBeenCalled();
    expect(s().batchError).toContain("Could not check disk space");

    vi.mocked(diskSpace).mockResolvedValue(null);
    await s().retryFailedBatch();
    expect(runBatch).toHaveBeenCalledTimes(1);
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

/** A tag read whose settling the test owns — one per readTrackMeta call. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
type Gate = ReturnType<typeof deferred<TrackMetaResult>>;

/**
 * R2-31f — `batchScanning` is an AGGREGATE across overlapping drops.
 *
 * Reading tags takes seconds per file (the VBR duration scan), and nothing
 * stops a second drop while the first is still scanning. The old shape wrote
 * `files.length` on entry, `files.length - added.length` per file and `0` in
 * its finally — each call's OWN numbers — so a second drop overwrote the
 * first's remaining count, and whichever call finished first zeroed the
 * counter with the other's files still in flight: BatchPanel's spinner (it
 * reads `batchScanning`) vanished mid-scan. Now every call adds its files on
 * entry, subtracts one per file, and its finally subtracts only what THAT call
 * still owes, so the panel reads the true number of files being scanned.
 *
 * Each test drives the real addBatchTracks twice, overlapping, and lands the
 * individual tag reads by hand in the order that exposes the corruption.
 */
describe("addBatchTracks aggregates batchScanning across overlapping drops (R2-31f)", () => {
  let gates: Map<string, Gate>;

  const file = (name: string) => ({ name }) as unknown as File;
  const tagged = (title: string): TrackMetaResult => ({
    meta: { title, artist: "" },
    fromTags: true,
    coverArt: null,
    duration: 10,
  });
  /** Enough microtask turns for an `await readTrackMeta` to resume and reach
   * the next file's call (which creates the next gate). */
  async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }
  /** Land one file's tags and let the awaiting loop take its next step. */
  async function land(name: string, title: string) {
    const g = gates.get(name);
    if (!g) throw new Error(`no scan in flight for ${name}`);
    g.resolve(tagged(title));
    await settle();
  }
  const titles = () => s().batch?.tracks.map((t) => t.meta.title);

  beforeEach(() => {
    gates = new Map();
    vi.mocked(readTrackMeta).mockReset();
    vi.mocked(readTrackMeta).mockImplementation((_blob, name) => {
      const g = deferred<TrackMetaResult>();
      gates.set(name, g);
      return g.promise;
    });
    useVizStore.setState({ batch: null, batchStatus: "idle", batchScanning: 0 });
  });

  it("a second drop while the first is still scanning ADDS its files to the count", async () => {
    const first = s().addBatchTracks([file("a1.mp3"), file("a2.mp3")]);
    const second = s().addBatchTracks([file("b1.mp3")]);
    // Both entry writes have landed (they precede each call's first await);
    // the panel must read every file in flight, not the latest drop's count.
    expect(s().batchScanning).toBe(3);

    await settle();
    await land("a1.mp3", "A1");
    expect(s().batchScanning).toBe(2); // a2 and b1 still reading

    await land("b1.mp3", "B1");
    await second;
    await land("a2.mp3", "A2");
    await first;
    expect(s().batchScanning).toBe(0);
    expect(titles()).toEqual(["B1", "A1", "A2"]);
  });

  it("the drop that finishes first subtracts only ITS files — the other drop's spinner stays up", async () => {
    const first = s().addBatchTracks([file("a1.mp3")]);
    const second = s().addBatchTracks([file("b1.mp3"), file("b2.mp3")]);
    await settle();
    await land("a1.mp3", "A1");
    await first;
    // The first drop is committed; the second's two files are still being read.
    expect(s().batchScanning).toBe(2);
    expect(titles()).toEqual(["A1"]);

    await land("b1.mp3", "B1");
    expect(s().batchScanning).toBe(1);
    await land("b2.mp3", "B2");
    await second;
    expect(s().batchScanning).toBe(0);
    expect(titles()).toEqual(["A1", "B1", "B2"]);
  });

  it("a scan that throws mid-drop releases only what that drop still owed", async () => {
    const first = s().addBatchTracks([file("a1.mp3"), file("a2.mp3"), file("a3.mp3")]);
    const second = s().addBatchTracks([file("b1.mp3")]);
    await settle();
    await land("a1.mp3", "A1");

    gates.get("a2.mp3")!.reject(new Error("tag reader exploded"));
    await expect(first).rejects.toThrow("tag reader exploded");
    // a2 and a3 leave the count with the drop that owed them; b1 stays.
    expect(s().batchScanning).toBe(1);
    expect(s().batch).toBeNull(); // the failed drop committed nothing

    await land("b1.mp3", "B1");
    await second;
    expect(s().batchScanning).toBe(0);
    expect(titles()).toEqual(["B1"]);
  });
});
