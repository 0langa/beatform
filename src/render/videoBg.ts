import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

/**
 * Video backgrounds — decode a local video file into a capped, downscaled loop
 * of frames, then select the frame for any track time PURELY from t. That is
 * what keeps the background deterministic and WYSIWYG: the live loop and the
 * export both compute frame index = floor(t * fps) % frameCount over the same
 * decoded frames, so the file matches the preview.
 *
 * Decode is via mediabunny (already a dependency): Input + CanvasSink at a
 * modest resolution (a background is blurred/dimmed behind the visualizer, so
 * full res is wasted). Frames are ImageBitmaps — transferable, so the store
 * decodes ONCE and hands the same array to the export worker.
 */

export interface VideoBgFrames {
  frames: ImageBitmap[];
  /** Playback rate the frames loop at (source fps, clamped). */
  fps: number;
}

/** Cap the decode so a long/high-res clip can't exhaust memory. A background
 * loop of a few seconds is the intent; longer videos are truncated to a loop. */
export const VIDEO_BG_MAX_FRAMES = 240;
export const VIDEO_BG_MAX_DIM = 640;
const VIDEO_BG_MAX_SECONDS = 12;

/** The frame index for track time t — pure, shared by live and export. */
export function videoBgFrameIndex(count: number, fps: number, t: number): number {
  if (count <= 0) return 0;
  const i = Math.floor(Math.max(0, t) * fps);
  return ((i % count) + count) % count;
}

/**
 * Decode a video Blob into a background loop. Downscales to fit VIDEO_BG_MAX_DIM
 * (cover math happens in the shader, so aspect is preserved here), bakes `dim`
 * (0..0.9 black overlay for visualizer readability, mirroring image bg) into
 * each frame, and stops at VIDEO_BG_MAX_FRAMES / VIDEO_BG_MAX_SECONDS. Throws
 * if the file has no decodable video track. Deterministic: the same bytes +
 * dim + blur always produce the same frames, so a worker re-decode matches the
 * live decode. Blur is baked ONCE per decoded frame here (not per render frame)
 * — same rule as the image background, so it's cheap and export-identical.
 */
export async function decodeVideoBgFrames(blob: Blob, dim = 0, blur = 0): Promise<VideoBgFrames> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = (await input.getVideoTracks())[0];
  if (!track) throw new Error("No video track in that file");

  const w = track.displayWidth || track.codedWidth || VIDEO_BG_MAX_DIM;
  const h = track.displayHeight || track.codedHeight || VIDEO_BG_MAX_DIM;
  const scale = Math.min(1, VIDEO_BG_MAX_DIM / Math.max(w, h));
  const outW = Math.max(2, Math.round(w * scale) & ~1);
  const outH = Math.max(2, Math.round(h * scale) & ~1);
  const dimA = Math.min(0.9, Math.max(0, dim));
  // Scale the blur radius with the downscale so it looks the same regardless of
  // source resolution (the UI slider is in source pixels, like the image bg).
  const blurPx = Math.max(0, Math.min(60, blur)) * scale;

  const sink = new CanvasSink(track, { width: outW, height: outH, fit: "contain", poolSize: 2 });
  const bake = new OffscreenCanvas(outW, outH);
  const bctx = bake.getContext("2d")!;
  const frames: ImageBitmap[] = [];
  let firstTs: number | null = null;
  let lastTs = 0;
  try {
    for await (const wrapped of sink.canvases(0, VIDEO_BG_MAX_SECONDS)) {
      if (firstTs === null) firstTs = wrapped.timestamp;
      lastTs = wrapped.timestamp;
      // The pooled canvas is reused on the next iteration — copy (with blur +
      // dim baked) to an owned ImageBitmap before advancing.
      if (blurPx > 0) {
        bctx.filter = `blur(${blurPx}px)`;
        // Overscan by the blur radius so edges don't fringe (blur samples past
        // the frame border otherwise) — same trick as the image background.
        bctx.drawImage(wrapped.canvas, -blurPx, -blurPx, outW + 2 * blurPx, outH + 2 * blurPx);
        bctx.filter = "none";
      } else {
        bctx.drawImage(wrapped.canvas, 0, 0, outW, outH);
      }
      if (dimA > 0) {
        bctx.fillStyle = `rgba(0,0,0,${dimA})`;
        bctx.fillRect(0, 0, outW, outH);
      }
      frames.push(await createImageBitmap(bake));
      if (frames.length >= VIDEO_BG_MAX_FRAMES) break;
    }
  } finally {
    await input.dispose?.();
  }
  if (frames.length === 0) throw new Error("Could not decode any frames from that video");

  // fps from the actual decoded span (robust to variable frame rate) — never
  // 0, and capped so a bad timestamp can't spin the index.
  const span = lastTs - (firstTs ?? 0);
  const fps = span > 0 ? Math.min(60, Math.max(1, (frames.length - 1) / span)) : 30;
  return { frames, fps };
}

/** Release the frames' GPU/CPU backing. Call when the video bg changes. */
export function disposeVideoBgFrames(v: VideoBgFrames | null): void {
  if (v) for (const f of v.frames) f.close();
}
