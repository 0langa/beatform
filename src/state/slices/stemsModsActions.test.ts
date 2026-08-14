import { beforeEach, describe, expect, it, vi } from "vitest";
// Type-only: erased at compile time, so these never hoist a module body above
// the global stubs below (the reason the value imports are dynamic).
import type { ModRoute } from "../modMatrix";
import type { ProjectDocument } from "../project";

/**
 * H10 — `addModRoute` hardened at the ACTION. Two silent failures used to be
 * reachable by anything that is not the Modulation create picker: a route on
 * `""` or on a param this visual has no modulatable spec for (added, kept for
 * the session, then dropped by validModRoutes on the next load — it vanishes
 * from the saved file), and N calls with the same `(source, param)` stacking N
 * COMPOUNDING routes on one knob.
 *
 * The guard's target list is derived from the same three things the picker
 * enumerates — `allParams`, `isModTarget`, the `post:` namespace — so the
 * fixtures below are derived from the registry too: a literal key list here
 * would rot the moment a knob is re-tiered, which is the failure the guard
 * exists to prevent.
 *
 * `validModRoutes` and the persisted shape are deliberately untouched: the
 * last case proves a legacy document carrying exactly what the action now
 * refuses still loads byte-for-byte as it always did.
 *
 * Same mock surface as store.test.ts — services/platform are faked because
 * WebGPU/Web Audio/Tauri don't exist here, which is orthogonal to the
 * bookkeeping under test.
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

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

// Dynamic import: a static one would hoist above the global stubs and the
// store's module-init would read localStorage before it exists (the
// store.test.ts discipline).
const { useVizStore } = await import("../store");
const { presets } = await import("../../render/presets");
const { allParams, isModTarget, POST_MOD_TARGETS } = await import("../../render/types");
const { POST_TARGET_PREFIX } = await import("../modMatrix");
const { parseProject, serializeProject } = await import("../project");
const { clearHistory } = await import("../history");
const { APP_VERSION } = await import("../../version");

/** The first registry visual carrying BOTH a modulatable knob and one the
 *  picker refuses (`mod:"off"`) — found, not named. */
const subject = presets.find(
  (p) => allParams(p).some(isModTarget) && allParams(p).some((spec) => !isModTarget(spec)),
)!;
const liveParam = allParams(subject).find(isModTarget)!.key;
const offParam = allParams(subject).find((spec) => !isModTarget(spec))!.key;
const postParam = `${POST_TARGET_PREFIX}${POST_MOD_TARGETS[0].key}`;

const s = () => useVizStore.getState();
const pairs = () => s().activeMods.map((r) => `${r.source}/${r.param}`);

beforeEach(() => {
  // `undoDepth: 0` below only resets the store's MIRROR of the depth —
  // history.ts's module-level stacks survive setState and the next record()
  // re-syncs the mirror from them, so clear the stacks too for a real zero.
  clearHistory();
  useVizStore.setState({
    presetId: subject.id,
    activeMods: [],
    modsByPreset: {},
    notice: null,
    undoDepth: 0,
  });
});

describe("addModRoute — the target guard", () => {
  it("refuses every param the create picker would not offer", () => {
    s().addModRoute("kick", "");
    s().addModRoute("kick", "notAKnobOnAnyVisual");
    s().addModRoute("kick", offParam);
    s().addModRoute("kick", `${POST_TARGET_PREFIX}notAPostKey`);

    expect(s().activeMods).toEqual([]);
    expect(s().modsByPreset).toEqual({});
    // A refused call is not an edit: it must not cost a Ctrl+Z either.
    expect(s().undoDepth).toBe(0);
  });

  it("accepts a real knob and a post target", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("kick", postParam);

    expect(pairs()).toEqual([`kick/${liveParam}`, `kick/${postParam}`]);
    expect(s().modsByPreset[subject.id]).toEqual(s().activeMods);
  });
});

describe("addModRoute — the dedupe", () => {
  it("a second identical (source, param) call is a no-op", () => {
    s().addModRoute("kick", liveParam);
    const first = s().activeMods;
    expect(first).toHaveLength(1);
    const depth = s().undoDepth;

    s().addModRoute("kick", liveParam);
    s().addModRoute("kick", liveParam);

    expect(s().activeMods).toBe(first); // identity: nothing was even rebuilt
    expect(s().undoDepth).toBe(depth);
  });

  it("dedupes on the PAIR, so two sources may still share one knob", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam);
    s().addModRoute("bass", liveParam);

    // applyMods sums per route, so a stacked knob is a legitimate document —
    // only the identical pair is the accident.
    expect(pairs()).toEqual([`kick/${liveParam}`, `bass/${liveParam}`]);
  });
});

describe("updateModRoute — muted (H12)", () => {
  it("passes the muted patch through and records history under the route's own key", () => {
    s().addModRoute("kick", liveParam);
    const id = s().activeMods[0].id;
    const depth = s().undoDepth;

    s().updateModRoute(id, { muted: true });

    expect(s().activeMods[0].muted).toBe(true);
    expect(s().modsByPreset[subject.id][0].muted).toBe(true);
    // updateModRoute's existing per-route key ("mod:<id>:muted") — no new
    // history mechanism needed for a plain patch.
    expect(s().undoDepth).toBe(depth + 1);
  });
});

describe("reorderModRoutes (H12)", () => {
  it("moves within-card order and leaves another param's route at its own index", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam); // second route on the SAME target
    s().addModRoute("kick", postParam); // a DIFFERENT target, interleaved
    const [first, second, other] = s().activeMods;
    expect(first.param).toBe(liveParam);
    expect(second.param).toBe(liveParam);
    expect(other.param).toBe(postParam);

    s().reorderModRoutes(liveParam, 0, 1); // swap the two liveParam routes

    const mods = s().activeMods;
    expect(mods.map((r) => r.id)).toEqual([second.id, first.id, other.id]);
    // Not just re-sorted the same way — the untouched route is the SAME
    // object at the SAME index (identity, not merely equal value).
    expect(mods[2]).toBe(other);
    expect(s().modsByPreset[subject.id]).toEqual(mods);
  });

  it("out-of-range or equal indices are a no-op and cost no history entry", () => {
    s().addModRoute("kick", liveParam);
    const before = s().activeMods;
    const depth = s().undoDepth;

    s().reorderModRoutes(liveParam, 0, 5); // toIndex out of range — one route
    s().reorderModRoutes(liveParam, 0, 0); // equal indices
    s().reorderModRoutes("notARealParam", 0, 1); // no route carries this param

    expect(s().activeMods).toBe(before); // identity: nothing was even rebuilt
    expect(s().undoDepth).toBe(depth);
  });

  it("records ONE history entry per gesture — a second move inside the window groups", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam);
    const depth = s().undoDepth;

    s().reorderModRoutes(liveParam, 0, 1);
    expect(s().undoDepth).toBe(depth + 1);

    s().reorderModRoutes(liveParam, 1, 0); // a second, genuine move — same gesture
    expect(s().undoDepth).toBe(depth + 1); // grouped under the same per-param key, not a 2nd entry
  });

  it("reorders on TWO DIFFERENT cards within the grouping window stay two entries (M1)", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam); // card A: two routes on liveParam
    s().addModRoute("kick", postParam);
    s().addModRoute("bass", postParam); // card B: two routes on postParam
    const depth = s().undoDepth;

    // A bare "mod-reorder" key (pre-M1) would have let these two collapse
    // into one entry, exactly like the grouped same-card case above —
    // the fix is scoping the key to paramKey, not the 800ms window.
    s().reorderModRoutes(liveParam, 0, 1); // card A
    s().reorderModRoutes(postParam, 0, 1); // card B, same tick

    expect(s().undoDepth).toBe(depth + 2);
  });
});

describe("clearModRoutesForSource (H13)", () => {
  it("removes every route for the source, including a muted one, and leaves other sources alone", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("kick", postParam);
    s().addModRoute("bass", liveParam);
    const kickRouteId = s().activeMods[0].id;
    s().updateModRoute(kickRouteId, { muted: true }); // still matches "kick" — mute is not a filter
    const depth = s().undoDepth;

    s().clearModRoutesForSource("kick");

    expect(pairs()).toEqual([`bass/${liveParam}`]);
    expect(s().modsByPreset[subject.id]).toEqual(s().activeMods);
    // ONE entry for the whole bulk removal, not one per route removed.
    expect(s().undoDepth).toBe(depth + 1);
  });

  it("is a no-op — no mutation, no history entry — when the source has no routes", () => {
    s().addModRoute("kick", liveParam);
    const before = s().activeMods;
    const depth = s().undoDepth;

    s().clearModRoutesForSource("bass"); // no bass routes exist

    expect(s().activeMods).toBe(before); // identity: nothing was even rebuilt
    expect(s().undoDepth).toBe(depth);
  });

  it("drops modsByPreset's entry entirely when the source was the only one routed", () => {
    s().addModRoute("kick", liveParam);
    expect(s().modsByPreset[subject.id]).toBeDefined();

    s().clearModRoutesForSource("kick");

    // Same convention as removeModRoute: an empty route list deletes the
    // preset's key rather than leaving `[]` behind.
    expect(s().activeMods).toEqual([]);
    expect(s().modsByPreset[subject.id]).toBeUndefined();
  });

  it("records ONE entry regardless of N; undo restores all N routes", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("kick", postParam);
    s().addModRoute("bass", liveParam);
    const before = s().activeMods;
    const depth = s().undoDepth;

    s().clearModRoutesForSource("kick");
    expect(s().activeMods).toHaveLength(1);
    expect(s().undoDepth).toBe(depth + 1);

    s().undo();
    // Snapshot restore is a JSON round-trip (history.ts), so the routes are
    // equal, not the SAME objects — toEqual, not toBe.
    expect(s().activeMods).toEqual(before);
  });
});

describe("setModRouteAmountsForParam (H13)", () => {
  it("sets amount on every route for the param, including a muted one, and leaves other targets alone", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam); // second route on the SAME target
    s().addModRoute("kick", postParam); // a DIFFERENT target
    const [first, second, other] = s().activeMods;
    s().updateModRoute(second.id, { muted: true });
    const depth = s().undoDepth;

    s().setModRouteAmountsForParam(liveParam, -0.75);

    const mods = s().activeMods;
    expect(mods[0].id).toBe(first.id);
    expect(mods[0].amount).toBe(-0.75);
    expect(mods[1].id).toBe(second.id);
    expect(mods[1].amount).toBe(-0.75);
    expect(mods[1].muted).toBe(true); // amount is independent of mute state
    // The different-target route is untouched — SAME object, not just equal.
    expect(mods[2]).toBe(other);
    expect(s().modsByPreset[subject.id]).toEqual(mods);
    // ONE entry for the whole bulk set, not one per route touched.
    expect(s().undoDepth).toBe(depth + 1);
  });

  it("is a no-op — no mutation, no history entry — when nothing targets the param", () => {
    s().addModRoute("kick", liveParam);
    const before = s().activeMods;
    const depth = s().undoDepth;

    s().setModRouteAmountsForParam("notARealParam", 0.4);

    expect(s().activeMods).toBe(before); // identity: nothing was even rebuilt
    expect(s().undoDepth).toBe(depth);
  });

  it("records ONE entry; undo restores the original amounts", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam);
    const before = s().activeMods;
    const depth = s().undoDepth;

    s().setModRouteAmountsForParam(liveParam, 0.1);
    expect(s().undoDepth).toBe(depth + 1);

    s().undo();
    expect(s().activeMods).toEqual(before);
  });

  it("two rapid calls on the SAME param group into ONE entry — a drag (C1)", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam);
    const before = s().activeMods;
    const depth = s().undoDepth;

    // Two onChange events from one continuous <input type="range"> drag,
    // fired back to back with no delay — must group under the per-param
    // "mod-bulk-depth:<param>" key, the same idiom updateModRoute's own
    // per-route key already uses for a Depth-slider drag. Before C1 this
    // recorded "mod-bulk" (UNGROUPABLE), costing the drag one undo entry
    // PER POINTER STEP.
    s().setModRouteAmountsForParam(liveParam, 0.2);
    s().setModRouteAmountsForParam(liveParam, 0.4);

    expect(s().undoDepth).toBe(depth + 1);
    expect(s().activeMods.every((r) => r.amount === 0.4)).toBe(true);

    s().undo();
    // Undo jumps back to BEFORE the whole drag, not to the mid-drag 0.2.
    expect(s().activeMods).toEqual(before);
  });

  it("two rapid calls on DIFFERENT params never merge — the key is per-param, not global (C1)", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("kick", postParam);
    const depth = s().undoDepth;

    s().setModRouteAmountsForParam(liveParam, 0.3);
    s().setModRouteAmountsForParam(postParam, 0.6);

    expect(s().undoDepth).toBe(depth + 2);
  });
});

describe("mod-bulk history (H13)", () => {
  it("two rapid bulk actions stay two undo entries — different keys, not the 800ms window", () => {
    s().addModRoute("kick", liveParam);
    s().addModRoute("bass", liveParam);
    const depth = s().undoDepth;

    // clearModRoutesForSource keeps the UNGROUPABLE (history.ts) "mod-bulk"
    // key; setModRouteAmountsForParam records a GROUPABLE per-param
    // "mod-bulk-depth:<param>" key instead (C1) — two DIFFERENT keys never
    // merge regardless of timing, so this needs no delay between the calls
    // to stay two entries. See reorderModRoutes' own per-param-key test
    // above for the CONTRASTING case where grouping is exactly what's
    // wanted (two same-card moves collapsing to one entry).
    s().clearModRoutesForSource("bass");
    s().setModRouteAmountsForParam(liveParam, 0.9);

    expect(s().undoDepth).toBe(depth + 2);
  });
});

describe("route recipes still work through the guarded action", () => {
  it("keeps flashing 'Already routed' on a repeat chip click", () => {
    s().applyModRouteRecipe("kick-punch");
    const added = s().activeMods;
    expect(added.length).toBeGreaterThan(0);
    expect(s().notice).toBe(null);

    s().applyModRouteRecipe("kick-punch");

    expect(s().activeMods).toBe(added);
    expect(s().notice).toBe("Already routed — tweak the existing route's amount instead");
  });

  it("every target a recipe resolves is one addModRoute accepts", () => {
    s().applyModRouteRecipe("kick-punch");
    const minted = s().activeMods.map((r) => `${r.source}/${r.param}`);
    expect(minted.length).toBeGreaterThan(0);

    // Drop them and re-add through the guarded action. Re-offering them
    // WITHOUT removing first would prove nothing — refused-as-unroutable and
    // refused-as-duplicate look identical from outside.
    const restore = s().activeMods.map((r) => ({ source: r.source, param: r.param }));
    for (const r of s().activeMods) s().removeModRoute(r.id);
    expect(s().activeMods).toEqual([]);
    for (const r of restore) s().addModRoute(r.source, r.param);

    expect(pairs()).toEqual(minted);
  });
});

/** A document whose only interesting content is its route list. */
function docWith(mods: ModRoute[]): ProjectDocument {
  const state = s();
  return {
    presetId: subject.id,
    paramsByPreset: state.paramsByPreset,
    syncByPreset: {},
    bg: { mode: 0, color: [0, 0, 0] },
    bgByPreset: {},
    centerImageByPreset: {},
    overlayLayers: [],
    assets: {},
    aspect: "16:9",
    modsByPreset: { [subject.id]: mods },
    smoothSpectrum: false,
    timeline: { enabled: false, scenes: [], lanes: [] },
    post: state.post,
    motion: state.motion,
    lyricStyle: state.lyricStyle,
    audiogram: state.audiogram,
    customDefs: [],
    builderStack: state.builderStack,
  };
}

describe("legacy documents", () => {
  it("load their off-param and duplicate routes exactly as before", () => {
    // Everything the action now refuses, written by an older build: an
    // off-param route, a duplicate pair, and an empty param. The first two
    // must survive verbatim (they are inert / stacked, not invalid), and the
    // third must still be dropped by validModRoutes — the same rule as before
    // this hardening, since the persisted shape did not change.
    const kept: ModRoute[] = [
      { id: "mr-legacy-off", source: "kick", param: offParam, amount: 0.5 },
      { id: "mr-legacy-dup-1", source: "bass", param: liveParam, amount: 0.4 },
      { id: "mr-legacy-dup-2", source: "bass", param: liveParam, amount: 0.3 },
    ];
    const legacy: ModRoute[] = [
      ...kept,
      { id: "mr-legacy-empty", source: "hat", param: "", amount: 0.2 },
    ];

    s().applyDocument(parseProject(serializeProject(docWith(legacy), APP_VERSION)));

    expect(s().activeMods).toEqual(kept);
    expect(s().modsByPreset[subject.id]).toEqual(kept);
  });

  it("load routes carrying muted exactly as before (H12 is additive, no schema bump)", () => {
    const legacy: ModRoute[] = [
      { id: "mr-legacy-muted", source: "kick", param: liveParam, amount: 0.5, muted: true },
      { id: "mr-legacy-unmuted", source: "bass", param: liveParam, amount: 0.4 },
    ];

    s().applyDocument(parseProject(serializeProject(docWith(legacy), APP_VERSION)));

    expect(s().activeMods).toEqual(legacy);
    expect(s().modsByPreset[subject.id]).toEqual(legacy);
  });
});
