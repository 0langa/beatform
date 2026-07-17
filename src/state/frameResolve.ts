import { defaultParams, type BgSettings, type ParamValues } from "../render/types";
import { presetById } from "../render/presets";
import { evalTimeline, type Timeline } from "./timeline";
import type { ModRoute } from "./modMatrix";

/**
 * The single source of truth for "what should render at track time t" — used
 * by BOTH the live loop (services.ts) and the export loop (exportCore.ts).
 * Sharing one pure function is what guarantees preview and file are identical:
 * every layering rule (base -> scene override -> automation, which preset,
 * which mods, which background, crossfade sides) lives here and nowhere else.
 *
 * Returns pre-modulation params; the caller applies applyMods() as the final
 * layer (it needs per-frame AudioFeatures). The crossfade `prev` side is
 * intentionally pre-mod on both paths (a transient 0.5 s blend).
 */
export interface FrameResolveInput {
  timeline: Timeline;
  /** Document base preset — the render target when no scene is active. */
  basePresetId: string;
  /** Precomputed resolved params of basePresetId (avoids a per-frame merge). */
  baseParams: ParamValues;
  /** Mod routes of basePresetId. */
  baseMods: ModRoute[];
  baseBg: BgSettings;
  paramsByPreset: Record<string, ParamValues>;
  modsByPreset: Record<string, ModRoute[]>;
}

export interface ResolvedFrame {
  presetId: string;
  /** Base + scene override + automation, PRE-modulation. */
  params: ParamValues;
  mods: ModRoute[];
  bg: BgSettings;
  /** During a crossfade: the outgoing setup (pre-mod params); null otherwise. */
  prev: { presetId: string; params: ParamValues } | null;
  /** 0..1 blend toward the active preset (1 = no fade). */
  mix: number;
  /** WGSL blend kind for the active crossfade (0 = crossfade). */
  transitionKind: number;
}

export function resolveActiveFrame(input: FrameResolveInput, t: number): ResolvedFrame {
  const { timeline, basePresetId, baseParams, baseMods, baseBg, paramsByPreset, modsByPreset } =
    input;

  const baseOf = (pid: string): ParamValues =>
    pid === basePresetId
      ? baseParams
      : { ...defaultParams(presetById(pid)), ...paramsByPreset[pid] };
  const modsOf = (pid: string): ModRoute[] =>
    pid === basePresetId ? baseMods : (modsByPreset[pid] ?? []);

  const frame = evalTimeline(timeline, t);

  let presetId = basePresetId;
  let params = baseParams;
  let mods = baseMods;
  let bg = baseBg;
  if (frame.scene) {
    presetId = frame.scene.presetId;
    params = frame.scene.params ? { ...baseOf(presetId), ...frame.scene.params } : baseOf(presetId);
    mods = modsOf(presetId);
    bg = frame.scene.bg ?? baseBg;
  }
  if (Object.keys(frame.automation).length > 0) {
    params = { ...params, ...frame.automation };
  }

  let prev: ResolvedFrame["prev"] = null;
  if (frame.prevScene) {
    const ppid = frame.prevScene.presetId;
    const pParams = frame.prevScene.params
      ? { ...baseOf(ppid), ...frame.prevScene.params }
      : baseOf(ppid);
    prev = {
      presetId: ppid,
      params:
        Object.keys(frame.automation).length > 0 ? { ...pParams, ...frame.automation } : pParams,
    };
  }

  return { presetId, params, mods, bg, prev, mix: frame.mix, transitionKind: frame.transitionKind };
}
