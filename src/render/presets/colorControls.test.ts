import { describe, expect, it } from "vitest";
import { bassCircle } from "./bassCircle";
import { ledMatrix } from "./ledMatrix";
import { lyricStage } from "./lyricStage";
import { radialBurst } from "./radialBurst";
import { spectroFalls } from "./spectroFalls";
import { spectrumBars } from "./spectrumBars";

// P-19 joined the club twice: Spectro Falls and Lyric Stage are modes whose
// identity rides on colour, so the global saturation/lightness pair belongs
// on them — and routing every authored colour through presetColor is what
// lets the GPU matrix's color/grayscale case prove the palette is honest.
const COLOR_PRESETS = [spectrumBars, bassCircle, radialBurst, ledMatrix, spectroFalls, lyricStage];

describe("full preset color controls", () => {
  for (const preset of COLOR_PRESETS) {
    it(`${preset.name} exposes pixel-neutral saturation and lightness defaults`, () => {
      const saturation = preset.params.find((param) => param.key === "saturation");
      const lightness = preset.params.find((param) => param.key === "lightness");

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
    });

    it(`${preset.name} routes every authored HSL color through global controls`, () => {
      expect(preset.wgsl.match(/hsl2rgb\(/g)).toHaveLength(1);
      expect(preset.wgsl).toContain(
        "return hsl2rgb(h, colorScale(s, P_saturation()), colorScale(l, P_lightness()));",
      );
      expect(preset.wgsl).toContain("return min(value * control, 1.0);");
      expect(preset.wgsl.match(/presetColor\(/g)?.length ?? 0).toBeGreaterThan(1);
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
});
