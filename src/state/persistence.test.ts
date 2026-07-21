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
    // The boot sequence dirties the marker almost immediately (applyDocument →
    // scheduleAutosave). If the flag were re-read later it would always say
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
