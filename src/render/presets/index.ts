import type { PresetDef } from "../types";
import { customPresetById } from "./custom";
import { spectrumBars } from "./spectrumBars";
import { radialBurst } from "./radialBurst";
import { oscilloscope } from "./oscilloscope";
import { starfield } from "./starfield";
import { tunnelRings } from "./tunnelRings";
import { nebula } from "./nebula";
import { metaballs } from "./metaballs";
import { ledMatrix } from "./ledMatrix";
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
  starfield,
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
  builder,
];

// Built-in id -> def, built once (the list is static). presetById runs in the
// per-frame resolve path, so this avoids a linear scan every frame.
const builtinById = new Map(presets.map((p) => [p.id, p]));

export function presetById(id: string): PresetDef {
  // Built-ins win; then the runtime registry of user-authored WGSL presets
  // (custom ids are prefixed "custom-", so collisions cannot occur).
  return builtinById.get(id) ?? customPresetById(id) ?? presets[0];
}
