import { describe, expect, it } from "vitest";
import { spectrumBars } from "./spectrumBars";
import { allParams, defaultParams, groupParams, presetMasters } from "../types";

/**
 * Spectrum-bars depth wave (Track B batch 2) — the mode's ceiling was a single
 * centered mono spectrum: no stereo story, hard rect tops, no floor, no
 * frequency trim, no motion lens. The wave's contract is that every one of
 * those walls falls WITHOUT moving a single default pixel: the stereo notch,
 * crown, pool, trim and sway all reduce to exact IEEE identities (multiply by
 * 0/1, add/subtract 0) or to branches that cannot be entered at the defaults.
 * This file proves the parts of that contract a Node test can reach; the
 * device GPU pixel matrix holds the rest (spectrum-bars/@defaults and the
 * seven legacy style hashes must NOT move).
 */

const wgsl = spectrumBars.wgsl;

/** WGSL builtins the lifted expressions call, restated as plain JS. The
 * identities asserted below (x*0, x*1, x+0, max with a dominated arm) are
 * exact in IEEE at ANY float width, so evaluating in f64 proves the f32 GPU
 * case (aurora.test.ts's argument). */
const step = (edge: number, x: number) => (x >= edge ? 1 : 0);

/** Extract the right-hand side of one `<head> <expr>;` in the shader (head
 * includes the `=` or `+=`), so the measurements below track the shipped line
 * instead of quietly going stale. */
const rhs = (head: string): string => {
  const esc = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc} ([^;]+);`).exec(wgsl);
  if (!m) throw new Error(`expression not found in the WGSL: ${head}`);
  return m[1].replace(/\s+/g, " ").trim();
};

describe("sway: the added shift is an exact zero at the default", () => {
  const expr = rhs("uv.x +=");
  const shiftOf = new Function("u", "uv", "P_sway", "sin", `return ${expr};`) as (
    u: { time: number; spin: number },
    uv: { y: number },
    sway: () => number,
    sin: (x: number) => number,
  ) => number;

  it("the shipped line is the one measured (uv.x += <term>)", () => {
    expect(wgsl).toContain(`uv.x += ${expr};`);
    // Deterministic clock + the Motion→Rotation master's handle, by name.
    expect(expr).toContain("u.time");
    expect(expr).toContain("u.spin");
  });

  it("at sway 0, uv.x + term === uv.x for every uv.x (add-±0 identity)", () => {
    for (const time of [0, 1.37, 60.5, 3600]) {
      for (const spin of [0, 0.5, 1, 2]) {
        for (const uvy of [0, 0.25, 0.5, 1]) {
          const term = shiftOf({ time, spin }, { y: uvy }, () => 0, Math.sin);
          expect(term === 0).toBe(true); // ±0 both compare equal to 0
          for (const uvx of [0, 0.001, 0.5, 0.999, 1]) {
            expect(uvx + term).toBe(uvx);
          }
        }
      }
    }
  });

  it("...and actually moves off-default (non-vacuity)", () => {
    expect(shiftOf({ time: 1, spin: 1 }, { y: 0 }, () => 1, Math.sin)).not.toBe(0);
    // Anchored at the floor: no lean at the bottom edge regardless of sway.
    expect(shiftOf({ time: 1, spin: 1 }, { y: 1 }, () => 1, Math.sin)).toBe(0);
  });
});

describe("stereo split: the notch multiplies gapMask by exactly 1 at the default", () => {
  const sepExpr = rhs("let sep =");
  const notchExpr = rhs("let notch =");
  const maskExpr = rhs("var gapMask =");
  const sepOf = new Function("P_stereoSplit", "u", "P_barGap", "min", `return ${sepExpr};`) as (
    split: () => number,
    u: { width: number },
    gap: () => number,
    min: typeof Math.min,
  ) => number;
  const notchOf = new Function("sep", "inBar", "step", `return ${notchExpr};`) as (
    sep: number,
    inBar: number,
    step: (e: number, x: number) => number,
  ) => number;
  const maskOf = new Function("P_barGap", "inBar", "notch", "step", `return ${maskExpr};`) as (
    gap: () => number,
    inBar: number,
    notch: number,
    step: (e: number, x: number) => number,
  ) => number;

  it("the split rides the live width lane (u.width), by name", () => {
    expect(sepExpr).toContain("P_stereoSplit() * u.width");
  });

  const inBars = [0, 0.11, 0.25, 0.4999, 0.5, 0.5001, 0.75, 0.89, 0.999];

  it("split 0 (or a mono source, width 0) leaves every mask value bit-identical", () => {
    for (const [split, width] of [
      [0, 0],
      [0, 1],
      [1, 0], // stereoSplit up but the track is mono — degrades to today
    ]) {
      for (const gap of [0, 0.22, 0.6]) {
        const sep = sepOf(
          () => split,
          { width },
          () => gap,
          Math.min,
        );
        expect(sep === 0).toBe(true);
        for (const inBar of inBars) {
          const notch = notchOf(sep, inBar, step);
          expect(notch).toBe(0); // both step edges coincide at 0.5
          const base = step(gap * 0.5, inBar) * step(inBar, 1 - gap * 0.5);
          expect(maskOf(() => gap, inBar, notch, step)).toBe(base);
        }
      }
    }
  });

  it("a wide track genuinely cracks the bar into a pair (non-vacuity)", () => {
    const sep = sepOf(
      () => 1,
      { width: 1 },
      () => 0.22,
      Math.min,
    );
    expect(sep).toBeGreaterThan(0);
    // Cell center falls inside the notch; the posts either side survive.
    expect(maskOf(() => 0.22, 0.5, notchOf(sep, 0.5, step), step)).toBe(0);
    expect(maskOf(() => 0.22, 0.13, notchOf(sep, 0.13, step), step)).toBe(1);
    // The cap keeps a minimum post: sep never eats the whole body.
    expect(sep).toBeLessThan(0.5 - 0.22 * 0.5 - 0.029);
  });
});

describe("frequency trim: spanPos is the identity at the defaults", () => {
  const m =
    /fn spanPos\(pos: f32\) -> f32 \{\s*let lo = ([^;]+);\s*let hi = ([^;]+);\s*return ([^;]+);/.exec(
      wgsl,
    );
  if (!m) throw new Error("spanPos body not found in the WGSL");
  const spanOf = new Function(
    "pos",
    "P_freqLo",
    "P_freqHi",
    "max",
    `const lo = ${m[1]}; const hi = ${m[2]}; return ${m[3]};`,
  ) as (pos: number, lo: () => number, hi: () => number, max: typeof Math.max) => number;

  it("lo 0 / hi 1 returns pos bit-exactly at every position", () => {
    for (let i = 0; i <= 96; i++) {
      const pos = i / 96;
      expect(
        spanOf(
          pos,
          () => 0,
          () => 1,
          Math.max,
        ),
      ).toBe(pos);
    }
    // Including the raw bar-center values the shader actually produces.
    for (const pos of [0.5 / 96, 17.5 / 96, 0.001, 0.9999]) {
      expect(
        spanOf(
          pos,
          () => 0,
          () => 1,
          Math.max,
        ),
      ).toBe(pos);
    }
  });

  it("a trimmed span maps the screen onto the window (non-vacuity)", () => {
    expect(
      spanOf(
        0,
        () => 0.2,
        () => 0.8,
        Math.max,
      ),
    ).toBeCloseTo(0.2, 12);
    expect(
      spanOf(
        1,
        () => 0.2,
        () => 0.8,
        Math.max,
      ),
    ).toBeCloseTo(0.8, 12);
    // The inversion guard: hi never falls below lo + 0.05.
    expect(wgsl).toContain("max(P_freqHi(), lo + 0.05)");
    expect(
      spanOf(
        1,
        () => 0.7,
        () => 0.25,
        Math.max,
      ),
    ).toBeCloseTo(0.75, 12);
  });
});

describe("reflection + bar tops: absent at defaults behind explicit gates", () => {
  const specs = new Map(allParams(spectrumBars).map((p) => [p.key, p]));

  it("new drawn territory defaults to 0 / identity", () => {
    expect(specs.get("stereoSplit")!.default).toBe(0);
    expect(specs.get("capShape")!.default).toBe(0);
    expect(specs.get("reflect")!.default).toBe(0);
    expect(specs.get("sway")!.default).toBe(0);
    expect(specs.get("freqLo")!.default).toBe(0);
    expect(specs.get("freqHi")!.default).toBe(1);
  });

  it("the pool is a branch that cannot be entered at the default", () => {
    // base = 0 puts the baseline on the screen edge; y = 1 - uv.y - 0 >= 0
    // for every pixel, so `y < 0.0` selects nothing.
    expect(wgsl).toContain("let base = P_reflect() * 0.24;");
    expect(wgsl).toContain("let y = 1.0 - uv.y - base;");
    expect(wgsl).toContain("if (P_reflect() > 0.001 && y < 0.0)");
  });

  it("the crown is a branch, and flat tops subtract an exact 0", () => {
    expect(wgsl).toContain("var crown = 0.0;");
    expect(wgsl).toContain("if (P_capShape() > 0.5 && u.smoothBins < 0.5)");
    expect(wgsl).toContain("let topH = barH - crown;");
  });

  it("dot caps replace the hairline only past the second enum notch", () => {
    expect(wgsl).toContain("var capM = smoothstep(0.006, 0.0, capD);");
    expect(wgsl).toContain("if (P_capShape() > 1.5 && u.smoothBins < 0.5)");
    // The pool guard on the cap add is a multiply by step(0.0, y) — exactly
    // 1.0 for every pixel while the baseline sits on the screen edge.
    expect(wgsl).toContain("* step(0.5, P_peaks()) * step(0.0, y);");
  });
});

describe("param specs: conventions of the wave", () => {
  const specs = new Map(allParams(spectrumBars).map((p) => [p.key, p]));

  it("capShape is an enum with mod off and one option per shape", () => {
    const spec = specs.get("capShape")!;
    expect(spec.control).toBe("enum");
    expect(spec.mod).toBe("off");
    expect(spec.control === "enum" && spec.options.map((o) => o.value)).toEqual([0, 1, 2]);
  });

  it("reflection fade carries the log taper over its 1..12 rate range", () => {
    const spec = specs.get("reflectFade")!;
    expect(spec.taper).toBe("log");
    expect(spec.min).toBeGreaterThan(0);
    expect(spec.max).toBe(12);
  });

  it("continuous new params stay smooth modulation targets", () => {
    for (const key of ["stereoSplit", "reflect", "sway", "reflectFade", "freqLo", "freqHi"]) {
      const spec = specs.get(key);
      expect(spec, `missing param ${key}`).toBeDefined();
      expect(spec!.mod, `${key} must stay a smooth mod target`).toBeUndefined();
    }
  });

  it("every knob ships a hint", () => {
    for (const spec of allParams(spectrumBars)) {
      expect(spec.hint, `${spec.key} has no hint`).toBeTruthy();
    }
  });

  it("the curated tier now covers all five lenses (motion was missing)", () => {
    const mainGroups = groupParams(spectrumBars, spectrumBars.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "motion", "reaction", "glow"]) {
      expect(mainGroups, `curated tier misses ${lens}`).toContain(lens);
    }
  });

  it("the mode now advertises every motion master, rotation included", () => {
    // u.spin in live code (not a comment) is what flips the Rotation master
    // on — presetMasters scans comment-stripped source.
    expect(presetMasters(spectrumBars)).toEqual({
      rotation: true,
      pulse: true,
      detail: true,
      spectrumSmooth: true,
    });
  });
});

describe("IDs are forever: preset id, param keys and legacy styles survive", () => {
  it("the preset id and every pre-wave param key are unchanged", () => {
    expect(spectrumBars.id).toBe("spectrum-bars");
    const keys = new Set(allParams(spectrumBars).map((p) => p.key));
    for (const key of [
      "hue",
      "hueSpread",
      "saturation",
      "lightness",
      "glow",
      "barGap",
      "beatZoom",
      "mirror",
      "peaks",
      "barHeight",
      "barSat",
      "barLift",
      "glowReach",
      "capBright",
      "bgLevel",
      "bgBassGlow",
      "beatFlash",
      "beatBright",
      "vignette",
    ]) {
      expect(keys.has(key), `pre-wave key "${key}" is gone`).toBe(true);
    }
  });

  it("the legacy deck keeps its ids; the four new identities join it", () => {
    const ids = (spectrumBars.styles ?? []).map((s) => s.id);
    for (const id of [
      "classic",
      "emberWall",
      "hairline",
      "neonMirror",
      "skyline",
      "broadcast",
      "slowBurn",
      "pulseRoom",
    ]) {
      expect(ids, `legacy style "${id}" is gone`).toContain(id);
    }
    for (const id of ["stereoField", "nightStage", "hiFi", "undertow"]) {
      expect(ids, `new style "${id}" missing`).toContain(id);
    }
    // First chip is still the defaults (the strip opens on an active chip).
    expect(spectrumBars.styles?.[0]?.values).toEqual({});
  });
});

describe("styles: complete keys, and the new territory is used", () => {
  const keys = new Set(allParams(spectrumBars).map((p) => p.key));
  const styles = spectrumBars.styles ?? [];

  it("every style writes only real params", () => {
    for (const style of styles) {
      for (const key of Object.keys(style.values)) {
        expect(keys.has(key), `${style.id} writes unknown param "${key}"`).toBe(true);
      }
    }
  });

  it("the deck exercises every new axis, every enum option included", () => {
    const resolved = styles.map(
      (s) => ({ ...defaultParams(spectrumBars), ...s.values }) as Record<string, number>,
    );
    expect(resolved.some((v) => v.stereoSplit > 0)).toBe(true); // the pair
    expect(resolved.some((v) => v.reflect > 0)).toBe(true); // the floor
    expect(resolved.some((v) => v.sway > 0)).toBe(true); // the lean
    expect(resolved.some((v) => v.capShape === 1)).toBe(true); // rounded
    expect(resolved.some((v) => v.capShape === 2)).toBe(true); // dot caps
    expect(resolved.some((v) => v.freqLo > 0 && v.freqHi < 1)).toBe(true); // trim
  });
});
