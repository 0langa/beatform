import {
  BUILDER_FACTORY_STACKS,
  builderStackValues,
  defaultBuilderStack,
  packBuilderParams,
  rebuildBuilder2,
} from "./builder2";
import { demoFeatures } from "./thumbnails";
import { presets } from "./presets";
import { allParams, DEFAULT_MOTION, DEFAULT_POST, defaultParams } from "./types";
import type { MotionSettings, ParamValues, PostSettings, PresetDef } from "./types";
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
 * Post-chain probes (F4). Until these existed the matrix rendered every one
 * of its cases through `DEFAULT_POST` — all-neutral — and `runPost` skips the
 * whole bright/blur/blur chain behind `if (this.post.bloom > 0)`. Bloom,
 * vignette, grain, chromatic aberration and the ACES tonemap therefore had
 * ZERO pixel coverage in the gate that exists to catch pixel drift.
 *
 * One probe per effect plus an everything-on case, so a regression names the
 * effect that moved instead of pointing at a combined frame. Grain is in
 * despite being noise: it is seeded from `fract(u.time)` and the matrix walks
 * a fixed frame clock, so it is as deterministic as anything else here.
 */
const POST_PROBES: { id: string; post: PostSettings }[] = [
  { id: "bloom", post: { ...DEFAULT_POST, bloom: 1, bloomThreshold: 0.4 } },
  { id: "vignette", post: { ...DEFAULT_POST, vignette: 1 } },
  { id: "grain", post: { ...DEFAULT_POST, grain: 0.3 } },
  { id: "chromatic", post: { ...DEFAULT_POST, chromatic: 1 } },
  { id: "tonemap", post: { ...DEFAULT_POST, tonemap: true, exposure: 3 } },
  { id: "exposure-min", post: { ...DEFAULT_POST, exposure: 0.2 } },
  {
    id: "all",
    post: {
      bloom: 1,
      bloomThreshold: 0.4,
      exposure: 3,
      tonemap: true,
      vignette: 1,
      grain: 0.3,
      chromatic: 1,
    },
  },
];

/**
 * Motion-master probes (F4), same hole as the post chain: every case above
 * runs at `DEFAULT_MOTION`, so uniforms 28-31 were pinned at exactly one
 * value each. Ranges mirror the panel's own sliders (rotation/pulse 0..2,
 * detail and spectrum smoothing 0..1) — a probe outside what the user can
 * dial would pin a state the app cannot reach.
 */
const MOTION_PROBES: { id: string; motion: MotionSettings }[] = [
  { id: "still", motion: { ...DEFAULT_MOTION, rotation: 0, pulse: 0 } },
  { id: "double", motion: { ...DEFAULT_MOTION, rotation: 2, pulse: 2 } },
  { id: "detail-min", motion: { ...DEFAULT_MOTION, detail: 0 } },
  { id: "smooth-max", motion: { ...DEFAULT_MOTION, spectrumSmooth: 1 } },
  { id: "flat", motion: { rotation: 0, pulse: 0, detail: 0, spectrumSmooth: 1 } },
];

/**
 * The two modes the post/motion probes render through. Post is a full-screen
 * pass and is preset-independent, but motion is not: `spectrum-bars` is the
 * only built-in that reads all three of spin/pulse/detail, and `oscilloscope`
 * reads pulse and detail through entirely different arithmetic. Pinned BY ID,
 * with a throw when one is missing — a silent fallback to some other mode
 * would re-bless the probe under a name that no longer describes it.
 */
const PROBE_PRESET_IDS = ["spectrum-bars", "oscilloscope"] as const;

function probePreset(id: string): PresetDef {
  const found = presets.find((preset) => preset.id === id);
  if (!found) throw new Error(`GPU matrix probe preset missing: ${id}`);
  return found;
}

/**
 * Walk one case's frames and read the canvas back. The frame budget is the
 * same rule the original loop used: particle modes need the longer walk
 * because their state integrates, everything else has settled by 30.
 */
async function renderCase(
  renderer: WebGPURenderer,
  canvas: OffscreenCanvas,
  preset: PresetDef,
  params: ParamValues,
): Promise<Omit<GpuPixelCase, "id">> {
  const frames = preset.particles ? 120 : 30;
  for (let frame = 0; frame <= frames; frame++) {
    const t = frame / 60;
    renderer.render(demoFeatures(t), t, params);
  }
  await renderer.gpuDone();
  return readPixels(canvas);
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
        cases.push({ id: variant.id, ...(await renderCase(renderer, canvas, preset, params)) });
      }
    }

    // ---- Param extremes (F4). -------------------------------------------
    // Everything above renders at the DEFAULT value of every param — styles
    // nudge a handful, the two color variants move exactly saturation and
    // lightness. That pins the MIDDLE of param space and nothing else: a
    // clamp that stopped holding at an edge, a divide that only vanishes at
    // min, a count that only overflows at max — each of those renders
    // identically at the default and was therefore invisible to this gate.
    //
    // Enum, toggle, hue and angle specs are all included with no special
    // case, because there is no special case to make: every control type is
    // one f32 whose legal span IS min..max (see the ParamSpec doc comment),
    // so both edges are values the app can actually store.
    for (const preset of presets) {
      for (const edge of ["min", "max"] as const) {
        renderer.setPreset(preset);
        const params: ParamValues = {};
        for (const spec of allParams(preset)) params[spec.key] = spec[edge];
        cases.push({
          id: `${preset.id}/extreme/${edge}`,
          ...(await renderCase(renderer, canvas, preset, params)),
        });
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

    // ---- Post-chain and motion-master probes (F4). ----------------------
    // Both blocks restore the neutral state in a finally, for the same
    // reason the builder block does: the renderer is reused by every later
    // case, and a leaked bloom would silently re-tint the rest of the run.
    try {
      for (const id of PROBE_PRESET_IDS) {
        const preset = probePreset(id);
        renderer.setPreset(preset);
        const params = defaultParams(preset);
        for (const probe of POST_PROBES) {
          renderer.setPost(probe.post);
          cases.push({
            id: `${id}/post/${probe.id}`,
            ...(await renderCase(renderer, canvas, preset, params)),
          });
        }
      }
    } finally {
      renderer.setPost(DEFAULT_POST);
    }

    try {
      for (const id of PROBE_PRESET_IDS) {
        const preset = probePreset(id);
        renderer.setPreset(preset);
        const params = defaultParams(preset);
        for (const probe of MOTION_PROBES) {
          renderer.setMotion(probe.motion);
          cases.push({
            id: `${id}/motion/${probe.id}`,
            ...(await renderCase(renderer, canvas, preset, params)),
          });
        }
      }
    } finally {
      renderer.setMotion(DEFAULT_MOTION);
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
