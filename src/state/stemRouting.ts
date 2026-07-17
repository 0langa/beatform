import type { ModRoute, ModSource } from "./modMatrix";
import type { ParamSpec } from "../render/types";
import type { StemTrackKey } from "../audio/stems";

/**
 * Stem auto-routing: one click wires an imported stem's bands to the sensible
 * knobs of the active visual, so stems "just work" without learning the mod
 * matrix. Pure: given the active preset's param specs and a stem slot, it
 * returns the ModRoutes to add. The store applies them.
 *
 * Each role matches params by keyword (weighted — an exact key beats a
 * substring), picks the best UNUSED param, and wires one stem band to it.
 * Nothing is invented: a role with no matching param is simply skipped, so a
 * minimal preset gets fewer routes rather than nonsense ones.
 */

interface Role {
  /** Stem band that drives this role. */
  band: StemTrackKey;
  /** -1..1 amount for the created route. */
  amount: number;
  /** Param-key keywords, strongest first. An exact key match always wins. */
  keywords: string[];
}

/** The default "drum kit" mapping — the punchy, obvious wiring people expect. */
export const STEM_ROLES: Role[] = [
  // Kick drives geometric pump/zoom.
  {
    band: "kick",
    amount: 0.7,
    keywords: [
      "beatPulse",
      "sizePulse",
      "beatZoom",
      "pulse",
      "zoom",
      "swell",
      "size",
      "radius",
      "scale",
    ],
  },
  // Bass drives glow/bloom.
  {
    band: "bass",
    amount: 0.6,
    keywords: ["bgGlow", "beatBloom", "glow", "bloom", "brightness", "beatBright"],
  },
  // Snare drives a flash/pop.
  { band: "snare", amount: 0.5, keywords: ["beatFlash", "flash", "beatBurst", "burst", "sparkle"] },
  // Hats drive fine detail/sparkle/speed.
  { band: "hat", amount: 0.4, keywords: ["sparkle", "stars", "detail", "speed", "flow", "thick"] },
  // Mids (vocal range) drive hue movement.
  { band: "mid", amount: 0.5, keywords: ["hueSpread", "hueRange", "hue", "sat", "react"] },
];

/** Score a param key against a keyword list — exact match 100, else a
 * case-insensitive substring scored by keyword rank (earlier = higher). */
function scoreKey(key: string, keywords: string[]): number {
  const lk = key.toLowerCase();
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i].toLowerCase();
    if (lk === kw) return 100 - i;
    if (lk.includes(kw)) return 50 - i;
  }
  return 0;
}

/**
 * Build the routes for one stem slot against the active preset's params.
 * `slot` is "stem1".."stem4"; source ids come out as "stem1:kick" etc.
 * Params already targeted by `taken` keys are avoided so two roles never
 * fight over one knob (and existing routes stay intact).
 */
export function stemRoutesFor(
  slot: string,
  params: ParamSpec[],
  newId: () => string,
  taken: ReadonlySet<string> = new Set(),
): ModRoute[] {
  const used = new Set(taken);
  const routes: ModRoute[] = [];
  for (const role of STEM_ROLES) {
    let best: { key: string; score: number } | null = null;
    for (const p of params) {
      if (used.has(p.key)) continue;
      const score = scoreKey(p.key, role.keywords);
      if (score > 0 && (!best || score > best.score)) best = { key: p.key, score };
    }
    if (!best) continue;
    used.add(best.key);
    routes.push({
      id: newId(),
      source: `${slot}:${role.band}` as ModSource,
      param: best.key,
      amount: role.amount,
    });
  }
  return routes;
}
