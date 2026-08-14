import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Owner ruling E (final round) — `bootVeilVisible`'s initial value is
 * computed once, synchronously, from `isTauri()` at store-creation time
 * (store.ts's module-scope initial-state literal, `bootVeilVisible:
 * isTauri()` — see that field's own doc comment). That timing is the
 * entire point: it must be correct on the very FIRST render, before any
 * effect runs, so App.tsx's `isTauri() && <div className="boot-veil".../>`
 * gate and this flag agree from paint one. A live re-render toggle
 * (`renderHook` + swapping a mock mid-test) can't observe that — the
 * value has to be read off a FRESH module import, exactly the
 * `vi.resetModules()` + remocked `./platform` pattern
 * desktopPersistenceGate.test.ts already uses for the same kind of
 * module-scope, isTauri()-gated initial state.
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
  return { ...actual, isTauri: vi.fn(() => true), writeAutosave: vi.fn(async () => {}) };
});

describe("bootVeilVisible initial value (owner ruling E)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts true on desktop — the veil must already be up for the very first paint", async () => {
    installGlobals();
    vi.resetModules();
    const platform = await import("./platform");
    vi.mocked(platform.isTauri).mockReturnValue(true);
    const { useVizStore } = await import("./store");

    expect(useVizStore.getState().bootVeilVisible).toBe(true);
  });

  it("starts false in the browser build — never rendered, never shown", async () => {
    installGlobals();
    vi.resetModules();
    const platform = await import("./platform");
    vi.mocked(platform.isTauri).mockReturnValue(false);
    const { useVizStore } = await import("./store");

    expect(useVizStore.getState().bootVeilVisible).toBe(false);
  });

  it("hideBootVeil() clears it and is idempotent — App.tsx calls it from two independent triggers", async () => {
    installGlobals();
    vi.resetModules();
    const platform = await import("./platform");
    vi.mocked(platform.isTauri).mockReturnValue(true);
    const { useVizStore } = await import("./store");

    expect(useVizStore.getState().bootVeilVisible).toBe(true);
    useVizStore.getState().hideBootVeil();
    expect(useVizStore.getState().bootVeilVisible).toBe(false);
    // Second call (the cap firing after the boot promise already won, or
    // vice versa) must not throw or resurrect the veil.
    useVizStore.getState().hideBootVeil();
    expect(useVizStore.getState().bootVeilVisible).toBe(false);
  });
});
