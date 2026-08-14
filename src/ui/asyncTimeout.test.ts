import { afterEach, describe, expect, it, vi } from "vitest";
import { raceTimeout } from "./asyncTimeout";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("raceTimeout", () => {
  it("resolves ok when the task settles well before the timeout", async () => {
    const outcome = await raceTimeout(async () => "done", 1000);
    expect(outcome).toEqual({ ok: true, value: "done" });
  });

  it("carries a rejection through as ok:false, timedOut:false — never throws", async () => {
    const boom = new Error("boom");
    const outcome = await raceTimeout(async () => {
      throw boom;
    }, 1000);
    expect(outcome).toEqual({ ok: false, timedOut: false, error: boom });
  });

  it("a synchronously-thrown task is caught the same way as a rejected promise", async () => {
    const boom = new Error("sync boom");
    // `task` itself throws before returning a promise — a real risk for any
    // callee that validates its arguments before doing anything async.
    const outcome = await raceTimeout(() => {
      throw boom;
    }, 1000);
    expect(outcome).toEqual({ ok: false, timedOut: false, error: boom });
  });

  it("trips the timeout for a task that never settles, and aborts the signal handed to it", async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    let capturedSignal: AbortSignal | undefined;
    const promise = raceTimeout((signal) => {
      capturedSignal = signal;
      return gate.promise;
    }, 15_000);

    await vi.advanceTimersByTimeAsync(14_999);
    // Not yet — the exact boundary matters so a 1ms-early trip is caught.
    expect(capturedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const outcome = await promise;

    expect(outcome).toEqual({ ok: false, timedOut: true });
    expect(capturedSignal?.aborted).toBe(true);

    gate.resolve("too late"); // let the task settle so nothing dangles
  });

  it("a task that resolves AFTER the timeout already fired does not change the settled outcome, and never surfaces as an unhandled rejection", async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const promise = raceTimeout(() => gate.promise, 100);

    await vi.advanceTimersByTimeAsync(100);
    const outcome = await promise;
    expect(outcome).toEqual({ ok: false, timedOut: true });

    // The late resolution (and, in the sibling case below, rejection) must
    // be a complete no-op from the caller's point of view — raceTimeout
    // already returned, and nothing here re-observes the task promise.
    gate.resolve("late success");
    await vi.advanceTimersByTimeAsync(0);
    // No assertion beyond "this did not throw" — an unhandled rejection in
    // vitest's node environment would fail the run, not just this test.
  });

  it("a task that REJECTS after the timeout already fired is swallowed, not unhandled", async () => {
    vi.useFakeTimers();
    const gate = deferred<string>();
    const promise = raceTimeout(() => gate.promise, 100);

    await vi.advanceTimersByTimeAsync(100);
    await promise;

    gate.reject(new Error("late failure — must not become an unhandled rejection"));
    await vi.advanceTimersByTimeAsync(0);
  });
});
