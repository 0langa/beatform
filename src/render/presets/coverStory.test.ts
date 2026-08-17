import { describe, expect, it } from "vitest";
import { presetUsesFeedback } from "../webgpuRenderer";
import { allParams, defaultParams, presetMasters } from "../types";
import { presets } from "./index";
import { coverStory } from "./coverStory";

/**
 * COVER STORY (P-19 roster entry 3) — the artwork as the composition.
 *
 * What is pinned here is what no other gate can see: that the art arrives
 * through the shared cover ABI (never a raw texture read), that the room's
 * light is sampled from the artwork itself, that the whole surface honors the
 * saturation contract through presetRgb, and that the mode is never a blank
 * canvas — the GPU matrix renders it with NO cover bound, so its blessed
 * cases pin the generated-sleeve degrade; this file pins the sentences
 * behind the art path itself.
 */
describe("cover-story", { timeout: 30_000 }, () => {
  const main = new Map(coverStory.params.map((p) => [p.key, p]));
  const advanced = new Map((coverStory.advanced ?? []).map((p) => [p.key, p]));
  const styles = coverStory.styles ?? [];
  // Comment-stripped, exactly as the renderer's own static scans read it — a
  // property proven by prose in a comment is not proven at all.
  const code = coverStory.wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("is registered under its persisted id", () => {
    // Preset ids are persisted forever (projects, looks, localStorage). This
    // is the one line that makes renaming it a deliberate, visible act.
    expect(presets.map((p) => p.id)).toContain("cover-story");
    expect(coverStory.id).toBe("cover-story");
  });

  it("samples the art through the shared cover ABI, gated on the toggle AND hasCover()", () => {
    // The cover reaches the shader through the EXISTING binding surface —
    // coverSample/coverAspect through the shared fitUV, never a raw texture
    // read — and the one artAt() gate is what every consumer (box, blur,
    // reflection, wash) degrades through together.
    expect(code).toContain("if (P_cover() > 0.5 && hasCover()) {");
    expect(code).toMatch(/coverSample\s*\(/);
    expect(code).toContain("fitUV(buv, coverAspect(), boxAspect, P_coverFit(), P_coverZoom(),");
    expect(code).not.toMatch(/textureSampleLevel\s*\(\s*coverTex/);
  });

  it("a letterboxed fit lands on a mat board, never a hole", () => {
    // fitUV clamps at the texture edge, so sampling a contain fit's bars
    // would smear edge pixels — the inBox guard routes them to a painted mat
    // instead (the Bass Circle guard, given a gallery's answer).
    expect(code).toContain("if (inBox(cuv)) {");
    expect(code).toContain("return presetColor(P_hue(), 0.3, 0.075);");
  });

  it("routes the artwork's RGB through presetRgb, so saturation 0 is a true grayscale", () => {
    // Every art-derived color — the box sample and everything artAt feeds
    // (blur, reflection, wash) — passes the desaturation mix. A raw
    // coverSample().rgb would leave a full-color sleeve in a grayscale room.
    // Exactly ONE coverSample call site, and it is the presetRgb-wrapped one
    // — so no second read can sneak the raw texture past the grading.
    expect(code.match(/coverSample\s*\(/g)).toHaveLength(1);
    expect(code).toContain("return presetRgb(coverSample(cuv).rgb);");
  });

  it("the room is lit by the artwork itself: the wash averages four art taps", () => {
    // The palette extraction lives in-shader — four fixed quadrant taps
    // through artAt, deterministic, no CPU analysis on the render path. The
    // sleeve branch lights the room exactly the same way.
    expect(code).toContain("return (artAt(vec2f(0.3, 0.3), 1.0) + artAt(vec2f(0.7, 0.3), 1.0)");
    expect(code).toContain("+ artAt(vec2f(0.3, 0.7), 1.0) + artAt(vec2f(0.7, 0.7), 1.0)) * 0.25;");
  });

  it("keeps the cover upright: box uv maps y-down, no flip", () => {
    // The Bass Circle rule: uv arrives top-down from the vertex stage, so
    // centered()'s y grows downward exactly like the texture's v does — a
    // negation here would hang every cover upside down.
    expect(code).toContain("let buv = (p - boxC) / (2.0 * half) + vec2f(0.5);");
    expect(code).toContain("let p = centered(uv);");
  });

  it("stays deterministic by construction: no feedback, no wall clock", () => {
    // The stage redraws whole every frame — no history to diverge — and
    // every time-dependent term (sway, waterline shimmer, grain seed) rides
    // u.time. A stray feedbackSample( would put the mode on the fixed-tick
    // state walk for nothing.
    expect(presetUsesFeedback(coverStory)).toBe(false);
    expect(code).not.toMatch(/feedbackSample\s*\(/);
  });

  it("declares exactly the motion masters it actually drives", () => {
    // Rotation sways the room drift, Pulse scales beat zoom/rim/flare,
    // Detail thins the skirt columns, and the skirt reads the spectrum
    // through binAt — all four masters honest.
    expect(presetMasters(coverStory)).toEqual({
      rotation: true,
      pulse: true,
      detail: true,
      spectrumSmooth: true,
    });
  });

  it("curates all seven lenses from params[], leaving the ABI untouched by curation", () => {
    const groups = new Set(coverStory.params.map((p) => p.group));
    for (const lens of ["shape", "color", "motion", "reaction", "glow", "backdrop", "image"]) {
      expect(groups.has(lens), `main tier missing ${lens}`).toBe(true);
    }
    expect(coverStory.params.length).toBe(16);
    expect(coverStory.advanced?.length).toBe(10);
    expect((coverStory.advanced ?? []).every((s) => s.tier === undefined)).toBe(true);
  });

  it("is never a blank canvas: floor lit, sleeve emblem on, by default", () => {
    // The GPU matrix fails a black non-extreme frame, and it renders this
    // mode with NO cover bound — so the defaults must light the stage on
    // their own: a lit floor, and the generated sleeve at full presence.
    expect(advanced.get("roomLevel")!.default).toBeGreaterThan(0);
    expect(advanced.get("emblem")!.default).toBe(1);
    // ...and no shipped look turns the sleeve's artwork off entirely, or
    // hides the art path behind a dead cover toggle.
    for (const style of styles) {
      expect(style.values.emblem ?? 1, `${style.id} kills the sleeve`).toBeGreaterThan(0);
      expect(style.values.cover ?? 1, `${style.id} ships with the art off`).toBe(1);
    }
  });

  it("carries the store's cover contracts: the coverHue and cover keys, in MAIN params", () => {
    // Two literal keys other layers dispatch on: maybeApplyCoverPalette
    // (store.ts) applies "Match cover colors" only when def.params carries
    // `coverHue`; ParamsPanel offers the Center-image picker only when it
    // carries `cover`. Both are main-tier membership tests, not ABI slots.
    expect(main.get("coverHue")).toMatchObject({ control: "toggle", mod: "off", default: 0 });
    expect(main.get("cover")).toMatchObject({ control: "toggle", mod: "off", default: 1 });
  });

  it("structural switches refuse modulation", () => {
    expect(main.get("layout")).toMatchObject({ control: "enum", mod: "off" });
    expect(advanced.get("coverFit")).toMatchObject({ control: "enum", mod: "off" });
  });

  it("every option of every enum is exercised by a shipped look", () => {
    for (const spec of allParams(coverStory)) {
      if (spec.control !== "enum") continue;
      const reached = new Set<number>([spec.default]);
      for (const style of styles) {
        const v = style.values[spec.key];
        if (v !== undefined) reached.add(v);
      }
      for (const option of spec.options) {
        expect(reached.has(option.value), `${spec.key}: no look selects "${option.label}"`).toBe(
          true,
        );
      }
    }
  });

  it("ships looks that cover the mode's actual range, not recolours", () => {
    // presetStyles.test enforces distinctness registry-wide; what is pinned
    // HERE is coverage: every composition appears, and the set spans the
    // treatment range from the near-still Museum hang to the pumping VJ chip.
    expect(styles.length).toBeGreaterThanOrEqual(6);
    const comps = new Set(styles.map((s) => s.values.layout ?? 0));
    expect(comps).toEqual(new Set([0, 1, 2]));
    const zooms = styles.map((s) => s.values.beatZoom ?? defaultParams(coverStory).beatZoom);
    expect(Math.min(...zooms)).toBeLessThanOrEqual(0.1);
    expect(Math.max(...zooms)).toBeGreaterThanOrEqual(0.65);
  });
});
