import { activeLyricIndex, lyricAlphaAt, type LyricLine, type LyricStyle } from "../state/lyrics";
import { audiogramActive, formatClock, type AudiogramSettings } from "../state/audiogram";

/**
 * Dynamic overlay compositing — the ONE function that draws the per-frame
 * layers (timed lyrics + audiogram elements) on top of the static overlay.
 * Both the live loop and the export core call it, so a composed frame cannot
 * differ between preview and file except by the track time each feeds in.
 *
 * A frame KEY (pure function of t) drives change-detection: the compositor
 * only re-rasterizes when the key moves, so a still frame uploads no texture.
 * Lyric fades quantize to 1/64 alpha; the progress bar / playhead quantize to
 * whole output pixels; the clock quantizes to whole seconds.
 */

export interface OverlayDynamics {
  lyrics?: { lines: LyricLine[]; style: LyricStyle };
  audiogram?: { settings: AudiogramSettings; duration: number; waveform: Float32Array | null };
}

export interface OverlayFrameKey {
  /** Active lyric line index (-1 = none). */
  lyricIdx: number;
  /** Lyric alpha in 1/64 steps. */
  lyricAlphaQ: number;
  /** Progress position in whole output pixels (-1 = no audiogram). */
  progressPx: number;
  /** Whole-second clock value (-1 = no time readout). */
  clockSec: number;
}

/** True when nothing dynamic is active — the caller then uses the static
 * overlay directly (no per-frame compositing at all). */
export function hasDynamics(d: OverlayDynamics): boolean {
  const lyricsOn = !!d.lyrics && d.lyrics.style.enabled && d.lyrics.lines.length > 0;
  const agOn = !!d.audiogram && audiogramActive(d.audiogram.settings);
  return lyricsOn || agOn;
}

export function overlayFrameKeyAt(d: OverlayDynamics, t: number, w: number): OverlayFrameKey {
  let lyricIdx = -1;
  let lyricAlphaQ = 0;
  if (d.lyrics && d.lyrics.style.enabled) {
    const idx = activeLyricIndex(d.lyrics.lines, t);
    const aQ =
      idx < 0
        ? 0
        : Math.round(lyricAlphaAt(d.lyrics.lines, idx, t, d.lyrics.style.fadeSec) * 64) / 64;
    lyricIdx = aQ === 0 ? -1 : idx;
    lyricAlphaQ = aQ;
  }
  let progressPx = -1;
  let clockSec = -1;
  if (d.audiogram && audiogramActive(d.audiogram.settings)) {
    const { settings, duration } = d.audiogram;
    const frac = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
    if (settings.progressBar || settings.waveformStrip) progressPx = Math.round(frac * w);
    if (settings.timeReadout) clockSec = Math.floor(t);
  }
  return { lyricIdx, lyricAlphaQ, progressPx, clockSec };
}

export function sameOverlayFrame(a: OverlayFrameKey, b: OverlayFrameKey): boolean {
  return (
    a.lyricIdx === b.lyricIdx &&
    a.lyricAlphaQ === b.lyricAlphaQ &&
    a.progressPx === b.progressPx &&
    a.clockSec === b.clockSec
  );
}

function drawLyric(
  ctx: OffscreenCanvasRenderingContext2D,
  lines: LyricLine[],
  idx: number,
  alpha: number,
  style: LyricStyle,
  w: number,
  h: number,
): void {
  const text = lines[idx].text;
  const px = Math.round(0.045 * h * style.size);
  ctx.font = `600 ${px}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = alpha;

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
  const anchor =
    style.position === "top" ? h * 0.14 : style.position === "center" ? h * 0.5 : h * 0.88;
  const top =
    style.position === "top"
      ? anchor
      : style.position === "center"
        ? anchor - blockH / 2
        : anchor - blockH;

  for (let i = 0; i < rows.length; i++) {
    const y = top + lineH * (i + 0.8);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = Math.max(2, px * 0.16);
    ctx.strokeText(rows[i], w / 2, y);
    ctx.fillStyle = style.color;
    ctx.fillText(rows[i], w / 2, y);
  }
  ctx.globalAlpha = 1;
}

function drawAudiogram(
  ctx: OffscreenCanvasRenderingContext2D,
  ag: NonNullable<OverlayDynamics["audiogram"]>,
  t: number,
  w: number,
  h: number,
): void {
  const { settings, duration, waveform } = ag;
  const frac = duration > 0 ? Math.min(1, Math.max(0, t / duration)) : 0;
  const pad = Math.round(w * 0.04);
  const innerW = w - pad * 2;
  const top = settings.position === "top";
  // Stack elements outward from the edge: strip, then bar, then clock.
  let edgeY = top ? Math.round(h * 0.05) : Math.round(h * 0.95);
  const dir = top ? 1 : -1;

  if (settings.waveformStrip && waveform && waveform.length > 0) {
    const stripH = Math.round(h * 0.09);
    const y0 = top ? edgeY : edgeY - stripH;
    const mid = y0 + stripH / 2;
    const bars = Math.min(innerW, 200);
    const bw = innerW / bars;
    for (let i = 0; i < bars; i++) {
      const wi = Math.floor((i / bars) * waveform.length);
      const amp = Math.min(1, waveform[wi] ?? 0) * (stripH / 2) * 0.95;
      const played = i / bars <= frac;
      ctx.fillStyle = played ? settings.color : "rgba(255,255,255,0.35)";
      ctx.fillRect(pad + i * bw, mid - amp, Math.max(1, bw - 1), amp * 2);
    }
    edgeY += dir * (stripH + Math.round(h * 0.02));
  }

  if (settings.progressBar) {
    const barH = Math.max(3, Math.round(h * 0.008));
    const y0 = top ? edgeY : edgeY - barH;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(pad, y0, innerW, barH);
    ctx.fillStyle = settings.color;
    ctx.fillRect(pad, y0, Math.round(innerW * frac), barH);
    edgeY += dir * (barH + Math.round(h * 0.02));
  }

  if (settings.timeReadout) {
    const px = Math.round(h * 0.03);
    ctx.font = `600 ${px}px system-ui, "Segoe UI", sans-serif`;
    ctx.textBaseline = top ? "top" : "alphabetic";
    const y = top ? edgeY : edgeY;
    const label = `${formatClock(t)} / ${formatClock(duration)}`;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = Math.max(2, px * 0.16);
    ctx.textAlign = "left";
    ctx.strokeText(label, pad, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, pad, y);
  }
}

/**
 * Draw the static overlay plus the active dynamic layers into a fresh bitmap.
 * Never closes `base` — the caller retains it for the next frame. The caller
 * owns the returned bitmap (renderers close the previous one on replace).
 */
export async function composeOverlayFrame(
  base: ImageBitmap | null,
  d: OverlayDynamics,
  t: number,
  w: number,
  h: number,
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  if (base) ctx.drawImage(base, 0, 0, w, h);
  if (d.audiogram && audiogramActive(d.audiogram.settings)) {
    drawAudiogram(ctx, d.audiogram, t, w, h);
  }
  if (d.lyrics && d.lyrics.style.enabled) {
    const idx = activeLyricIndex(d.lyrics.lines, t);
    if (idx >= 0) {
      const alpha = lyricAlphaAt(d.lyrics.lines, idx, t, d.lyrics.style.fadeSec);
      if (alpha > 0) drawLyric(ctx, d.lyrics.lines, idx, alpha, d.lyrics.style, w, h);
    }
  }
  return canvas.transferToImageBitmap();
}
