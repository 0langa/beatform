import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeProject, validateDocument } from "../project";

/**
 * P-11 Task 2 — the boot chokepoint switch: desktop boot now prefers the
 * atomic autosave `.bfproj` over the localStorage document cache. See
 * .superpowers/p11-lane-log.md for the full design (the sync-init/async-read
 * seam, the undoDepth===0 anti-clobber guard, and why this replaces
 * `checkAutosaveRecovery` rather than sitting alongside it).
 *
 * `initApp` is never called here, so `liveCanvas`/`renderer` stay null and
 * `applyDocument`'s renderer-facing calls all take their `getRenderer() ??`
 * / null-canvas early-return branches for free — only `services`' throwing
 * accessor (getAnalyzer) needs a mock, matching the narrower subset
 * store.test.ts documents as safe to skip when initApp isn't in play.
 */

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => {
    throw new Error("getEngine: not expected without initApp");
  }),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return {
    ...actual,
    isTauri: vi.fn(() => false),
    readAutosave: vi.fn(async () => null),
    writeAutosave: vi.fn(async () => {}),
    clearAutosave: vi.fn(async () => {}),
  };
});

// Default true (clean) — matches what this file's `localStorage.getItem: ()
// => null` stub already produces organically via the real
// wasPreviousExitClean (`getItem(...) !== "0"`); mocked anyway so Task 4's
// "previous exit was dirty" cases can override it per test.
vi.mock("../persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../persistence")>();
  return { ...actual, wasPreviousExitClean: vi.fn(() => true) };
});

const { useVizStore } = await import("../store");
const { isTauri, readAutosave, writeAutosave } = await import("../platform");
const { wasPreviousExitClean } = await import("../persistence");

const PRISTINE = { ...useVizStore.getState() };

// Distinct from presets[0] ("spectrum-bars", the default every loader falls
// back to) — same convention store.test.ts uses to pick "the other" preset.
const OTHER_PRESET = "particle-flow";

function autosaveTextWithPreset(presetId: string): string {
  return serializeProject(validateDocument({ presetId }), "test");
}

afterEach(() => {
  useVizStore.setState(PRISTINE);
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(readAutosave).mockReset().mockResolvedValue(null);
  vi.mocked(writeAutosave).mockClear().mockResolvedValue(undefined);
  vi.mocked(wasPreviousExitClean).mockReturnValue(true);
});

describe("bootDesktopDocument — desktop boots from the autosave file (P-11 Task 2)", () => {
  it("browser build: a no-op — never reads or writes the autosave file, state untouched", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const before = useVizStore.getState().presetId;

    await useVizStore.getState().bootDesktopDocument();

    expect(readAutosave).not.toHaveBeenCalled();
    expect(writeAutosave).not.toHaveBeenCalled();
    expect(useVizStore.getState().presetId).toBe(before);
  });

  it("desktop, autosave parses: becomes the boot document — preferred over the localStorage-sourced state already loaded, and does NOT schedule a redundant rewrite (M2)", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
      expect(useVizStore.getState().presetId).not.toBe(OTHER_PRESET); // sanity: really a change

      await useVizStore.getState().bootDesktopDocument();

      expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
      // M2: this is a fake-timer upgrade of a test that used to only prove
      // "hasn't been called YET" (synchronously true even when a redundant
      // write was silently queued behind the debounce). applyDocument's
      // `{alreadyOnDisk: true}` skips scheduleAutosave() entirely on this
      // path, so advancing well past any possible autosaveIntervalSec must
      // prove NO write ever fires, not just that none happened before this
      // line — just read this exact content from disk, nothing changed
      // that needs re-establishing it.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writeAutosave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("desktop, autosave missing: keeps the localStorage-sourced state (the recorded fallback) and writes the autosave immediately", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(null);
    const before = useVizStore.getState().presetId;

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(before);
    expect(writeAutosave).toHaveBeenCalledTimes(1);
  });

  it("desktop, autosave corrupt: falls back exactly like 'missing' — a bad file must never white-screen boot", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue("{ not json");
    const before = useVizStore.getState().presetId;

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(before);
    expect(writeAutosave).toHaveBeenCalledTimes(1);
  });

  it("desktop, autosave from a newer schema than this build understands: also falls back, does not throw out of boot", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const future = JSON.parse(autosaveTextWithPreset(OTHER_PRESET)) as { schemaVersion: number };
    future.schemaVersion = 9999;
    vi.mocked(readAutosave).mockResolvedValue(JSON.stringify(future));
    const before = useVizStore.getState().presetId;

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(before);
    expect(writeAutosave).toHaveBeenCalledTimes(1);
  });

  it("desktop, autosave parseable but the user already made a real edit first: does not clobber the in-session edit", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    // The exact, cheap signal a record()-backed action leaves — see the lane
    // log's "Key architectural finding" for why undoDepth===0 is provably
    // "nothing has happened since boot yet."
    useVizStore.setState({ undoDepth: 1 });
    const before = useVizStore.getState().presetId;

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(before);
  });
});

describe("recovery-flow reconciliation — a persistent, dismissible notice replaces the Restore/Discard prompt (P-11 Task 4, owner ruling D)", () => {
  it("previous exit unclean + the autosave applies: sets the persistent recoveredNotice flag (NOT the transient notice, which auto-fades)", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
    expect(useVizStore.getState().recoveredNotice).toBe(true);
    // Owner ruling D: this is NOT the auto-fading transient toast — flashNotice
    // (which writes `notice`) is never called for this case any more.
    expect(useVizStore.getState().notice).toBeNull();
  });

  it("owner ruling D: the recovered notice does not expire on the transient 4s timer — it is still true well past it", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(wasPreviousExitClean).mockReturnValue(false);
      vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));

      await useVizStore.getState().bootDesktopDocument();
      expect(useVizStore.getState().recoveredNotice).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000); // well past flashNotice's 4000ms
      expect(useVizStore.getState().recoveredNotice).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("owner ruling D: dismissRecoveredNotice() clears it, and only it", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    await useVizStore.getState().bootDesktopDocument();
    expect(useVizStore.getState().recoveredNotice).toBe(true);
    useVizStore.setState({ error: "unrelated" });

    useVizStore.getState().dismissRecoveredNotice();

    expect(useVizStore.getState().recoveredNotice).toBe(false);
    expect(useVizStore.getState().error).toBe("unrelated"); // untouched by the dismiss
  });

  it("previous exit was clean: silent even though the autosave still applies — this is the common path, every ordinary launch", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET); // still preferred — Task 2's rule is unconditional
    expect(useVizStore.getState().recoveredNotice).toBe(false);
  });

  it("previous exit unclean but the autosave is missing (fallback path): no notice — nothing was actually recovered, it's an ordinary cache boot", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(null);

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().recoveredNotice).toBe(false);
  });

  it("previous exit unclean, autosave parses, but the anti-clobber guard skipped applying it: no notice either — nothing was applied", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    useVizStore.setState({ undoDepth: 1 });

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().recoveredNotice).toBe(false);
  });

  it("recoveredDoc/restoreAutosave/dismissAutosave no longer exist on VizState — the interactive prompt's machinery is gone, not just unreachable", () => {
    const s = useVizStore.getState() as unknown as Record<string, unknown>;
    expect(s.recoveredDoc).toBeUndefined();
    expect(s.restoreAutosave).toBeUndefined();
    expect(s.dismissAutosave).toBeUndefined();
  });
});

describe("whole-lane-review fix C2(a) — an apply-time failure on a GOOD file must never reach the write-back", () => {
  it("parseProject succeeds, applyDocument throws: the fallback write-back never fires (would otherwise serialize STALE state over a file that was actually fine)", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Before the fix, ONE try wrapped both parseProject AND applyDocument —
    // this simulates an apply-time hiccup on an otherwise-good, successfully
    // PARSED file (a renderer bug, a bad merge, anything) landing in that
    // shared catch.
    useVizStore.setState({
      applyDocument: vi.fn(() => {
        throw new Error("applyDocument blew up");
      }),
    });

    await useVizStore.getState().bootDesktopDocument();

    // The bug this pins: the old shared catch fell through to
    // `writeAutosave(serializeProject(docOf(get())))`, overwriting the disk
    // file that had just parsed FINE with the stale, never-applied state.
    expect(writeAutosave).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("the SAME apply failure does not throw out of bootDesktopDocument itself — the exception is caught and logged, not silently swallowed", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useVizStore.setState({
      applyDocument: vi.fn(() => {
        throw new Error("applyDocument blew up");
      }),
    });

    await expect(useVizStore.getState().bootDesktopDocument()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("whole-lane-review fix I1 — a manual project open racing the read wins", () => {
  /** A promise this test controls the settling of, matching the
   * `deferred()` helper shape already established elsewhere in this
   * codebase's store-level tests (customShaderActions.test.ts). */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("a project opened WHILE the autosave read is still in flight wins — the late-arriving autosave content is discarded, not silently applied over it", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const read = deferred<string | null>();
    vi.mocked(readAutosave).mockReturnValue(read.promise);

    const bootPromise = useVizStore.getState().bootDesktopDocument();

    // The manual open lands WHILE the read above is still pending — this is
    // exactly the case undoDepth alone cannot catch: openProjectText FORCES
    // undoDepth back to 0, the same value a fresh boot already has.
    // Distinct from OTHER_PRESET ("particle-flow", used for the stale
    // autosave content below) so the two are unambiguous in the assertion.
    const OPENED_PRESET = "spectrum-bars";
    useVizStore.getState().openProjectText("manual.bfproj", autosaveTextWithPreset(OPENED_PRESET));
    expect(useVizStore.getState().undoDepth).toBe(0); // confirms the trap I1 found is real
    expect(useVizStore.getState().presetId).toBe(OPENED_PRESET);

    // NOW the stale autosave read resolves, with DIFFERENT content.
    read.resolve(autosaveTextWithPreset(OTHER_PRESET));
    await bootPromise;

    // The manually-opened project must still be what's live — not silently
    // replaced by the autosave content that started loading before it.
    expect(useVizStore.getState().presetId).toBe(OPENED_PRESET);
  });

  it("docEpoch is bumped by the manual open, unlike undoDepth which the open itself resets to 0", async () => {
    const before = useVizStore.getState().docEpoch;
    useVizStore.getState().openProjectText("manual.bfproj", autosaveTextWithPreset(OTHER_PRESET));
    expect(useVizStore.getState().undoDepth).toBe(0);
    expect(useVizStore.getState().docEpoch).toBeGreaterThan(before);
  });
});

describe("whole-lane-review round 2, item 3 — boot reentrancy guard (React StrictMode double-invoke)", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("two concurrent calls: one actually reads and applies, the other no-ops immediately", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const read = deferred<string | null>();
    vi.mocked(readAutosave).mockReturnValue(read.promise);
    expect(useVizStore.getState().presetId).not.toBe(OTHER_PRESET); // sanity: a real change

    // StrictMode's double-invoke: the SAME effect body runs twice, so this
    // is two back-to-back calls with no await between them — not two
    // independently-scheduled boots.
    const first = useVizStore.getState().bootDesktopDocument();
    const second = useVizStore.getState().bootDesktopDocument();

    // The second call must not have started its own read — readAutosave
    // was invoked exactly once, by the first call.
    expect(readAutosave).toHaveBeenCalledTimes(1);

    read.resolve(autosaveTextWithPreset(OTHER_PRESET));
    await Promise.all([first, second]);

    // The document was applied exactly once, correctly — not skipped
    // entirely (the guard must not just silently drop the boot) and not
    // corrupted by two overlapping applies.
    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
    expect(readAutosave).toHaveBeenCalledTimes(1);
  });

  it("the guard resets once the in-flight call finishes — a LATER, genuinely sequential boot call still runs (not a run-once-ever latch)", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));

    await useVizStore.getState().bootDesktopDocument();
    expect(readAutosave).toHaveBeenCalledTimes(1);

    // A second call, well after the first has fully settled — must be a
    // real, independent boot attempt, not silently absorbed by a stale
    // "already started" flag.
    await useVizStore.getState().bootDesktopDocument();
    expect(readAutosave).toHaveBeenCalledTimes(2);
  });

  it("the guard resets even when the in-flight call throws, via the finally — a later call is never permanently locked out by one failure", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockRejectedValueOnce(new Error("disk error"));

    // bootDesktopDocument itself has no top-level try/catch around the
    // `await readAutosave()` call — a rejection there propagates out of
    // the action. This test only cares that doing so does not leave
    // `bootStarted` stuck true.
    await expect(useVizStore.getState().bootDesktopDocument()).rejects.toThrow("disk error");

    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    await useVizStore.getState().bootDesktopDocument();
    expect(readAutosave).toHaveBeenCalledTimes(2);
    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
  });
});
