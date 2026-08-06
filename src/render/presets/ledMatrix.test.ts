import { describe, expect, it } from "vitest";
import { presetUsesFeedback } from "../webgpuRenderer";
import { allParams } from "../types";
import { ledMatrix } from "./ledMatrix";

/**
 * LED Matrix depth wave (Track B / B0 rank 4): the Waterfall display and the
 * re-curated main tier.
 *
 * B0's audit called this mode's curated story its worst hole — motion AND
 * beat-response lived entirely behind the Advanced fold — and named the
 * waterfall scroll "the missing spectrogram archetype (lite)". These tests pin
 * the wave's contract: the new params' schema shape, the five-lens curated
 * tier, the track-time scroll derivation, the feedback opt-in, and that every
 * Waterfall enum option has a flagship style (an enum no style exercises is
 * invisible — B0 cross-mode finding #2).
 */
describe("led-matrix depth wave", () => {
  const main = new Map(ledMatrix.params.map((p) => [p.key, p]));
  const advanced = new Map((ledMatrix.advanced ?? []).map((p) => [p.key, p]));
  const styles = ledMatrix.styles ?? [];

  it("display is a curated mode-choice enum: Bars default, both scroll directions, no modulation", () => {
    const display = main.get("display");
    expect(display).toBeDefined();
    expect(display?.control).toBe("enum");
    // A display-mode hop is a structural switch, not a performance move —
    // modulating it would shred the waterfall's accumulated history.
    expect(display?.mod).toBe("off");
    expect(display?.group).toBe("shape");
    // Neutral at default: 0 = Bars, the pre-wave wall.
    expect(display?.default).toBe(0);
    expect(display?.control === "enum" ? display.options.map((o) => o.value) : []).toEqual([
      0, 1, 2,
    ]);
  });

  it("scrollSpeed is curated motion with a log taper over its multiplicative range", () => {
    const speed = main.get("scrollSpeed");
    expect(speed).toMatchObject({ group: "motion", taper: "log", default: 12 });
    // Log taper requires min > 0 (paramModel enforces registry-wide; this
    // pins the intent locally so a retune can't drift the range to 0).
    expect(speed && speed.min > 0).toBe(true);
    expect(speed && speed.max <= 60).toBe(true); // one row per fixed 60 Hz tick is the ceiling
  });

  it("histFade lives in advanced and only shades the waterfall", () => {
    expect(advanced.get("histFade")).toMatchObject({ group: "glow" });
    expect(main.has("histFade")).toBe(false);
  });

  it("curated tier covers all five lenses (the B0 hole this wave closes)", () => {
    const mainGroups = new Set(ledMatrix.params.map((p) => p.group));
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(mainGroups.has(lens), `main tier missing ${lens}`).toBe(true);
    }
    // ~10-12 curated: enough to define the mode, few enough to stay curated.
    expect(ledMatrix.params.length).toBeGreaterThanOrEqual(10);
    expect(ledMatrix.params.length).toBeLessThanOrEqual(12);
  });

  it("promoted ghost + beatBoost sit in main; peaks moved down, nothing lost", () => {
    expect(main.get("ghost")?.group).toBe("motion");
    expect(main.get("beatBoost")?.group).toBe("reaction");
    expect(advanced.has("peaks")).toBe(true);
    // Tier moves never change the persisted key set — every pre-wave key
    // still resolves (saved projects address params by key, forever).
    const keys = new Set(allParams(ledMatrix).map((p) => p.key));
    for (const key of [
      "cols",
      "rows",
      "gap",
      "hueShift",
      "saturation",
      "lightness",
      "dim",
      "rounded",
      "peaks",
      "hueLow",
      "hueHigh",
      "spectrumColor",
      "gradStart",
      "gradEnd",
      "litLevel",
      "hotBoost",
      "beatBoost",
      "ghost",
      "bassGlow",
      "beatFlash",
      "peakBright",
      "bloom",
      "scanline",
      "flicker",
      "panelVariance",
      "vignette",
    ]) {
      expect(keys.has(key), `pre-wave key ${key} vanished`).toBe(true);
    }
  });

  it("waterfall opts into the texture-feedback path and scrolls from track time", () => {
    // feedbackSample() is the opt-in the renderer scans for; history then
    // advances on the fixed 60 Hz track-time clock (fixedFeedback.ts) — the
    // determinism contract every feedback preset shares.
    expect(presetUsesFeedback(ledMatrix)).toBe(true);
    // The scroll position is a pure function of track time, and one state
    // advance shifts by exactly the rows the counter gained over u.dt.
    expect(ledMatrix.wgsl).toContain(
      "let shift = floor(u.time * rate) - floor((u.time - u.dt) * rate);",
    );
    // Row data rides the raw output's alpha channel, which the composite
    // pass never reads — the return must carry it.
    expect(ledMatrix.wgsl).toContain("return vec4f(max(col, vec3f(0.0)), dataA);");
  });

  it("the default display keeps the Bars branch guarded and first", () => {
    // Pixel identity for every pre-wave document rests on the Bars branch
    // being the display < 0.5 side of the split.
    expect(ledMatrix.wgsl).toContain("if (P_display() < 0.5) {");
  });

  it("every Waterfall direction has a flagship style, and each exercises the new motion param", () => {
    const up = styles.filter((s) => s.values.display === 1);
    const down = styles.filter((s) => s.values.display === 2);
    expect(up.length, "no style ships Waterfall Up").toBeGreaterThanOrEqual(1);
    expect(down.length, "no style ships Waterfall Down").toBeGreaterThanOrEqual(1);
    for (const style of [...up, ...down]) {
      expect(
        style.values.scrollSpeed,
        `${style.id}: waterfall style leaves scrollSpeed at default`,
      ).toBeDefined();
      expect(
        style.values.histFade,
        `${style.id}: waterfall style leaves histFade at default`,
      ).toBeDefined();
    }
  });

  it("ships the widened deck: nine named styles plus the defaults chip", () => {
    expect(styles.length).toBe(10);
    expect(Object.keys(styles[0].values)).toHaveLength(0);
  });
});
