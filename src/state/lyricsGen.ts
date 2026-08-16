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

export type SidecarStage = "decode" | "isolate" | "vad" | "transcribe" | "align" | "assemble";

/** Per-line confidence detail riding the result event (phase 4): the LRC
 * cannot carry confidence, so the correction editor gets it session-side.
 * One entry per LRC line, in order. */
export interface LineDetail {
  /** Mean word confidence 0..1; null = the line has no word timing. */
  conf: number | null;
  /** Per-word confidences, in word order (empty when conf is null). */
  words: number[];
}

export type SidecarEvent =
  | { type: "progress"; stage: SidecarStage; pct?: number; etaSec?: number; rtf?: number }
  | { type: "stageDone"; stage: SidecarStage; wallSec: number; rtf?: number; detail?: string }
  | {
      type: "result";
      lrcPath: string;
      lines: number;
      /** Words that received timing (phase 3; 0 = line-level LRC). */
      words: number;
      /** Lines that carry word timing. */
      alignedLines: number;
      /** Lines flagged for review (low confidence or failed alignment). */
      lowConfLines: number;
      vocalSec: number;
      ep: "dml" | "cpu";
      language: string;
      /** Present when the alignment stage ran (phase 4). */
      lineDetails?: LineDetail[];
    }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "probe"; dml: boolean };

const STAGES: SidecarStage[] = ["decode", "isolate", "vad", "transcribe", "align", "assemble"];

function isStage(v: unknown): v is SidecarStage {
  return typeof v === "string" && (STAGES as string[]).includes(v);
}

/** The stage that follows `stage`, or null after the last one (`assemble`,
 * which rolls straight into the terminal `result` event rather than another
 * stage). FEAT-004 follow-up (a): a `stageDone` event names the stage that
 * just FINISHED — the store used to keep showing that stage frozen at 100%
 * until the next stage's own first `progress` tick, which can be minutes
 * away (whisper-medium's first-token latency is the worst case, per the
 * owner's first-impressions note). Naming the upcoming stage here is what
 * lets the UI show "starting <next stage>…" the instant the previous one
 * completes, instead of a stale "<finished stage> — 100%". */
export function nextStage(stage: SidecarStage): SidecarStage | null {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1] : null;
}

/** Lenient LineDetail[] reader: anything malformed degrades to undefined —
 * confidence is an enhancement, never a reason to reject a result. */
function parseLineDetails(v: unknown): LineDetail[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: LineDetail[] = [];
  for (const item of v) {
    const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    out.push({
      conf: typeof o.conf === "number" ? o.conf : null,
      words: Array.isArray(o.words)
        ? o.words.filter((w): w is number => typeof w === "number")
        : [],
    });
  }
  return out;
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
        words: typeof o.words === "number" ? o.words : 0,
        alignedLines: typeof o.alignedLines === "number" ? o.alignedLines : 0,
        lowConfLines: typeof o.lowConfLines === "number" ? o.lowConfLines : 0,
        vocalSec: typeof o.vocalSec === "number" ? o.vocalSec : 0,
        ep: o.ep === "dml" ? "dml" : "cpu",
        language: typeof o.language === "string" ? o.language : "",
        lineDetails: parseLineDetails(o.lineDetails),
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
  role: "isolation" | "whisper-small" | "whisper-medium" | "alignment" | string;
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

/** Model ids a tier needs installed. Isolation and the phase-3 alignment
 * pair (word timing) are shared by both tiers — the small tier stays the
 * ~0.68 GB default bundle, medium adds only the bigger whisper. */
export function tierModelIds(tier: LyricsTier): string[] {
  return ["mdx-voc-ft", "wav2vec2-align", "wav2vec2-vocab", TIER_WHISPER_ID[tier]];
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
// Language picker (FEAT-004 follow-up c)

export interface LyricsLanguageOption {
  /** Passed straight through as whisper-cli's --language value (main.rs
   * forwards it as-is, no whitelist) — must match whisper.cpp's own g_lang
   * table exactly, or the sidecar silently mistranscribes instead of
   * erroring. */
  value: string;
  label: string;
}

/**
 * Auto-detect first (the default), then a CURATED subset of whisper.cpp
 * v1.9.1's ~100-language table (the pinned runtime — scripts/fetch-
 * whisper.mjs), alphabetical by English name. Plain text, no flag icons —
 * matching every other picker in this app (AI model, image fit, etc.), and
 * sidestepping the fact that several of whisper's supported languages have
 * no single obvious national flag.
 *
 * "Curated" means deliberately short of the full list: whisper.cpp also
 * carries genuinely low-resource entries (Breton, Occitan, Nynorsk,
 * Faroese, Sanskrit, Hawaiian, Bashkir, Javanese, Sundanese, Sindhi,
 * Tatar, ...) that would roughly double this dropdown for languages almost
 * no user will pick. This set favors official/national languages of large
 * populations and major recorded-music industries — the practical
 * "someone is actually going to sing in this" list — and is revisable: add
 * an entry if a real user needs a language that's missing, matching it
 * against whisper.cpp's g_lang table (src/whisper.cpp) for the exact code.
 */
export const LYRICS_LANGUAGES: LyricsLanguageOption[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "af", label: "Afrikaans" },
  { value: "ar", label: "Arabic" },
  { value: "bn", label: "Bengali" },
  { value: "bg", label: "Bulgarian" },
  { value: "yue", label: "Cantonese" },
  { value: "ca", label: "Catalan" },
  { value: "zh", label: "Chinese" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "et", label: "Estonian" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "is", label: "Icelandic" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "kn", label: "Kannada" },
  { value: "ko", label: "Korean" },
  { value: "lv", label: "Latvian" },
  { value: "lt", label: "Lithuanian" },
  { value: "ms", label: "Malay" },
  { value: "ml", label: "Malayalam" },
  { value: "mr", label: "Marathi" },
  { value: "no", label: "Norwegian" },
  { value: "fa", label: "Persian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "pa", label: "Punjabi" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sr", label: "Serbian" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "es", label: "Spanish" },
  { value: "sw", label: "Swahili" },
  { value: "sv", label: "Swedish" },
  { value: "tl", label: "Tagalog" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "th", label: "Thai" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "ur", label: "Urdu" },
  { value: "vi", label: "Vietnamese" },
];

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
/** Word alignment (phase 3, CPU-only by design — DML measured 4x slower for
 * this model). Device: whole-stage RTF 0.12-0.14 cool (corpus + dense-mix
 * runs), 0.37 thermally degraded — the high end honors adjustment 1's
 * sustained-thermal rule, same as the other stages. */
const ALIGN_RTF = { low: 0.1, high: 0.4 };
/** decode + VAD + assembly + model/session loads. */
const OVERHEAD_SEC = { low: 8, high: 25 };

export interface EstimateRange {
  lowSec: number;
  highSec: number;
}

// ---------------------------------------------------------------------------
// Measured-RTF persistence (FEAT-004 follow-up b)
//
// The table above is fixed — one reference machine, measured once. The
// owner's first-impressions note asked if the estimate is hardware-detected;
// today it is only split by the DML probe. This is the refinement already
// recorded there: fold each completed run's OWN measured RTF (the sidecar
// reports `rtf` on the isolate/transcribe/align stageDone events — see
// main.rs's three `rtf: Some(wall / duration)` emissions) into a persisted
// per-stage history, then blend that history into later estimates so a
// machine that is consistently faster or slower than the reference one
// converges toward its own honest number instead of the reference machine's
// forever.

/** One persisted realtime-factor sample per estimate component. Keyed
 * exactly like the static tables above: isolate splits on DML-vs-CPU
 * (ISOLATE_RTF), whisper splits on tier (WHISPER_RTF), align does not
 * split. null = no completed run has reported this one yet. */
export interface MeasuredRtf {
  isolateDml: number | null;
  isolateCpu: number | null;
  whisperSmall: number | null;
  whisperMedium: number | null;
  align: number | null;
}

export const NO_MEASURED_RTF: MeasuredRtf = {
  isolateDml: null,
  isolateCpu: null,
  whisperSmall: null,
  whisperMedium: null,
  align: null,
};

/**
 * Blend rule 1 of 2 — updating the persisted history: an exponential moving
 * average, `next = prev + ALPHA * (sample - prev)`. 0.3 favors recent runs
 * (thermal state and background load drift within a session, so last run is
 * more informative than the tenth-oldest one) without letting one outlier
 * run (a thermally-throttled background export, a cold vs. warm cache)
 * override an entire history the way a bare "most recent value wins" would.
 */
const RTF_EWMA_ALPHA = 0.3;

function ewma(prev: number | null, sample: number): number {
  return prev == null ? sample : prev + RTF_EWMA_ALPHA * (sample - prev);
}

/**
 * Fold one completed run's per-stage RTF samples into the persisted
 * history. Pure — the store slice reads/writes the actual prefs blob;
 * this just computes the next one. A sample that is missing, non-finite or
 * non-positive (a garbled sidecar line) leaves that slot untouched rather
 * than poisoning the EWMA with a NaN that would then self-propagate through
 * every later estimate.
 */
export function blendMeasuredRtf(prev: MeasuredRtf, samples: Partial<MeasuredRtf>): MeasuredRtf {
  const next = { ...prev };
  for (const key of Object.keys(samples) as (keyof MeasuredRtf)[]) {
    const s = samples[key];
    if (s != null && Number.isFinite(s) && s > 0) next[key] = ewma(prev[key], s);
  }
  return next;
}

/**
 * Blend rule 2 of 2 — folding the history into ONE estimate: an even split
 * between the static reference-machine bound and this machine's own
 * measured value, `bound' = bound + 0.5 * (measured - bound)`. Applied to
 * BOTH the low and high bound of a component with the same weight, so the
 * range narrows symmetrically around the measured value instead of just
 * sliding — the more this machine's history agrees with (or diverges from)
 * the reference machine, the tighter the estimate gets, which is the
 * intended "hardware-detected" feel without discarding the static table
 * the first time this machine runs (no measurement yet = bound' = bound).
 */
const RTF_BLEND_WEIGHT = 0.5;

function blendBound(staticBound: number, measured: number | null): number {
  return measured == null ? staticBound : staticBound + RTF_BLEND_WEIGHT * (measured - staticBound);
}

export function estimateGenerateSeconds(
  durationSec: number,
  tier: LyricsTier,
  dmlAvailable: boolean,
  measured: MeasuredRtf = NO_MEASURED_RTF,
): EstimateRange {
  const d = Math.max(0, durationSec);
  const iso = dmlAvailable ? ISOLATE_RTF.dml : ISOLATE_RTF.cpu;
  const wh = WHISPER_RTF[tier];
  const isoMeasured = dmlAvailable ? measured.isolateDml : measured.isolateCpu;
  const whMeasured = tier === "medium" ? measured.whisperMedium : measured.whisperSmall;
  const isoLow = blendBound(iso.low, isoMeasured);
  const isoHigh = blendBound(iso.high, isoMeasured);
  const whLow = blendBound(wh.low, whMeasured);
  const whHigh = blendBound(wh.high, whMeasured);
  const alignLow = blendBound(ALIGN_RTF.low, measured.align);
  const alignHigh = blendBound(ALIGN_RTF.high, measured.align);
  return {
    lowSec: d * (isoLow + whLow + alignLow) + OVERHEAD_SEC.low,
    highSec: d * (isoHigh + whHigh + alignHigh) + OVERHEAD_SEC.high,
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
  isolate: 0.52,
  vad: 0.01,
  transcribe: 0.36,
  align: 0.07,
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
    /** True for the gap between a stageDone event and the NEXT stage's own
     * first event (FEAT-004 follow-up a) — `stage` already names the
     * upcoming stage, but there is no real pct/eta for it yet. The panel
     * reads this to show "Starting <stage>…" instead of a bare "<stage>…",
     * which would otherwise look identical to a stage that is genuinely
     * running but simply never reports a percent. */
    starting: boolean;
  } | null;
}

export const IDLE_LYRICS_GEN: LyricsGenState = {
  phase: "idle",
  models: null,
  dml: null,
  download: null,
  gen: null,
};

type GenState = NonNullable<LyricsGenState["gen"]>;

/**
 * Reduces one progress/stageDone sidecar event into the next `gen` UI
 * state — pure, so the transition (a) can be unit-tested directly instead
 * of only through the store's mocked sidecar plumbing. The store's onLine
 * handler is thin wiring around this.
 *
 * `progress` always means "this stage is genuinely running": starting
 * clears, even when the event itself carries no pct (still real signal,
 * still not "starting"). `stageDone` looks up nextStage() and, when one
 * exists, reports it with starting=true and no pct/eta — the transitional
 * state. The overall bar still advances the full weight of the JUST-
 * finished stage either way, since "before next" and "before+100% of the
 * finished stage" are the same sum by construction. The last stage
 * (assemble) has no next: it keeps the old 100%-and-done shape, since the
 * terminal `result` event follows immediately, not another stage.
 */
export function reduceGenProgress(
  ev: Extract<SidecarEvent, { type: "progress" | "stageDone" }>,
): GenState {
  if (ev.type === "progress") {
    return {
      stage: ev.stage,
      pct: ev.pct ?? null,
      etaSec: ev.etaSec ?? null,
      starting: false,
      overall: overallProgress(ev.stage, ev.pct ?? null),
    };
  }
  const next = nextStage(ev.stage);
  if (next) {
    return {
      stage: next,
      pct: null,
      etaSec: null,
      starting: true,
      overall: overallProgress(ev.stage, 100),
    };
  }
  return {
    stage: ev.stage,
    pct: 100,
    etaSec: null,
    starting: false,
    overall: overallProgress(ev.stage, 100),
  };
}
