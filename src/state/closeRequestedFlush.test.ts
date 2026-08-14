import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * P-11 whole-lane-review fix C1 — the awaited half: a Tauri window-close
 * request must not complete until the current document has been flushed to
 * the autosave file, closing the "quit within the debounce window loses the
 * edit" gap `scheduleAutosave`'s trailing debounce leaves open on its own.
 *
 * Isolated from store.test.ts's shared "store initApp teardown" describe on
 * purpose: that file's `../platform` mock leaves `isTauri` at its REAL
 * (false-in-jsdom) value, which every existing test there depends on: this
 * whole code path is isTauri()-gated and would never install without
 * flipping that default, which risks destabilizing tests this lane didn't
 * come here to touch. A fresh, self-contained mock surface removes that
 * risk entirely.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

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

const destroy = vi.fn(async () => undefined);
const unlisten = vi.fn();
type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;
let registeredHandler: CloseHandler | null = null;
const onCloseRequested = vi.fn(async (handler: CloseHandler) => {
  registeredHandler = handler;
  return unlisten;
});
const getCurrentWindow = vi.fn(() => ({ onCloseRequested, destroy }));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 1,
    height: 1,
    getBoundingClientRect: () => ({ width: 1, height: 1 }),
  } as unknown as HTMLCanvasElement;
}

const { useVizStore } = await import("./store");
const PRISTINE = { ...useVizStore.getState() };

afterEach(() => {
  useVizStore.setState(PRISTINE);
  destroy.mockClear();
  unlisten.mockClear();
  onCloseRequested.mockClear();
  getCurrentWindow.mockClear();
  registeredHandler = null;
});

describe("Tauri onCloseRequested — the awaited close-flush", () => {
  it("registers a handler on initApp", async () => {
    const dispose = useVizStore.getState().initApp(fakeCanvas());
    await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
    expect(registeredHandler).not.toBeNull();
    dispose();
  });

  it("prevents the default close, awaits flushAutosave, THEN destroys the window", async () => {
    const dispose = useVizStore.getState().initApp(fakeCanvas());
    await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));

    const order: string[] = [];
    const preventDefault = vi.fn(() => order.push("preventDefault"));
    const flushSpy = vi
      .spyOn(useVizStore.getState(), "flushAutosave")
      .mockImplementation(async () => {
        order.push("flush");
      });
    destroy.mockImplementation(async () => {
      order.push("destroy");
    });

    await registeredHandler!({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    // The whole point: destroy must not race ahead of the flush.
    expect(order).toEqual(["preventDefault", "flush", "destroy"]);

    dispose();
  });

  it("still destroys the window even when the flush fails — a failing autosave must not hang the app open", async () => {
    const dispose = useVizStore.getState().initApp(fakeCanvas());
    await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
    vi.spyOn(useVizStore.getState(), "flushAutosave").mockRejectedValue(new Error("disk full"));
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await registeredHandler!({ preventDefault: vi.fn() });

    expect(destroy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    dispose();
  });

  it("a teardown that runs before the async registration resolves unlistens immediately instead of leaking it", async () => {
    // No `await vi.waitFor` here — teardown races the still-pending install.
    const dispose = useVizStore.getState().initApp(fakeCanvas());
    dispose();

    await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("browser build: never attempts to install a close handler", async () => {
    const platform = await import("./platform");
    vi.mocked(platform.isTauri).mockReturnValue(false);

    const dispose = useVizStore.getState().initApp(fakeCanvas());
    // Give any stray microtask a chance to run before asserting the negative.
    await Promise.resolve();
    await Promise.resolve();

    expect(getCurrentWindow).not.toHaveBeenCalled();
    dispose();
    vi.mocked(platform.isTauri).mockReturnValue(true);
  });
});
