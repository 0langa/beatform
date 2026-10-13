import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "./beatGrid";

/**
 * The analysis worker facade must RECYCLE a dead worker.
 *
 * `ensureWorker` creates the singleton once and never let go of it. When the
 * worker failed to boot (the module 404s, the CSP refuses it, the script
 * throws at load), `onerror` resolved the jobs already in flight null and
 * kept the broken instance: the next `analyzeTrack` posted into it, no reply
 * ever came, the promise never settled, and the store's `analyzing` flag —
 * which only ever clears on a reply — stayed up for good. Every export then
 * waited out the whole analysis timeout (five minutes) and refused with
 * "reload the track and try again", advice that reloaded straight into the
 * same dead worker. An OOM-killed worker is worse still: it fires no error
 * event at all, so nothing could have noticed.
 *
 * Like videoExporter.test.ts, the global Worker is stubbed so the fake
 * instance is driven from here — no real thread, no real analysisWorker.ts.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(
    public url: unknown,
    public opts?: unknown,
  ) {
    FakeWorker.instances.push(this);
  }
}

function decoded(): AudioBuffer {
  return {
    duration: 1,
    sampleRate: 48_000,
    numberOfChannels: 2,
    length: 48_000,
    getChannelData: () => new Float32Array(48_000),
  } as unknown as AudioBuffer;
}

const GRID: BeatGrid = {
  bpm: 128,
  beatTimes: Float32Array.from([0, 0.469, 0.938, 1.406]),
  hopSec: 0.0116,
};
const NULLS = { grid: null, key: null, sections: [], travel: null };

/** A fresh module per test: the worker singleton and the job table are
 * module state, and a dead worker left over from one test is exactly the
 * thing the next one must not inherit. */
async function loadFacade() {
  vi.resetModules();
  return import("./trackAnalysis");
}

/** What the worker posts back for a finished job. */
function reply(w: FakeWorker, id: number) {
  w.onmessage?.({
    data: { type: "analysis", id, grid: GRID, key: null, sections: [12], travel: null },
  });
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  FakeWorker.instances.length = 0;
  // Every recycle is logged; the log is not what these tests assert.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("analysis worker recycling", () => {
  it("replaces a worker that errored instead of posting the next job into it", async () => {
    const { analyzeTrack } = await loadFacade();

    const first = analyzeTrack(decoded());
    expect(FakeWorker.instances).toHaveLength(1);
    const dead = FakeWorker.instances[0];
    dead.onerror?.(new Event("error")); // module failed to load / boot threw

    // The in-flight job degrades (callers fall back), as before…
    await expect(first.result).resolves.toEqual(NULLS);
    // …and the broken instance is gone, not kept as the singleton.
    expect(dead.terminate).toHaveBeenCalledTimes(1);

    const second = analyzeTrack(decoded());
    expect(FakeWorker.instances).toHaveLength(2);
    const fresh = FakeWorker.instances[1];
    // The job went to the NEW worker; the dead one was never posted into again.
    expect(fresh.postMessage).toHaveBeenCalledTimes(1);
    expect(dead.postMessage).toHaveBeenCalledTimes(1);

    reply(fresh, second.id);
    await expect(second.result).resolves.toEqual({
      grid: GRID,
      key: null,
      sections: [12],
      travel: null,
    });
  });

  it("gives up on a worker that never answers — the OOM kill that fires no onerror", async () => {
    vi.useFakeTimers();
    const { analyzeTrack, ANALYSIS_LIVENESS_MS } = await loadFacade();

    const job = analyzeTrack(decoded());
    const silent = FakeWorker.instances[0];
    let settled = false;
    void job.result.then(() => {
      settled = true;
    });

    // Generous: a slow but living worker is never cut off early.
    await vi.advanceTimersByTimeAsync(ANALYSIS_LIVENESS_MS - 1);
    expect(settled).toBe(false);
    expect(silent.terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    // The job resolves null — so the store's `analyzing` clears and an export
    // no longer waits five minutes to refuse — and the worker is recycled.
    await expect(job.result).resolves.toEqual(NULLS);
    expect(silent.terminate).toHaveBeenCalledTimes(1);

    analyzeTrack(decoded());
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1]).not.toBe(silent);
  });

  it("a reply disarms the liveness timer, so a healthy worker is kept", async () => {
    vi.useFakeTimers();
    const { analyzeTrack, ANALYSIS_LIVENESS_MS } = await loadFacade();

    const job = analyzeTrack(decoded());
    const w = FakeWorker.instances[0];
    reply(w, job.id);
    await expect(job.result).resolves.toMatchObject({ grid: GRID });

    await vi.advanceTimersByTimeAsync(ANALYSIS_LIVENESS_MS * 2);
    expect(w.terminate).not.toHaveBeenCalled();
    analyzeTrack(decoded());
    expect(FakeWorker.instances).toHaveLength(1); // same worker, reused
  });

  it("a worker reported as dead takes every in-flight job with it, each resolving null", async () => {
    vi.useFakeTimers();
    const { analyzeTrack, ANALYSIS_LIVENESS_MS } = await loadFacade();

    const a = analyzeTrack(decoded());
    await vi.advanceTimersByTimeAsync(ANALYSIS_LIVENESS_MS / 2);
    const b = analyzeTrack(decoded()); // a newer load, same (dying) worker
    await vi.advanceTimersByTimeAsync(ANALYSIS_LIVENESS_MS / 2);

    // Job a's window ran out; b cannot be answered by a terminated worker
    // either, so it must not be left to wait out its own window.
    await expect(a.result).resolves.toEqual(NULLS);
    await expect(b.result).resolves.toEqual(NULLS);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  });
});
