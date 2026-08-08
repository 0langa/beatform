import { describe, expect, it } from "vitest";
import { presets } from "./index";
import { builder } from "./builder";
import { BUILDER2_ID } from "../builder2";
import { advancedKeys, allParams, groupParams, type PresetDef } from "../types";

/**
 * THE CURATION INVARIANT (P-9, D2).
 *
 * Every group renders its own header and its own Advanced disclosure. A group
 * whose params are ALL expert therefore draws a header over a naked
 * "N expert controls" button — ~50 px of pure chrome saying nothing. Before
 * 2.82.0 that was 13 modes' Backdrop, radial-burst's Reaction and the classic
 * builder's seven layer groups: 21 cells.
 *
 * So: a built-in may not declare a group it has nothing curated to put in it.
 * Enforced here rather than by a checklist, because the failure is invisible
 * in code review — you have to render the panel to see it.
 *
 * THE FIX IS NEVER A MOVE. Add `tier: "curated"` to the one spec in that group
 * a user is most likely to reach for, in place inside `advanced[]`. Moving it
 * into `params[]` would repack the GPU ABI and move every pixel hash
 * (abiOrder.test.ts guards exactly that).
 *
 * Builder Studio (builder2) is excluded: its def is generated from the live
 * layer stack for the mod/MIDI target lists, and BuilderPanel — not
 * ParamGroups — is its editor.
 */
const CURATED_BUILTINS: PresetDef[] = [...presets, builder].filter((p) => p.id !== BUILDER2_ID);

describe("every group a built-in declares has at least one curated param", () => {
  for (const preset of CURATED_BUILTINS) {
    it(`${preset.id} leaves no group header stranded over a bare disclosure`, () => {
      const advanced = advancedKeys(preset);
      const views = groupParams(preset, allParams(preset));
      expect(views.length, `"${preset.id}" declares no groups at all`).toBeGreaterThan(0);
      for (const view of views) {
        expect(
          view.params.some((s) => !advanced.has(s.key)),
          `"${preset.id}" group "${view.group.id}" (${view.group.label}) is 100% expert: ` +
            `${view.params.length} spec(s), zero curated. Mark ONE of them ` +
            `tier: "curated" where it already sits in advanced[].`,
        ).toBe(true);
      }
    });
  }

  it("the 21 promoted cells are all still promoted, and none was moved", () => {
    // The exact promotions of 2.82.0, as a regression anchor: a future edit
    // that drops a `tier` flag fails the per-preset invariant above, but this
    // pins WHICH knob each cell curates so a silent swap is visible in review.
    // All thirteen below are Backdrop — the group that rendered on no mode.
    const promotedBackdrop: Record<string, string> = {
      "spectrum-bars": "vignette",
      "radial-burst": "vignette",
      oscilloscope: "gridLevel",
      particles: "vignette",
      "tunnel-rings": "tileLevel",
      metaballs: "vignette",
      "led-matrix": "panelVariance",
      "voice-orb": "vignette",
      "echo-trails": "vignette",
      "particle-flow": "vignette",
      "spectrum-scape": "fogDensity",
      synthwave: "fog",
      "bass-circle": "vignette",
    };
    for (const [id, key] of Object.entries(promotedBackdrop)) {
      const preset = CURATED_BUILTINS.find((p) => p.id === id)!;
      const spec = (preset.advanced ?? []).find((s) => s.key === key);
      expect(spec, `"${id}" no longer declares advanced "${key}"`).toBeDefined();
      expect(spec!.tier, `"${id}".${key} lost its curated tier`).toBe("curated");
      expect(spec!.group, `"${id}".${key} left the backdrop group`).toBe("backdrop");
    }
    // radial-burst curates two: Backdrop's only spec and Reaction's headline.
    const radial = CURATED_BUILTINS.find((p) => p.id === "radial-burst")!;
    const breathe = (radial.advanced ?? []).find((s) => s.key === "ringBreathe");
    expect(breathe?.tier, "radial-burst.ringBreathe lost its curated tier").toBe("curated");
    expect(breathe?.group).toBe("reaction");
    // The classic builder's seven layer groups, one size/amount knob each.
    const layerKnobs: Record<string, string> = {
      lbars: "barsHeight",
      lradial: "radialLen",
      lline: "lineAmp",
      lcircle: "circleR",
      lorb: "orbSize",
      lstars: "starDensity",
      lrings: "ringEnd",
    };
    for (const [group, key] of Object.entries(layerKnobs)) {
      const spec = (builder.advanced ?? []).find((s) => s.key === key);
      expect(spec?.tier, `builder.${key} lost its curated tier`).toBe("curated");
      expect(spec?.group, `builder.${key} left the ${group} group`).toBe(group);
    }
  });

  it("a curated override never sits at its own min or max (particle-flow aside)", () => {
    // A knob whose factory value is already an edge cannot demonstrate the
    // group by sitting there — you only ever see it move one way. The single
    // exception is particle-flow, whose ENTIRE backdrop group ships off (both
    // specs default to 0); vignette is still the look knob of the two.
    for (const preset of CURATED_BUILTINS) {
      for (const spec of preset.advanced ?? []) {
        if (spec.tier !== "curated") continue;
        if (preset.id === "particle-flow") continue;
        expect(
          spec.default !== spec.min && spec.default !== spec.max,
          `"${preset.id}".${spec.key} is curated but defaults to its own edge ` +
            `(${spec.default} in ${spec.min}..${spec.max})`,
        ).toBe(true);
      }
    }
  });
});
