import { describe, expect, it } from "vitest";
import { parseTheme, serializeTheme, THEME_VERSION, ThemeParseError } from "./themes";
import { FACTORY_THEMES } from "./factoryThemes";
import { allParams } from "../render/types";
import { presetById } from "../render/presets";

const base = FACTORY_THEMES[0];

describe("themes", () => {
  it("round-trips meta + document", () => {
    const json = serializeTheme(base.document, base.meta, "0.0.0-test");
    const { meta, document } = parseTheme(json);
    expect(meta.name).toBe(base.meta.name);
    expect(meta.author).toBe(base.meta.author);
    expect(meta.license).toBe(base.meta.license);
    expect(document.presetId).toBe(base.document.presetId);
    expect(document.post).toEqual(base.document.post);
  });

  it("rejects non-theme files with clear errors", () => {
    expect(() => parseTheme("not json")).toThrow(ThemeParseError);
    expect(() => parseTheme("{}")).toThrow(/Not an .avtheme/);
    expect(() => parseTheme(JSON.stringify({ kind: "avproj" }))).toThrow(/Not an .avtheme/);
  });

  it("refuses themes from a newer app instead of misreading them", () => {
    const json = serializeTheme(base.document, base.meta, "x");
    const file = JSON.parse(json);
    file.schemaVersion = THEME_VERSION + 1;
    expect(() => parseTheme(JSON.stringify(file))).toThrow(/newer app version/);
    const file2 = JSON.parse(json);
    file2.projectSchemaVersion = 999;
    expect(() => parseTheme(JSON.stringify(file2))).toThrow(/newer document format/);
  });

  it("requires a name, defaults author/license, strips non-inline thumbnails", () => {
    const json = serializeTheme(base.document, base.meta, "x");
    const noName = JSON.parse(json);
    noName.meta = { name: "  " };
    expect(() => parseTheme(JSON.stringify(noName))).toThrow(/no name/);

    const sketchy = JSON.parse(json);
    sketchy.meta = { name: "T", thumbnail: "https://evil.example/x.png" };
    const parsed = parseTheme(JSON.stringify(sketchy));
    expect(parsed.meta.thumbnail).toBeUndefined();
    expect(parsed.meta.author).toBe("unknown");
    expect(parsed.meta.license).toBe("unspecified");

    const inline = JSON.parse(json);
    inline.meta = { name: "T", thumbnail: "data:image/png;base64,AAAA" };
    expect(parseTheme(JSON.stringify(inline)).meta.thumbnail).toBe("data:image/png;base64,AAAA");
  });

  it("a hostile document degrades to defaults instead of crashing", () => {
    const json = serializeTheme(base.document, base.meta, "x");
    const evil = JSON.parse(json);
    evil.document = { presetId: "not-a-preset", post: { exposure: "NaN" }, assets: 42 };
    const { document } = parseTheme(JSON.stringify(evil));
    expect(typeof document.presetId).toBe("string");
    expect(document.post.exposure).toBe(1); // neutral, not a black screen
    expect(document.assets).toEqual({});
  });
});

describe("factory themes", () => {
  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s survives serialize -> parse with preset + params intact",
    (_name, t) => {
      const { meta, document } = parseTheme(serializeTheme(t.document, t.meta, "x"));
      expect(meta.name).toBe(t.meta.name);
      expect(document.presetId).toBe(t.document.presetId);
      // Every tuned param key must exist on the preset it targets — a typo'd
      // key would silently do nothing and ship a broken factory look.
      const spec = new Map(allParams(presetById(t.document.presetId)).map((p) => [p.key, p]));
      const tuned = t.document.paramsByPreset[t.document.presetId] ?? {};
      for (const [key, value] of Object.entries(tuned)) {
        const s = spec.get(key);
        expect(s, `${t.meta.name}: unknown param "${key}"`).toBeDefined();
        expect(value, `${t.meta.name}: ${key} out of range`).toBeGreaterThanOrEqual(s!.min);
        expect(value, `${t.meta.name}: ${key} out of range`).toBeLessThanOrEqual(s!.max);
      }
    },
  );

  it("names are unique", () => {
    const names = FACTORY_THEMES.map((t) => t.meta.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
