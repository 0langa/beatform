import { describe, expect, it } from "vitest";
import { stereoWidth } from "./stereo";

function sine(freq: number, n: number, phase = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / 48000 + phase);
  return out;
}

describe("stereoWidth", () => {
  it("is 0 for identical channels (mono)", () => {
    const s = sine(440, 4096);
    expect(stereoWidth(s, s)).toBe(0);
  });

  it("is 0 for silence", () => {
    expect(stereoWidth(new Float32Array(1024), new Float32Array(1024))).toBe(0);
  });

  it("is 1 for anti-phase channels", () => {
    const l = sine(440, 4096);
    const r = sine(440, 4096, Math.PI);
    expect(stereoWidth(l, r)).toBeGreaterThan(0.98);
  });

  it("is high for decorrelated channels", () => {
    // Different frequencies decorrelate over a full window
    const w = stereoWidth(sine(440, 4096), sine(631, 4096));
    expect(w).toBeGreaterThan(0.8);
  });

  it("scales between mono and wide", () => {
    const l = sine(440, 4096);
    const r = new Float32Array(4096);
    const wide = sine(631, 4096);
    for (let i = 0; i < r.length; i++) r[i] = 0.7 * l[i] + 0.3 * wide[i];
    const w = stereoWidth(l, r);
    expect(w).toBeGreaterThan(0.02);
    expect(w).toBeLessThan(0.5);
  });
});
