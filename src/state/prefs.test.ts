import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * App prefs blob (`beatform.prefs.v1`).
 *
 * The blob is read ONCE at module load, so every case here re-imports the
 * module with a freshly seeded store — same discipline as persistence.test.ts.
 *
 * What is actually being defended: an existing user must not lose settings by
 * upgrading into a build that added a field, and a corrupt value for the new
 * field must not take the rest of the blob down with it.
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

const KEY = "beatform.prefs.v1";

function seed(raw: string | undefined): FakeStorage {
  const s = new FakeStorage();
  if (raw !== undefined) s.setItem(KEY, raw);
  vi.stubGlobal("localStorage", s);
  vi.stubGlobal("window", { addEventListener: () => {} });
  return s;
}

async function importFresh() {
  vi.resetModules();
  return await import("./prefs");
}

describe("prefs: presetOrder", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a blob written before the field existed, keeping its settings", async () => {
    // Exactly what a v2.56 install has on disk: no presetOrder key at all.
    seed(JSON.stringify({ volume: 0.42, panelWidth: 331, switchQuantize: "bar" }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().volume).toBe(0.42);
    expect(getPrefs().panelWidth).toBe(331);
    expect(getPrefs().switchQuantize).toBe("bar");
    // Absent means "never customised", which resolves to the shipped order.
    expect(getPrefs().presetOrder).toEqual([]);
  });

  it("round-trips a stored order", async () => {
    seed(JSON.stringify({ presetOrder: ["aurora", "synthwave"] }));
    const { getPrefs, setPrefs } = await importFresh();
    expect(getPrefs().presetOrder).toEqual(["aurora", "synthwave"]);
    setPrefs({ presetOrder: ["synthwave", "aurora"] });
    expect(getPrefs().presetOrder).toEqual(["synthwave", "aurora"]);
  });

  it("survives a corrupt value without losing the rest of the blob", async () => {
    // A string where a list belongs — a hand-edited blob, or a future schema.
    seed(`{"volume":0.3,"presetOrder":"spectrum-bars"}`);
    const { getPrefs } = await importFresh();
    expect(getPrefs().presetOrder).toEqual([]);
    expect(getPrefs().volume).toBe(0.3);
  });

  it("drops non-string entries rather than storing them", async () => {
    seed(`{"presetOrder":["aurora",7,null,"synthwave"]}`);
    const { getPrefs } = await importFresh();
    expect(getPrefs().presetOrder).toEqual(["aurora", "synthwave"]);
  });
});
