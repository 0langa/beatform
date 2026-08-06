import { describe, expect, it } from "vitest";
import { presets } from "./presets";
import { builder } from "./presets/builder";
import {
  allParams,
  defaultParams,
  FALLBACK_GROUP,
  groupParams,
  isModTarget,
  paramSearchText,
  presetGroups,
  type ParamSpec,
  type PresetDef,
} from "./types";

/**
 * The param MODEL: what a spec may declare, where it lands in the panel, and
 * in what order. The panel itself holds no list of keys, so these rules are
 * the whole contract between a preset author and the settings UI.
 */

/** Every preset the strip can show, plus the hidden-but-renderable classic. */
const ALL: PresetDef[] = [...presets, builder];

/** A stand-in preset, so the ordering rules are tested on data written FOR
 * them rather than on whatever the shipped presets happen to declare. */
function fixture(params: ParamSpec[], groups?: PresetDef["groups"]): PresetDef {
  return { id: "fx", name: "Fx", params, ...(groups ? { groups } : {}), wgsl: "" };
}
const num = (key: string, over: Partial<ParamSpec> = {}): ParamSpec =>
  ({ key, label: key, min: 0, max: 1, step: 0.01, default: 0, ...over }) as ParamSpec;

describe("declared grouping", () => {
  for (const preset of ALL) {
    it(`${preset.id}: every param declares a group that resolves`, () => {
      const defs = presetGroups(preset);
      for (const spec of allParams(preset)) {
        expect(spec.group, `${preset.id}/${spec.key} has no group`).toBeTruthy();
        expect(
          defs.has(spec.group ?? ""),
          `${preset.id}/${spec.key}: unknown group "${spec.group}"`,
        ).toBe(true);
      }
    });

    it(`${preset.id}: nothing falls into the catch-all group`, () => {
      // FALLBACK_GROUP is a safety net for a param that forgot to declare
      // one, never a place a shipped knob is allowed to live — a "More"
      // bucket that fills up is the flat list coming back.
      const views = groupParams(preset, allParams(preset));
      expect(views.map((v) => v.group.id)).not.toContain(FALLBACK_GROUP.id);
    });
  }

  it("Builder's own layer groups override the shared registry", () => {
    // Builder is the proof that per-preset groups work: sorting its knobs by
    // the shared axes would scatter each layer across the whole panel.
    const ids = groupParams(builder, allParams(builder)).map((v) => v.group.id);
    expect(ids).toContain("lbars");
    expect(ids).toContain("lrings");
    // Colour (rank 20) still comes first, then the layer groups (21..28).
    expect(ids.indexOf("color")).toBeLessThan(ids.indexOf("layers"));
    expect(ids.indexOf("layers")).toBeLessThan(ids.indexOf("lbars"));
    expect(ids.indexOf("lbars")).toBeLessThan(ids.indexOf("lrings"));
  });
});

describe("groupParams ordering", () => {
  it("orders groups by declared rank, not by the order params appear", () => {
    const p = fixture([
      num("a", { group: "backdrop" }), // rank 80
      num("b", { group: "shape" }), // rank 10
      num("c", { group: "color" }), // rank 20
    ]);
    expect(groupParams(p, allParams(p)).map((v) => v.group.id)).toEqual([
      "shape",
      "color",
      "backdrop",
    ]);
  });

  it("orders params inside a group by `order`, then by declaration", () => {
    const p = fixture([
      num("first", { group: "shape" }),
      num("second", { group: "shape" }),
      num("pinned", { group: "shape", order: -1 }),
    ]);
    expect(groupParams(p, allParams(p))[0].params.map((s) => s.key)).toEqual([
      "pinned",
      "first",
      "second",
    ]);
  });

  it("is stable when two groups share a rank", () => {
    const p = fixture(
      [num("a", { group: "zz" }), num("b", { group: "aa" })],
      [
        { id: "zz", label: "Zz", rank: 5 },
        { id: "aa", label: "Aa", rank: 5 },
      ],
    );
    // Ties break on id, so the panel cannot reorder itself between renders.
    expect(groupParams(p, allParams(p)).map((v) => v.group.id)).toEqual(["aa", "zz"]);
  });

  it("drops groups nothing opted into, and keeps a filtered subset grouped", () => {
    const p = fixture([num("a", { group: "shape" }), num("b", { group: "color" })]);
    const only = allParams(p).filter((s) => s.key === "b");
    expect(groupParams(p, only).map((v) => v.group.id)).toEqual(["color"]);
  });

  it("sends an unknown or missing group to the catch-all instead of dropping it", () => {
    const p = fixture([num("a", { group: "nope" }), num("b")]);
    const views = groupParams(p, allParams(p));
    expect(views).toHaveLength(1);
    expect(views[0].group.id).toBe(FALLBACK_GROUP.id);
    expect(views[0].params.map((s) => s.key)).toEqual(["a", "b"]);
  });
});

describe("control types", () => {
  for (const preset of ALL) {
    it(`${preset.id}: enum options are reachable values, and cover every style`, () => {
      const defaults = defaultParams(preset);
      for (const spec of allParams(preset)) {
        if (spec.control !== "enum") continue;
        const values = spec.options.map((o) => o.value);
        expect(new Set(values).size, `${preset.id}/${spec.key}: duplicate option`).toBe(
          values.length,
        );
        for (const v of values) {
          expect(
            v >= spec.min && v <= spec.max,
            `${preset.id}/${spec.key}: ${v} out of range`,
          ).toBe(true);
          const steps = (v - spec.min) / spec.step;
          expect(
            Math.abs(steps - Math.round(steps)) < 1e-6,
            `${preset.id}/${spec.key}: ${v} is off the ${spec.step} grid`,
          ).toBe(true);
        }
        // The default and every factory style must SELECT something. A style
        // that sets a value with no option would render as "Custom (6)" — the
        // dropdown quietly telling the user their own preset is broken.
        expect(values, `${preset.id}/${spec.key}: default is not an option`).toContain(
          defaults[spec.key],
        );
        for (const style of preset.styles ?? []) {
          const v = style.values[spec.key];
          if (v === undefined) continue;
          expect(values, `${preset.id}/${style.id}: ${spec.key}=${v} is not an option`).toContain(
            v,
          );
        }
      }
    });

    it(`${preset.id}: toggles are 0/1 and land on 0 or 1`, () => {
      for (const spec of allParams(preset)) {
        if (spec.control !== "toggle") continue;
        expect([spec.min, spec.max, spec.step]).toEqual([0, 1, 1]);
        expect([0, 1]).toContain(spec.default);
      }
    });

    it(`${preset.id}: hue and angle params are full-turn degree ranges`, () => {
      for (const spec of allParams(preset)) {
        if (spec.control !== "hue" && spec.control !== "angle") continue;
        // The rainbow track and the dial both draw a whole turn; a spec with
        // a partial range would paint a colour/direction it cannot reach.
        expect([spec.min, spec.max], `${preset.id}/${spec.key}`).toEqual([0, 360]);
      }
    });
  }
});

describe("mod metadata (RP-2 / RP-14)", () => {
  for (const preset of ALL) {
    it(`${preset.id}: every toggle opts out of modulation`, () => {
      // Modulating an on/off can only strobe it, and snapping does not make
      // that meaningful — a NEW toggle shipped without mod:"off" recreates
      // audit defect RP-2, so the rule is enforced registry-wide.
      for (const spec of allParams(preset)) {
        if (spec.control !== "toggle") continue;
        expect(spec.mod, `${preset.id}/${spec.key}: toggle without mod:"off"`).toBe("off");
      }
    });

    it(`${preset.id}: every enum declares snap or off — never smooth`, () => {
      // A fractional enum value is a shader-defined accident (3.7 mirror
      // segments). Ordered counts take "snap"; binary/mode choices take "off".
      for (const spec of allParams(preset)) {
        if (spec.control !== "enum") continue;
        expect(
          spec.mod === "snap" || spec.mod === "off",
          `${preset.id}/${spec.key}: enum with continuous modulation`,
        ).toBe(true);
      }
    });

    it(`${preset.id}: snapped enums cover every integer in range`, () => {
      // mod:"snap" quantizes applied modulation to whole numbers, so every
      // integer between min and max must BE an option — otherwise a snapped
      // route can park the param on a value the dropdown calls "Custom".
      for (const spec of allParams(preset)) {
        if (spec.control !== "enum" || spec.mod !== "snap") continue;
        const values = new Set(spec.options.map((o) => o.value));
        for (let v = Math.ceil(spec.min); v <= Math.floor(spec.max); v++) {
          expect(values.has(v), `${preset.id}/${spec.key}: snapped ${v} is not an option`).toBe(
            true,
          );
        }
      }
    });
  }

  it('isModTarget excludes exactly the mod:"off" params', () => {
    expect(isModTarget(num("a"))).toBe(true);
    expect(isModTarget(num("a", { mod: "smooth" }))).toBe(true);
    expect(isModTarget(num("a", { mod: "snap" }))).toBe(true);
    expect(isModTarget(num("a", { mod: "off" }))).toBe(false);
  });

  it("the registry actually exercises all three states (fixture sanity)", () => {
    const specs = ALL.flatMap((p) => allParams(p));
    expect(specs.some((s) => s.mod === "off")).toBe(true);
    expect(specs.some((s) => s.mod === "snap")).toBe(true);
    expect(specs.some((s) => s.mod === undefined)).toBe(true);
  });
});

describe("taper metadata (RP-14)", () => {
  it('taper:"log" only appears on ranges a log can describe (min > 0)', () => {
    for (const preset of ALL) {
      for (const spec of allParams(preset)) {
        if (spec.taper !== "log") continue;
        expect(spec.min, `${preset.id}/${spec.key}: log taper needs min > 0`).toBeGreaterThan(0);
        expect(spec.max).toBeGreaterThan(spec.min);
      }
    }
  });

  it("nebula's scale carries the wave-0 proving taper", () => {
    const nebula = ALL.find((p) => p.id === "nebula")!;
    expect(nebula.params.find((p) => p.key === "scale")?.taper).toBe("log");
  });
});

describe("paramSearchText", () => {
  it("covers label, hint, key and enum choices", () => {
    const spec: ParamSpec = {
      key: "coverFit",
      label: "Image fit",
      group: "image",
      control: "enum",
      options: [
        { value: 0, label: "Fill" },
        { value: 1, label: "Letterbox" },
      ],
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      hint: "How the artwork is framed",
    };
    const text = paramSearchText(spec);
    expect(text).toContain("image fit");
    expect(text).toContain("framed");
    expect(text).toContain("coverfit");
    expect(text).toContain("letterbox");
  });
});
