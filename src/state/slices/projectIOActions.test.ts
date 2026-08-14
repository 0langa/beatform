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

  it("desktop, autosave parses: becomes the boot document — preferred over the localStorage-sourced state already loaded", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    expect(useVizStore.getState().presetId).not.toBe(OTHER_PRESET); // sanity: really a change

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
    // Just read this exact content from disk — nothing has changed that
    // would need re-establishing it.
    expect(writeAutosave).not.toHaveBeenCalled();
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

describe("recovery-flow reconciliation — a passive notice replaces the Restore/Discard prompt (P-11 Task 4)", () => {
  it("previous exit unclean + the autosave applies: fires the same one-time notice restoreAutosave() used to", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET);
    expect(useVizStore.getState().notice).toBe("Recovered your work from the last session");
  });

  it("previous exit was clean: silent even though the autosave still applies — this is the common path, every ordinary launch", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(true);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().presetId).toBe(OTHER_PRESET); // still preferred — Task 2's rule is unconditional
    expect(useVizStore.getState().notice).toBeNull();
  });

  it("previous exit unclean but the autosave is missing (fallback path): no notice — nothing was actually recovered, it's an ordinary cache boot", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(null);

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().notice).toBeNull();
  });

  it("previous exit unclean, autosave parses, but the anti-clobber guard skipped applying it: no notice either — nothing was applied", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(wasPreviousExitClean).mockReturnValue(false);
    vi.mocked(readAutosave).mockResolvedValue(autosaveTextWithPreset(OTHER_PRESET));
    useVizStore.setState({ undoDepth: 1 });

    await useVizStore.getState().bootDesktopDocument();

    expect(useVizStore.getState().notice).toBeNull();
  });

  it("recoveredDoc/restoreAutosave/dismissAutosave no longer exist on VizState — the interactive prompt's machinery is gone, not just unreachable", () => {
    const s = useVizStore.getState() as unknown as Record<string, unknown>;
    expect(s.recoveredDoc).toBeUndefined();
    expect(s.restoreAutosave).toBeUndefined();
    expect(s.dismissAutosave).toBeUndefined();
  });
});
