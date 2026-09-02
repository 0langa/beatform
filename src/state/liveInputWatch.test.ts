import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchLiveInput } from "./liveInputWatch";

/** HD-16: the store polls Rust's `loopback_died` while listening and stops
 * the session the first time it reads true — once, and never after stop(). */
describe("watchLiveInput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires onDead once when the flag turns true, then stops polling", async () => {
    const answers = [false, false, true, true];
    const died = vi.fn(async () => answers.shift() ?? true);
    const onDead = vi.fn();
    watchLiveInput(died, onDead, 1000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(died).toHaveBeenCalledTimes(2);
    expect(onDead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDead).toHaveBeenCalledTimes(1);
    // The interval is cleared: no further polls, no second callback.
    await vi.advanceTimersByTimeAsync(5000);
    expect(died).toHaveBeenCalledTimes(3);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("never fires after stop(), even if a poll was in flight", async () => {
    let resolve: (v: boolean) => void = () => {};
    const died = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const onDead = vi.fn();
    const stop = watchLiveInput(died, onDead, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(died).toHaveBeenCalledTimes(1);
    stop();
    resolve(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onDead).not.toHaveBeenCalled();
    expect(died).toHaveBeenCalledTimes(1);
  });

  it("ignores a rejected poll and retries on the next tick", async () => {
    const died = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("ipc"))
      .mockResolvedValue(true);
    const onDead = vi.fn();
    watchLiveInput(died, onDead, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it("does not overlap polls while one is still pending", async () => {
    const died = vi.fn(() => new Promise<boolean>(() => {}));
    watchLiveInput(died, vi.fn(), 1000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(died).toHaveBeenCalledTimes(1);
  });
});
