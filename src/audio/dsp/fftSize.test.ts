import { describe, expect, it } from "vitest";
import { analysisFftSize } from "./fftSize";
import { WAVEFORM_LENGTH } from "../featurePipeline";

describe("analysisFftSize", () => {
  it("leaves the common rates on 4096, so 48 kHz cannot move", () => {
    expect(analysisFftSize(44100)).toBe(4096);
    expect(analysisFftSize(48000)).toBe(4096);
  });

  it("doubles with the rate so the analysis WINDOW stays constant", () => {
    expect(analysisFftSize(88200)).toBe(8192);
    expect(analysisFftSize(96000)).toBe(8192);
    expect(analysisFftSize(176400)).toBe(16384);
    expect(analysisFftSize(192000)).toBe(16384);
  });

  it("holds the window near the 48 kHz reference on the 48 kHz family", () => {
    // 48, 96 and 192 kHz are exact multiples of the reference, so they land on
    // 85.33 ms exactly.
    const ref = 4096 / 48000;
    for (const sr of [48000, 96000, 192000]) {
      expect(analysisFftSize(sr) / sr, `window at ${sr}`).toBeCloseTo(ref, 10);
    }
  });

  it("runs the 44.1 kHz family the same 7.5 ms long that 44.1 kHz already does", () => {
    // 92.88 ms rather than 85.33. Nothing can be done about that without a
    // non-power-of-two transform: the whole 44.1 family shares its sizes with
    // the 48 family. What matters is that 88.2 and 176.4 kHz inherit the SAME
    // small offset 44.1 kHz has always had, rather than a new one of their own.
    const at441 = analysisFftSize(44100) / 44100;
    for (const sr of [88200, 176400]) {
      expect(analysisFftSize(sr) / sr, `window at ${sr}`).toBeCloseTo(at441, 10);
    }
    expect(at441 * 1000).toBeCloseTo(92.88, 1);
  });

  it("holds bins-per-hertz constant, which is what keeps bands comparable", () => {
    const ref = 4096 / 2 / (48000 / 2);
    for (const sr of [48000, 96000, 192000]) {
      // and 44.1/88.2/176.4 share theirs
      const bph = analysisFftSize(sr) / 2 / (sr / 2);
      expect(bph).toBeCloseTo(ref, 10);
    }
  });

  it("always leaves headroom for the zero-crossing trigger", () => {
    for (const sr of [8000, 44100, 48000, 96000, 192000, 384000]) {
      expect(analysisFftSize(sr), `headroom at ${sr}`).toBeGreaterThan(WAVEFORM_LENGTH);
    }
  });

  it("returns a power of two for every rate", () => {
    for (const sr of [8000, 22050, 44100, 48000, 88200, 96000, 176400, 192000, 384000]) {
      const n = analysisFftSize(sr);
      expect(n & (n - 1), `power of two at ${sr}`).toBe(0);
    }
  });

  it("falls back safely on nonsense input", () => {
    expect(analysisFftSize(0)).toBe(4096);
    expect(analysisFftSize(-1)).toBe(4096);
    expect(analysisFftSize(NaN)).toBe(4096);
  });
});
