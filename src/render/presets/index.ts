import type { PresetDef } from "../types";
import { customPresetById } from "./custom";
import { BUILDER2_ID, currentBuilder2Def } from "../builder2";
import { spectrumBars } from "./spectrumBars";
import { radialBurst } from "./radialBurst";
import { oscilloscope } from "./oscilloscope";
import { particles } from "./particles";
import { tunnelRings } from "./tunnelRings";
import { nebula } from "./nebula";
import { metaballs } from "./metaballs";
import { ledMatrix } from "./ledMatrix";
import { spectroFalls } from "./spectroFalls";
import { lyricStage } from "./lyricStage";
import { voiceOrb } from "./voiceOrb";
import { echoTrails } from "./echoTrails";
import { particleFlow } from "./particleFlow";
import { spectrumScape } from "./spectrumScape";
import { aurora } from "./aurora";
import { synthwave } from "./synthwave";
import { bassCircle } from "./bassCircle";
import { builder } from "./builder";

/** Registry: adding a preset = write the file, add it here. */
export const presets: PresetDef[] = [
  spectrumBars,
  radialBurst,
  oscilloscope,
  particles,
  tunnelRings,
  nebula,
  metaballs,
  ledMatrix,
  voiceOrb,
  echoTrails,
  particleFlow,
  spectrumScape,
  aurora,
  synthwave,
  bassCircle,
  spectroFalls,
  lyricStage,
  // ONE Builder on the strip (the layer compositor);
  // rendering resolves through presetById -> currentBuilder2Def().
  currentBuilder2Def(),
];

/**
 * Built-in preset ids that were RENAMED. Persisted data keeps the old id
 * forever (project/theme documents, .bfpreset looks, localStorage caches,
 * the prefs strip order), so every loader that reads a persisted preset id
 * maps it through {@link canonicalPresetId} before validating — the map is
 * the single source of truth for those migrations. Custom ids are prefixed
 * "custom-", so a legacy built-in id can never collide with one.
 */
export const RENAMED_PRESET_IDS: Readonly<Record<string, string>> = {
  // v2.68: the mode has displayed as "Particles" since v2.4x; the internal
  // id/file finally follow (was src/render/presets/starfield.ts).
  starfield: "particles",
};

/** Resolve a possibly-legacy preset id to its current one. */
export function canonicalPresetId(id: string): string {
  // Own-property check: a plain-object map would otherwise answer for
  // prototype keys ("toString", "constructor") out of untrusted files.
  return Object.prototype.hasOwnProperty.call(RENAMED_PRESET_IDS, id) ? RENAMED_PRESET_IDS[id] : id;
}

// Built-in id -> def, built once. Includes HIDDEN presets that left the
// strip but must keep resolving forever: the classic `builder` renders
// byte-identically for every old project/scene that references it.
const builtinById = new Map([...presets, builder].map((p) => [p.id, p]));

/** Every id the app can render: strip presets, hidden built-ins, Builder
 * Studio, and registered custom defs. Validators use THIS, not the strip
 * list — a hidden id must never be "migrated" away to the default mode. */
export function knownPresetId(id: string): boolean {
  return id === BUILDER2_ID || builtinById.has(id) || customPresetById(id) !== undefined;
}

export function presetById(id: string): PresetDef {
  // Builder Studio resolves to its CURRENT generated def — object identity
  // changes only on structural stack edits, which is exactly the signal the
  // render loop and pipeline cache key on.
  if (id === BUILDER2_ID) return currentBuilder2Def();
  // Built-ins win; then the runtime registry of user-authored WGSL presets
  // (custom ids are prefixed "custom-", so collisions cannot occur).
  return builtinById.get(id) ?? customPresetById(id) ?? presets[0];
}
