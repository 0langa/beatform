// FEAT-001: the shadertoy compat pipeline's CPU-side packers. These are the
// determinism chokepoints — every uniform must derive from track time only,
// and the audio rows must be a pure function of the same arrays the storage
// buffer ABI uploads.
import { describe, expect, it } from "vitest";
import {
  packShadertoyAudioRows,
  packShadertoyUniforms,
  SHADERTOY_AUDIO_WIDTH,
  SHADERTOY_UNIFORM_SIZE,
} from "./webgpuRenderer";

describe("packShadertoyUniforms", () => {
  const pack = (time: number, w = 1920, h = 1080) => {
    const buf = new ArrayBuffer(SHADERTOY_UNIFORM_SIZE);
    packShadertoyUniforms(buf, time, w, h);
    return { f: new Float32Array(buf), i: new Int32Array(buf) };
  };

  it("derives every lane from track time and constants", () => {
    const { f, i } = pack(12.5);
    expect([f[0], f[1], f[2]]).toEqual([1920, 1080, 1]); // iResolution
    expect(f[3]).toBeCloseTo(12.5); // iTime
    expect(f[4]).toBeCloseTo(1 / 60); // iTimeDelta — fixed clock
    expect(f[5]).toBe(60); // iFrameRate
    expect(i[6]).toBe(750); // iFrame = round(12.5 * 60)
    expect(f[7]).toBe(48000); // iSampleRate
    expect([f[8], f[9], f[10], f[11]]).toEqual([0, 0, 0, 0]); // iMouse
    expect(f[15]).toBeCloseTo(12.5); // iDate.w = track seconds
    expect(f[16]).toBe(SHADERTOY_AUDIO_WIDTH); // iChannelResolution[0].x
    expect(f[17]).toBe(2);
    expect(f[32]).toBeCloseTo(12.5); // iChannelTime[0]
  });

  it("is bit-identical for identical time — no wall-clock leakage", () => {
    const a = new ArrayBuffer(SHADERTOY_UNIFORM_SIZE);
    const b = new ArrayBuffer(SHADERTOY_UNIFORM_SIZE);
    packShadertoyUniforms(a, 33.34, 640, 360);
    packShadertoyUniforms(b, 33.34, 640, 360);
    expect(new Uint8Array(a)).toEqual(new Uint8Array(b));
  });

  it("iFrame stays on the fixed 60 Hz grid regardless of caller fps", () => {
    // A 30 fps export frame at t=1/30 and a 144 Hz preview frame at the same
    // t must agree.
    expect(pack(1 / 30).i[6]).toBe(2);
    expect(pack(1 / 144).i[6]).toBe(Math.round(60 / 144));
  });
});

describe("packShadertoyAudioRows", () => {
  const w = SHADERTOY_AUDIO_WIDTH;

  it("resamples spectrum bins linearly across the row and encodes 0..1 in R", () => {
    const bins = new Float32Array([0, 1]); // two bins: straight ramp
    const wave = new Float32Array(w);
    const out = new Uint8Array(w * 2 * 4);
    packShadertoyAudioRows(out, bins, wave);
    expect(out[0]).toBe(0); // first column = bins[0]
    expect(out[(w - 1) * 4]).toBe(255); // last column = bins[1]
    const mid = Math.floor(w / 2);
    expect(Math.abs(out[mid * 4] - 128)).toBeLessThanOrEqual(2); // ~linear middle
    expect(out[3]).toBe(255); // alpha opaque
  });

  it("maps the waveform from -1..1 to Shadertoy's 0..1 row-1 encoding", () => {
    const bins = new Float32Array(96);
    const wave = new Float32Array(w);
    wave[0] = -1;
    wave[1] = 0;
    wave[2] = 1;
    const out = new Uint8Array(w * 2 * 4);
    packShadertoyAudioRows(out, bins, wave);
    expect(out[w * 4]).toBe(0); // -1 -> 0
    expect(out[(w + 1) * 4]).toBe(128); // 0 -> 0.5
    expect(out[(w + 2) * 4]).toBe(255); // 1 -> 1
  });

  it("clamps out-of-range values instead of wrapping", () => {
    const bins = new Float32Array(96).fill(1.5);
    const wave = new Float32Array(w).fill(-2);
    const out = new Uint8Array(w * 2 * 4);
    packShadertoyAudioRows(out, bins, wave);
    expect(out[0]).toBe(255);
    expect(out[w * 4]).toBe(0);
  });

  it("is deterministic for identical inputs", () => {
    const bins = new Float32Array(96).map((_, i) => (i % 7) / 7);
    const wave = new Float32Array(w).map((_, i) => Math.sin(i / 9));
    const a = new Uint8Array(w * 2 * 4);
    const b = new Uint8Array(w * 2 * 4);
    packShadertoyAudioRows(a, bins, wave);
    packShadertoyAudioRows(b, bins, wave);
    expect(a).toEqual(b);
  });
});
