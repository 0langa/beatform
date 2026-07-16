/**
 * Background-image bake: decode the asset and apply blur + dim ONCE on the
 * CPU, producing the bitmap the renderer samples every frame. One shared
 * function so the live view and the export bake identically (same rule as
 * the overlay rasterizer — canvas raster output is engine-deterministic).
 */
export async function bakeBackgroundBitmap(
  dataUrl: string,
  blurPx: number,
  dim: number,
): Promise<ImageBitmap> {
  const src = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const blur = Math.max(0, Math.min(60, blurPx));
  const dimA = Math.max(0, Math.min(0.9, dim));
  if (blur <= 0 && dimA <= 0) return src;
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  if (blur > 0) {
    ctx.filter = `blur(${blur}px)`;
    // Overscan by the blur radius so edges don't develop a transparent
    // fringe (blur samples past the image border otherwise).
    ctx.drawImage(src, -blur, -blur, src.width + 2 * blur, src.height + 2 * blur);
    ctx.filter = "none";
  } else {
    ctx.drawImage(src, 0, 0);
  }
  if (dimA > 0) {
    ctx.fillStyle = `rgba(0,0,0,${dimA})`;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  src.close();
  return c.transferToImageBitmap();
}
