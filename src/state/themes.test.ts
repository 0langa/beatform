import { describe, expect, it } from "vitest";
import { parseTheme, serializeTheme, THEME_VERSION, ThemeParseError } from "./themes";
import { FACTORY_THEMES } from "./factoryThemes";
import { allParams } from "../render/types";
import { presetById } from "../render/presets";
import { PROJECT_VERSION, validateDocument, type ProjectDocument } from "./project";

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
    expect(() => parseTheme("{}")).toThrow(/Not a .bftheme/);
    expect(() => parseTheme(JSON.stringify({ kind: "bfproj" }))).toThrow(/Not a .bftheme/);
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

/**
 * v14 nebula-saturation migration, threaded through the .bftheme envelope.
 *
 * Schema v14 changed Kaleido Nebula's `saturation` from a raw 0..1 palette mix
 * (authored default 0.75) to a 0..2 whole-visual scaler with neutral 1.
 * .bfproj rides that migration in parseProject; a .bftheme carries the same
 * documents and, until this change, did not — a pre-v14 theme imported flat.
 *
 * Every fixture below is HAND-WRITTEN JSON rather than built with
 * serializeTheme, which stamps projectSchemaVersion: PROJECT_VERSION and would
 * make every one of these assertions vacuous.
 */
describe("theme documents ride the v14 nebula-saturation migration", () => {
  const themeJson = (projectSchemaVersion: number | undefined, document: unknown) =>
    JSON.stringify({
      kind: "bftheme",
      schemaVersion: THEME_VERSION,
      ...(projectSchemaVersion === undefined ? {} : { projectSchemaVersion }),
      appVersion: "2.74.0",
      meta: { name: "Old Nebula", author: "someone", license: "CC0-1.0" },
      document,
    });

  /**
   * Old-semantics values at all three sites the migration touches.
   *
   * 0.6 is deliberate on both counts: it is NOT the authored default (which
   * would still move, but to the one value the reader expects anyway), and it
   * is NOT 0, which is a FIXED POINT of v / 0.75 and so could never reach the
   * failure this file is trying to catch.
   */
  const nebulaDoc = {
    presetId: "nebula",
    paramsByPreset: { nebula: { saturation: 0.6, hue: 10 } },
    modsByPreset: { nebula: [{ id: "r1", source: "bass", param: "saturation", amount: 0.6 }] },
    timeline: {
      enabled: true,
      scenes: [
        { id: "s1", name: "Drop", presetId: "nebula", start: 0, params: { saturation: 0.6 } },
      ],
      lanes: [],
    },
    // Explicit (empty) rather than absent: an ABSENT stack makes
    // validateDocument mint a starter stack with freshly RANDOM layer ids, and
    // the whole-document deep-equals below would compare two different draws
    // and fail for a reason that has nothing to do with saturation.
    builderStack: { layers: [] },
  };

  // B1. MUTATION: revert parseTheme to `validateDocument(file.document)`.
  // REACHABLE because validParamsByPreset only rejects non-finite numbers — it
  // does not clamp — so the migrated 0.8 survives verbatim into the assertion.
  it("B1: a pre-v14 (psv 13) nebula theme is remapped at all three sites", () => {
    const { document } = parseTheme(themeJson(13, nebulaDoc));
    expect(document.paramsByPreset.nebula.saturation).toBeCloseTo(0.8, 12); // 0.6 / 0.75
    expect(document.timeline.scenes[0].params!.saturation).toBeCloseTo(0.8, 12);
    expect(document.modsByPreset.nebula[0].amount).toBeCloseTo(0.4, 12); // 0.6 / 1.5
    expect(document.paramsByPreset.nebula.hue).toBe(10); // innocent bystander
  });

  // B2. MUTATION: drop the guard so parseTheme always migrates. REACHABLE
  // because 0.6 is not a fixed point — an unconditional remap moves it to 0.8
  // and the deep-equal fails on the first site.
  it("B2: a psv-14 theme is byte-identical — the migration must not run twice", () => {
    const { document } = parseTheme(themeJson(14, nebulaDoc));
    expect(document.paramsByPreset.nebula.saturation).toBe(0.6);
    expect(document).toEqual(validateDocument(nebulaDoc as Partial<ProjectDocument>));
  });

  /**
   * B3. The gate is the LITERAL 14, never PROJECT_VERSION.
   *
   * HONEST LIMIT, stated so nobody mistakes this matrix for more than it is:
   * while PROJECT_VERSION === 14, `psv < 14` and `psv < PROJECT_VERSION` are
   * the SAME expression, so NO test can distinguish them right now — this one
   * included. It is green under both.
   *
   * What it guarantees is that the distinction is caught the FIRST TIME IT
   * MATTERS. The row list is `1..PROJECT_VERSION`, so v = 14 is already in it,
   * and it grows with every future bump. The moment PROJECT_VERSION becomes
   * 15, a `psv < PROJECT_VERSION` gate starts migrating v-14 themes that are
   * already correct — the v-14 row (with B2 and B4) goes red inside the very
   * release that bumps the version, instead of shipping every stored theme
   * quietly re-divided by 0.75. Verified by mutation: with the gate inlined as
   * `psv < 15` (exactly how `psv < PROJECT_VERSION` reads in that release),
   * this row fails. Nothing more is claimed.
   */
  const versions = Array.from({ length: PROJECT_VERSION }, (_, i) => i + 1);
  it.each(versions)("B3: psv %i -> nebula saturation remapped iff the schema is pre-14", (v) => {
    const { document } = parseTheme(themeJson(v, nebulaDoc));
    const want = v < 14 ? 0.8 : 0.6;
    expect(document.paramsByPreset.nebula.saturation).toBeCloseTo(want, 12);
    expect(document.timeline.scenes[0].params!.saturation).toBeCloseTo(want, 12);
    expect(document.modsByPreset.nebula[0].amount).toBeCloseTo(v < 14 ? 0.4 : 0.6, 12);
  });

  // An absent field means pre-v14: serializeTheme has always written it, so a
  // theme without one cannot have come from Beatform, and treating it as
  // pre-v14 is the branch that keeps hand-authored legacy files honest.
  it("treats an absent projectSchemaVersion as pre-v14 and migrates", () => {
    const { document } = parseTheme(themeJson(undefined, nebulaDoc));
    expect(document.paramsByPreset.nebula.saturation).toBeCloseTo(0.8, 12);
  });

  // B4. MUTATION: move the gate INSIDE validateDocument (i.e. make it
  // version-independent). REACHABLE because the re-serialized theme is stamped
  // 14 but a version-independent migration ignores that and divides again —
  // 0.8 becomes 1.0666… and the second parse diverges from the first.
  it("B4: parse -> serialize -> parse is a fixpoint, re-stamped at the current schema", () => {
    const first = parseTheme(themeJson(13, nebulaDoc));
    const json = serializeTheme(first.document, first.meta, "0.0.0-test");
    expect(JSON.parse(json).projectSchemaVersion).toBe(PROJECT_VERSION);
    expect(JSON.parse(json).projectSchemaVersion).toBe(14);
    const second = parseTheme(json);
    expect(second.document.paramsByPreset.nebula.saturation).toBeCloseTo(0.8, 12);
    expect(second.document).toEqual(first.document);
  });

  // B5. MUTATION: key the migration on anything but the literal "nebula" — the
  // bare param name, say. REACHABLE because "particles" owns a `saturation` of
  // its own that ALWAYS had scaler semantics; a param-keyed migration would
  // divide it and the deep-equal against the un-migrated parse fails.
  it("B5: a non-nebula psv-13 theme is untouched", () => {
    const particlesDoc = {
      presetId: "particles",
      paramsByPreset: { particles: { saturation: 0.6 } },
      modsByPreset: {
        particles: [{ id: "r1", source: "bass", param: "saturation", amount: 0.6 }],
      },
      timeline: {
        enabled: true,
        scenes: [
          { id: "s1", name: "A", presetId: "particles", start: 0, params: { saturation: 0.6 } },
        ],
        lanes: [],
      },
      builderStack: { layers: [] },
    };
    const { document } = parseTheme(themeJson(13, particlesDoc));
    expect(document.paramsByPreset.particles.saturation).toBe(0.6);
    expect(document).toEqual(validateDocument(particlesDoc as Partial<ProjectDocument>));
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
