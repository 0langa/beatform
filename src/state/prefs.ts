import { isQuantizeMode, type QuantizeMode } from "./quantize";

/**
 * App-level preferences — one typed, versioned object under
 * `beatform.prefs.v1`, replacing the scatter of small ad-hoc localStorage
 * keys (viz.volume, viz.panelOpen, viz.timelineOpen, viz.advancedOpen,
 * viz.switchQuantize.v1, viz.panelWidth.v1, viz.lastSaveDir.v1) and hosting
 * every new Settings-page preference.
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
  /** Settings panel open at boot. */
  panelOpen: boolean;
  /** Timeline panel open at boot. */
  timelineOpen: boolean;
  /** Per-preset Advanced disclosure. */
  advancedOpen: boolean;
  /** Live switch quantize (off/beat/bar). */
  switchQuantize: QuantizeMode;
  /** Settings/library panel width, px (240..440). */
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
  /** Check GitHub Releases for updates shortly after launch. */
  updateAutoCheck: boolean;
  /** Active tab of the per-visual settings panel. */
  paramsTab: "visual" | "sync" | "scene" | "text" | "live";
  /** Collapsed section titles inside the settings panel. */
  collapsedSections: string[];
}

export const DEFAULT_PREFS: AppPrefs = {
  volume: 0.9,
  panelOpen: false,
  timelineOpen: false,
  advancedOpen: false,
  switchQuantize: "off",
  panelWidth: 280,
  lastSaveDir: null,
  autosaveIntervalSec: 5,
  fpsCap: 0,
  powerPreference: "default",
  updateAutoCheck: true,
  paramsTab: "visual",
  collapsedSections: [],
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

function num(v: unknown, def: number, lo: number, hi: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

function validPrefs(raw: unknown): AppPrefs {
  const p = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<AppPrefs>;
  const d = DEFAULT_PREFS;
  return {
    volume: num(p.volume, d.volume, 0, 1),
    panelOpen: typeof p.panelOpen === "boolean" ? p.panelOpen : d.panelOpen,
    timelineOpen: typeof p.timelineOpen === "boolean" ? p.timelineOpen : d.timelineOpen,
    advancedOpen: typeof p.advancedOpen === "boolean" ? p.advancedOpen : d.advancedOpen,
    switchQuantize: isQuantizeMode(p.switchQuantize) ? p.switchQuantize : d.switchQuantize,
    panelWidth: num(p.panelWidth, d.panelWidth, 240, 440),
    lastSaveDir: typeof p.lastSaveDir === "string" && p.lastSaveDir ? p.lastSaveDir : null,
    autosaveIntervalSec: num(p.autosaveIntervalSec, d.autosaveIntervalSec, 2, 30),
    fpsCap: p.fpsCap === 30 || p.fpsCap === 60 ? p.fpsCap : 0,
    powerPreference:
      p.powerPreference === "high-performance" || p.powerPreference === "low-power"
        ? p.powerPreference
        : "default",
    updateAutoCheck: typeof p.updateAutoCheck === "boolean" ? p.updateAutoCheck : d.updateAutoCheck,
    paramsTab:
      p.paramsTab === "sync" ||
      p.paramsTab === "scene" ||
      p.paramsTab === "text" ||
      p.paramsTab === "live"
        ? p.paramsTab
        : "visual",
    collapsedSections: Array.isArray(p.collapsedSections)
      ? p.collapsedSections.filter((s): s is string => typeof s === "string").slice(0, 64)
      : [],
  };
}

/** One-time migration from the legacy scattered keys. Only fields absent
 * from the stored blob are taken from legacy (a written blob always wins). */
function migrateLegacy(base: Partial<AppPrefs>): Partial<AppPrefs> {
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
  let stored: Partial<AppPrefs> = {};
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (raw) stored = JSON.parse(raw) as Partial<AppPrefs>;
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

export function setPrefs(patch: Partial<AppPrefs>): AppPrefs {
  prefs = validPrefs({ ...prefs, ...patch });
  persist();
  return prefs;
}
