import type { AudioFeatures } from "../audio/types";
import type { BgSettings, ParamValues, PresetDef, Renderer } from "./types";

/**
 * Canvas2D fallback renderer — used when WebGPU is unavailable (old WebView2
 * runtime, GPU blocklist). Approximates the spectrum-bars preset; parameter
 * keys match so the UI works identically.
 */
export class Canvas2DRenderer implements Renderer {
  readonly kind = "canvas2d" as const;

  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private bg: BgSettings = { mode: 0, color: [0, 0, 0] };
  private overlay: ImageBitmap | null = null;
  private smooth = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d context");
    this.ctx = ctx;
  }

  setPreset(_preset: PresetDef): void {
    // Single built-in look; params are read live in render().
  }

  setBackground(bg: BgSettings): void {
    this.bg = bg;
  }

  setOverlay(source: ImageBitmap | null): void {
    this.overlay = source;
  }

  setSmoothSpectrum(v: boolean): void {
    this.smooth = v;
  }

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(f: AudioFeatures, _time: number, params: ParamValues): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const hue = params.hue ?? 210;
    const hueSpread = params.hueSpread ?? 80;
    const gap = params.barGap ?? 0.22;

    if (this.bg.mode === 2) {
      ctx.clearRect(0, 0, W, H);
    } else if (this.bg.mode === 1) {
      const [br, bgc, bb] = this.bg.color;
      ctx.fillStyle = `rgb(${br * 255} ${bgc * 255} ${bb * 255})`;
      ctx.fillRect(0, 0, W, H);
    } else {
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
    // nothing to release
  }
}
