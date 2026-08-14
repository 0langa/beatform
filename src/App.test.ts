// @vitest-environment jsdom
// Importing ./App pulls in the whole App.tsx module graph (the store,
// every panel/dialog it references) — store.ts reads localStorage at
// module scope (same gotcha guideSync.test.ts's own comment documents),
// so this needs a DOM environment even though raceBootVeilDrop itself
// touches neither React nor the store.
import { afterEach, describe, expect, it, vi } from "vitest";
import { raceBootVeilDrop } from "./App";

/**
 * Owner ruling E (final round) — the boot veil's drop race, tested in
 * isolation from React (no rendering needed: `raceBootVeilDrop` is a pure
 * async helper, extracted from the effect that uses it for exactly this
 * reason — matching this file's own existing pattern of exporting testable
 * logic, see `commitVisualsWidth`/`resizeKeyValue`). The full
 * isTauri()-gated wiring (never renders the veil node at all in the
 * browser build, starts `bootVeilVisible` true only on desktop) is covered
 * at the store level in store.test.ts-adjacent files; this file owns the
 * "whichever comes first" race itself.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("raceBootVeilDrop", () => {
  it("calls onDrop once the boot promise resolves, well before the cap", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    let resolveBoot!: () => void;
    const boot = new Promise<void>((r) => {
      resolveBoot = r;
    });

    raceBootVeilDrop(boot, 500, onDrop);
    await vi.advanceTimersByTimeAsync(50);
    expect(onDrop).not.toHaveBeenCalled();

    resolveBoot();
    await vi.advanceTimersByTimeAsync(0);
    expect(onDrop).toHaveBeenCalledTimes(1);

    // The cap must not ALSO fire later for the same race.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("calls onDrop at the cap when the boot promise never settles — a genuinely hung read", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    const neverSettles = new Promise<void>(() => undefined); // parked, deliberately

    raceBootVeilDrop(neverSettles, 500, onDrop);
    await vi.advanceTimersByTimeAsync(499);
    expect(onDrop).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("calls onDrop when the boot promise REJECTS too (.finally, not .then) — a fallback boot must drop the veil, not ride the cap", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    let rejectBoot!: (e: unknown) => void;
    const boot = new Promise<void>((_resolve, reject) => {
      rejectBoot = reject;
    });

    raceBootVeilDrop(boot, 500, onDrop);
    rejectBoot(new Error("boom"));
    // Swallow so vitest doesn't flag it as an unhandled rejection — the
    // production caller's own `.finally` inside raceBootVeilDrop already
    // observes it; this is just this test's OWN reference to the same
    // promise needing a handler too.
    await boot.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(onDrop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).toHaveBeenCalledTimes(1); // the cap didn't ALSO fire
  });

  it("the returned cancel function clears the cap timer — a fast unmount leaves nothing pending", async () => {
    vi.useFakeTimers();
    const onDrop = vi.fn();
    const neverSettles = new Promise<void>(() => undefined);

    const cancel = raceBootVeilDrop(neverSettles, 500, onDrop);
    cancel();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
