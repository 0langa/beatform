import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * P-11 Task 3 — the SS-2 absence pin. Hard Requirement 6, verbatim: "no
 * desktop path writes the document to localStorage — grep-proven, and a
 * test pins the absence (a boot + edit session on the desktop path performs
 * zero document-key localStorage writes)." The grep proof is the 16
 * `if (isTauri()) return[ true];` guards in persistence.ts (one per
 * `ProjectDocument`-backing key, minus `saveCustomPresets`, the one
 * exemption: the shader LIBRARY
 * is not the document, and the autosave embeds only the defs the document
 * references, so that key keeps writing on desktop — pinned by the last two
 * describes below); this file is the runtime pin, plus the browser-path
 * control that proves the pin is actually discriminating rather than
 * vacuously green.
 *
 * A RECORDING storage, not `storageQuota.test.ts`'s throwing `QuotaStorage`
 * — that file proves a failed write doesn't crash the app; this one proves
 * desktop writes are never ATTEMPTED, which needs to see every key that WAS
 * touched, not just survive the ones that weren't.
 */

class RecordingStorage {
  written = new Set<string>();
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.written.add(k);
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

/**
 * The 16 gated `ProjectDocument`-backing keys (Task 1's 17 minus
 * `viz.customPresets.v1`, which is exempt — see the header). Kept as
 * literals rather than imported, same reasoning `persistenceFuzz.test.ts`'s
 * own `KEYS` list gives: persistence.ts's `LS_*` consts are private, and a
 * key string is itself a persisted-format contract worth pinning by name.
 * Deliberately excludes the 5 real keys that are NOT part of the document
 * (`viz.exportSettings.v1`, `viz.midiBindings.v1`, the `viz.docSchema.v1`
 * stamp, `viz.cleanExit`, `beatform.prefs.v1`) — those are expected to keep
 * writing on desktop, proven directly in the browser-control test below by
 * omission (this list would fail if any leaked in unexpectedly)... and,
 * because "nothing new was gated" is just as important a claim as "the 17
 * were", the control test also positively re-touches a couple of them.
 */
const DOCUMENT_KEYS = [
  "viz.activePreset",
  "viz.params.v1",
  "viz.sync.v1",
  "viz.bg.v1",
  "viz.bgByPreset.v1",
  "viz.centerImages.v1",
  "viz.overlay.v1",
  "viz.aspect.v1",
  "viz.mods.v1",
  "viz.smoothSpectrum",
  "viz.timeline.v1",
  "viz.post.v1",
  "viz.motion.v1",
  "viz.lyricStyle.v1",
  "viz.audiogram.v1",
  "viz.builderStack.v1",
] as const;

function installGlobals(storage: RecordingStorage): void {
  vi.stubGlobal("localStorage", storage);
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

// Default true (desktop) — the browser-control test overrides this per-import.
vi.mock("./platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform")>();
  return {
    ...actual,
    isTauri: vi.fn(() => true),
    writeAutosave: vi.fn(async () => {}),
    // The relaunch test at the bottom hands bootDesktopDocument a real autosave.
    readAutosave: vi.fn(async () => null),
  };
});

// Generous budget: re-imports the real store graph, same as
// storageQuota.test.ts's analogous describe under parallel worker load.
describe(
  "SS-2 absence pin — desktop never writes the document to localStorage (P-11 Task 3)",
  { timeout: 30_000 },
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("a boot + edit session performs zero document-key localStorage writes", async () => {
      const storage = new RecordingStorage();
      installGlobals(storage);
      vi.resetModules();
      const { useVizStore } = await import("./store");

      // One real, undo-recorded edit through each family the plan's Task 1
      // map found writing a document key — switchPreset (presetId),
      // setParam (params), setSmoothSpectrum, setAspect — plus undo/redo,
      // which is where MOST of the 17 savers fire in one shot
      // (applyDocument). Not exhaustive over every one of the ~50 call
      // sites Task 1 found; the 17 persistence.ts guards are what makes a
      // call-site-by-call-site audit unnecessary — this is the "a boot +
      // edit session" the requirement's own wording asks for.
      const s = useVizStore.getState();
      const other = s.presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";
      s.switchPreset(other);
      s.setParam("test-param", 0.42);
      s.setSmoothSpectrum(!s.smoothSpectrum);
      s.setAspect("16:9");
      s.undo();
      s.redo();

      const hit = [...storage.written].filter((k) =>
        (DOCUMENT_KEYS as readonly string[]).includes(k),
      );
      expect(hit).toEqual([]);
    });

    it("control: the identical session on the BROWSER build writes every touched document key — proves the pin is a real gate, not a vacuously-passing one", async () => {
      const storage = new RecordingStorage();
      installGlobals(storage);
      vi.resetModules();
      const platform = await import("./platform");
      vi.mocked(platform.isTauri).mockReturnValue(false);
      const { useVizStore } = await import("./store");

      vi.useFakeTimers();
      try {
        const s = useVizStore.getState();
        const other = s.presetId === "spectrum-bars" ? "particle-flow" : "spectrum-bars";
        s.switchPreset(other);
        s.setParam("test-param", 0.42); // saveStoredParams is trailing-debounced (persistence.ts's scheduleWrite)
        s.setSmoothSpectrum(!s.smoothSpectrum);
        s.setAspect("16:9");
        // Past the 200ms trailing-write debounce, short of the 5s autosave one.
        await vi.advanceTimersByTimeAsync(250);
      } finally {
        vi.useRealTimers();
      }

      expect(storage.written.has("viz.activePreset")).toBe(true);
      expect(storage.written.has("viz.params.v1")).toBe(true);
      expect(storage.written.has("viz.smoothSpectrum")).toBe(true);
      expect(storage.written.has("viz.aspect.v1")).toBe(true);
    });
  },
);

describe("the boolean-returning savers on desktop (P-11 Task 3, with the shader-library exemption)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saveStoredOverlay returns true on desktop even though it writes nothing — a false would fire a false 'too large to remember' toast; saveCustomPresets is EXEMPT: it writes, and reports the real result", async () => {
    // M1 (whole-lane review): keep the storage reference and assert the
    // overlay key is genuinely UNWRITTEN, not just that the return value
    // looks right — the pin session that gates SS-2 absence (above) never
    // actually exercises these two, since neither is on its edit path.
    // Without this, a bug that returns the right boolean while still
    // calling through to safeSetItem underneath would pass silently.
    const storage = new RecordingStorage();
    installGlobals(storage);
    vi.resetModules();
    const platform = await import("./platform");
    vi.mocked(platform.isTauri).mockReturnValue(true);
    const p = await import("./persistence");

    expect(p.saveStoredOverlay([], {})).toBe(true);
    expect(storage.written.has("viz.overlay.v1")).toBe(false);

    // The exemption: the shader LIBRARY is not a document field — the
    // autosave embeds only the defs the document references, so gating this
    // key lost every unreferenced shader at relaunch (saveCustomPresets' own
    // comment). It writes on desktop and returns safeSetItem's REAL result,
    // so the "too large to remember" toast stays honest here too.
    expect(p.saveCustomPresets([])).toBe(true);
    expect(storage.written.has("viz.customPresets.v1")).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(p.saveCustomPresets([])).toBe(false);
    warn.mockRestore();
  });

  it("control: both still return the safeSetItem-shaped boolean in the browser build", async () => {
    const storage = new RecordingStorage();
    installGlobals(storage);
    vi.resetModules();
    const platform = await import("./platform");
    vi.mocked(platform.isTauri).mockReturnValue(false);
    const p = await import("./persistence");

    expect(p.saveStoredOverlay([], {})).toBe(true);
    expect(storage.written.has("viz.overlay.v1")).toBe(true);
    expect(p.saveCustomPresets([])).toBe(true);
    expect(storage.written.has("viz.customPresets.v1")).toBe(true);
  });
});

/**
 * The exemption's reason, end to end: a shader the document does not
 * reference is nowhere in the autosave .bfproj, so on desktop the library key
 * is its ONLY persistence. With saveCustomPresets gated to a no-op (returning
 * true, so the "saved" toast still showed) and loadCustomPresets reading a key
 * nothing ever wrote: import shader A, import shader B (active), quit,
 * relaunch — A was gone; switch to a built-in before quitting and B was too.
 */
describe("the shader library survives a desktop relaunch (the saveCustomPresets exemption)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an unreferenced library def and the autosave's own active def are BOTH present after boot, and the merged library is written back", async () => {
    const storage = new RecordingStorage();
    installGlobals(storage);
    vi.resetModules();
    const platform = await import("./platform");
    vi.mocked(platform.isTauri).mockReturnValue(true);
    const { NEW_SHADER_TEMPLATE, unregisterCustomPreset } =
      await import("../render/presets/custom");
    const { presetById } = await import("../render/presets");
    const { serializeProject, validateDocument } = await import("./project");
    const defA = {
      id: "custom-libonly",
      name: "A (library only)",
      params: [],
      wgsl: NEW_SHADER_TEMPLATE,
    };
    const defB = {
      id: "custom-autosaved",
      name: "B (active)",
      params: [],
      wgsl: NEW_SHADER_TEMPLATE,
    };
    // What the previous session left behind: the library with A (no longer
    // referenced by the document) and the autosave written with B active.
    // B is unregistered again after building the file — a fresh process
    // knows nothing until the file is parsed.
    storage.setItem("viz.customPresets.v1", JSON.stringify([defA]));
    const autosave = serializeProject(
      validateDocument({ presetId: defB.id, customDefs: [defB] }),
      "test",
    );
    unregisterCustomPreset(defB.id);
    vi.mocked(platform.readAutosave).mockResolvedValue(autosave);
    const { useVizStore } = await import("./store");

    try {
      await useVizStore.getState().bootDesktopDocument();

      const s = useVizStore.getState();
      expect(s.customDefs.map((d) => d.id).sort()).toEqual([defA.id, defB.id].sort());
      expect(s.presetId).toBe(defB.id);
      // Both resolve — neither is presetById's default-mode fallback.
      expect(presetById(defA.id).id).toBe(defA.id);
      expect(presetById(defB.id).id).toBe(defB.id);
      // And the merged library went back to the key the NEXT relaunch reads.
      const persisted = JSON.parse(storage.getItem("viz.customPresets.v1")!) as { id: string }[];
      expect(persisted.map((d) => d.id).sort()).toEqual([defA.id, defB.id].sort());
    } finally {
      unregisterCustomPreset(defA.id);
      unregisterCustomPreset(defB.id);
    }
  });
});
