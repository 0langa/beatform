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
    // D1 fix, part (b): default "nothing to quarantine" — individual tests
    // below override this to a deterministic filename when they need to
    // assert on the notice's content.
    quarantineSupersededAutosave: vi.fn(async () => null),
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
const { isTauri, readAutosave, writeAutosave, quarantineSupersededAutosave } =
  await import("../platform");
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
  vi.mocked(quarantineSupersededAutosave).mockReset().mockResolvedValue(null);
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

  it("final review round, item 1: newProject() clears a standing recovered notice — File>New after a recovery must not leave the toast standing over an unrelated document", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    await useVizStore.getState().bootDesktopDocument();
    expect(useVizStore.getState().recoveredNotice).toBe(true); // sanity: recovery really fired

    useVizStore.getState().newProject();

    expect(useVizStore.getState().recoveredNotice).toBe(false);
  });

  it("final review round, item 1: openProjectText() clears a standing recovered notice — opening an unrelated project must not leave the toast standing over it", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    await useVizStore.getState().bootDesktopDocument();
    expect(useVizStore.getState().recoveredNotice).toBe(true); // sanity: recovery really fired

    useVizStore
      .getState()
      .openProjectText("unrelated.bfproj", autosaveTextWithPreset("spectrum-bars"));

    expect(useVizStore.getState().recoveredNotice).toBe(false);
  });

  // openProject() itself is not separately exercised here (it needs a real
  // file-dialog mock this file doesn't set up) — it is covered by
  // inspection instead, the same standard this lane already applies
  // elsewhere: it calls applyDocument exactly like openProjectText does,
  // and the fix lives in applyDocument's own set(), not in either caller.

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

    // Final review round, item 2: ownership must be knowable SYNCHRONOUSLY,
    // before either promise settles — this is what lets App.tsx's boot-veil
    // effect skip the second (non-owner) call entirely instead of racing a
    // promise that resolves almost immediately.
    expect(first).not.toBeNull();
    expect(second).toBeNull();

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

/**
 * E2-D1 (D1 patch lane, 2.97.1) — promoted from the read-only repro at
 * .superpowers-repro/d1-staleOverwrite.test.ts. That repro proved the bug by
 * asserting the CURRENT (buggy) mechanism end to end: guard refuses ->
 * nothing protects the file -> the session's ordinary autosave overwrites it
 * with stale-base content. These tests assert the FIXED behavior instead —
 * they fail against pre-fix code for the right reason (the protections
 * below don't exist yet), and pass once both fix pieces land:
 *
 *  (a) GATE AUTOSAVE ON BOOT SETTLEMENT — runScheduledAutosaveWrite (the one
 *      serialization chokepoint flushAutosave also funnels through) waits
 *      for bootDesktopDocument's read to settle before ever calling
 *      docOf(get()), bounded so a hung read can't dam autosave/close
 *      forever (store.ts's awaitBootSettled, sharing CLOSE_FLUSH_TIMEOUT_MS's
 *      mold).
 *  (b) QUARANTINE-ASIDE ON REFUSAL — when the anti-clobber guard refuses to
 *      apply a newer, successfully-parsed document because memory already
 *      moved on, the file is moved aside (quarantineSupersededAutosave)
 *      BEFORE bootDesktopDocument returns, so whatever write (a) eventually
 *      lets through can only ever overwrite a copy.
 *
 * Three distinct built-in preset ids disambiguate "seed" (the frozen
 * localStorage fallback docOf(PRISTINE) already carries), "edit" (the
 * in-window record()-backed change), and "newer file" (what the read
 * resolves with) — same convention the repro established.
 */
describe("D1 fix — GATE AUTOSAVE ON BOOT SETTLEMENT + QUARANTINE-ASIDE ON REFUSAL (E2-D1)", () => {
  const NEWER_FILE_PRESET = "tunnel-rings";
  const QUARANTINE_NAME = "document.bfproj.superseded-1700000000000";

  it("edit lands during the in-flight read: the guard still refuses the late apply, and the refused (not corrupt — it parsed fine) file is quarantined aside before boot returns, with a persistent notice naming where it went", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(quarantineSupersededAutosave).mockResolvedValue(QUARANTINE_NAME);
    let resolveRead!: (contents: string) => void;
    vi.mocked(readAutosave).mockImplementation(
      () => new Promise<string | null>((r) => (resolveRead = r)),
    );
    const seedPreset = useVizStore.getState().presetId; // the frozen localStorage-sourced fallback

    const boot = useVizStore.getState().bootDesktopDocument();
    expect(boot).not.toBeNull();
    expect(useVizStore.getState().presetId).toBe(seedPreset);

    // The veil cap has dropped; the user clicks a preset chip while the
    // read above is still in flight — any record()-backed action works.
    useVizStore.getState().switchPreset(OTHER_PRESET);
    expect(useVizStore.getState().undoDepth).toBe(1);

    // The real read finally lands with a DIFFERENT, newer document.
    resolveRead(autosaveTextWithPreset(NEWER_FILE_PRESET));
    await boot;

    // The guard correctly refuses the late apply — unchanged by this fix.
    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
    // NEW (part b): the refused file — not corrupt, it parsed fine and was
    // ready to apply — is moved aside before boot returns, and the user is
    // told where.
    expect(quarantineSupersededAutosave).toHaveBeenCalledTimes(1);
    expect(useVizStore.getState().supersededNotice).toContain(QUARANTINE_NAME);

    // The debounced write this edit armed (simulated here via flushAutosave
    // — the same runScheduledAutosaveWrite chokepoint a real timer landing
    // would call) still lands: the user's in-memory edit is the right
    // content to persist. By now the newer file is already safe under the
    // quarantine name, so this write can only ever overwrite a COPY.
    await useVizStore.getState().flushAutosave();
    expect(writeAutosave).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(writeAutosave).mock.calls[0][0] as string) as {
      document: { presetId: string };
    };
    expect(written.document.presetId).toBe(OTHER_PRESET);
  });

  it("no-edit variant: closing while the read is in flight WAITS for boot to settle instead of writing the frozen seed — the flush's write reflects the newer on-disk document (M2 restored)", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let resolveRead!: (contents: string) => void;
    vi.mocked(readAutosave).mockImplementation(
      () => new Promise<string | null>((r) => (resolveRead = r)),
    );

    const boot = useVizStore.getState().bootDesktopDocument();
    expect(boot).not.toBeNull();

    // User hits the title-bar X (outside the webview) while the read above
    // is still pending: onCloseRequested -> flushAutosave.
    const flushPromise = useVizStore.getState().flushAutosave();
    try {
      await Promise.resolve();
      await Promise.resolve();
      // Gated — must NOT have written the frozen seed just because the
      // close fired before the read resolved.
      expect(writeAutosave).not.toHaveBeenCalled();
    } finally {
      // Release the parked read NO MATTER what the assertion above did —
      // an unresolved read here would leave `bootStarted` (module-scoped
      // in projectIOActions.ts) stuck true and wedge the reentrancy guard
      // for every later test in this file, exactly the hazard
      // platform.autosave.test.ts's own "second write STARTS only after
      // the first settles" test documents for the identical pattern.
      resolveRead(autosaveTextWithPreset(NEWER_FILE_PRESET));
    }
    await boot; // no edit raced it, so the guard applies the newer doc (alreadyOnDisk)
    await flushPromise; // the gate now opens and the flush's write proceeds

    expect(useVizStore.getState().presetId).toBe(NEWER_FILE_PRESET);
    expect(writeAutosave).toHaveBeenCalledTimes(1);
    const written = JSON.parse(vi.mocked(writeAutosave).mock.calls[0][0] as string) as {
      document: { presetId: string };
    };
    expect(written.document.presetId).toBe(NEWER_FILE_PRESET); // NOT the stale seed
  });

  it("a boot read that never resolves does not dam flushAutosave forever — it proceeds once the bound elapses, and a later close still works", async () => {
    vi.useFakeTimers();
    let resolveRead: ((contents: string | null) => void) | undefined;
    let boot: Promise<void> | null = null;
    try {
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(readAutosave).mockImplementation(
        () => new Promise<string | null>((r) => (resolveRead = r)),
      );
      boot = useVizStore.getState().bootDesktopDocument();
      expect(boot).not.toBeNull();

      const flushPromise = useVizStore.getState().flushAutosave();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeAutosave).not.toHaveBeenCalled();

      // Safely past any reasonable bound (store.ts's CLOSE_FLUSH_TIMEOUT_MS
      // mold this reuses is 4000ms) without depending on that exact number.
      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromise;

      expect(writeAutosave).toHaveBeenCalledTimes(1); // proceeded despite the still-hung read
    } finally {
      // Let the parked read settle NO MATTER what the assertions above
      // did, so bootStarted's own `finally` (projectIOActions.ts) actually
      // runs — otherwise this test permanently wedges the reentrancy guard
      // (bootStarted stuck true) for every later test in this file.
      resolveRead?.(null);
      await boot;
      vi.useRealTimers();
    }
  });

  it("boot already settled: flushAutosave's write is not delayed by the gate at all (happy-path latency unaffected)", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(null); // resolves immediately -> boot settles fast
    await useVizStore.getState().bootDesktopDocument();
    vi.mocked(writeAutosave).mockClear(); // drop the fallback write boot's own missing-file path just made

    // REAL timers on purpose: if the gate added even a fixed multi-second
    // delay on the already-settled path, this would be slow/flaky rather
    // than clean — the absence of any vi.advanceTimersByTimeAsync call here
    // is the proof.
    await useVizStore.getState().flushAutosave();

    expect(writeAutosave).toHaveBeenCalledTimes(1);
  });

  it("quarantine finds nothing to move (already gone, or the rename failed): no notice is raised — best-effort, same precedent as the corrupt-file quarantine", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(quarantineSupersededAutosave).mockResolvedValue(null);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(NEWER_FILE_PRESET));
    useVizStore.setState({ undoDepth: 1 }); // forces the refusal branch

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().supersededNotice).toBeNull();
  });

  it("dismissSupersededNotice() clears it, and only it", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(quarantineSupersededAutosave).mockResolvedValue(QUARANTINE_NAME);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(NEWER_FILE_PRESET));
    useVizStore.setState({ undoDepth: 1 }); // forces the refusal branch
    await useVizStore.getState().bootDesktopDocument();
    expect(useVizStore.getState().supersededNotice).not.toBeNull();
    useVizStore.setState({ error: "unrelated" });

    useVizStore.getState().dismissSupersededNotice();

    expect(useVizStore.getState().supersededNotice).toBeNull();
    expect(useVizStore.getState().error).toBe("unrelated"); // untouched by the dismiss
  });
});
