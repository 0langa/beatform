import { describe, expect, it } from "vitest";
import { advancedKeys, allParams } from "../types";
import { WGSL_RGB_CONTROLS } from "../wgslLib";
import { aurora } from "./aurora";
import { bassCircle } from "./bassCircle";
import { echoTrails } from "./echoTrails";
import { gatefold } from "./gatefold";
import { ledMatrix } from "./ledMatrix";
import { lyricStage } from "./lyricStage";
import { metaballs } from "./metaballs";
import { nebula } from "./nebula";
import { oscilloscope } from "./oscilloscope";
import { overgrowth } from "./overgrowth";
import { radialBurst } from "./radialBurst";
import { spectroFalls } from "./spectroFalls";
import { spectrumBars } from "./spectrumBars";
import { synthwave } from "./synthwave";
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
  oscilloscope,
  synthwave,
];

/**
 * Modes that author colour as RGB — cosine palettes, tinted whites, cover
 * art. The finished frame (or, in a feedback accumulator, every injected
 * colour) rides presetRgb, and there is no hsl2rgb() at all, so nothing can
 * bypass the map.
 */
const PALETTE_PRESETS = [tunnelRings, metaballs, voiceOrb, echoTrails, aurora];

describe("full preset color controls", () => {
  for (const preset of [...COLOR_PRESETS, ...PALETTE_PRESETS, nebula]) {
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

  it("Oscilloscope routes its white-hot beam cores through the controls", () => {
    // Definition + the sweep face's core + the XY face's core — the mode's
    // only authored RGB. Pure white is achromatic, so this is for lightness:
    // a "0 = black" that leaves a white hairline is not black.
    expect(oscilloscope.wgsl.match(/presetRgb\(/g)).toHaveLength(3);
  });

  it("Synthwave routes its tinted whites through the controls", () => {
    // Definition + lane markers, the sun's two hot-core tints, the stars and
    // the lit windows — every warm or cool white the sky and road are painted
    // with. Any one of them raw would tint the grayscale frame.
    expect(synthwave.wgsl.match(/presetRgb\(/g)).toHaveLength(6);
  });

  it("Echo Trails routes what it injects, never what it feeds back", () => {
    // Definition + the three injection sites (spectrum ring, cover source,
    // kick core). The history sample is last frame's already-routed output:
    // routing it again would compound the map once per frame.
    expect(echoTrails.wgsl.match(/presetRgb\(/g)).toHaveLength(4);
    expect(echoTrails.wgsl).not.toMatch(/presetRgb\(\s*feedbackSample/);
  });

  it("Metaballs routes the fresh frame before the smear fold", () => {
    // The smear max()-folds last frame's raw output back in; that history is
    // already routed, so the map lands on the fresh frame only.
    const routed = metaballs.wgsl.indexOf("col = presetRgb(col);");
    const fold = metaballs.wgsl.indexOf("var outCol = max(col, vec3f(0.0));");
    expect(routed).toBeGreaterThan(-1);
    expect(fold).toBeGreaterThan(routed);
  });

  it("Kaleido Nebula keeps its RP-6 saturation law and reaches true gray below every style", () => {
    // RP-6 made nebula's saturation a palette-chroma scaler anchored on the
    // old authored point (nebula.test.ts pins the arithmetic and the v14
    // migration divides by the same constant). Its floor is chroma 0.06 —
    // "near-gray" — and the dark field and warm highlight tints never passed
    // through it, so saturation 0 was never grayscale. Any change to the
    // curve at the styles' own saturations would move their pixel hashes,
    // so the gray-mix fades in only UNDER them: k = min(s * 16, 1) is exactly
    // 1.0 for every s >= 1/16, and the lowest factory style sits at 0.1.
    expect(nebula.wgsl).toContain("let chroma = mix(0.06, 0.5, P_saturation() * 0.75);");
    expect(nebula.wgsl).toContain(WGSL_RGB_CONTROLS);
    // Definition + the presetRgb wrapper's call inside the shared helper + the
    // one call site below, which feeds the derived control instead of P_saturation().
    expect(nebula.wgsl.match(/presetRgbAt\(/g)).toHaveLength(3);
    expect(nebula.wgsl).toContain(
      "col = presetRgbAt(col, min(P_saturation() * 16.0, 1.0), P_lightness());",
    );
    for (const style of nebula.styles ?? []) {
      const s = style.values.saturation ?? 1;
      expect(Math.min(Math.fround(s) * 16, 1), `${style.id} sits under the knee`).toBe(1);
    }
    // The ABI keeps saturation where RP-6 froze it (advanced[]); lightness
    // joins it there, both promoted to the curated tier in place.
    const advanced = nebula.advanced ?? [];
    const sat = advanced.find((p) => p.key === "saturation");
    const light = advanced.find((p) => p.key === "lightness");
    expect(sat?.tier).toBe("curated");
    expect(light?.tier).toBe("curated");
  });
});
