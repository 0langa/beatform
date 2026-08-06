import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quota-safe persistence chokepoint (SS-2): with the origin near quota, any
 * small synchronous localStorage.setItem throws QuotaExceededError — from
 * INSIDE a store action, after set() but before the renderer re-sync that
 * follows it, and nothing catches a synchronous throw out of an onClick.
 * Contract under test: safeSetItem never throws, warns per key, surfaces ONE
 * throttled user-facing notice, and store actions complete (state + renderer
 * calls) with the failure reported through the ordinary error toast.
 */

const QUOTA_MESSAGE =
  "Storage full — latest change couldn't be cached; export or save your project";

class QuotaStorage {
  getItem(): string | null {
    return null;
  }
  setItem(): void {
    throw new Error("QuotaExceededError");
  }
  removeItem(): void {}
}

function installGlobals() {
  vi.stubGlobal("localStorage", new QuotaStorage());
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
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

// Generous budgets for the same reason as store.test.ts: these re-import
// real modules (the second describe the whole store graph) inside the test
// body, which under heavy parallel worker load can alone run past vitest's
// 5 s default and fail as a timeout rather than a logic error.
describe("safeSetItem", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installGlobals();
  });

  it("never throws on a full store; warns and reports the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { safeSetItem, setWriteFailureNotifier } = await import("./persistence");
    const notify = vi.fn();
    setWriteFailureNotifier(notify);

    expect(safeSetItem("viz.test", "x")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(QUOTA_MESSAGE);
  });

  it("throttles the user-facing notice, not the per-key warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { safeSetItem, setWriteFailureNotifier } = await import("./persistence");
    const notify = vi.fn();
    setWriteFailureNotifier(notify);

    safeSetItem("viz.a", "x");
    safeSetItem("viz.b", "y");
    safeSetItem("viz.c", "z");
    expect(warn).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalledTimes(1); // one toast per 30 s window
  });

  it("stays silent-but-safe with no notifier registered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { safeSetItem } = await import("./persistence");
    expect(() => safeSetItem("viz.test", "x")).not.toThrow();
  });
});

describe("store actions on a full store", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installGlobals();
  });

  it("setSmoothSpectrum completes, sets the error notice and does not throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { useVizStore } = await import("./store");

    expect(() => useVizStore.getState().setSmoothSpectrum(true)).not.toThrow();
    expect(useVizStore.getState().smoothSpectrum).toBe(true);
    expect(useVizStore.getState().error).toBe(QUOTA_MESSAGE);
  });

  it("switchPreset completes past the failed persist (state/renderer stay in sync)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { useVizStore } = await import("./store");

    const other =
      useVizStore.getState().presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";
    expect(() => useVizStore.getState().switchPreset(other)).not.toThrow();
    // The write failed but the action ran to completion — the exact
    // divergence the unguarded setItem used to cause (throw after set(),
    // before getRenderer()?.setPreset).
    expect(useVizStore.getState().presetId).toBe(other);
  });
});
