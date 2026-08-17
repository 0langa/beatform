import { describe, expect, it } from "vitest";
import { presetUsesFeedback } from "../webgpuRenderer";
import { allParams, presetMasters } from "../types";
import { presets } from "./index";
import { ledMatrix } from "./ledMatrix";
import { spectroFalls } from "./spectroFalls";
import { overgrowth } from "./overgrowth";

/**
 * OVERGROWTH (P-19, the roster's last entry) — reaction-diffusion.
 *
 * Everything asserted here is a property the mode's LOOK or its determinism
 * story depends on and that no other gate can see: the GPU matrix compares
 * hashes on a device, the shader golden proves the text did not change by
 * accident — neither can say whether the chemistry still advances only on
 * the fixed clock, whether the state still lives raw in the data lane, or
 * whether the seeds still derive from the beat count. These are the
 * sentences a future edit has to keep true.
 */
describe("overgrowth", () => {
  const main = new Map(overgrowth.params.map((p) => [p.key, p]));
  const advanced = new Map((overgrowth.advanced ?? []).map((p) => [p.key, p]));
  const styles = overgrowth.styles ?? [];
  // Comment-stripped, exactly as the renderer's own static scans read it — a
  // property proven by prose in a comment is not proven at all.
  const code = overgrowth.wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("is registered under its persisted id", () => {
    // Preset ids are persisted forever (projects, looks, localStorage). This
    // is the one line that makes renaming it a deliberate, visible act.
    expect(presets.map((p) => p.id)).toContain("overgrowth");
    expect(overgrowth.id).toBe("overgrowth");
  });

  it("opts into feedback the way the STATIC scan can see", () => {
    // presetUsesFeedback is a regex over the comment-stripped WGSL, so the
    // call has to be a real, plain call in the body — not hidden behind a
    // helper alias, and not merely mentioned in prose (the banked gotcha).
    expect(presetUsesFeedback(overgrowth)).toBe(true);
    expect(/feedbackSample\s*\(/.test(code)).toBe(true);
  });

  it("advances chemistry only on the fixed feedback clock", () => {
    // The whole determinism story in three expressions. (1) The integration
    // step multiplies u.dt — the renderer pins it to the fixed 60 Hz step on
    // an advance and to ZERO on a presentation-only frame, so presenting can
    // never advance the field. (2) The beat-seed window is the same
    // floor-crossing idiom Spectro Falls scrolls and prints beat marks with:
    // empty when u.dt is zero, exactly one crossing per beat on the fixed
    // grid, identical live, in export replay and in the GPU matrix.
    expect(code).toContain("* u.dt * 60.0");
    expect(code).toContain("floor(beatPosAt(u.time - u.dt))");
    // (3) The Current moves the field by WHOLE cells on the identical
    // floor-difference derivation — no resampling, no record blur — asserted
    // against the ancestors so none of the three can drift alone.
    expect(code).toContain("floor(u.time * rate) - floor((u.time - u.dt) * rate)");
    expect(spectroFalls.wgsl).toContain("floor(u.time * rate) - floor((u.time - u.dt) * rate)");
    expect(ledMatrix.wgsl).toContain("floor(u.time * rate) - floor((u.time - u.dt) * rate)");
  });

  it("keeps BOTH chemicals raw in the data lane, and reads state by EXACT texel", () => {
    // The mode's defining decision, in two halves. (1) Alpha carries the
    // chemistry (the composite pass derives its own alpha and never reads
    // it), split into the two vertical tiles. (2) State reads are
    // textureLoad, never the filtered sampler: a filtered tap at a data-row
    // centre straddles texels on canvases under ~720 rows and mixes
    // neighbouring rows — anisotropic extra diffusion that collapsed the
    // whole culture into horizontal banding on the device (this lane's
    // first walk). The one sampled feedbackSample read is display-only
    // mist; chemistry must stay on exact texels.
    expect(code).toContain("return vec4f(max(col, vec3f(0.0)), stored);");
    expect(code.match(/textureLoad\(feedbackTex, vec2i\(p\), 0\)\.a/g)).toHaveLength(2);
    expect(code).toContain("vec2f(cc.x, cc.y * 0.5) * dims");
    expect(code).toContain("vec2f(cc.x, 0.5 + cc.y * 0.5) * dims");
    expect(code).toContain("return (c + vec2f(0.5)) / vec2f(RD_NX, RD_NY);");
    // The advance must consume ONLY exact state reads — the sampled mist
    // stays in the display stage, where softness cannot compound.
    const advanceBody = code.slice(code.indexOf("fn advance"), code.indexOf("fn develop"));
    expect(advanceBody).not.toContain("feedbackSample");
  });

  it("the field is a FIXED logical grid, not the pixel grid", () => {
    // 320x180 cells in UV space at every canvas size is what makes a 720p
    // preview and a 1080p export walk the same trajectory. Resizing this
    // grid is a whole-mode re-bless, never a tweak.
    expect(code).toContain("const RD_NX: f32 = 320.0;");
    expect(code).toContain("const RD_NY: f32 = 180.0;");
  });

  it("integration is stability-clamped, so no reachable setting can explode", () => {
    // The 3x3 stencil's worst eigenvalue is -1.6, so D*dt must stay under
    // 1.25; the clamp holds it at 1.1 with margin. Bass rides the CHEMISTRY
    // term instead of dt precisely so a drop can never break the bound.
    expect(code).toContain("min(P_speed(), 1.1 / max(P_scale(), 0.0001))");
    expect(code).toContain("1.0 + P_surge() * u.bass");
  });

  it("seeds derive from the beat COUNT via the R2 sequence — never Math.random", () => {
    // Position = R2(beat index): the plastic-constant sequence, so the same
    // beat lands the same seed in the live walk, the export's
    // replay-from-zero walk and the GPU matrix. There is no other source of
    // randomness anywhere in the module (hash21 is the shared deterministic
    // cell dither, not an RNG).
    expect(code).toContain("0.7548776662");
    expect(code).toContain("0.5698402910");
    expect(code).toContain("r2pos(bHere + 7.0)");
    expect(code).not.toMatch(/Math\.random/);
  });

  it("a cleared history self-seeds from the designed constellation", () => {
    // A cleared field reads A = B = 0 — unreachable in an evolved field,
    // where feed pulls A up everywhere — so the first advance can detect it
    // and integrate FROM the constellation. This is what the strip thumbnail
    // and the matrix's 31-frame walk actually picture, so losing the branch
    // would blank both.
    expect(code).toContain("stateA(c0) + stateB(c0) < 0.001");
    expect(code).toMatch(/fn seedField\(c: vec2f\) -> f32 \{/);
  });

  it("bars always plant the pilot seed, so the culture cannot die out", () => {
    // Quiet passages must stay alive: the field self-animates in a living
    // regime, and the whisper-level bar stamp is the backstop that re-lights
    // it even at Beat seeds 0 after a regime excursion.
    expect(code).toContain("strength = max(strength, 0.22);");
  });

  it("develops the display from the field instead of baking looks into state", () => {
    // The darkroom property: contrast, palette, relief and paper are display
    // stages over raw chemistry, so moving a knob re-prints the WHOLE living
    // field. If a future edit bakes any of them into the stored value, these
    // lines move.
    expect(code).toMatch(/fn develop\(b: f32\) -> f32 \{/);
    expect(code).toContain("let heat = develop(bS);");
  });

  it("declares exactly the motion masters it actually drives", () => {
    // Pulse gates the beat flare and front pump. Rotation and Detail are
    // deliberately unread (a culture neither spins nor thins), and the
    // spectrum spline never applies — the mode reads band energies, not
    // bins, so an inert master slider cannot appear.
    expect(presetMasters(overgrowth)).toEqual({
      rotation: false,
      pulse: true,
      detail: false,
      spectrumSmooth: false,
    });
  });

  it("curates all five lenses, and keeps the curated tier a tier", () => {
    const groups = new Set(overgrowth.params.map((p) => p.group));
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(groups.has(lens), `main tier missing ${lens}`).toBe(true);
    }
    expect(overgrowth.params.length).toBeGreaterThanOrEqual(14);
    expect(overgrowth.params.length).toBeLessThanOrEqual(16);
    // Backdrop lives entirely in advanced[], so one knob is re-tiered IN
    // PLACE (never moved between the arrays — that repacks the GPU ABI).
    expect(advanced.get("floorLevel")).toMatchObject({ group: "backdrop", tier: "curated" });
  });

  it("silence is a surface: the floor can never be zero by default", () => {
    // Open ground is a deep tint of the anchor hue breathing with the bass,
    // so an empty culture reads as quiet rather than broken — and the frame
    // can never be the fully-black one the GPU matrix fails a non-extreme
    // case on.
    expect(main.get("floorLevel")).toBeUndefined();
    expect(advanced.get("floorLevel")!.default).toBeGreaterThan(0);
    expect(code).toContain("presetColor(P_hue(), 0.5, P_floorLevel()");
  });

  it("the Form regime switch refuses modulation", () => {
    // Each option is a different (feed, kill) anchor; modulating it would
    // teleport the chemistry between regimes every frame (the led-matrix
    // Display rule). Audio reaches the regime through growth/etch/surge,
    // which move WITHIN the living band instead.
    expect(main.get("form")).toMatchObject({ control: "enum", mod: "off" });
  });

  it("audio depths stay inside the living band", () => {
    // The feed/kill wiggles are small absolute deltas around the Form
    // anchor, clamped into the band where SOME regime lives. Widening either
    // clamp is how a loud bright track kills the field — a tuning change
    // that must be a deliberate, device-verified act.
    expect(code).toContain("0.006, 0.09");
    expect(code).toContain("0.043, 0.071");
  });

  it("every option of every enum is exercised by a shipped look", () => {
    // An enum no style reaches is invisible: the user never sees what the
    // mode can do (B0's cross-mode finding #2, the registry-wide rule).
    for (const spec of allParams(overgrowth)) {
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

  it("ships looks that are structurally different, not recolours", () => {
    // presetStyles.test enforces the recolour rule registry-wide; what is
    // pinned HERE is that the set covers the mode's actual range — every
    // chemistry regime, both ends of the pattern scale, the paper negative
    // and both directions of the current.
    expect(styles.length).toBeGreaterThanOrEqual(6);
    const forms = new Set(styles.map((s) => s.values.form ?? 0));
    expect(forms).toEqual(new Set([0, 1, 2, 3, 4]));
    const scales = styles.map((s) => s.values.scale ?? main.get("scale")!.default);
    expect(Math.min(...scales)).toBeLessThanOrEqual(0.7);
    expect(Math.max(...scales)).toBeGreaterThanOrEqual(1.4);
    expect(styles.some((s) => s.values.paper === 1)).toBe(true);
    const flows = styles.map((s) => s.values.flow ?? main.get("flow")!.default);
    expect(Math.min(...flows)).toBeLessThan(0);
    expect(Math.max(...flows)).toBeGreaterThan(0);
  });
});
