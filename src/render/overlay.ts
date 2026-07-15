/**
 * Overlay layers: text (title/artist/custom) and images (logo, album art)
 * composited over every visual. Layers are resolution-independent — sizes,
 * offsets and radii are fractions of canvas height/width — so the same
 * document rasterizes correctly at preview size and at 4K export size.
 *
 * Rasterization happens on the host (main thread for live, once per config/
 * resize change — NOT per frame; and at export start for the export path),
 * producing a premultiplied ImageBitmap that Renderer.setOverlay displays.
 * Same engine rasterizes both paths → live and export pixels match.
 */

/** 9-point anchor grid. */
export type OverlayAnchor = "tl" | "tc" | "tr" | "cl" | "cc" | "cr" | "bl" | "bc" | "br";

export interface TextLayer {
  id: string;
  type: "text";
  /** Literal text; {title} and {artist} expand from track metadata. */
  text: string;
  /** CSS font family (system font name). */
  font: string;
  weight: number;
  /** Font size as a fraction of canvas height (0.05 = 5%). */
  size: number;
  color: [number, number, number];
  opacity: number;
  /** Extra letter spacing in em. */
  letterSpacing: number;
  anchor: OverlayAnchor;
  /** Offset from the anchor, as fractions of canvas width/height. */
  offset: [number, number];
  /** 0..1 glow strength (shadow blur). */
  glow: number;
  uppercase: boolean;
}

export interface ImageLayer {
  id: string;
  type: "image";
  /** Key into the document's asset map. */
  assetId: string;
  /** Target height as a fraction of canvas height. */
  size: number;
  opacity: number;
  anchor: OverlayAnchor;
  offset: [number, number];
  /** Corner radius as a fraction of the drawn height (0.5 = circle-ish). */
  rounded: number;
}

export type OverlayLayer = TextLayer | ImageLayer;

/** Embedded binary asset (logo, album art) as a data URL — portable projects. */
export interface OverlayAsset {
  id: string;
  name: string;
  dataUrl: string;
}

export interface OverlayMeta {
  title: string;
  artist: string;
}

export function newLayerId(): string {
  return `ly-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultTextLayer(text = "{title}"): TextLayer {
  return {
    id: newLayerId(),
    type: "text",
    text,
    font: "Arial",
    weight: 700,
    size: 0.06,
    color: [1, 1, 1],
    opacity: 1,
    letterSpacing: 0.06,
    anchor: "bc",
    offset: [0, -0.06],
    glow: 0.35,
    uppercase: true,
  };
}

export function defaultImageLayer(assetId: string): ImageLayer {
  return {
    id: newLayerId(),
    type: "image",
    assetId,
    size: 0.22,
    opacity: 1,
    anchor: "tr",
    offset: [-0.03, 0.05],
    rounded: 0.08,
  };
}

// Decoded-bitmap cache so re-rasterizing on resize doesn't re-decode assets.
// Keyed by asset id AND the dataUrl that was decoded: a loaded project can
// reuse an id with different image bytes (save-as + edit, templates), and an
// id-only cache would keep serving the stale bitmap — in exports too.
const bitmapCache = new Map<string, { url: string; bmp: Promise<ImageBitmap> }>();

function assetBitmap(asset: OverlayAsset): Promise<ImageBitmap> {
  let hit = bitmapCache.get(asset.id);
  if (!hit || hit.url !== asset.dataUrl) {
    const bmp = fetch(asset.dataUrl)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b));
    const entry = { url: asset.dataUrl, bmp };
    // A failed decode must not poison the id for the whole session — evict so
    // the next rasterize retries instead of silently never drawing the layer.
    bmp.catch(() => {
      if (bitmapCache.get(asset.id) === entry) bitmapCache.delete(asset.id);
    });
    bitmapCache.set(asset.id, entry);
    hit = entry;
  }
  return hit.bmp;
}

/** Drop cached decodes for assets that no longer exist. */
export function pruneBitmapCache(liveAssetIds: Set<string>): void {
  for (const id of bitmapCache.keys()) {
    if (!liveAssetIds.has(id)) bitmapCache.delete(id);
  }
}

function anchorPoint(anchor: OverlayAnchor, w: number, h: number): [number, number] {
  const x = anchor[1] === "l" ? 0 : anchor[1] === "r" ? w : w / 2;
  const y = anchor[0] === "t" ? 0 : anchor[0] === "b" ? h : h / 2;
  return [x, y];
}

function expandTemplate(text: string, meta: OverlayMeta): string {
  return text.split("{title}").join(meta.title).split("{artist}").join(meta.artist);
}

function cssColor([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/**
 * Rasterize the overlay stack at the given output size.
 * Returns null when nothing would be drawn (renderers then unbind).
 */
export async function rasterizeOverlay(
  layers: OverlayLayer[],
  assets: Record<string, OverlayAsset>,
  width: number,
  height: number,
  meta: OverlayMeta,
): Promise<ImageBitmap | null> {
  const visible = layers.filter((l) => l.opacity > 0);
  if (visible.length === 0 || width < 2 || height < 2) return null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;

  for (const layer of visible) {
    const [ax, ay] = anchorPoint(layer.anchor, width, height);
    const ox = ax + layer.offset[0] * width;
    const oy = ay + layer.offset[1] * height;

    if (layer.type === "text") {
      const raw = expandTemplate(layer.text, meta);
      const text = layer.uppercase ? raw.toUpperCase() : raw;
      if (!text.trim()) continue;
      const px = Math.max(4, layer.size * height);
      ctx.save();
      ctx.font = `${layer.weight} ${px}px ${layer.font}`;
      ctx.letterSpacing = `${layer.letterSpacing * px}px`;
      ctx.textAlign =
        layer.anchor[1] === "l" ? "left" : layer.anchor[1] === "r" ? "right" : "center";
      ctx.textBaseline =
        layer.anchor[0] === "t" ? "top" : layer.anchor[0] === "b" ? "bottom" : "middle";
      if (layer.glow > 0) {
        ctx.shadowColor = cssColor(layer.color, Math.min(1, layer.opacity * 0.9));
        ctx.shadowBlur = layer.glow * px * 0.9;
      }
      ctx.fillStyle = cssColor(layer.color, layer.opacity);
      ctx.fillText(text, ox, oy);
      ctx.restore();
    } else {
      const asset = assets[layer.assetId];
      if (!asset) continue;
      let bmp: ImageBitmap;
      try {
        bmp = await assetBitmap(asset);
      } catch {
        continue; // corrupt asset — skip, never kill the whole overlay
      }
      const drawH = layer.size * height;
      const drawW = (bmp.width / bmp.height) * drawH;
      // Anchor the image box: anchor point maps to the matching box corner
      const bx =
        layer.anchor[1] === "l" ? ox : layer.anchor[1] === "r" ? ox - drawW : ox - drawW / 2;
      const by =
        layer.anchor[0] === "t" ? oy : layer.anchor[0] === "b" ? oy - drawH : oy - drawH / 2;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.rounded > 0) {
        const r = layer.rounded * drawH;
        ctx.beginPath();
        ctx.roundRect(bx, by, drawW, drawH, r);
        ctx.clip();
      }
      ctx.drawImage(bmp, bx, by, drawW, drawH);
      ctx.restore();
    }
  }

  return canvas.transferToImageBitmap();
}
