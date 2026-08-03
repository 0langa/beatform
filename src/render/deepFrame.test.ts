import { describe, expect, it } from "vitest";
import { deepFrameToRgba64, f16BitsToF32, f16ToUnorm16, stripRowPadding } from "./webgpuRenderer";

/**
 * FEAT-005 deep-colour tap — the CPU side of readbackDeepFrame().
 *
 * JS has no native f16 decode, so webgpuRenderer.ts hand-rolls the IEEE 754
 * binary16 decode; these tests pin it against KNOWN bit patterns (computed by
 * hand from the format definition, not by running the code under test). A
 * silent decode bug here would ship subtly wrong colour in every "10-bit"
 * export while looking plausible on screen — this file is what makes that a
 * red test instead.
 */

describe("f16BitsToF32 — IEEE 754 binary16 decode", () => {
  it("decodes zero and negative zero", () => {
    expect(f16BitsToF32(0x0000)).toBe(0);
    expect(f16BitsToF32(0x8000)).toBe(-0);
  });

  it("decodes exact powers and simple normals", () => {
    expect(f16BitsToF32(0x3c00)).toBe(1.0); // exp 15, mant 0
    expect(f16BitsToF32(0x3800)).toBe(0.5); // exp 14, mant 0
    expect(f16BitsToF32(0x4000)).toBe(2.0);
    expect(f16BitsToF32(0xc000)).toBe(-2.0); // sign bit set
    expect(f16BitsToF32(0x1400)).toBe(2 ** -10);
  });

  it("decodes non-trivial mantissas exactly (f16 values are exact doubles)", () => {
    // 0x3555: exp 13 (2^-2), mant 0x155 = 341 → (1 + 341/1024)/4
    expect(f16BitsToF32(0x3555)).toBe(0.333251953125);
    // 0x7BFF: largest finite = (1 + 1023/1024) * 2^15
    expect(f16BitsToF32(0x7bff)).toBe(65504);
  });

  it("decodes subnormals as mant × 2^-24", () => {
    expect(f16BitsToF32(0x0001)).toBe(2 ** -24); // smallest positive
    expect(f16BitsToF32(0x03ff)).toBe(1023 * 2 ** -24); // largest subnormal
    expect(f16BitsToF32(0x8001)).toBe(-(2 ** -24));
    // Adjacent: smallest NORMAL is 2^-14, strictly above the largest subnormal.
    expect(f16BitsToF32(0x0400)).toBe(2 ** -14);
    expect(f16BitsToF32(0x0400)).toBeGreaterThan(f16BitsToF32(0x03ff));
  });

  it("decodes infinities and NaN", () => {
    expect(f16BitsToF32(0x7c00)).toBe(Infinity);
    expect(f16BitsToF32(0xfc00)).toBe(-Infinity);
    expect(f16BitsToF32(0x7e00)).toBeNaN(); // quiet NaN
    expect(f16BitsToF32(0x7c01)).toBeNaN(); // any nonzero mantissa with exp 31
    expect(f16BitsToF32(0xfe00)).toBeNaN(); // sign bit does not rescue a NaN
  });
});

describe("f16ToUnorm16 — round(clamp(f16, 0, 1) × 65535)", () => {
  it("maps the endpoints", () => {
    expect(f16ToUnorm16(0x0000)).toBe(0); // 0.0
    expect(f16ToUnorm16(0x3c00)).toBe(65535); // 1.0
  });

  it("rounds interior values (0.5 × 65535 = 32767.5 → 32768)", () => {
    expect(f16ToUnorm16(0x3800)).toBe(32768);
    // 2^-10 × 65535 = 63.999… → 64
    expect(f16ToUnorm16(0x1400)).toBe(64);
  });

  it("clamps everything above 1 (bloom overshoot behaves like the 8-bit path)", () => {
    expect(f16ToUnorm16(0x4000)).toBe(65535); // 2.0
    expect(f16ToUnorm16(0x7bff)).toBe(65535); // 65504
    expect(f16ToUnorm16(0x7c00)).toBe(65535); // +Inf
  });

  it("clamps everything below 0", () => {
    expect(f16ToUnorm16(0x8000)).toBe(0); // -0
    expect(f16ToUnorm16(0xbc00)).toBe(0); // -1.0
    expect(f16ToUnorm16(0xfc00)).toBe(0); // -Inf
  });

  it("maps NaN to 0 — no driver-dependent garbage in a deterministic export", () => {
    expect(f16ToUnorm16(0x7e00)).toBe(0);
    expect(f16ToUnorm16(0x7c01)).toBe(0);
    expect(f16ToUnorm16(0xfe00)).toBe(0);
  });

  it("keeps subnormal precision (they are small, not zero)", () => {
    // Smallest positive (2^-24 ≈ 6e-8) is far below one 16-bit step → 0…
    expect(f16ToUnorm16(0x0001)).toBe(0);
    // …but the LARGEST subnormal (1023 × 2^-24 ≈ 6.1e-5) spans four steps:
    // 1023 × 2^-24 × 65535 = 3.996 → 4. Flooring subnormals to 0 would crush
    // the deepest shadows — the exact band a 10-bit export exists to keep.
    expect(f16ToUnorm16(0x03ff)).toBe(4);
  });
});

/** Fabricate a padded readback buffer: each row is `rowWords` payload words
 * (values from `value(y, i)`) followed by sentinel padding up to the padded
 * row width — the sentinel proves the stripper never reads padding. */
function paddedBuffer(
  width: number,
  height: number,
  paddedBytesPerRow: number,
  value: (y: number, i: number) => number,
): Uint16Array {
  const rowWords = width * 4;
  const srcRowWords = paddedBytesPerRow / 2;
  const src = new Uint16Array(srcRowWords * height).fill(0xdead);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < rowWords; i++) src[y * srcRowWords + i] = value(y, i);
  }
  return src;
}

describe("stripRowPadding — 256-byte row alignment removal", () => {
  it("drops the padding tail of every row and nothing else", () => {
    // width 2 → 16 payload bytes/row, padded to WebGPU's 256-byte minimum.
    const src = paddedBuffer(2, 3, 256, (y, i) => 1000 * y + i);
    const out = stripRowPadding(src, 2, 3, 256);
    expect(out.length).toBe(2 * 3 * 4);
    expect(Array.from(out)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 2000, 2001, 2002,
      2003, 2004, 2005, 2006, 2007,
    ]);
    // The sentinel never leaks through.
    expect(out.includes(0xdead)).toBe(false);
  });

  it("is a plain copy when rows are already 256-byte aligned", () => {
    // width 32 → exactly 256 bytes/row: padded and tight layouts coincide.
    const src = paddedBuffer(32, 2, 256, (y, i) => (y << 8) | i);
    const out = stripRowPadding(src, 32, 2, 256);
    expect(out.length).toBe(src.length);
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  it("handles a single row", () => {
    const src = paddedBuffer(1, 1, 256, (_y, i) => 40000 + i);
    expect(Array.from(stripRowPadding(src, 1, 1, 256))).toEqual([40000, 40001, 40002, 40003]);
  });
});

describe("deepFrameToRgba64 — fused strip + convert", () => {
  it("equals f16ToUnorm16 mapped over stripRowPadding, elementwise", () => {
    // Deterministic pseudo-random f16 bit patterns covering the whole u16
    // range — including patterns that decode to NaN/Inf/negatives, so the
    // fused path's use of the lookup table is exercised across every class.
    let s = 12345;
    const next = () => {
      s = (s * 1103515245 + 12321) & 0x7fffffff;
      return s & 0xffff;
    };
    const src = paddedBuffer(5, 4, 256, () => next());
    const fused = deepFrameToRgba64(src, 5, 4, 256);
    const reference = Array.from(stripRowPadding(src, 5, 4, 256)).map(f16ToUnorm16);
    expect(fused.length).toBe(5 * 4 * 4);
    expect(Array.from(fused)).toEqual(reference);
  });

  it("converts the canonical endpoints in place", () => {
    // One pixel per row: [0, 0.5, 1, NaN] → [0, 32768, 65535, 0].
    const src = paddedBuffer(1, 2, 256, (y, i) => [0x0000, 0x3800, 0x3c00, 0x7e00][i] + y * 0);
    const out = deepFrameToRgba64(src, 1, 2, 256);
    expect(Array.from(out)).toEqual([0, 32768, 65535, 0, 0, 32768, 65535, 0]);
  });
});
