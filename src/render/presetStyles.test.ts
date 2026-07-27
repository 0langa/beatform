import { describe, expect, it } from "vitest";
import { presets } from "./presets";
import { allParams, defaultParams, groupParams } from "./types";

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

    // A toggle's spec being 0/1/step-1 is checked in paramModel.test; what is
    // checked HERE is that a style actually lands on one of the two positions.
    // A style writing 0.5 into a toggle renders as "on" (every shader tests
    // `> 0.5`) while the switch draws as off — the chip and the control
    // disagreeing about the look the user just applied.
    it(`${preset.id}: style values for toggles are exactly 0 or 1`, () => {
      for (const style of preset.styles ?? []) {
        for (const [key, value] of Object.entries(style.values)) {
          if (specs.get(key)?.control !== "toggle") continue;
          expect([0, 1], `${preset.id}/${style.id}: ${key}=${value}`).toContain(value);
        }
      }
    });

    it(`${preset.id}: style ids and names are unique`, () => {
      const styles = preset.styles ?? [];
      expect(new Set(styles.map((s) => s.id)).size, `${preset.id}: duplicate style id`).toBe(
        styles.length,
      );
      expect(new Set(styles.map((s) => s.name)).size, `${preset.id}: duplicate style name`).toBe(
        styles.length,
      );
    });

    // `values` is a PARTIAL: applyStyle spreads it over defaultParams, so a key
    // set to its own default changes nothing. Restating one is dead weight that
    // hides the handful of knobs a look actually moves — and it silently
    // pins the look if that default is ever retuned.
    it(`${preset.id}: no style restates a param's default`, () => {
      const defaults = defaultParams(preset);
      for (const style of preset.styles ?? []) {
        for (const [key, value] of Object.entries(style.values)) {
          if (!specs.has(key)) continue;
          expect(
            value !== defaults[key],
            `${preset.id}/${style.id}: ${key}=${value} is already the default — drop it`,
          ).toBe(true);
        }
      }
    });

    // The set has to read as a set: a shipped look is a starting point, and two
    // chips that resolve to the same parameters are one chip with two names.
    it(`${preset.id}: no two styles resolve to the same parameters`, () => {
      const defaults = defaultParams(preset);
      const seen = new Map<string, string>();
      for (const style of preset.styles ?? []) {
        const key = JSON.stringify({ ...defaults, ...style.values });
        const twin = seen.get(key);
        expect(twin, `${preset.id}: "${style.id}" is identical to "${twin}"`).toBeUndefined();
        seen.set(key, style.id);
      }
    });

    // The design rule these looks are authored against: a look must change how
    // the mode BEHAVES, not only what colour it is. Two chips separated by hue
    // alone are a recolour, and the panel already has a hue wheel for that.
    it(`${preset.id}: no two styles differ only in colour`, () => {
      const defaults = defaultParams(preset);
      const colorKeys = new Set(
        groupParams(preset, allParams(preset))
          .filter((g) => g.group.id === "color")
          .flatMap((g) => g.params.map((p) => p.key)),
      );
      const styles = preset.styles ?? [];
      for (let i = 0; i < styles.length; i++) {
        for (let j = i + 1; j < styles.length; j++) {
          const a = { ...defaults, ...styles[i].values };
          const b = { ...defaults, ...styles[j].values };
          const differing = Object.keys(a).filter((k) => a[k] !== b[k]);
          expect(
            differing.some((k) => !colorKeys.has(k)),
            `${preset.id}: "${styles[i].id}" and "${styles[j].id}" differ only in colour ` +
              `(${differing.join(", ")})`,
          ).toBe(true);
        }
      }
    });

    it(`${preset.id}: ships a curated set whose first entry is the defaults`, () => {
      const styles = preset.styles ?? [];
      if (styles.length === 0) return; // Builder Studio ships none, by design
      // Documented on PresetDef.styles: the first entry IS the defaults, so the
      // strip always opens on a chip that reads as active.
      expect(
        Object.keys(styles[0].values),
        `${preset.id}: first style is not the defaults`,
      ).toHaveLength(0);
      expect(styles.length, `${preset.id}: only ${styles.length} looks`).toBeGreaterThanOrEqual(4);
      for (const s of styles.slice(1)) {
        expect(
          Object.keys(s.values).length,
          `${preset.id}/${s.id}: an empty look is a duplicate of the defaults`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
