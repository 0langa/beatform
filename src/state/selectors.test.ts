import { afterEach, describe, expect, it } from "vitest";
import {
  selectBgPerMode,
  selectBpm,
  selectCenterImageName,
  selectEffectiveBg,
  selectHasCoverArt,
  selectKeyName,
  selectPreset,
} from "./selectors";
import { presetById, presets } from "../render/presets";
import { registerCustomPreset, unregisterCustomPreset } from "../render/presets/custom";
import { BUILDER2_ID } from "../render/builder2";
import { BG_SOLID, BG_IMAGE, type BgSettings, type PresetDef } from "../render/types";

/**
 * Shared selectors.
 *
 * The headline case is the per-mode background. Before this module the
 * expression `bgByPreset[presetId] ?? bg` was written out five times (App, the
 * store's effBg, the render loop's getFrameInput, the video-bg frame branch,
 * buildExportOptions) and ONE of those copies drifted — defect BG1, where the
 * loop re-applied the global background every frame so an override rendered in
 * exports but was invisible live. Deduplicating it is only safe if the shared
 * function returns EXACTLY what each site's own literal returned, reference
 * identity included (the value is handed to the renderer and compared by
 * identity along the bake-cache path). That is what `IDENTITY` pins, per site.
 */

const solidBlack: BgSettings = { mode: BG_SOLID, color: [0, 0, 0] };
const solidRed: BgSettings = { mode: BG_SOLID, color: [1, 0, 0] };
const imageBg: BgSettings = {
  mode: BG_IMAGE,
  color: [0, 0, 0],
  image: { assetId: "a1", dim: 0.4, blur: 2 },
};

/** The shape every converted call site reads from — a store snapshot at
 * store.ts:897/1228/1286/1501, a ProjectDocument at buildExportOptions.ts:121.
 * The three fields are the whole contract. */
interface BgSlice {
  bg: BgSettings;
  bgByPreset: Record<string, BgSettings>;
  presetId: string;
}

/** Every distinguishable state of the per-mode override. */
const CASES: { name: string; s: BgSlice }[] = [
  { name: "no overrides at all", s: { bg: solidBlack, bgByPreset: {}, presetId: "spectrum-bars" } },
  {
    name: "override for the active mode",
    s: { bg: solidBlack, bgByPreset: { "spectrum-bars": solidRed }, presetId: "spectrum-bars" },
  },
  {
    name: "override for a DIFFERENT mode only",
    s: { bg: solidBlack, bgByPreset: { "bass-circle": solidRed }, presetId: "spectrum-bars" },
  },
  {
    name: "overrides for several modes incl. the active one",
    s: {
      bg: solidBlack,
      bgByPreset: { "bass-circle": solidRed, "spectrum-bars": imageBg },
      presetId: "spectrum-bars",
    },
  },
  {
    name: "an image override",
    s: { bg: solidBlack, bgByPreset: { "spectrum-bars": imageBg }, presetId: "spectrum-bars" },
  },
  {
    name: "a custom mode id",
    s: { bg: solidRed, bgByPreset: { "custom-abc": imageBg }, presetId: "custom-abc" },
  },
  {
    // A plain-object lookup answers for prototype keys, so this resolves to
    // Object.prototype.constructor rather than the global bg. Pinned here
    // BECAUSE it is unchanged: the selector must behave exactly like the
    // literal it replaced, warts included. Unreachable in practice (presetId
    // is always a validated preset id, and custom ids are "custom-"-prefixed),
    // so hardening it would be a behavior change with no user behind it.
    name: "a prototype-chain key ('constructor')",
    s: { bg: solidBlack, bgByPreset: {}, presetId: "constructor" },
  },
];

describe("selectEffectiveBg: the five converted call sites are identity-preserving", () => {
  /**
   * The literal that used to live at each site, transcribed from the code it
   * replaced. Each one must be indistinguishable from the shared selector —
   * `toBe`, not `toEqual`, because the site at store.ts:1228 feeds the render
   * loop and store.ts:1501 feeds structuredClone.
   */
  const SITES: { site: string; literal: (s: BgSlice) => BgSettings }[] = [
    { site: "store.ts:897 effBg()", literal: (s) => s.bgByPreset[s.presetId] ?? s.bg },
    {
      site: "store.ts:1228 getFrameInput().baseBg (read every frame)",
      literal: (s) => s.bgByPreset[s.presetId] ?? s.bg,
    },
    {
      site: "store.ts:1286 onFrameTick video-bg branch",
      literal: (s) => s.bgByPreset[s.presetId] ?? s.bg,
    },
    {
      site: "store.ts:1501 setBgPerMode seed",
      literal: (s) => s.bgByPreset[s.presetId] ?? s.bg,
    },
    { site: "buildExportOptions.ts:121", literal: (s) => s.bgByPreset[s.presetId] ?? s.bg },
  ];

  for (const { site, literal } of SITES) {
    for (const { name, s } of CASES) {
      it(`IDENTITY — ${site} · ${name}`, () => {
        expect(selectEffectiveBg(s)).toBe(literal(s));
      });
    }
  }

  it("returns the SAME reference across repeated calls (zustand-v5 safe)", () => {
    // An allocating selector is "Maximum update depth exceeded" on mount, so
    // this is a crash guard, not a perf one.
    const s = CASES[1].s;
    expect(selectEffectiveBg(s)).toBe(selectEffectiveBg(s));
  });

  it("an override wins over the global bg; its absence falls through", () => {
    expect(selectEffectiveBg(CASES[1].s)).toBe(solidRed);
    expect(selectEffectiveBg(CASES[2].s)).toBe(solidBlack);
  });
});

describe("selectBgPerMode", () => {
  it("answers the EXISTENCE question, matching the literals it replaced", () => {
    for (const { s } of CASES) {
      // store.ts:917 (commitBg) and store.ts:1494 (setBgPerMode).
      expect(selectBgPerMode(s)).toBe(!!s.bgByPreset[s.presetId]);
    }
  });

  it("is true exactly when the active mode owns an override", () => {
    expect(selectBgPerMode(CASES[0].s)).toBe(false);
    expect(selectBgPerMode(CASES[1].s)).toBe(true);
    expect(selectBgPerMode(CASES[2].s)).toBe(false);
  });
});

describe("selectPreset", () => {
  const CUSTOM_ID = "custom-selectortest";
  afterEach(() => {
    unregisterCustomPreset(CUSTOM_ID);
  });

  const customDef = (hueDefault: number): PresetDef => ({
    id: CUSTOM_ID,
    name: "Selector test",
    params: [
      { key: "hue", label: "Hue", min: 0, max: 360, step: 1, default: hueDefault },
      ...(hueDefault > 0
        ? [{ key: "warp", label: "Warp", min: 0, max: 1, step: 0.01, default: 0.5 }]
        : []),
    ],
    wgsl: "fn preset(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }",
  });

  it("resolves a built-in id and hands back the registry's own reference", () => {
    const a = selectPreset({ presetId: "spectrum-bars" });
    expect(a.id).toBe("spectrum-bars");
    // Reference stability is the zustand-v5 requirement.
    expect(selectPreset({ presetId: "spectrum-bars" })).toBe(a);
    expect(a).toBe(presetById("spectrum-bars"));
  });

  it("falls back to the first strip preset for an unknown id", () => {
    expect(selectPreset({ presetId: "not-a-mode" })).toBe(presets[0]);
  });

  it("resolves Builder Studio to its current generated def", () => {
    expect(selectPreset({ presetId: BUILDER2_ID })).toBe(presetById(BUILDER2_ID));
  });

  it("picks up a custom-shader RE-SAVE under the same id (R3)", () => {
    // The registry is written by registerCustomPreset BEFORE the set() that
    // notifies subscribers, so resolving inside the selector is what makes a
    // re-save visible. Resolving in the caller is the stale-param-schema bug.
    registerCustomPreset(customDef(0));
    const v1 = selectPreset({ presetId: CUSTOM_ID });
    expect(v1.params.map((p) => p.key)).toEqual(["hue"]);

    registerCustomPreset(customDef(200));
    const v2 = selectPreset({ presetId: CUSTOM_ID });
    expect(v2).not.toBe(v1);
    expect(v2.params.map((p) => p.key)).toEqual(["hue", "warp"]);
    expect(v2.params[0].default).toBe(200);
  });
});

describe("selectCenterImageName", () => {
  interface CenterSlice {
    centerImageByPreset: Record<string, string>;
    presetId: string;
    assets: Record<string, { name?: string }>;
  }
  const base = {
    presetId: "bass-circle",
    assets: { a1: { name: "cover.png" }, a2: {} },
  };
  const withOverride = (centerImageByPreset: Record<string, string>): CenterSlice => ({
    ...base,
    centerImageByPreset,
  });

  it("matches the literal it replaced (App.tsx:91), across every branch", () => {
    const cases: CenterSlice[] = [
      withOverride({}),
      withOverride({ "bass-circle": "a1" }),
      withOverride({ "bass-circle": "a2" }), // asset lost its name
      withOverride({ "bass-circle": "gone" }), // asset GC'd out from under it
      withOverride({ "voice-orb": "a1" }), // another mode's override
    ];
    for (const s of cases) {
      const id = s.centerImageByPreset[s.presetId];
      const literal = id ? (s.assets[id]?.name ?? "Custom image") : null;
      expect(selectCenterImageName(s)).toBe(literal);
    }
  });

  it("names the override, falls back for a nameless asset, and is null with none", () => {
    expect(selectCenterImageName(withOverride({ "bass-circle": "a1" }))).toBe("cover.png");
    expect(selectCenterImageName(withOverride({ "bass-circle": "a2" }))).toBe("Custom image");
    expect(selectCenterImageName(withOverride({}))).toBeNull();
  });
});

describe("primitive readouts", () => {
  it("selectHasCoverArt is the truthiness of coverArt", () => {
    expect(selectHasCoverArt({ coverArt: "data:image/png;base64,AAA" })).toBe(true);
    expect(selectHasCoverArt({ coverArt: null })).toBe(false);
    expect(selectHasCoverArt({ coverArt: "" })).toBe(false);
  });

  it("selectBpm is null before analysis lands", () => {
    expect(selectBpm({ beatGrid: null })).toBeNull();
    expect(selectBpm({ beatGrid: { bpm: 128 } })).toBe(128);
  });

  it("selectKeyName is null before analysis / for atonal tracks", () => {
    expect(selectKeyName({ trackKey: null })).toBeNull();
    expect(selectKeyName({ trackKey: { name: "F# minor" } })).toBe("F# minor");
  });
});
