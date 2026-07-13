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
});
