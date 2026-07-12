import type { AudioFeatures } from "../audio/types";
import type { ParamValues, PresetDef, Renderer } from "./types";

/**
 * Canvas2D fallback renderer — used when WebGPU is unavailable (old WebView2
 * runtime, GPU blocklist). Approximates the spectrum-bars preset; parameter
 * keys match so the UI works identically.
 */
export class Canvas2DRenderer implements Renderer {
  readonly kind = "canvas2d" as const;

  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d context");
    this.ctx = ctx;
  }

  setPreset(_preset: PresetDef): void {
    // Single built-in look; params are read live in render().
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

    ctx.fillStyle = `hsl(${hue + 40} 50% ${4 + f.beatIntensity * 6}%)`;
    ctx.fillRect(0, 0, W, H);

    const n = f.bins.length;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = f.bins[i];
      const h = v * H * 0.92;
      const barHue = hue + (i / n) * hueSpread;
      ctx.fillStyle = `hsl(${barHue} 85% ${45 + f.beatIntensity * 8}%)`;
      ctx.fillRect(i * bw + (bw * gap) / 2, H - h, bw * (1 - gap), h);
      // peak cap
      const pk = f.peaks[i] * H * 0.92;
      ctx.fillStyle = `hsl(${barHue} 30% 90%)`;
      ctx.fillRect(i * bw + (bw * gap) / 2, H - pk - 2, bw * (1 - gap), 2);
    }
  }

  dispose(): void {
    // nothing to release
  }
}
