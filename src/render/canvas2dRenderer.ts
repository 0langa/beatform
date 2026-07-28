import type { AudioFeatures } from "../audio/types";
import { BG_IMAGE, BG_SOLID, BG_TRANSPARENT, BG_VIDEO } from "./types";
import type {
  BgFit,
  BgSettings,
  ParamValues,
  PresetDef,
  Renderer,
  RenderOptions,
  TransitionState,
} from "./types";

/**
 * Canvas2D fallback renderer — used when WebGPU is unavailable (old WebView2
 * runtime, GPU blocklist).
 *
 * It draws exactly ONE look, an approximation of spectrum-bars, and reads
 * exactly four parameter keys (hue, hueSpread, barGap, peaks). Everything else
 * the UI can express — the other modes, Motion masters, Builder Studio, custom
 * WGSL, scene transitions, post-processing, cover art — has no equivalent here
 * and the setters below are honest no-ops.
 *
 * That used to be a silent lie: the panels went on offering all of it (audit
 * F1). The fix is NOT in this file — a 2D canvas cannot grow a bloom pass — it
 * is that `simplifiedRenderer` in the store now disables those controls and an
 * app-level banner says why. What this file owes in return is that the things
 * it CAN honour, it honours exactly like the shader does: hence the background
 * fit/zoom/offset arithmetic below, which mirrors fitUV() in webgpuRenderer.ts
 * rather than the hardcoded cover crop it replaced (audit F9).
 */
export class Canvas2DRenderer implements Renderer {
  readonly kind = "canvas2d" as const;

  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private bg: BgSettings = { mode: 0, color: [0, 0, 0] };
  private overlay: ImageBitmap | null = null;
  private bgImage: ImageBitmap | null = null;
  private smooth = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d context");
    this.ctx = ctx;
  }

  setPreset(_preset: PresetDef): void {
    // Single built-in look; params are read live in render(). The mode chips
    // stay clickable (switching is how you leave a broken-looking mode), but
    // the banner tells the user every one of them draws these same bars.
  }

  setBackground(bg: BgSettings): void {
    this.bg = bg;
  }

  setOverlay(source: ImageBitmap | null): void {
    // Ownership transfer (same contract as the WebGPU renderer): release the
    // bitmap being replaced, or every debounced overlay refresh leaks one.
    if (this.overlay && this.overlay !== source) this.overlay.close();
    this.overlay = source;
  }

  setSmoothSpectrum(v: boolean): void {
    this.smooth = v;
  }

  setMotion(): void {
    // Fallback renderer approximates spectrum-bars only; motion masters no-op.
    // The Motion sliders are disabled while it is active (F1) — they used to
    // move, print a percentage, and change nothing on screen.
  }

  setBackgroundImage(source: ImageBitmap | null): void {
    if (this.bgImage && this.bgImage !== source) this.bgImage.close();
    this.bgImage = source;
  }

  updateBackgroundVideoFrame(source: ImageBitmap): void {
    // No video background here: the store's loop only uploads frames to the
    // WebGPU renderer, and the Video option is disabled while this renderer is
    // active. Frames are owned by that loop — nothing to keep or close.
    void source;
  }

  setCoverArt(source: ImageBitmap | null): void {
    // Fallback renderer has no preset that samples cover art — but the host
    // hands over ownership, so the bitmap still must be released.
    source?.close();
  }

  setBuilderParams(_data: Float32Array): void {
    // Builder Studio renders through WGSL codegen — WebGPU only. The layer
    // editor is disabled while this renderer is active (F1).
  }

  setTransitionPreset(_preset: PresetDef | null): void {
    // Fallback renderer hard-cuts between scenes; the timeline's Transition
    // select is disabled while it is active (F1) so the choice isn't a lie.
  }

  setPost(): void {
    // Fallback renderer has no post-processing chain — the Post section is
    // disabled while it is active (F1).
  }

  /** The document's background colour as a CSS string (0..1 rgb -> 0..255). */
  private cssBgColor(): string {
    const [r, g, b] = this.bg.color;
    return `rgb(${r * 255} ${g * 255} ${b * 255})`;
  }

  /**
   * Draw a background bitmap under the same framing rules as the shader
   * (audit F9: this renderer hardcoded a cover crop and ignored the v2.48
   * fit/zoom/offset controls entirely, so three sliders and a segmented
   * control moved nothing at all).
   *
   * fitUV() in webgpuRenderer.ts maps a frame uv to a texture uv:
   *
   *   tex = (uv - 0.5 - offset) * S / zoom + 0.5
   *
   * where S is the per-axis aspect correction for the chosen fit. drawImage
   * needs the inverse — where the whole texture lands in the frame — which is
   * that expression solved for uv at tex = 0 and tex = 1:
   *
   *   size = zoom / S   (in frame units)   origin = 0.5 + offset - size / 2
   *
   * With no fit fields (the neutral default a pre-v2.48 project saves) this
   * reduces to the centred cover crop it replaces, pixel for pixel.
   */
  private drawFittedBg(img: ImageBitmap, W: number, H: number, fit: BgFit | undefined): void {
    const zoom = Math.max(0.01, fit?.zoom ?? 1);
    const mode = fit?.fit ?? 0;
    const boxAspect = W / Math.max(H, 1);
    const texAspect = img.width / Math.max(img.height, 1);
    const ratio = texAspect / Math.max(boxAspect, 1e-4);
    let sx = 1;
    let sy = 1;
    if (mode < 0.5) {
      // Cover: shrink the axis that would otherwise letterbox, so it crops.
      if (ratio > 1) sx = boxAspect / Math.max(texAspect, 1e-4);
      else sy = ratio;
    } else if (mode < 1.5) {
      // Contain: the opposite axis, so the whole image fits inside the frame.
      if (ratio > 1) sy = ratio;
      else sx = 1 / ratio;
    }
    // mode >= 1.5 is stretch: S stays (1, 1) and the image fills the frame.
    const dw = (W * zoom) / sx;
    const dh = (H * zoom) / sy;
    this.ctx.drawImage(
      img,
      W * (0.5 + (fit?.offsetX ?? 0)) - dw / 2,
      H * (0.5 + (fit?.offsetY ?? 0)) - dh / 2,
      dw,
      dh,
    );
  }

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(
    f: AudioFeatures,
    _time: number,
    params: ParamValues,
    _transition?: TransitionState,
    options?: RenderOptions,
  ): void {
    // Fixed feedback ticks are GPU texture-state work. Canvas2D has no
    // feedback state, so an advance-only call must not become an extra visible
    // draw when preview FPS is capped.
    if (options?.feedback === "advance-only") return;
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const hue = params.hue ?? 210;
    const hueSpread = params.hueSpread ?? 80;
    const gap = params.barGap ?? 0.22;

    if (this.bg.mode === BG_TRANSPARENT) {
      // NOTE: this is a real difference from the shader, which derives alpha
      // from the visual's own luma. Here the bars stay fully opaque and only
      // the space around them is see-through — close enough for a preview,
      // and exports (the only place alpha is delivered) need WebGPU anyway.
      ctx.clearRect(0, 0, W, H);
    } else if (this.bg.mode === BG_IMAGE && this.bgImage) {
      // Letterbox bars take the background COLOUR, exactly like the shader's
      // `select(u.bgColor.rgb, src, inBox(buv))` — black here would have been
      // a second, invisible divergence the moment "Fit" was chosen.
      ctx.fillStyle = this.cssBgColor();
      ctx.fillRect(0, 0, W, H);
      this.drawFittedBg(this.bgImage, W, H, this.bg.image);
    } else if (
      this.bg.mode === BG_SOLID ||
      this.bg.mode === BG_IMAGE ||
      this.bg.mode === BG_VIDEO
    ) {
      // Solid; an image mode whose bitmap has not landed yet; and video —
      // which matched NO branch at all and fell through to the animated hue
      // wash below (F9), a background nobody chose. There are no video frames
      // to draw here (see updateBackgroundVideoFrame), so the flat background
      // colour is the honest stand-in, and it is also what a fitted image's
      // letterbox bars would be.
      ctx.fillStyle = this.cssBgColor();
      ctx.fillRect(0, 0, W, H);
    } else {
      // BG_PRESET: the one animated background this renderer authors itself.
      ctx.fillStyle = `hsl(${hue + 40} 50% ${4 + f.beatIntensity * 6}%)`;
      ctx.fillRect(0, 0, W, H);
    }

    const n = f.bins.length;
    const bw = W / n;
    if (this.smooth) {
      // Smooth silhouette: one filled path through the bin tops
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * bw;
        const y = H - f.bins[i] * H * 0.92;
        if (i === 0) ctx.lineTo(x, y);
        else {
          const px = (i - 0.5) * bw;
          const py = H - f.bins[i - 1] * H * 0.92;
          ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        }
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, `hsl(${hue} 85% ${45 + f.beatIntensity * 8}%)`);
      grad.addColorStop(1, `hsl(${hue + hueSpread} 85% ${45 + f.beatIntensity * 8}%)`);
      ctx.fillStyle = grad;
      ctx.fill();
      if (this.overlay) ctx.drawImage(this.overlay, 0, 0, W, H);
      return;
    }
    for (let i = 0; i < n; i++) {
      const v = f.bins[i];
      const h = v * H * 0.92;
      const barHue = hue + (i / n) * hueSpread;
      ctx.fillStyle = `hsl(${barHue} 85% ${45 + f.beatIntensity * 8}%)`;
      ctx.fillRect(i * bw + (bw * gap) / 2, H - h, bw * (1 - gap), h);
      if ((params.peaks ?? 1) > 0.5) {
        const pk = f.peaks[i] * H * 0.92;
        ctx.fillStyle = `hsl(${barHue} 30% 90%)`;
        ctx.fillRect(i * bw + (bw * gap) / 2, H - pk - 2, bw * (1 - gap), 2);
      }
    }

    if (this.overlay) ctx.drawImage(this.overlay, 0, 0, W, H);
  }

  dispose(): void {
    this.overlay?.close();
    this.overlay = null;
    this.bgImage?.close();
    this.bgImage = null;
  }
}
