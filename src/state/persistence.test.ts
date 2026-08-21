import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Crash-recovery marker semantics.
 *
 * The whole feature hinges on one question: "did the last session exit
 * cleanly?" Get it wrong in one direction and a crash silently loses work; get
 * it wrong in the other and every ordinary launch nags about recovery. The
 * marker is read ONCE at module load, so each case here has to re-import the
 * module with a freshly seeded store.
 */

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const KEY = "viz.cleanExit";

function installStorage(seed?: string): FakeStorage {
  const s = new FakeStorage();
  if (seed !== undefined) s.setItem(KEY, seed);
  vi.stubGlobal("localStorage", s);
  // persistence.ts registers pagehide/visibilitychange listeners at import.
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  return s;
}

async function importFresh() {
  vi.resetModules();
  return await import("./persistence");
}

describe("clean-exit marker", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a first-ever launch as clean (no marker, no autosave to offer)", async () => {
    installStorage();
    const { wasPreviousExitClean } = await importFresh();
    expect(wasPreviousExitClean()).toBe(true);
  });

  it("treats a session that exited cleanly as clean", async () => {
    installStorage("1");
    const { wasPreviousExitClean } = await importFresh();
    expect(wasPreviousExitClean()).toBe(true);
  });

  it("treats a session killed mid-edit as UNCLEAN — this is the recovery case", async () => {
    installStorage("0");
    const { wasPreviousExitClean } = await importFresh();
    expect(wasPreviousExitClean()).toBe(false);
  });

  it("markSessionDirty persists '0' synchronously, so a hard kill can't outrun it", async () => {
    const store = installStorage("1");
    const { markSessionDirty } = await importFresh();
    markSessionDirty();
    expect(store.getItem(KEY)).toBe("0");
  });

  it("keeps reporting the PREVIOUS exit after this session dirties the marker", async () => {
    // An ordinary edit dirties the marker almost immediately (record() →
    // scheduleAutosave — bootDesktopDocument's OWN apply is the one
    // deliberate exception, see the P-11 fix M2 note at this const's
    // declaration). If the flag were re-read later it would always say
    // "clean" and recovery would never fire.
    installStorage("0");
    const { wasPreviousExitClean, markSessionDirty } = await importFresh();
    markSessionDirty();
    expect(wasPreviousExitClean()).toBe(false);
  });

  it("survives a storage that throws (private mode / quota)", async () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("window", { addEventListener: () => {} });
    vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
    const { wasPreviousExitClean, markSessionDirty } = await importFresh();
    // Degrades to "never offer recovery" rather than throwing during boot.
    expect(wasPreviousExitClean()).toBe(true);
    expect(() => markSessionDirty()).not.toThrow();
  });
});

/**
 * The document-schema stamp — insurance for the NEXT semantics change.
 *
 * Nothing reads `cachedDocSchema` this release. It exists so that a future
 * migration CAN, and the only property that makes it worth anything is the
 * ORDER: the prior value is captured at module load, before this session's own
 * stamp overwrites the key. A stamp read after it has been refreshed is
 * worthless, and the failure is completely silent — hence these tests.
 */
describe("document-schema stamp (viz.docSchema.v1)", () => {
  const SCHEMA_KEY = "viz.docSchema.v1";

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // D1. MUTATION: move the stampDocSchema() call ABOVE the cachedDocSchema
  // read. REACHABLE because the seeded 13 differs from the stamped
  // PROJECT_VERSION — a read-after-write reports 14 and the first assertion
  // fails. (Seeding the CURRENT version instead would make this vacuous.)
  it("D1: captures the PRIOR stamp before overwriting it with this app's version", async () => {
    const store = installStorage();
    store.setItem(SCHEMA_KEY, "13");
    const { cachedDocSchema } = await importFresh();
    const { PROJECT_VERSION } = await import("./project");
    expect(cachedDocSchema).toBe(13);
    expect(store.getItem(SCHEMA_KEY)).toBe(String(PROJECT_VERSION));
    expect(store.getItem(SCHEMA_KEY)).toBe("14");
  });

  // D2. MUTATION: `?? PROJECT_VERSION` (or any other non-null default) on the
  // absent branch. REACHABLE because null and 14 are distinguishable, and the
  // distinction is the contract: null means UNKNOWN PROVENANCE — never
  // migrate — because v14 shipped with no stamp at all. A default of
  // PROJECT_VERSION would tell a future migration "already current" and skip
  // it forever; a default of 0 would tell it "ancient" and migrate a cache
  // that may already be correct. Only null is honest.
  it("D2: an absent stamp reads as null, never as a version number", async () => {
    const store = installStorage();
    const { cachedDocSchema } = await importFresh();
    expect(cachedDocSchema).toBeNull();
    // ...and this session still stamps, so the NEXT boot has provenance.
    expect(store.getItem(SCHEMA_KEY)).toBe("14");
  });

  it("D2b: a garbage stamp reads as null too — unknown, not 'very old'", async () => {
    const store = installStorage();
    store.setItem(SCHEMA_KEY, "not-a-number");
    const { cachedDocSchema } = await importFresh();
    expect(cachedDocSchema).toBeNull();
  });

  // D3. MUTATION: gate anything on stampDocSchema()'s return value, or let the
  // write failure propagate out of module init. REACHABLE because the stub
  // throws on every setItem, so a propagating failure kills the import (and
  // with it every other persistence consumer) at boot.
  it("D3: a failed stamp write is completely inert — no throw, no retry, no gate", async () => {
    const seeded = new Map([[SCHEMA_KEY, "13"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => seeded.get(k) ?? null,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem() {},
    });
    vi.stubGlobal("window", { addEventListener: () => {} });
    vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

    // Importing the module runs stampDocSchema() at module scope.
    const mod = await importFresh();
    expect(mod.stampDocSchema()).toBe(false);
    // The prior value is still what it was: nothing was written, so the next
    // boot sees the same "13" and a future migration is merely postponed —
    // identical to today's behaviour, never wrong behaviour.
    expect(mod.cachedDocSchema).toBe(13);
  });
});

/**
 * D4. The DELIBERATE non-migration, pinned.
 *
 * This is a decision, not an oversight. Schema v14 changed the meaning of
 * Kaleido Nebula's `saturation`, and .bfproj / .bftheme both remap stored
 * pre-v14 values. This localStorage cache does NOT — and must not — because of
 * TIMING: v14 shipped in 2.75.0 without any schema stamp, so an unstamped
 * `viz.params.v1` may hold a pre-v14 value (which would want /0.75) or a value
 * the user has re-tuned by hand since (which must be left alone), and nothing
 * on disk tells them apart — the same stored 1.0 is a pre-v14 ceiling and a
 * post-v14 neutral. Migrating now would turn a 21% desaturation into a 33%
 * OVERsaturation for exactly the users who already fixed it themselves.
 *
 * MUTATION: add a nebula-saturation remap to loadStoredParams. REACHABLE
 * because 0.75 is not a fixed point of v / 0.75 — it becomes 1.
 */
describe("the session cache deliberately does NOT ride the v14 remap", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("D4: a cached nebula saturation loads verbatim, whatever schema wrote it", async () => {
    const store = installStorage();
    store.setItem("viz.params.v1", JSON.stringify({ nebula: { saturation: 0.75 } }));
    const { loadStoredParams } = await importFresh();
    expect(loadStoredParams().nebula.saturation).toBe(0.75);
  });
});

describe("legacy preset ids in the session cache", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps legacy preset ids in every cached site (v13 rename: starfield -> particles)", async () => {
    // The "last session" cache outlives app updates, so a user who quit on
    // the Particles mode before the rename must reopen on it — with their
    // params/sync/mods/backgrounds/scenes intact — not on a defaulted mode.
    const store = installStorage();
    store.setItem("viz.activePreset", "starfield");
    store.setItem("viz.params.v1", JSON.stringify({ starfield: { density: 19, size: 0.22 } }));
    store.setItem("viz.sync.v1", JSON.stringify({ starfield: { mode: "kick", smooth: 0.4 } }));
    store.setItem(
      "viz.mods.v1",
      JSON.stringify({
        starfield: [{ id: "m1", source: "kick", param: "beatDance", amount: 0.4 }],
      }),
    );
    store.setItem(
      "viz.bgByPreset.v1",
      JSON.stringify({ starfield: { mode: 1, color: [0.1, 0.1, 0.1] } }),
    );
    store.setItem("viz.centerImages.v1", JSON.stringify({ starfield: "as-1" }));
    store.setItem(
      "viz.timeline.v1",
      JSON.stringify({
        enabled: true,
        scenes: [{ id: "sc-1", name: "Drop", presetId: "starfield", start: 30 }],
        lanes: [],
      }),
    );
    const assets = {
      "as-1": { id: "as-1", name: "x.png", dataUrl: "data:image/png;base64,AA==" },
    };
    const mod = await importFresh();
    expect(mod.loadStoredPresetId()).toBe("particles");
    expect(mod.loadStoredParams()).toEqual({ particles: { density: 19, size: 0.22 } });
    expect(mod.loadStoredSync().particles?.mode).toBe("kick");
    expect(mod.loadStoredSync().starfield).toBeUndefined();
    expect(mod.loadStoredMods().particles).toHaveLength(1);
    expect(mod.loadStoredBgByPreset(assets).particles?.mode).toBe(1);
    expect(mod.loadStoredCenterImages(assets)).toEqual({ particles: "as-1" });
    expect(mod.loadStoredTimeline().scenes.map((s) => s.presetId)).toEqual(["particles"]);
  });
});

/**
 * P-11 whole-lane-review fix C1 — the best-effort half of the close-flush.
 * `onCloseRequested` (store.ts) is the AWAITED, primary defense; this is the
 * net for whatever it doesn't cover (see setAutosaveFlushOnPagehide's own
 * comment). `installStorage`'s shared `window.addEventListener: () => {}`
 * stub can't prove a registered handler actually RUNS — it's a no-op by
 * design, used only by tests that need pagehide registration to not throw.
 * This describe needs to CAPTURE and INVOKE the handler, so it builds its
 * own.
 */
describe("autosave flush registration on pagehide", () => {
  function installCapturingStorage(): {
    store: FakeStorage;
    firePagehide: () => void;
  } {
    const store = new FakeStorage();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("window", {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    });
    vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
    return {
      store,
      firePagehide: () => listeners.get("pagehide")?.(),
    };
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires the registered callback on pagehide, alongside the existing localStorage flush", async () => {
    const { store, firePagehide } = installCapturingStorage();
    const mod = await importFresh();
    const flush = vi.fn();
    mod.setAutosaveFlushOnPagehide(flush);

    firePagehide();

    expect(flush).toHaveBeenCalledTimes(1);
    // The pre-existing behavior this must not have disturbed: the clean-exit
    // marker still flips to "1" on the SAME pagehide.
    expect(store.getItem("viz.cleanExit")).toBe("1");
  });

  it("no callback registered: pagehide still runs its existing work without throwing", async () => {
    const { firePagehide } = installCapturingStorage();
    await importFresh();
    expect(firePagehide).not.toThrow();
  });
});

/**
 * R2-31h: loadStoredPresetId / loadStoredAspect / loadStoredSmoothSpectrum
 * were the only loaders reading localStorage raw (everything else routes
 * through readJson's try/catch), and all three run at store-module scope —
 * blocked storage (privacy mode, a hostile embedder) threw during boot and
 * white-screened the app before anything rendered. Blocked reads as absent.
 */
describe("module-scope loaders survive blocked storage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("a throwing localStorage yields the defaults instead of a boot crash", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError: storage is disabled");
      },
      setItem: () => {
        throw new Error("SecurityError: storage is disabled");
      },
      removeItem: () => {},
    });
    vi.stubGlobal("window", { addEventListener: () => {} });
    vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
    const mod = await importFresh();

    expect(mod.loadStoredPresetId()).toBeNull();
    expect(mod.loadStoredAspect()).toBe("free");
    expect(mod.loadStoredSmoothSpectrum()).toBe(false);
  });
});
