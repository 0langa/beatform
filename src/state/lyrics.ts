/**
 * Timed-lyrics model: parse .lrc / .srt into a flat, sorted line list and
 * resolve the active line for any track time.
 *
 * Everything here is pure and deterministic — the active line is a function
 * of (lines, t) only, which is what lets the live view and the export worker
 * agree frame-for-frame without sharing any state beyond the parsed lines.
 */

export interface LyricLine {
  /** Line start, seconds of track time. */
  t: number;
  /** Explicit end (SRT) or null (LRC — the next line's start ends this one). */
  end: number | null;
  text: string;
}

/** One display style knob-set for the overlay compositor. */
export interface LyricStyle {
  /** 0 = off. */
  enabled: boolean;
  /** Vertical anchor: bottom third (default), center, or top third. */
  position: "bottom" | "center" | "top";
  /** Relative size, 0.5..2 (1 = 4.5% of frame height). */
  size: number;
  /** CSS color for the text. */
  color: string;
  /** Fade in/out at line boundaries, seconds (0 = hard cuts). */
  fadeSec: number;
}

export const DEFAULT_LYRIC_STYLE: LyricStyle = {
  enabled: true,
  position: "bottom",
  size: 1,
  color: "#ffffff",
  fadeSec: 0.15,
};

const LRC_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LRC_META = /^\[(ar|ti|al|by|re|ve|length|au):/i;
const LRC_OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]/i;

/** Parse LRC: `[mm:ss.xx]text`, multiple timestamps per line share the text,
 * a global `[offset:±ms]` shifts everything. Metadata tags are ignored. */
export function parseLrc(contents: string): LyricLine[] {
  const out: LyricLine[] = [];
  let offsetSec = 0;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const off = LRC_OFFSET.exec(line);
    if (off) {
      offsetSec = Number(off[1]) / 1000;
      continue;
    }
    if (LRC_META.test(line)) continue;
    LRC_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = LRC_TAG.exec(line)) !== null) {
      // Timestamps must be a contiguous prefix — a "[00:12]" later in the
      // lyric text itself is text, not a tag.
      if (m.index !== lastEnd) break;
      lastEnd = LRC_TAG.lastIndex;
      const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac);
    }
    if (stamps.length === 0) continue;
    const text = line.slice(lastEnd).trim();
    if (!text) continue;
    for (const t of stamps) out.push({ t: Math.max(0, t + offsetSec), end: null, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

const SRT_TIME =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

/** Parse SRT blocks; multi-line cue text collapses to one line. Basic markup
 * tags (<i>, {\an8}, …) are stripped. */
export function parseSrt(contents: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const block of contents.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    const timeIdx = lines.findIndex((l) => SRT_TIME.test(l));
    if (timeIdx < 0) continue;
    const tm = SRT_TIME.exec(lines[timeIdx])!;
    const secs = (h: string, m: string, s: string, ms: string) =>
      Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / Math.pow(10, ms.length);
    const t = secs(tm[1], tm[2], tm[3], tm[4]);
    const end = secs(tm[5], tm[6], tm[7], tm[8]);
    const text = lines
      .slice(timeIdx + 1)
      .join(" ")
      .replace(/<[^>]+>|\{\\[^}]+\}/g, "")
      .trim();
    if (!text || end <= t) continue;
    out.push({ t, end, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

export class LyricParseError extends Error {}

/** Dispatch by extension; unknown extensions try LRC then SRT. Throws when
 * nothing timestamped comes out — a silent empty overlay helps no one. */
export function parseLyrics(fileName: string, contents: string): LyricLine[] {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const lines =
    ext === "srt"
      ? parseSrt(contents)
      : ext === "lrc"
        ? parseLrc(contents)
        : (() => {
            const lrc = parseLrc(contents);
            return lrc.length > 0 ? lrc : parseSrt(contents);
          })();
  if (lines.length === 0) {
    throw new LyricParseError(
      `No timestamped lines found in "${fileName}" — expected .lrc ([mm:ss.xx] …) or .srt`,
    );
  }
  return lines;
}

/**
 * The line active at track time t, or -1. Rightmost line with start <= t;
 * an explicit end (SRT) closes the line early, an implicit one (LRC) runs
 * until the next line starts. Binary search — called every frame.
 */
export function activeLyricIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return -1;
  if (lines[idx].end !== null && t >= lines[idx].end!) return -1;
  return idx;
}

/**
 * Alpha for the active line at t, honouring the style's fade window at both
 * boundaries. Pure — same value live and in the export.
 */
export function lyricAlphaAt(lines: LyricLine[], idx: number, t: number, fadeSec: number): number {
  if (idx < 0) return 0;
  if (fadeSec <= 0) return 1;
  const line = lines[idx];
  const start = line.t;
  // Line end: explicit, else the next line's start, else +infinity.
  const end = line.end ?? (idx + 1 < lines.length ? lines[idx + 1].t : Infinity);
  const inA = Math.min(1, (t - start) / fadeSec);
  const outA = end === Infinity ? 1 : Math.min(1, Math.max(0, (end - t) / fadeSec));
  return Math.max(0, Math.min(inA, outA));
}
