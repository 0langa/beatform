import type { PresetDef } from "../types";
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

export function presetById(id: string): PresetDef {
  return presets.find((p) => p.id === id) ?? presets[0];
}
