import { WebGPURenderer } from "./webgpuRenderer";
import { presets } from "./presets";
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

/** A flattering, deterministic feature frame: full spectrum, a beat mid-decay. */
function demoFeatures(t: number): AudioFeatures {
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
    for (const p of presets) {
      renderer.setPreset(p);
      const params = defaultParams(p);
      // Warm a few frames so feedback trails and particle sims have content,
      // then snapshot with the beat pulse mid-decay (the flattering moment).
      for (let f = 0; f <= 14; f++) {
        const t = 11.53 + f / 30;
        renderer.render(demoFeatures(t), t, params);
      }
      await renderer.gpuDone();
      out[p.id] = await blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
    }
  } finally {
    renderer.dispose();
  }
  return out;
}
