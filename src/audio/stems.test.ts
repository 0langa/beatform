import { describe, expect, it } from "vitest";
import { analyzeStem, STEM_TRACK_KEYS, stemValuesAt, type StemEntry } from "./stems";
import { validModRoutes } from "../state/modMatrix";
import type { PcmData } from "./types";

const SR = 48000;

/** 2 s: pure 80 Hz "bass stem" — bass envelope should dwarf treble. */
function bassStem(): PcmData {
  const length = SR * 2;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = 0.7 * Math.sin((2 * Math.PI * 80 * i) / SR);
  return { sampleRate: SR, length, duration: 2, channels: [data] };
}

describe("stem analysis", () => {
  it("produces per-band envelope timelines at the stem rate", async () => {
    const a = await analyzeStem(bassStem(), "bass.wav");
    expect(a.name).toBe("bass");
    expect(a.rate).toBe(30);
    expect(a.frames).toBe(60);
    for (const k of STEM_TRACK_KEYS) expect(a.tracks[k]).toHaveLength(60);
    // A pure 80 Hz tone: bass hot, treble ~silent (after warmup)
    const mid = 40;
    expect(a.tracks.bass[mid]).toBeGreaterThan(0.4);
    expect(a.tracks.treble[mid]).toBeLessThan(0.05);
  });

  it("is deterministic", async () => {
    const a = await analyzeStem(bassStem(), "x");
    const b = await analyzeStem(bassStem(), "x");
    expect(Array.from(a.tracks.bass)).toEqual(Array.from(b.tracks.bass));
  });
});

describe("stemValuesAt", () => {
  const entry: StemEntry = {
    slot: "stem1",
    analysis: {
      name: "t",
      rate: 30,
      frames: 3,
      tracks: Object.fromEntries(
        STEM_TRACK_KEYS.map((k) => [k, new Float32Array([0, k === "kick" ? 1 : 0.5, 0])]),
      ) as StemEntry["analysis"]["tracks"],
    },
  };

  it("interpolates between envelope frames and keys by source id", () => {
    const v = stemValuesAt([entry], 0.5 / 30)!; // halfway frame 0 -> 1
    expect(v["stem1:kick"]).toBeCloseTo(0.5, 5);
    expect(v["stem1:bass"]).toBeCloseTo(0.25, 5);
  });

  it("reads 0 past the end and returns undefined with no stems", () => {
    expect(stemValuesAt([entry], 99)!["stem1:kick"]).toBe(0);
    expect(stemValuesAt([], 1)).toBeUndefined();
  });
});

describe("stem mod-route validation", () => {
  it("accepts stem sources and rejects malformed ones", () => {
    const routes = validModRoutes([
      { id: "a", source: "stem1:kick", param: "hue", amount: 0.5 },
      { id: "b", source: "stem9:kick", param: "hue", amount: 0.5 }, // bad slot
      { id: "c", source: "stem1:vocals", param: "hue", amount: 0.5 }, // bad track
    ]);
    expect(routes.map((r) => r.id)).toEqual(["a"]);
  });
});
