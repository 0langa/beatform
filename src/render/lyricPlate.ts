import { activeLyricIndex, lyricProgressAt, type LyricLine } from "../state/lyrics";
import { quantAlpha, quantProg } from "./dynamicOverlay";

/**
 * The LYRIC PLATE — the words as a texture, for the Lyric Stage mode.
 *
 * A fragment preset cannot rasterize glyphs, so the text reaches the shader
 * the way cover art does: rasterized host-side into a bitmap the renderer
 * uploads (`Renderer.setLyricPlate` -> WGSL `lyricSample()`), a PURE function
 * of (lines, t, w, h). Both the live loop and the export core call the same
 * two functions here — key first, compose when it moves — which is the exact
 * contract `dynamicOverlay.ts` established for the caption overlay, on the
 * same quantization grids (1/64 fade steps, 1/32 fill steps). No params reach
 * this module ON PURPOSE: a param in the raster would re-rasterize under
 * modulation every frame, and would split "the plate is a pure function of
 * the document and track time" into something the two loops could disagree on.
 * All look/reaction treatment happens in the shader, against the classes the
 * plate encodes.
 *
 * PLATE GEOMETRY. Three fixed bands in plate uv (y down), so the shader can
 * transform each line class independently (scale the support lines, punch the
 * main line) without knowing any glyph's box:
 *
 *   status block   x,y in [0, 4px]      global state (see below)
 *   prev band      y in [0.06, 0.24]    the line just sung, one row
 *   main band      y in [0.28, 0.72]    the current line, up to 3 rows
 *   next band      y in [0.76, 0.94]    the line coming up, one row
 *
 * These constants are mirrored as literals in the Lyric Stage WGSL;
 * lyricStage.test.ts asserts both sides so neither can drift alone.
 *
 * CHANNEL CLASSES (premultiplied upload; glyphs never overlap):
 *   R  every glyph's coverage — "there is text here"
 *   G  karaoke-LIT coverage: the sung part, filled per WORD from the word
 *      timings where the line has them (tighter than the caption's row sweep)
 *   B  the ACTIVE word's coverage — the emphasis mask. Support-band text
 *      leaves B at 0, so band position + B disambiguates every class.
 *   A  coverage (drives compositing; carries the line fade).
 *
 * THE STATUS BLOCK. The shader has no uniform for "how far into its fade is
 * the current line" — and must not grow one for a single mode. Instead the
 * top-left 4x4 px of the plate carry global state as color: R = main-line
 * fade alpha, G = prev presence, B = next presence. Sampled at the block's
 * centre (bilinear at an exact texel centre is exact); the bands start at 6%
 * so no glyph can ever reach the block. This is what lets the shader run a
 * parametric entrance (settle/rise scaled by the fade) without new ABI lanes.
 *
 * ENTRANCE. The main block additionally RISES into place at raster time —
 * y offset proportional to (1 - fade alpha), the caption overlay's own
 * "slide" behaviour — so even a zero-effect shader shows a live entrance.
 * Raster-side because it is a function of the fade (already in the key), and
 * fixed because the plate takes no params.
 */

/** Status block edge, device pixels. */
export const PLATE_STATUS_PX = 4;
/** The three text bands in plate uv (y down): [top, bottom]. */
export const PLATE_PREV_BAND: readonly [number, number] = [0.06, 0.24];
export const PLATE_MAIN_BAND: readonly [number, number] = [0.28, 0.72];
export const PLATE_NEXT_BAND: readonly [number, number] = [0.76, 0.94];

/** The main line's fade window, seconds. Fixed (the plate takes no params);
 * deliberately close to the caption's default so the two text layers breathe
 * together when both are on. */
export const PLATE_FADE_SEC = 0.25;
/** How long the previous line lingers (fading) after its end. */
export const PREV_HOLD_SEC = 4;
/** How early the next line appears before its start... */
export const NEXT_LEAD_SEC = 6;
/** ...ramping in over this many seconds at the window's edge. */
const NEXT_RAMP_SEC = 1.5;

/**
 * Everything the plate's pixels depend on, quantized. Compose only when this
 * moves — the exact `OverlayFrameKey` discipline, sized to the plate: the
 * fill step (1/32 of the line) covers per-word fill too, because word fills
 * are a function of the same t the line fill is.
 *
 * `w`/`h` are members so a canvas resize (live) or a different output size
 * (export) re-rasterizes without any caller-side special case.
 */
export interface LyricPlateKey {
  /** Active line index (-1 = none). */
  main: number;
  /** Main-line fade alpha in 1/64 steps (0 forces main = -1). */
  mainAlphaQ: number;
  /** Karaoke fill through the line in 1/32 steps (0 when no main). */
  fillQ: number;
  /** Previous-line index (-1 = none or out of its hold window). */
  prev: number;
  prevAlphaQ: number;
  /** Next-line index (-1 = none or out of its lead window). */
  next: number;
  nextAlphaQ: number;
  w: number;
  h: number;
}

/** Sentinel that matches no real key, so the first frame always composes. */
export const NULL_PLATE_KEY: LyricPlateKey = {
  main: -2,
  mainAlphaQ: -1,
  fillQ: -1,
  prev: -2,
  prevAlphaQ: -1,
  next: -2,
  nextAlphaQ: -1,
  w: 0,
  h: 0,
};

export function samePlateKey(a: LyricPlateKey, b: LyricPlateKey): boolean {
  return (
    a.main === b.main &&
    a.mainAlphaQ === b.mainAlphaQ &&
    a.fillQ === b.fillQ &&
    a.prev === b.prev &&
    a.prevAlphaQ === b.prevAlphaQ &&
    a.next === b.next &&
    a.nextAlphaQ === b.nextAlphaQ &&
    a.w === b.w &&
    a.h === b.h
  );
}

/** A line's end: explicit, else the next line's start, else open (Infinity).
 * Matches lyricAlphaAt's convention — NOT lyricProgressAt's 4 s nominal
 * window, which exists so a wipe can complete, not to cut the line off. */
function lineEnd(lines: readonly LyricLine[], idx: number): number {
  return lines[idx].end ?? (idx + 1 < lines.length ? lines[idx + 1].t : Infinity);
}

/** Rightmost line with start <= t, ignoring ends — the anchor both the prev
 * and next windows resolve from (activeLyricIndex applies the end rule, so
 * it answers "which line is ON", not "where in the sheet are we"). */
function lineAtOrBefore(lines: readonly LyricLine[], t: number): number {
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
  return idx;
}

/** The plate's own fade: same shape as lyricAlphaAt but with the plate's
 * fixed window (the caption's fade is a style knob; the plate takes none). */
function mainAlphaAt(lines: readonly LyricLine[], idx: number, t: number): number {
  const start = lines[idx].t;
  const end = lineEnd(lines, idx);
  const inA = Math.min(1, (t - start) / PLATE_FADE_SEC);
  const outA = end === Infinity ? 1 : Math.min(1, Math.max(0, (end - t) / PLATE_FADE_SEC));
  return Math.max(0, Math.min(inA, outA));
}

/** Previous-line presence: full while its successor plays, fading linearly
 * across the hold window measured from ITS end. Pure in t. */
function prevAlphaAt(lines: readonly LyricLine[], idx: number, t: number): number {
  const end = lineEnd(lines, idx);
  if (end === Infinity || t < end) return 1;
  return Math.max(0, 1 - (t - end) / PREV_HOLD_SEC);
}

/** Next-line presence: 0 outside the lead window, ramping to 1 at its edge. */
function nextAlphaAt(lines: readonly LyricLine[], idx: number, t: number): number {
  const lead = lines[idx].t - t;
  if (lead <= 0) return 0; // it is no longer "next"
  return Math.max(0, Math.min(1, (NEXT_LEAD_SEC - lead) / NEXT_RAMP_SEC));
}

export function lyricPlateKeyAt(
  lines: readonly LyricLine[],
  t: number,
  w: number,
  h: number,
): LyricPlateKey {
  const active = activeLyricIndex(lines as LyricLine[], t);
  const mainAlphaQ = active < 0 ? 0 : quantAlpha(mainAlphaAt(lines, active, t));
  const main = mainAlphaQ === 0 ? -1 : active;
  const fillQ = main < 0 ? 0 : quantProg(lyricProgressAt(lines as LyricLine[], main, t));

  // The support cast resolves from the sheet POSITION, not from `main`: in an
  // instrumental gap there is no active line, but the last line still fades
  // out above and the coming one still fades in below — the stage never cuts
  // to an empty frame mid-song.
  const at = lineAtOrBefore(lines, t);
  const prevIdx = main >= 0 ? main - 1 : at;
  let prev = -1;
  let prevAlphaQ = 0;
  if (prevIdx >= 0 && prevIdx !== main) {
    const a = quantAlpha(prevAlphaAt(lines, prevIdx, t));
    if (a > 0) {
      prev = prevIdx;
      prevAlphaQ = a;
    }
  }
  const nextIdx = (main >= 0 ? main : at) + 1;
  let next = -1;
  let nextAlphaQ = 0;
  if (nextIdx < lines.length) {
    const a = quantAlpha(nextAlphaAt(lines, nextIdx, t));
    if (a > 0) {
      next = nextIdx;
      nextAlphaQ = a;
    }
  }
  return { main, mainAlphaQ, fillQ, prev, prevAlphaQ, next, nextAlphaQ, w, h };
}

// ---------------------------------------------------------------------------
// Rasterization. Everything below draws ONLY from the quantized key's values
// plus the line texts — the dynamicOverlay rule: the bitmap must be a pure
// function of the key, or two frame rates step it differently.
// ---------------------------------------------------------------------------

/** One drawable unit of the main line: a timed word (or an untimed token). */
interface WordUnit {
  text: string;
  /** Sung fraction 0..1 of this unit at the keyed fill position. */
  fill: number;
  /** The word being sung right now — the shader's emphasis class (B). */
  active: boolean;
}

/**
 * Split the main line into fill-carrying units.
 *
 * With word timing, each timed word is one unit (a single A2 tag can span
 * several display tokens — "their own clock" is one WORD to the aligner) and
 * its fill comes straight from its own span. Without timing, the display
 * tokens share the line fill by character weight — the same distribution
 * lyricProgressAt uses, so the caption's wipe and the plate's lit mask move
 * through the words identically.
 */
function wordUnits(lines: readonly LyricLine[], idx: number, t: number, fillQ: number): WordUnit[] {
  const line = lines[idx];
  const words = line.words;
  if (words && words.length > 0) {
    const end = line.end ?? (idx + 1 < lines.length ? lines[idx + 1].t : line.t + 4);
    return words.map((w, k) => {
      const wStart = w.t;
      const wEnd = Math.max(
        wStart + 0.01,
        w.end ?? (k + 1 < words.length ? words[k + 1].t : Math.max(end, wStart)),
      );
      // Quantized on the 1/64 grid (quantAlpha IS that grid): a segment
      // export computes this from shifted floats, and the raw quotient can
      // differ from the preview's by an ULP — the grid absorbs it, so the
      // trace stays byte-identical across the shift (asserted in the test).
      const fill = quantAlpha(Math.max(0, Math.min(1, (t - wStart) / (wEnd - wStart))));
      return { text: w.text, fill, active: t >= wStart && t < wEnd };
    });
  }
  const tokens = line.text.split(/\s+/).filter((s) => s !== "");
  const totalChars = tokens.reduce((n, w) => n + w.length, 0) + (tokens.length - 1);
  let sungChars = fillQ * Math.max(totalChars, 1);
  return tokens.map((text, k) => {
    const chars = text.length + (k > 0 ? 1 : 0);
    const fill = quantAlpha(Math.max(0, Math.min(1, sungChars / chars)));
    sungChars -= chars;
    return { text, fill, active: fill > 0 && fill < 1 };
  });
}

/** Greedy wrap of units into at most `maxRows` rows under `maxW`. The same
 * measure-and-break walk the caption uses, over units instead of tokens. */
function wrapUnits(
  ctx: OffscreenCanvasRenderingContext2D,
  units: WordUnit[],
  maxW: number,
  maxRows: number,
): WordUnit[][] {
  const rows: WordUnit[][] = [];
  let row: WordUnit[] = [];
  let rowText = "";
  for (const unit of units) {
    const next = rowText ? `${rowText} ${unit.text}` : unit.text;
    if (ctx.measureText(next).width > maxW && row.length > 0) {
      rows.push(row);
      if (rows.length === maxRows) return rows;
      row = [unit];
      rowText = unit.text;
    } else {
      row.push(unit);
      rowText = next;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** Class colors — channels, not paint (the shader assigns every real color).
 * Lit adds G; the active word adds B; coverage itself is R + alpha. */
const INK_BASE = "#ff0000";
const INK_LIT = "#ffff00";
const INK_ACTIVE = "#ff00ff";
const INK_ACTIVE_LIT = "#ffffff";
const INK_SUPPORT = "#ff0000";

const FONT_STACK = `system-ui, "Segoe UI", sans-serif`;

/** Ellipsize a support line to fit, the caption's own trailing-… move. */
function fitText(ctx: OffscreenCanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function drawSupportLine(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  alpha: number,
  band: readonly [number, number],
  w: number,
  h: number,
): void {
  if (alpha <= 0 || !text) return;
  const px = Math.max(8, Math.round(0.045 * h));
  ctx.font = `600 ${px}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK_SUPPORT;
  ctx.fillText(fitText(ctx, text, w * 0.9), w / 2, ((band[0] + band[1]) / 2) * h);
  ctx.globalAlpha = 1;
}

function drawMainLine(
  ctx: OffscreenCanvasRenderingContext2D,
  units: WordUnit[],
  alpha: number,
  w: number,
  h: number,
): void {
  const px = Math.max(10, Math.round(0.075 * h));
  ctx.font = `700 ${px}px ${FONT_STACK}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const rows = wrapUnits(ctx, units, w * 0.86, 3);
  const rowH = px * 1.22;
  const bandMid = ((PLATE_MAIN_BAND[0] + PLATE_MAIN_BAND[1]) / 2) * h;
  // Entrance: the block RISES into place as the fade completes — the caption
  // overlay's "slide", baked here because it is a function of the keyed alpha.
  const rise = (1 - alpha) * rowH * 0.5;
  const top = bandMid - (rows.length * rowH) / 2 + rise;
  const space = ctx.measureText(" ").width;
  ctx.globalAlpha = alpha;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const widths = row.map((u) => ctx.measureText(u.text).width);
    const rowW = widths.reduce((a, b) => a + b, 0) + space * (row.length - 1);
    let x = (w - rowW) / 2;
    const y = top + rowH * (r + 0.8);
    for (let i = 0; i < row.length; i++) {
      const unit = row[i];
      ctx.fillStyle = unit.active ? INK_ACTIVE : INK_BASE;
      ctx.fillText(unit.text, x, y);
      if (unit.fill > 0) {
        // The lit overpaint: same glyphs, clipped to the sung fraction of
        // this unit's own advance — per-word karaoke, not a row sweep.
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 1, y - rowH, widths[i] * unit.fill + 1, rowH * 1.5);
        ctx.clip();
        ctx.fillStyle = unit.active ? INK_ACTIVE_LIT : INK_LIT;
        ctx.fillText(unit.text, x, y);
        ctx.restore();
      }
      x += widths[i] + space;
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Rasterize the plate for a keyed moment. The caller owns the bitmap
 * (renderers close what they are handed, the setOverlay contract). Async so
 * a missing OffscreenCanvas in a headless caller rejects instead of throwing
 * through the frame loop.
 */
export async function composeLyricPlate(
  lines: readonly LyricLine[],
  key: LyricPlateKey,
): Promise<ImageBitmap> {
  const { w, h } = key;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  // Status block first: global state as color at a spot no glyph can reach.
  // Painted even when everything below is absent — an all-zero block is
  // exactly the "nothing on stage" the shader should read.
  ctx.fillStyle = `rgb(${Math.round(key.mainAlphaQ * 255)}, ${Math.round(
    key.prevAlphaQ * 255,
  )}, ${Math.round(key.nextAlphaQ * 255)})`;
  ctx.fillRect(0, 0, PLATE_STATUS_PX, PLATE_STATUS_PX);
  if (key.prev >= 0) {
    drawSupportLine(ctx, lines[key.prev].text, key.prevAlphaQ, PLATE_PREV_BAND, w, h);
  }
  if (key.next >= 0) {
    drawSupportLine(ctx, lines[key.next].text, key.nextAlphaQ, PLATE_NEXT_BAND, w, h);
  }
  if (key.main >= 0) {
    // Per-word fills are functions of TIME, but the bitmap must be a pure
    // function of the KEY — so the raster evaluates them at the track time
    // the keyed fill position corresponds to (timeForFill, the grid-exact
    // inverse of lyricProgressAt), never at whatever raw t the caller held.
    const t = timeForFill(lines, key);
    drawMainLine(ctx, wordUnits(lines, key.main, t, key.fillQ), key.mainAlphaQ, w, h);
  }
  return canvas.transferToImageBitmap();
}

/**
 * The track time a keyed fill position corresponds to — the inverse of
 * lyricProgressAt on the quantized grid, so timed-word fills in the raster
 * derive from the KEY rather than from whatever raw t the caller had when
 * the key was computed. Piecewise-linear inverse over the same
 * character-weighted spans; exact at every 1/32 step by construction.
 */
export function timeForFill(lines: readonly LyricLine[], key: LyricPlateKey): number {
  const line = lines[key.main];
  const start = line.t;
  const end = line.end ?? (key.main + 1 < lines.length ? lines[key.main + 1].t : start + 4);
  const words = line.words;
  if (!words || words.length === 0) {
    return start + key.fillQ * Math.max(end - start, 0);
  }
  const totalChars = words.reduce((n, w) => n + w.text.length, 0) + (words.length - 1);
  let remaining = key.fillQ * Math.max(totalChars, 1);
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const wStart = w.t;
    const wEnd = Math.max(
      wStart + 0.01,
      w.end ?? (k + 1 < words.length ? words[k + 1].t : Math.max(end, wStart)),
    );
    const chars = w.text.length + (k > 0 ? 1 : 0);
    if (remaining >= chars) {
      remaining -= chars;
      continue;
    }
    return wStart + (remaining / chars) * (wEnd - wStart);
  }
  return end;
}
