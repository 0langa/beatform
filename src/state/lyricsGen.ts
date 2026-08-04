/**
 * Local automatic lyrics (FEAT-004 phase 2) — pure logic for the generate
 * flow: sidecar protocol parsing, model-tier math, and the honest time
 * estimates the approval gate requires ("disk, time, and hardware costs are
 * explicit before download/run").
 *
 * Everything here is pure and unit-tested; the Tauri wiring lives in
 * platform.ts and the store slice. Nothing in this file (or anywhere in the
 * generate flow) touches the render path — the output is an LRC handed to
 * the SAME parser the import button uses.
 */

// ---------------------------------------------------------------------------
// Sidecar protocol (mirrors src-tauri/lyrics-sidecar/src/protocol.rs)

export type SidecarStage = "decode" | "isolate" | "vad" | "transcribe" | "assemble";

export type SidecarEvent =
  | { type: "progress"; stage: SidecarStage; pct?: number; etaSec?: number; rtf?: number }
  | { type: "stageDone"; stage: SidecarStage; wallSec: number; rtf?: number; detail?: string }
  | {
      type: "result";
      lrcPath: string;
      lines: number;
      vocalSec: number;
      ep: "dml" | "cpu";
      language: string;
    }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "probe"; dml: boolean };

const STAGES: SidecarStage[] = ["decode", "isolate", "vad", "transcribe", "assemble"];

function isStage(v: unknown): v is SidecarStage {
  return typeof v === "string" && (STAGES as string[]).includes(v);
}

/** Parse one line of sidecar stdout. Null for anything malformed — the
 * supervisor must never crash on a garbled line. */
export function parseSidecarEvent(line: string): SidecarEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "progress":
      if (!isStage(o.stage)) return null;
      return {
        type: "progress",
        stage: o.stage,
        pct: typeof o.pct === "number" ? o.pct : undefined,
        etaSec: typeof o.etaSec === "number" ? o.etaSec : undefined,
        rtf: typeof o.rtf === "number" ? o.rtf : undefined,
      };
    case "stageDone":
      if (!isStage(o.stage) || typeof o.wallSec !== "number") return null;
      return {
        type: "stageDone",
        stage: o.stage,
        wallSec: o.wallSec,
        rtf: typeof o.rtf === "number" ? o.rtf : undefined,
        detail: typeof o.detail === "string" ? o.detail : undefined,
      };
    case "result":
      if (typeof o.lrcPath !== "string" || typeof o.lines !== "number") return null;
      return {
        type: "result",
        lrcPath: o.lrcPath,
        lines: o.lines,
        vocalSec: typeof o.vocalSec === "number" ? o.vocalSec : 0,
        ep: o.ep === "dml" ? "dml" : "cpu",
        language: typeof o.language === "string" ? o.language : "",
      };
    case "error":
      return {
        type: "error",
        message: typeof o.message === "string" ? o.message : "lyrics generation failed",
      };
    case "cancelled":
      return { type: "cancelled" };
    case "probe":
      return { type: "probe", dml: o.dml === true };
    default:
      return null;
  }
}

/** Model-download progress events on the download channel. */
export function parseDownloadProgress(
  line: string,
): { id: string; received: number; total: number } | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.received !== "number" || typeof o.total !== "number") {
    return null;
  }
  return { id: o.id, received: o.received, total: o.total };
}

// ---------------------------------------------------------------------------
// Model manifest state (mirrors lyrics.rs ModelsState)

export interface LyricsModelInfo {
  id: string;
  fileName: string;
  bytes: number;
  sha256: string;
  role: "isolation" | "whisper-small" | "whisper-medium" | string;
  installed: boolean;
  partBytes: number;
}

export interface LyricsModelsState {
  modelsDir: string;
  models: LyricsModelInfo[];
}

/** The user-facing tier choice = which whisper model transcribes. */
export type LyricsTier = "small" | "medium";

export const TIER_WHISPER_ID: Record<LyricsTier, string> = {
  small: "whisper-small",
  medium: "whisper-medium",
};

/** Model ids a tier needs installed (isolation is shared by both). */
export function tierModelIds(tier: LyricsTier): string[] {
  return ["mdx-voc-ft", TIER_WHISPER_ID[tier]];
}

export function missingModels(state: LyricsModelsState, tier: LyricsTier): LyricsModelInfo[] {
  return tierModelIds(tier)
    .map((id) => state.models.find((m) => m.id === id))
    .filter((m): m is LyricsModelInfo => m != null && !m.installed);
}

export function tierInstalled(state: LyricsModelsState, tier: LyricsTier): boolean {
  return missingModels(state, tier).length === 0;
}

/** Bytes a "Download" click would actually move (resume-aware) and the full
 * on-disk size of the tier — both for the disclosure line. */
export function tierDownloadBytes(
  state: LyricsModelsState,
  tier: LyricsTier,
): { remaining: number; installTotal: number } {
  const ids = tierModelIds(tier);
  let remaining = 0;
  let installTotal = 0;
  for (const id of ids) {
    const m = state.models.find((x) => x.id === id);
    if (!m) continue;
    installTotal += m.bytes;
    if (!m.installed) remaining += Math.max(0, m.bytes - m.partBytes);
  }
  return { remaining, installTotal };
}

// ---------------------------------------------------------------------------
// Time estimates — sustained-thermal numbers (spike adjustment 1)

/**
 * Measured realtime factors (wall seconds per audio second) on the reference
 * machine (i5-1135G7 / Iris Xe / 16 GB), from the FEAT-004 phase-1 spike
 * REPORT plus the phase-2 device runs. Deliberately the SUSTAINED numbers:
 * the spike showed cold-run CPU RTF is 2-3x better than thermal steady
 * state, and an estimate built on cold numbers lies to everyone with a warm
 * laptop (adjustment 1).
 */
const ISOLATE_RTF = {
  dml: { low: 0.45, high: 0.7 }, // measured 0.435-0.52 on Iris Xe
  cpu: { low: 1.9, high: 2.5 }, // sustained 1.86-2.45
};
const WHISPER_RTF: Record<LyricsTier, { low: number; high: number }> = {
  small: { low: 0.25, high: 0.45 }, // measured 0.24-0.42
  medium: { low: 1.5, high: 2.1 }, // measured 1.5-2.01
};
/** decode + VAD + assembly + model/session loads. */
const OVERHEAD_SEC = { low: 8, high: 25 };

export interface EstimateRange {
  lowSec: number;
  highSec: number;
}

export function estimateGenerateSeconds(
  durationSec: number,
  tier: LyricsTier,
  dmlAvailable: boolean,
): EstimateRange {
  const d = Math.max(0, durationSec);
  const iso = dmlAvailable ? ISOLATE_RTF.dml : ISOLATE_RTF.cpu;
  const wh = WHISPER_RTF[tier];
  return {
    lowSec: d * (iso.low + wh.low) + OVERHEAD_SEC.low,
    highSec: d * (iso.high + wh.high) + OVERHEAD_SEC.high,
  };
}

/** "≈2-4 min" / "under a minute" — ceil to minutes, honest about the range. */
export function formatEstimate(est: EstimateRange): string {
  if (est.highSec < 60) return "under a minute";
  const lo = Math.max(1, Math.round(est.lowSec / 60));
  const hi = Math.max(lo, Math.ceil(est.highSec / 60));
  return lo === hi ? `≈${lo} min` : `≈${lo}-${hi} min`;
}

/** Decimal units, matching the app-wide convention (platform.ts formatMB). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Seconds -> compact countdown ("3:05", "0:12"). */
export function formatEta(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Overall progress 0..1 across the whole pipeline for one progress bar.
 * Stages are weighted by their typical share of wall time; within a stage
 * the sidecar's own pct interpolates. Purely cosmetic — the stage label and
 * per-stage ETA carry the honest numbers. */
const STAGE_WEIGHTS: Record<SidecarStage, number> = {
  decode: 0.02,
  isolate: 0.55,
  vad: 0.01,
  transcribe: 0.4,
  assemble: 0.02,
};

export function overallProgress(stage: SidecarStage, pctInStage: number | null): number {
  let before = 0;
  for (const s of STAGES) {
    if (s === stage) break;
    before += STAGE_WEIGHTS[s];
  }
  const inStage = ((pctInStage ?? 0) / 100) * STAGE_WEIGHTS[stage];
  return Math.min(1, before + inStage);
}

// ---------------------------------------------------------------------------
// Store-facing UI state (session-only; the store slice owns transitions)

export interface LyricsGenState {
  phase: "idle" | "downloading" | "generating";
  /** Model manifest + install state; null until the first refresh. */
  models: LyricsModelsState | null;
  /** DirectML availability on this machine; null until probed. */
  dml: boolean | null;
  /** Live download progress while phase === "downloading". */
  download: { id: string; received: number; total: number } | null;
  /** Live pipeline progress while phase === "generating". */
  gen: {
    stage: SidecarStage;
    pct: number | null;
    etaSec: number | null;
    /** Weighted 0..1 across all stages, for the single progress bar. */
    overall: number;
  } | null;
}

export const IDLE_LYRICS_GEN: LyricsGenState = {
  phase: "idle",
  models: null,
  dml: null,
  download: null,
  gen: null,
};
