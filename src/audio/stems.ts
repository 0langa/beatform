import type { PcmData } from "./types";
import { OfflineAnalyzer } from "./offlineSource";

/**
 * Stem import: analysis-only sidecar tracks. A stem (drums.wav, bass.wav,
 * vocals.wav — bounced from the same session as the master) is never played;
 * it is analyzed once into per-feature envelope timelines that the modulation
 * matrix can route to any knob ("drums-stem kick → tunnel speed"), sampled at
 * track time. Deterministic by construction: the timelines are fixed arrays,
 * and live + export sample them with the same interpolation.
 *
 * Alignment assumption: stems start at 0:00 of the master (how every DAW
 * bounces them). Rate is 30 envelope frames/second — modulation smoothness,
 * not audio fidelity.
 */

export const STEM_TRACK_KEYS = ["energy", "bass", "mid", "treble", "kick", "snare", "hat"] as const;
export type StemTrackKey = (typeof STEM_TRACK_KEYS)[number];

export const STEM_SLOTS = ["stem1", "stem2", "stem3", "stem4"] as const;
export type StemSlot = (typeof STEM_SLOTS)[number];
export const MAX_STEMS = STEM_SLOTS.length;

export const STEM_RATE = 30;

export interface StemAnalysis {
  /** Display name (the file name, extension stripped). */
  name: string;
  /** Envelope frames per second. */
  rate: number;
  frames: number;
  tracks: Record<StemTrackKey, Float32Array>;
}

export interface StemEntry {
  slot: StemSlot;
  analysis: StemAnalysis;
}

/**
 * Analyze a decoded stem into envelope timelines. Chunked with yields so a
 * multi-minute stem doesn't freeze the UI (~0.3 ms/frame of FFT work).
 */
export async function analyzeStem(pcm: PcmData, name: string): Promise<StemAnalysis> {
  const analyzer = new OfflineAnalyzer(pcm, STEM_RATE);
  const frames = analyzer.frameCount;
  const tracks = Object.fromEntries(
    STEM_TRACK_KEYS.map((k) => [k, new Float32Array(frames)]),
  ) as Record<StemTrackKey, Float32Array>;
  for (let n = 0; n < frames; n++) {
    const f = analyzer.nextFrameFeatures();
    for (const k of STEM_TRACK_KEYS) tracks[k][n] = f[k];
    if (n % 256 === 255) await new Promise((r) => setTimeout(r, 0));
  }
  return { name: name.replace(/\.[a-z0-9]+$/i, ""), rate: STEM_RATE, frames, tracks };
}

/**
 * Sample every loaded stem's envelopes at track time t, keyed
 * "stem1:kick"-style — exactly the modulation-source ids. Linear
 * interpolation between envelope frames; past the end (stem shorter than the
 * master) everything reads 0.
 */
export function stemValuesAt(stems: StemEntry[], t: number): Record<string, number> | undefined {
  if (stems.length === 0) return undefined;
  const out: Record<string, number> = {};
  for (const { slot, analysis } of stems) {
    const fi = t * analysis.rate;
    const i = Math.floor(fi);
    const fr = fi - i;
    const last = analysis.frames - 1;
    for (const k of STEM_TRACK_KEYS) {
      let v = 0;
      if (i >= 0 && i <= last) {
        const a = analysis.tracks[k][i];
        const b = analysis.tracks[k][Math.min(i + 1, last)];
        v = a + (b - a) * fr;
      }
      out[`${slot}:${k}`] = v;
    }
  }
  return out;
}
