import { describe, expect, it } from "vitest";
import { presets } from "./presets";
import { allParams } from "./types";

/**
 * Every factory style must be reachable by the sliders that edit it.
 *
 * `applyStyle` writes a style's values into the document verbatim — no clamp,
 * no snap. So a style value outside its param's range, or off its step grid,
 * renders one way when the chip is clicked and CHANGES the moment the user
 * nudges that slider, because the range input rewrites it onto the grid. The
 * style chip then stops reading as active for a look the user never altered.
 *
 * Nothing checked this before: `themes.test.ts` validates FACTORY_THEMES only,
 * so a Tunnel style shipped with `fogFar: 1.0` against a spec max of 0.95 and
 * went unnoticed through a full release. These two tests cover every built-in
 * preset, so the whole class is closed rather than the one instance.
 */
describe("preset factory styles", () => {
  for (const preset of presets) {
    const specs = new Map(allParams(preset).map((p) => [p.key, p]));

    it(`${preset.id}: style values target real params and stay in range`, () => {
      for (const style of preset.styles ?? []) {
        for (const [key, value] of Object.entries(style.values)) {
          const spec = specs.get(key);
          expect(spec, `${preset.id}/${style.id}: unknown param "${key}"`).toBeDefined();
          if (!spec) continue;
          expect(Number.isFinite(value), `${preset.id}/${style.id}/${key} is not finite`).toBe(
            true,
          );
          const v = value as number;
          expect(
            v >= spec.min && v <= spec.max,
            `${preset.id}/${style.id}: ${key}=${v} outside ${spec.min}..${spec.max}`,
          ).toBe(true);
        }
      }
    });

    it(`${preset.id}: style values sit on their param's step grid`, () => {
      for (const style of preset.styles ?? []) {
        for (const [key, value] of Object.entries(style.values)) {
          const spec = specs.get(key);
          if (!spec || !(spec.step > 0)) continue;
          const v = value as number;
          // The same rounding a native range input applies to its own value.
          const steps = (v - spec.min) / spec.step;
          const off = Math.abs(steps - Math.round(steps));
          expect(
            off < 1e-6,
            `${preset.id}/${style.id}: ${key}=${v} is off the ${spec.step} grid ` +
              `(nearest reachable: ${spec.min + Math.round(steps) * spec.step})`,
          ).toBe(true);
        }
      }
    });
  }
});
