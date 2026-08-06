import { describe, expect, it } from "vitest";
import { bassCircle } from "./bassCircle";
import { ledMatrix } from "./ledMatrix";
import { radialBurst } from "./radialBurst";
import { spectrumBars } from "./spectrumBars";

const COLOR_PRESETS = [spectrumBars, bassCircle, radialBurst, ledMatrix];

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
});
