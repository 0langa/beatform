import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P-11 whole-lane-review fix C1 — scheduleAutosave's max-latency cap and
 * flushAutosave. A fresh store per test (vi.resetModules(), matching
 * storageQuota.test.ts's "store actions on a full store" pattern) rather
 * than reusing store.test.ts's shared module instance: `autosaveTimer`/
 * `autosaveMaxTimer` are module-scoped `let`s in store.ts, and these tests
 * are specifically about their cross-call interaction under fake timers —
 * any leftover pending timer from an earlier test in a shared instance
 * would make the assertions here order-dependent.
 */

function installGlobals(): void {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
}

vi.mock("./services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
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

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return {
    ...actual,
    isTauri: vi.fn(() => true),
    writeAutosave: vi.fn(async () => {}),
  };
});

beforeEach(async () => {
  installGlobals();
  vi.resetModules();
  // vi.resetModules() alone does not guarantee a FRESH vi.fn() from the
  // vi.mock() factory above (observed directly: without this, writeAutosave's
  // call count and isTauri's mockReturnValue both leaked across tests in this
  // file) — clear/reset both explicitly, every test, rather than trust it.
  const { isTauri, writeAutosave } = await import("./platform");
  vi.mocked(isTauri).mockClear().mockReturnValue(true);
  vi.mocked(writeAutosave).mockClear().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scheduleAutosave's max-latency cap", () => {
  it("a single edit writes once, ~intervalSec after it (baseline, unchanged)", async () => {
    vi.useFakeTimers();
    const { useVizStore } = await import("./store");
    const { writeAutosave } = await import("./platform");
    const s = useVizStore.getState();
    const other = s.presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";

    s.switchPreset(other);
    await vi.advanceTimersByTimeAsync(4999);
    expect(writeAutosave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(writeAutosave).toHaveBeenCalledTimes(1);
  });

  it("continuous editing faster than the interval still writes at least once every ~intervalSec — the cap a pure trailing debounce doesn't have", async () => {
    vi.useFakeTimers();
    const { useVizStore } = await import("./store");
    const { writeAutosave } = await import("./platform");

    // Simulates a long slider drag: one record()-backed edit every 1s, for
    // 12s straight — always well inside the 5s trailing window, so the OLD
    // pure-debounce design would never fire until the drag actually paused.
    for (let i = 0; i < 12; i++) {
      useVizStore.getState().switchPreset(i % 2 === 0 ? "particle-flow" : "spectrum-bars");
      await vi.advanceTimersByTimeAsync(1000);
    }

    // The max-latency ceiling is anchored to the FIRST edit of the burst
    // and is never reset by the later ones, so it must have fired by 5s in
    // — well before the 12s of continuous editing finished.
    expect(writeAutosave).toHaveBeenCalled();
  });

  it("after the max-latency write fires, the NEXT burst gets its own fresh cap (not starved forever)", async () => {
    vi.useFakeTimers();
    const { useVizStore } = await import("./store");
    const { writeAutosave } = await import("./platform");

    for (let i = 0; i < 6; i++) {
      useVizStore.getState().switchPreset(i % 2 === 0 ? "particle-flow" : "spectrum-bars");
      await vi.advanceTimersByTimeAsync(1000);
    }
    const firstCount = vi.mocked(writeAutosave).mock.calls.length;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 6; i++) {
      useVizStore.getState().switchPreset(i % 2 === 0 ? "particle-flow" : "spectrum-bars");
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(vi.mocked(writeAutosave).mock.calls.length).toBeGreaterThan(firstCount);
  });
});

describe("the autosave payload (R2-26)", () => {
  it("is the COMPACT serialization — parseable, newline-free — not the pretty save-file form", async () => {
    vi.useFakeTimers();
    const { useVizStore } = await import("./store");
    const { writeAutosave } = await import("./platform");
    const { parseProject } = await import("./project");
    const s = useVizStore.getState();
    const other = s.presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";

    s.switchPreset(other);
    await vi.advanceTimersByTimeAsync(5001);

    expect(writeAutosave).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(writeAutosave).mock.calls[0][0];
    // Nobody reads autosaves: the pretty indentation walk (and its extra
    // structural bytes) bought nothing on a file written every few seconds.
    expect(payload).not.toContain("\n");
    // Still the full, valid document — compactness must cost zero fidelity.
    expect(parseProject(payload).presetId).toBe(other);
  });
});

describe("flushAutosave — immediate, awaited, cancels pending timers", () => {
  it("writes immediately without waiting for the debounce", async () => {
    vi.useFakeTimers();
    const { useVizStore } = await import("./store");
    const { writeAutosave } = await import("./platform");
    const s = useVizStore.getState();
    const other = s.presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";
    s.switchPreset(other);
    expect(writeAutosave).not.toHaveBeenCalled(); // still inside the 5s window

    await useVizStore.getState().flushAutosave();

    expect(writeAutosave).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending timers, so the debounced write never ALSO fires redundantly afterward", async () => {
    vi.useFakeTimers();
    const { useVizStore } = await import("./store");
    const { writeAutosave } = await import("./platform");
    const s = useVizStore.getState();
    const other = s.presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";
    s.switchPreset(other);

    await useVizStore.getState().flushAutosave();
    expect(writeAutosave).toHaveBeenCalledTimes(1);

    // If the original scheduleAutosave() timers were still armed, this
    // would fire a SECOND, redundant write of the same content.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writeAutosave).toHaveBeenCalledTimes(1);
  });

  it("browser build: a no-op (isTauri gates it at the entrypoint)", async () => {
    const { useVizStore } = await import("./store");
    const { isTauri, writeAutosave } = await import("./platform");
    vi.mocked(isTauri).mockReturnValue(false);

    await useVizStore.getState().flushAutosave();

    expect(writeAutosave).not.toHaveBeenCalled();
  });
});
