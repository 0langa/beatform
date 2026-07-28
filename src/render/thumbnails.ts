import { WebGPURenderer } from "./webgpuRenderer";
import { presets } from "./presets";
import { defaultBuilderStack, packBuilderParams } from "./builder2";
import { defaultParams } from "./types";
import type { AudioFeatures } from "../audio/types";

/**
 * Preset thumbnails: render every mode once with canned "mid-song, energetic"
 * features on a small hidden WebGPU canvas and cache the PNGs for the strip.
 * Fully deterministic (fixed constants, fixed times) and generated lazily
 * after first paint so startup stays instant. Falls back to no thumbnails
 * when WebGPU is unavailable — the strip keeps its text chips.
 */

const W = 144;
const H = 81;

/** The snapshot moment: mid-song, with the beat pulse mid-decay. */
const SNAPSHOT_T = 11.53 + 14 / 30;
/** Frames warmed before the snapshot, so feedback trails have content. */
const WARM_FRAMES = 14;
/**
 * Compute-particle presets need a far longer run-up. Their sim is keyed to
 * track time and clamps to MAX_SIM_CATCHUP steps per frame, so jumping
 * straight to the snapshot time re-seeds the buffer and then advances it by
 * two steps per warm frame — under 30 steps in total. The thumbnail was
 * therefore a picture of the SPAWN DISTRIBUTION (a flat speckled ellipse),
 * not of the flow field the mode is about. Walking up to the same snapshot
 * time in small enough hops keeps every step inside the catch-up cap.
 */
const PARTICLE_WARM_FRAMES = 120;

/**
 * Param overrides applied ONLY to the thumbnail render.
 *
 * A 144x81 chip is a different medium from a 1080p canvas: sub-pixel points
 * that read as a shimmering field full-screen average out to grey dust, and
 * a hue with no spread around it has nothing to be a colour against. Both
 * particle modes shipped a deep blue that simply vanished on the black chip.
 *
 * These values NEVER reach the app. `defaultParams(p)` is what a user gets;
 * this table is merged over it for the one offscreen render that produces the
 * PNG, so the modes look exactly as they always did in the preview and in
 * every export. Nothing here belongs in the preset's own `params`/`styles`.
 *
 * ONE HARD RULE, for compute-particle presets (Particle Flow): recolour and
 * resize freely, but never touch a param the SIM reads — flowScale,
 * flowStrength, swirl, gravity, damping, audioFlow, beatBurst, spawnRadius.
 * Measured, not assumed: simulating the thumbnail with different sim params
 * shifted one frame of a later 90-frame export of that same mode (frame 9,
 * plus the crossfade tail that blends it). Frame 9 alone, with every frame
 * around it matching, so the sim itself stayed in step — but a thumbnail is
 * chrome and it has no business changing an exported frame at all. Restricted
 * to draw-side params the exports are hash-for-hash identical to the build
 * before this file changed. The underlying coupling (a particle buffer that
 * carries something across renderer instances) is a separate bug; this rule
 * keeps the previews out of its way.
 *
 * (This is also where a future "thumbnails reflect my current settings" would
 * hook in — it would read the user's params instead of defaults. Deliberately
 * not built: out of scope. Note it would have to honour the rule above.)
 */
const THUMB_PARAMS: Record<string, Record<string, number>> = {
  // Particles: fewer, much bigger, brighter points, and a real bass/mid/treble
  // hue split — at chip size the default field is 1.3% of pixels above black.
  starfield: {
    density: 10,
    size: 0.24,
    sizeVar: 0.5,
    sizePulse: 1.2,
    fill: 0.85,
    clump: 0.35,
    layers: 2,
    brightness: 1.3,
    glow: 0.65,
    hotCore: 0.75,
    twinkle: 0.25,
    hueVariance: 90,
    bandColor: 60,
    bgLevel: 0.035,
    vignette: 0.2,
  },
  // Particle Flow: draw-side only, per the rule above. Sprites big enough to
  // survive the downscale, a wide hue spread and full saturation instead of
  // one flat blue, and fewer of them drawn so the flow's structure reads
  // instead of packing solid. The flow field itself runs exactly as shipped.
  "particle-flow": {
    size: 0.02,
    density: 0.35,
    brightness: 0.95,
    hueSpread: 160,
    speedColor: 0.8,
    sat: 0.95,
    sizePulse: 1,
  },
};

/** A flattering, deterministic feature frame: full spectrum, a beat mid-decay. */
export function demoFeatures(t: number): AudioFeatures {
  const bins = new Float32Array(96);
  const peaks = new Float32Array(96);
  for (let i = 0; i < 96; i++) {
    const x = i / 96;
    const slope = 0.72 * Math.exp(-x * 2.1);
    const kick = 0.3 * Math.exp(-(((x - 0.16) * 12) ** 2));
    const mids = 0.18 * Math.exp(-(((x - 0.5) * 8) ** 2));
    const shimmer = 0.16 * (0.5 + 0.5 * Math.sin(i * 1.7 + t * 4.0)) * Math.exp(-x * 0.8);
    bins[i] = Math.min(1, slope + kick + mids + shimmer);
    peaks[i] = Math.min(1, bins[i] + 0.08 + 0.05 * Math.sin(i * 0.9));
  }
  const waveform = new Float32Array(2048);
  for (let i = 0; i < waveform.length; i++) {
    const ph = i / waveform.length;
    waveform[i] =
      0.45 * Math.sin(ph * Math.PI * 8 + t * 2) + 0.2 * Math.sin(ph * Math.PI * 34 + t * 5);
  }
  const beatPhase = (t * 2) % 1; // 120 BPM
  const pulse = Math.exp(-beatPhase * 6);
  return {
    bins,
    peaks,
    waveform,
    rms: 0.5,
    energy: 0.55,
    voice: 0.5,
    drive: 0.65,
    driveBeat: pulse,
    bass: 0.7,
    mid: 0.5,
    treble: 0.42,
    width: 0.6,
    lufs: -14,
    kick: pulse,
    snare: 0.25,
    hat: 0.35,
    bpm: 120,
    beatPhase,
    barPhase: (t * 0.5) % 1,
    beat: beatPhase < 0.05,
    beatIntensity: pulse,
    time: t,
    duration: 60,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

let inflight: Promise<Record<string, string>> | null = null;

/** Generate (once per session) a presetId -> PNG-dataURL map. */
export function renderPresetThumbnails(): Promise<Record<string, string>> {
  inflight ??= generate().catch((e) => {
    console.warn("[thumbnails] generation failed:", e);
    return {};
  });
  return inflight;
}

async function generate(): Promise<Record<string, string>> {
  const canvas = new OffscreenCanvas(W, H);
  const renderer = await WebGPURenderer.create(canvas);
  const out: Record<string, string> = {};
  try {
    renderer.resize(W, H, 1);
    // Builder Studio keeps its per-layer values in a storage buffer, not in
    // `params`. A fresh renderer's buffer is zero-initialised, so every layer
    // reads opacity 0 and the mode rendered as a SOLID BLACK chip — worse than
    // the readable text chip an unthumbed mode gets. Seed the starter stack.
    renderer.setBuilderParams(packBuilderParams(defaultBuilderStack()));
    for (const p of presets) {
      renderer.setPreset(p);
      const params = { ...defaultParams(p), ...THUMB_PARAMS[p.id] };
      // Warm a few frames so feedback trails have content, then snapshot with
      // the beat pulse mid-decay (the flattering moment). Particle presets
      // instead walk from the start of the track up to that same instant.
      if (p.particles) {
        for (let f = 0; f <= PARTICLE_WARM_FRAMES; f++) {
          const t = SNAPSHOT_T * (f / PARTICLE_WARM_FRAMES);
          renderer.render(demoFeatures(t), t, params);
        }
      } else {
        for (let f = 0; f <= WARM_FRAMES; f++) {
          const t = 11.53 + f / 30;
          renderer.render(demoFeatures(t), t, params);
        }
      }
      await renderer.gpuDone();
      out[p.id] = await blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
    }
  } finally {
    renderer.dispose();
  }
  return out;
}
