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

/**
 * A write that changes nothing must not look like a change.
 *
 * `validPrefs` allocates a fresh blob unconditionally, so before the guard
 * every setPrefs produced a new `getPrefs()` reference and woke every
 * useSyncExternalStore reader. Redundant writes are ordinary: the Escape
 * cascade calls setShowPanel(false) unguarded (so every Escape with nothing
 * open re-rendered App), a resize drag that ends where it started re-writes
 * panelWidth, and the Preferences dialog mirrors back the value it just read.
 */
describe("prefs: no-op writes", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not fire listeners and keeps the same object for a no-op patch", async () => {
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    // Same value as the default.
    expect(setPrefs({ panelOpen: false })).toBe(before);
    // The whole blob, re-applied.
    expect(setPrefs({ ...before })).toBe(before);
    // The empty patch.
    expect(setPrefs({})).toBe(before);
    expect(calls).toBe(0);
    expect(getPrefs()).toBe(before);
  });

  it("still fires for a real change, then goes quiet when it is re-applied", async () => {
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    setPrefs({ panelWidth: 331 });
    expect(calls).toBe(1);
    expect(getPrefs().panelWidth).toBe(331);
    setPrefs({ panelWidth: 331 });
    expect(calls).toBe(1);
    setPrefs({ panelWidth: 332 });
    expect(calls).toBe(2);
  });

  it("compares list fields by CONTENT, not identity", async () => {
    // validPrefs rebuilds collapsedSections/presetOrder on every call, so an
    // identity comparison would never see a no-op here.
    // Group keys, not bare section ids: P-1 prunes anything without the
    // "group:" prefix, so a bare id would leave this asserting on an empty
    // list and prove nothing about the comparison.
    seed(
      JSON.stringify({
        collapsedSections: ["group:shape", "group:glow"],
        presetOrder: ["aurora", "nebula"],
      }),
    );
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    // Fresh arrays, same contents.
    expect(setPrefs({ collapsedSections: ["group:shape", "group:glow"] })).toBe(before);
    expect(setPrefs({ presetOrder: ["aurora", "nebula"] })).toBe(before);
    expect(calls).toBe(0);
    // Order matters, and so does length.
    setPrefs({ presetOrder: ["nebula", "aurora"] });
    expect(calls).toBe(1);
    setPrefs({ collapsedSections: ["group:shape"] });
    expect(calls).toBe(2);
    expect(getPrefs().collapsedSections).toEqual(["group:shape"]);
  });

  it("compares the nested overlay-stats object by CONTENT, not identity", async () => {
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    expect(setPrefs({ perfOverlayStats: { ...before.perfOverlayStats } })).toBe(before);
    expect(calls).toBe(0);
    setPrefs({ perfOverlayStats: { ...before.perfOverlayStats, gpu: true } });
    expect(calls).toBe(1);
    expect(getPrefs().perfOverlayStats.gpu).toBe(true);
  });

  it("treats a patch that VALIDATES back to the current value as a no-op", async () => {
    // The comparison runs on the VALIDATED result, so a value that clamps or
    // normalises onto what is already stored announces nothing.
    seed(JSON.stringify({ panelWidth: 440 }));
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    setPrefs({ panelWidth: 9000 }); // clamped back to the stored 440
    setPrefs({ lastSaveDir: "" }); // empty string normalises to the stored null
    expect(calls).toBe(0);
    expect(getPrefs()).toBe(before);
  });
});

describe("prefs: the Visuals dock's rail (P-1)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("lands an upgrading user on the page matching the tab they last used", async () => {
    // The whole reason `paramsTab` survives as a frozen field: without this
    // read, everyone who had the panel on Sync gets dumped on Mode.
    for (const [tab, page] of [
      ["visual", "mode"],
      ["sync", "sync"],
      ["scene", "scene"],
      ["text", "text"],
      ["live", "live"],
    ] as const) {
      seed(JSON.stringify({ paramsTab: tab }));
      const { getPrefs } = await importFresh();
      expect(getPrefs().visualsPage).toBe(page);
    }
  });

  it("keeps an explicitly stored page over the retired tab's mapping", async () => {
    seed(JSON.stringify({ paramsTab: "sync", visualsPage: "modulation" }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().visualsPage).toBe("modulation");
  });

  it("degrades an unknown page to Mode rather than rendering nothing", async () => {
    seed(JSON.stringify({ visualsPage: "wormhole" }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().visualsPage).toBe("mode");
  });

  it("does not reinterpret the Library's stored width as the dock's", async () => {
    // panelWidth still sizes the Library. Reusing it would hand every
    // existing user a 280px dock — narrower than the dock's own minimum.
    seed(JSON.stringify({ panelWidth: 280 }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().panelWidth).toBe(280);
    expect(getPrefs().visualsWidth).toBe(480);
  });

  it("clamps the dock width to its usable range", async () => {
    seed(JSON.stringify({ visualsWidth: 99999 }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().visualsWidth).toBe(760);
    seed(JSON.stringify({ visualsWidth: 10 }));
    const fresh = await importFresh();
    expect(fresh.getPrefs().visualsWidth).toBe(380);
  });

  it("prunes retired section-collapse entries but keeps group collapse", async () => {
    // P-1 removed in-page section collapse, so bare ids have no reader. This
    // prune is also what retires the old defect where the first section keyed
    // its collapse state on the visual mode's DISPLAY NAME — a dynamic
    // string that silently reset whenever a mode was renamed.
    seed(
      JSON.stringify({
        collapsedSections: ["Sync", "Kaleido Nebula", "group:color", "group:motion"],
      }),
    );
    const { getPrefs } = await importFresh();
    expect(getPrefs().collapsedSections).toEqual(["group:color", "group:motion"]);
  });

  it("uses the same group prefix ParamGroups writes", async () => {
    // state must not import UI, so the literal is duplicated. If that copy
    // ever drifts, every collapsed group is silently pruned on next launch.
    // Imported from the dependency-free declaration rather than from
    // ParamGroups, which is store-aware since G4 — pulling that module into
    // this NODE-environment suite loads store.ts, which reads localStorage at
    // module scope. Same constant, same drift check, no React.
    const { GROUP_KEY } = await import("../ui/paramGroupKey");
    seed(JSON.stringify({ collapsedSections: [`${GROUP_KEY}shape`] }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().collapsedSections).toEqual([`${GROUP_KEY}shape`]);
  });
});

/**
 * Per-group Advanced disclosure (P-9).
 *
 * The global Essentials/All switch is retired, so `advancedGroups` replaces
 * `advancedOpen` as the live field. Old blobs and the older scattered key are
 * still consumed for direct upgrades, but the normalized blob must not keep
 * round-tripping the retired field.
 */
describe("prefs: per-group Advanced (P-9)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("P-A1 seeds every group for a user who had the global switch on All", async () => {
    seed(JSON.stringify({ advancedOpen: true }));
    const { getPrefs, ADVANCED_SEED_GROUPS } = await importFresh();
    expect(getPrefs().advancedGroups).toEqual([...ADVANCED_SEED_GROUPS]);
    expect(getPrefs().advancedGroups).toHaveLength(9);
  });

  it("P-A2 seeds nothing for a user who was on Essentials", async () => {
    seed(JSON.stringify({ advancedOpen: false }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().advancedGroups).toEqual([]);
  });

  it("P-A3 never re-seeds once the field exists, not even when empty", async () => {
    // An empty array is a user who CLOSED every disclosure. It is not
    // undefined, so the seed must not fire again and re-open all nine.
    seed(JSON.stringify({ advancedOpen: true, advancedGroups: [] }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().advancedGroups).toEqual([]);
  });

  it("P-A4 persists a write AND notifies subscribers (the samePrefs guard)", async () => {
    // THE regression this field is most likely to have: samePrefs is a plain
    // && chain and, unlike validPrefs, is NOT compiler-enforced. Omit
    // advancedGroups there and setPrefs early-exits on every write — nothing
    // persists, no listener fires, no reader re-renders, and typecheck, lint
    // and every other test stay green. The listener count is the assertion
    // that names the failure: a stale read-back could be blamed on
    // validation, but a silent listener can only be the equality guard.
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    setPrefs({ advancedGroups: ["glow"] });
    expect(calls).toBe(1);
    expect(getPrefs()).not.toBe(before);
    expect(getPrefs().advancedGroups).toEqual(["glow"]);
    // ...and re-applying the same content is still a no-op (content, not
    // identity — validPrefs rebuilds the array on every call).
    const after = getPrefs();
    expect(setPrefs({ advancedGroups: ["glow"] })).toBe(after);
    expect(calls).toBe(1);
    setPrefs({ advancedGroups: [] });
    expect(calls).toBe(2);
    expect(getPrefs().advancedGroups).toEqual([]);
  });

  it("P-A5 degrades a corrupt value and caps a runaway list", async () => {
    seed(`{"volume":0.3,"advancedGroups":"glow"}`);
    const { getPrefs } = await importFresh();
    expect(getPrefs().advancedGroups).toEqual([]);
    expect(getPrefs().volume).toBe(0.3);

    seed(`{"advancedGroups":["glow",7,null,"shape"]}`);
    const filtered = await importFresh();
    expect(filtered.getPrefs().advancedGroups).toEqual(["glow", "shape"]);

    seed(JSON.stringify({ advancedGroups: Array.from({ length: 40 }, (_, i) => `g${i}`) }));
    const capped = await importFresh();
    expect(capped.getPrefs().advancedGroups).toHaveLength(32);
  });

  it("P-A6 keeps the seed list equal to the render layer's group ids", async () => {
    // state must not import the render layer, so the ids are duplicated. If
    // that copy drifts, a ninth group would never open for an upgrading user.
    const { PARAM_GROUPS, FALLBACK_GROUP } = await import("../render/types");
    seed(undefined);
    const { ADVANCED_SEED_GROUPS } = await importFresh();
    expect([...ADVANCED_SEED_GROUPS]).toEqual([
      ...PARAM_GROUPS.map((g) => g.id),
      FALLBACK_GROUP.id,
    ]);
  });

  it("P-A7 consumes advancedOpen migration input without persisting the retired field", async () => {
    const storedBlob = seed(JSON.stringify({ advancedOpen: true }));
    const { getPrefs, ADVANCED_SEED_GROUPS } = await importFresh();
    expect(getPrefs().advancedGroups).toEqual([...ADVANCED_SEED_GROUPS]);
    expect("advancedOpen" in getPrefs()).toBe(false);
    expect(JSON.parse(storedBlob.getItem(KEY)!)).not.toHaveProperty("advancedOpen");

    // A user may jump directly from the old scattered-key build; update
    // installs are not guaranteed to visit v2.82.0 first.
    const legacy = seed(undefined);
    legacy.setItem("viz.advancedOpen", "1");
    const directUpgrade = await importFresh();
    expect(directUpgrade.getPrefs().advancedGroups).toEqual([...ADVANCED_SEED_GROUPS]);
    expect(legacy.getItem("viz.advancedOpen")).toBeNull();
    expect(JSON.parse(legacy.getItem(KEY)!)).not.toHaveProperty("advancedOpen");
  });
});

/**
 * FEAT-004 follow-up (b): the persisted per-stage measured-RTF history that
 * blendMeasuredRtf/estimateGenerateSeconds read (lyricsGen.ts). Property of
 * the hardware, not of a project, so it lives here rather than in the
 * document — same reasoning as perfOverlay.
 */
describe("prefs: measuredRtf (FEAT-004 follow-up b)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to all-null on a blob that predates the field", async () => {
    seed(JSON.stringify({ volume: 0.5 }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().measuredRtf).toEqual({
      isolateDml: null,
      isolateCpu: null,
      whisperSmall: null,
      whisperMedium: null,
      align: null,
    });
    expect(getPrefs().volume).toBe(0.5);
  });

  it("round-trips a stored measurement", async () => {
    seed(JSON.stringify({ measuredRtf: { isolateDml: 0.52, align: 0.14 } }));
    const { getPrefs } = await importFresh();
    // Present keys survive, absent ones default to null — validMeasuredRtf
    // reads each field independently, same as validOverlayStats.
    expect(getPrefs().measuredRtf).toEqual({
      isolateDml: 0.52,
      isolateCpu: null,
      whisperSmall: null,
      whisperMedium: null,
      align: 0.14,
    });
  });

  it("degrades a wrong-typed or non-positive stored value to null, keeping the rest of the blob", async () => {
    // Every kind of bad value JSON can actually carry: wrong type, zero,
    // negative. (A NaN/Infinity sample can only ever reach this validator
    // from a live sidecar event, not a stored blob — JSON.stringify already
    // turns those into `null` before they would be written — so that guard
    // is pinned directly against positiveOrNull's caller, blendMeasuredRtf,
    // in lyricsGen.test.ts instead.)
    seed(
      JSON.stringify({
        volume: 0.3,
        measuredRtf: { isolateDml: "fast", isolateCpu: 0, whisperSmall: -1 },
      }),
    );
    const { getPrefs } = await importFresh();
    const rtf = getPrefs().measuredRtf;
    expect(rtf.isolateDml).toBeNull();
    expect(rtf.isolateCpu).toBeNull();
    expect(rtf.whisperSmall).toBeNull();
    expect(rtf.whisperMedium).toBeNull(); // absent from the blob
    expect(getPrefs().volume).toBe(0.3);
  });

  it("persists a write AND notifies subscribers (the samePrefs guard)", async () => {
    // Same regression P-A4 guards for advancedGroups: samePrefs is a plain
    // && chain, not compiler-enforced, so omitting measuredRtf there would
    // make every setPrefs({measuredRtf: ...}) a silent no-op — nothing
    // persists, no listener fires — while typecheck/lint/every other test
    // stays green. The listener count is what actually catches that.
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    setPrefs({ measuredRtf: { ...before.measuredRtf, align: 0.2 } });
    expect(calls).toBe(1);
    expect(getPrefs()).not.toBe(before);
    expect(getPrefs().measuredRtf.align).toBe(0.2);
  });

  it("compares the nested measuredRtf object by CONTENT, not identity", async () => {
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    const before = getPrefs();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    expect(setPrefs({ measuredRtf: { ...before.measuredRtf } })).toBe(before);
    expect(calls).toBe(0);
    setPrefs({ measuredRtf: { ...before.measuredRtf, whisperMedium: 1.8 } });
    expect(calls).toBe(1);
    expect(getPrefs().measuredRtf.whisperMedium).toBe(1.8);
  });
});

describe("prefs: performance window (FEAT-009 / P-4)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults: HUD off, fullscreen on, monitor auto — on a blob predating the fields", async () => {
    seed(JSON.stringify({ volume: 0.5 }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().performHud).toBe(false);
    expect(getPrefs().performFullscreen).toBe(true);
    expect(getPrefs().performMonitor).toBeNull();
    expect(getPrefs().volume).toBe(0.5);
  });

  it("round-trips stored values", async () => {
    seed(JSON.stringify({ performHud: true, performFullscreen: false, performMonitor: 1 }));
    const { getPrefs } = await importFresh();
    expect(getPrefs().performHud).toBe(true);
    expect(getPrefs().performFullscreen).toBe(false);
    expect(getPrefs().performMonitor).toBe(1);
  });

  it("degrades a junk monitor index to auto — fraction, negative, huge, wrong type", async () => {
    for (const bad of [1.5, -1, 64, "two", true, null]) {
      seed(JSON.stringify({ performMonitor: bad, volume: 0.4 }));
      const { getPrefs } = await importFresh();
      expect(getPrefs().performMonitor).toBeNull();
      expect(getPrefs().volume).toBe(0.4);
    }
  });

  it("persists writes AND notifies subscribers (the samePrefs guard, per field)", async () => {
    // Same regression class measuredRtf pins above: a field missing from
    // samePrefs makes its setPrefs a silent no-op while everything else
    // stays green. One write per new field, one notification each.
    seed(undefined);
    const { getPrefs, setPrefs, subscribePrefs } = await importFresh();
    let calls = 0;
    subscribePrefs(() => {
      calls++;
    });
    setPrefs({ performHud: true });
    setPrefs({ performFullscreen: false });
    setPrefs({ performMonitor: 2 });
    expect(calls).toBe(3);
    expect(getPrefs().performHud).toBe(true);
    expect(getPrefs().performFullscreen).toBe(false);
    expect(getPrefs().performMonitor).toBe(2);
    // No-op writes stay no-ops.
    const before = getPrefs();
    expect(setPrefs({ performMonitor: 2 })).toBe(before);
    expect(calls).toBe(3);
  });
});
