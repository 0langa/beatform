import { describe, expect, it } from "vitest";
import { estimateKey } from "./keyDetect";

const SR = 48000;

/** Notes (as semitones from C4) played as a sequence of sine chords. */
function chordTrack(chords: number[][], secondsPerChord = 1): Float32Array {
  const total = Math.round(SR * secondsPerChord * chords.length);
  const out = new Float32Array(total);
  const perChord = Math.round(SR * secondsPerChord);
  chords.forEach((notes, c) => {
    const base = c * perChord;
    for (const semi of notes) {
      const freq = 261.6256 * Math.pow(2, semi / 12);
      for (let i = 0; i < perChord; i++) {
        out[base + i] += 0.2 * Math.sin((2 * Math.PI * freq * i) / SR);
      }
    }
  });
  return out;
}

/** White noise: flat expected spectrum, no tonal center. */
function whiteNoise(seconds: number): Float32Array {
  const n = Math.round(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
  return out;
}

/** Pure percussion stand-in: jittered decaying noise bursts (drum hits with
 * no pitched content), silence between. Timing and decay are randomized per
 * hit so the result isn't a perfectly periodic envelope, which would itself
 * introduce spurious spectral structure. */
function percussionTrack(seconds: number): Float32Array {
  const n = Math.round(SR * seconds);
  const out = new Float32Array(n);
  let t = 0;
  while (t < n) {
    const decay = SR * (0.03 + Math.random() * 0.05);
    const len = Math.min(n - t, Math.round(decay * 8));
    for (let i = 0; i < len; i++) {
      out[t + i] += Math.exp(-i / decay) * (Math.random() * 2 - 1) * 0.8;
    }
    t += Math.round(SR * (0.15 + Math.random() * 0.6));
  }
  return out;
}

describe("key detection", () => {
  it("detects C major from a I-IV-V-I progression", () => {
    // C (C,E,G) F (F,A,C) G (G,B,D) C
    const track = chordTrack([
      [0, 4, 7],
      [5, 9, 12],
      [7, 11, 14],
      [0, 4, 7],
    ]);
    const key = estimateKey(track, SR);
    expect(key).not.toBeNull();
    expect(key!.name).toBe("C major");
    expect(key!.confidence).toBeGreaterThan(0.5);
  });

  it("detects A minor from a i-iv-v-i progression", () => {
    // Am (A,C,E) Dm (D,F,A) Em (E,G,B) Am — natural minor
    const track = chordTrack([
      [9, 12, 16],
      [2, 5, 9],
      [4, 7, 11],
      [9, 12, 16],
    ]);
    const key = estimateKey(track, SR);
    expect(key).not.toBeNull();
    expect(key!.tonic).toBe(9); // A
    expect(key!.mode).toBe("minor");
  });

  it("detects a transposed key (E major)", () => {
    // E (E,G#,B) A (A,C#,E) B (B,D#,F#) E
    const track = chordTrack([
      [4, 8, 11],
      [9, 13, 16],
      [11, 15, 18],
      [4, 8, 11],
    ]);
    const key = estimateKey(track, SR);
    expect(key).not.toBeNull();
    expect(key!.tonic).toBe(4); // E
    expect(key!.mode).toBe("major");
  });

  it("returns null for silence", () => {
    expect(estimateKey(new Float32Array(SR * 2), SR)).toBeNull();
  });

  it("is deterministic", () => {
    const track = chordTrack([
      [0, 4, 7],
      [7, 11, 14],
    ]);
    const a = estimateKey(track, SR);
    const b = estimateKey(track, SR);
    expect(a).toEqual(b);
  });

  // Regression: estimateKey's docblock promises null "when there's no tonal
  // content", but the only null path was total silence — white noise and
  // percussion got the least-bad of 24 correlations handed back as a
  // confident-looking key. Verified empirically (see keyDetect.ts) over
  // hundreds of trials: noise/percussion chroma never exceeds a ~1.7
  // peak-to-mean ratio, while every tonal signal tested (a single sustained
  // tone, a short chord, a full progression, even a chord half-buried in
  // noise) clears 2.4 — so a handful of trials here is not a coin flip.
  it("returns null for white noise (atonal content)", () => {
    for (let trial = 0; trial < 8; trial++) {
      expect(estimateKey(whiteNoise(4), SR)).toBeNull();
    }
  });

  it("returns null for pure percussion (atonal content)", () => {
    for (let trial = 0; trial < 8; trial++) {
      expect(estimateKey(percussionTrack(4), SR)).toBeNull();
    }
  });

  it("still detects a key when a chord is buried under noise", () => {
    const track = chordTrack([
      [0, 4, 7],
      [5, 9, 12],
      [7, 11, 14],
      [0, 4, 7],
    ]);
    for (let i = 0; i < track.length; i++) track[i] += (Math.random() * 2 - 1) * 0.2;
    const key = estimateKey(track, SR);
    expect(key).not.toBeNull();
    expect(key!.name).toBe("C major");
  });
});
