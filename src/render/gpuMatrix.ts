import {
  BUILDER_FACTORY_STACKS,
  builderStackValues,
  currentBuilderStack,
  defaultBuilderStack,
  packBuilderParams,
  rebuildBuilder2,
} from "./builder2";
import { demoFeatures } from "./thumbnails";
import { presets } from "./presets";
import { builder } from "./presets/builder";
import {
  allParams,
  BG_IMAGE,
  BG_SOLID,
  BG_TRANSPARENT,
  DEFAULT_MOTION,
  DEFAULT_POST,
  defaultParams,
} from "./types";
import type { BgSettings, MotionSettings, ParamValues, PostSettings, PresetDef } from "./types";
import { TRANSITION_KINDS } from "../state/timeline";
import { presetUsesFeedback, WebGPURenderer } from "./webgpuRenderer";

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
 * Presets whose WGSL actually samples feedback history — the renderer's own
 * scan, so this can never disagree with what the render path does. Each gets
 * one export-shaped case below (R2-16): every other case renders these
 * live-shaped (one advance-and-present call per frame), while exportCore
 * drives a two-call sequence that had zero pixel coverage.
 */
export function feedbackCasePresets(): PresetDef[] {
  return presets.filter(presetUsesFeedback);
}

/**
 * The transition family's fixed mode pair (R2-16): cheap, structurally
 * different, and NEITHER declares feedback — the cases must isolate the
 * seven WGSL blend kinds, not entangle them with the feedback fade paths.
 */
const TRANSITION_CASE_INCOMING = "spectrum-bars";
const TRANSITION_CASE_OUTGOING = "radial-burst";

/** The single mode the background and deep-capture probes render through. */
const BG_DEEP_PROBE_PRESET = "spectrum-bars";

/**
 * Deterministic background probes (R2-16): every other case renders bg mode
 * 0 (preset). Solid and transparent drive their own shader/composite
 * branches; image is synthesized in-harness (a fixed gradient — no repo
 * asset). Video is deliberately skipped: its decode loop needs a fixture
 * asset and is not deterministic without one.
 */
const BG_PROBES: { id: string; bg: BgSettings }[] = [
  { id: "solid", bg: { mode: BG_SOLID, color: [0.12, 0.05, 0.3] } },
  { id: "transparent", bg: { mode: BG_TRANSPARENT, color: [0, 0, 0] } },
  {
    id: "image",
    bg: { mode: BG_IMAGE, color: [0, 0, 0], image: { assetId: "synthetic", dim: 0.3, blur: 0 } },
  },
];

/**
 * Case metrics for a deep-captured rgba64 frame (u16 per channel) — the
 * deep-capture case's replacement for readPixels, since deep capture routes
 * the final post pass into the offscreen f16 target INSTEAD of the
 * swapchain. Pure and exported: it is the part of the deep case Node can
 * test. The hash covers the exact little-endian bytes the ProRes/AV1
 * sidecar lane would receive; the 16x9 signature is nearest-neighbour
 * arithmetic (no canvas smoothing), defined by this function alone.
 */
export function deepCaseMetrics(
  data: Uint16Array,
  width: number,
  height: number,
): Omit<GpuPixelCase, "id"> {
  const bytes = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  let lumaSum = 0;
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) {
    // u16 -> the same 0..255 scale the canvas metrics use (65535/255 = 257).
    const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 257;
    lumaSum += luma;
    if (luma > 3) lit++;
  }
  const pixels = width * height;
  const rgb = new Uint8Array(16 * 9 * 3);
  let dst = 0;
  for (let sy = 0; sy < 9; sy++) {
    for (let sx = 0; sx < 16; sx++) {
      const px = Math.min(width - 1, Math.floor(((sx + 0.5) * width) / 16));
      const py = Math.min(height - 1, Math.floor(((sy + 0.5) * height) / 9));
      const base = (py * width + px) * 4;
      rgb[dst++] = data[base] >> 8;
      rgb[dst++] = data[base + 1] >> 8;
      rgb[dst++] = data[base + 2] >> 8;
    }
  }
  return {
    hash: fnv1a(bytes),
    signature: base64(rgb),
    meanLuma: lumaSum / pixels,
    litFraction: lit / pixels,
  };
}

/**
 * The complete case-id list, in run order — the single enumeration the
 * device run must produce (runGpuPixelMatrix self-checks against it) and
 * the one Node can test for count and dedup (R2-16). Append-only at the
 * tail: inserting mid-sequence reorders the shared renderer's state history
 * and moves existing hashes.
 */
export function expectedMatrixCaseIds(): string[] {
  const ids: string[] = [];
  for (const preset of presets) {
    ids.push(`${preset.id}/@defaults`);
    for (const style of preset.styles ?? []) ids.push(`${preset.id}/style/${style.id}`);
    const hasFullColorControls =
      preset.params.some((param) => param.key === "saturation") &&
      preset.params.some((param) => param.key === "lightness");
    if (hasFullColorControls) {
      ids.push(`${preset.id}/color/grayscale`, `${preset.id}/color/bright-grayscale`);
    }
  }
  for (const preset of presets) {
    ids.push(`${preset.id}/extreme/min`, `${preset.id}/extreme/max`);
  }
  for (const factory of BUILDER_FACTORY_STACKS) ids.push(`builder2/stack/${factory.id}`);
  for (const id of PROBE_PRESET_IDS) {
    for (const probe of POST_PROBES) ids.push(`${id}/post/${probe.id}`);
  }
  for (const id of PROBE_PRESET_IDS) {
    for (const probe of MOTION_PROBES) ids.push(`${id}/motion/${probe.id}`);
  }
  ids.push(`${builder.id}/@defaults`);
  for (const preset of feedbackCasePresets()) ids.push(`${preset.id}/feedback/export-walk`);
  for (const kind of TRANSITION_KINDS) ids.push(`transition/${kind}/mid`);
  for (const probe of BG_PROBES) ids.push(`bg/${probe.id}`);
  ids.push(`deep/${BG_DEEP_PROBE_PRESET}`);
  return ids;
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
 * The renderer surface the Builder leg drives. A `Pick` of the real class
 * rather than a hand-written interface, so it cannot drift from it — and
 * narrow enough that the borrow-and-hand-back contract below is provable in
 * Vitest, where there is no GPU.
 */
type BuilderStackTarget = Pick<
  WebGPURenderer,
  "setPreset" | "setBuilderParams" | "render" | "gpuDone"
>;

/**
 * Builder factory stacks (RP-20): one case per stack. The presets[] loop
 * renders builder2 through the BOOT def the registry captured (default
 * stack), so structural stacks must mint their own def via rebuildBuilder2
 * and hand it to setPreset directly.
 *
 * That call writes a MODULE GLOBAL the live app reads every frame
 * (services.ts packs against `currentBuilderStack()`), so this leg is
 * BORROWING app state and has to hand back what it took (G6). It used to hand
 * back a freshly minted `defaultBuilderStack()`, whose values match only when
 * the user was already on the default stack — run the harness with an edited
 * Builder and the render layer was left describing a stack the document no
 * longer had. The pre-run stack is read back from builder2 itself, never from
 * the store: src/render must not depend on the store, and builder2's own
 * global IS the render layer's mirror of `s.builderStack`.
 *
 * The renderer's builder buffer, by contrast, goes back to the DEFAULT pack —
 * that is what seeded it before the first case ran, so every later case in
 * the run still sees exactly the state it always did and no hash moves.
 */
export async function runBuilderStackCases(
  renderer: BuilderStackTarget,
  readCase: () => Promise<Omit<GpuPixelCase, "id">>,
): Promise<GpuPixelCase[]> {
  const startStack = currentBuilderStack();
  const cases: GpuPixelCase[] = [];
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
      cases.push({ id: `builder2/stack/${factory.id}`, ...(await readCase()) });
    }
  } finally {
    rebuildBuilder2(startStack);
    renderer.setBuilderParams(packBuilderParams(defaultBuilderStack()));
  }
  return cases;
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

    cases.push(...(await runBuilderStackCases(renderer, () => readPixels(canvas))));

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

    // ---- Hidden classic `builder` (R2-15). ------------------------------
    // Off the strip since the layer compositor replaced it, but resolved
    // forever for every old project/scene that references it — the exact
    // surface that drifts silently, because no interactive path exercises
    // it anymore. One defaults case gives it a device pixel baseline, with
    // the same compile gate the strip presets get. APPENDED at the end of
    // the run on purpose: inserting mid-sequence would reorder the shared
    // renderer's state history for every later case, and an additive change
    // must not move existing hashes.
    {
      const errors = await renderer.compilePresetCheck(builder);
      if (errors.length) compileErrors[builder.id] = errors;
      renderer.setPreset(builder);
      cases.push({
        id: `${builder.id}/@defaults`,
        ...(await renderCase(renderer, canvas, builder, defaultParams(builder))),
      });
    }

    // ---- R2-16 blind spots. Every block below is APPENDED after the
    // pre-existing sequence for the same reason the builder case above is:
    // the shared renderer's state history for existing cases must not move.

    // Feedback, export-shaped. Every case above renders feedback presets
    // live-shaped — one advance-and-present render() per frame — while
    // exportCore drives a two-call sequence per frame (a 60 Hz advance-only
    // state walk drained through t, then a present on the tick grid, which
    // at a 60 fps output cadence is present-history every frame). That
    // second path had zero pixel coverage. Fixed times, default params.
    for (const preset of feedbackCasePresets()) {
      renderer.setPreset(preset);
      const params = defaultParams(preset);
      for (let frame = 0; frame <= 30; frame++) {
        const t = frame / 60;
        renderer.render(demoFeatures(t), t, params, undefined, { feedback: "advance-only" });
        renderer.render(demoFeatures(t), t, params, undefined, { feedback: "present-history" });
      }
      await renderer.gpuDone();
      cases.push({ id: `${preset.id}/feedback/export-walk`, ...(await readPixels(canvas)) });
    }

    // Transitions. frameResolve hands out prev/mix/kind, but the seven WGSL
    // blend kinds themselves had no pixel baseline — no existing case ever
    // rendered mid-fade. One case per kind, frozen mid-blend (mix 0.5) on
    // the fixed cheap pair, so a regression names the blend that moved.
    try {
      const incoming = probePreset(TRANSITION_CASE_INCOMING);
      const outgoing = probePreset(TRANSITION_CASE_OUTGOING);
      renderer.setPreset(incoming);
      renderer.setTransitionPreset(outgoing);
      const params = defaultParams(incoming);
      const prevParams = defaultParams(outgoing);
      for (let kind = 0; kind < TRANSITION_KINDS.length; kind++) {
        for (let frame = 0; frame <= 30; frame++) {
          const t = frame / 60;
          renderer.render(demoFeatures(t), t, params, { params: prevParams, mix: 0.5, kind });
        }
        await renderer.gpuDone();
        cases.push({
          id: `transition/${TRANSITION_KINDS[kind]}/mid`,
          ...(await readPixels(canvas)),
        });
      }
    } finally {
      renderer.setTransitionPreset(null);
    }

    // Backgrounds. Everything above renders bg mode 0 (preset). The solid,
    // transparent and image branches — including the premultiplied-alpha
    // contract the transparent path leans on — were invisible to the gate.
    // The image is synthesized (fixed gradient), so no asset rides the repo;
    // video is skipped: its decode loop is not deterministic without one.
    try {
      const preset = probePreset(BG_DEEP_PROBE_PRESET);
      renderer.setPreset(preset);
      const params = defaultParams(preset);
      for (const probe of BG_PROBES) {
        if (probe.bg.mode === BG_IMAGE) {
          const src = new OffscreenCanvas(64, 64);
          const ctx = src.getContext("2d");
          if (!ctx) throw new Error("bg/image: no 2d context for the synthetic image");
          const grad = ctx.createLinearGradient(0, 0, 64, 64);
          grad.addColorStop(0, "#20458c");
          grad.addColorStop(1, "#8c2045");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 64, 64);
          renderer.setBackgroundImage(await createImageBitmap(src));
        }
        renderer.setBackground(probe.bg);
        cases.push({
          id: `bg/${probe.id}`,
          ...(await renderCase(renderer, canvas, preset, params)),
        });
      }
    } finally {
      renderer.setBackgroundImage(null);
      renderer.setBackground({ mode: 0, color: [0, 0, 0] });
    }

    // Deep capture (FEAT-005). The f16 lane bypasses the swapchain — the
    // whole point — so no canvas-reading case can ever see it; its case
    // metrics come from readbackDeepFrame() via deepCaseMetrics (pure,
    // Node-tested). Pinned last: while the flag is on the canvas holds a
    // stale frame, and the finally puts the renderer back on the swapchain.
    try {
      const preset = probePreset(BG_DEEP_PROBE_PRESET);
      renderer.setPreset(preset);
      const params = defaultParams(preset);
      renderer.setDeepCapture(true);
      for (let frame = 0; frame <= 30; frame++) {
        const t = frame / 60;
        renderer.render(demoFeatures(t), t, params);
      }
      await renderer.gpuDone();
      cases.push({
        id: `deep/${BG_DEEP_PROBE_PRESET}`,
        ...deepCaseMetrics(await renderer.readbackDeepFrame(), width, height),
      });
    } finally {
      renderer.setDeepCapture(false);
    }
  } finally {
    renderer.dispose();
  }

  // R2-16: the produced list must equal the pure enumeration the Node tests
  // pin (count + dedup live there, in gpuMatrix.test.ts). Without this lock
  // those tests would only ever describe a mirror of the runner, free to
  // drift from what the device actually rendered.
  const producedIds = cases.map((entry) => entry.id);
  const expectedIds = expectedMatrixCaseIds();
  if (
    producedIds.length !== expectedIds.length ||
    producedIds.some((id, i) => id !== expectedIds[i])
  ) {
    throw new Error(
      `matrix enumeration drifted from expectedMatrixCaseIds(): ` +
        `produced ${producedIds.length} case(s), expected ${expectedIds.length}`,
    );
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
