/**
 * Lyrics-derived vocal presence: a 0..1 envelope that is 1 while a timed
 * word/line is being sung and 0 in instrumental stretches, with short ramps
 * at the edges so it modulates rather than gates.
 *
 * DOCUMENT-derived, not a DSP estimate — the input is the same timed-lyrics
 * model the overlay renders (.lrc word/line timings), and the output is a
 * PURE function of (spans, t). That is what makes it deterministic: no
 * envelope state, no wall clock, so a seek resolves the identical value the
 * export renders at that track moment, and the live and offline sources
 * share this one code path by construction. `AudioFeatures.voice` (the DSP
 * voice-band energy) is a different, coexisting thing.
 *
 * The line/word shapes are STRUCTURAL mirrors of `LyricLine`/`LyricWord`
 * (src/state/lyrics.ts) rather than imports: src/audio is a leaf that the
 * state layer depends on, not the reverse. The end-resolution conventions
 * below are copied from that module so presence agrees with what the karaoke
 * wipe draws: a line ends at its explicit end, else the next line's start,
 * else start + 4 s (lyricProgressAt's nominal open-ended window); a word ends
 * at its explicit end, else the next word's start, else the line end.
 */

/** One sung interval, seconds of track time, start <= end. */
export interface VocalSpan {
  start: number;
  end: number;
}

/** Structural subset of LyricWord — see the module comment. */
interface TimedWord {
  t: number;
  end: number | null;
}

/** Structural subset of LyricLine. */
interface TimedLine {
  t: number;
  end: number | null;
  words?: readonly TimedWord[];
}

/** Presence rises over this many seconds before a span's start. */
export const VOCAL_ATTACK_SEC = 0.08;
/** Presence falls over this many seconds after a span's end. */
export const VOCAL_RELEASE_SEC = 0.25;
/**
 * Word/line intervals closer than this merge into one phrase span. Breaths
 * and inter-word gaps should not flutter the envelope — and because this gap
 * exceeds VOCAL_ATTACK_SEC + VOCAL_RELEASE_SEC (0.33 s), two merged spans'
 * ramps can never overlap, so `vocalPresenceAt` only ever needs to look at
 * the two spans bracketing t.
 */
export const VOCAL_MERGE_GAP_SEC = 0.4;

/** Open-ended LAST line nominal length, matching lyricProgressAt. */
const LAST_LINE_SEC = 4;

/**
 * Flatten a timed-lyrics document into sorted, non-overlapping sung spans.
 * Word timing is used where present (tighter than the line window); plain
 * lines contribute their whole window. Deterministic: same lines, same spans.
 */
export function vocalSpansFromLyrics(lines: readonly TimedLine[]): VocalSpan[] {
  const raw: VocalSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = line.end ?? (i + 1 < lines.length ? lines[i + 1].t : line.t + LAST_LINE_SEC);
    const words = line.words;
    if (words && words.length > 0) {
      for (let k = 0; k < words.length; k++) {
        const w = words[k];
        const wEnd = w.end ?? (k + 1 < words.length ? words[k + 1].t : Math.max(lineEnd, w.t));
        if (wEnd > w.t) raw.push({ start: w.t, end: wEnd });
      }
    } else if (lineEnd > line.t) {
      raw.push({ start: line.t, end: lineEnd });
    }
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  // Merge overlaps and sub-gap silences into phrases.
  const merged: VocalSpan[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < VOCAL_MERGE_GAP_SEC) {
      if (s.end > last.end) last.end = s.end;
    } else {
      merged.push({ start: s.start, end: s.end });
    }
  }
  return merged;
}

/** Trapezoid envelope of one span at t. */
function spanEnvelope(s: VocalSpan, t: number): number {
  if (t < s.start) {
    const lead = s.start - t;
    return lead < VOCAL_ATTACK_SEC ? 1 - lead / VOCAL_ATTACK_SEC : 0;
  }
  if (t <= s.end) return 1;
  const lag = t - s.end;
  return lag < VOCAL_RELEASE_SEC ? 1 - lag / VOCAL_RELEASE_SEC : 0;
}

/**
 * Vocal presence 0..1 at track time t. `spans` must come from
 * `vocalSpansFromLyrics` (sorted, non-overlapping, phrase-merged); lookup is
 * O(log n), so calling this every frame over a full lyric sheet is free.
 */
export function vocalPresenceAt(spans: readonly VocalSpan[], t: number): number {
  if (spans.length === 0) return 0;
  // Binary search: last span with start <= t.
  let lo = 0;
  let hi = spans.length - 1;
  if (t < spans[0].start) return spanEnvelope(spans[0], t);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (spans[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  // Merging guarantees the ramps of neighbouring spans never overlap, but a
  // max over both brackets is still the honest composition (and free).
  const cur = spanEnvelope(spans[lo], t);
  const next = lo + 1 < spans.length ? spanEnvelope(spans[lo + 1], t) : 0;
  return Math.max(cur, next);
}
