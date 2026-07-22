import { afterEach, describe, expect, it, vi } from "vitest";
import { exportVideo, makePngSequenceWriter, type PngFsOps } from "./videoExporter";

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
