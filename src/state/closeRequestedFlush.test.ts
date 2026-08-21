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
  return {
    ...actual,
    isTauri: vi.fn(() => true),
    writeAutosave: vi.fn(async () => {}),
    // R2-09: the close guard's confirm. Real askConfirm needs the Tauri
    // dialog plugin (isTauri is forced true above) — mock it, defaulting to
    // "close anyway" so the pre-R2-09 tests (no export running, so the guard
    // never asks) stay byte-for-byte on their old path.
    askConfirm: vi.fn(async () => true),
  };
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
const { askConfirm } = await import("./platform");
const { shared } = await import("./slices/shared");
const PRISTINE = { ...useVizStore.getState() };

afterEach(() => {
  useVizStore.setState(PRISTINE);
  destroy.mockClear();
  unlisten.mockClear();
  onCloseRequested.mockClear();
  getCurrentWindow.mockClear();
  vi.mocked(askConfirm).mockClear();
  shared.exportAbort = null;
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

  /**
   * R2-09: a running export (or batch) is mid-write when the close request
   * arrives — the stream lane has a `.partial` staged, a sidecar session has
   * the output file open. The handler must ask before killing it; a declined
   * confirm keeps the window open (preventDefault already held it), and a
   * confirmed close aborts the run and waits — bounded — for its teardown to
   * clear `exporting` before the ordinary flush+destroy continues.
   */
  describe("R2-09: a running export guards the close", () => {
    const EXPORTING = { done: 10, total: 100, speed: null, avgSpeed: null };

    it("declining the confirm keeps the window open — no flush, no destroy, export untouched", async () => {
      const dispose = useVizStore.getState().initApp(fakeCanvas());
      await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
      const flushSpy = vi.spyOn(useVizStore.getState(), "flushAutosave").mockResolvedValue();
      useVizStore.setState({ exporting: EXPORTING });
      const ac = new AbortController();
      shared.exportAbort = ac;
      vi.mocked(askConfirm).mockResolvedValueOnce(false);

      await registeredHandler!({ preventDefault: vi.fn() });

      expect(askConfirm).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(askConfirm).mock.calls[0][0])).toContain("An export is running");
      expect(ac.signal.aborted).toBe(false); // the render keeps going
      expect(flushSpy).not.toHaveBeenCalled();
      expect(destroy).not.toHaveBeenCalled();
      dispose();
    });

    it("a confirmed close aborts the export, waits out its teardown, then flushes and destroys", async () => {
      const dispose = useVizStore.getState().initApp(fakeCanvas());
      await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
      const order: string[] = [];
      vi.spyOn(useVizStore.getState(), "flushAutosave").mockImplementation(async () => {
        order.push("flush");
      });
      destroy.mockImplementation(async () => {
        order.push("destroy");
      });
      useVizStore.setState({ exporting: EXPORTING });
      const ac = new AbortController();
      shared.exportAbort = ac;
      // What runExport's catch/finally really do on abort: the discard runs,
      // THEN `exporting` clears — modeled here as the abort's own effect so
      // the handler's poll has something true to observe.
      ac.signal.addEventListener("abort", () => {
        order.push("abort");
        useVizStore.setState({ exporting: null });
      });

      await registeredHandler!({ preventDefault: vi.fn() });

      expect(ac.signal.aborted).toBe(true);
      expect(order).toEqual(["abort", "flush", "destroy"]);
      dispose();
    });

    it("a batch run guards the close the same way", async () => {
      const dispose = useVizStore.getState().initApp(fakeCanvas());
      await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
      vi.spyOn(useVizStore.getState(), "flushAutosave").mockResolvedValue();
      useVizStore.setState({ batchStatus: "running" });
      vi.mocked(askConfirm).mockResolvedValueOnce(false);

      await registeredHandler!({ preventDefault: vi.fn() });

      expect(askConfirm).toHaveBeenCalledTimes(1);
      expect(destroy).not.toHaveBeenCalled();
      dispose();
    });

    it("no export running: the close never asks anything", async () => {
      const dispose = useVizStore.getState().initApp(fakeCanvas());
      await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
      vi.spyOn(useVizStore.getState(), "flushAutosave").mockResolvedValue();

      await registeredHandler!({ preventDefault: vi.fn() });

      expect(askConfirm).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalledTimes(1);
      dispose();
    });

    it("the teardown wait is bounded — a wedged teardown still lets the window close", async () => {
      const dispose = useVizStore.getState().initApp(fakeCanvas());
      await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
      vi.spyOn(useVizStore.getState(), "flushAutosave").mockResolvedValue();
      // The wedge: cancel fires but nothing ever clears `exporting`.
      useVizStore.setState({ exporting: EXPORTING });

      vi.useFakeTimers();
      try {
        let settled = false;
        const handlerPromise = registeredHandler!({ preventDefault: vi.fn() }) as Promise<void>;
        void handlerPromise.then(() => {
          settled = true;
        });

        // Inside the ~2 s teardown budget: still waiting.
        await vi.advanceTimersByTimeAsync(1500);
        expect(settled).toBe(false);
        expect(destroy).not.toHaveBeenCalled();

        // Past it: the handler moves on to flush+destroy regardless.
        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).toBe(true);
        expect(destroy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
      dispose();
    });
  });

  describe("second whole-lane-review round item 2: the flush has a deadline", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a permanently hung flush still lets the handler settle within the deadline, and destroy still fires", async () => {
      const dispose = useVizStore.getState().initApp(fakeCanvas());
      // Install the handler on REAL timers first (vi.waitFor's own polling
      // assumes them); switch to fake ones only for the deadline itself.
      await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));

      // A genuine hang: a promise that never settles, simulating a
      // cloud-synced AppData folder stalling the write for real.
      vi.spyOn(useVizStore.getState(), "flushAutosave").mockReturnValue(
        new Promise<void>(() => undefined),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      vi.useFakeTimers();
      let settled = false;
      const handlerPromise = registeredHandler!({ preventDefault: vi.fn() }) as Promise<void>;
      void handlerPromise.then(() => {
        settled = true;
      });

      // Well before the deadline: still waiting, destroy not called yet.
      await vi.advanceTimersByTimeAsync(3000);
      expect(settled).toBe(false);
      expect(destroy).not.toHaveBeenCalled();

      // Past the deadline: the handler must settle on its own, and destroy
      // must fire — the permanently-hung flush is simply abandoned, not
      // awaited forever.
      await vi.advanceTimersByTimeAsync(1500);
      expect(settled).toBe(true);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("did not finish in time"));

      warnSpy.mockRestore();
      dispose();
    });

    it("a flush that settles WELL before the deadline is not affected by it — no spurious timeout warning", async () => {
      const dispose = useVizStore.getState().initApp(fakeCanvas());
      await vi.waitFor(() => expect(onCloseRequested).toHaveBeenCalledTimes(1));
      vi.spyOn(useVizStore.getState(), "flushAutosave").mockResolvedValue(undefined);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await registeredHandler!({ preventDefault: vi.fn() });

      expect(destroy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      dispose();
    });
  });
});
