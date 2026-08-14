import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANDIDATES } from "./candidates";
import { parseTheme, serializeTheme, THEME_VERSION } from "../src/state/themes";
import { PROJECT_VERSION, validateDocument } from "../src/state/project";
import { postTargetKey, POST_TARGET_PREFIX } from "../src/state/modMatrix";
import { presetById } from "../src/render/presets";
import { allParams, POST_MOD_TARGETS, type ParamSpec } from "../src/render/types";
import { APP_VERSION } from "../src/version";

/**
 * Track C1 evidence suite.
 *
 * Two jobs, in this order:
 *
 *  1. EMIT the `.bftheme` files from the typed source, through the app's own
 *     `serializeTheme()`. The files committed beside this test are the exact
 *     bytes the owner would move into the gallery repo.
 *  2. PROVE each emitted file survives the app's real validators losslessly —
 *     that is what PLAN-C1 asks for, and it is a stronger claim than "it
 *     applies". A theme can apply and still not be the theme that was
 *     authored, and the round-trip catches that class as a diff instead of as
 *     a look nobody notices is wrong.
 *
 * TWO MECHANISMS, AND THEY COVER DIFFERENT THINGS. Do not "simplify" the
 * hand-written checks below on the assumption that the round-trip already
 * covers them — it does not, and the split is exactly this:
 *
 *  - The REAL validators (`parseTheme` -> `validateDocument`) catch anything
 *    they normalize: a route `amount` outside -1..1 is CLAMPED
 *    (`validModRoutes`), an unknown sync mode or a malformed sync object is
 *    dropped, a route to a source the validator rejects disappears, an
 *    un-`id`ed keyframe gets a RANDOM id backfilled, timeline scenes are
 *    re-sorted by start, a background pointing at an absent asset degrades to
 *    the preset background, an unknown preset id falls back to the default
 *    mode. Those all surface as a round-trip diff.
 *  - The validators DO NOT look at a param's spec at all. `validParamsByPreset`
 *    keeps every finite number verbatim — no range, no step, no spec lookup —
 *    and `validModRoutes` only length-caps `param` (`.slice(0, 64)`), so a
 *    route pointing at a key the preset does not have round-trips perfectly
 *    and is silently inert at render time. Param range, step-grid alignment,
 *    enum/toggle legality, route-target existence, `mod: "off"` targets and
 *    modulation headroom are caught ONLY by the checks in this file, which
 *    read the LIVE specs through `allParams(presetById(...))`.
 *
 * Beyond the round-trip, this file enforces the things that make a flagship
 * a flagship rather than a recolour, including two rules the app's own suites
 * do not have anywhere:
 *
 *  - STEP-GRID alignment for every authored number. `applyStyle` and the
 *    theme-apply path write values verbatim; the panel's range input snaps to
 *    the spec grid on first touch. An off-grid value therefore renders as
 *    authored until the user so much as brushes the slider, and then quietly
 *    becomes a different look. `src/render/presetStyles.test.ts` enforces this
 *    for in-code styles; nothing enforced it for shipped documents.
 *  - NO INERT SOURCES. `vocal` and `stem*` only carry a signal once lyrics or
 *    sidecar stems are loaded, so a flagship built on them does nothing on a
 *    bare track. Same for muted routes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "themes");

const POST_SPECS = new Map(POST_MOD_TARGETS.map((s) => [s.key, s]));

/** Emitted file path for a candidate — the gallery's own naming rule
 * (`themes/<id>.bftheme`, id === filename). */
const filePath = (slug: string) => join(OUT_DIR, `${slug}.bftheme`);

/** presetStyles.test.ts's rule, verbatim: a value must sit on the spec's own
 * step grid, tolerant only of float noise. */
function onGrid(value: number, spec: ParamSpec): boolean {
  const steps = (value - spec.min) / spec.step;
  return Math.abs(Math.round(steps) - steps) < 1e-6;
}

function specMap(presetId: string): Map<string, ParamSpec> {
  return new Map(allParams(presetById(presetId)).map((p) => [p.key, p]));
}

/** Assert one authored number against its spec: exists, in range, on grid,
 * and — for the controls where a stray value is meaningless — a legal one. */
function checkParam(
  where: string,
  key: string,
  value: number,
  specs: Map<string, ParamSpec>,
): void {
  const spec = specs.get(key);
  expect(spec, `${where}: unknown param "${key}"`).toBeDefined();
  expect(value, `${where}: ${key} below min`).toBeGreaterThanOrEqual(spec!.min);
  expect(value, `${where}: ${key} above max`).toBeLessThanOrEqual(spec!.max);
  expect(
    onGrid(value, spec!),
    `${where}: ${key} = ${value} is off the ${spec!.step} step grid — it will change the first time the user touches the slider`,
  ).toBe(true);
  if (spec!.control === "toggle") {
    expect([0, 1], `${where}: toggle ${key} must be 0 or 1`).toContain(value);
  }
  if (spec!.control === "enum") {
    expect(
      spec!.options.map((o) => o.value),
      `${where}: enum ${key} = ${value} is not one of its options`,
    ).toContain(value);
  }
}

const each = CANDIDATES.map((c) => [c.meta.name, c] as const);

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const c of CANDIDATES) {
    writeFileSync(filePath(c.slug), serializeTheme(c.document, c.meta, APP_VERSION) + "\n");
  }
});

describe("Track C1 flagship candidates", () => {
  it("is a set of three to five, as the plan scopes it", () => {
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(3);
    expect(CANDIDATES.length).toBeLessThanOrEqual(5);
  });

  it("slugs, names and every generated id are unique", () => {
    const slugs = CANDIDATES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const names = CANDIDATES.map((c) => c.meta.name);
    expect(new Set(names).size).toBe(names.length);
    const ids = [
      ...CANDIDATES.flatMap((c) => Object.values(c.document.modsByPreset).flat()).map((r) => r.id),
      ...CANDIDATES.flatMap((c) => c.document.overlayLayers).map((l) => l.id),
      ...CANDIDATES.flatMap((c) => c.document.timeline.scenes).map((s) => s.id),
      ...CANDIDATES.flatMap((c) => c.document.timeline.lanes)
        .flatMap((l) => l.keyframes)
        .map((k) => k.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every slug is a legal gallery id", () => {
    for (const c of CANDIDATES) {
      expect(c.slug, `"${c.slug}" is not kebab-case`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(c.slug.length).toBeGreaterThanOrEqual(3);
      expect(c.slug.length).toBeLessThanOrEqual(64);
    }
  });

  it.each(each)("%s: every field is already canonical", (_n, c) => {
    expect(validateDocument(c.document)).toEqual(c.document);
  });

  it.each(each)("%s: the emitted .bftheme parses back with nothing dropped", (_n, c) => {
    const json = readFileSync(filePath(c.slug), "utf8");
    const { meta, document } = parseTheme(json);
    expect(meta).toEqual(c.meta);
    expect(document).toEqual(c.document);
  });

  it.each(each)("%s: the emitted envelope is the current format", (_n, c) => {
    const file = JSON.parse(readFileSync(filePath(c.slug), "utf8"));
    expect(file.kind).toBe("bftheme");
    expect(file.schemaVersion).toBe(THEME_VERSION);
    // parseTheme treats an ABSENT projectSchemaVersion as pre-v14 and applies
    // the nebula-saturation migration — which would silently divide Deep
    // Current's authored saturation by 0.75.
    expect(file.projectSchemaVersion).toBe(PROJECT_VERSION);
    expect(file.appVersion).toBe(APP_VERSION);
  });

  it.each(each)("%s: reads as a finished production, honestly described", (_n, c) => {
    expect(c.meta.description).toBeTruthy();
    expect(c.meta.description!.length).toBeGreaterThan(60);
    expect(c.meta.description!.length).toBeLessThanOrEqual(500); // registry cap
    expect(c.meta.author).toBeTruthy();
    expect(c.meta.license).toBe("CC0-1.0");
    const d = c.document;
    expect(Object.keys(d.syncByPreset), "must commit to a sync feel").toContain(d.presetId);
    expect(Object.keys(d.paramsByPreset), "must commit to params").toContain(d.presetId);
    const routes = d.modsByPreset[d.presetId] ?? [];
    expect(routes.length, "must use the modulation matrix").toBeGreaterThanOrEqual(4);
    const post = d.post;
    expect(
      post.bloom > 0 || post.tonemap || post.vignette > 0 || post.grain > 0 || post.chromatic > 0,
      "must commit to a post chain",
    ).toBe(true);
  });

  it.each(each)("%s: every authored param exists, fits and sits on the grid", (_n, c) => {
    const preset = presetById(c.document.presetId);
    expect(preset.id, "unknown preset id").toBe(c.document.presetId);
    const specs = specMap(c.document.presetId);
    for (const [key, value] of Object.entries(
      c.document.paramsByPreset[c.document.presetId] ?? {},
    )) {
      checkParam(c.meta.name, key, value, specs);
    }
  });

  it.each(each)("%s: every route drives something real, at a usable depth", (_n, c) => {
    const specs = specMap(c.document.presetId);
    const base = c.document.paramsByPreset[c.document.presetId] ?? {};
    for (const [presetId, routes] of Object.entries(c.document.modsByPreset)) {
      expect(presetId, "routes filed under a mode the theme never selects").toBe(
        c.document.presetId,
      );
      for (const r of routes) {
        expect(r.muted, `${r.id}: a shipped route must not be muted`).toBeUndefined();
        expect(r.amount, `${r.id}: an amount of 0 is an inert route`).not.toBe(0);
        expect(Math.abs(r.amount), `${r.id}: amount out of range`).toBeLessThanOrEqual(1);
        expect(
          r.source.startsWith("stem") || r.source === "vocal",
          `${r.id}: "${r.source}" reads 0 until the user loads lyrics or stems — a flagship cannot ship a route that does nothing on a bare track`,
        ).toBe(false);
        const spec = r.param.startsWith(POST_TARGET_PREFIX)
          ? POST_SPECS.get(postTargetKey(r.param) ?? "")
          : specs.get(r.param);
        expect(spec, `${r.id}: route to unknown target "${r.param}"`).toBeDefined();
        expect(spec!.mod, `${r.id}: "${r.param}" is not a modulation target`).not.toBe("off");
        // Headroom: the value the route pushes toward must still be inside the
        // spec, or the look flattens against the clamp at every peak.
        const start = base[r.param] ?? spec!.default;
        const peak = start + r.amount * (spec!.max - spec!.min);
        expect(
          peak,
          `${r.id}: ${r.param} peaks at ${peak.toFixed(3)}, past its ${spec!.max} ceiling`,
        ).toBeLessThanOrEqual(spec!.max + 1e-9);
        expect(
          peak,
          `${r.id}: ${r.param} bottoms at ${peak.toFixed(3)}, under its ${spec!.min} floor`,
        ).toBeGreaterThanOrEqual(spec!.min - 1e-9);
      }
    }
  });

  it.each(each)("%s: the timeline targets real params and carries stable ids", (_n, c) => {
    const specs = specMap(c.document.presetId);
    const t = c.document.timeline;
    for (const lane of t.lanes) {
      for (const k of lane.keyframes) {
        expect(
          k.id,
          `lane "${lane.param}": a keyframe without an id gets a RANDOM one on load`,
        ).toBeTruthy();
        checkParam(`${c.meta.name} lane ${lane.param}`, lane.param, k.value, specs);
      }
    }
    for (const s of t.scenes) {
      expect(s.id).toBeTruthy();
      expect(s.presetId, "a scene on a mode the theme does not carry params for").toBe(
        c.document.presetId,
      );
      for (const [key, value] of Object.entries(s.params ?? {})) {
        checkParam(`${c.meta.name} scene "${s.name}"`, key, value, specs);
      }
    }
    if (t.enabled) expect(t.lanes.length + t.scenes.length).toBeGreaterThan(0);
    // A scene set that never reaches the base look is a theme the user only
    // ever sees through an override.
    if (t.scenes.length > 0) expect(t.scenes[0].start).toBe(0);
  });

  it.each(each)("%s: references no asset it does not carry", (_n, c) => {
    const d = c.document;
    expect(d.assets).toEqual({});
    for (const l of d.overlayLayers) expect(l.type).toBe("text");
    expect(d.bg.image).toBeUndefined();
    expect(d.bg.video).toBeUndefined();
    expect(d.centerImageByPreset).toEqual({});
    expect(d.bgByPreset).toEqual({});
  });

  it("the five characters are five different visuals", () => {
    const ids = CANDIDATES.map((c) => c.document.presetId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(each)("%s: uses the v2 modulation powers, not just v1 routes", (_n, c) => {
    const routes = c.document.modsByPreset[c.document.presetId] ?? [];
    expect(
      routes.some((r) => r.curve === "exp" || r.curve === "smooth"),
      "no response curve anywhere — this is a v1 route list",
    ).toBe(true);
    expect(
      routes.some((r) => (r.attack ?? 0) > 0 || (r.release ?? 0) > 0),
      "no attack/release lag anywhere",
    ).toBe(true);
    expect(
      routes.some((r) => r.source.startsWith("lfo:")),
      "no tempo-locked LFO",
    ).toBe(true);
  });

  it("the set covers the surfaces the two live flagships ignore", () => {
    const docs = CANDIDATES.map((c) => c.document);
    const sources = new Set(
      docs.flatMap((d) => Object.values(d.modsByPreset).flat()).map((r) => r.source),
    );
    expect(
      docs.some((d) => d.timeline.scenes.length > 0),
      "no scene timeline",
    ).toBe(true);
    expect(
      docs.some((d) => d.timeline.lanes.length > 0),
      "no automation lane",
    ).toBe(true);
    expect(
      docs.some((d) => d.timeline.scenes.some((s) => s.transition)),
      "no transition",
    ).toBe(true);
    expect(
      docs.some((d) => d.overlayLayers.length >= 3),
      "no overlay lockup",
    ).toBe(true);
    expect(
      docs.some((d) => d.bg.mode !== 0),
      "no authored background",
    ).toBe(true);
    expect(
      docs.some((d) => d.smoothSpectrum),
      "nothing carries the smoothed spectrum",
    ).toBe(true);
    expect(
      docs.some((d) => d.audiogram.progressBar),
      "no audiogram",
    ).toBe(true);
    expect(
      docs.some((d) => d.lyricStyle.position !== "bottom"),
      "no dressed lyric style",
    ).toBe(true);
    expect(
      [...sources].some((s) => s === "sectionPulse"),
      "nothing is section-aware",
    ).toBe(true);
    for (const wave of ["sine", "saw", "square"]) {
      expect(
        [...sources].some((s) => s.startsWith(`lfo:${wave}:`)),
        `no ${wave} LFO in the whole set`,
      ).toBe(true);
    }
  });
});
