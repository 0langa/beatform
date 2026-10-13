import { describe, expect, it } from "vitest";
import { presets } from "./index";
import { KIT_KEYS, kitChoiceOf, kitSpecs, kitWgsl, withKit } from "./kit";
import { allParams, defaultParams, presetMasters, type PresetDef } from "../types";
import { presetUsesFeedback } from "../webgpuRenderer";

/** The modes that carry the kit, with the concepts each asked for. */
const WIRED = presets.filter((p) => p.wgsl.includes("fn kitFold("));

/** The RGB-accumulating feedback modes: their output is next frame's
 * history, so no finish may run on it (kit.ts rule 3). */
const RGB_FEEDBACK = ["oscilloscope", "metaballs", "echo-trails"];

describe("look kit", () => {
  it("is wired into every fragment mode except the RGB-feedback trio, Builder and the renderer-side modes", () => {
    const ids = WIRED.map((p) => p.id);
    for (const p of presets) {
      const rendererSide = Boolean(p.particles || p.mesh3d || p.shadertoy);
      const expectKit = !rendererSide && p.id !== "builder2" && !RGB_FEEDBACK.includes(p.id);
      expect(ids.includes(p.id), p.id).toBe(expectKit);
    }
    expect(WIRED.length).toBe(14);
  });

  for (const preset of WIRED) {
    it(`${preset.id}: kit keys sit at the ABI tail, in the kit's order, each an exact no-op default`, () => {
      const keys = allParams(preset).map((s) => s.key);
      const choice = kitChoiceOf(preset.id);
      expect(choice, preset.id).toBeDefined();
      const kitKeys = kitSpecs(choice!).map((s) => s.key);
      expect(kitKeys.length).toBeGreaterThan(0);
      // Appended after everything the mode declared itself…
      expect(keys.slice(keys.length - kitKeys.length)).toEqual(kitKeys);
      // …in the kit's fixed order (ABI stability across modes).
      const order = kitKeys.map((k) => KIT_KEYS.indexOf(k as (typeof KIT_KEYS)[number]));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      const defaults = defaultParams(preset);
      for (const k of kitKeys) {
        const neutral = k === "mirror" || k === "freqHi" ? 1 : 0;
        expect(defaults[k], `${preset.id}/${k}`).toBe(neutral);
      }
      // The wrapper owns `fn preset`; the mode's own entry became presetBody.
      expect(preset.wgsl.match(/\nfn preset\(/g)).toHaveLength(1);
      expect(preset.wgsl).toContain("\nfn presetBody(");
      expect(preset.wgsl).toContain("fn kitFinish(");
    });

    it(`${preset.id}: the masters the kit honours are the ones the panel will show`, () => {
      const choice = kitChoiceOf(preset.id)!;
      const caps = presetMasters(preset);
      if (choice.rotation) expect(caps.rotation).toBe(true);
      if (choice.beatZoom || choice.beatFlash) expect(caps.pulse).toBe(true);
    });
  }

  it("a frequency window remaps every spectrum read, and only where the mode reads one", () => {
    for (const preset of WIRED) {
      if (kitChoiceOf(preset.id)?.freq) {
        expect(preset.wgsl).toContain("fn kitBin(x: f32) -> f32 { return binAt(kitWin(x)); }");
        // A crossed window (Low edge above High edge) still reads the slice
        // the right way round: the edges are sorted before the mix.
        expect(preset.wgsl).toContain("return mix(min(lo, hi), max(lo, hi), x);");
        // The body's own reads all go through the window; the only raw
        // binAt/peakAt left are the two kit wrappers themselves.
        expect(preset.wgsl.match(/\bbinAt\(/g)).toHaveLength(1);
        expect(preset.wgsl.match(/\bpeakAt\(/g)).toHaveLength(1);
      }
    }
  });

  it("the finish never touches alpha, so the alpha-state modes keep their chemistry", () => {
    for (const id of ["spectro-falls", "overgrowth", "led-matrix"]) {
      const preset = presets.find((p) => p.id === id)!;
      expect(presetUsesFeedback(preset)).toBe(true);
      expect(preset.wgsl).toContain("return vec4f(kitFinish(c.rgb, uv), c.a);");
      // No fold on a feedback mode: the history would be read through a
      // folded coordinate.
      expect(preset.wgsl).not.toContain("kaleido(p, km)");
      expect(preset.wgsl).not.toContain("P_beatZoom()");
    }
  });

  it("the finish is screen-space: the fold feeds the body only, grain and scanlines see the frame's own uv", () => {
    for (const preset of WIRED) {
      expect(preset.wgsl).toContain("let c = presetBody(kitFold(uv));");
      expect(preset.wgsl).toContain("return vec4f(kitFinish(c.rgb, uv), c.a);");
      expect(preset.wgsl).not.toContain("kitFinish(c.rgb, kuv)");
    }
  });

  it("grain cannot manufacture coverage in the transparent delivery", () => {
    // composite() derives a transparent frame's alpha from max(rgb): grain
    // added to black would be speckled coverage in a PNG/VP9-alpha export.
    // The kit scales it by the light under it there, exactly as the post
    // chain's grain does (n * grain * a), and leaves every opaque path alone.
    for (const preset of WIRED) {
      const grain = Boolean(kitChoiceOf(preset.id)?.grain);
      expect(preset.wgsl.includes("u.bgMode == 2u"), preset.id).toBe(grain);
      if (grain) expect(preset.wgsl).toContain("rgb += vec3f(grain(uv, gr * 0.2) * lit);");
    }
  });

  it("withKit refuses a mode that already owns a kit key, and a window on a mode without a spectrum", () => {
    const base: PresetDef = {
      id: "x",
      name: "x",
      params: [{ key: "grain", label: "g", min: 0, max: 1, step: 0.1, default: 0, group: "glow" }],
      wgsl: "\nfn preset(uv: vec2f) -> vec4f { return vec4f(0.0); }\n",
    };
    expect(() => withKit(base, { grain: true })).toThrow(/already declares "grain"/);
    expect(() => withKit({ ...base, params: [] }, { freq: true })).toThrow(/reads no spectrum/);
    expect(() => withKit({ ...base, wgsl: "fn other() {}" }, {})).toThrow(/no fn preset/);
  });

  it("a concept the mode owns stays a closed literal in the shared WGSL", () => {
    const none = kitWgsl({});
    expect(none).not.toContain("P_");
    expect(none).not.toContain("u.spin");
    expect(none).not.toContain("u.pulse");
    const spinOnly = kitWgsl({ rotation: true });
    expect(spinOnly).toContain("u.spin");
    expect(spinOnly).not.toContain("u.pulse");
    expect(kitSpecs({}).length).toBe(0);
    expect(kitSpecs({ rotation: true, freq: true }).map((s) => s.key)).toEqual([
      "angle",
      "spin",
      "freqLo",
      "freqHi",
    ]);
  });
});
