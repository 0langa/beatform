import { BG_PRESET, DEFAULT_MOTION, DEFAULT_POST } from "../render/types";
import type { ProjectDocument } from "./project";
import type { ThemeMeta } from "./themes";
import type { SyncSettings } from "../audio/types";

/**
 * Factory template packs — curated, genre-shaped starting points shipped
 * with the app. Authored as TYPED data (not JSON files) so the compiler
 * checks every field against the real document schema; exporting one writes
 * the same .avtheme file a community template uses. Params are partial:
 * anything unspecified resolves to the preset's defaults at apply time,
 * exactly like a saved project.
 */

export interface FactoryTheme {
  meta: ThemeMeta;
  document: ProjectDocument;
}

function doc(
  presetId: string,
  params: Record<string, number>,
  over: Partial<ProjectDocument> & { sync?: SyncSettings } = {},
): ProjectDocument {
  const { sync, ...rest } = over;
  return {
    presetId,
    paramsByPreset: { [presetId]: params },
    syncByPreset: sync ? { [presetId]: sync } : {},
    bg: { mode: BG_PRESET, color: [0, 0, 0] },
    overlayLayers: [],
    assets: {},
    aspect: "16:9",
    modsByPreset: {},
    smoothSpectrum: false,
    timeline: { enabled: false, scenes: [], lanes: [] },
    post: { ...DEFAULT_POST },
    motion: { ...DEFAULT_MOTION },
    ...rest,
  };
}

const BY = "Audio Visualizer factory pack";
const LICENSE = "CC0-1.0";

export const FACTORY_THEMES: FactoryTheme[] = [
  {
    meta: {
      name: "Trap Nation Classic",
      author: BY,
      license: LICENSE,
      description:
        "The pumping circle: cover art in the middle, mirrored spectrum ring, floating bokeh. Drop your track and it titles itself.",
      bpmHint: [130, 170],
    },
    document: doc(
      "bass-circle",
      {},
      { post: { ...DEFAULT_POST, bloom: 0.5, bloomThreshold: 0.85, tonemap: true } },
    ),
  },
  {
    meta: {
      name: "Midnight Phonk",
      author: BY,
      license: LICENSE,
      description: "Ember reds, hard grid-locked pump, heavy bloom. Built for dark, driving 808s.",
      bpmHint: [120, 165],
    },
    document: doc(
      "bass-circle",
      { hue: 20, hueSpread: 40, beatPump: 0.3, particles: 1.3, rimBright: 1.2 },
      {
        sync: { mode: "kick", smooth: 0.35, attack: 0.05, release: 0.6 },
        post: { ...DEFAULT_POST, bloom: 0.45, bloomThreshold: 0.8, tonemap: true, vignette: 0.35 },
      },
    ),
  },
  {
    meta: {
      name: "Lo-fi Haze",
      author: BY,
      license: LICENSE,
      description: "Ink-wash clouds, film grain, slow drift. Study-beats energy, zero strobe.",
      bpmHint: [60, 95],
    },
    document: doc(
      "nebula",
      { hue: 220, contrast: 0.8, sparkle: 0.2, saturation: 0.45, flow: 0.08, kaleido: 0 },
      {
        sync: { mode: "energy", smooth: 0.8 },
        post: { ...DEFAULT_POST, grain: 0.14, vignette: 0.3, tonemap: true },
        motion: { ...DEFAULT_MOTION, pulse: 0.6, rotation: 0.7 },
      },
    ),
  },
  {
    meta: {
      name: "Festival Rush",
      author: BY,
      license: LICENSE,
      description:
        "Hyperdrive tunnel — a light ring launches on every beat and lands on the next. Big-room energy.",
      bpmHint: [124, 150],
    },
    document: doc(
      "tunnel-rings",
      {
        hue: 265,
        hueSpread: 80,
        speed: 0.55,
        rings: 11,
        spokes: 20,
        beatSpeed: 0.22,
        beatPulse: 0.9,
        fogFar: 1.0,
      },
      { post: { ...DEFAULT_POST, bloom: 0.5, bloomThreshold: 0.9, tonemap: true } },
    ),
  },
  {
    meta: {
      name: "Outrun Nights",
      author: BY,
      license: LICENSE,
      description:
        "Retro grid racing a scanline sun, beat-locked scroll, chromatic fringe. Synthwave as it should look.",
      bpmHint: [80, 118],
    },
    document: doc(
      "synthwave",
      { hue: 12, gridHue: 285, mountains: 0.6, stars: 1, react: 1.2, beatPulse: 0.8 },
      {
        post: { ...DEFAULT_POST, bloom: 0.4, bloomThreshold: 0.85, chromatic: 0.18, tonemap: true },
      },
    ),
  },
  {
    meta: {
      name: "Ambient Drift",
      author: BY,
      license: LICENSE,
      description: "Slow aurora curtains and stars — for drones, pads, and long fades.",
      bpmHint: [50, 90],
    },
    document: doc(
      "aurora",
      { stars: 1, bgGlow: 0.5 },
      {
        sync: { mode: "energy", smooth: 0.85 },
        post: { ...DEFAULT_POST, bloom: 0.25, tonemap: true },
        motion: { ...DEFAULT_MOTION, pulse: 0.5 },
      },
    ),
  },
  {
    meta: {
      name: "Warehouse Techno",
      author: BY,
      license: LICENSE,
      description: "Terminal-green LED wall with a bass backlight. Relentless, quantized, raw.",
      bpmHint: [125, 145],
    },
    document: doc(
      "led-matrix",
      {
        hueLow: 120,
        hueHigh: 95,
        cols: 64,
        rows: 32,
        gap: 0.1,
        rounded: 0,
        dim: 0.2,
        bassGlow: 0.16,
        beatBoost: 0.18,
      },
      { sync: { mode: "kick", smooth: 0.3 } },
    ),
  },
  {
    meta: {
      name: "Podcast Studio",
      author: BY,
      license: LICENSE,
      description:
        "A calm orb that breathes with speech and sparkles on S-sounds. For voice, not music.",
    },
    document: doc(
      "voice-orb",
      { hue: 0, sparkle: 0.25, wobble: 0.35, voiceFocus: 0.9, response: 0.75, rmsBlend: 0.5 },
      { sync: { mode: "voice", smooth: 0.6 } },
    ),
  },
];
