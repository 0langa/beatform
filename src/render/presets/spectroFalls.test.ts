import { describe, expect, it } from "vitest";
import { presetUsesFeedback } from "../webgpuRenderer";
import { allParams, presetMasters } from "../types";
import { presets } from "./index";
import { ledMatrix } from "./ledMatrix";
import { spectroFalls } from "./spectroFalls";

/**
 * SPECTRO FALLS (P-19) — the spectrogram-waterfall archetype.
 *
 * Everything asserted here is a property the mode's LOOK depends on and that
 * no other gate can see: the GPU matrix only compares hashes on a device, and
 * the shader golden only proves the text did not change by accident — neither
 * can say whether the scroll still derives from track time or whether the
 * record is still stored raw. These are the sentences a future edit has to
 * keep true.
 */
describe("spectro-falls", () => {
  const main = new Map(spectroFalls.params.map((p) => [p.key, p]));
  const advanced = new Map((spectroFalls.advanced ?? []).map((p) => [p.key, p]));
  const styles = spectroFalls.styles ?? [];
  // Comment-stripped, exactly as the renderer's own static scans read it — a
  // property proven by prose in a comment is not proven at all.
  const code = spectroFalls.wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("is registered under its persisted id", () => {
    // Preset ids are persisted forever (projects, looks, localStorage). This
    // is the one line that makes renaming it a deliberate, visible act.
    expect(presets.map((p) => p.id)).toContain("spectro-falls");
    expect(spectroFalls.id).toBe("spectro-falls");
  });

  it("opts into feedback the way the STATIC scan can see", () => {
    // presetUsesFeedback is a regex over the comment-stripped WGSL, so the
    // call has to be a real, plain call in the body — not hidden behind a
    // helper alias, and not merely mentioned in prose (the banked gotcha).
    expect(presetUsesFeedback(spectroFalls)).toBe(true);
    expect(/feedbackSample\s*\(/.test(code)).toBe(true);
  });

  it("scrolls from TRACK time on the fixed feedback clock, not a frame counter", () => {
    // The whole determinism story in one expression: the slice counter is
    // floor(time * speed) and one advance shifts by exactly what that counter
    // gained over u.dt — which the renderer pins to the fixed 60 Hz step on an
    // advance and to ZERO on a presentation-only frame, so presentation
    // re-shows the last state instead of scrolling it. Identical grid live and
    // in export. led-matrix's waterfall derives its shift the same way; the
    // two are asserted together so neither can drift alone.
    expect(code).toContain("floor(u.time * rate) - floor((u.time - u.dt) * rate)");
    expect(ledMatrix.wgsl).toContain("floor(u.time * rate) - floor((u.time - u.dt) * rate)");
  });

  it("keeps the record RAW in the data channel, and reads it back from there", () => {
    // The mode's defining decision. Alpha carries the raw spectrum level (the
    // composite pass derives its own alpha and never reads it), so history is
    // exact per-pixel data rather than re-read pixels — no generation loss,
    // no bloom or grain accumulating into it — AND every look knob applies at
    // display time, re-developing the whole visible frame instead of only the
    // slices recorded after the change.
    expect(code).toContain("return vec4f(max(col, vec3f(0.0)), raw);");
    expect(code).toContain("return feedbackSample(fallUV(perp, src)).a;");
    // develop() is that display-time stage: air lift + black/white points.
    // If a future edit bakes either into the stored value, this line moves.
    expect(code).toMatch(/fn develop\(raw: f32, fx: f32\) -> f32 \{/);
    expect(code).toContain("let heat = develop(raw, fx);");
  });

  it("moves history by WHOLE slices, sampled at slice centres", () => {
    // A sub-slice scroll would resample at non-texel offsets and bilinear-blur
    // the record a little every tick until it mushed. Whole slices, read at
    // the source slice's centre, is what keeps a 3-second window legible.
    expect(code).toContain("let src = (si - shift + 0.5) / rows;");
    expect(code).toContain("let si = floor(clamp(s, 0.0, 0.99999) * rows);");
  });

  it("reads the spectrum through the shared binAt chokepoint", () => {
    // Sampled at two bin CENTRES and interpolated: a continuous frequency axis
    // that still rides the global Spectrum-smooth master, because the taps are
    // still binAt. A hand-rolled bins[] read would silently opt the mode out.
    expect(code).toContain("let a = binAt((i + 0.5) / n);");
    expect(code).toContain("let b = binAt((i + 1.5) / n);");
    expect(code).not.toMatch(/\bbins\[/);
  });

  it("declares exactly the motion masters it actually drives", () => {
    // Detail thins the slices, Pulse scales the beat flare, the spectrum
    // spline arrives through binAt. Rotation is deliberately unread: a
    // waterfall does not rotate, and an inert Rotation slider reads as broken.
    expect(presetMasters(spectroFalls)).toEqual({
      rotation: false,
      pulse: true,
      detail: true,
      spectrumSmooth: true,
    });
  });

  it("curates all five lenses, and keeps the curated tier a tier", () => {
    const groups = new Set(spectroFalls.params.map((p) => p.group));
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(groups.has(lens), `main tier missing ${lens}`).toBe(true);
    }
    expect(spectroFalls.params.length).toBeGreaterThanOrEqual(12);
    expect(spectroFalls.params.length).toBeLessThanOrEqual(16);
    // Backdrop lives entirely in advanced[], so one knob is re-tiered IN PLACE
    // (never moved between the arrays — that repacks the GPU ABI).
    expect(advanced.get("floorLevel")).toMatchObject({ group: "backdrop", tier: "curated" });
  });

  it("silence is a surface: the floor can never be zero by default", () => {
    // The mode's ground is a deep tint of the anchor hue, so an empty record
    // reads as quiet rather than broken — and the frame can never be the
    // fully-black one the GPU matrix fails a non-extreme case on.
    expect(main.get("floorLevel")).toBeUndefined();
    expect(advanced.get("floorLevel")!.default).toBeGreaterThan(0);
    expect(code).toContain("presetColor(P_hue(), 0.6, P_floorLevel()");
  });

  it("structural switches refuse modulation; counts snap", () => {
    // Modulating the scroll direction or the axis fold would re-lay-out the
    // record every frame. Counts quantize instead (paramModel's registry-wide
    // rule: ordered counts snap, mode choices opt out).
    expect(main.get("direction")).toMatchObject({ control: "enum", mod: "off" });
    expect(main.get("axis")).toMatchObject({ control: "enum", mod: "off" });
    expect(main.get("slices")?.mod).toBe("snap");
    expect(advanced.get("gridLines")?.mod).toBe("snap");
  });

  it("the scroll speed tops out at one slice per fixed tick", () => {
    // Above 60 the record would take two slices per advance holding the SAME
    // live spectrum — a faster scroll bought with duplicated moments. The
    // honest way to sweep faster is fewer slices, so the ceiling stays here
    // (the same ceiling led-matrix's waterfall documents).
    const speed = main.get("speed")!;
    expect(speed.max).toBe(60);
    expect(speed.min).toBeGreaterThan(0); // log taper needs a positive edge
    expect(speed.taper).toBe("log");
  });

  it("every option of every enum is exercised by a shipped look", () => {
    // An enum no style reaches is invisible: the user never sees what the mode
    // can do (B0's cross-mode finding #2, the rule led-matrix's wave adopted).
    for (const spec of allParams(spectroFalls)) {
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
    // presetStyles.test enforces this registry-wide; what is pinned HERE is
    // that the set covers the mode's actual range — every scroll direction,
    // both the fine and the chunky end of the slice count.
    expect(styles.length).toBeGreaterThanOrEqual(6);
    const directions = new Set(styles.map((s) => s.values.direction ?? 0));
    expect(directions).toEqual(new Set([0, 1, 2, 3]));
    const sliceCounts = styles.map((s) => s.values.slices ?? main.get("slices")!.default);
    expect(Math.min(...sliceCounts)).toBeLessThan(64);
    expect(Math.max(...sliceCounts)).toBeGreaterThan(300);
  });
});
