import { NO_MEASURED_RTF, type MeasuredRtf } from "./lyricsGen";
import { isQuantizeMode, type QuantizeMode } from "./quantize";

/** Corner the performance overlay anchors to (plain CSS anchor, no collision
 * logic — the four offsets simply clear the top bar and the player bar). */
export type PerfOverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type PerfOverlaySize = "s" | "m" | "l";
export type PerfOverlayColor = "accent" | "white" | "green" | "amber";

/** Which lines the performance overlay shows. */
export interface PerfOverlayStats {
  fps: boolean;
  frameTime: boolean;
  renderer: boolean;
  jsHeap: boolean;
  cpu: boolean;
  ram: boolean;
  disk: boolean;
  gpu: boolean;
}

/**
 * App-level preferences — one typed, versioned object under
 * `beatform.prefs.v1`, replacing the scatter of small ad-hoc localStorage
 * keys (viz.volume, viz.panelOpen, viz.timelineOpen, viz.advancedOpen,
 * viz.switchQuantize.v1, viz.panelWidth.v1, viz.lastSaveDir.v1) and hosting
 * every new Preferences-page preference.
 *
 * Deliberately NOT merged here: the heavy per-document caches
 * (params/sync/mods/overlay/timeline/custom presets/post/motion/bg). They
 * are debounced, can run to megabytes (overlay assets), and merging them
 * would make every volume tick re-serialize the lot. Small prefs in one
 * blob; heavy caches stay per-key.
 *
 * Reads are served from an in-memory copy loaded once at module init
 * (legacy keys migrated on first run, then removed). Writes rewrite the
 * whole blob, debounced — it is tiny.
 */

export interface AppPrefs {
  /** Player volume 0..1. */
  volume: number;
  /** Library panel open at boot. */
  panelOpen: boolean;
  /** Timeline panel open at boot. */
  timelineOpen: boolean;
  /** Live switch quantize (off/beat/bar). */
  switchQuantize: QuantizeMode;
  /** Library panel width, px (240..440). */
  panelWidth: number;
  /** Folder of the last save dialog, or null. */
  lastSaveDir: string | null;
  /** Autosave debounce, seconds (2..30). */
  autosaveIntervalSec: number;
  /** Live-preview frame cap: 0 = display refresh, else 30/60. Exports are
   * never capped — this is a battery/thermals knob for the live loop only. */
  fpsCap: 0 | 30 | 60;
  /** WebGPU adapter request hint (dual-GPU laptops). Applies on restart. */
  powerPreference: "default" | "high-performance" | "low-power";
  /** Live-preview render resolution scale. Multiplies devicePixelRatio for
   * the LIVE canvas backing store only — exports render offscreen at the
   * exact chosen output size and are unaffected by construction. 1 = native;
   * lower trades sharpness for frame rate on weak GPUs. */
  previewScale: 1 | 0.75 | 0.5;
  /** Check GitHub Releases for updates shortly after launch. */
  updateAutoCheck: boolean;
  /**
   * FROZEN (P-1). The Visuals panel's five tabs became the dock's section rail,
   * so nothing writes this any more — but it is still validated and still
   * read ONCE, to place an existing user on the page matching the tab they
   * last used. Deleting it would silently land every upgrading user on Mode.
   */
  paramsTab: "visual" | "sync" | "scene" | "text" | "live";
  /** Active page of the Visuals dock's section rail (P-1). */
  visualsPage: "mode" | "motion" | "themes" | "sync" | "modulation" | "scene" | "text" | "live";
  /**
   * Visuals dock width, px. Deliberately NOT `panelWidth`: that one still
   * sizes the Library panel, and reinterpreting a stored 280 as a dock width
   * would hand every existing user a cramped dock on first launch.
   */
  visualsWidth: number;
  /**
   * Collapsed GROUP keys inside an Visuals page ("group:<id>").
   *
   * P-1 retired in-page SECTION collapse — the rail is the one navigation
   * model — so unprefixed section ids no longer have a reader and are pruned
   * on validation. That prune is also what closes the old defect where the
   * first section keyed its collapse state on the visual mode's display name:
   * the mechanism it lived in no longer exists.
   */
  collapsedSections: string[];
  /**
   * Group ids whose Advanced (expert-tier) disclosure is OPEN (P-9).
   *
   * Deliberately NOT a third prefix inside `collapsedSections`: the semantics
   * invert. Collapse is a CLOSED set over a default-open list; Advanced is an
   * OPEN set over a default-closed one, and two prefixes in one array meaning
   * opposite things is how a prune rule becomes unwritable.
   *
   * Global, not per-preset: 8 shared ids + "more" + a legacy builder's ten is
   * ~19 keys; per-preset x per-group does not fit any honest cap.
   */
  advancedGroups: string[];
  /**
   * The user's own left-to-right order for the mode strip, as preset ids.
   * EMPTY means "never customised" — and that is load-bearing: an empty value
   * follows whatever order the app ships, so someone who never touched this
   * picks up a better default order from an update instead of being frozen on
   * the one that happened to be current when they first launched. A non-empty
   * value is reconciled against the live registry on read (see
   * presetOrder.ts), never trusted as-is.
   */
  presetOrder: string[];
  /** Live stats overlay over the preview canvas. Default OFF — while off it
   * mounts nothing, polls nothing and costs nothing. Pure DOM, never part of
   * the render canvas, so exports are untouched by construction. */
  perfOverlay: boolean;
  /** Which corner the overlay anchors to. */
  perfOverlayCorner: PerfOverlayCorner;
  /** Overlay font scale. */
  perfOverlaySize: PerfOverlaySize;
  /** Overlay text colour. */
  perfOverlayColor: PerfOverlayColor;
  /** Per-stat visibility. */
  perfOverlayStats: PerfOverlayStats;
  /** FEAT-004 follow-up (b): this machine's own measured lyrics-generation
   * RTF per pipeline component, EWMA'd across completed runs and blended
   * into the next run's time estimate (see lyricsGen.ts's blendMeasuredRtf/
   * estimateGenerateSeconds for the two blend rules). Session-independent
   * on purpose — it is a property of the hardware, not of one project. */
  measuredRtf: MeasuredRtf;
  /** FEAT-009: preset-name flash on the performance OUTPUT window. Default
   * off — clean output is the whole point of the second display. */
  performHud: boolean;
  /** FEAT-009: open the performance window fullscreen (vs a movable
   * window). */
  performFullscreen: boolean;
  /** FEAT-009: target monitor INDEX for the performance window, or null =
   * auto (largest non-primary, else primary). An index is only a hint —
   * hotplug can invalidate it between sessions, so the Rust side clamps a
   * stale value at open time (perform_window::resolve_monitor). */
  performMonitor: number | null;
}

export const DEFAULT_PREFS: AppPrefs = {
  volume: 0.9,
  panelOpen: false,
  timelineOpen: false,
  switchQuantize: "off",
  panelWidth: 280,
  lastSaveDir: null,
  autosaveIntervalSec: 5,
  fpsCap: 0,
  powerPreference: "default",
  previewScale: 1,
  updateAutoCheck: true,
  paramsTab: "visual",
  visualsPage: "mode",
  visualsWidth: 480,
  collapsedSections: [],
  advancedGroups: [],
  presetOrder: [],
  perfOverlay: false,
  perfOverlayCorner: "top-left",
  perfOverlaySize: "m",
  perfOverlayColor: "accent",
  // GPU % is honestly "—" on this build and disk churn is niche — both start
  // hidden; the headline numbers start visible.
  perfOverlayStats: {
    fps: true,
    frameTime: true,
    renderer: true,
    jsHeap: true,
    cpu: true,
    ram: true,
    disk: false,
    gpu: false,
  },
  measuredRtf: NO_MEASURED_RTF,
  performHud: false,
  performFullscreen: true,
  performMonitor: null,
};

const LS_PREFS = "beatform.prefs.v1";

/** Legacy single-value keys, migrated once then deleted. */
const LEGACY = {
  volume: "viz.volume",
  panelOpen: "viz.panelOpen",
  timelineOpen: "viz.timelineOpen",
  advancedOpen: "viz.advancedOpen",
  switchQuantize: "viz.switchQuantize.v1",
  panelWidth: "viz.panelWidth.v1",
  lastSaveDir: "viz.lastSaveDir.v1",
} as const;

/** Read-only migration input removed from the live AppPrefs shape in H3a.
 * Keeping it here preserves direct upgrades from builds predating v2.82.0;
 * validPrefs consumes it once to seed advancedGroups, then omits it from the
 * normalized blob written back to storage. */
type RawAppPrefs = Partial<AppPrefs> & { advancedOpen?: unknown };

function num(v: unknown, def: number, lo: number, hi: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

/** Membership-checked enum field — anything unknown degrades to the default. */
function oneOf<T extends string>(v: unknown, options: readonly T[], def: T): T {
  return options.includes(v as T) ? (v as T) : def;
}

/**
 * Where an upgrading user lands when the retired five-tab layout becomes the
 * dock's rail. "visual" carried mode + styles + looks + every param group, so
 * it maps to Mode; the other four kept their names.
 */
const TAB_TO_PAGE: Record<AppPrefs["paramsTab"], AppPrefs["visualsPage"]> = {
  visual: "mode",
  sync: "sync",
  scene: "scene",
  text: "text",
  live: "live",
};

function validOverlayStats(raw: unknown): PerfOverlayStats {
  const p = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<PerfOverlayStats>;
  const d = DEFAULT_PREFS.perfOverlayStats;
  return {
    fps: bool(p.fps, d.fps),
    frameTime: bool(p.frameTime, d.frameTime),
    renderer: bool(p.renderer, d.renderer),
    jsHeap: bool(p.jsHeap, d.jsHeap),
    cpu: bool(p.cpu, d.cpu),
    ram: bool(p.ram, d.ram),
    disk: bool(p.disk, d.disk),
    gpu: bool(p.gpu, d.gpu),
  };
}

/** A finite, positive number or null — anything else (corrupted storage, a
 * hand-edited blob, a stray 0 or negative) degrades to null ("no
 * measurement yet"), never to NaN, which would otherwise poison every
 * later blended estimate (same rule blendMeasuredRtf itself applies to a
 * live sidecar sample). */
function positiveOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function validMeasuredRtf(raw: unknown): MeasuredRtf {
  const p = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<MeasuredRtf>;
  return {
    isolateDml: positiveOrNull(p.isolateDml),
    isolateCpu: positiveOrNull(p.isolateCpu),
    whisperSmall: positiveOrNull(p.whisperSmall),
    whisperMedium: positiveOrNull(p.whisperMedium),
    align: positiveOrNull(p.align),
  };
}

/**
 * What legacy `advancedOpen: true` expands to. The eight shared PARAM_GROUPS ids plus
 * the "more" fallback, DUPLICATED here on purpose -- state must not import the
 * render layer (the rule that already forced the "group:" literal to be copied
 * below). prefs.test.ts asserts this list equals PARAM_GROUPS + FALLBACK_GROUP.
 */
export const ADVANCED_SEED_GROUPS = [
  "shape",
  "color",
  "motion",
  "reaction",
  "glow",
  "image",
  "camera",
  "backdrop",
  "more",
] as const;

function validPrefs(raw: unknown): AppPrefs {
  const p = (typeof raw === "object" && raw !== null ? raw : {}) as RawAppPrefs;
  const d = DEFAULT_PREFS;
  return {
    volume: num(p.volume, d.volume, 0, 1),
    panelOpen: typeof p.panelOpen === "boolean" ? p.panelOpen : d.panelOpen,
    timelineOpen: typeof p.timelineOpen === "boolean" ? p.timelineOpen : d.timelineOpen,
    switchQuantize: isQuantizeMode(p.switchQuantize) ? p.switchQuantize : d.switchQuantize,
    panelWidth: num(p.panelWidth, d.panelWidth, 240, 440),
    lastSaveDir: typeof p.lastSaveDir === "string" && p.lastSaveDir ? p.lastSaveDir : null,
    autosaveIntervalSec: num(p.autosaveIntervalSec, d.autosaveIntervalSec, 2, 30),
    fpsCap: p.fpsCap === 30 || p.fpsCap === 60 ? p.fpsCap : 0,
    powerPreference:
      p.powerPreference === "high-performance" || p.powerPreference === "low-power"
        ? p.powerPreference
        : "default",
    previewScale: p.previewScale === 0.75 || p.previewScale === 0.5 ? p.previewScale : 1,
    updateAutoCheck: typeof p.updateAutoCheck === "boolean" ? p.updateAutoCheck : d.updateAutoCheck,
    paramsTab:
      p.paramsTab === "sync" ||
      p.paramsTab === "scene" ||
      p.paramsTab === "text" ||
      p.paramsTab === "live"
        ? p.paramsTab
        : "visual",
    // The rail's page is a NEW field, so every install predating the dock
    // arrives without it. Rather than dump those users on Mode, it inherits
    // the page matching the tab they last used. This runs at module import as
    // pure coercion — no setPrefs, no effect — so it cannot schedule a React
    // update mid-render, and it runs even for someone who never opens the
    // dock (a panel-hosted migration would not).
    visualsPage: oneOf(
      p.visualsPage,
      ["mode", "motion", "themes", "sync", "modulation", "scene", "text", "live"] as const,
      TAB_TO_PAGE[
        (p.paramsTab === "sync" ||
        p.paramsTab === "scene" ||
        p.paramsTab === "text" ||
        p.paramsTab === "live"
          ? p.paramsTab
          : "visual") as AppPrefs["paramsTab"]
      ],
    ),
    visualsWidth: num(p.visualsWidth, d.visualsWidth, 380, 760),
    // Only "group:"-prefixed keys still have a reader (ParamGroups); P-1
    // retired section collapse, so bare section ids are pruned instead of
    // sitting in the 64-entry budget forever. The prefix literal is
    // duplicated from ParamGroups on purpose — state must not import UI —
    // and prefs.test.ts asserts the two stay equal.
    collapsedSections: Array.isArray(p.collapsedSections)
      ? p.collapsedSections
          .filter((s): s is string => typeof s === "string" && s.startsWith("group:"))
          .slice(0, 64)
      : [],
    // Seeded, not defaulted. A user who had density "All" must not be dropped
    // back to essentials-on-every-group. `setPrefs` spreads current prefs
    // before validating, so once this field exists it is never undefined
    // again -- and an EMPTY array (a user who closed every disclosure) is not
    // undefined, so it is never re-seeded. The seed lives here rather than in
    // a panel mount effect for the same reason visualsPage's does: a
    // dock-hosted migration never runs for someone who does not open the dock.
    advancedGroups: Array.isArray(p.advancedGroups)
      ? p.advancedGroups.filter((s): s is string => typeof s === "string").slice(0, 32)
      : p.advancedOpen === true
        ? [...ADVANCED_SEED_GROUPS]
        : [],
    // Kept as raw ids, NOT reconciled here: prefs must not import the preset
    // registry (it would drag the whole render layer into every module that
    // reads a volume). Anything non-array degrades to "never customised".
    presetOrder: Array.isArray(p.presetOrder)
      ? p.presetOrder.filter((s): s is string => typeof s === "string").slice(0, 64)
      : [],
    perfOverlay: bool(p.perfOverlay, d.perfOverlay),
    perfOverlayCorner: oneOf(
      p.perfOverlayCorner,
      ["top-left", "top-right", "bottom-left", "bottom-right"],
      d.perfOverlayCorner,
    ),
    perfOverlaySize: oneOf(p.perfOverlaySize, ["s", "m", "l"], d.perfOverlaySize),
    perfOverlayColor: oneOf(
      p.perfOverlayColor,
      ["accent", "white", "green", "amber"],
      d.perfOverlayColor,
    ),
    perfOverlayStats: validOverlayStats(p.perfOverlayStats),
    measuredRtf: validMeasuredRtf(p.measuredRtf),
    performHud: bool(p.performHud, d.performHud),
    performFullscreen: bool(p.performFullscreen, d.performFullscreen),
    // A non-negative integer index or null (= auto). Fractions, negatives
    // and junk degrade to auto rather than to a wrong monitor.
    performMonitor:
      typeof p.performMonitor === "number" &&
      Number.isInteger(p.performMonitor) &&
      p.performMonitor >= 0 &&
      p.performMonitor < 64
        ? p.performMonitor
        : null,
  };
}

/** One-time migration from the legacy scattered keys. Only fields absent
 * from the stored blob are taken from legacy (a written blob always wins). */
function migrateLegacy(base: RawAppPrefs): RawAppPrefs {
  const out = { ...base };
  try {
    if (out.volume === undefined) {
      const v = Number(localStorage.getItem(LEGACY.volume));
      if (Number.isFinite(v) && localStorage.getItem(LEGACY.volume) !== null) out.volume = v;
    }
    if (out.panelOpen === undefined && localStorage.getItem(LEGACY.panelOpen) !== null) {
      out.panelOpen = localStorage.getItem(LEGACY.panelOpen) === "1";
    }
    if (out.timelineOpen === undefined && localStorage.getItem(LEGACY.timelineOpen) !== null) {
      out.timelineOpen = localStorage.getItem(LEGACY.timelineOpen) === "1";
    }
    if (out.advancedOpen === undefined && localStorage.getItem(LEGACY.advancedOpen) !== null) {
      out.advancedOpen = localStorage.getItem(LEGACY.advancedOpen) === "1";
    }
    if (out.switchQuantize === undefined) {
      const q = localStorage.getItem(LEGACY.switchQuantize);
      if (q !== null) {
        try {
          const parsed: unknown = JSON.parse(q);
          if (isQuantizeMode(parsed)) out.switchQuantize = parsed;
        } catch {
          if (isQuantizeMode(q)) out.switchQuantize = q;
        }
      }
    }
    if (out.panelWidth === undefined) {
      const w = Number(localStorage.getItem(LEGACY.panelWidth));
      if (Number.isFinite(w) && w > 0) out.panelWidth = w;
    }
    if (out.lastSaveDir === undefined) {
      const dir = localStorage.getItem(LEGACY.lastSaveDir);
      if (dir) out.lastSaveDir = dir;
    }
  } catch {
    // storage blocked — defaults it is
  }
  return out;
}

let prefs: AppPrefs = (() => {
  let stored: RawAppPrefs = {};
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (raw) stored = JSON.parse(raw) as RawAppPrefs;
  } catch {
    // corrupted/blocked — treated as empty
  }
  const merged = validPrefs(migrateLegacy(stored));
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify(merged));
    for (const key of Object.values(LEGACY)) localStorage.removeItem(key);
  } catch {
    // quota — prefs stay session-only
  }
  return merged;
})();

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  if (writeTimer !== null) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
    } catch {
      // quota — session-only
    }
  }, 200);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (writeTimer !== null) {
      clearTimeout(writeTimer);
      writeTimer = null;
      try {
        localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
      } catch {
        // quota
      }
    }
  });
}

export function getPrefs(): AppPrefs {
  return prefs;
}

/** Change listeners (App's useSyncExternalStore). setPrefs replaces the whole
 * prefs object, so `getPrefs` is a valid snapshot function: a new reference
 * means a change, an identical reference means none. */
const listeners = new Set<() => void>();

/** Subscribe to prefs changes; returns the unsubscribe. Shape matches
 * React's useSyncExternalStore(subscribePrefs, getPrefs). */
export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Content equality for the two list fields. Both are plain string arrays;
 * `validPrefs` rebuilds them on every call, so identity is never a usable
 * answer here. */
function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Content equality for the one nested object field — same reason. */
function sameOverlayStats(a: PerfOverlayStats, b: PerfOverlayStats): boolean {
  return (
    a.fps === b.fps &&
    a.frameTime === b.frameTime &&
    a.renderer === b.renderer &&
    a.jsHeap === b.jsHeap &&
    a.cpu === b.cpu &&
    a.ram === b.ram &&
    a.disk === b.disk &&
    a.gpu === b.gpu
  );
}

/** Content equality for measuredRtf — same reason as sameOverlayStats. */
function sameMeasuredRtf(a: MeasuredRtf, b: MeasuredRtf): boolean {
  return (
    a.isolateDml === b.isolateDml &&
    a.isolateCpu === b.isolateCpu &&
    a.whisperSmall === b.whisperSmall &&
    a.whisperMedium === b.whisperMedium &&
    a.align === b.align
  );
}

/**
 * Field-wise comparison of two validated prefs blobs. Deliberately explicit
 * rather than a JSON.stringify: it is the compiler's job to fail this
 * function when a field is added, and a stringify would silently pass while
 * ignoring the new one forever.
 */
function samePrefs(a: AppPrefs, b: AppPrefs): boolean {
  return (
    a.volume === b.volume &&
    a.panelOpen === b.panelOpen &&
    a.timelineOpen === b.timelineOpen &&
    a.switchQuantize === b.switchQuantize &&
    a.panelWidth === b.panelWidth &&
    a.lastSaveDir === b.lastSaveDir &&
    a.autosaveIntervalSec === b.autosaveIntervalSec &&
    a.fpsCap === b.fpsCap &&
    a.powerPreference === b.powerPreference &&
    a.previewScale === b.previewScale &&
    a.updateAutoCheck === b.updateAutoCheck &&
    a.paramsTab === b.paramsTab &&
    a.visualsPage === b.visualsPage &&
    a.visualsWidth === b.visualsWidth &&
    sameStringList(a.collapsedSections, b.collapsedSections) &&
    sameStringList(a.advancedGroups, b.advancedGroups) &&
    sameStringList(a.presetOrder, b.presetOrder) &&
    a.perfOverlay === b.perfOverlay &&
    a.perfOverlayCorner === b.perfOverlayCorner &&
    a.perfOverlaySize === b.perfOverlaySize &&
    a.perfOverlayColor === b.perfOverlayColor &&
    sameOverlayStats(a.perfOverlayStats, b.perfOverlayStats) &&
    sameMeasuredRtf(a.measuredRtf, b.measuredRtf) &&
    a.performHud === b.performHud &&
    a.performFullscreen === b.performFullscreen &&
    a.performMonitor === b.performMonitor
  );
}

/**
 * Write a patch. A patch that changes NOTHING returns the existing object
 * without persisting or notifying.
 *
 * Without that guard every write was a change as far as subscribers were
 * concerned: `validPrefs` allocates a fresh blob unconditionally, so
 * `getPrefs()` returned a new reference and every `useSyncExternalStore`
 * reader re-rendered. The cheapest example is the Escape cascade, which calls
 * `setShowPanel(false)` unguarded — every Escape keypress with nothing open
 * used to re-render App. Redundant writes come from drags that end where they
 * started and from mirrors that re-apply the value they just read, and none of
 * them should look like a change.
 */
export function setPrefs(patch: Partial<AppPrefs>): AppPrefs {
  const next = validPrefs({ ...prefs, ...patch });
  if (samePrefs(prefs, next)) return prefs;
  prefs = next;
  persist();
  for (const listener of listeners) listener();
  return prefs;
}
