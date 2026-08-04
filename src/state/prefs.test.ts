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

describe("prefs: performance overlay", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults OFF with the documented config on a blob that predates it", async () => {
    seed(JSON.stringify({ volume: 0.5 }));
    const { getPrefs } = await importFresh();
    const p = getPrefs();
    expect(p.perfOverlay).toBe(false);
    expect(p.perfOverlayCorner).toBe("top-left");
    expect(p.perfOverlaySize).toBe("m");
    expect(p.perfOverlayColor).toBe("accent");
    expect(p.perfOverlayStats).toEqual({
      fps: true,
      frameTime: true,
      renderer: true,
      jsHeap: true,
      cpu: true,
      ram: true,
      disk: false,
      gpu: false,
    });
    // The rest of the blob is untouched.
    expect(p.volume).toBe(0.5);
  });

  it("round-trips a customised overlay config", async () => {
    seed(undefined);
    const { getPrefs, setPrefs } = await importFresh();
    setPrefs({
      perfOverlay: true,
      perfOverlayCorner: "bottom-right",
      perfOverlaySize: "l",
      perfOverlayColor: "green",
      perfOverlayStats: { ...getPrefs().perfOverlayStats, disk: true, fps: false },
    });
    const p = getPrefs();
    expect(p.perfOverlay).toBe(true);
    expect(p.perfOverlayCorner).toBe("bottom-right");
    expect(p.perfOverlaySize).toBe("l");
    expect(p.perfOverlayColor).toBe("green");
    expect(p.perfOverlayStats.disk).toBe(true);
    expect(p.perfOverlayStats.fps).toBe(false);
    expect(p.perfOverlayStats.cpu).toBe(true);
  });

  it("degrades corrupt overlay values to defaults without losing the blob", async () => {
    seed(
      `{"volume":0.3,"perfOverlay":"yes","perfOverlayCorner":"middle","perfOverlaySize":"xl","perfOverlayColor":"magenta","perfOverlayStats":"all"}`,
    );
    const { getPrefs } = await importFresh();
    const p = getPrefs();
    expect(p.perfOverlay).toBe(false);
    expect(p.perfOverlayCorner).toBe("top-left");
    expect(p.perfOverlaySize).toBe("m");
    expect(p.perfOverlayColor).toBe("accent");
    expect(p.perfOverlayStats.fps).toBe(true);
    expect(p.volume).toBe(0.3);
  });

  it("notifies subscribers on setPrefs and stops after unsubscribe", async () => {
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    const unsub = subscribePrefs(() => {
      calls++;
    });
    setPrefs({ perfOverlay: true });
    expect(calls).toBe(1);
    // A new snapshot object per write — what useSyncExternalStore keys on.
    expect(getPrefs()).not.toBe(before);
    unsub();
    setPrefs({ perfOverlay: false });
    expect(calls).toBe(1);
  });
});
