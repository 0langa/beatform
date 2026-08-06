import { describe, expect, it } from "vitest";
import { aurora } from "./aurora";
import { WGSL_PALETTE_PHASE } from "../wgslLib";
import { SHADER_SOURCES } from "../webgpuRenderer";
import { allParams, defaultParams, groupParams } from "../types";

/**
 * Aurora depth wave (B0, "the canary") — the mode whose problem was expressive
 * RANGE, not knob count: the cosine-palette basis was hardcoded, curtains
 * capped at 3, and the scene had no ground and no moon. The wave's contract is
 * that every one of those walls falls WITHOUT moving a single default pixel:
 * new elements are absent at their defaults and the parameterized palette
 * reduces bit-exactly to the old constant basis. This file proves the parts of
 * that contract a Node test can reach; the device GPU pixel matrix holds the
 * rest (aurora/@defaults, boreal, silk and veil hashes must NOT move).
 */

// --- Lift the shipped arithmetic out of the WGSL (kaleidoFold.test.ts's
// technique): if the shader line changes, the measurement below changes with
// it instead of quietly going stale. The palette expressions are component-
// wise, so a vec3f is evaluated one LANE at a time — the vec3f shim returns
// the lane's component and every other operator stays plain JS arithmetic,
// which makes the identity check exact rather than approximate.

const TAU = Number(/const TAU: f32 = ([0-9.]+);/.exec(SHADER_SOURCES.header)?.[1]);

/** cosPalette's own body, lifted from the shared prelude. */
const cosBody =
  /fn cosPalette\(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f\) -> vec3f \{\s*return ([^;]*);/.exec(
    SHADER_SOURCES.header,
  )?.[1];
const cosPal = (() => {
  if (!cosBody) throw new Error("cosPalette body not found in the prelude");
  return new Function(
    "t",
    "a",
    "b",
    "c",
    "d",
    `const TAU = ${TAU}; const cos = Math.cos; return ${cosBody};`,
  ) as (t: number, a: number, b: number, c: number, d: number) => number;
})();

/** Compile a chain of `let <name> = <expr>;` lines out of the preset body. */
const lift = (names: string[], args: string[]) => {
  const decls = names.map((n) => {
    const src = new RegExp(`let ${n} = ([^;]*);`).exec(aurora.wgsl)?.[1];
    if (src === undefined) throw new Error(`${n} expression not found in the WGSL`);
    return `const ${n} = ${src.replace(/\s+/g, " ")};`;
  });
  return new Function(...args, `${decls.join("\n")}\nreturn ${names[names.length - 1]};`) as (
    ...a: unknown[]
  ) => number;
};

/** vec3f evaluated one lane at a time (single-arg form broadcasts). */
const vec3fLane = (lane: number) => (a: number, b?: number, c?: number) =>
  b === undefined ? a : [a, b, c as number][lane];

const famBChain = lift(["warm", "famB"], ["chroma", "P_palWarm", "vec3f", "abs"]);
const famBOf = (chroma: number, warm: number, lane: number) =>
  famBChain(chroma, () => warm, vec3fLane(lane), Math.abs);

const famDChain = lift(["famD"], ["P_palSpan", "vec3f"]);
const famDOf = (span: number, lane: number) => famDChain(() => span, vec3fLane(lane));

/** The standard phase, parsed from the ONE shared constant — not a copy. */
const PHASE = (() => {
  const m = /^vec3f\(([^)]*)\)$/.exec(WGSL_PALETTE_PHASE.trim());
  if (!m) throw new Error("WGSL_PALETTE_PHASE is not a vec3f literal");
  const parts = m[1].split(",").map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error("WGSL_PALETTE_PHASE did not parse to three numbers");
  }
  return parts;
})();

/** familyPal composed from its lifted pieces (return-line shape pinned below). */
const famPal = (
  t: number,
  base: number,
  chroma: number,
  warm: number,
  span: number,
  lane: number,
) => Math.max(cosPal(t, base, famBOf(chroma, warm, lane), 1.0, famDOf(span, lane)), 0);

/** The basis every call site used before the wave: standard phase, equal
 * amplitudes, frequency 1 — restated from the shared constants it hardcoded. */
const oldBasis = (t: number, base: number, chroma: number, lane: number) =>
  cosPal(t, base, chroma, 1.0, PHASE[lane]);

describe("palette family: defaults reproduce the old constant basis exactly", () => {
  it("the familyPal composition this file evaluates is the one the shader ships", () => {
    // Pins the transcription: the lifted famB/famD chains + this return line
    // ARE familyPal. If the shader's structure changes, fail here first.
    expect(aurora.wgsl).toContain(
      "return max(cosPalette(t, vec3f(base), famB, vec3f(1.0), famD), vec3f(0.0));",
    );
    expect(aurora.wgsl).toContain(`let famD = ${WGSL_PALETTE_PHASE} + (${WGSL_PALETTE_PHASE}`);
  });

  it("warmth 0 leaves every amplitude lane at exactly chroma", () => {
    // The three chroma values the call sites can produce: sat=0, the default
    // sat=0.8, and sat=1 — plus the sky's fixed 0.02.
    for (const chroma of [0.08, 0.416, 0.5, 0.02, 0.4]) {
      for (const lane of [0, 1, 2]) {
        expect(famBOf(chroma, 0, lane)).toBe(chroma);
      }
    }
  });

  it("span 1 leaves every phase lane at exactly the standard phase", () => {
    // The numbers, asserted: (0.0, 0.33, 0.67) — the identity is a multiply
    // by exactly 0, which is exact in IEEE at any float width.
    expect(famDOf(1, 0)).toBe(0.0);
    expect(famDOf(1, 1)).toBe(0.33);
    expect(famDOf(1, 2)).toBe(0.67);
    for (const lane of [0, 1, 2]) expect(famDOf(1, lane)).toBe(PHASE[lane]);
  });

  it("the full palette at default params equals the old basis at every t", () => {
    const warm = aurora.params.find((p) => p.key === "palWarm")!.default;
    const span = aurora.advanced!.find((p) => p.key === "palSpan")!.default;
    expect(warm).toBe(0);
    expect(span).toBe(1);
    // The three real call sites: curtains (0.5, sat-driven), sky (0.025,
    // 0.02), glow (0.5, sat-driven up to 0.4).
    const sites: Array<[number, number]> = [
      [0.5, 0.416],
      [0.5, 0.5],
      [0.5, 0.08],
      [0.025, 0.02],
      [0.5, 0.4],
    ];
    for (const [base, chroma] of sites) {
      for (let i = 0; i <= 96; i++) {
        const t = i / 96;
        for (const lane of [0, 1, 2]) {
          const old = oldBasis(t, base, chroma, lane);
          // The max(0) floor the family adds is inert on the legacy range:
          // every pre-wave setting keeps chroma <= base, so the old palette
          // was never negative...
          expect(old).toBeGreaterThanOrEqual(0);
          // ...and the parameterized palette is EXACTLY the old one. Not
          // toBeCloseTo: the identity is multiply-by-1 / add-0, exact in
          // IEEE, and anything weaker would let real drift hide.
          expect(famPal(t, base, chroma, warm, span, lane)).toBe(old);
        }
      }
    }
  });

  it("...and the family axes actually open new territory (non-vacuity)", () => {
    // Warmth tilts the lanes apart — ember/gold/violet are reachable.
    expect(famBOf(0.416, 0.8, 0)).toBeGreaterThan(famBOf(0.416, 0.8, 2));
    expect(famBOf(0.416, -0.8, 2)).toBeGreaterThan(famBOf(0.416, -0.8, 0));
    // Span 0 collapses all phases to one — a single-tone family.
    expect(famDOf(0, 0)).toBe(famDOf(0, 1));
    expect(famDOf(0, 1)).toBe(famDOf(0, 2));
    // And the output genuinely differs from the old basis off-default.
    expect(famPal(0.25, 0.5, 0.416, 0.8, 0.3, 0)).not.toBe(oldBasis(0.25, 0.5, 0.416, 0));
  });
});

describe("depth-wave params: neutral at default, tagged per wave-0", () => {
  const specs = new Map(allParams(aurora).map((p) => [p.key, p]));

  it("new drawn elements are absent at their defaults, behind explicit gates", () => {
    expect(specs.get("moon")!.default).toBe(0);
    expect(specs.get("ground")!.default).toBe(0);
    // The absence is a branch, not a multiply-by-zero somewhere downstream —
    // at the default the block does not execute at all.
    expect(aurora.wgsl).toContain("if (P_moon() > 0.001)");
    expect(aurora.wgsl).toContain("if (P_ground() > 0.001)");
  });

  it("curtains go to 5, snap-modulated, default still today's 3", () => {
    const layers = specs.get("layers")!;
    expect(layers.control).toBe("enum");
    expect(layers.mod).toBe("snap");
    expect(layers.control === "enum" && layers.options.map((o) => o.value)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(layers.default).toBe(3);
    expect(aurora.wgsl).toContain("for (var i = 0; i < 5; i++)");
  });

  it("palette family axes default to the identity", () => {
    expect(specs.get("palWarm")!.default).toBe(0);
    expect(specs.get("palSpan")!.default).toBe(1);
  });

  it("continuous depth-wave params stay modulation targets", () => {
    for (const key of [
      "palWarm",
      "palSpan",
      "moon",
      "moonX",
      "moonY",
      "moonGlow",
      "ground",
      "groundRough",
    ]) {
      const spec = specs.get(key);
      expect(spec, `missing param ${key}`).toBeDefined();
      expect(spec!.mod, `${key} must stay a smooth mod target`).toBeUndefined();
    }
  });

  it("reflection fade carries the wave's log taper (rate over a 1..12 range)", () => {
    const spec = specs.get("reflectFade")!;
    expect(spec.taper).toBe("log");
    expect(spec.min).toBeGreaterThan(0);
  });

  it("every knob ships a hint", () => {
    for (const spec of allParams(aurora)) {
      expect(spec.hint, `${spec.key} has no hint`).toBeTruthy();
    }
  });

  it("the curated tier covers shape/color/motion/reaction/glow + the scene", () => {
    expect(aurora.params).toHaveLength(12);
    const mainGroups = groupParams(aurora, aurora.params).map((v) => v.group.id);
    for (const lens of ["shape", "color", "motion", "reaction", "glow", "backdrop"]) {
      expect(mainGroups, `curated tier misses ${lens}`).toContain(lens);
    }
  });
});

describe("depth-wave styles: complete keys, and the new territory is used", () => {
  const keys = new Set(allParams(aurora).map((p) => p.key));
  const styles = aurora.styles ?? [];

  it("every style writes only real params", () => {
    for (const style of styles) {
      for (const key of Object.keys(style.values)) {
        expect(keys.has(key), `${style.id} writes unknown param "${key}"`).toBe(true);
      }
    }
  });

  it("the deck exercises every new axis, in both directions where there are two", () => {
    // Style values spread over the defaults — every key is present, so the
    // Partial's `| undefined` cannot actually occur.
    const resolved = styles.map(
      (s) => ({ ...defaultParams(aurora), ...s.values }) as Record<string, number>,
    );
    expect(resolved.some((v) => v.palWarm > 0)).toBe(true); // ember/gold
    expect(resolved.some((v) => v.palWarm < 0)).toBe(true); // ice/violet
    expect(resolved.some((v) => v.palSpan < 1)).toBe(true); // tight family
    expect(resolved.some((v) => v.moon > 0)).toBe(true);
    expect(resolved.some((v) => v.ground > 0)).toBe(true);
    expect(resolved.some((v) => v.layers > 3)).toBe(true); // the deeper stack
  });

  it("the four new identities exist alongside the reworked deck", () => {
    const ids = styles.map((s) => s.id);
    for (const id of ["ember", "moonrise", "ridgeline", "molten"]) {
      expect(ids).toContain(id);
    }
    // First chip is still the defaults (the strip opens on an active chip).
    expect(styles[0]?.values).toEqual({});
  });
});
