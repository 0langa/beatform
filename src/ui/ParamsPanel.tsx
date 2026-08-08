import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import type { SpectrumResolution, SyncMode } from "../audio/types";
import { MAX_FREQ, MIN_FREQ } from "../audio/featurePipeline";
import { spectrumDiagnostics } from "../audio/dsp/displaySpectrum";
import type { BgFit, BgMode, MotionSettings, PostSettings } from "../render/types";
import {
  BG_IMAGE,
  BG_PRESET,
  BG_SOLID,
  BG_VIDEO,
  BG_TRANSPARENT,
  DEFAULT_MOTION,
  DEFAULT_POST,
  defaultParams,
} from "../render/types";
import { ASPECTS } from "../state/project";
import { FACTORY_THEMES } from "../state/factoryThemes";
import { GalleryLink } from "./GalleryDialog";
import {
  LFO_SOURCES,
  MOD_SOURCES,
  POST_TARGET_PREFIX,
  type ModCurve,
  type ModSource,
} from "../state/modMatrix";
import { MOD_ROUTE_RECIPES } from "../state/modRoutePresets";
import { MAX_STEMS, STEM_TRACK_KEYS } from "../audio/stems";
import { LYRIC_ANIMS } from "../state/lyrics";
import { LyricsEditPanel } from "./LyricsEditPanel";
import { LyricsGenPanel } from "./LyricsGenPanel";
import {
  allParams,
  groupParams,
  isModTarget,
  paramSearchText,
  POST_MOD_TARGETS,
  presetMasters,
} from "../render/types";
import { QUANTIZE_MODES } from "../state/quantize";
import { bindingId } from "../state/midi";
import {
  HERTZ,
  PERCENT,
  ColorRow,
  SelectRow,
  SliderField,
  SliderRow,
  Segmented,
  ToggleRow,
  type ValueUnit,
} from "./kit";
import { GROUP_KEY, ParamGroups, type ParamGroupExtra } from "./ParamGroups";
import type { AppPrefs } from "../state/prefs";
import { getPrefs, setPrefs } from "../state/prefs";
import { LayersPanel } from "./LayersPanel";
import { BuilderPanel } from "./BuilderPanel";
import { PanelFooterBadges } from "./PanelFooterBadges";
import {
  BUILDER2_ID,
  BUILDER_FACTORY_STACKS,
  BUILDER_LAYER_TYPES,
  copyBuilderStack,
  sameStackValues,
} from "../render/builder2";
import { IconClose } from "./Icons";
import { useVizStore } from "../state/store";
import {
  selectBgPerMode,
  selectCenterImageName,
  selectEffectiveBg,
  selectHasCoverArt,
  selectPreset,
} from "../state/selectors";
import { askConfirm, isTauri } from "../state/platform";
import { midiSupported } from "../state/midiInput";

/** Evaluate-once environment probe, at MODULE scope exactly as App.tsx held
 * it — this reads a capability KEY off navigator, it does not extract
 * `navigator.requestMIDIAccess` into a local (CLAUDE.md's Web-MIDI rule).
 * Tests replace it with `vi.mock("../state/midiInput")`, not a prop. */
const MIDI_SUPPORTED = midiSupported();

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * High-edge readout. Stating unit as a scale (rather than a format function)
 * lets numeric editor read "18.05" back as 18050 Hz instead of 18 Hz.
 */
const KILOHERTZ: ValueUnit = { scale: 0.001, unit: " kHz", decimals: 1 };

const SYNC_OPTIONS: Array<{ mode: SyncMode; label: string; hint: string }> = [
  {
    mode: "kick",
    label: "Kicks",
    hint: "Follow the kick drum: pulses fire on kick hits, motion pumps with the kick band's punch",
  },
  {
    mode: "energy",
    label: "Energy",
    hint: "Follow overall loudness — the smoothest, most forgiving option",
  },
  {
    mode: "bass",
    label: "Bass",
    hint: "Follow the low end — basslines and subs drive the visuals",
  },
  {
    mode: "melody",
    label: "Melody",
    hint: "Follow the mids (~150 Hz–2 kHz) where melodies and chords live",
  },
  {
    mode: "voice",
    label: "Voice",
    hint: "Follow the vocal range (~300 Hz–3.4 kHz) — speech and singing",
  },
  { mode: "treble", label: "Treble", hint: "Follow hi-hats, cymbals and sparkle" },
  { mode: "snare", label: "Snare", hint: "Pulse on snare/clap hits (150 Hz-2.5 kHz transients)" },
  { mode: "hats", label: "Hats", hint: "Pulse on hi-hat hits (5 kHz+ transients)" },
];

const BG_OPTIONS_BASE: Array<{ mode: BgMode; label: string; hint: string }> = [
  { mode: BG_PRESET, label: "Animated", hint: "The visual's own moving background" },
  {
    mode: BG_SOLID,
    label: "Solid",
    hint: "Flat color behind the visual — pick any, or chroma green/magenta for keying",
  },
  {
    mode: BG_TRANSPARENT,
    label: "Transparent",
    hint: "See-through background (checkerboard preview); MP4 exports render it black",
  },
  {
    mode: BG_IMAGE,
    label: "Image",
    hint: "Your artwork (or the album art) behind the visualization — fill or fit, with blur and dim",
  },
];

/** Video is desktop-only (it decodes a local file), so it's appended by the
 * panel when running under Tauri. */
const BG_OPTION_VIDEO = {
  mode: BG_VIDEO,
  label: "Video",
  hint: "A short local video looped behind the visualization — deterministic, fill or fit",
};

/** CSS object-fit, in the words a musician uses. Order and values match the
 * shader's fitUV modes (0/1/2) — see BgFit. */
const BG_FIT_OPTIONS = [
  { value: 0, label: "Fill", hint: "Cover the whole frame; whatever does not fit is cropped off" },
  { value: 1, label: "Fit", hint: "Show all of it — the leftover bars take the background color" },
  { value: 2, label: "Stretch", hint: "Squash it to fill the frame exactly (distorts the shape)" },
];

/** The background color picker plus the presets a keying workflow wants.
 * Shared by Solid mode and by a FITTED image/video, whose letterbox bars the
 * shader paints with this very color (u.bgColor) — reachable from both, or
 * choosing Fit would strand the user with bars they cannot recolor. */
function BgColorRow(props: {
  value: [number, number, number];
  onChange: (color: [number, number, number]) => void;
  title: string;
}) {
  return (
    <div className="row color-row">
      <input
        type="color"
        className="bg-color"
        value={rgbToHex(props.value)}
        onChange={(e) => props.onChange(hexToRgb(e.target.value))}
        title={props.title}
      />
      {["#000000", "#ffffff", "#00b140", "#ff00ff"].map((hex) => (
        <button
          key={hex}
          className="swatch"
          style={{ background: hex }}
          title={hex === "#00b140" ? "Chroma green" : hex === "#ff00ff" ? "Chroma magenta" : hex}
          onClick={() => props.onChange(hexToRgb(hex))}
        />
      ))}
    </div>
  );
}

/**
 * Framing rows (fit / zoom / pan) for an image or video background. One
 * component for both kinds so their ranges and wording cannot drift apart,
 * and so the ranges stay in step with validBg's clamps (0.25..4, -1..1).
 *
 * Every field is read through a fallback: BgFit is optional, and a background
 * that predates it — or one just created by picking a file — carries none.
 */
function BgFitRows(props: {
  /** The noun for the hints: "image" or "video". */
  what: string;
  value: BgFit;
  onChange: (patch: BgFit) => void;
  /** The background color — only rendered for a Fit, where it is the bars. */
  color: [number, number, number];
  onColor: (color: [number, number, number]) => void;
  onHint: (hint: string | null) => void;
  /** Set when the active renderer can't frame this source at all (video on
   * the Canvas2D fallback) — disables the rows and explains itself. Images
   * ARE fitted there (see drawFittedBg), so they never pass this. */
  disabledReason?: string;
}) {
  const { value, onChange, what } = props;
  const fit = value.fit ?? 0;
  return (
    <>
      <Segmented
        value={fit}
        onChange={(next) => onChange({ fit: next })}
        onHint={props.onHint}
        ariaLabel={`Background ${what} fit`}
        disabled={!!props.disabledReason}
        options={BG_FIT_OPTIONS}
      />
      {fit === 1 && (
        <BgColorRow
          value={props.color}
          onChange={props.onColor}
          title={`Fills the bars beside the fitted ${what}`}
        />
      )}
      <SliderRow
        label="Zoom"
        hint={`Scale the ${what} inside the frame — zoom in on the part you want`}
        min={0.25}
        max={4}
        step={0.01}
        value={value.zoom ?? 1}
        onChange={(zoom) => onChange({ zoom })}
        onHint={props.onHint}
        disabledReason={props.disabledReason}
      />
      <SliderRow
        label="X"
        hint={`Slide the ${what} sideways inside the frame`}
        min={-1}
        max={1}
        step={0.005}
        value={value.offsetX ?? 0}
        onChange={(offsetX) => onChange({ offsetX })}
        onHint={props.onHint}
        disabledReason={props.disabledReason}
      />
      <SliderRow
        label="Y"
        hint={`Slide the ${what} up or down inside the frame`}
        min={-1}
        max={1}
        step={0.005}
        value={value.offsetY ?? 0}
        onChange={(offsetY) => onChange({ offsetY })}
        onHint={props.onHint}
        disabledReason={props.disabledReason}
      />
    </>
  );
}

type PostNumKey = "bloom" | "bloomThreshold" | "exposure" | "vignette" | "grain" | "chromatic";
const POST_SLIDERS: Array<{
  key: PostNumKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}> = [
  {
    key: "exposure",
    label: "Exposure",
    min: 0.2,
    max: 3,
    step: 0.01,
    hint: "Overall brightness before tonemapping — 1 is neutral, higher lifts the whole image",
  },
  {
    key: "bloom",
    label: "Bloom",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "Soft glow bleeding out of bright areas — the signature 'lit' look",
  },
  {
    key: "bloomThreshold",
    label: "Bloom threshold",
    min: 0.4,
    max: 1.6,
    step: 0.01,
    hint: "Only luma above this glows — lower catches more of the image, higher keeps it to highlights",
  },
  {
    key: "vignette",
    label: "Vignette",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "Darkens the corners to draw the eye inward",
  },
  {
    key: "chromatic",
    label: "Chromatic",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "RGB split toward the edges — a lens/analog fringe",
  },
  {
    key: "grain",
    label: "Film grain",
    min: 0,
    max: 0.5,
    step: 0.01,
    hint: "Deterministic film grain keyed to track time",
  },
];

type InspectorPageId = AppPrefs["inspectorPage"];

/**
 * The Inspector's section rail (P-1): eight destinations, one page each.
 *
 * A DATA TABLE on purpose. Everything the rail renders — order, label, hint,
 * the hairline groupings — is a row here, so later stages add a destination
 * without touching the shell. Labels are the design surface and may be
 * retuned; the `id`s are frozen, because they persist as `inspectorPage` and
 * are what the GPU harness selects on (`[data-section="sync"]`).
 *
 * Modulation is a top-level destination rather than a link at the bottom of
 * Sync — that placement is the whole reason this rail exists.
 */
const INSPECTOR_PAGES: ReadonlyArray<{
  id: InspectorPageId;
  label: string;
  hint: string;
  /** Draw a hairline above this item — grouping only, never a heading. */
  dividerBefore?: boolean;
}> = [
  { id: "mode", label: "Mode", hint: "The active visual and all of its controls" },
  { id: "motion", label: "Motion", hint: "Rotation, pulse and detail masters" },
  {
    id: "themes",
    label: "Themes",
    hint: "Whole-project looks — color, sync, post and background at once",
  },
  {
    id: "sync",
    label: "Sync",
    hint: "What the visual reacts to, and how hard",
    dividerBefore: true,
  },
  {
    id: "modulation",
    label: "Modulation",
    hint: "Route audio and LFOs onto individual controls",
  },
  {
    id: "scene",
    label: "Scene",
    hint: "Background, frame, finishing and overlay layers",
    dividerBefore: true,
  },
  { id: "text", label: "Text", hint: "Lyrics and the audiogram strip" },
  { id: "live", label: "Live", hint: "Switch quantize and MIDI control", dividerBefore: true },
];

/** A settings section, mapped to a rail page and given a searchable keyword
 * blob. `standalone` sections render their own `.panel-section` (LayersPanel)
 * and are not wrapped in a `PageSection`. */
interface SectionDef {
  /**
   * React key only. It used to be the persisted collapse identity, which is
   * why several ids are pre-v2.53 titles ("Templates" for the Themes
   * section) — P-1 retired in-page section collapse, so nothing reads these
   * off disk any more and they are kept purely to avoid a pointless diff.
   */
  id: string;
  /** Omitted when the page's context header already names the section. */
  title?: string;
  page: InspectorPageId;
  /** Lowercased title + control labels/hints, matched by the search box. */
  search: string;
  headerExtra?: ReactNode;
  body: ReactNode;
  standalone?: boolean;
}

/**
 * One section on a page. The rail is the single navigation model, so a
 * section no longer collapses — it is a plain heading over its body, using
 * the same `.panel-section`/`.section-head`/`.section-title` idiom
 * LayersPanel, BuilderPanel and TimelinePanel already emit.
 */
function PageSection(props: { title?: string; headerExtra?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel-section">
      {(props.title || props.headerExtra) && (
        <div className="section-head">
          {props.title && <h3 className="section-title">{props.title}</h3>}
          {props.headerExtra}
        </div>
      )}
      {props.children}
    </section>
  );
}

/** "3 active routes" / "1 active route" — badge titles are spoken, so they
 * may not read "1 active routes". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The Inspector — the right-hand dock: styles, preset parameters, background,
 * sync, scene, text and live mapping.
 *
 * Store-direct: it subscribes to the ~27 slices it actually reads and
 * re-renders only when one of them changes. It is deliberately NOT memo()d —
 * with zero props memo can never bail on anything, and leaving it there would
 * assert a contract nothing enforces. The contract that replaced it is
 * SELECTOR GRANULARITY, pinned by ParamsPanel.test.tsx: the 4 Hz playback tick
 * (playback, lufs, stereoWidth) and the per-frame export tick (exporting) must
 * produce ZERO commits here. lufs/bpm/keyName/rendererKind are subscribed
 * inside <PanelFooterBadges />, which is the only thing that reads them.
 * Never allocate inside a selector (lint enforces it; the failure mode is a
 * crash, not a slowdown).
 *
 * P-1: ONE navigation model. The five tabs and the per-section collapse are
 * both gone, replaced by a vertical rail of eight destinations
 * (INSPECTOR_PAGES) that each render their sections as a page. The search box
 * spans the whole dock and bypasses the rail entirely — results cross pages.
 * The active page persists as `inspectorPage`. */
export function ParamsPanel() {
  // ── READS: one hook per field. A selector MUST return a store-owned
  // reference or a primitive — never an object literal, array literal, spread
  // or .filter/.map/.slice. zustand v5 hands the selector straight to
  // useSyncExternalStore with no equality fn, so an allocating one is
  // "Maximum update depth exceeded" ON MOUNT: a white screen, not a slow
  // render. The shared derivations live in state/selectors.ts; lint blocks
  // the allocating shapes at author time.
  const preset = useVizStore(selectPreset);
  const params = useVizStore((s) => s.activeParams);
  const bg = useVizStore(selectEffectiveBg);
  const bgPerMode = useVizStore(selectBgPerMode);
  const centerImageName = useVizStore(selectCenterImageName);
  const videoBgLoading = useVizStore((s) => s.videoBgLoading);
  const sync = useVizStore((s) => s.sync);
  const analysisSampleRate = useVizStore((s) => s.analysisSampleRate);
  const simplifiedRenderer = useVizStore((s) => s.simplifiedRenderer);
  const aspect = useVizStore((s) => s.aspect);
  const userPresets = useVizStore((s) => s.userPresets);
  const presetId = useVizStore((s) => s.presetId);
  const hasCoverArt = useVizStore(selectHasCoverArt);
  const smoothSpectrum = useVizStore((s) => s.smoothSpectrum);
  const post = useVizStore((s) => s.post);
  const motion = useVizStore((s) => s.motion);
  const switchQuantize = useVizStore((s) => s.switchQuantize);
  const midiEnabled = useVizStore((s) => s.midiEnabled);
  const midiDevices = useVizStore((s) => s.midiDevices);
  const midiBindings = useVizStore((s) => s.midiBindings);
  const midiLearn = useVizStore((s) => s.midiLearn);
  /** Rail badge only. DOCUMENT slice, never a per-frame one: a badge that
   * ticks would put the whole panel back on the render loop (T1–T6). Anything
   * live belongs in <PanelFooterBadges />, which exists for exactly that. */
  const overlayLayers = useVizStore((s) => s.overlayLayers);
  /** The store field is `activeMods`; the retired prop was called `mods`. */
  const mods = useVizStore((s) => s.activeMods);
  const stems = useVizStore((s) => s.stems);
  const stemAnalyzing = useVizStore((s) => s.stemAnalyzing);
  const lyricFileName = useVizStore((s) => s.lyricFileName);
  const lyricStyle = useVizStore((s) => s.lyricStyle);
  const audiogram = useVizStore((s) => s.audiogram);
  /** Read here only for the factory-stack chips' active detection — the
   * Builder editor below subscribes to the same field independently. */
  const builderStack = useVizStore((s) => s.builderStack);

  // ── A DERIVATION THAT ALLOCATES: two selections + useMemo, never a
  // selector. `userPresets.filter(...)` inside one would hand
  // useSyncExternalStore a fresh array on every store notification.
  const looksForMode = useMemo(
    () => userPresets.filter((p) => p.presetId === presetId),
    [userPresets, presetId],
  );

  // ── WRITES: one stable accessor; actions are called at the click site.
  // Actions are built once inside create()'s initializer and every write is a
  // partial merge, so their identity is permanently stable — no useCallback.
  const store = useVizStore.getState;

  // Video backgrounds decode a local file, so the option is desktop-only. The
  // env probe reads fine in the body (LyricsGenPanel.tsx:50 precedent); tests
  // mock the module rather than injecting a boolean.
  const showVideoBg = isTauri();

  // ── UI-LEVEL GUARDS stay in the UI, never in the store action: the raw
  // actions must remain prompt-free for E2E hooks and the generate-replace
  // flow, which asks its own question.

  /** Destructive AND not undoable: user looks live outside the document
   * history (unlike shader delete), so a misclick on the 9-px ✕ destroyed an
   * evening of tuning silently (audit UI-3). */
  const deleteLook = async (id: string) => {
    const s = store();
    const name = s.userPresets.find((p) => p.id === id)?.name;
    if (name === undefined) return;
    const ok = await askConfirm(`Delete the look "${name}"? This can't be undone.`, "Delete look");
    if (ok) s.deleteUserPreset(id);
  };

  /** Destructive clear-all: with the correction editor, loaded lyrics can
   * carry real editing work — never drop them on a stray click. */
  const clearLyricsGuarded = async () => {
    const s = store();
    const n = s.lyrics?.length ?? 0;
    if (n > 0) {
      const ok = await askConfirm(
        `Remove the loaded lyrics (${n} line${n === 1 ? "" : "s"})? Unsaved edits are lost.`,
        "Remove lyrics",
      );
      if (!ok) return;
    }
    s.clearLyrics();
  };

  const importLyrics = (f: File) => void f.text().then((t) => store().loadLyricsText(f.name, t));

  const [showAdvanced, setShowAdvanced] = useState(() => getPrefs().advancedOpen);
  const [hint, setHint] = useState<string | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [lookName, setLookName] = useState("");
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [themeAuthor, setThemeAuthor] = useState("");
  const [midiParam, setMidiParam] = useState("");
  const [page, setPage] = useState<InspectorPageId>(() => getPrefs().inspectorPage);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>(() => getPrefs().collapsedSections);
  const railRef = useRef<HTMLElement | null>(null);
  const changePage = (p: InspectorPageId) => {
    setPage(p);
    setPrefs({ inspectorPage: p });
  };
  /** Collapse state for one param group, persisted as GROUP_KEY + id — since
   * P-1 retired section collapse, that prefix is the whole meaning of
   * `collapsedSections` (prefs prunes anything else on read). */
  const toggleGroup = (groupId: string, open: boolean) => {
    const key = GROUP_KEY + groupId;
    // Plain value + setPrefs OUTSIDE the setState updater: React re-runs
    // updaters in the render phase (StrictMode always does), and a setPrefs
    // there notifies App's useSyncExternalStore mid-render — the "Cannot
    // update a component (App)" dev warning. Computing from the current
    // snapshot is safe: toggles arrive one click at a time.
    const next = open
      ? collapsed.filter((t) => t !== key)
      : collapsed.includes(key)
        ? collapsed
        : [...collapsed, key];
    setCollapsed(next);
    setPrefs({ collapsedSections: next });
  };
  /**
   * Roving tabindex: the rail is ONE tab stop, not eight. Arrows move AND
   * activate (follow-focus, wrapping at the ends), Home/End jump to the
   * first/last destination. Without this, reaching any page control costs
   * eight tab presses — a real regression against the 5-button Segmented the
   * rail replaces.
   */
  const onRailKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    // Read from the DOM rather than an index: the search item shares the rail
    // and must never be a wrap-around target.
    const items = railRef.current
      ? [
          ...railRef.current.querySelectorAll<HTMLButtonElement>(
            'button.rail-item[data-section]:not([data-section="search"])',
          ),
        ]
      : [];
    if (items.length === 0) return;
    const here = items.indexOf(e.currentTarget);
    const at =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : e.key === "ArrowDown"
            ? (here + 1 + items.length) % items.length
            : (here - 1 + items.length) % items.length;
    const next = items[at];
    next.focus();
    changePage(next.dataset.section as InspectorPageId);
  };
  const setAdvanced = (on: boolean) => {
    setShowAdvanced(on);
    setPrefs({ advancedOpen: on });
  };
  const postChanged = (Object.keys(DEFAULT_POST) as Array<keyof PostSettings>).some(
    (k) => post[k] !== DEFAULT_POST[k],
  );
  const motionChanged = (Object.keys(DEFAULT_MOTION) as Array<keyof MotionSettings>).some(
    (k) => motion[k] !== DEFAULT_MOTION[k],
  );
  const advanced = preset.advanced ?? [];
  const changedCount = advanced.filter((p) => (params[p.key] ?? p.default) !== p.default).length;
  const spectrumInfo = spectrumDiagnostics(sync, analysisSampleRate);
  const resolutionLabel = (resolution: SpectrumResolution) =>
    `${Math.round(
      spectrumDiagnostics({ ...sync, spectrumResolution: resolution }, analysisSampleRate).windowMs,
    )} ms`;
  const resolutionLatency = (resolution: SpectrumResolution) =>
    `≈${Math.round(
      spectrumDiagnostics({ ...sync, spectrumResolution: resolution }, analysisSampleRate)
        .latencyMs,
    )} ms visual latency`;

  // Which global masters actually move THIS mode — used to hide inert sliders
  // (e.g. Rotation on a mode that can't spin, Detail on a non-discrete mode).
  const caps = presetMasters(preset);
  const showMotion = caps.rotation || caps.pulse || caps.detail;

  // One sentence, reused by every control the Canvas2D fallback cannot honour
  // (F1). `undefined` on the normal WebGPU path, which is what leaves those
  // controls with their own hints and their own enabled behaviour — the
  // fallback must cost the 99% of users nothing.
  const unavailable = simplifiedRenderer
    ? "Unavailable right now: hardware rendering (WebGPU) isn't available on this system, and the simplified renderer can't draw this"
    : undefined;

  // A style is "active" when current params exactly equal defaults + values
  const defaults = defaultParams(preset);
  const activeStyle = (preset.styles ?? []).find((s) => {
    const merged = { ...defaults, ...s.values };
    return Object.keys(merged).every((k) => (params[k] ?? defaults[k]) === merged[k]);
  });
  const activeStyleId = activeStyle?.id;
  /** The context header's second line. A mode that ships no styles has no
   * "Custom" to be — only a mode WITH styles can be off all of them. */
  const hasStyles = (preset.styles?.length ?? 0) > 0;

  // ── RAIL DATA. Dimmed-not-hidden (F1): an unavailable destination stays
  // focusable and clickable, says why on hover, and explains itself again on
  // the page you land on.
  const pageUnavailable: Partial<Record<InspectorPageId, string>> = showMotion
    ? {}
    : { motion: "This visual has no rotation, pulse or detail masters" };
  /** Counts from the DOCUMENT, shown when > 0. The pill is aria-hidden so
   * accessible names stay exactly the rail label; the count is spoken through
   * the button's title instead. */
  const pageBadge: Partial<Record<InspectorPageId, number>> = {
    modulation: mods.length,
    scene: overlayLayers.length,
    live: midiBindings.length,
  };
  const pageBadgeTitle: Partial<Record<InspectorPageId, string>> = {
    modulation:
      mods.length > 0
        ? `Modulation — ${plural(mods.length, "active route", "active routes")}`
        : undefined,
    scene:
      overlayLayers.length > 0
        ? `Scene — ${plural(overlayLayers.length, "overlay layer", "overlay layers")}`
        : undefined,
    live:
      midiBindings.length > 0
        ? `Live — ${plural(midiBindings.length, "MIDI binding", "MIDI bindings")}`
        : undefined,
  };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  // Every word of every knob — label, hint, key and enum choices — plus the
  // names of the groups they sit in. The old blob carried labels only, so
  // searching a hint's wording ("monstercat", "letterbox") found nothing even
  // though the row was right there.
  const presetParamText = allParams(preset).map(paramSearchText).join(" ");
  /** Every knob of this visual, grouped — reused by the panel's own layout
   * search blob and by the Modulation/MIDI target dropdowns. */
  const paramGroupViews = groupParams(preset, allParams(preset));
  const presetGroupText = paramGroupViews.map((g) => g.group.label).join(" ");
  // What modulation and MIDI may drive: mod:"off" params (pure toggles and
  // mode-choice enums, RP-2) are not targets, so neither picker offers them.
  const modTargetGroupViews = groupParams(preset, allParams(preset).filter(isModTarget));
  const firstModTarget = modTargetGroupViews[0]?.params[0]?.key ?? "";

  /** The centre-image picker belongs with the Image knobs it affects. */
  const centerImageExtras: ParamGroupExtra[] = preset.params.some((p) => p.key === "cover")
    ? [
        {
          group: "image",
          search: "center image cover art album artwork choose custom picture",
          node: (
            <div
              className="row center-image-row"
              title="What this mode draws in its center: the track's embedded cover art, or any image you choose"
            >
              <span className="row-label">Center image</span>
              <span className="center-image-value">{centerImageName ?? "Track cover art"}</span>
              <button
                className="text-btn"
                title="Choose a custom image for this mode's center"
                onClick={() => void store().pickCenterImage()}
              >
                Choose…
              </button>
              {centerImageName && (
                <button
                  className="text-btn"
                  title="Back to the track's embedded cover art"
                  onClick={() => store().clearCenterImage()}
                >
                  ✕
                </button>
              )}
            </div>
          ),
        },
      ]
    : [];

  const sections: SectionDef[] = [
    // ---------------- Mode ----------------
    {
      // React key only now. No `title`: the page's context header already
      // names the mode, and a second copy would both read as a stutter and
      // make getByText(preset.name) ambiguous.
      id: preset.id,
      page: "mode",
      search:
        `${preset.name} ${preset.description ?? ""} preset style look custom save import gallery browse advanced essentials reset center image cover ${presetGroupText} ${presetParamText}`.toLowerCase(),
      headerExtra: (
        <button
          className="text-btn"
          onClick={() => store().resetParams()}
          title="Back to factory defaults (all controls incl. advanced)"
        >
          Reset
        </button>
      ),
      body: (
        <>
          {preset.description && <p className="preset-desc">{preset.description}</p>}

          {(preset.styles?.length ?? 0) > 0 && (
            <div className="style-chips">
              {preset.styles!.map((s) => (
                <button
                  key={s.id}
                  className={`style-chip ${s.id === activeStyleId ? "active" : ""}`}
                  title={`Apply the "${s.name}" look`}
                  onClick={() => store().applyStyle(s.values)}
                >
                  {s.name}
                </button>
              ))}
              {!activeStyleId && <span className="style-custom">Custom</span>}
            </div>
          )}

          <div className="user-presets">
            {looksForMode.length > 0 && (
              <div className="style-chips">
                {looksForMode.map((p) => (
                  <span key={p.id} className="user-chip-wrap">
                    <button
                      className="style-chip user"
                      title={`Apply your "${p.name}" look`}
                      onClick={() => store().applyUserPreset(p.id)}
                    >
                      {p.name}
                    </button>
                    <button
                      className="chip-x"
                      title={`Delete "${p.name}"`}
                      aria-label={`Delete "${p.name}"`}
                      onClick={() => void deleteLook(p.id)}
                    >
                      ✕
                    </button>
                    <button
                      className="chip-x"
                      title={`Export "${p.name}" as .bfpreset file`}
                      aria-label={`Export "${p.name}" as .bfpreset file`}
                      onClick={() => void store().exportUserPreset(p.id)}
                    >
                      ↗
                    </button>
                  </span>
                ))}
              </div>
            )}
            {savingLook ? (
              <form
                className="save-look-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  store().saveUserPreset(lookName);
                  setLookName("");
                  setSavingLook(false);
                }}
              >
                <input
                  className="look-name-input"
                  autoFocus
                  placeholder="Name this look…"
                  value={lookName}
                  maxLength={32}
                  onChange={(e) => setLookName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSavingLook(false);
                      setLookName("");
                    }
                  }}
                />
                <button type="submit" className="text-btn" disabled={!lookName.trim()}>
                  Save
                </button>
              </form>
            ) : (
              <div className="save-look-row">
                <button
                  className="text-btn"
                  title="Save the current values as a named look for this visual"
                  onClick={() => setSavingLook(true)}
                >
                  + Save look
                </button>
                <button
                  className="text-btn"
                  title="Import a .bfpreset look file"
                  onClick={() => void store().importUserPreset()}
                >
                  Import…
                </button>
                <GalleryLink filter="look">Browse looks in the Gallery…</GalleryLink>
              </div>
            )}
          </div>

          {/* Density, not a drawer. "Advanced" used to be a second flat list
              bolted under the first; as one switch over the SAME grouped view
              it stays one mental model — every knob is always in the group it
              belongs to, you only choose how many of them you see. Search
              ignores it entirely (see ParamGroups). */}
          {advanced.length > 0 && (
            <div className="param-density">
              <Segmented
                value={showAdvanced ? 1 : 0}
                onChange={(v) => setAdvanced(v === 1)}
                onHint={setHint}
                ariaLabel="Control detail"
                options={[
                  {
                    value: 0,
                    label: "Essentials",
                    hint: `The ${preset.params.length} knobs that shape this visual most`,
                  },
                  {
                    value: 1,
                    label: "All",
                    hint: `Every knob, including the ${advanced.length} expert constants`,
                  },
                ]}
              />
              {changedCount > 0 && (
                <span
                  className="advanced-count"
                  title="Expert knobs that no longer sit at their factory value"
                >
                  {changedCount} changed
                </span>
              )}
            </div>
          )}

          {/* Builder (RP-20): its virtual l<i>.* params exist for the
              modulation/MIDI/automation target lists, NOT for a second knob
              surface — BuilderPanel below stays the one editor, so the
              generic grouped rows are suppressed here (locked UI decision). */}
          {preset.id !== BUILDER2_ID && (
            <ParamGroups
              preset={preset}
              params={params}
              onParam={(key, value) => store().setParam(key, value)}
              onHint={setHint}
              showAdvanced={showAdvanced}
              query={q}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
              extras={centerImageExtras}
            />
          )}
        </>
      ),
    },
    ...(preset.id === BUILDER2_ID
      ? [
          {
            id: "Builder layers",
            title: "Builder layers",
            page: "mode" as const,
            search:
              `builder layer stack compositor blend add screen opacity hue spread factory ${BUILDER_FACTORY_STACKS.map((f) => f.name).join(" ")} ${BUILDER_LAYER_TYPES.map((t) => t.label).join(" ")}`.toLowerCase(),
            standalone: true,
            body: simplifiedRenderer ? (
              // The whole stack compiles to WGSL, so there is nothing here the
              // fallback can render — showing the editor would invite edits
              // that change the picture not at all (F1).
              <div className="panel-section" title={unavailable}>
                <p className="section-hint">
                  Builder Studio compiles its layer stack to a GPU shader, so it needs hardware
                  rendering (WebGPU). Your saved stack is untouched and will render again on a
                  system that has it.
                </p>
              </div>
            ) : (
              <>
                {/* Factory stacks (RP-20): whole curated stacks, structural —
                    Builder's stand-in for the style chips every other visual
                    has. Applied copies get fresh layer ids; active detection
                    compares structure + values, ids ignored. */}
                <div className="panel-section builder-factory-chips">
                  <div className="style-chips">
                    {BUILDER_FACTORY_STACKS.map((f) => {
                      const active = sameStackValues(builderStack, f.stack);
                      return (
                        <button
                          key={f.id}
                          className={`style-chip ${active ? "active" : ""}`}
                          title={`Apply the "${f.name}" layer stack`}
                          onClick={() => store().setBuilderStack(copyBuilderStack(f.stack))}
                        >
                          {f.name}
                        </button>
                      );
                    })}
                    {!BUILDER_FACTORY_STACKS.some((f) =>
                      sameStackValues(builderStack, f.stack),
                    ) && <span className="style-custom">Custom</span>}
                  </div>
                </div>
                <BuilderPanel onHint={setHint} />
              </>
            ),
          } satisfies SectionDef,
        ]
      : []),
    ...(showMotion
      ? [
          {
            id: "Motion",
            title: "Global motion",
            page: "motion" as const,
            search: "motion rotation pulse detail spin global",
            headerExtra:
              motionChanged && !simplifiedRenderer ? (
                <button
                  className="text-btn"
                  title="Back to normal motion (100% everywhere)"
                  onClick={() => store().setMotion({ ...DEFAULT_MOTION })}
                >
                  Reset
                </button>
              ) : undefined,
            body: (
              <>
                {caps.rotation && (
                  <SliderRow
                    label="Rotation"
                    hint="Global spin master — 0% stops all rotation, 100% = normal, up to 200%"
                    min={0}
                    max={2}
                    step={0.05}
                    value={motion.rotation}
                    onChange={(v) => store().setMotion({ rotation: v })}
                    format={PERCENT}
                    onHint={setHint}
                    disabledReason={unavailable}
                  />
                )}
                {caps.pulse && (
                  <SliderRow
                    label="Pulse"
                    hint="Global pulse master — 0% removes beat pumping, 100% = normal, up to 200%"
                    min={0}
                    max={2}
                    step={0.05}
                    value={motion.pulse}
                    onChange={(v) => store().setMotion({ pulse: v })}
                    format={PERCENT}
                    onHint={setHint}
                    disabledReason={unavailable}
                  />
                )}
                {caps.detail && (
                  <SliderRow
                    label="Detail"
                    hint="Detail — how many bars / points / segments this mode draws"
                    min={0}
                    max={1}
                    step={0.02}
                    value={motion.detail}
                    onChange={(v) => store().setMotion({ detail: v })}
                    format={PERCENT}
                    onHint={setHint}
                    disabledReason={unavailable}
                  />
                )}
                <p className="section-hint">
                  {simplifiedRenderer
                    ? "The motion masters drive the visual's own shader, so they need hardware rendering (WebGPU). Your values are kept and apply again where it is available."
                    : "Global motion for this mode — exports match."}
                </p>
              </>
            ),
          } satisfies SectionDef,
        ]
      : []),
    {
      // The id keeps the retired pre-vocabulary title (see SectionDef.id):
      // collapse state persisted as "Templates" must keep applying to this
      // section now that it reads THEMES.
      id: "Templates",
      title: "Themes",
      page: "themes",
      search:
        `themes theme templates complete looks colors sync post save export import bftheme gallery community browse ${FACTORY_THEMES.map((t) => t.meta.name).join(" ")}`.toLowerCase(),
      body: (
        <>
          <p className="section-hint">
            Complete looks — visual, colors, sync, post — in one click. Drop any .bftheme file onto
            the window to import; save yours to share.
          </p>
          <div className="style-chips">
            {FACTORY_THEMES.map((t) => (
              <button
                key={t.meta.name}
                className="style-chip"
                title={`${t.meta.description ?? ""}${t.meta.bpmHint ? ` (~${t.meta.bpmHint[0]}-${t.meta.bpmHint[1]} BPM)` : ""}`}
                onClick={() => store().applyTheme(t.document, t.meta.name)}
              >
                {t.meta.name}
              </button>
            ))}
          </div>
          {savingTheme ? (
            <form
              className="save-look-row"
              onSubmit={(e) => {
                e.preventDefault();
                void store().exportCurrentTheme({
                  name: themeName.trim(),
                  author: themeAuthor.trim() || "anonymous",
                  license: "CC0-1.0",
                });
                setSavingTheme(false);
                setThemeName("");
              }}
            >
              <input
                className="look-name-input"
                autoFocus
                placeholder="Theme name…"
                value={themeName}
                maxLength={80}
                onChange={(e) => setThemeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSavingTheme(false);
                }}
              />
              <input
                className="look-name-input"
                placeholder="Your name…"
                value={themeAuthor}
                maxLength={60}
                onChange={(e) => setThemeAuthor(e.target.value)}
              />
              <button type="submit" className="text-btn" disabled={!themeName.trim()}>
                Save
              </button>
            </form>
          ) : (
            <div className="save-look-row">
              <button
                className="text-btn"
                title="Save EVERYTHING currently set up (visual, layers, timeline, post) as a shareable .bftheme file (CC0)"
                onClick={() => setSavingTheme(true)}
              >
                + Save as theme…
              </button>
            </div>
          )}
          <div className="save-look-row">
            <GalleryLink filter="theme">Browse themes in the Gallery…</GalleryLink>
          </div>
        </>
      ),
    },
    // ---------------- Sync ----------------
    {
      id: "Sync",
      title: "Sync",
      page: "sync",
      search:
        "sync react kick energy bass melody voice treble snare hats smoothing attack release spectrum smooth curve merge rounding contrast monstercat flatten shape frequency range low high edge hz analyzer resolution fft measured bins interpolation linear logarithmic",
      body: (
        <>
          <div className="sync-grid">
            {SYNC_OPTIONS.map((o) => (
              <button
                key={o.mode}
                className={`segment ${sync.mode === o.mode ? "active" : ""}`}
                title={o.hint}
                onPointerEnter={() => setHint(o.hint)}
                onPointerLeave={() => setHint(null)}
                onFocus={() => setHint(o.hint)}
                onBlur={() => setHint(null)}
                onClick={() => store().setSync({ ...sync, mode: o.mode })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <SliderRow
            label="Smoothing"
            hint="Overall response — 0 = punchy, 1 = long glides. Sets attack + release together"
            min={0}
            max={1}
            step={0.01}
            value={sync.smooth}
            onChange={(v) =>
              store().setSync({ ...sync, smooth: v, attack: undefined, release: undefined })
            }
            onHint={setHint}
          />
          <SliderRow
            label="Attack"
            hint="Attack — how fast the reaction rises on a hit (0 = instant, 1 = slow)"
            min={0}
            max={1}
            step={0.01}
            value={sync.attack ?? sync.smooth}
            onChange={(v) => store().setSync({ ...sync, attack: v })}
            onHint={setHint}
          />
          <SliderRow
            label="Release"
            hint="Release — how slowly the reaction falls after a hit (0 = instant, 1 = long)"
            min={0}
            max={1}
            step={0.01}
            value={sync.release ?? sync.smooth}
            onChange={(v) => store().setSync({ ...sync, release: v })}
            onHint={setHint}
          />
          {caps.spectrumSmooth && (
            <>
              <SliderRow
                label="Spectrum smooth"
                hint="Rounds the spectrum from hard bins toward a flowing curve"
                min={0}
                max={1}
                step={0.02}
                value={motion.spectrumSmooth}
                onChange={(v) => store().setMotion({ spectrumSmooth: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <ToggleRow
                label="Smooth curve"
                hint="Spline-smoothed spectrum: curves instead of corners"
                checked={smoothSpectrum}
                onChange={(v) => store().setSmoothSpectrum(v)}
                onHint={setHint}
              />
              <div className="row">
                <span className="row-label">Resolution</span>
                <div style={{ flex: 1 }}>
                  <Segmented
                    value={sync.spectrumResolution ?? "responsive"}
                    onChange={(spectrumResolution) =>
                      store().setSync({ ...sync, spectrumResolution })
                    }
                    onHint={setHint}
                    ariaLabel="Drawn spectrum resolution"
                    options={(["responsive", "detailed", "precise"] as const).map((value) => ({
                      value,
                      label: resolutionLabel(value),
                      hint:
                        value === "responsive"
                          ? `Fastest response; existing 85 ms-class display window (${resolutionLatency(value)})`
                          : `Longer display-only FFT: finer low-frequency detail (${resolutionLatency(value)})`,
                    }))}
                  />
                </div>
              </div>
              <div className="row">
                <span className="row-label">Axis</span>
                <div style={{ flex: 1 }}>
                  <Segmented
                    value={
                      sync.spectrumSampling === "measured" ? "linear" : (sync.spectrumAxis ?? "log")
                    }
                    onChange={(spectrumAxis) => store().setSync({ ...sync, spectrumAxis })}
                    disabled={sync.spectrumSampling === "measured"}
                    onHint={setHint}
                    ariaLabel="Spectrum frequency axis"
                    options={[
                      {
                        value: "log" as const,
                        label: "Musical",
                        hint: "Log axis: equal width per octave; display bands are resampled",
                      },
                      {
                        value: "linear" as const,
                        label: "Linear",
                        hint: "Linear hertz axis: equal frequency width across the frame",
                      },
                    ]}
                  />
                </div>
              </div>
              <div className="row">
                <span className="row-label">Sampling</span>
                <div style={{ flex: 1 }}>
                  <Segmented
                    value={sync.spectrumSampling ?? "interpolated"}
                    onChange={(spectrumSampling) => store().setSync({ ...sync, spectrumSampling })}
                    onHint={setHint}
                    ariaLabel="Spectrum sampling"
                    options={[
                      {
                        value: "interpolated" as const,
                        label: "96 bands",
                        hint: "Keep 96 bars by resampling FFT data into display bands",
                      },
                      {
                        value: "measured" as const,
                        label: "FFT bins",
                        hint: "Read integer FFT bins only; no interpolation, linear axis, fewer bars when physics provides fewer",
                      },
                    ]}
                  />
                </div>
              </div>
              <p className="section-hint">
                {Math.round(spectrumInfo.windowMs)} ms window · ≈
                {Math.round(spectrumInfo.latencyMs)} ms visual latency ·{" "}
                {spectrumInfo.hzPerBin.toFixed(2)}
                Hz/bin · {spectrumInfo.nativeBins} native bins in range ·{" "}
                {spectrumInfo.measured
                  ? `${spectrumInfo.displayBins} measured bars, no interpolation`
                  : `${spectrumInfo.displayBins} display bands`}
                . Detector timing stays on responsive resolution.
              </p>
              <SliderRow
                label="Merge"
                hint="Bars prop up their neighbors (Monstercat-style) — melts lone spikes into one connected shape"
                min={0}
                max={1}
                step={0.01}
                value={sync.shapeMerge ?? 0}
                onChange={(v) => store().setSync({ ...sync, shapeMerge: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <SliderRow
                label="Rounding"
                hint="Averages neighboring bars before drawing — real smoothing that removes spikes, not just curved corners"
                min={0}
                max={1}
                step={0.01}
                value={sync.shapeRound ?? 0}
                onChange={(v) => store().setSync({ ...sync, shapeRound: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <SliderRow
                label="Contrast"
                hint="Below 50% flattens the spectrum (fuller, calmer bars); above 50% exaggerates peaks vs valleys"
                min={0}
                max={1}
                step={0.01}
                value={sync.contrast ?? 0.5}
                onChange={(v) => store().setSync({ ...sync, contrast: v })}
                format={PERCENT}
                onHint={setHint}
              />
              <SliderRow
                label="Low edge"
                hint="Lowest frequency the bars cover — raise it to stop spending bars on sub-bass the track doesn't have"
                min={10}
                max={500}
                step={1}
                value={sync.freqMin ?? MIN_FREQ}
                onChange={(v) =>
                  store().setSync({
                    ...sync,
                    freqMin: v,
                    freqMax: sync.freqMax ?? MAX_FREQ,
                  })
                }
                format={HERTZ}
                onHint={setHint}
              />
              <SliderRow
                label="High edge"
                hint="Highest frequency the bars cover — lower it to give the musical range more of the width"
                min={200}
                max={22050}
                step={50}
                value={sync.freqMax ?? MAX_FREQ}
                onChange={(v) =>
                  store().setSync({
                    ...sync,
                    freqMin: sync.freqMin ?? MIN_FREQ,
                    freqMax: v,
                  })
                }
                format={KILOHERTZ}
                onHint={setHint}
              />
            </>
          )}
          <p className="section-hint">
            What this visual reacts to. Saved per mode; exports use it too.
          </p>
        </>
      ),
    },
    {
      // ---------------- Modulation ----------------
      // Its own destination as of P-1. It spent four releases as a "+ Route"
      // link at the bottom of Sync, where nobody found it.
      id: "Modulation",
      title: "Modulation",
      page: "modulation",
      search:
        "modulation route stem source amount kick hats auto-route feature knob lfo sine saw square curve shape exp smooth attack release lag recipe punch swell sway sweep sparkle",
      body: (
        <>
          {mods.length === 0 && (
            <p className="section-hint">
              Route any audio feature to any knob of this visual — kick pumps the zoom, hats flicker
              the glow. Applied in exports identically.
            </p>
          )}
          <div className="save-look-row">
            {stems.map((st) => (
              <span key={st.slot} className="user-chip-wrap">
                <span
                  className="style-chip user"
                  title="Imported stem — its bands appear as modulation sources"
                >
                  {st.analysis.name}
                </span>
                <button
                  className="chip-x"
                  title="Auto-route: wire this stem's kick/bass/snare/hats/mids to the best-matching knobs of this visual"
                  aria-label={`Auto-route ${st.analysis.name}`}
                  onClick={() => store().autoRouteStem(st.slot)}
                >
                  ✦
                </button>
                <button
                  className="chip-x"
                  title="Remove this stem (routes to it go inert)"
                  aria-label={`Remove ${st.analysis.name} stem`}
                  onClick={() => store().removeStem(st.slot)}
                >
                  ✕
                </button>
              </span>
            ))}
            {stemAnalyzing ? (
              <span className="section-hint">Analyzing {stemAnalyzing}…</span>
            ) : (
              stems.length < MAX_STEMS && (
                <label
                  className="text-btn"
                  title="Import a stem (drums/bass/vocals bounced from 0:00) — analyzed once, never played; its bands become modulation sources"
                >
                  + Add stem…
                  <input
                    type="file"
                    accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void store().addStem(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )
            )}
          </div>
          {/* Route recipes (P-7): curated one-or-two-route starting points.
              A chip ADDS plain routes targeting this visual's best-matching
              knobs — from there they're ordinary rows to tweak or delete. */}
          <div className="style-chips">
            {MOD_ROUTE_RECIPES.map((rec) => (
              <button
                key={rec.id}
                className="style-chip"
                title={rec.hint}
                onClick={() => store().applyModRouteRecipe(rec.id)}
              >
                {rec.name}
              </button>
            ))}
          </div>
          {mods.map((r) => (
            <Fragment key={r.id}>
              <div className="mod-row">
                <select
                  className="select mod-select"
                  value={r.source}
                  title="What drives this route"
                  onChange={(e) =>
                    store().updateModRoute(r.id, { source: e.target.value as ModSource })
                  }
                >
                  {MOD_SOURCES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                  {stems.map((st) =>
                    STEM_TRACK_KEYS.map((k) => (
                      <option key={`${st.slot}:${k}`} value={`${st.slot}:${k}`}>
                        {st.analysis.name}: {k}
                      </option>
                    )),
                  )}
                  {/* Beat-locked LFOs: pure functions of track time and the beat
                    grid (falls back to a 120-BPM clock before analysis). */}
                  <optgroup label="LFO — beat-synced">
                    {LFO_SOURCES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <span className="mod-arrow">→</span>
                <select
                  className="select mod-select"
                  value={r.param}
                  title="Which knob it moves"
                  onChange={(e) => store().updateModRoute(r.id, { param: e.target.value })}
                >
                  {/* Grouped by the SAME ParamSpec.group the panel lays out, so
                    a 35-knob visual reads as eight short lists instead of one
                    unsearchable run of options. */}
                  {modTargetGroupViews.map(({ group, params }) => (
                    <optgroup key={group.id} label={group.label}>
                      {params.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {/* A route saved before a param went mod:"off" (or whose param
                    this preset lacks) still needs a visible, selected option —
                    silently snapping the select to the first entry would
                    rewrite the route on the next unrelated edit. Such routes
                    are inert in applyMods. */}
                  {r.param.length > 0 &&
                    !r.param.startsWith(POST_TARGET_PREFIX) &&
                    !modTargetGroupViews.some(({ params }) =>
                      params.some((p) => p.key === r.param),
                    ) && <option value={r.param}>{`${r.param} (not modulatable)`}</option>}
                  {/* Post targets are namespaced ("post:chromatic") so they can
                    live in the same route list as preset params — animating
                    the post chain was a direct user request. */}
                  <optgroup label="Post-processing">
                    {POST_MOD_TARGETS.map((p) => (
                      <option key={p.key} value={`${POST_TARGET_PREFIX}${p.key}`}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <SliderField
                  label={`${r.source} to ${r.param} amount`}
                  min={-1}
                  max={1}
                  step={0.01}
                  value={r.amount}
                  onChange={(amount) => store().updateModRoute(r.id, { amount })}
                />
                <button
                  className="chip-x"
                  title="Remove route"
                  aria-label={`Remove ${r.source} to ${r.param} modulation route`}
                  onClick={() => store().removeModRoute(r.id)}
                >
                  ✕
                </button>
              </div>
              {/* Shape row (P-16): response curve + attack/release lag. All
                optional — Linear + 0/0 is exactly the classic instant route,
                and the patches write `undefined` then so untouched routes
                keep their v1 shape in saved documents. */}
              <div className="mod-row mod-shape-row">
                <select
                  className="select mod-select"
                  value={r.curve ?? "linear"}
                  title="Response curve on the source before the amount — Exp emphasizes peaks, Smooth eases both ends"
                  onChange={(e) =>
                    store().updateModRoute(r.id, {
                      curve: e.target.value === "linear" ? undefined : (e.target.value as ModCurve),
                    })
                  }
                >
                  <option value="linear">Linear</option>
                  <option value="exp">Exp</option>
                  <option value="smooth">Smooth</option>
                </select>
                <span
                  className="mod-arrow"
                  title="Attack — how long the route takes to rise, seconds"
                >
                  A
                </span>
                <SliderField
                  label={`${r.source} to ${r.param} attack seconds`}
                  min={0}
                  max={2}
                  step={0.01}
                  value={r.attack ?? 0}
                  onChange={(v) =>
                    store().updateModRoute(r.id, { attack: v === 0 ? undefined : v })
                  }
                />
                <span
                  className="mod-arrow"
                  title="Release — how long the route takes to fall, seconds"
                >
                  R
                </span>
                <SliderField
                  label={`${r.source} to ${r.param} release seconds`}
                  min={0}
                  max={2}
                  step={0.01}
                  value={r.release ?? 0}
                  onChange={(v) =>
                    store().updateModRoute(r.id, { release: v === 0 ? undefined : v })
                  }
                />
              </div>
            </Fragment>
          ))}
          <div className="save-look-row">
            <button
              className="text-btn"
              title="Add a feature-to-knob route"
              onClick={() => store().addModRoute("kick", firstModTarget)}
            >
              + Route
            </button>
          </div>
        </>
      ),
    },
    // ---------------- Scene ----------------
    {
      id: "Background",
      title: "Background",
      page: "scene",
      search:
        "background animated solid transparent image video color dim blur album art chroma green magenta keying per-mode this mode scope override fit fill contain stretch cover crop letterbox zoom pan align position offset x y",
      body: (
        <>
          <Segmented
            value={bgPerMode ? 1 : 0}
            onHint={setHint}
            ariaLabel="Background scope"
            options={[
              {
                value: 0,
                label: "All modes",
                hint: "One background shared by every visual mode (the default)",
              },
              {
                value: 1,
                label: "This mode",
                hint: `Give ${preset.name} its own background — other modes keep the shared one`,
              },
            ]}
            onChange={(v) => store().setBgPerMode(v === 1)}
          />
          <Segmented
            value={bg.mode}
            onHint={setHint}
            ariaLabel="Background mode"
            options={(showVideoBg ? [...BG_OPTIONS_BASE, BG_OPTION_VIDEO] : BG_OPTIONS_BASE).map(
              (o) => ({
                value: o.mode,
                label: o.label,
                // Video frames are uploaded as GPU textures every frame — the
                // simplified renderer has nowhere to put them, and picking Video
                // there used to decode the whole clip and then draw a hue wash
                // that matched nothing the user chose (F9).
                disabled: o.mode === BG_VIDEO && simplifiedRenderer,
                hint: o.mode === BG_VIDEO && unavailable ? unavailable : o.hint,
              }),
            )}
            onChange={(mode) => {
              if (mode === BG_IMAGE && !bg.image) void store().pickBackgroundImage();
              else if (mode === BG_VIDEO && !bg.video) void store().pickVideoBackground();
              else store().setBg({ ...bg, mode });
            }}
          />
          {bg.mode === BG_SOLID && (
            <BgColorRow
              value={bg.color}
              onChange={(color) => store().setBg({ ...bg, color })}
              title="Custom background color"
            />
          )}
          {bg.mode === BG_IMAGE && bg.image && (
            <>
              <div className="save-look-row">
                <button
                  className="text-btn"
                  title="Choose a different image file"
                  onClick={() => void store().pickBackgroundImage()}
                >
                  Choose image…
                </button>
                <button
                  className="text-btn"
                  disabled={!hasCoverArt}
                  title={
                    hasCoverArt
                      ? "Use the loaded track's album art"
                      : "The loaded track has no embedded cover art"
                  }
                  onClick={() => store().useAlbumArtBackground()}
                >
                  Use album art
                </button>
              </div>
              <SliderRow
                label="Dim"
                hint="Darken the image so the visualization stays readable"
                min={0}
                max={0.9}
                step={0.01}
                value={bg.image.dim}
                onChange={(dim) => store().setBg({ ...bg, image: { ...bg.image!, dim } })}
              />
              <SliderRow
                label="Blur"
                hint="Soften the image behind the visualization"
                min={0}
                max={60}
                step={1}
                value={bg.image.blur}
                onChange={(blur) => store().setBg({ ...bg, image: { ...bg.image!, blur } })}
              />
              <BgFitRows
                what="image"
                value={bg.image}
                onChange={(patch) => store().setBg({ ...bg, image: { ...bg.image!, ...patch } })}
                color={bg.color}
                onColor={(color) => store().setBg({ ...bg, color })}
                onHint={setHint}
              />
            </>
          )}
          {bg.mode === BG_VIDEO && (
            <>
              <div className="save-look-row">
                <button
                  className="text-btn"
                  disabled={simplifiedRenderer}
                  title={unavailable ?? "Choose a different video file"}
                  onClick={() => void store().pickVideoBackground()}
                >
                  {videoBgLoading ? "Decoding…" : "Choose video…"}
                </button>
              </div>
              {bg.video && (
                <SliderRow
                  label="Dim"
                  hint="Darken the video so the visualization stays readable (re-decodes)"
                  min={0}
                  max={0.9}
                  step={0.01}
                  value={bg.video.dim}
                  onChange={(dim) => store().setBg({ ...bg, video: { ...bg.video!, dim } })}
                  disabledReason={unavailable}
                />
              )}
              {bg.video && (
                <SliderRow
                  label="Blur"
                  hint="Soften the video behind the visualization (baked once per loop; re-decodes)"
                  min={0}
                  max={60}
                  step={1}
                  value={bg.video.blur}
                  onChange={(blur) => store().setBg({ ...bg, video: { ...bg.video!, blur } })}
                  disabledReason={unavailable}
                />
              )}
              {bg.video && (
                <BgFitRows
                  what="video"
                  value={bg.video}
                  onChange={(patch) => store().setBg({ ...bg, video: { ...bg.video!, ...patch } })}
                  color={bg.color}
                  onColor={(color) => store().setBg({ ...bg, color })}
                  onHint={setHint}
                  disabledReason={unavailable}
                />
              )}
              <p className="section-hint">
                {simplifiedRenderer
                  ? "Video backgrounds upload a frame to the GPU every frame, so they need hardware rendering (WebGPU). This mode currently paints the flat background color instead — pick Animated, Solid or Image."
                  : `A short clip loops behind the visualization (first ${12}s, decoded to a fixed loop). Export selects frames from the same track-time index. Desktop only.`}
              </p>
            </>
          )}
          {bg.mode === BG_TRANSPARENT && (
            <p className="section-hint">
              Preview shows a checkerboard. MP4 exports have no alpha channel — transparent renders
              over black; use solid green/magenta for editor keying.
            </p>
          )}
        </>
      ),
    },
    {
      id: "Frame",
      title: "Frame",
      page: "scene",
      search:
        `frame aspect ratio shape preview export ${ASPECTS.map((a) => a.label).join(" ")} shorts posts`.toLowerCase(),
      body: (
        <>
          <Segmented
            value={aspect}
            onChange={(a) => store().setAspect(a)}
            onHint={setHint}
            ariaLabel="Frame aspect"
            options={ASPECTS.map((a) => ({ value: a.id, label: a.label, hint: a.hint }))}
          />
          <p className="section-hint">
            Frame shape for preview and export — 9:16 for Canvas/Shorts, 1:1 for posts.
          </p>
        </>
      ),
    },
    {
      id: "Post",
      title: "Post",
      page: "scene",
      search:
        `post processing finishing filmic tonemap aces ${POST_SLIDERS.map((r) => r.label).join(" ")}`.toLowerCase(),
      headerExtra:
        postChanged && !simplifiedRenderer ? (
          <button
            className="text-btn"
            title="Turn off all post-processing (neutral)"
            onClick={() => store().setPost({ ...DEFAULT_POST })}
          >
            Reset
          </button>
        ) : undefined,
      body: (
        <>
          <ToggleRow
            label="Filmic tonemap"
            hint="Filmic (ACES) tonemap — cinematic contrast and highlight rolloff"
            checked={post.tonemap}
            onChange={(v) => store().setPost({ tonemap: v })}
            onHint={setHint}
            disabledReason={unavailable}
          />
          {POST_SLIDERS.map((r) => (
            <SliderRow
              key={r.key}
              label={r.label}
              hint={r.hint}
              min={r.min}
              max={r.max}
              step={r.step}
              value={post[r.key]}
              onChange={(v) => store().setPost({ [r.key]: v })}
              onHint={setHint}
              disabledReason={unavailable}
            />
          ))}
          <p className="section-hint">
            {simplifiedRenderer
              ? "The finishing pass runs on the GPU, so it needs hardware rendering (WebGPU). Your values are kept and apply again where it is available."
              : "Finishing pass applied to the whole frame — grain is deterministic from track time in both preview and export."}
          </p>
        </>
      ),
    },
    {
      id: "Layers",
      title: "Layers",
      page: "scene",
      search: "layers text image overlay album art drawn over visuals",
      standalone: true,
      body: <LayersPanel />,
    },
    // ---------------- Text ----------------
    {
      id: "Lyrics",
      title: "Lyrics",
      page: "text",
      search:
        "lyrics lrc srt karaoke position animation slide pop size fade color import timed generate ai whisper local transcribe vocals",
      body: (
        <>
          <div className="save-look-row">
            {lyricFileName ? (
              <span className="user-chip-wrap">
                <span className="style-chip user" title="Loaded timed lyrics">
                  {lyricFileName}
                </span>
                <button
                  className="chip-x"
                  title="Remove lyrics"
                  aria-label="Remove lyrics"
                  onClick={() => void clearLyricsGuarded()}
                >
                  ✕
                </button>
              </span>
            ) : (
              <label
                className="text-btn"
                title="Import timed lyrics (.lrc from any lyrics site, or .srt) — drawn as a karaoke overlay, identical in exports"
              >
                + Import lyrics…
                <input
                  type="file"
                  accept=".lrc,.srt"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importLyrics(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          {lyricFileName && (
            <>
              <ToggleRow
                label="Show"
                hint="Draw the active lyric line over the visual"
                checked={lyricStyle.enabled}
                onChange={(v) => store().setLyricStyle({ enabled: v })}
                onHint={setHint}
              />
              <SelectRow
                label="Position"
                hint="Where the lines sit in the frame"
                value={lyricStyle.position}
                onChange={(position) => store().setLyricStyle({ position })}
                onHint={setHint}
                options={[
                  { value: "bottom" as const, label: "Bottom" },
                  { value: "center" as const, label: "Center" },
                  { value: "top" as const, label: "Top" },
                ]}
              />
              <SelectRow
                label="Animation"
                hint="How each line enters — plain fade, slide up, or a scale pop"
                value={lyricStyle.anim ?? "plain"}
                onChange={(anim) => store().setLyricStyle({ anim })}
                onHint={setHint}
                options={LYRIC_ANIMS.map((a) => ({
                  value: a,
                  label:
                    a === "plain"
                      ? "Plain"
                      : a === "slide"
                        ? "Slide up"
                        : a === "pop"
                          ? "Pop"
                          : "Karaoke",
                }))}
              />
              <SliderRow
                label="Size"
                hint="Lyric text size"
                min={0.5}
                max={2}
                step={0.05}
                value={lyricStyle.size}
                onChange={(v) => store().setLyricStyle({ size: v })}
                onHint={setHint}
              />
              <SliderRow
                label="Fade"
                hint="Cross-fade time between lines, in seconds"
                min={0}
                max={1}
                step={0.05}
                value={lyricStyle.fadeSec}
                onChange={(v) => store().setLyricStyle({ fadeSec: v })}
                onHint={setHint}
              />
              <ColorRow
                label="Color"
                hint="Lyric text color"
                value={lyricStyle.color}
                onChange={(color) => store().setLyricStyle({ color })}
                onHint={setHint}
              />
            </>
          )}
          {!lyricFileName && (
            <p className="section-hint">
              Drop an .lrc or .srt on the window (or import here) — the current line follows the
              music, karaoke-style, live and in every export.
            </p>
          )}
          {/* Local automatic lyrics (FEAT-004): generate an .lrc from the
              loaded track — the result lands exactly where an import would. */}
          {!lyricFileName && <LyricsGenPanel />}
        </>
      ),
    },
    {
      id: "LyricsEdit",
      title: "Edit lyrics",
      page: "text",
      search:
        "edit lyrics correct fix words timing nudge split merge insert delete line word karaoke " +
        "confidence flagged re-align align save lrc export undo redo",
      // Store-connected (LyricsGenPanel idiom): the editor re-renders on its
      // own lyric edits without dragging the whole memoized panel along.
      body: <LyricsEditPanel />,
    },
    {
      id: "Audiogram",
      title: "Audiogram",
      page: "text",
      search: "audiogram progress bar time readout waveform strip position accent podcast reel",
      body: (
        <>
          <p className="section-hint">
            Overlay elements driven by the track — a progress bar, a time readout, a mini-waveform
            strip. The podcast/reel look; drawn identically in exports.
          </p>
          <ToggleRow
            label="Progress bar"
            hint="A thin played/remaining bar driven by the track position"
            checked={audiogram.progressBar}
            onChange={(v) => store().setAudiogram({ progressBar: v })}
            onHint={setHint}
          />
          <ToggleRow
            label="Time readout"
            hint="Elapsed / total time, drawn as text"
            checked={audiogram.timeReadout}
            onChange={(v) => store().setAudiogram({ timeReadout: v })}
            onHint={setHint}
          />
          <ToggleRow
            label="Waveform strip"
            hint="A mini waveform overview with a moving playhead"
            checked={audiogram.waveformStrip}
            onChange={(v) => store().setAudiogram({ waveformStrip: v })}
            onHint={setHint}
          />
          {(audiogram.progressBar || audiogram.timeReadout || audiogram.waveformStrip) && (
            <>
              <SelectRow
                label="Position"
                hint="Which edge of the frame the audiogram elements sit against"
                value={audiogram.position}
                onChange={(position) => store().setAudiogram({ position })}
                onHint={setHint}
                options={[
                  { value: "bottom" as const, label: "Bottom" },
                  { value: "top" as const, label: "Top" },
                ]}
              />
              <ColorRow
                label="Accent"
                hint="Bar fill, playhead and played-waveform color"
                value={audiogram.color}
                onChange={(color) => store().setAudiogram({ color })}
                onHint={setHint}
              />
            </>
          )}
        </>
      ),
    },
    // ---------------- Live ----------------
    {
      id: "Live",
      title: "Live",
      page: "live",
      search: "live switch quantize off beat bar boundary ableton number keys performance",
      body: (
        <>
          <Segmented
            value={switchQuantize}
            onChange={(m) => store().setSwitchQuantize(m)}
            onHint={setHint}
            ariaLabel="Switch quantize"
            options={QUANTIZE_MODES.map((m) => ({
              value: m,
              label: m === "off" ? "Off" : m === "beat" ? "Beat" : "Bar",
              hint:
                m === "off"
                  ? "Mode switches happen instantly"
                  : `Mode switches wait for the next ${m} before taking over`,
            }))}
          />
          <p className="section-hint">
            Switch quantize — number keys 1–9 (or a mode chip) jump to a visual; with Beat/Bar the
            switch lands on the next boundary, Ableton-style. Live only; exports are unaffected.
          </p>
        </>
      ),
    },
    ...(MIDI_SUPPORTED
      ? [
          {
            id: "MIDI",
            title: "MIDI",
            page: "live" as const,
            search: "midi controller cc note learn knob fader device mapping performance",
            headerExtra: midiEnabled ? (
              <button
                className="text-btn"
                title="Stop listening to MIDI"
                onClick={() => store().disableMidi()}
              >
                Disable
              </button>
            ) : undefined,
            body: !midiEnabled ? (
              <>
                <div className="save-look-row">
                  <button
                    className="text-btn"
                    title="Grant MIDI access and start listening"
                    onClick={() => void store().enableMidi()}
                  >
                    Enable MIDI…
                  </button>
                </div>
                <p className="section-hint">
                  Map a controller's knobs to any parameter and its notes to visual modes. Live
                  performance only — exports are unaffected.
                </p>
              </>
            ) : (
              <>
                <p className="section-hint">
                  {midiDevices.length
                    ? `Connected: ${midiDevices.join(", ")}`
                    : "No MIDI inputs detected — plug one in."}
                </p>
                <div className="save-look-row">
                  <select
                    className="select"
                    value={midiParam || firstModTarget}
                    title="Which parameter a knob/fader drives"
                    onChange={(e) => setMidiParam(e.target.value)}
                  >
                    {modTargetGroupViews.map(({ group, params }) => (
                      <optgroup key={group.id} label={group.label}>
                        {params.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    className="text-btn"
                    title="Then move a knob/fader on your controller to bind it"
                    onClick={() => {
                      if (midiLearn?.kind === "cc") {
                        store().setMidiLearn(null);
                        return;
                      }
                      const key = midiParam || firstModTarget;
                      const spec = allParams(preset).find((p) => p.key === key);
                      if (spec && isModTarget(spec))
                        store().setMidiLearn({
                          kind: "cc",
                          param: key,
                          min: spec.min,
                          max: spec.max,
                        });
                    }}
                  >
                    {midiLearn?.kind === "cc" ? "Move a knob…" : "Learn CC"}
                  </button>
                </div>
                <div className="save-look-row">
                  <button
                    className="text-btn"
                    title={`Bind a note to switch to ${preset.name}`}
                    onClick={() =>
                      midiLearn?.kind === "note"
                        ? store().setMidiLearn(null)
                        : store().setMidiLearn({ kind: "note", presetId: preset.id })
                    }
                  >
                    {midiLearn?.kind === "note" ? "Play a note…" : `Learn note → ${preset.name}`}
                  </button>
                </div>
                {midiBindings.map((b) => {
                  const id = bindingId(b);
                  const label =
                    b.kind === "cc"
                      ? `CC ${b.cc} → ${allParams(preset).find((p) => p.key === b.param)?.label ?? b.param}`
                      : `Note ${b.note} → ${b.presetId}`;
                  return (
                    <div key={id} className="mod-row">
                      <span className="row-label" style={{ flex: 1 }}>
                        {label}
                      </span>
                      <button
                        className="chip-x"
                        title="Remove this binding"
                        aria-label={`Remove ${label}`}
                        onClick={() => store().removeMidiBinding(id)}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </>
            ),
          } satisfies SectionDef,
        ]
      : []),
  ];

  // Search bypasses the rail entirely: a match is a match wherever it lives,
  // and filtering results by page would make the box look broken.
  const visibleSections = sections.filter((s) =>
    searching ? s.search.includes(q) : s.page === page,
  );

  return (
    <aside className="chrome params-panel">
      <div className="panel-header">
        <span className="panel-heading">Inspector</span>
        <button
          className="icon-btn subtle"
          title="Close (G)"
          onClick={() => store().setShowPanel(false)}
        >
          <IconClose size={16} />
        </button>
      </div>

      {/* Full dock width, above the rail AND the page: results cross pages, so
          it must not read as belonging to the page column. */}
      <input
        type="search"
        className="panel-search"
        placeholder="Search controls…"
        value={query}
        aria-label="Search controls"
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="inspector-body">
        {/* A nav of plain buttons, NOT a tablist: these switch views inside a
            panel, and role="tab" would also rename every item's role out from
            under the suites that address them by button name. */}
        <nav className="inspector-rail" aria-label="Inspector sections" ref={railRef}>
          {searching && (
            <button
              type="button"
              className="rail-item active"
              data-section="search"
              aria-current="true"
              tabIndex={0}
              title="Clear the search and go back to the page you were on"
              onClick={() => setQuery("")}
            >
              <span className="rail-label">Search results</span>
              <span className="group-count" aria-hidden="true">
                {visibleSections.length}
              </span>
            </button>
          )}
          {INSPECTOR_PAGES.map((p) => {
            const active = !searching && p.id === page;
            const badge = pageBadge[p.id] ?? 0;
            return (
              <Fragment key={p.id}>
                {p.dividerBefore && <hr className="rail-divider" />}
                <button
                  type="button"
                  className={`rail-item ${active ? "active" : ""}${
                    pageUnavailable[p.id] ? " is-unavailable" : ""
                  }`}
                  // The ATTRIBUTE is the harness contract, never the label:
                  // labels are an iterated design surface, page ids are frozen
                  // in prefs (scripts/gpu-pixel-matrix.mjs selects on this).
                  data-section={p.id}
                  aria-current={active ? "true" : undefined}
                  tabIndex={p.id === page ? 0 : -1}
                  title={pageUnavailable[p.id] ?? pageBadgeTitle[p.id] ?? p.hint}
                  onPointerEnter={() => setHint(p.hint)}
                  onPointerLeave={() => setHint(null)}
                  onFocus={() => setHint(p.hint)}
                  onBlur={() => setHint(null)}
                  onKeyDown={onRailKeyDown}
                  onClick={() => changePage(p.id)}
                >
                  <span className="rail-label">{p.label}</span>
                  {badge > 0 && (
                    <span className="group-count" aria-hidden="true">
                      {badge}
                    </span>
                  )}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="inspector-page">
          {/* A NON-SCROLLING flex sibling, never position:sticky inside
              .panel-scroll — a sticky header there is the classic way to push
              a trailing row past the viewport with nothing the UI auditor can
              credit as a scrollable ancestor. */}
          <div className="inspector-context">
            <span className="section-title">{preset.name}</span>
            <span className="inspector-style">
              {activeStyle?.name ?? (hasStyles ? <em className="style-custom">Custom</em> : null)}
            </span>
          </div>

          <div className="panel-scroll">
            {searching && visibleSections.length > 0 && (
              <p className="search-summary">
                {visibleSections.length === 1
                  ? "1 section matches"
                  : `${visibleSections.length} sections match`}{" "}
                “{query.trim()}” — pages are bypassed while searching.
              </p>
            )}
            {visibleSections.map((s) =>
              s.standalone ? (
                <Fragment key={s.id}>{s.body}</Fragment>
              ) : (
                <PageSection key={s.id} title={s.title} headerExtra={s.headerExtra}>
                  {s.body}
                </PageSection>
              ),
            )}
            {visibleSections.length === 0 && (
              <p className="panel-empty">
                {searching
                  ? `No controls match “${query.trim()}”.`
                  : // A dimmed rail item says WHY on hover; the page it leads
                    // to has to say it again, or arriving here is a dead end.
                    (pageUnavailable[page] ?? `Nothing here for ${preset.name}.`)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="panel-footer">
        {/* Own component purely for subscription granularity: lufs ticks at
            4 Hz for the whole of playback, and reading it here would put the
            panel's ~2,000 lines back on that tick. The rendered DOM is
            unchanged — test:gpu reads .params-panel's textContent. */}
        <PanelFooterBadges />
        <span className={`footer-hint ${hint ? "is-hint" : ""}`}>
          {hint ?? "Hover a control to see what it does"}
        </span>
      </div>
    </aside>
  );
}
