import {
  BUILDER_FACTORY_STACKS,
  builderStackValues,
  defaultBuilderStack,
  packBuilderParams,
  rebuildBuilder2,
} from "./builder2";
import { demoFeatures } from "./thumbnails";
import { presets } from "./presets";
import { DEFAULT_MOTION, DEFAULT_POST, defaultParams } from "./types";
import { WebGPURenderer } from "./webgpuRenderer";

export interface GpuPixelCase {
  id: string;
  hash: string;
  /** 16x9 RGB thumbnail, base64 encoded (432 bytes before encoding). */
  signature: string;
  meanLuma: number;
  litFraction: number;
}

export interface GpuPixelMatrix {
  width: number;
  height: number;
  compileErrors: Record<string, string[]>;
  gpuErrors: number;
  cases: GpuPixelCase[];
}

function fnv1a(bytes: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function readPixels(source: OffscreenCanvas): Promise<Omit<GpuPixelCase, "id">> {
  const bitmap = await createImageBitmap(source);
  try {
    const full = new OffscreenCanvas(source.width, source.height);
    const ctx = full.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D pixel-read context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, full.width, full.height).data;
    let lumaSum = 0;
    let lit = 0;
    const pixels = full.width * full.height;
    for (let i = 0; i < rgba.length; i += 4) {
      const luma = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      lumaSum += luma;
      if (luma > 3) lit++;
    }

    // Compact perceptual baseline. Browser downsampling is part of runtime
    // under test; RGB (not luma-only) catches palette and brightness drift.
    const thumb = new OffscreenCanvas(16, 9);
    const thumbCtx = thumb.getContext("2d", { willReadFrequently: true });
    if (!thumbCtx) throw new Error("2D signature context unavailable");
    thumbCtx.drawImage(bitmap, 0, 0, 16, 9);
    const small = thumbCtx.getImageData(0, 0, 16, 9).data;
    const rgb = new Uint8Array(16 * 9 * 3);
    for (let src = 0, dst = 0; src < small.length; src += 4) {
      rgb[dst++] = small[src];
      rgb[dst++] = small[src + 1];
      rgb[dst++] = small[src + 2];
    }
    return {
      hash: fnv1a(rgba),
      signature: base64(rgb),
      meanLuma: lumaSum / pixels,
      litFraction: lit / pixels,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Real-WebGPU compile + pixel matrix. Called only by DEV E2E tooling inside
 * Tauri WebView2; Node/Vitest source snapshots remain a separate fast gate.
 */
export async function runGpuPixelMatrix(width = 192, height = 108): Promise<GpuPixelMatrix> {
  const canvas = new OffscreenCanvas(width, height);
  const startGpuErrors = (globalThis as unknown as { __gpuErrors?: number }).__gpuErrors ?? 0;
  const renderer = await WebGPURenderer.create(canvas);
  const compileErrors: Record<string, string[]> = {};
  const cases: GpuPixelCase[] = [];

  try {
    renderer.resize(width, height, 1);
    renderer.setBackground({ mode: 0, color: [0, 0, 0] });
    renderer.setPost(DEFAULT_POST);
    renderer.setMotion(DEFAULT_MOTION);
    renderer.setBuilderParams(packBuilderParams(defaultBuilderStack()));

    for (const preset of presets) {
      const errors = await renderer.compilePresetCheck(preset);
      if (errors.length) compileErrors[preset.id] = errors;
    }

    for (const preset of presets) {
      const hasFullColorControls =
        preset.params.some((param) => param.key === "saturation") &&
        preset.params.some((param) => param.key === "lightness");
      const variants = [
        { id: `${preset.id}/@defaults`, values: {} },
        ...(preset.styles ?? []).map((style) => ({
          id: `${preset.id}/style/${style.id}`,
          values: style.values,
        })),
        ...(hasFullColorControls
          ? [
              {
                id: `${preset.id}/color/grayscale`,
                values: { saturation: 0 },
              },
              {
                id: `${preset.id}/color/bright-grayscale`,
                values: { saturation: 0, lightness: 2 },
              },
            ]
          : []),
      ];
      for (const variant of variants) {
        renderer.setPreset(preset);
        const params = defaultParams(preset);
        for (const [key, value] of Object.entries(variant.values)) {
          if (typeof value === "number") params[key] = value;
        }
        const frames = preset.particles ? 120 : 30;
        for (let frame = 0; frame <= frames; frame++) {
          const t = frame / 60;
          renderer.render(demoFeatures(t), t, params);
        }
        await renderer.gpuDone();
        cases.push({ id: variant.id, ...(await readPixels(canvas)) });
      }
    }

    // Builder factory stacks (RP-20): one case per stack. The presets[] loop
    // above rendered builder2 through the BOOT def it captured (default
    // stack), so structural stacks must mint their def via rebuildBuilder2
    // and hand it to setPreset directly. The default stack/def is restored
    // afterwards so nothing later — in this run or a re-run in the same
    // process — sees a non-default Builder.
    try {
      for (const factory of BUILDER_FACTORY_STACKS) {
        const def = rebuildBuilder2(factory.stack);
        renderer.setPreset(def);
        renderer.setBuilderParams(packBuilderParams(factory.stack));
        const params = builderStackValues(factory.stack);
        for (let frame = 0; frame <= 30; frame++) {
          const t = frame / 60;
          renderer.render(demoFeatures(t), t, params);
        }
        await renderer.gpuDone();
        cases.push({ id: `builder2/stack/${factory.id}`, ...(await readPixels(canvas)) });
      }
    } finally {
      rebuildBuilder2(defaultBuilderStack());
      renderer.setBuilderParams(packBuilderParams(defaultBuilderStack()));
    }
  } finally {
    renderer.dispose();
  }

  const endGpuErrors = (globalThis as unknown as { __gpuErrors?: number }).__gpuErrors ?? 0;
  return {
    width,
    height,
    compileErrors,
    gpuErrors: endGpuErrors - startGpuErrors,
    cases,
  };
}
