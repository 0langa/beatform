import { describe, expect, it } from "vitest";
import { presetUsesFeedback } from "../webgpuRenderer";
import { allParams, defaultParams, presetMasters } from "../types";
import { PLATE_MAIN_BAND, PLATE_NEXT_BAND, PLATE_PREV_BAND, PLATE_STATUS_PX } from "../lyricPlate";
import { presets } from "./index";
import { lyricStage } from "./lyricStage";

/**
 * LYRIC STAGE (P-19 entry 2) — typography as the visual.
 *
 * What is pinned here is what no other gate can see: that the shader's plate
 * geometry agrees with the rasterizer's, that the words' state comes from the
 * plate's class channels rather than an invented clock, and that the mode is
 * never a blank canvas — with or without lyrics. The GPU matrix renders this
 * mode with NO plate bound, so its blessed cases pin the rehearsal degrade;
 * this file pins the sentences behind the lyric path itself.
 */
describe("lyric-stage", { timeout: 30_000 }, () => {
  const main = new Map(lyricStage.params.map((p) => [p.key, p]));
  const advanced = new Map((lyricStage.advanced ?? []).map((p) => [p.key, p]));
  const styles = lyricStage.styles ?? [];
  // Comment-stripped, exactly as the renderer's own static scans read it — a
  // property proven by prose in a comment is not proven at all.
  const code = lyricStage.wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("is registered under its persisted id", () => {
    // Preset ids are persisted forever (projects, looks, localStorage). This
    // is the one line that makes renaming it a deliberate, visible act.
    expect(presets.map((p) => p.id)).toContain("lyric-stage");
    expect(lyricStage.id).toBe("lyric-stage");
  });

  it("samples the lyric plate, and gates the whole text path on hasLyrics()", () => {
    // The words arrive through the renderer's plate binding (the cover-art
    // pattern) — sampled through the ABI helper, never a raw texture read —
    // and every text pass sits behind hasLyrics(), so a track with no lyrics
    // never pays for (or shows) an empty text stack.
    expect(code).toMatch(/lyricSample\s*\(/);
    expect(code).toContain("if (hasLyrics()) {");
    expect(code).not.toMatch(/textureSampleLevel\s*\(\s*lyricTex/);
  });

  it("mirrors the plate rasterizer's band geometry exactly", () => {
    // The shader's band constants and lyricPlate.ts's exported spans are two
    // spellings of ONE contract. Asserting the literals against the module
    // keeps either side from drifting alone — the spectroFalls/led-matrix
    // pairing pattern, across the CPU/GPU boundary this time.
    expect(code).toContain(`const BAND_PREV_LO: f32 = ${PLATE_PREV_BAND[0]};`);
    expect(code).toContain(`const BAND_PREV_HI: f32 = ${PLATE_PREV_BAND[1]};`);
    expect(code).toContain(`const BAND_MAIN_LO: f32 = ${PLATE_MAIN_BAND[0]};`);
    expect(code).toContain(`const BAND_MAIN_HI: f32 = ${PLATE_MAIN_BAND[1]};`);
    expect(code).toContain(`const BAND_NEXT_LO: f32 = ${PLATE_NEXT_BAND[0]};`);
    expect(code).toContain(`const BAND_NEXT_HI: f32 = ${PLATE_NEXT_BAND[1]};`);
    // The status block is read at its centre — (2,2) px IS half of the 4 px
    // block, where bilinear filtering over the uniform block is exact.
    expect(PLATE_STATUS_PX).toBe(4);
    expect(code).toContain("lyricSample(vec2f(2.0, 2.0) / dims)");
  });

  it("reads word state from the plate's class channels, never an own clock", () => {
    // Lit fraction and the active-word mask are ratios over coverage —
    // premultiplied classes, resolved per pixel. If the shader ever grew its
    // own idea of "which word is sung now" it could disagree with the plate
    // that carries the truth; these are the lines that keep it a CONSUMER.
    expect(code).toContain("tap.g / max(cov, 1e-4)");
    expect(code).toContain("tap.b / max(cov, 1e-4)");
  });

  it("the sung word carries audio-driven light; the type pumps on the beat", () => {
    // The mode's thesis: the music lands in the TYPE. The active word's
    // emphasis rides the beat pulse, the whole stack scales through the
    // Pulse master, and the tempo-locked gridPulse pattern keeps both
    // musical when the flux detector is quiet.
    expect(code).toContain("act * P_wordGlow() * (0.55 + 0.45 * pulse)");
    expect(code).toContain("beat * P_beatPunch() * 0.10 * u.pulse");
    expect(code).toMatch(/max\(u\.driveBeat, gridPulse\(/);
  });

  it("stays deterministic by construction: no feedback, no wall clock", () => {
    // No history to diverge: the stage redraws whole every frame, so this
    // mode must never opt into the feedback path by accident — a stray
    // `feedbackSample(` call would put it on the fixed-tick state walk for
    // nothing.
    expect(presetUsesFeedback(lyricStage)).toBe(false);
    expect(code).not.toMatch(/feedbackSample\s*\(/);
  });

  it("declares exactly the motion masters it actually drives", () => {
    // Rotation sways the backdrop drift, Pulse scales punch and flare,
    // Detail thins the skyline and the rehearsal rows, and the skyline reads
    // the spectrum through binAt — all four masters honest.
    expect(presetMasters(lyricStage)).toEqual({
      rotation: true,
      pulse: true,
      detail: true,
      spectrumSmooth: true,
    });
  });

  it("curates all six lenses, with Backdrop led by a params[] knob", () => {
    const groups = new Set(lyricStage.params.map((p) => p.group));
    for (const lens of ["shape", "color", "motion", "reaction", "glow", "backdrop"]) {
      expect(groups.has(lens), `main tier missing ${lens}`).toBe(true);
    }
    expect(lyricStage.params.length).toBe(16);
    expect(lyricStage.advanced?.length).toBe(9);
    // Backdrop's curated face is the skyline, IN params[] — so no advanced
    // spec needs a tier override, and the ABI stays untouched by curation.
    expect(main.get("ghostBars")?.group).toBe("backdrop");
    expect((lyricStage.advanced ?? []).every((s) => s.tier === undefined)).toBe(true);
  });

  it("is never a blank canvas: floor lit, rehearsal on, by default", () => {
    // The GPU matrix fails a black non-extreme frame, and it renders this
    // mode with NO plate bound — so the defaults must light the stage on
    // their own: a non-zero floor, and the rehearsal at full presence.
    expect(advanced.get("stageLevel")!.default).toBeGreaterThan(0);
    expect(advanced.get("rehearse")!.default).toBe(1);
    // ...and no shipped look turns the rehearsal off entirely.
    for (const style of styles) {
      expect(style.values.rehearse ?? 1, `${style.id} kills the rehearsal`).toBeGreaterThan(0);
    }
  });

  it("the rehearsal sweeps with the BAR, from track time either way", () => {
    // Tempo-locked karaoke over placeholder type: barPhase when a grid
    // exists, a fixed track-time walk when none does — never a frame count,
    // never a wall clock, so export and preview rehearse identically.
    expect(code).toContain("select(fract(u.time * 0.22), u.barPhase, u.bpm > 1.0)");
  });

  it("structural switches refuse modulation; counts snap", () => {
    expect(main.get("layout")).toMatchObject({ control: "enum", mod: "off" });
    expect(advanced.get("greekRows")?.mod).toBe("snap");
  });

  it("every option of every enum is exercised by a shipped look", () => {
    for (const spec of allParams(lyricStage)) {
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
    // HERE is coverage: every stage anchor appears, and the set spans the
    // type-size range from reading-machine small to stadium large.
    expect(styles.length).toBeGreaterThanOrEqual(6);
    const anchors = new Set(styles.map((s) => s.values.layout ?? 0));
    expect(anchors).toEqual(new Set([0, 1, 2]));
    const sizes = styles.map((s) => s.values.size ?? defaultParams(lyricStage).size);
    expect(Math.min(...sizes)).toBeLessThanOrEqual(0.8);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(1.4);
  });
});
