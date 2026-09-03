import { describe, expect, it } from "vitest";
import { advancedKeys, allParams } from "../types";
import { WGSL_RGB_CONTROLS } from "../wgslLib";
import { aurora } from "./aurora";
import { bassCircle } from "./bassCircle";
import { gatefold } from "./gatefold";
import { ledMatrix } from "./ledMatrix";
import { lyricStage } from "./lyricStage";
import { metaballs } from "./metaballs";
import { overgrowth } from "./overgrowth";
import { radialBurst } from "./radialBurst";
import { spectroFalls } from "./spectroFalls";
import { spectrumBars } from "./spectrumBars";
import { tunnelRings } from "./tunnelRings";
import { voiceOrb } from "./voiceOrb";

// P-19 joined the club four times: Spectro Falls, Lyric Stage, Gatefold and
// Overgrowth are modes whose identity rides on colour, so the global
// saturation/lightness pair belongs on them — and routing every authored
// colour through presetColor is what lets the GPU matrix's color/grayscale
// case prove the palette is honest.
//
// HD-06 (v2.111.0) then closed the strip: the eight modes that still authored
// their colour without the pair got it — HSL modes through presetColor, the
// cosine-palette modes through presetRgb on the finished frame, Kaleido
// Nebula through its own RP-6 law — so every mode on the strip answers the
// same two knobs and carries the same two color/grayscale matrix cases.
// Builder (builder2) is the declared exception: its params are per-layer
// virtual keys mirrored from the stack, and a global pair there needs a
// stack-format change.

/** Modes that author colour in HSL: every hsl2rgb() rides presetColor. */
const COLOR_PRESETS = [
  spectrumBars,
  bassCircle,
  radialBurst,
  ledMatrix,
  spectroFalls,
  lyricStage,
  gatefold,
  overgrowth,
];

/**
 * Modes that author colour as RGB — cosine palettes, tinted whites, cover
 * art. The finished frame (or, in a feedback accumulator, every injected
 * colour) rides presetRgb, and there is no hsl2rgb() at all, so nothing can
 * bypass the map.
 */
const PALETTE_PRESETS = [tunnelRings, metaballs, voiceOrb, aurora];

describe("full preset color controls", () => {
  for (const preset of [...COLOR_PRESETS, ...PALETTE_PRESETS]) {
    it(`${preset.name} exposes pixel-neutral saturation and lightness defaults`, () => {
      const specs = allParams(preset);
      const saturation = specs.find((param) => param.key === "saturation");
      const lightness = specs.find((param) => param.key === "lightness");

      expect(saturation).toMatchObject({
        group: "color",
        min: 0,
        max: 2,
        default: 1,
      });
      expect(lightness).toMatchObject({
        group: "color",
        min: 0,
        max: 2,
        default: 1,
      });
      // The pair renders in the curated tier on every mode: in params[] (the
      // roster default) or — Kaleido Nebula, whose saturation the ABI froze
      // in advanced[] under RP-6 — re-tiered in place with `tier: "curated"`.
      const expert = advancedKeys(preset);
      expect(expert.has("saturation")).toBe(false);
      expect(expert.has("lightness")).toBe(false);
      // Adjacent in the ABI, saturation first: one pair, one place.
      expect(specs[specs.indexOf(saturation!) + 1]).toBe(lightness);
    });
  }

  for (const preset of COLOR_PRESETS) {
    it(`${preset.name} routes every authored HSL color through global controls`, () => {
      expect(preset.wgsl.match(/hsl2rgb\(/g)).toHaveLength(1);
      expect(preset.wgsl).toContain(
        "return hsl2rgb(h, colorScale(s, P_saturation()), colorScale(l, P_lightness()));",
      );
      expect(preset.wgsl).toContain("return min(value * control, 1.0);");
      expect(preset.wgsl.match(/presetColor\(/g)?.length ?? 0).toBeGreaterThan(1);
    });
  }

  for (const preset of PALETTE_PRESETS) {
    it(`${preset.name} routes its palette through the RGB controls`, () => {
      expect(preset.wgsl).toContain(WGSL_RGB_CONTROLS);
      expect(preset.wgsl.match(/presetRgb\(/g)?.length ?? 0).toBeGreaterThan(1);
      // Nothing authored in HSL, so nothing outside the map.
      expect(preset.wgsl.match(/hsl2rgb\(/g)).toBeNull();
    });
  }

  it("LED Matrix also routes authored RGB tints through the controls", () => {
    // Definition + panel background + board grid + the two hot-core
    // desaturation mixes (one per display branch: Bars and Waterfall).
    expect(ledMatrix.wgsl.match(/presetRgb\(/g)).toHaveLength(5);
    expect(ledMatrix.wgsl).toContain("let gray = vec3f(dot(rgb");
  });

  it("Lyric Stage routes its chromatic-fringe tints through the controls", () => {
    // Definition + the two fringe call sites. The fringe is the mode's one
    // authored-RGB paint; a raw literal there fringed red/blue over a
    // grayscale stage (saturation 0), contradicting the control's own hint.
    expect(lyricStage.wgsl.match(/presetRgb\(/g)).toHaveLength(3);
    expect(lyricStage.wgsl).toContain("let gray = vec3f(dot(rgb");
  });

  it("Gatefold routes the artwork itself through the controls", () => {
    // Definition + the one cover call site. The art is this mode's whole
    // authored-RGB surface; a raw coverSample().rgb would leave a
    // full-colour sleeve standing in a grayscale room at saturation 0.
    expect(gatefold.wgsl.match(/presetRgb\(/g)).toHaveLength(2);
    expect(gatefold.wgsl).toContain("let gray = vec3f(dot(rgb");
  });

  it("Metaballs routes the fresh frame before the smear fold", () => {
    // The smear max()-folds last frame's raw output back in; that history is
    // already routed, so the map lands on the fresh frame only.
    const routed = metaballs.wgsl.indexOf("col = presetRgb(col);");
    const fold = metaballs.wgsl.indexOf("var outCol = max(col, vec3f(0.0));");
    expect(routed).toBeGreaterThan(-1);
    expect(fold).toBeGreaterThan(routed);
  });
});
