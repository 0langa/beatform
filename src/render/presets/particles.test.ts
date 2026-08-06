import { describe, expect, it } from "vitest";
import { allParams, defaultParams } from "../types";
import { particles } from "./particles";

const body = particles.wgsl;

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`${what} not found in the WGSL`);
  return v;
}

/** Occurrence count of an exact snippet — the pinning tool for expressions
 * that must exist as IDENTICAL copies in two places (dot loop + link pass). */
const countOf = (snippet: string) => body.split(snippet).length - 1;

describe("RP-6 color tier", () => {
  it("exposes the roster-contract saturation and lightness specs", () => {
    const saturation = particles.params.find((p) => p.key === "saturation");
    const lightness = particles.params.find((p) => p.key === "lightness");
    expect(saturation).toMatchObject({
      label: "Saturation",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
    });
    expect(lightness).toMatchObject({
      label: "Lightness",
      group: "color",
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
    });
    // Main tier, like the color-tier reference preset (spectrum-bars) — not
    // buried in advanced.
    const advanced = new Set((particles.advanced ?? []).map((p) => p.key));
    expect(advanced.has("saturation")).toBe(false);
    expect(advanced.has("lightness")).toBe(false);
  });

  it("grades the finished frame once, with a structurally-neutral scaler", () => {
    // Neutrality must NOT rest on mix() rounding at t = 1: saturation 1.0
    // matches neither strict guard (the branch is skipped whole), and
    // lightness 1.0 is an exact IEEE multiply-by-one. Pin the critical lines.
    expect(body).toContain("if (saturation < 1.0) {");
    expect(body).toContain("} else if (saturation > 1.0) {");
    expect(body).toContain("if (lightness <= 1.0) { return adjusted * lightness; }");
    expect(body).toContain("return min(adjusted * lightness, vec3f(1.0));");
    // Applied exactly once, post-tonemap — the whole-visual chokepoint.
    expect(body).toContain("col = presetRgb(tonemap(col * 1.2));");
    expect(body.match(/presetRgb\(/g)).toHaveLength(2); // definition + the one call
  });

  it("no factory style sets the color tier, so every look ships neutral", () => {
    for (const style of particles.styles ?? []) {
      expect(style.values, `style ${style.id}`).not.toHaveProperty("saturation");
      expect(style.values, `style ${style.id}`).not.toHaveProperty("lightness");
    }
  });
});

describe("snare shooting stars", () => {
  it("declares the knob per ParamSpec conventions", () => {
    const spec = particles.params.find((p) => p.key === "shootingStars");
    expect(spec).toMatchObject({
      label: "Shooting stars",
      group: "reaction",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    });
    // A continuous density scalar stays an ordinary smooth modulation target.
    expect(spec?.mod).toBeUndefined();
  });

  it("gates on the snare/transient lane and hard-skips at the 0 default", () => {
    expect(defaultParams(particles).shootingStars).toBe(0);
    expect(body).toContain("let met = P_shootingStars();");
    expect(body).toContain("if (met > 1e-3) {");
    expect(body).toContain("max(u.snare, u.driveBeat * 0.35)");
  });

  it("derives events from track time only — no per-frame state, no wall clock", () => {
    const start = body.indexOf("fn shootingStars");
    const end = body.indexOf("fn cstPoint");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const fn = body.slice(start, end);
    // The only uniforms the event math may read are the track clock and the
    // frame aspect; the audio gate arrives as an argument (sampled at the
    // call site), and u.dt — the per-frame accumulator lane — never appears.
    const reads = new Set(fn.match(/u\.[a-zA-Z]+/g) ?? []);
    expect([...reads].sort()).toEqual(["u.aspect", "u.time"]);
    expect(body).toContain("let slot = floor(u.time / period);");
    expect(body).toContain("let prog = (u.time - birth) / life;");
  });

  it("contains every flight inside its own slot, so no meteor re-seeds mid-air", () => {
    // Lift the shader's own slot constants and prove the invariant over the
    // full hash range: birth is inside the slot and birth + life ends before
    // the slot does. A flight crossing a slot boundary would re-hash its
    // trajectory mid-air — visible as a teleport, and a preview/export
    // divergence hazard for frames sampled around the boundary.
    const birthM = must(
      /let birth = \(slot \+ ([0-9.]+) \+ ([0-9.]+) \* hash21\(seed\)\) \* period;/.exec(body),
      "birth expression",
    );
    const lifeM = must(
      /let life = period \* \(([0-9.]+) \+ ([0-9.]+) \* hash21\(seed \+ 7\.3\)\);/.exec(body),
      "life expression",
    );
    const periodM = must(
      /let period = ([0-9.]+) \+ ([0-9.]+) \* fract\(lane \* 0\.6180339887 \+ 0\.23\);/.exec(body),
      "period expression",
    );
    const [bA, bB] = [Number(birthM[1]), Number(birthM[2])];
    const [lA, lB] = [Number(lifeM[1]), Number(lifeM[2])];
    const [pA, pB] = [Number(periodM[1]), Number(periodM[2])];
    // Analytic worst case over hash outputs in [0, 1): birth fraction + max
    // life fraction stays inside the unit slot, with margin at both ends.
    expect(bA).toBeGreaterThan(0);
    expect(lA).toBeGreaterThan(0);
    expect(bA + bB + lA + lB).toBeLessThan(1);
    // ...and a concrete sweep through the shader's own hash, per lane.
    const fract = (x: number) => x - Math.floor(x);
    const hash21 = (px: number, py: number) => {
      const qx = fract(px * 123.34);
      const qy = fract(py * 345.45);
      const d = qx * (qx + 34.345) + qy * (qy + 34.345);
      return fract((qx + d) * (qy + d));
    };
    for (let lane = 0; lane < 5; lane++) {
      const period = pA + pB * fract(lane * 0.6180339887 + 0.23);
      expect(period).toBeGreaterThan(0);
      const sx = lane * 13.71 + 1.7;
      for (let slot = 0; slot < 300; slot++) {
        const birth = (slot + bA + bB * hash21(sx, slot)) * period;
        const life = period * (lA + lB * hash21(sx + 7.3, slot + 7.3));
        expect(birth).toBeGreaterThanOrEqual(slot * period);
        expect(birth + life).toBeLessThan((slot + 1) * period);
      }
    }
  });
});

describe("constellation linking", () => {
  it("declares the knob per ParamSpec conventions", () => {
    const spec = particles.params.find((p) => p.key === "constellation");
    expect(spec).toMatchObject({
      label: "Constellation",
      group: "shape",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
    });
    expect(spec?.mod).toBeUndefined();
  });

  it("hard-skips at the 0 default", () => {
    expect(defaultParams(particles).constellation).toBe(0);
    expect(body).toContain("let cst = P_constellation();");
    expect(body).toContain("if (cst > 1e-3) {");
  });

  it("computes link endpoints with the dot loop's own expressions", () => {
    // The link pass re-resolves layer-0 particles in cstPoint. Each shared
    // rule must appear as an IDENTICAL copy — an edit that retunes the dots
    // and misses the links (or vice versa) changes a count here.
    const driftExpr =
      "vec2f(sin(wt * (0.8 + 0.5 * h2) + fph), cos(wt * (0.7 + 0.5 * h3) + fph * 1.3)) * 0.34";
    expect(countOf(driftExpr)).toBe(2); // drift dot loop + cstPoint
    expect(countOf("let wob = (drift + gCur) * P_wander();")).toBe(2);
    expect(countOf("normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4)")).toBe(2);
    expect(countOf("softLimit(u.driveBeat * P_beatDance() * 0.35 * pGeo, 0.45)")).toBe(2);
    // Existence rules: fly loop + drift loop + cstPoint all share the fill
    // bound and the clump-modulated fill formula.
    expect(countOf("P_fill() * (1.0 + 0.7 * P_clump())")).toBe(3);
    expect(countOf("mix(P_fill(), P_fill() * (1.7 - 1.4 * clumpN), P_clump())")).toBe(3);
    // Beat-dance equivalence chain: the loop's lets are danceTarget calls,
    // and cstPoint inlines the same mix of the same targets.
    expect(body).toContain("let tPrev = danceTarget(cell, bPrev);");
    expect(body).toContain("let tCur = danceTarget(cell, bIdx);");
    expect(body).toContain("dance = mix(tPrev, tCur, bFr) * danceAmp;");
    expect(body).toContain(
      "dance = mix(danceTarget(cell, bPrev), danceTarget(cell, bIdx), bFr) * danceAmp;",
    );
  });

  it("links join only real dots, and far links fade out instead of clipping", () => {
    expect(body).toContain("if (A.z < 0.5) { continue; }");
    expect(body).toContain("if (B.z < 0.5) { continue; }");
    expect(body).toContain("smoothstep(maxLen, maxLen * 0.5, len)");
  });

  it("keeps every drawn link pixel inside the 3x3 anchor window", () => {
    // The coverage budget, from the shader's own literals: an endpoint sits
    // at most 0.5 + clamp cells from its cell corner; adding the line's outer
    // half-width must stay under 1.0 cells, or a link pixel could fall
    // outside the 3x3 window of a cell adjacent to its anchors and clip
    // along an invisible straight cell border.
    const clampM = must(
      /clamp\(wob \+ dance, vec2f\(-([0-9.]+)\), vec2f\(([0-9.]+)\)\)/.exec(body),
      "endpoint clamp",
    );
    const widthM = must(/let line = smoothstep\(([0-9.]+), ([0-9.]+), dq\);/.exec(body), "width");
    const offMax = Number(clampM[1]);
    expect(Number(clampM[2])).toBe(offMax); // symmetric clamp
    const halfWidth = Number(widthM[1]); // outer edge of the thread
    expect(Number(widthM[2])).toBeLessThan(halfWidth); // inner < outer
    expect(0.5 + offMax + halfWidth).toBeLessThan(1.0);
  });
});

describe("factory deck", () => {
  const byId = new Map((particles.styles ?? []).map((s) => [s.id, s]));

  it("ships the event-driven identities", () => {
    expect(byId.get("meteorShower")?.values.shootingStars).toBeGreaterThan(0.5);
    expect(byId.get("constellation")?.values.constellation).toBeGreaterThan(0.5);
    // Rave's charter is "every reaction knob up" — that now includes meteors.
    expect(byId.get("rave")?.values.shootingStars).toBeGreaterThan(0);
  });

  it("exercises fly + mirror together, and moves energyDrive off its default", () => {
    const prism = byId.get("warpPrism")?.values ?? {};
    expect(prism.fly).toBe(1);
    expect(prism.mirror).toBeGreaterThanOrEqual(6);
    expect(prism.energyDrive).toBeGreaterThan(1);
  });

  it("keeps mixed-size fields represented across the deck", () => {
    const withVar = (particles.styles ?? []).filter((s) => (s.values.sizeVar ?? 0) > 0);
    expect(withVar.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ABI hygiene", () => {
  it("keeps every persisted param key present exactly once", () => {
    const keys = allParams(particles).map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of ["saturation", "lightness", "shootingStars", "constellation"]) {
      expect(keys).toContain(key);
    }
  });
});
