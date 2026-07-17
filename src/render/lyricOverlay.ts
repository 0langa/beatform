import { activeLyricIndex, lyricAlphaAt, type LyricLine, type LyricStyle } from "../state/lyrics";

/**
 * Lyric compositing — the ONE function that turns (static overlay, lyric
 * line, alpha) into the bitmap the renderer shows. The live loop and the
 * export core both call it, so a lyric frame cannot differ between preview
 * and file except by the t each side feeds in.
 *
 * Fades quantize to 1/64 alpha steps: re-rasterizing only when the step
 * changes bounds texture uploads during a fade while staying a pure function
 * of track time.
 */

export interface LyricFrameKey {
  idx: number;
  alphaQ: number;
}

/** The (line, alpha-step) pair to display at t — pure; compare with
 * sameLyricFrame() to decide whether a recompose is needed. */
export function lyricFrameKeyAt(lines: LyricLine[], t: number, fadeSec: number): LyricFrameKey {
  const idx = activeLyricIndex(lines, t);
  const alphaQ = idx < 0 ? 0 : Math.round(lyricAlphaAt(lines, idx, t, fadeSec) * 64) / 64;
  return { idx: alphaQ === 0 ? -1 : idx, alphaQ };
}

export function sameLyricFrame(a: LyricFrameKey, b: LyricFrameKey): boolean {
  return a.idx === b.idx && a.alphaQ === b.alphaQ;
}

/**
 * Draw the static overlay plus (optionally) one lyric line into a fresh
 * bitmap. Never closes `base` — the caller keeps it for the next line. The
 * caller owns the returned bitmap (renderers close the previous one on
 * replace, which is why base can never be handed over directly).
 */
export async function composeLyricOverlay(
  base: ImageBitmap | null,
  lines: LyricLine[],
  key: LyricFrameKey,
  style: LyricStyle,
  w: number,
  h: number,
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  if (base) ctx.drawImage(base, 0, 0, w, h);
  if (key.idx >= 0 && key.alphaQ > 0) {
    const text = lines[key.idx].text;
    const px = Math.round(0.045 * h * style.size);
    ctx.font = `600 ${px}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = key.alphaQ;

    // Word-wrap to at most two rows inside 90% of the width.
    const maxW = w * 0.9;
    const words = text.split(/\s+/);
    const rows: string[] = [];
    let cur = "";
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width > maxW && cur) {
        rows.push(cur);
        cur = word;
        if (rows.length === 2) break;
      } else {
        cur = next;
      }
    }
    if (rows.length < 2 && cur) rows.push(cur);
    else if (rows.length === 2 && cur) rows[1] = `${rows[1]}…`;

    const lineH = px * 1.25;
    const blockH = rows.length * lineH;
    const baselineOf = (rowIdx: number): number => {
      const anchor =
        style.position === "top" ? h * 0.14 : style.position === "center" ? h * 0.5 : h * 0.88;
      // Anchor is the block's vertical center for "center", else its bottom
      // (top anchor = block top).
      const top =
        style.position === "top"
          ? anchor
          : style.position === "center"
            ? anchor - blockH / 2
            : anchor - blockH;
      return top + lineH * (rowIdx + 0.8);
    };

    for (let i = 0; i < rows.length; i++) {
      const y = baselineOf(i);
      // Outline + soft shadow keep the text readable over any visual.
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = Math.max(2, px * 0.16);
      ctx.strokeText(rows[i], w / 2, y);
      ctx.fillStyle = style.color;
      ctx.fillText(rows[i], w / 2, y);
    }
  }
  return canvas.transferToImageBitmap();
}
