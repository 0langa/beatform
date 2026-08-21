import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPerformAssets,
  buildPerformLive,
  buildPerformScene,
  monitorLabel,
  performActions,
  performAssetsSig,
  performLiveSig,
  performSceneSig,
  sameSig,
  type PerformMonitorInfo,
} from "./performActions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
import { BG_IMAGE, BG_VIDEO, DEFAULT_MOTION } from "../../render/types";
import type { VizState } from "../store";

/**
 * FEAT-009: the three state-tier builders + their change signatures. The
 * builders resolve the same rules the primary's own appliers use (effective
 * bg, center-image override over cover art, overlay-image assets only) and
 * the signatures must react to exactly the identities the builders read —
 * that pairing is what the sig tests pin.
 */

function baseState(overrides: Partial<VizState> = {}): VizState {
  return {
    blackout: false,
    aspect: "16:9",
    motion: DEFAULT_MOTION,
    smoothSpectrum: true,
    customDefs: [],
    builderStack: { layers: [] },
    presetId: "nebula",
    bg: { mode: 0, color: [0, 0, 0] },
    bgByPreset: {},
    overlayLayers: [],
    assets: {},
    trackMeta: { title: "T", artist: "A" },
    lyrics: null,
    lyricStyle: { enabled: true } as VizState["lyricStyle"],
    audiogram: { progressBar: false } as unknown as VizState["audiogram"],
    waveformOverview: null,
    coverArt: null,
    centerImageByPreset: {},
    ...overrides,
  } as VizState;
}

describe("buildPerformLive/Scene/Assets", () => {
  it("live carries blackout/aspect/motion/smoothing", () => {
    const live = buildPerformLive(baseState({ blackout: true }));
    expect(live.blackout).toBe(true);
    expect(live.aspect).toBe("16:9");
    expect(live.motion).toBe(DEFAULT_MOTION);
    expect(live.smoothSpectrum).toBe(true);
    expect(typeof live.hud).toBe("boolean"); // prefs-sourced
  });

  it("scene resolves bake params from the EFFECTIVE background (per-mode override wins)", () => {
    const s = baseState({
      bg: { mode: 0, color: [0, 0, 0] },
      bgByPreset: {
        nebula: {
          mode: BG_IMAGE,
          color: [0, 0, 0],
          image: { assetId: "img1", dim: 0.4, blur: 12 },
        },
      },
    });
    const scene = buildPerformScene(s);
    expect(scene.bgImageParams).toEqual({ blur: 12, dim: 0.4 });
    expect(scene.bgVideoParams).toBeNull();
  });

  it("assets resolve the center-image override over the track cover, and image-layer assets only", () => {
    const s = baseState({
      coverArt: "data:cover",
      centerImageByPreset: { nebula: "ovr" },
      assets: {
        ovr: { id: "ovr", name: "o", dataUrl: "data:override" },
        logo: { id: "logo", name: "l", dataUrl: "data:logo" },
        unused: { id: "unused", name: "u", dataUrl: "data:unused" },
      },
      overlayLayers: [
        { id: "t1", type: "text" } as VizState["overlayLayers"][number],
        { id: "i1", type: "image", assetId: "logo" } as VizState["overlayLayers"][number],
      ],
    });
    const assets = buildPerformAssets(s);
    expect(assets.coverUrl).toBe("data:override");
    expect(Object.keys(assets.overlayAssets)).toEqual(["logo"]);
  });

  it("assets carry the bg video url only in video mode", () => {
    const s = baseState({
      bg: { mode: BG_VIDEO, color: [0, 0, 0], video: { assetId: "vid", dim: 0, blur: 0 } },
      assets: { vid: { id: "vid", name: "v", dataUrl: "data:video" } },
    });
    expect(buildPerformAssets(s).bgVideoUrl).toBe("data:video");
    expect(buildPerformAssets(s).bgImageUrl).toBeNull();
  });
});

describe("perform change signatures", () => {
  it("react to the fields their tier ships, and only via identity", () => {
    const s1 = baseState();
    expect(sameSig(performLiveSig(s1), performLiveSig(s1))).toBe(true);
    expect(sameSig(performSceneSig(s1), performSceneSig(s1))).toBe(true);
    expect(sameSig(performAssetsSig(s1), performAssetsSig(s1))).toBe(true);

    // Derived by SPREAD, the way zustand's set() patches state — untouched
    // slices keep their identities, exactly what the store subscription sees.
    const s2 = { ...s1, blackout: true } as VizState;
    expect(sameSig(performLiveSig(s1), performLiveSig(s2))).toBe(false);
    // Blackout is a LIVE concern — the heavy tiers must not resend for it.
    expect(sameSig(performSceneSig(s1), performSceneSig(s2))).toBe(true);
    expect(sameSig(performAssetsSig(s1), performAssetsSig(s2))).toBe(true);

    const s3 = { ...s1, lyrics: [] as VizState["lyrics"] } as VizState;
    expect(sameSig(performSceneSig(s1), performSceneSig(s3))).toBe(false);
    expect(sameSig(performAssetsSig(s1), performAssetsSig(s3))).toBe(true);

    const s4 = { ...s1, coverArt: "data:cover" } as VizState;
    expect(sameSig(performAssetsSig(s1), performAssetsSig(s4))).toBe(false);
    expect(sameSig(performLiveSig(s1), performLiveSig(s4))).toBe(true);
    expect(sameSig(performSceneSig(s1), performSceneSig(s4))).toBe(true);
  });
});

describe("openPerformWindow double-open dedupe (review F3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a second call while the first invoke is in flight never leaves JS", async () => {
    // Desktop context for isTauri(); node env has no window at all.
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const { invoke } = await import("@tauri-apps/api/core");
    const set = vi.fn();
    const get = vi.fn();
    const actions = performActions(set as never, get as never, {} as never);

    // Queued double-click: both calls fire before the first settles. The
    // in-flight flag is taken SYNCHRONOUSLY, before any await, so the
    // second call must return without its own IPC round-trip.
    const p1 = actions.openPerformWindow();
    const p2 = actions.openPerformWindow();
    await Promise.all([p1, p2]);
    expect(invoke).toHaveBeenCalledTimes(1);

    // Not a permanent latch: once settled, opening again works.
    await actions.openPerformWindow();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(set).not.toHaveBeenCalled(); // no error surfaced anywhere
  });
});

describe("monitorLabel", () => {
  it("names, sizes and marks the primary", () => {
    const m: PerformMonitorInfo = {
      index: 1,
      name: String.raw`\\.\DISPLAY2`,
      width: 1920,
      height: 1080,
      x: 2560,
      y: 0,
      scale: 1.25,
      primary: false,
    };
    expect(monitorLabel(m)).toBe("Display 2 — 1920×1080");
    expect(monitorLabel({ ...m, index: 0, primary: true })).toBe("Display 1 — 1920×1080 (primary)");
  });
});

/**
 * R2-31a: closing the Perform drawer disarms a pending MIDI Learn — the
 * drawer is one of Learn's two arming surfaces, and an armed learn with no
 * surface showing it silently binds the next control the device sends.
 * Driven at the factory level (set/get fakes) — the action's whole contract
 * is which patch it writes.
 */
describe("setShowPerform disarms a pending MIDI learn on close (R2-31a)", () => {
  function drive(midiLearn: unknown, v: boolean) {
    const writes: Record<string, unknown>[] = [];
    const state = { midiLearn, refreshPerformMonitors: vi.fn(async () => {}) };
    const actions = performActions(
      ((patch: Record<string, unknown>) => void writes.push(patch)) as never,
      (() => state) as never,
      {} as never,
    );
    actions.setShowPerform(v);
    return writes;
  }

  it("closing with a learn armed clears it in the same set", () => {
    expect(drive({ kind: "cc", param: "hue", min: 0, max: 1 }, false)).toEqual([
      { showPerform: false, midiLearn: null },
    ]);
  });

  it("closing with no learn writes only the flag (no churn)", () => {
    expect(drive(null, false)).toEqual([{ showPerform: false }]);
  });

  it("opening never touches the learn", () => {
    expect(drive({ kind: "cc", param: "hue", min: 0, max: 1 }, true)).toEqual([
      { showPerform: true },
    ]);
  });
});
