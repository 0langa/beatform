import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeProject, validateDocument } from "../project";
import { clearHistory } from "../history";
import { unregisterCustomPreset } from "../../render/presets/custom";

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
  // Defensive backstop for the D1 fake-timer tests below: each of them
  // already restores real timers in its own try/finally, but a test that
  // hangs and hits vitest's OWN (real) test-timeout abandons that promise
  // — including its finally — before it ever runs, which would otherwise
  // leave fake timers active for every test after it. A no-op when timers
  // are already real.
  vi.useRealTimers();
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
 * .superpowers-repro/d1-staleOverwrite.test.ts, then reworked after a
 * review round found the first cut of the fix itself reintroduced the bug
 * on a slow-but-finite read (C1) plus two smaller gaps (I1, I2). That
 * repro proved the bug by asserting the CURRENT (buggy) mechanism end to
 * end: guard refuses -> nothing protects the file -> the session's
 * ordinary autosave overwrites it with stale-base content. These tests
 * assert the FIXED behavior instead — they fail against unfixed code for
 * the right reason, and pass once every piece below lands:
 *
 *  (a) GATE AUTOSAVE ON BOOT SETTLEMENT — runScheduledAutosaveWrite (the one
 *      serialization chokepoint flushAutosave also funnels through) waits
 *      for bootDesktopDocument's read to settle before ever calling
 *      docOf(get()), bounded so a hung read can't dam autosave/close
 *      forever (store.ts's awaitBootSettled, sharing CLOSE_FLUSH_TIMEOUT_MS's
 *      mold). C1: the bound resolves to a "settled" | "timeout"
 *      DISCRIMINANT — a timeout SKIPS the write and re-arms a retry rather
 *      than proceeding with it, because proceeding is exactly the original
 *      bug relocated one layer down.
 *  (b) QUARANTINE-ASIDE ON REFUSAL — when the anti-clobber guard refuses to
 *      apply a newer, successfully-parsed document because memory already
 *      moved on, the ALREADY-READ `contents` (not whatever is currently on
 *      disk — C1 again) are archived via quarantineSupersededAutosave
 *      BEFORE bootDesktopDocument returns, so whatever write (a) eventually
 *      lets through can only ever overwrite a copy. I1: this now raises a
 *      notice UNCONDITIONALLY — success names the archive, failure still
 *      names the source file so the user has a chance to act.
 *
 * Three distinct built-in preset ids disambiguate "seed" (the frozen
 * localStorage fallback docOf(PRISTINE) already carries), "edit" (the
 * in-window record()-backed change), and "newer file" (what the read
 * resolves with) — same convention the repro established.
 *
 * I2: every test below that resolves a deferred `readAutosave()` promise
 * does so inside a try/finally, unconditionally, regardless of whether
 * reasoning about THIS test's specific assertion order says it is
 * "currently safe" — an unresolved read leaves `bootStarted` (module-scoped
 * in projectIOActions.ts) stuck true, wedging the reentrancy guard for
 * every later test in this file. Defensive uniformity here is cheap;
 * debugging a cascaded failure in an unrelated test is not.
 */
describe("D1 fix — GATE AUTOSAVE ON BOOT SETTLEMENT + QUARANTINE-ASIDE ON REFUSAL (E2-D1)", () => {
  const NEWER_FILE_PRESET = "tunnel-rings";
  const QUARANTINE_NAME = "document.bfproj.superseded-1700000000000";

  it("edit lands during the in-flight read: the guard still refuses the late apply, and the refused (not corrupt — it parsed fine) file is archived — the EXACT bytes just read, not a blind copy of whatever is on disk — before boot returns, with a persistent notice naming where it went", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(quarantineSupersededAutosave).mockResolvedValue(QUARANTINE_NAME);
    let resolveRead: ((contents: string) => void) | undefined;
    let boot: Promise<void> | null = null;
    try {
      vi.mocked(readAutosave).mockImplementation(
        () => new Promise<string | null>((r) => (resolveRead = r)),
      );
      const seedPreset = useVizStore.getState().presetId; // the frozen localStorage-sourced fallback

      boot = useVizStore.getState().bootDesktopDocument();
      expect(boot).not.toBeNull();
      expect(useVizStore.getState().presetId).toBe(seedPreset);

      // The veil cap has dropped; the user clicks a preset chip while the
      // read above is still in flight — any record()-backed action works.
      useVizStore.getState().switchPreset(OTHER_PRESET);
      expect(useVizStore.getState().undoDepth).toBe(1);

      // The real read finally lands with a DIFFERENT, newer document.
      const newerContent = autosaveTextWithPreset(NEWER_FILE_PRESET);
      resolveRead!(newerContent);
      await boot;

      // The guard correctly refuses the late apply — unchanged by this fix.
      expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
      // Part (b): the refused file — not corrupt, it parsed fine and was
      // ready to apply — is archived before boot returns, and the user is
      // told where. C1: handed the exact contents just read, not left to
      // trust whatever the live file currently holds.
      expect(quarantineSupersededAutosave).toHaveBeenCalledTimes(1);
      expect(quarantineSupersededAutosave).toHaveBeenCalledWith(newerContent);
      expect(useVizStore.getState().supersededNotice).toContain(QUARANTINE_NAME);

      // The debounced write this edit armed (simulated here via
      // flushAutosave — the same runScheduledAutosaveWrite chokepoint a
      // real timer landing would call) still lands: the user's in-memory
      // edit is the right content to persist. By now the newer file is
      // already safe under the quarantine name, so this write can only
      // ever overwrite a COPY.
      await useVizStore.getState().flushAutosave();
      expect(writeAutosave).toHaveBeenCalledTimes(1);
      const written = JSON.parse(vi.mocked(writeAutosave).mock.calls[0][0] as string) as {
        document: { presetId: string };
      };
      expect(written.document.presetId).toBe(OTHER_PRESET);
    } finally {
      resolveRead?.(autosaveTextWithPreset(NEWER_FILE_PRESET));
      await boot;
    }
  });

  it("no-edit variant: closing while the read is in flight WAITS for boot to settle instead of writing the frozen seed — the flush's write reflects the newer on-disk document (M2 restored)", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let resolveRead!: (contents: string) => void;
    let boot: Promise<void> | null = null;
    try {
      vi.mocked(readAutosave).mockImplementation(
        () => new Promise<string | null>((r) => (resolveRead = r)),
      );

      boot = useVizStore.getState().bootDesktopDocument();
      expect(boot).not.toBeNull();

      // User hits the title-bar X (outside the webview) while the read
      // above is still pending: onCloseRequested -> flushAutosave.
      const flushPromise = useVizStore.getState().flushAutosave();
      await Promise.resolve();
      await Promise.resolve();
      // Gated — must NOT have written the frozen seed just because the
      // close fired before the read resolved.
      expect(writeAutosave).not.toHaveBeenCalled();

      resolveRead(autosaveTextWithPreset(NEWER_FILE_PRESET));
      await boot; // no edit raced it, so the guard applies the newer doc (alreadyOnDisk)
      await flushPromise; // the gate now opens and the flush's write proceeds

      expect(useVizStore.getState().presetId).toBe(NEWER_FILE_PRESET);
      expect(writeAutosave).toHaveBeenCalledTimes(1);
      const written = JSON.parse(vi.mocked(writeAutosave).mock.calls[0][0] as string) as {
        document: { presetId: string };
      };
      expect(written.document.presetId).toBe(NEWER_FILE_PRESET); // NOT the stale seed
    } finally {
      resolveRead?.(autosaveTextWithPreset(NEWER_FILE_PRESET));
      await boot;
    }
  });

  it("C1 — a boot read SLOWER THAN THE BOUND does not write stale pre-guard content: the write is SKIPPED, not performed just because the timeout elapsed", async () => {
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

      // The reviewer's exact repro shape: an edit lands while the read is
      // parked, THEN a close/flush races the still-unsettled boot.
      useVizStore.getState().switchPreset(OTHER_PRESET);

      const flushPromise = useVizStore.getState().flushAutosave();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeAutosave).not.toHaveBeenCalled();

      // Past the bound, with the read STILL parked (boot never settled).
      // The pre-C1-fix version of the gate wrote HERE — docOf(get()) was
      // still just the stale seed plus this edit, and bootDesktopDocument's
      // guard had not run at all yet. That write is the bug this test pins.
      await vi.advanceTimersByTimeAsync(10_000);
      await flushPromise;

      expect(writeAutosave).not.toHaveBeenCalled();
      // And because nothing was ever written, there is nothing yet for the
      // (still-pending) boot to find quarantine-worthy when it eventually
      // resolves — quarantine only ever fires from the guard's refusal
      // branch, which hasn't run because the read hasn't resolved.
      expect(quarantineSupersededAutosave).not.toHaveBeenCalled();
    } finally {
      resolveRead?.(null);
      await boot;
      vi.useRealTimers();
    }
  });

  it("C1 — after a skipped write, a later GENUINE settlement re-arms a retry that writes the CORRECT post-guard content — the skip is not a permanent stall", async () => {
    vi.useFakeTimers();
    let resolveRead: ((contents: string | null) => void) | undefined;
    let boot: Promise<void> | null = null;
    try {
      vi.mocked(isTauri).mockReturnValue(true);
      vi.mocked(quarantineSupersededAutosave).mockResolvedValue(QUARANTINE_NAME);
      vi.mocked(readAutosave).mockImplementation(
        () => new Promise<string | null>((r) => (resolveRead = r)),
      );
      boot = useVizStore.getState().bootDesktopDocument();
      useVizStore.getState().switchPreset(OTHER_PRESET);

      // Grab the promise WITHOUT awaiting it yet — under fake timers,
      // directly `await`ing a promise that depends on a timer before any
      // time is advanced deadlocks the test until vitest's own (real) test
      // timeout fires, which then abandons this test's cleanup entirely
      // and corrupts every later test in the file (the exact hazard this
      // block's own top-of-describe comment warns about, just via a
      // different mechanism than a dangling deferred read).
      const firstFlush = useVizStore.getState().flushAutosave();
      await vi.advanceTimersByTimeAsync(10_000); // past the bound — skipped, per the test above
      await firstFlush;
      expect(writeAutosave).not.toHaveBeenCalled();

      // The read finally lands with the TRUE newer content.
      const newerContent = autosaveTextWithPreset(NEWER_FILE_PRESET);
      resolveRead!(newerContent);
      await boot;

      // The guard refuses (the edit still stands) and archives the EXACT
      // bytes just read — not whatever a blind rename would have grabbed
      // off a disk that, in the buggy version, could have already held a
      // premature stale write by now.
      expect(quarantineSupersededAutosave).toHaveBeenCalledWith(newerContent);

      // The skip re-armed scheduleAutosave; advancing past even the
      // longest configurable interval (2-30s) fires the retry.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writeAutosave).toHaveBeenCalledTimes(1);
      const written = JSON.parse(vi.mocked(writeAutosave).mock.calls[0][0] as string) as {
        document: { presetId: string };
      };
      expect(written.document.presetId).toBe(OTHER_PRESET); // the edit, correctly, on the RETRY
    } finally {
      resolveRead?.(null);
      await boot;
      vi.useRealTimers();
    }
  });

  it("M3 — boot already settled: flushAutosave's write proceeds via genuine settlement, not the timeout branch — the gate adds no delay on the happy path", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(null); // resolves immediately -> boot settles fast
    await useVizStore.getState().bootDesktopDocument();
    vi.mocked(writeAutosave).mockClear(); // drop the fallback write boot's own missing-file path just made

    // REAL timers, deliberately: draining only microtasks (never advancing
    // any timer, fake or real) means the CLOSE_FLUSH_TIMEOUT_MS bound
    // cannot possibly have fired yet — real wall-clock time barely moves
    // across a handful of microtask ticks, nowhere near 4000ms. If
    // writeAutosave shows up after only this, it PROVABLY arrived via
    // genuine settlement, not the timeout branch — a stronger claim than
    // "eventually resolves," which would also be true (uselessly) even if
    // the gate silently fell back to the 4-second bound every single time.
    const flushPromise = useVizStore.getState().flushAutosave();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(writeAutosave).toHaveBeenCalledTimes(1);

    await flushPromise;
  });

  it("I1 — quarantine write fails: a notice is STILL raised, naming the source file — not silent, matching the corrupt-file precedent of always surfacing something", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(quarantineSupersededAutosave).mockResolvedValue(null); // the archive write failed
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(NEWER_FILE_PRESET));
    useVizStore.setState({ undoDepth: 1 }); // forces the refusal branch

    await useVizStore.getState().bootDesktopDocument();

    // A silent failure here would mean the gated write later clobbers a
    // file NOTHING protected, with no record to trace it back to.
    expect(useVizStore.getState().supersededNotice).not.toBeNull();
    expect(useVizStore.getState().supersededNotice).toContain("document.bfproj");
    expect(useVizStore.getState().supersededNotice).not.toContain(QUARANTINE_NAME);
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

describe("E2-D2 fix — an in-place custom-shader re-save must be undoable (.superpowers-repro/e2-deepstate-findings.md)", () => {
  // saveCustomPreset (customShaderActions.ts) used to mutate customDefs via a
  // bare set() before any record() — by the time switchPreset()'s own
  // record("preset") ran, the edit was already baked into the "before"
  // snapshot it captured, so Ctrl+Z after re-saving the ACTIVE shader was a
  // silent, permanent no-op. Two independent pieces close it:
  //  (1) saveCustomPreset now wraps its mutation in ctx.asOneGesture
  //      ("shader-save"), which both records BEFORE the mutation AND
  //      suppresses switchPreset's own inner record() — without the
  //      suppression, a re-save of the ALREADY-active shader would still
  //      push a second, redundant "preset" entry whose snapshot already
  //      has the edit baked in (nothing changes customDefs between the two
  //      record() calls), so the FIRST Ctrl+Z would look like a no-op and
  //      only a second one would actually restore the old WGSL.
  //  (2) undo()/redo() (projectIOActions.ts) pass applyDocument the new
  //      `fromHistory` flag, which bypasses mergeEmbeddedDefs' S1 "keep the
  //      local edit" protection (custom.ts) — a CORRECT pre-edit snapshot
  //      still could not win against the (by-then newer) in-memory def once
  //      applied, because S1 was written to protect a local edit against an
  //      OLDER file on project-open, and treated a same-session history
  //      snapshot exactly the same way.
  const ID = "custom-e2d2-fix";
  const V1 = "fn preset(uv: vec2f) -> vec3f { return vec3f(1.0); } // VERSION ONE";
  const V2 = "fn preset(uv: vec2f) -> vec3f { return vec3f(0.5); } // VERSION TWO";

  afterEach(() => {
    clearHistory();
    unregisterCustomPreset(ID);
  });

  it("Ctrl+Z after re-saving the ACTIVE shader restores the previous WGSL in exactly one step; redo brings the edit back", async () => {
    clearHistory();
    useVizStore.setState({ checkCustomPreset: vi.fn(async () => []) });
    const store = () => useVizStore.getState();

    // Import a new shader — becomes the active preset via switchPreset.
    const err1 = await store().saveCustomPreset({ id: ID, name: "Mine", params: [], wgsl: V1 });
    expect(err1).toEqual([]);
    expect(store().presetId).toBe(ID);
    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(V1);

    // Edit the WGSL and save again — same id, the in-place re-save path
    // (ShaderEditor.tsx's Save button).
    const err2 = await store().saveCustomPreset({ id: ID, name: "Mine", params: [], wgsl: V2 });
    expect(err2).toEqual([]);
    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(V2);
    // Two discrete saves, back to back with no delay between them — this is
    // 2 (not 1) only if "shader-save" resists the 800ms gesture-grouping
    // window (history.ts UNGROUPABLE), and 2 (not 3) only if asOneGesture
    // actually suppressed switchPreset's own inner record() on both calls.
    expect(store().undoDepth).toBe(2);

    store().undo();
    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(V1); // fixed: ONE Ctrl+Z, not two, not never
    expect(store().presetId).toBe(ID);

    store().redo();
    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(V2);
    expect(store().presetId).toBe(ID);
  });

  it("a project OPEN still keeps the local edit — S1's original protection is untouched by the history exemption", async () => {
    clearHistory();
    useVizStore.setState({ checkCustomPreset: vi.fn(async () => []) });
    const store = () => useVizStore.getState();
    const EDITED =
      "fn preset(uv: vec2f) -> vec3f { return vec3f(0.5); } // EDITED LOCALLY, NOT YET RE-EMBEDDED";
    const OLDER =
      "fn preset(uv: vec2f) -> vec3f { return vec3f(1.0); } // WHAT THE INCOMING FILE STILL HAS";

    await store().saveCustomPreset({ id: ID, name: "Mine", params: [], wgsl: EDITED });
    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(EDITED);

    const incoming = validateDocument({
      presetId: ID,
      customDefs: [{ id: ID, name: "Mine", params: [], wgsl: OLDER }],
    });
    store().openProjectText("older-project.bfproj", serializeProject(incoming, "test"));

    // openProjectText -> applyDocument never passes fromHistory — S1 keeps
    // the local (newer) edit exactly as it did before this fix.
    expect(store().customDefs.find((d) => d.id === ID)?.wgsl).toBe(EDITED);
  });
});
