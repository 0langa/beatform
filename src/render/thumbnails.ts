import { WebGPURenderer } from "./webgpuRenderer";
import { presets } from "./presets";
import { defaultBuilderStack, packBuilderParams } from "./builder2";
import { defaultParams } from "./types";
import type { PresetDef } from "./types";
import type { AudioFeatures } from "../audio/types";

/**
 * Preset thumbnails: render every mode once with canned "mid-song, energetic"
 * features on a small hidden WebGPU canvas and cache the PNGs for the strip.
 * Fully deterministic (fixed constants, fixed times) and generated after first
 * paint so startup stays instant. Falls back to no thumbnails when WebGPU is
 * unavailable — the strip keeps its text chips.
 *
 * Two passes, not one (P-3). The run used to walk the REGISTRY array and
 * publish a single map at the very end, which is the worst of both orders: the
 * chips a new user is actually looking at (the strip's first few) are rendered
 * near the END of registry order — `echo-trails` is 3rd on the strip and 10th
 * in the registry, `bass-circle` 4th and 15th — and nothing at all appeared
 * until all seventeen modes plus all seventeen PNG encodes had finished. So a
 * brand-new user's first minute was a row of text chips no matter how fast the
 * first thumbnail was ready. The run now walks the STRIP's order and publishes
 * the first {@link EAGER_THUMB_COUNT} as soon as they exist; the tail follows
 * on the next idle window.
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
 * How many thumbnails are rendered and published BEFORE the rest.
 *
 * Derived from what the user can actually see, not picked by feel: `.chips`
 * lives inside a `.preset-strip` capped at 1040px, and a chip is 84px of
 * thumbnail plus a 6px gap — so ten is a full strip at the widest the strip is
 * ever allowed to be, and more than a full strip at every window narrower than
 * that. Rendering more would be work spent on chips that are past the fold and
 * behind an edge fade.
 *
 * WHICH ten is not decided here at all: it is the first ten of the order the
 * strip itself renders (see {@link thumbnailSequence}), so a user who has
 * reordered the strip in Preferences gets pictures on THEIR first ten chips.
 */
export const EAGER_THUMB_COUNT = 10;

/**
 * The render order: the strip's order first, then anything it did not mention.
 *
 * The tail matters as much as the head. `order` comes from the user's
 * persisted strip order, which is reconciled against the registry at boot —
 * but this function must not depend on that having happened, or a stale or
 * hand-edited order would silently cost some mode its thumbnail forever.
 * Every registry preset appears exactly once, whatever `order` contains.
 */
export function thumbnailSequence(order: readonly string[] = []): PresetDef[] {
  const byId = new Map(presets.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: PresetDef[] = [];
  for (const id of order) {
    const def = byId.get(id);
    if (!def || seen.has(id)) continue;
    seen.add(id);
    out.push(def);
  }
  for (const p of presets) if (!seen.has(p.id)) out.push(p);
  return out;
}

/**
 * Hand the main thread back between the eager slice and the tail.
 *
 * Thumbnails run on a SECOND WebGPU device that competes with the live render
 * loop for one GPU, so the tail — which nobody is waiting on — yields to an
 * idle window first. The timeout is what keeps it from being starved forever
 * by that same render loop; the `setTimeout` branch covers environments with
 * no `requestIdleCallback` at all (Safari-derived webviews, jsdom).
 */
function idleYield(): Promise<void> {
  return new Promise((resolve) => {
    const w = globalThis as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 600 });
    else setTimeout(resolve, 0);
  });
}

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
 * A thumbnail is chrome and has no business anywhere near a simulation the
 * export also steps; restricted to draw-side params the exports are
 * hash-for-hash identical to the build before this file changed.
 *
 * The rule arrived with a measurement attached: giving the thumbnail different
 * sim params shifted ONE frame of a later 90-frame loop export of that mode
 * (frame 9, plus the tail frame the loop crossfade blends it into), which was
 * written up here as a particle buffer carrying state across renderer
 * instances. RP-4 chased that mechanism down and the code does not do it:
 * every WebGPURenderer owns a private adapter+device and destroys it in
 * dispose(), all particle state is instance-private (particleBuf,
 * particleCapacity, simStepsDone, particleInitPending), setPreset re-seeds
 * from a pure hash of the particle index while zeroing the step counter, and
 * the one module-level mutable binding in webgpuRenderer.ts is a memoized f16
 * lookup table. The recorded evidence says the same thing: the sim is an
 * integrator, so a perturbed buffer diverges at the frame it was perturbed and
 * never rejoins — one frame moving with its neighbours intact is the opposite
 * shape. particleSimIsolation.test.ts pins the isolation directly, in both
 * directions the coupling could have run.
 *
 * What that one frame actually was is still unexplained; it was never
 * reproduced, and reproducing it needs a real GPU and a real export. So the
 * rule stays — as belt and braces, not as a workaround for a known bug.
 *
 * (This is also where a future "thumbnails reflect my current settings" would
 * hook in — it would read the user's params instead of defaults. Deliberately
 * not built: out of scope. Note it would have to honour the rule above.)
 */
const THUMB_PARAMS: Record<string, Record<string, number>> = {
  // Particles: fewer, much bigger, brighter points, and a real bass/mid/treble
  // hue split — at chip size the default field is 1.3% of pixels above black.
  particles: {
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
  // Spectro Falls: the record has to have FILLED by snapshot time. The warm-up
  // is 15 frames on the fixed 1/60 feedback tick — a quarter-second of history
  // — so the shipped 180 slices would fill 8% of the chip and the rest would
  // be floor. Sixteen slices fill fifteen of sixteen in the same walk, leaving
  // only the oldest (already the most faded) dark, and at 144x81 those bands
  // are 5 px tall: a legible waterfall instead of a hairline. Glow and now-line
  // lifted for the downscale, palette exactly as shipped.
  "spectro-falls": {
    slices: 16,
    glow: 1.1,
    edge: 1.1,
    spill: 0.8,
    fade: 0.35,
    grid: 0,
  },
  // Lyric Stage: the chip renders with no plate bound, so it shows the
  // rehearsal specimen — whose default four rows are ~7 px tall at 144x81,
  // word blocks of 2-3 px. Three big rows keep the blocks readable at chip
  // size, and the lifted glow/skyline make the stage read as lit. Draw-side
  // only; the shipped defaults are untouched everywhere else.
  "lyric-stage": {
    greekRows: 3,
    size: 1.4,
    glow: 1,
    ghostBars: 0.45,
    flare: 0.5,
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
  // Stereo pair for the second waveform lane: a 3:2 frequency ratio with a
  // quarter-turn phase offset — the classic closed Lissajous rose — plus a
  // touch of the mono lane's shimmer so sweep-style consumers still read it
  // as the same programme. Deterministic in t, like everything above; the
  // mono lane stays byte-identical so no non-oscilloscope hash can move.
  const waveformL = new Float32Array(2048);
  const waveformR = new Float32Array(2048);
  for (let i = 0; i < waveformL.length; i++) {
    const ph = i / waveformL.length;
    const shimmer = 0.08 * Math.sin(ph * Math.PI * 34 + t * 5);
    waveformL[i] = 0.58 * Math.sin(ph * Math.PI * 6 + t * 0.7) + shimmer;
    waveformR[i] = 0.58 * Math.sin(ph * Math.PI * 4 + t * 0.7 + Math.PI / 2) + shimmer;
  }
  const beatPhase = (t * 2) % 1; // 120 BPM
  const pulse = Math.exp(-beatPhase * 6);
  // P-15 reactivity-fuel fields, deterministic in t like everything above.
  // No renderer reads them on the GPU path, so no pixel hash can move; they
  // exist so mod-matrix previews and future consumers see live-looking fuel.
  // Chroma: a C-major triad (C/E/G peaks) breathing gently.
  const chroma = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    const triad = i === 0 ? 0.85 : i === 4 ? 0.65 : i === 7 ? 0.75 : 0.15;
    chroma[i] = Math.min(1, Math.max(0, triad + 0.1 * Math.sin(t * 1.3 + i * 2.1)));
  }
  const beatIndex = Math.floor(t * 2); // one beat per 0.5 s, matching beatPhase
  return {
    bins,
    peaks,
    waveform,
    waveformL,
    waveformR,
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
    beatIndex,
    barIndex: Math.floor(beatIndex / 4), // matches barPhase's (t * 0.5) % 1
    sectionIndex: Math.floor(t / 15), // a "section" every 15 s of demo time
    sectionPulse: Math.exp(-(t % 15) * 4),
    chroma,
    vocal: 0.45 + 0.35 * Math.sin(t * 0.8), // slow sung/instrumental swell
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

export interface ThumbnailRun {
  /**
   * Preset ids in the order the STRIP shows them. Anything the registry does
   * not know is ignored and anything the list omits is appended, so this is
   * safe to hand a persisted value straight from prefs.
   */
  order?: readonly string[];
  /**
   * Called with the accumulated presetId -> data-URL map when the eager slice
   * lands, and again when the tail does. Copies, never the live object, so a
   * consumer can hand it straight to a store without aliasing.
   *
   * This — not the returned promise — is the interesting result: the promise
   * cannot resolve twice, and resolving only at the end is exactly the
   * all-or-nothing publish P-3 is about.
   */
  onBatch?: (thumbs: Record<string, string>) => void;
}

/** Generate (once per session) a presetId -> PNG-dataURL map. */
export function renderPresetThumbnails(run: ThumbnailRun = {}): Promise<Record<string, string>> {
  inflight ??= generate(run).catch((e) => {
    console.warn("[thumbnails] generation failed:", e);
    return {};
  });
  return inflight;
}

async function generate({ order, onBatch }: ThumbnailRun): Promise<Record<string, string>> {
  const canvas = new OffscreenCanvas(W, H);
  const renderer = await WebGPURenderer.create(canvas);
  const out: Record<string, string> = {};
  const queue = thumbnailSequence(order);
  try {
    renderer.resize(W, H, 1);
    // Builder Studio keeps its per-layer values in a storage buffer, not in
    // `params`. A fresh renderer's buffer is zero-initialised, so every layer
    // reads opacity 0 and the mode rendered as a SOLID BLACK chip — worse than
    // the readable text chip an unthumbed mode gets. Seed the starter stack.
    renderer.setBuilderParams(packBuilderParams(defaultBuilderStack()));
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
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
      // The eager slice is complete: publish it and let a frame land before
      // the tail starts competing with the live renderer again. Publishing
      // here rather than after the loop is also what makes a mid-run failure
      // survivable — a device lost while rendering mode 12 now costs the user
      // the tail, not the ten chips that were already on screen.
      if (i === EAGER_THUMB_COUNT - 1 && i < queue.length - 1) {
        onBatch?.({ ...out });
        await idleYield();
      }
    }
  } finally {
    renderer.dispose();
  }
  onBatch?.({ ...out });
  return out;
}
