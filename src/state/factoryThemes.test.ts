import { describe, expect, it } from "vitest";
import { FACTORY_THEMES } from "./factoryThemes";
import { parseTheme, serializeTheme } from "./themes";
import { validateDocument } from "./project";
import { postTargetKey, POST_TARGET_PREFIX } from "./modMatrix";
import { presetById } from "../render/presets";
import { allParams, POST_MOD_TARGETS } from "../render/types";
import { builderLayerType, BUILDER_MAX_LAYERS } from "../render/builder2";

/**
 * Contract tests for the shipped template pack.
 *
 * The load-bearing one is "already canonical": a factory document must be
 * IDENTICAL to what validateDocument() produces from it. Every way a template
 * can be quietly wrong — a param outside its spec range (clamped), a sync mode
 * that does not exist (dropped), a route to a source the validator rejects
 * (dropped), an out-of-order timeline lane (re-sorted), a background pointing
 * at an asset the document does not carry (degraded to the preset background)
 * — shows up there as a diff, because that is exactly the transform an
 * .avtheme goes through on import. Without it, a broken template would still
 * "apply" and still "round-trip"; it would simply not be the look that was
 * authored.
 *
 * themes.test.ts covers the .avtheme FILE format itself (meta defaulting,
 * hostile input, version refusal); this file covers the pack's content.
 */

const POST_KEYS = new Set(POST_MOD_TARGETS.map((s) => s.key));

describe("factory template pack", () => {
  it("ships a curated set, not a stub", () => {
    expect(FACTORY_THEMES.length).toBeGreaterThanOrEqual(8);
  });

  it("names and slugs are unique", () => {
    const names = FACTORY_THEMES.map((t) => t.meta.name);
    expect(new Set(names).size).toBe(names.length);
    // Route/layer ids are slug-derived, so a duplicate slug would collide two
    // templates' ids without any other symptom.
    const ids = FACTORY_THEMES.flatMap((t) => Object.values(t.document.modsByPreset).flat()).map(
      (r) => r.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: every field is already canonical",
    (_name, t) => {
      expect(validateDocument(t.document)).toEqual(t.document);
    },
  );

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: survives export -> import unchanged",
    (_name, t) => {
      const { meta, document } = parseTheme(serializeTheme(t.document, t.meta, "0.0.0-test"));
      expect(meta).toEqual(t.meta);
      expect(document).toEqual(t.document);
    },
  );

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: is a complete composition, honestly described",
    (_name, t) => {
      // A template is meant to be a whole look. These are the pieces that
      // separate one from a recolour — the old pack set only the first.
      expect(t.meta.description, "needs a user-facing description").toBeTruthy();
      expect(t.meta.description!.length).toBeGreaterThan(40);
      expect(t.meta.author).toBeTruthy();
      expect(t.meta.license).toBeTruthy();
      expect(Object.keys(t.document.syncByPreset), "must commit to a sync feel").toContain(
        t.document.presetId,
      );
      expect(
        t.document.modsByPreset[t.document.presetId]?.length ?? 0,
        "must use the modulation matrix",
      ).toBeGreaterThan(0);
      const post = t.document.post;
      const postTouched =
        post.bloom > 0 ||
        post.tonemap ||
        post.vignette > 0 ||
        post.grain > 0 ||
        post.chromatic > 0 ||
        post.exposure !== 1;
      expect(postTouched, "must commit to a post chain").toBe(true);
    },
  );

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: every tuned param exists on its preset and sits inside the spec range",
    (_name, t) => {
      const preset = presetById(t.document.presetId);
      // presetById falls back to presets[0] for an unknown id, which would
      // make every param check below pass against the WRONG preset.
      expect(preset.id, "unknown preset id").toBe(t.document.presetId);
      const spec = new Map(allParams(preset).map((p) => [p.key, p]));
      for (const [key, value] of Object.entries(
        t.document.paramsByPreset[t.document.presetId] ?? {},
      )) {
        const s = spec.get(key);
        expect(s, `unknown param "${key}"`).toBeDefined();
        expect(value, `${key} below min`).toBeGreaterThanOrEqual(s!.min);
        expect(value, `${key} above max`).toBeLessThanOrEqual(s!.max);
      }
    },
  );

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: every mod route drives something that exists",
    (_name, t) => {
      const preset = presetById(t.document.presetId);
      const spec = new Map(allParams(preset).map((p) => [p.key, p]));
      for (const [presetId, routes] of Object.entries(t.document.modsByPreset)) {
        // A route list filed under a preset the template never selects is
        // dead weight the user would never find in the UI.
        expect(presetId, "routes for an inactive preset").toBe(t.document.presetId);
        for (const r of routes) {
          if (r.param.startsWith(POST_TARGET_PREFIX)) {
            const key = postTargetKey(r.param);
            expect(key, `unknown post target "${r.param}"`).not.toBeNull();
            expect(POST_KEYS.has(key!)).toBe(true);
          } else {
            expect(spec.get(r.param), `route to unknown param "${r.param}"`).toBeDefined();
          }
          expect(r.amount).toBeGreaterThanOrEqual(-1);
          expect(r.amount).toBeLessThanOrEqual(1);
          expect(r.amount, "an amount of 0 is an inert route").not.toBe(0);
        }
      }
    },
  );

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: timeline lanes target real params of the template's own preset",
    (_name, t) => {
      const spec = new Map(allParams(presetById(t.document.presetId)).map((p) => [p.key, p]));
      for (const lane of t.document.timeline.lanes) {
        expect(spec.get(lane.param), `lane on unknown param "${lane.param}"`).toBeDefined();
        for (const k of lane.keyframes) {
          const s = spec.get(lane.param)!;
          expect(k.value, `${lane.param} keyframe below min`).toBeGreaterThanOrEqual(s.min);
          expect(k.value, `${lane.param} keyframe above max`).toBeLessThanOrEqual(s.max);
        }
      }
      // An enabled-but-empty timeline is a UI panel with nothing in it.
      if (t.document.timeline.enabled) {
        expect(
          t.document.timeline.lanes.length + t.document.timeline.scenes.length,
        ).toBeGreaterThan(0);
      }
    },
  );

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: the Builder stack is renderable",
    (_name, t) => {
      const layers = t.document.builderStack.layers;
      expect(layers.length).toBeLessThanOrEqual(BUILDER_MAX_LAYERS);
      for (const l of layers) {
        const type = builderLayerType(l.type);
        expect(type, `unknown builder layer type "${l.type}"`).toBeDefined();
        for (const p of type!.params) {
          // Every slot must be authored: packBuilderParams falls back to the
          // spec default for a missing key, so an omission renders as a look
          // the template never declared.
          expect(l.params[p.key], `${l.type}.${p.key} unset`).toBeTypeOf("number");
        }
      }
    },
  );

  it.each(FACTORY_THEMES.map((t) => [t.meta.name, t] as const))(
    "%s: references no asset it does not carry",
    (_name, t) => {
      const d = t.document;
      // Templates ship no binaries, so any asset reference is a dangling one —
      // and validateDocument silently degrades those rather than failing.
      expect(d.assets).toEqual({});
      for (const l of d.overlayLayers) {
        expect(l.type, "an image layer needs an asset the template does not have").toBe("text");
      }
      expect(d.bg.image).toBeUndefined();
      expect(d.bg.video).toBeUndefined();
      expect(d.centerImageByPreset).toEqual({});
    },
  );

  it("covers genuinely different visuals, aspects and moods", () => {
    const presetIds = FACTORY_THEMES.map((t) => t.document.presetId);
    // Near-duplicates are the failure mode the pack is meant to avoid: two
    // templates on the same mode have to justify themselves, and none do yet.
    expect(new Set(presetIds).size).toBe(presetIds.length);
    const aspects = new Set(FACTORY_THEMES.map((t) => t.document.aspect));
    expect(aspects.has("16:9")).toBe(true);
    expect(aspects.has("9:16"), "short-form vertical is a first-class output").toBe(true);
    expect(aspects.has("1:1")).toBe(true);
    // At least one calm entry: no bloom flare, no beat-driven route at all.
    const calm = FACTORY_THEMES.filter((t) =>
      (t.document.modsByPreset[t.document.presetId] ?? []).every(
        (r) => !["kick", "snare", "hat", "driveBeat"].includes(r.source),
      ),
    );
    expect(calm.length, "the pack needs at least one restrained look").toBeGreaterThan(0);
  });
});
