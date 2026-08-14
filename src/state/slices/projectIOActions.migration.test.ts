import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P-11 whole-lane-review fix I5 — the migration matrix's missing column.
 *
 * `projectIOActions.test.ts`'s "autosave missing" case seeds NOTHING into
 * localStorage (that file's shared `localStorage.getItem: () => null` stub
 * means the synchronous initial state is always plain defaults), so it can
 * only prove `writeAutosave` was CALLED — not that the payload actually
 * carries real, distinguishable localStorage-sourced content. This is the
 * localStorage-PRESENT column: a real (fake) localStorage seeded with a
 * distinct preset id, autosave missing, and the assertion is on the WRITE
 * PAYLOAD's content, not the call count — using the resetModules +
 * fresh-import pattern `desktopPersistenceGate.test.ts`/`storageQuota.test.ts`
 * already established for exactly this "needs a real synchronous boot read"
 * shape.
 */

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
    isTauri: vi.fn(() => true),
    readAutosave: vi.fn(async () => null), // missing — the column under test
    writeAutosave: vi.fn(async () => {}),
  };
});

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

function installSeededStorage(seed: Record<string, string>): void {
  const storage = new FakeStorage();
  for (const [k, v] of Object.entries(seed)) storage.setItem(k, v);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
}

beforeEach(() => {
  vi.resetModules();
});

describe("boot-source matrix — localStorage PRESENT × autosave MISSING (I5)", () => {
  it("the fallback write-back's payload carries the REAL localStorage-sourced content, not just a call", async () => {
    // A distinct, real preset seeded into localStorage BEFORE store.ts's
    // module-scope synchronous read runs — exactly what an existing
    // pre-P-11 install's session cache looks like.
    installSeededStorage({ "viz.activePreset": "particle-flow" });

    const { useVizStore } = await import("../store");
    const { writeAutosave } = await import("../platform");
    // As in autosaveTiming.test.ts: vi.resetModules() alone does not
    // guarantee a fresh vi.fn() from the vi.mock() factory above — observed
    // directly here too (the SECOND test's payload assertion saw the FIRST
    // test's leftover call without this). Clear explicitly rather than trust it.
    vi.mocked(writeAutosave).mockClear();

    // Sanity: the synchronous boot really did pick up the seeded value —
    // if this fails, the assertion below would be checking a payload that
    // never depended on localStorage in the first place.
    expect(useVizStore.getState().presetId).toBe("particle-flow");

    await useVizStore.getState().bootDesktopDocument();

    expect(writeAutosave).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(writeAutosave).mock.calls[0][0];
    const parsed = JSON.parse(payload) as { document: { presetId: string } };
    expect(parsed.document.presetId).toBe("particle-flow");
  });

  it("a DIFFERENT seeded preset produces a DIFFERENT payload — the assertion above is not coincidentally satisfied by a default", async () => {
    installSeededStorage({ "viz.activePreset": "spectrum-bars" });

    const { useVizStore } = await import("../store");
    const { writeAutosave } = await import("../platform");
    // As in autosaveTiming.test.ts: vi.resetModules() alone does not
    // guarantee a fresh vi.fn() from the vi.mock() factory above — observed
    // directly here too (the SECOND test's payload assertion saw the FIRST
    // test's leftover call without this). Clear explicitly rather than trust it.
    vi.mocked(writeAutosave).mockClear();
    expect(useVizStore.getState().presetId).toBe("spectrum-bars");

    await useVizStore.getState().bootDesktopDocument();

    const payload = vi.mocked(writeAutosave).mock.calls[0][0];
    const parsed = JSON.parse(payload) as { document: { presetId: string } };
    expect(parsed.document.presetId).toBe("spectrum-bars");
  });
});
