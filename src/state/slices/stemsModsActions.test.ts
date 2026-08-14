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
    expect(s().undoDepth).toBe(depth + 1); // grouped under "mod-reorder", not a 2nd entry
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
