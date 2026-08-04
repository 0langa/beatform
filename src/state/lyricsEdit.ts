/**
 * Lyrics correction editor (FEAT-004 phase 4) — pure line/word operations.
 *
 * Sung-vocal ASR output is imperfect by nature; this module is what turns it
 * into something usable. Every operation is a pure function
 * `LyricLine[] -> LyricLine[]` (fresh arrays, no mutation) so the store slice
 * can snapshot for its local undo and the live overlay refreshes from plain
 * state changes — the render path stays a pure function of (lines, t).
 *
 * Representable-form discipline (the A2 round-trip contract): our LRC writer
 * emits word STARTS plus ONE trailing end tag, so a word's end is implicitly
 * the next word's start and only the LAST word of a line may carry an
 * explicit end. Every operation here normalizes its result to that form —
 * what the editor shows is exactly what survives export + re-import.
 *
 * Confidence (`conf` on lines/words) is session-only aligner metadata. The
 * rule for edits: changing a word's TEXT clears that word's conf and the
 * line's (the aligner's opinion no longer refers to this text — and a fixed
 * line is a reviewed line); moving TIME alone keeps conf (the text is still
 * the uncertain part).
 */

import type { LyricLine, LyricWord } from "./lyrics";

/** Below this line confidence the editor shows a hard red flag. Device-
 * calibrated in the phase-3 evidence: garbage lines land 0.002-0.13. */
export const CONF_FLAG = 0.2;
/** Below this it soft-warns amber: the 0.29-0.38 band measured on real
 * material is "partially correct — worth a look". */
export const CONF_WARN = 0.45;

/** Successive lines may not share a timestamp (mirror of the sidecar's
 * MONOTONIC_STEP and of what [mm:ss.xx] can express). */
const MIN_GAP = 0.01;
/** Open-ended last line: nominal window, mirrors lyricProgressAt. */
const LAST_LINE_SEC = 4;

// ---------------------------------------------------------------------------
// Shared helpers

function cloneWord(w: LyricWord): LyricWord {
  return { t: w.t, end: w.end, text: w.text, ...(w.conf !== undefined ? { conf: w.conf } : {}) };
}

function cloneLine(l: LyricLine): LyricLine {
  return {
    t: l.t,
    end: l.end,
    text: l.text,
    ...(l.words ? { words: l.words.map(cloneWord) } : {}),
    ...(l.conf !== undefined ? { conf: l.conf } : {}),
  };
}

/** Deep copy — the undo stack's snapshot and every op's working copy. */
export function cloneLines(lines: LyricLine[]): LyricLine[] {
  return lines.map(cloneLine);
}

/** The window a line occupies: explicit end (SRT), else the next line's
 * start, else a nominal tail. Identical shape to lyricProgressAt's maths so
 * editor proportions match what the karaoke wipe renders. */
export function lineWindow(lines: LyricLine[], i: number): { start: number; end: number } {
  const line = lines[i];
  const end = line.end ?? (i + 1 < lines.length ? lines[i + 1].t : line.t + LAST_LINE_SEC);
  return { start: line.t, end: Math.max(end, line.t + MIN_GAP) };
}

/** Normalize a word list to the representable A2 form: starts non-decreasing,
 * only the last word may keep an explicit end, and that end stays after its
 * own start. Returns undefined for an empty list. */
function normalizeWords(words: LyricWord[]): LyricWord[] | undefined {
  if (words.length === 0) return undefined;
  const out = words.map(cloneWord);
  for (let k = 0; k < out.length; k++) {
    if (out[k].t < 0) out[k].t = 0;
    if (k > 0 && out[k].t < out[k - 1].t) out[k].t = out[k - 1].t;
    if (k < out.length - 1) out[k].end = null;
  }
  const last = out[out.length - 1];
  if (last.end !== null && last.end <= last.t) last.end = last.t + 0.05;
  return out;
}

/** words -> the line text they spell (single spaces — the writer's guard
 * compares against split_whitespace, so this is the canonical join). */
function textOfWords(words: LyricWord[]): string {
  return words.map((w) => w.text).join(" ");
}

/** Mean word confidence, or undefined when any word lacks one. */
function meanConf(words: LyricWord[]): number | undefined {
  if (words.length === 0) return undefined;
  let sum = 0;
  for (const w of words) {
    if (w.conf === undefined) return undefined;
    sum += w.conf;
  }
  return sum / words.length;
}

const tokenize = (text: string): string[] => text.split(/\s+/).filter((t) => t.length > 0);

// ---------------------------------------------------------------------------
// Line operations

/**
 * Replace a line's text. On a word-timed line the words follow the text:
 * same token count -> timings are kept word-for-word (the common "fix one
 * word" case; edited words lose their conf); different count -> timings
 * redistribute evenly across the line window (predictable, and exactly what
 * the "spread evenly" button would do). Emptied text clears the words.
 */
export function setLineText(lines: LyricLine[], i: number, text: string): LyricLine[] {
  if (i < 0 || i >= lines.length) return lines;
  const out = cloneLines(lines);
  const line = out[i];
  const collapsed = text.replace(/\s+/g, " ").trim();
  const tokens = tokenize(collapsed);
  if (!line.words || line.words.length === 0) {
    if (collapsed === line.text) return lines;
    line.text = collapsed;
    delete line.conf; // reviewed — see the module note
    return out;
  }
  if (collapsed === textOfWords(line.words)) {
    line.text = collapsed;
    return lines[i].text === collapsed ? lines : out;
  }
  if (tokens.length === 0) {
    line.text = "";
    delete line.words;
    delete line.conf;
    return out;
  }
  if (tokens.length === line.words.length) {
    line.words = normalizeWords(
      line.words.map((w, k) =>
        w.text === tokens[k] ? w : { t: w.t, end: w.end, text: tokens[k] },
      ),
    );
  } else {
    line.words = spreadWords(out, i, tokens);
  }
  line.text = textOfWords(line.words ?? []);
  line.conf = meanConf(line.words ?? []);
  if (line.conf === undefined) delete line.conf;
  return out;
}

/** Evenly spaced words across the line's window; last word ends the window
 * explicitly (the trailing A2 tag). No conf — these timings are synthetic. */
function spreadWords(lines: LyricLine[], i: number, tokens: string[]): LyricWord[] | undefined {
  const { start, end } = lineWindow(lines, i);
  const span = end - start;
  const n = tokens.length;
  return normalizeWords(
    tokens.map((text, k) => ({
      t: start + (span * k) / n,
      end: k === n - 1 ? end : null,
      text,
    })),
  );
}

/** Clamp a new line start into the strictly-monotonic corridor between its
 * neighbours. Returns the clamped time (>= 0 always). */
export function clampLineTime(lines: LyricLine[], i: number, t: number): number {
  const lo = i > 0 ? lines[i - 1].t + MIN_GAP : 0;
  const hi = i + 1 < lines.length ? lines[i + 1].t - MIN_GAP : Infinity;
  if (hi < lo) return lines[i].t; // degenerate corridor: keep the current time
  return Math.min(hi, Math.max(lo, Math.max(0, t)));
}

/**
 * Move a line's start to `t` (clamped between neighbours). The line's words
 * and explicit end travel WITH it — a line nudge is "the singer starts
 * later/earlier", not "stretch the line".
 */
export function setLineTime(lines: LyricLine[], i: number, t: number): LyricLine[] {
  if (i < 0 || i >= lines.length) return lines;
  const clamped = clampLineTime(lines, i, t);
  const delta = clamped - lines[i].t;
  if (Math.abs(delta) < 1e-9) return lines;
  const out = cloneLines(lines);
  const line = out[i];
  line.t = clamped;
  if (line.end !== null) line.end = Math.max(clamped + MIN_GAP, line.end + delta);
  if (line.words) {
    line.words = normalizeWords(
      line.words.map((w) => ({
        ...w,
        t: Math.max(0, w.t + delta),
        end: w.end !== null ? w.end + delta : null,
      })),
    );
  }
  return out;
}

export function nudgeLine(lines: LyricLine[], i: number, deltaSec: number): LyricLine[] {
  if (i < 0 || i >= lines.length) return lines;
  return setLineTime(lines, i, lines[i].t + deltaSec);
}

/**
 * Split a line at character position `charPos` of its text (a caret). The
 * split lands on the nearest token boundary; both halves keep their word
 * timings when the line has them, and the second line starts at its first
 * word's time (else char-proportionally inside the window). Returns null
 * when there is nothing to split (caret at an edge, single token).
 */
export function splitLine(lines: LyricLine[], i: number, charPos: number): LyricLine[] | null {
  if (i < 0 || i >= lines.length) return null;
  const line = lines[i];
  const tokens = tokenize(line.text);
  if (tokens.length < 2) return null;
  // Token start offsets inside the display text.
  const starts: number[] = [];
  let cursor = 0;
  for (const tok of tokens) {
    const at = line.text.indexOf(tok, cursor);
    starts.push(at);
    cursor = at + tok.length;
  }
  // First token fully after the caret = start of the second half; snap to
  // the nearest boundary so a mid-word caret still does something sensible.
  let m = starts.findIndex((s) => s >= charPos);
  if (m < 0) m = tokens.length - 1;
  if (m === 0) m = 1; // never an empty first half
  const out = cloneLines(lines);
  const orig = out[i];
  const hasWords = !!orig.words && orig.words.length === tokens.length;
  const { start, end } = lineWindow(out, i);
  const splitT = hasWords
    ? orig.words![m].t
    : start + ((end - start) * starts[m]) / Math.max(1, line.text.length);
  const t2 = Math.min(Math.max(splitT, orig.t + MIN_GAP), end - MIN_GAP);

  const first: LyricLine = {
    t: orig.t,
    end: null,
    text: tokens.slice(0, m).join(" "),
  };
  const second: LyricLine = {
    t: t2,
    end: orig.end,
    text: tokens.slice(m).join(" "),
  };
  if (hasWords) {
    const w1 = normalizeWords(orig.words!.slice(0, m).map((w) => ({ ...w, end: null })));
    const w2 = normalizeWords(orig.words!.slice(m));
    if (w1) {
      first.words = w1;
      const c = meanConf(w1);
      if (c !== undefined) first.conf = c;
    }
    if (w2) {
      // The second half must not start before its own first word.
      second.t = Math.min(second.t, w2[0].t);
      second.t = Math.max(second.t, orig.t + MIN_GAP);
      second.words = w2;
      const c = meanConf(w2);
      if (c !== undefined) second.conf = c;
    }
  }
  out.splice(i, 1, first, second);
  return out;
}

/**
 * Merge line i with the next one: texts join, the first start wins, the
 * second's explicit end (if any) survives. Word timing survives only when
 * BOTH lines carry it — half-timed lines would render a wipe that lies.
 */
export function mergeWithNext(lines: LyricLine[], i: number): LyricLine[] | null {
  if (i < 0 || i + 1 >= lines.length) return null;
  const out = cloneLines(lines);
  const a = out[i];
  const b = out[i + 1];
  const merged: LyricLine = {
    t: a.t,
    end: b.end,
    text: [a.text, b.text].filter((t) => t.length > 0).join(" "),
  };
  if (a.words && a.words.length > 0 && b.words && b.words.length > 0) {
    const words = normalizeWords([...a.words.map((w) => ({ ...w, end: null })), ...b.words]);
    if (words) {
      merged.words = words;
      const c = meanConf(words);
      if (c !== undefined) merged.conf = c;
    }
  }
  out.splice(i, 2, merged);
  return out;
}

/**
 * Insert an empty line after index `i` (i = -1 inserts before the first
 * line). Placed midway to the next line (or a beat after/before the edge);
 * the editor focuses it for typing. Empty text stays out of exports — the
 * writer skips it exactly like the parser would.
 */
export function insertLineAfter(lines: LyricLine[], i: number): LyricLine[] {
  const out = cloneLines(lines);
  let t: number;
  if (i < 0) {
    t = Math.max(0, (lines[0]?.t ?? LAST_LINE_SEC) - LAST_LINE_SEC / 2);
  } else if (i + 1 < lines.length) {
    t = (lines[i].t + lines[i + 1].t) / 2;
  } else {
    t = lineWindow(lines, i).end;
  }
  out.splice(i + 1, 0, { t, end: null, text: "" });
  return out;
}

export function deleteLine(lines: LyricLine[], i: number): LyricLine[] {
  if (i < 0 || i >= lines.length) return lines;
  const out = cloneLines(lines);
  out.splice(i, 1);
  return out;
}

// ---------------------------------------------------------------------------
// Word operations

/**
 * Replace one word's text. Multiple words typed into one slot split it (the
 * new words share its span); an emptied slot deletes the word. The line text
 * re-derives from the words, and edited words lose their conf.
 */
export function setWordText(lines: LyricLine[], i: number, k: number, text: string): LyricLine[] {
  if (i < 0 || i >= lines.length) return lines;
  const line = lines[i];
  if (!line.words || k < 0 || k >= line.words.length) return lines;
  const tokens = tokenize(text);
  if (tokens.length === 1 && tokens[0] === line.words[k].text) return lines;
  const out = cloneLines(lines);
  const o = out[i];
  const words = o.words!;
  const w = words[k];
  if (tokens.length === 0) {
    words.splice(k, 1);
  } else if (tokens.length === 1) {
    words[k] = { t: w.t, end: w.end, text: tokens[0] };
  } else {
    // Split the slot's span evenly across the typed words.
    const spanEnd = w.end ?? (k + 1 < words.length ? words[k + 1].t : w.t + 0.3);
    const span = Math.max(0.05 * tokens.length, spanEnd - w.t);
    const parts: LyricWord[] = tokens.map((tok, j) => ({
      t: w.t + (span * j) / tokens.length,
      end: j === tokens.length - 1 ? w.end : null,
      text: tok,
    }));
    words.splice(k, 1, ...parts);
  }
  o.words = normalizeWords(words);
  o.text = o.words ? textOfWords(o.words) : "";
  if (!o.words) delete o.words;
  o.conf = meanConf(o.words ?? []);
  if (o.conf === undefined) delete o.conf;
  return out;
}

/** Clamp a word start between its neighbours' starts (word 0 down to 0). */
export function clampWordTime(line: LyricLine, k: number, t: number): number {
  const words = line.words ?? [];
  const lo = k > 0 ? words[k - 1].t + MIN_GAP : 0;
  const hi = k + 1 < words.length ? words[k + 1].t - MIN_GAP : Infinity;
  if (hi < lo) return words[k]?.t ?? 0;
  return Math.min(hi, Math.max(lo, Math.max(0, t)));
}

/** Move one word's start (clamped); the last word's explicit end keeps its
 * duration so nudging the final word doesn't silently stretch the wipe. */
export function setWordTime(lines: LyricLine[], i: number, k: number, t: number): LyricLine[] {
  if (i < 0 || i >= lines.length) return lines;
  const line = lines[i];
  if (!line.words || k < 0 || k >= line.words.length) return lines;
  const clamped = clampWordTime(line, k, t);
  const delta = clamped - line.words[k].t;
  if (Math.abs(delta) < 1e-9) return lines;
  const out = cloneLines(lines);
  const w = out[i].words![k];
  w.t = clamped;
  if (w.end !== null) w.end = w.end + delta;
  out[i].words = normalizeWords(out[i].words!);
  return out;
}

export function nudgeWord(lines: LyricLine[], i: number, k: number, deltaSec: number): LyricLine[] {
  const w = lines[i]?.words?.[k];
  if (!w) return lines;
  return setWordTime(lines, i, k, w.t + deltaSec);
}

/** The "spread evenly" button: word starts evenly across the line window,
 * trailing end closes it. Synthetic timing — conf drops (see module note). */
export function redistributeWords(lines: LyricLine[], i: number): LyricLine[] {
  if (i < 0 || i >= lines.length) return lines;
  const line = lines[i];
  const tokens = tokenize(line.text);
  if (tokens.length === 0) return lines;
  const out = cloneLines(lines);
  out[i].words = spreadWords(out, i, tokens);
  delete out[i].conf;
  return out;
}

/** Apply re-aligned words (sidecar `--align-line` result, already offset to
 * track time by the caller). Text stays what the user wrote — the aligner
 * aligned exactly these tokens; a mismatch means the result is stale. */
export function applyRealignedWords(
  lines: LyricLine[],
  i: number,
  words: { t: number; end: number; conf: number; text: string }[],
): LyricLine[] | null {
  if (i < 0 || i >= lines.length || words.length === 0) return null;
  if (words.map((w) => w.text).join(" ") !== tokenize(lines[i].text).join(" ")) {
    return null;
  }
  const out = cloneLines(lines);
  const line = out[i];
  line.words = normalizeWords(
    words.map((w, k) => ({
      t: w.t,
      end: k === words.length - 1 ? w.end : null, // representable form
      text: w.text,
      conf: Math.max(0, Math.min(1, w.conf)),
    })),
  );
  line.text = textOfWords(line.words ?? []);
  const c = meanConf(line.words ?? []);
  if (c !== undefined) line.conf = c;
  else delete line.conf;
  return out;
}

/** Attach the generation result's confidence detail to freshly parsed lines
 * (index-matched; the sidecar writes lines in the same order it reports
 * them). Word confs apply only when the counts agree — a line the writer
 * degraded to plain text must not wear another line's numbers. */
export function applyLineDetails(
  lines: LyricLine[],
  details: { conf: number | null; words: number[] }[],
): LyricLine[] {
  if (details.length !== lines.length) return lines;
  return lines.map((line, i) => {
    const d = details[i];
    const next = cloneLine(line);
    if (d.conf !== null) next.conf = Math.max(0, Math.min(1, d.conf));
    if (next.words && d.words.length === next.words.length) {
      next.words = next.words.map((w, k) => ({
        ...w,
        conf: Math.max(0, Math.min(1, d.words[k])),
      }));
    }
    return next;
  });
}

// ---------------------------------------------------------------------------
// Flags + navigation

/** Editor severity for a line: "flag" (red), "warn" (amber), or null. A line
 * without conf has NO data — unreviewed is not the same as wrong. */
export function lineSeverity(line: LyricLine): "flag" | "warn" | null {
  if (line.conf === undefined) return null;
  if (line.conf < CONF_FLAG) return "flag";
  if (line.conf < CONF_WARN) return "warn";
  return null;
}

export function flaggedCount(lines: LyricLine[]): number {
  return lines.reduce((n, l) => n + (lineSeverity(l) !== null ? 1 : 0), 0);
}

/** Next flagged/warned line after `from`, wrapping; -1 when none. */
export function nextFlagged(lines: LyricLine[], from: number): number {
  if (lines.length === 0) return -1;
  for (let step = 1; step <= lines.length; step++) {
    const i = (from + step + lines.length) % lines.length;
    if (lineSeverity(lines[i]) !== null) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// LRC writer (mirror of the sidecar's lrc.rs — the round-trip fixture in the
// tests is shared verbatim with lyrics.test.ts and the Rust tests)

const EDITOR_TAG = "Beatform lyrics editor";

/** Centisecond two-digit-minute timestamp body, saturated at 99:59.99, with
 * rounding carry (59.996 -> 01:00.00) — exactly lrc.rs::timestamp_body. */
export function lrcTimestamp(t: number): string {
  const totalCs = Math.min(599_999, Math.round(Math.max(0, t) * 100));
  const cs = totalCs % 100;
  const secs = Math.floor(totalCs / 100) % 60;
  const mins = Math.floor(totalCs / 6000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(mins)}:${pad(secs)}.${pad(cs)}`;
}

/**
 * Serialize the (edited) lines as LRC — plain lines, A2 word tags where a
 * line carries word timing. The writer guard is the sidecar's: word tags are
 * only written when the words reproduce the line text token-for-token, else
 * the line degrades to plain rather than shipping tags that disagree with
 * their text. Empty lines are skipped (the parser would drop them anyway).
 * Explicit line ends (SRT imports) are NOT representable in LRC and drop.
 */
export function writeLrc(lines: LyricLine[]): string {
  let out = `[re:${EDITOR_TAG}]\n`;
  for (const line of lines) {
    if (line.text.trim().length === 0) continue;
    out += `[${lrcTimestamp(line.t)}]`;
    const words = line.words ?? [];
    const tokens = tokenize(line.text);
    const wordsMatch =
      words.length > 0 &&
      words.length === tokens.length &&
      words.every((w, k) => w.text === tokens[k]);
    if (wordsMatch) {
      words.forEach((w, k) => {
        if (k > 0) out += " ";
        out += `<${lrcTimestamp(w.t)}>${w.text}`;
      });
      const last = words[words.length - 1];
      if (last.end !== null) out += `<${lrcTimestamp(last.end)}>`;
    } else {
      out += line.text;
    }
    out += "\n";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Time entry

/** Parse a user-typed time: "mm:ss.xx", "m:ss", "12.4" (seconds), "75".
 * Returns null for anything unreadable — the field then keeps its value. */
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s.length === 0) return null;
  const m = /^(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)$/.exec(s);
  if (m) {
    const secs = Number(m[2]);
    if (secs >= 60) return null;
    return Number(m[1]) * 60 + secs;
  }
  const plain = Number(s);
  return Number.isFinite(plain) && plain >= 0 ? plain : null;
}
