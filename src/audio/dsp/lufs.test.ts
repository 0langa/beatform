import { describe, expect, it } from "vitest";
import { integratedLufs, LoudnessMeter, LUFS_FLOOR } from "./lufs";

const SR = 48000;

function sine(freq: number, seconds: number, amplitude: number): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

describe("BS.1770 loudness", () => {
  it("returns the floor for silence", () => {
    expect(integratedLufs([new Float32Array(SR)], SR)).toBe(LUFS_FLOOR);
    const meter = new LoudnessMeter(SR, 1);
    meter.process([new Float32Array(SR)]);
    expect(meter.momentary).toBe(LUFS_FLOOR);
  });

  it("measures a 997 Hz full-scale mono sine at ≈ -3.01 LUFS (reference)", () => {
    // The classic BS.1770 reference point: the shelf's +0.69 dB at 997 Hz
    // cancels the -0.691 offset, leaving 10*log10(0.5) = -3.01 LUFS.
    const lufs = integratedLufs([sine(997, 3, 1)], SR);
    expect(lufs).toBeGreaterThan(-3.2);
    expect(lufs).toBeLessThan(-2.85);
  });

  it("tracks amplitude: -20 dBFS sine ≈ 20 LU below full scale", () => {
    const loud = integratedLufs([sine(997, 3, 1)], SR);
    const quiet = integratedLufs([sine(997, 3, 0.1)], SR);
    expect(loud - quiet).toBeGreaterThan(19.5);
    expect(loud - quiet).toBeLessThan(20.5);
  });

  it("high-passes the sub-bass (25 Hz reads ~10 dB quieter than 997 Hz)", () => {
    // The RLB high-pass corners at ~38 Hz — 60 Hz kicks still count almost
    // fully (-3 dB); real attenuation kicks in below the corner.
    const mid = integratedLufs([sine(997, 3, 0.5)], SR);
    const low = integratedLufs([sine(25, 3, 0.5)], SR);
    expect(mid - low).toBeGreaterThan(8);
    expect(mid - low).toBeLessThan(14);
  });

  it("boosts highs by ~+4 dB (shelf)", () => {
    const mid = integratedLufs([sine(997, 3, 0.5)], SR);
    const high = integratedLufs([sine(8000, 3, 0.5)], SR);
    expect(high - mid).toBeGreaterThan(2.5);
    expect(high - mid).toBeLessThan(5);
  });

  it("stereo sums channel energy (+3 LU vs one channel)", () => {
    const one = integratedLufs([sine(997, 3, 0.5)], SR);
    const two = integratedLufs([sine(997, 3, 0.5), sine(997, 3, 0.5)], SR);
    expect(two - one).toBeGreaterThan(2.6);
    expect(two - one).toBeLessThan(3.4);
  });

  it("gating ignores long silence around a loud burst", () => {
    const burst = sine(997, 2, 0.7);
    const padded = new Float32Array(SR * 10);
    padded.set(burst, SR * 4);
    const gated = integratedLufs([padded], SR);
    const alone = integratedLufs([burst], SR);
    expect(Math.abs(gated - alone)).toBeLessThan(1);
  });

  it("streaming meter converges to the integrated value for steady tones", () => {
    const meter = new LoudnessMeter(SR, 1);
    const tone = sine(997, 1, 0.8);
    for (let i = 0; i < tone.length; i += 4096) {
      meter.process([tone.subarray(i, Math.min(tone.length, i + 4096))]);
    }
    const integrated = integratedLufs([tone], SR);
    expect(Math.abs(meter.momentary - integrated)).toBeLessThan(0.5);
  });

  it("is deterministic", () => {
    const a = integratedLufs([sine(440, 2, 0.6)], SR);
    const b = integratedLufs([sine(440, 2, 0.6)], SR);
    expect(a).toBe(b);
  });
});
