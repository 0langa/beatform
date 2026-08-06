import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportVideo, makePngSequenceWriter, type PngFsOps } from "./videoExporter";

/**
 * Stub for the Tauri fs plugin that createTauriWriter dynamically imports, so
 * the stream lane can be driven from a test: `gate` holds a write open, and
 * `failNext` makes one fail like a full disk.
 */
const tauriFs = vi.hoisted(() => ({
  writes: [] as { length: number; position: number }[],
  removed: [] as string[],
  closed: 0,
  gate: null as Promise<void> | null,
  failNext: null as Error | null,
  cursor: 0,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  SeekMode: { Start: 0 },
  open: async () => ({
    async seek(position: number) {
      tauriFs.cursor = position;
    },
    async write(data: Uint8Array) {
      if (tauriFs.gate) await tauriFs.gate;
      if (tauriFs.failNext) {
        const e = tauriFs.failNext;
        tauriFs.failNext = null;
        throw e;
      }
      tauriFs.writes.push({ length: data.length, position: tauriFs.cursor });
      tauriFs.cursor += data.length;
      return data.length;
    },
    async close() {
      tauriFs.closed++;
    },
  }),
  remove: async (path: string) => {
    tauriFs.removed.push(path);
  },
  writeFile: async () => undefined,
  mkdir: async () => undefined,
}));

/**
 * H5 regression: the sequence writer used to store a write failure in a local
 * and only throw it from close() — which runs AFTER the whole render. A
 * disk-full at minute 5 of a 60-minute export rendered the remaining 55
 * minutes into a no-op sink. The writer must surface the FIRST failure
 * immediately via onError (the caller trips the export's abort signal with
 * it), stop writing, and still throw the original error from close().
 */
describe("makePngSequenceWriter failure channel", () => {
  function stubFs(failOnIndex?: number) {
    const written: string[] = [];
    const removed: string[] = [];
    let calls = 0;
    const fs: PngFsOps = {
      async writeFile(path) {
        if (failOnIndex !== undefined && calls++ >= failOnIndex) {
          throw new Error("There is not enough space on the disk. (os error 112)");
        }
        written.push(path);
      },
      async remove(path) {
        removed.push(path);
      },
    };
    return { fs, written, removed };
  }

  it("writes 6-digit frame names in order", async () => {
    const { fs, written } = stubFs();
    const w = makePngSequenceWriter(fs, "out");
    await w.write(new Uint8Array([1]), 0);
    await w.write(new Uint8Array([2]), 1);
    await w.close();
    expect(written).toEqual(["out/frame_000001.png", "out/frame_000002.png"]);
  });

  it("reports the first failure immediately, stops writing, and close() throws it", async () => {
    const { fs, written } = stubFs(1); // second write fails
    const onError = vi.fn();
    const w = makePngSequenceWriter(fs, "out", onError);
    await w.write(new Uint8Array([1]), 0);
    expect(onError).not.toHaveBeenCalled();
    await w.write(new Uint8Array([2]), 1); // fails -> onError NOW, not at close
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/os error 112/);
    await w.write(new Uint8Array([3]), 2); // after failure: no-op
    expect(onError).toHaveBeenCalledTimes(1); // not re-reported
    expect(written).toEqual(["out/frame_000001.png"]);
    await expect(w.close()).rejects.toThrow(/os error 112/);
  });

  it("discard removes everything that was written", async () => {
    const { fs, written, removed } = stubFs(2);
    const w = makePngSequenceWriter(fs, "out", () => undefined);
    await w.write(new Uint8Array([1]), 0);
    await w.write(new Uint8Array([2]), 1);
    await w.write(new Uint8Array([3]), 2); // fails
    await w.discard();
    expect(removed).toEqual(written);
  });
});

describe("exportVideo abort handling", () => {
  it("rejects an already-aborted signal before touching the audio", async () => {
    const ac = new AbortController();
    ac.abort();
    // The guard runs before pcmFromAudioBuffer, so a null buffer is safe here
    // and proves the point: nothing is read. Without the guard, runInWorker
    // only ever calls addEventListener("abort") — which never fires for a
    // signal aborted beforehand — so the whole job would render and only then
    // be thrown away.
    await expect(
      exportVideo(null as unknown as AudioBuffer, {
        width: 256,
        height: 144,
        fps: 30,
        bitrate: 1_000_000,
        presetId: "spectrum-bars",
        params: {},
        bg: { kind: "solid", colorA: "#000", colorB: "#000", angle: 0, alpha: 1 } as never,
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

/**
 * M11 regression: an OS OOM-kill (or a wedged worker thread) never fires
 * `worker.onerror` — that event is only for an uncaught JS exception inside
 * a worker that is still alive to throw one. Without a watchdog, a killed
 * worker left `exportVideo` pending forever, the Export button stuck, and
 * `worker.terminate()` (in the original code's `.finally()`) never ran
 * because nothing ever settled the promise. A message that fails to
 * deserialize (`onmessageerror`) was the same kind of silent gap.
 *
 * These tests stub the global Worker so the fake instance is fully
 * controlled from here — no real thread, no real exportWorker.ts module.
 */
describe("exportVideo worker-death handling", () => {
  type FakeMessage =
    | { type: "heartbeat" }
    | { type: "progress"; done: number; total: number }
    | { type: "chunk"; data: Uint8Array; position: number }
    | { type: "frame"; data: Uint8Array; index: number }
    | { type: "done"; result: unknown }
    | { type: "error"; message: string; name: string };

  class FakeWorker {
    static instances: FakeWorker[] = [];
    onerror: (() => void) | null = null;
    onmessage: ((e: { data: FakeMessage }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor(
      public url: unknown,
      public opts?: unknown,
    ) {
      FakeWorker.instances.push(this);
    }
  }

  const baseOptions = {
    width: 256,
    height: 144,
    fps: 30,
    bitrate: 1_000_000,
    presetId: "spectrum-bars",
    params: {},
    bg: { kind: "solid", colorA: "#000", colorB: "#000", angle: 0, alpha: 1 } as never,
  };

  function fakeAudioBuffer(): AudioBuffer {
    return {
      sampleRate: 48000,
      length: 480,
      duration: 480 / 48000,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(480),
    } as unknown as AudioBuffer;
  }

  let realWorker: typeof Worker | undefined;

  afterEach(() => {
    if (realWorker !== undefined) (globalThis as { Worker?: unknown }).Worker = realWorker;
    FakeWorker.instances.length = 0;
    vi.useRealTimers();
  });

  it("rejects instead of hanging forever when the worker goes completely silent", async () => {
    realWorker = (globalThis as { Worker?: typeof Worker }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
    vi.useFakeTimers();

    const promise = exportVideo(fakeAudioBuffer(), { ...baseOptions });
    // Let the synchronous prefix of exportVideo/runInWorker run so the fake
    // worker instance exists and "start" has been posted.
    await vi.advanceTimersByTimeAsync(0);
    const instance = FakeWorker.instances[0];
    expect(instance).toBeDefined();

    // One real frame first: flips wroteAnything so the eventual rejection is
    // NOT __fallback__-prefixed, which means exportVideo will not retry
    // inline — this test then observes runInWorker's own rejection directly.
    instance.onmessage?.({ data: { type: "frame", data: new Uint8Array([9]), index: 0 } });
    await vi.advanceTimersByTimeAsync(0);

    // Silence from here on — no further messages, ever. Advance well past
    // any reasonable watchdog window.
    let settled = false;
    void promise
      .catch(() => undefined)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(60_000);
    // Flush the microtask the rejection settles on before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(true);
    await expect(promise).rejects.toThrow(/stopped responding/);
    expect(instance.terminate).toHaveBeenCalled();
  });

  it("setup-phase heartbeats keep a slow-setup worker alive past the watchdog (AX-3)", async () => {
    // Long-track setup (whole-track loudness measure, analyzer mixdowns,
    // asset decodes) sends no progress/chunk/frame for well over the 30 s
    // window. The worker now pings `heartbeat` through that phase; each ping
    // must reset the silence watchdog WITHOUT counting as a write (a worker
    // that only ever heartbeat is still safe to fall back inline).
    realWorker = (globalThis as { Worker?: typeof Worker }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
    vi.useFakeTimers();

    const promise = exportVideo(fakeAudioBuffer(), { ...baseOptions });
    let failure: Error | null = null;
    void promise.catch((e: Error) => (failure = e));
    await vi.advanceTimersByTimeAsync(0);
    const instance = FakeWorker.instances[0];
    expect(instance).toBeDefined();

    // 150 s of "setup": nothing but heartbeats, each inside the 30 s window.
    for (let i = 0; i < 10; i++) {
      instance.onmessage?.({ data: { type: "heartbeat" } });
      await vi.advanceTimersByTimeAsync(15_000);
    }
    expect(failure).toBeNull(); // never killed while heartbeats flow

    // Setup ends; the job completes normally.
    instance.onmessage?.({
      data: { type: "done", result: { bytes: 4, seconds: 1, audioCodec: "aac" } },
    });
    await expect(promise).resolves.toMatchObject({ bytes: 4 });
  });

  it("rejects on onmessageerror instead of hanging", async () => {
    realWorker = (globalThis as { Worker?: typeof Worker }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;

    const promise = exportVideo(fakeAudioBuffer(), { ...baseOptions });
    await Promise.resolve();
    await Promise.resolve();
    const instance = FakeWorker.instances[0];
    expect(instance).toBeDefined();

    instance.onmessage?.({ data: { type: "frame", data: new Uint8Array([9]), index: 0 } });
    await Promise.resolve();
    instance.onmessageerror?.();

    await expect(promise).rejects.toThrow(/unreadable message/);
    expect(instance.terminate).toHaveBeenCalled();
  });
});

describe("stream writer backpressure", () => {
  /**
   * The core awaits onChunk so a slow disk throttles the encoders. While
   * write() returned void, nothing could await it: undrained chunks piled up
   * in the writer's promise chain and the export retained the whole
   * bitstream (measured as +152 MB/10 min on a 2 h export, with the render
   * rate decaying 130 -> 30 fps from the GC pressure).
   */
  it("write() resolves only after the bytes are actually written", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const written: number[] = [];
    const writer = makePngSequenceWriter(
      {
        writeFile: async (_p, d) => {
          await gate;
          written.push(d.length);
        },
        remove: async () => undefined,
      },
      "/out",
    );
    const p = writer.write(new Uint8Array(4), 0);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // still blocked on the sink
    expect(written).toHaveLength(0);
    release();
    await p;
    expect(written).toEqual([4]);
  });
});

/**
 * The worker's stream lane had the same unbounded-buffer hole the PNG lane
 * closed with frame/frameAck: the main thread called writer.write() and
 * returned, so the worker kept posting chunks at encode speed while every
 * closure waiting in the writer's queue held its data alive (up to ~16 MiB
 * each — the entire encoded bitstream, ~2 GB on a 2-hour export). The chunk is
 * now acked only once it is on disk, which paces the encoders through
 * mediabunny's StreamTarget.
 */
describe("worker chunk lane backpressure", () => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onerror: (() => void) | null = null;
    onmessage:
      | ((e: {
          data:
            | { type: "chunk"; data: Uint8Array; position: number }
            | { type: "done"; result: unknown }
            | { type: "error"; message: string; name: string };
        }) => void)
      | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
      FakeWorker.instances.push(this);
    }
    /** Messages this worker was sent, by tag. */
    sent(type: string) {
      return this.postMessage.mock.calls.filter((c) => (c[0] as { type: string }).type === type);
    }
  }

  const options = {
    width: 256,
    height: 144,
    fps: 30,
    bitrate: 1_000_000,
    presetId: "spectrum-bars",
    params: {},
    bg: { kind: "solid", colorA: "#000", colorB: "#000", angle: 0, alpha: 1 } as never,
    streamToPath: "out.mp4",
  };

  function fakeAudioBuffer(): AudioBuffer {
    return {
      sampleRate: 48000,
      length: 480,
      duration: 480 / 48000,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(480),
    } as unknown as AudioBuffer;
  }

  /** Let the dynamic import + promise chains settle (no fake timers here). */
  const tick = async (n = 4) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
  };

  let realWorker: typeof Worker | undefined;

  beforeEach(() => {
    tauriFs.writes.length = 0;
    tauriFs.removed.length = 0;
    tauriFs.closed = 0;
    tauriFs.cursor = 0;
    tauriFs.gate = null;
    tauriFs.failNext = null;
    realWorker = (globalThis as { Worker?: typeof Worker }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
  });

  afterEach(() => {
    if (realWorker !== undefined) (globalThis as { Worker?: unknown }).Worker = realWorker;
    FakeWorker.instances.length = 0;
  });

  it("acks a chunk only after the bytes are on disk", async () => {
    let release!: () => void;
    tauriFs.gate = new Promise<void>((r) => (release = r));

    const promise = exportVideo(fakeAudioBuffer(), { ...options });
    await tick();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();

    worker.onmessage?.({ data: { type: "chunk", data: new Uint8Array(8), position: 0 } });
    await tick();
    // Still blocked on the disk: nothing written, nothing acked, so the worker
    // is parked instead of racing ahead and queueing more chunks here.
    expect(tauriFs.writes).toHaveLength(0);
    expect(worker.sent("chunkAck")).toHaveLength(0);

    release();
    await tick();
    expect(tauriFs.writes).toEqual([{ length: 8, position: 0 }]);
    expect(worker.sent("chunkAck")).toHaveLength(1);

    worker.onmessage?.({
      data: { type: "done", result: { bytes: 8, seconds: 1, audioCodec: "aac" } },
    });
    await expect(promise).resolves.toMatchObject({ bytes: 8, blob: undefined });
    expect(tauriFs.closed).toBe(1);
  });

  it("does not trip the watchdog while parked on a slow disk write", async () => {
    // The ack flow control makes the worker DELIBERATELY silent while the main
    // thread writes. The watchdog watches for worker silence, so without
    // discounting our own I/O any write slower than WORKER_WATCHDOG_MS (30 s —
    // i.e. a 16 MiB chunk under ~0.5 MB/s, a stalled network or sleeping USB
    // drive) would kill a perfectly healthy export mid-render.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let release!: () => void;
      tauriFs.gate = new Promise<void>((r) => (release = r));

      const promise = exportVideo(fakeAudioBuffer(), { ...options });
      let failure: Error | null = null;
      void promise.catch((e: Error) => (failure = e));
      await tick();
      const worker = FakeWorker.instances[0];
      worker.onmessage?.({ data: { type: "chunk", data: new Uint8Array(8), position: 0 } });
      await tick();

      // Three full watchdog periods parked on the disk.
      await vi.advanceTimersByTimeAsync(90_000);
      expect(failure).toBeNull();

      release();
      await tick();
      expect(worker.sent("chunkAck")).toHaveLength(1);

      worker.onmessage?.({
        data: { type: "done", result: { bytes: 8, seconds: 1, audioCodec: "aac" } },
      });
      await expect(promise).resolves.toMatchObject({ bytes: 8 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still acks after a write failure, and aborts with the disk error (H5)", async () => {
    const promise = exportVideo(fakeAudioBuffer(), { ...options });
    await tick();
    const worker = FakeWorker.instances[0];

    tauriFs.failNext = new Error("There is not enough space on the disk. (os error 112)");
    worker.onmessage?.({ data: { type: "chunk", data: new Uint8Array(8), position: 0 } });
    await tick();

    // The failure trips the export's abort signal immediately (H5) AND the
    // chunk is still acked — without the ack the worker would sit forever
    // waiting on a write that already failed.
    expect(worker.sent("abort")).toHaveLength(1);
    expect(worker.sent("chunkAck")).toHaveLength(1);

    worker.onmessage?.({
      data: { type: "error", message: "Export cancelled", name: "AbortError" },
    });
    // The self-inflicted abort must surface as the original disk error, not a
    // generic cancel — that is what classifyError keys off downstream.
    await expect(promise).rejects.toThrow(/os error 112/);
    expect(tauriFs.removed).toEqual(["out.mp4"]); // partial file cleaned up
  });
});
