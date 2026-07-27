import { describe, expect, it } from "vitest";
import { echoTrails } from "./echoTrails";

/**
 * The frame-rate law for the one preset that ACCUMULATES.
 *
 * Echo Trails feeds its own output back in, so its steady-state brightness is
 * injection / (1 - loopGain). Normalising the decay per second while leaving
 * the injection per rendered frame does not fix that ratio, it moves it into
 * the level: measured through the real export path at matched TRACK times,
 * the shipped Supernova style rendered at 0.64x the 60 Hz mean luminance at
 * 30 fps and 1.35x at 120 fps. That is preview-equals-export broken by the
 * frame rate alone, which is the app's one non-negotiable.
 *
 * shaderGolden freezes the WGSL text, so an unintended edit shows up there —
 * but a frozen string says nothing about whether the arithmetic is right.
 * These tests cover the two things the fix rests on and that a later edit
 * could quietly break: the exponent really is exactly zero at 60 fps (so the
 * compensation is a bit-exact no-op at the rate the looks were authored at),
 * and the shader's own compensation expression really does hold the
 * accumulator flat across frame rates.
 */
describe("echo-trails frame-rate compensation", () => {
  const body = echoTrails.wgsl;

  /**
   * The 60 fps no-op rests on an f32 identity, not on a comment: the shader
   * writes pow(x, fpsComp - 1.0) because pow(x, 0.0) is exactly 1.0, whereas
   * pow(x, 1.0) is exp2(log2(x)) on real hardware and does not round-trip.
   * That only holds if fpsComp lands on exactly 1.0 — a fact about the
   * export's time base (t = n / fps in f64, differenced, stored as the f32
   * `dt` uniform, multiplied by 60 in the shader), not about the shader.
   */
  it("fpsComp is exactly 1 / 2 / 0.5 at 60 / 30 / 120 fps", () => {
    const comps = (fps: number) => {
      const seen = new Set<number>();
      for (let n = 1; n <= 20000; n++) {
        // webgpuRenderer: dtRaw = time - lastRenderTime, written to an f32 uniform.
        const dt = Math.fround(n / fps - (n - 1) / fps);
        seen.add(Math.fround(dt * 60));
      }
      return [...seen];
    };
    expect(comps(60)).toEqual([1]);
    expect(comps(30)).toEqual([2]);
    expect(comps(120)).toEqual([0.5]);
    // ...and the identity every compensation term in the shader leans on.
    expect(Math.pow(0.93, 1 - 1)).toBe(1);
  });

  /**
   * Structural: anything ADDED into the accumulator has to carry the
   * compensation. That is precisely the regression that shipped — decay and
   * advection were normalised, the two `col +=` injections were not — and a
   * third source term is the obvious way for it to come back.
   */
  it("every source injected into the accumulator carries the compensation", () => {
    const loop = body.slice(body.indexOf("feedbackSample("), body.indexOf("col *= vg;"));
    expect(loop.length).toBeGreaterThan(0);
    const adds = loop.split("\n").filter((l) => /^\s*col \+=/.test(l));
    expect(adds.length).toBeGreaterThanOrEqual(2);
    for (const line of adds) {
      expect(line, `uncompensated injection: ${line.trim()}`).toContain("* deposit");
    }
    // `col = col + ...` would slip past the regex above.
    expect(loop).not.toMatch(/col\s*=\s*col\s*\+/);
    // The fed-back value carries the vignette's share of the loop gain — the
    // vignette multiply at the bottom is inside the loop, not a finishing step.
    expect(loop).toMatch(/feedbackSample\(puv\)[^\n]*\* vgFade;/);
    expect(body).toContain("let vgFade = select(pow(vg, fpsComp - 1.0), 1.0, authored);");
  });

  /**
   * Numeric: run the accumulator to steady state using the shader's OWN
   * expression for the injection scale, lifted out of the WGSL rather than
   * re-typed here. A test that restates the formula and then checks the
   * formula would only assert its own premise.
   */
  it("holds the accumulator level flat across frame rates", () => {
    const src = /let deposit = (.*);/.exec(body)?.[1];
    expect(src, "deposit expression not found in the WGSL").toBeTruthy();
    // WGSL select(falseVal, trueVal, cond) — the shader's 60 fps short circuit.
    const deposit = new Function(
      "loopGain",
      "fpsComp",
      `const pow = Math.pow, min = Math.min;
       const select = (f, t, c) => (c ? t : f);
       const authored = fpsComp === 1.0;
       return ${src};`,
    ) as (loopGain: number, fpsComp: number) => number;

    // Every shipped style's (trail length, vignette) pair, plus the defaults.
    const looks: Array<[number, number]> = [
      [0.92, 0.3],
      [0.97, 0.4],
      [0.9, 0.35],
      [0.87, 0.25],
      [0.98, 0.5],
      [0.91, 0.3],
      [0.96, 0.5],
      [0.93, 0.35],
    ];

    /** One pixel of the shader's loop: col = (col*decay^f*vg^(f-1) + I*deposit)*vg. */
    const settle = (decay: number, vg: number, f: number, compensate: boolean) => {
      const k = compensate ? deposit(Math.min(decay * vg, 0.999), f) : 1;
      const fade = compensate ? Math.pow(vg, f - 1) : 1;
      let col = 0;
      for (let n = 0; n < Math.round(6000 / f); n++)
        col = (col * Math.pow(decay, f) * fade + k) * vg;
      return col;
    };

    for (const [decay, vig] of looks) {
      // vignette() a quarter of the way out: 1 - d*d*amt.
      const vg = 1 - 0.25 * 0.25 * vig;
      const at60 = settle(decay, vg, 1, true);
      // 24, 30, 48, 120 fps — every rate the export offers, plus 144 Hz preview.
      for (const f of [2.5, 2, 1.25, 0.5, 60 / 144]) {
        expect(
          Math.abs(settle(decay, vg, f, true) / at60 - 1),
          `decay ${decay} vignette ${vig} at fpsComp ${f}`,
        ).toBeLessThan(1e-9);
      }
      // 60 fps is untouched: the compensation is exactly 1, not merely close.
      expect(deposit(Math.min(decay * vg, 0.999), 1)).toBe(1);
      // ...and none of this is vacuous — drop the compensation and 30 fps is
      // off by more than 10% on every one of these looks.
      expect(
        Math.abs(settle(decay, vg, 2, false) / at60 - 1),
        `decay ${decay} vignette ${vig}: uncompensated 30 fps should be far off`,
      ).toBeGreaterThan(0.1);
    }
  });
});
