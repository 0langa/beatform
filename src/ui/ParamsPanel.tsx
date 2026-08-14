import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import type { SpectrumResolution, SyncMode } from "../audio/types";
import { MAX_FREQ, MIN_FREQ } from "../audio/featurePipeline";
import { spectrumDiagnostics } from "../audio/dsp/displaySpectrum";
import type {
  BgFit,
  BgMode,
  MotionSettings,
  ParamValues,
  PostSettings,
  PresetDef,
} from "../render/types";
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
import { ModulationPage } from "./ModulationPage";
import { LYRIC_ANIMS } from "../state/lyrics";
import { LyricsEditPanel } from "./LyricsEditPanel";
import { LyricsGenPanel } from "./LyricsGenPanel";
import {
  advancedKeys,
  allParams,
  groupParams,
  isModTarget,
  paramSearchText,
  presetMasters,
} from "../render/types";
import { QUANTIZE_MODES } from "../state/quantize";
import { bindingId } from "../state/midi";
import {
  HERTZ,
  PERCENT,
  ColorRow,
  SelectRow,
  SliderRow,
  Segmented,
  ToggleRow,
  emitHint,
  useFooterHint,
  type ValueUnit,
} from "./kit";
import { countOffDefault, GROUP_KEY, ParamGroups, type ParamGroupExtra } from "./ParamGroups";
import { drivenParamKeys } from "../state/drivenTargets";
import { postTargetKey } from "../state/modMatrix";
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

type VisualsPageId = AppPrefs["visualsPage"];

/**
 * The Visuals section rail (P-1): eight destinations, one page each.
 *
 * A DATA TABLE on purpose. Everything the rail renders — order, label, hint,
 * the hairline groupings — is a row here, so later stages add a destination
 * without touching the shell. Labels are the design surface and may be
 * retuned; the `id`s are frozen, because they persist as `visualsPage` and
 * are what the GPU harness selects on (`[data-section="sync"]`).
 *
 * Modulation is a top-level destination rather than a link at the bottom of
 * Sync — that placement is the whole reason this rail exists.
 */
const VISUALS_PAGES: ReadonlyArray<{
  id: VisualsPageId;
  label: string;
  hint: string;
  /** Draw a hairline above this item — grouping only, never a heading. */
  dividerBefore?: boolean;
}> = [
  { id: "mode", label: "Mode", hint: "The active visual and all of its controls" },
  // "Global motion", not "Motion": the per-visual `motion` group (57 params
  // across 14 of 15 modes) renders on Mode, and one word had to say which of
  // the two a click leads to.
  {
    id: "motion",
    label: "Global motion",
    hint: "Rotation, pulse and detail masters — every visual obeys these",
  },
  // "Looks & themes", not "Themes": the save/manage surface for this visual's
  // own looks moved here in 2.82.0 (the factory style chips stayed on Mode,
  // beside the context header that names the active one).
  {
    id: "themes",
    label: "Looks & themes",
    hint: "Your saved looks for this visual, and whole-project themes",
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
   * why several ids are pre-v2.53 titles ("Templates" for what now reads
   * Looks & themes) — P-1 retired in-page section collapse, so nothing reads these
   * off disk any more and they are kept purely to avoid a pointless diff.
   */
  id: string;
  /** Omitted when the page's context header already names the section. */
  title?: string;
  page: VisualsPageId;
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
 * Which factory style the document currently sits on, or `null` for Custom.
 *
 * A style is active when the params equal `defaults + style.values` — the same
 * rule `applyStyle` writes, spelled without building the merged object so it is
 * safe to run inside a zustand selector on every store notification. It returns
 * a STRING ID rather than the StyleDef so the subscription compares by value:
 * the panel then re-renders when the answer changes, not when a param moves.
 *
 * `for…in` over a plain object literal, and `k in values` rather than a
 * nullish test, so this stays bit-identical to the `{...defaults,
 * ...s.values}` spread it replaced — presence, not definedness, is what a
 * spread copies.
 */
function matchStyleId(
  preset: PresetDef,
  defaults: ParamValues,
  params: ParamValues,
): string | null {
  for (const style of preset.styles ?? []) {
    const values = style.values;
    let match = true;
    for (const k in defaults) {
      const want = k in values ? values[k] : defaults[k];
      if ((params[k] ?? defaults[k]) !== want) {
        match = false;
        break;
      }
    }
    if (match) {
      // Keys a style declares that no spec does. Vanishingly rare, but the
      // spread covered them and dropping them would silently widen the match.
      for (const k in values) {
        if (k in defaults) continue;
        if ((params[k] ?? defaults[k]) !== values[k]) {
          match = false;
          break;
        }
      }
    }
    if (match) return style.id;
  }
  return null;
}

/**
 * The dock's hover line (G3).
 *
 * Own component purely for subscription granularity, exactly like
 * <PanelFooterBadges /> beside it and for a worse offender: the hint is written
 * on every pointerenter/pointerleave of every row, group header, segment and
 * rail item. Held as `useState` in ParamsPanel it reconciled the whole panel
 * once per row the pointer crossed — a higher rate than the 4 Hz `lufs` tick
 * v2.80.0 fixed. It now reads the kit's hint channel, so a hover commits this
 * one span and nothing else.
 *
 * The rendered DOM is byte-identical to what ParamsPanel emitted inline —
 * test:gpu reads `.params-panel`'s textContent.
 */
function FooterHint() {
  const hint = useFooterHint();
  return (
    <span className={`footer-hint ${hint ? "is-hint" : ""}`}>
      {hint ?? "Hover a control to see what it does"}
    </span>
  );
}

/**
 * The Visuals — the right-hand dock: styles, preset parameters, background,
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
 * (VISUALS_PAGES) that each render their sections as a page. The search box
 * spans the whole dock and bypasses the rail entirely — results cross pages.
 * The active page persists as `visualsPage`. */
export function ParamsPanel() {
  // ── READS: one hook per field. A selector MUST return a store-owned
  // reference or a primitive — never an object literal, array literal, spread
  // or .filter/.map/.slice. zustand v5 hands the selector straight to
  // useSyncExternalStore with no equality fn, so an allocating one is
  // "Maximum update depth exceeded" ON MOUNT: a white screen, not a slow
  // render. The shared derivations live in state/selectors.ts; lint blocks
  // the allocating shapes at author time.
  const preset = useVizStore(selectPreset);
  /* TOMBSTONE (G4, this release) — `const params = useVizStore(s =>
   * s.activeParams)` lived here, and it is why dragging one slider reconciled
   * the whole dock: setParam writes a fresh activeParams object on every
   * pointermove. Rows read their own value now (<ParamSlot>, ParamGroups.tsx).
   * The two things up HERE that genuinely depend on param values subscribe
   * DERIVED SCALARS instead — see changedCount and activeStyleId below — so
   * this panel re-renders when what it displays changes, not when a number it
   * only passed through does. Never re-add a whole-object subscription here. */
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
  /** The store field is `activeMods`; the retired prop was called `mods`.
   * Read HERE for the rail badge only — the route rows moved to
   * <ModulationPage />, which subscribes it (and `stems`/`stemAnalyzing`)
   * independently. */
  const mods = useVizStore((s) => s.activeMods);
  /**
   * The other half of the `driven` mark's input (H11). TWO NARROW READS, never
   * `s.timeline`: the panel would then reconcile on every scene drag, and
   * P-12's whole contract here is that this component subscribes what it reads
   * and nothing else. Both are safe selector shapes — a store-owned array
   * reference and a boolean — and `lanes` keeps its identity across scene
   * edits, because every timeline write is a spread of the previous object
   * (TimelinePanel's `update`, the store's `autoArrange`).
   *
   * `enabled` is not optional decoration: it is `evalTimeline`'s first line. A
   * project full of lanes with the master switch off drives nothing at all.
   */
  const lanes = useVizStore((s) => s.timeline.lanes);
  const timelineEnabled = useVizStore((s) => s.timeline.enabled);
  const lyricFileName = useVizStore((s) => s.lyricFileName);
  const lyricStyle = useVizStore((s) => s.lyricStyle);
  // PRIMITIVE off lyricsGen (P-12 discipline): only phase gates the ✕/Import
  // controls below (E2-U3) — the progress object inside ticks far more often
  // and neither control needs to re-render for that.
  const lyricsGenPhase = useVizStore((s) => s.lyricsGen.phase);
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
  /**
   * The `driven` mark's input: which knobs of this mode a modulation route or a
   * timeline automation lane will actually move (P-1 stage 3, widened by H11).
   * Same shape and same reason as `looksForMode` directly above — `useMemo`,
   * NEVER a zustand selector. An allocating selector hands
   * useSyncExternalStore a fresh Set on every store notification, which is
   * "Maximum update depth exceeded" on mount. The `{ enabled, lanes }` literal
   * is built INSIDE the memo factory, which is a plain function call and not a
   * subscription, so it costs one object per lane edit and nothing per tick.
   *
   * `mods` is already read above for the rail badge and `preset` at the top of
   * this component; the lane pair right above it is the only new subscription
   * this feature needed, and it fires on lane edits — a document gesture,
   * never a playback or export tick.
   */
  const driven = useMemo(
    () => drivenParamKeys(preset, mods, { enabled: timelineEnabled, lanes }),
    [preset, mods, timelineEnabled, lanes],
  );
  /**
   * The same mark's input for the SIX POST ROWS, which live on Scene and never
   * pass through ParamGroups. `drivenParamKeys` deliberately excludes `post:`
   * routes — post targets are namespaced keys no preset declares, applied by
   * applyPostMods against PostSettings — so this is the other half of that
   * decision rather than a second implementation of it.
   *
   * MODULATION ONLY, and that is a finding rather than an omission (H11):
   * automation cannot reach post at all. `evalTimeline` writes lane values into
   * `TimelineFrame.automation`, `resolveActiveFrame` spreads that over the
   * resolved PARAMS and nothing else, and both render loops call
   * `applyPostMods(post, rf.mods, …)` — never with automation. TimelinePanel's
   * lane picker offers `allParams(activePreset)`, which contains no `post:`
   * key. A lane called "bloom" therefore moves a preset knob named bloom if one
   * exists and the Post row never; ParamsPanel.test's T31 is the standing guard
   * on that, and is the test to update if automation ever learns about post.
   *
   * `postTargetKey` IS applyPostMods' only inert rule (its single `continue`),
   * so a mark here can never claim a knob the renderer skips. Same `useMemo`
   * discipline as `driven` above, and the same zero new subscriptions.
   */
  const drivenPost = useMemo(() => {
    const s = new Set<string>();
    for (const r of mods) {
      const key = postTargetKey(r.param);
      if (key) s.add(key);
    }
    return s;
  }, [mods]);

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

  /**
   * Destructive clear-all: with the correction editor, loaded lyrics can
   * carry real editing work — never drop them on a stray click.
   *
   * Belt and braces against the generate-vs-clear race (E2-U3): a
   * background generation replaces s.lyrics/lyricFileName on success
   * (loadLyricsText, lyricsGenActions.ts) with no confirm of its own, so
   * this confirm can end up asking about content that is already gone —
   * or worse, "Yes" landing after DIFFERENT (just-generated) content took
   * its place, deleting that instead with zero notice.
   *  1. Phase gate: refuse to even OPEN the confirm while a generation is
   *     known in flight (mirrors generateLyrics' own `phase !== "idle"`
   *     guard, and the ✕ button below is disabled the same way so this is
   *     mostly unreachable — kept anyway since the raw action must be safe
   *     regardless of how it's invoked).
   *  2. Identity snapshot: catches the window the phase gate can't — a
   *     generation that starts AND finishes entirely inside the confirm's
   *     own await. clearLyricsIfUnchanged re-reads lyricFileName after the
   *     await and no-ops (with a flash notice) if it no longer matches,
   *     the same "snapshot before, compare after" shape deleteLook's
   *     id-based re-read uses — lyricFileName is the identity here since
   *     clearLyrics has no id of its own to re-validate against.
   */
  const clearLyricsGuarded = async () => {
    const s = store();
    if (s.lyricsGen.phase !== "idle") return; // see the ✕ button's disabled title
    const n = s.lyrics?.length ?? 0;
    const targetFileName = s.lyricFileName;
    if (n > 0) {
      const ok = await askConfirm(
        `Remove the loaded lyrics (${n} line${n === 1 ? "" : "s"})? Unsaved edits are lost.`,
        "Remove lyrics",
      );
      if (!ok) return;
    }
    store().clearLyricsIfUnchanged(targetFileName);
  };

  /** Gated the same phase check as clearLyricsGuarded (E2-U3): importing
   *  while a generation is in flight is its own footgun even without the
   *  ✕ race — generateLyrics' own loadLyricsText call at its success path
   *  would silently clobber whatever the import just landed, with only a
   *  second "Lyrics loaded" toast (easy to miss) to show it happened.
   *  Blocking the control outright is simpler to reason about than
   *  leaving it live and relying on the user to notice. */
  const importLyrics = (f: File) => {
    if (lyricsGenPhase !== "idle") return;
    void f.text().then((t) => store().loadLyricsText(f.name, t));
  };

  /** Group ids whose expert tier is open (P-9). Global, not per-preset: the
   * old global Essentials/All switch seeded this once, in prefs. */
  const [advancedGroups, setAdvancedGroups] = useState<string[]>(() => getPrefs().advancedGroups);
  const [savingLook, setSavingLook] = useState(false);
  const [lookName, setLookName] = useState("");
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeName, setThemeName] = useState("");
  const [themeAuthor, setThemeAuthor] = useState("");
  const [midiParam, setMidiParam] = useState("");
  const [page, setPage] = useState<VisualsPageId>(() => getPrefs().visualsPage);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>(() => getPrefs().collapsedSections);
  const railRef = useRef<HTMLElement | null>(null);
  const changePage = (p: VisualsPageId) => {
    setPage(p);
    setPrefs({ visualsPage: p });
  };
  /** H14 (Q3): the header's Save look JUMPS to Looks & themes with the form
   * already open — but the jump must not persist. `setPage` alone, never
   * `changePage`: next session still opens on the page the user last CHOSE,
   * not on wherever a save happened to land them. */
  const jumpToSaveLook = () => {
    setPage("themes");
    setSavingLook(true);
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
   * One group's expert tier (P-9), reported by ParamGroups as a BARE id.
   *
   * Plain value + setPrefs OUTSIDE the setState updater, for the same reason
   * toggleGroup does it: React re-runs updaters in the render phase under
   * StrictMode, and a setPrefs there notifies App's useSyncExternalStore
   * mid-render ("Cannot update a component (App)").
   */
  const toggleAdvanced = (groupId: string, open: boolean) => {
    const next = open
      ? advancedGroups.includes(groupId)
        ? advancedGroups
        : [...advancedGroups, groupId]
      : advancedGroups.filter((g) => g !== groupId);
    setAdvancedGroups(next);
    setPrefs({ advancedGroups: next });
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
    changePage(next.dataset.section as VisualsPageId);
  };
  const postChanged = (Object.keys(DEFAULT_POST) as Array<keyof PostSettings>).some(
    (k) => post[k] !== DEFAULT_POST[k],
  );
  const motionChanged = (Object.keys(DEFAULT_MOTION) as Array<keyof MotionSettings>).some(
    (k) => motion[k] !== DEFAULT_MOTION[k],
  );
  /** Whole-preset expert-tier drift, shown beside Reset. Derived from
   * advancedKeys(), NEVER from `preset.advanced` membership: a spec carrying
   * `tier: "curated"` still lives in that array but renders above the
   * disclosure, so counting the raw array would bill 21 curated knobs across
   * the registry as expert. This count is the sum of the per-group ones.
   *
   * The spec list is memoized on `preset` and the SELECTOR returns the count
   * itself (G4): a number, so a drag re-renders the panel on the one write
   * that flips the digit and on none of the ~100 that do not. Subscribing
   * `activeParams` to compute it here is exactly the cost G4 removed. */
  const advKeys = advancedKeys(preset);
  const expertSpecs = useMemo(
    () => allParams(preset).filter((s) => advancedKeys(preset).has(s.key)),
    [preset],
  );
  const changedCount = useVizStore((s) => countOffDefault(s.activeParams, expertSpecs));
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

  /**
   * A style is "active" when current params exactly equal defaults + values.
   *
   * Subscribed as the ID — a STRING (G4), for the same reason `changedCount`
   * above is a number: the answer changes at most once per drag (the first
   * write off a style), so the panel re-renders once instead of per
   * pointermove. `matchStyleId` is allocation-free and its `defaults` argument
   * is memoized per preset, so the per-notification cost is a bounded scan of
   * numbers with nothing for the GC to collect.
   */
  const defaults = useMemo(() => defaultParams(preset), [preset]);
  const activeStyleId = useVizStore((s) => matchStyleId(preset, defaults, s.activeParams));
  const activeStyle = (preset.styles ?? []).find((s) => s.id === activeStyleId);

  // ── RAIL DATA. Dimmed-not-hidden (F1): an unavailable destination stays
  // focusable and clickable, says why on hover, and explains itself again on
  // the page you land on.
  const pageUnavailable: Partial<Record<VisualsPageId, string>> = showMotion
    ? {}
    : {
        motion:
          "This visual has no rotation, pulse or detail masters — its own motion controls are on Mode",
      };
  /** Counts from the DOCUMENT, shown when > 0. The pill is aria-hidden so
   * accessible names stay exactly the rail label; the count is spoken through
   * the button's title instead. */
  const pageBadge: Partial<Record<VisualsPageId, number>> = {
    modulation: mods.length,
    scene: overlayLayers.length,
    live: midiBindings.length,
  };
  const pageBadgeTitle: Partial<Record<VisualsPageId, string>> = {
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
  /** H14 (Q2): the header Reset is PAGE-AWARE — it resets what the current
   * page shows and is absent on pages with nothing to reset. Drift gates
   * mirror the section Resets this replaced (motion/post appear only once
   * changed); Mode's is unconditional, exactly as its section button was.
   * Hidden while searching: results cross pages, so "the current page" is
   * not what the user is looking at. */
  const headerReset = searching
    ? null
    : page === "mode"
      ? {
          label: "Reset",
          hint: "Back to factory defaults (all controls incl. advanced)",
          run: () => store().resetParams(),
        }
      : page === "motion" && motionChanged && !simplifiedRenderer
        ? {
            label: "Reset",
            hint: "Back to normal motion (100% everywhere)",
            run: () => store().setMotion({ ...DEFAULT_MOTION }),
          }
        : page === "scene" && postChanged && !simplifiedRenderer
          ? {
              label: "Reset post",
              hint: "Turn off all post-processing (neutral)",
              run: () => store().setPost({ ...DEFAULT_POST }),
            }
          : null;
  // Every word of every knob — label, hint, key and enum choices — plus the
  // names of the groups they sit in. The old blob carried labels only, so
  // searching a hint's wording ("monstercat", "letterbox") found nothing even
  // though the row was right there.
  const presetParamText = allParams(preset).map(paramSearchText).join(" ");
  /** Every knob of this visual, grouped — reused by the panel's own layout
   * search blob and by the Modulation/MIDI target dropdowns. */
  const paramGroupViews = groupParams(preset, allParams(preset));
  const presetGroupText = paramGroupViews.map((g) => g.group.label).join(" ");
  /**
   * THE BULK TIER SWITCH (P-9). Every group of this visual that actually HAS
   * an expert tier — i.e. that renders a disclosure to open. Filtered rather
   * than "every group id": a group with no expert params has no button, so no
   * click could ever add its id, and an unfilterable id would pin
   * `allTiersOpen` false forever (spectrum-bars' Motion group is exactly this
   * — one curated knob, zero expert ones). It also keeps ids that can never
   * mean anything out of the 32-entry prefs budget, and suppresses the button
   * entirely on a preset with no expert tier at all (custom/Shadertoy).
   */
  const presetGroupIds = paramGroupViews
    .filter((g) => g.params.some((s) => advKeys.has(s.key)))
    .map((g) => g.group.id);
  const allTiersOpen =
    presetGroupIds.length > 0 && presetGroupIds.every((id) => advancedGroups.includes(id));
  /**
   * ONE update for N groups. This is why it lives here and not as a loop over
   * `toggleAdvanced`: that updater derives `next` from the closure-captured
   * `advancedGroups`, so N sequential calls in one handler all start from the
   * same snapshot and the last one wins — exactly one group would open. The
   * union/difference is computed once, then written once.
   */
  const setAllAdvanced = (on: boolean) => {
    const next = on
      ? [...new Set([...advancedGroups, ...presetGroupIds])]
      : advancedGroups.filter((g) => !presetGroupIds.includes(g));
    setAdvancedGroups(next);
    setPrefs({ advancedGroups: next });
  };
  // What MIDI CC may drive: mod:"off" params (pure toggles and mode-choice
  // enums, RP-2) are not targets, so the picker does not offer them. The
  // Modulation page derives the same view for its own target picker — that is
  // a different section on a different page, and duplicating a pure
  // derivation is cheaper than a prop that would re-couple the two.
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
      // "advanced essentials" left with the global density switch (P-9) — a
      // blob that still answers to a retired control surfaces a section for
      // something the user cannot find once they get there. "look save import
      // gallery browse" left with the user-looks surface for the same reason
      // (it lives on Looks & themes now). "custom" STAYS: it is not looks
      // vocabulary — it covers the "Custom" style readout and the center-image
      // extra ("choose custom picture"), both of which are still rendered
      // here, and sections are filtered by this blob while ParamGroups filters
      // rows, so dropping it would hide the row its own search text advertises.
      search:
        `${preset.name} ${preset.description ?? ""} preset style custom expert reset center image cover ${presetGroupText} ${presetParamText}`.toLowerCase(),
      headerExtra:
        // H14: Reset moved up into the page-aware context header. The pill
        // stays HERE (Q4) — it describes the page body's groups and measured
        // 28px too wide for the header at the 380 floor.
        changedCount > 0 ? (
          <span
            className="advanced-count"
            title="Expert knobs that no longer sit at their factory value"
          >
            {changedCount} changed
          </span>
        ) : undefined,
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

          {/* The user-looks surface (chips, save form, Import…, the Gallery
              deep link) moved to Looks & themes in 2.82.0. The FACTORY style
              chips above stayed: they are this visual's own presets, the first
              thing touched after picking a mode, and the context header right
              there names which one is active. What left is the occasional
              save/manage half — ~70px of chrome off the tallest page in the
              dock, and the thing that makes Looks & themes worth visiting. */}

          {/* Builder (RP-20): its virtual l<i>.* params exist for the
              modulation/MIDI/automation target lists, NOT for a second knob
              surface — BuilderPanel below stays the one editor, so the
              generic grouped rows are suppressed here (locked UI decision). */}
          {preset.id !== BUILDER2_ID && (
            <ParamGroups
              preset={preset}
              advancedGroups={advancedGroups}
              onToggleAdvanced={toggleAdvanced}
              driven={driven}
              query={q}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
              extras={centerImageExtras}
            />
          )}

          {/* What the retired Essentials/All switch was actually FOR: one
              click to "show me everything". Per-group disclosures alone would
              charge a power user one click per group. Below the group list,
              never in .section-head — three leaves in that flex clip at the
              dock's 380px floor.
              Hidden while searching, for the reason ParamGroups hides the
              disclosures themselves: search already crosses the tier, so every
              match is on screen and there is nothing left for this to reveal.
              A control that cannot change what you see is noise. */}
          {!searching && preset.id !== BUILDER2_ID && presetGroupIds.length > 0 && (
            <div className="param-groups-actions">
              <button
                className="text-btn"
                title={
                  allTiersOpen
                    ? "Close every group's expert controls"
                    : "Open every group's expert controls at once"
                }
                onClick={() => setAllAdvanced(!allTiersOpen)}
              >
                {allTiersOpen ? "Hide expert controls" : "Show every control"}
              </button>
            </div>
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
                  Builder compiles its layer stack to a GPU shader, so it needs hardware rendering
                  (WebGPU). Your saved stack is untouched and will render again on a system that has
                  it.
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
                <BuilderPanel />
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
            // H14: the conditional Reset moved into the context header, same
            // drift gate — the section head now carries nothing.
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
                    onHint={emitHint}
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
                    onHint={emitHint}
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
                    onHint={emitHint}
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
      // The id keeps the retired pre-vocabulary spelling while the title
      // reads LOOKS & THEMES. It is INERT, not load-bearing: validPrefs
      // filters collapsedSections to "group:"-prefixed entries, so a bare
      // "Templates" key is pruned on read and no collapse state depends on
      // it. Left alone because renaming it buys nothing, not because a
      // rename would cost anything.
      // The RAIL id is the one that matters: `themes` persists as
      // `visualsPage` and prefs.ts has no page-id migration, so labels move
      // and ids never do.
      id: "Templates",
      title: "Looks & themes",
      page: "themes",
      // Two surfaces, one blob, because they are one section (see below).
      // The user looks' own NAMES are in it: a saved look is the only thing on
      // this page the user named themselves, so it is the first word they
      // would type to find it again.
      search:
        `looks themes look theme templates save import export bfpreset bftheme complete colors sync post gallery community browse ${looksForMode
          .map((p) => p.name)
          .join(" ")} ${FACTORY_THEMES.map((t) => t.meta.name).join(" ")}`.toLowerCase(),
      body: (
        <>
          {/* ONE section, not two. A second PageSection would put a bare
              heading on the page whenever its body collapsed to nothing, and
              the two halves answer the same question at two scopes — what this
              visual looks like, and what the whole project looks like.
              "…for this visual", never `for ${preset.name}`: the context
              header above already prints the name, and a second copy makes
              getByText(name) ambiguous as well as reading as a stutter. */}
          <p className="section-hint">
            Looks saved for this visual — your own tunings of its controls. Save the current values,
            import a .bfpreset file, or browse the Gallery.
          </p>
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
                  Save look
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
                onPointerEnter={() => emitHint(o.hint)}
                onPointerLeave={() => emitHint(null)}
                onFocus={() => emitHint(o.hint)}
                onBlur={() => emitHint(null)}
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
            onHint={emitHint}
          />
          <SliderRow
            label="Attack"
            hint="Attack — how fast the reaction rises on a hit (0 = instant, 1 = slow)"
            min={0}
            max={1}
            step={0.01}
            value={sync.attack ?? sync.smooth}
            onChange={(v) => store().setSync({ ...sync, attack: v })}
            onHint={emitHint}
          />
          <SliderRow
            label="Release"
            hint="Release — how slowly the reaction falls after a hit (0 = instant, 1 = long)"
            min={0}
            max={1}
            step={0.01}
            value={sync.release ?? sync.smooth}
            onChange={(v) => store().setSync({ ...sync, release: v })}
            onHint={emitHint}
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
                onHint={emitHint}
              />
              <ToggleRow
                label="Smooth curve"
                hint="Spline-smoothed spectrum: curves instead of corners"
                checked={smoothSpectrum}
                onChange={(v) => store().setSmoothSpectrum(v)}
                onHint={emitHint}
              />
              <div className="row">
                <span className="row-label">Resolution</span>
                <div style={{ flex: 1 }}>
                  <Segmented
                    value={sync.spectrumResolution ?? "responsive"}
                    onChange={(spectrumResolution) =>
                      store().setSync({ ...sync, spectrumResolution })
                    }
                    onHint={emitHint}
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
                    onHint={emitHint}
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
                    onHint={emitHint}
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
                onHint={emitHint}
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
                onHint={emitHint}
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
                onHint={emitHint}
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
                onHint={emitHint}
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
                onHint={emitHint}
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
      // The whole body is <ModulationPage />: zero props, store-direct, and
      // subscribing `stems`/`stemAnalyzing` itself so a stem import no longer
      // reconciles the panel's ~2,000 lines. The SectionDef stays HERE — the
      // search blob is what makes the page reachable from the cross-page
      // search box, and the `visibleSections` filter is what guarantees this
      // subtree (and anything live it grows) exists only while it is on
      // screen.
      body: <ModulationPage />,
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
            onHint={emitHint}
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
            onHint={emitHint}
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
                onHint={emitHint}
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
                  onHint={emitHint}
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
            onHint={emitHint}
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
      // H14: the conditional Reset moved into the context header as
      // "Reset post" (the page shows more than post, so the label narrows
      // to what the button actually touches), same drift gate.
      body: (
        <>
          <ToggleRow
            label="Filmic tonemap"
            hint="Filmic (ACES) tonemap — cinematic contrast and highlight rolloff"
            checked={post.tonemap}
            onChange={(v) => store().setPost({ tonemap: v })}
            onHint={emitHint}
            disabledReason={unavailable}
          />
          {/* The `driven` mark reaches the post rows through a LOCAL wrapper,
              never a prop on SliderRow. The kit is shared with LayersPanel,
              ExportDialog, BuilderPanel and TimelinePanel, none of which has
              any business knowing modulation exists — and `.param-slot` is
              already the exact element ParamGroups marks, so the two pages
              render one visual language from one CSS rule.
              The hover copy says "modulation" flat, where ParamGroups' says
              "modulation or a timeline lane": that is precision, not drift —
              a lane provably cannot reach PostSettings (see `drivenPost`). */}
          {POST_SLIDERS.map((r) => (
            <div
              key={r.key}
              className={`param-slot ${drivenPost.has(r.key) ? "is-driven" : ""}`}
              title={
                drivenPost.has(r.key)
                  ? "Driven — modulation is moving this while it plays. This slider is still the base value."
                  : undefined
              }
            >
              <SliderRow
                label={r.label}
                hint={r.hint}
                min={r.min}
                max={r.max}
                step={r.step}
                value={post[r.key]}
                onChange={(v) => store().setPost({ [r.key]: v })}
                onHint={emitHint}
                disabledReason={unavailable}
              />
            </div>
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
                  // E2-U3: disabled, not just guarded in the handler — a
                  // generation owns s.lyrics/lyricFileName until it settles
                  // back to idle, so removal has to wait its turn.
                  disabled={lyricsGenPhase !== "idle"}
                  title={
                    lyricsGenPhase !== "idle"
                      ? "Generating lyrics — wait for it to finish before removing"
                      : "Remove lyrics"
                  }
                  aria-label="Remove lyrics"
                  onClick={() => void clearLyricsGuarded()}
                >
                  ✕
                </button>
              </span>
            ) : (
              <label
                className={`text-btn ${lyricsGenPhase !== "idle" ? "disabled" : ""}`}
                title={
                  lyricsGenPhase !== "idle"
                    ? "Generating lyrics — importing now would be overwritten when it finishes"
                    : "Import timed lyrics (.lrc from any lyrics site, or .srt) — drawn as a karaoke overlay, identical in exports"
                }
              >
                + Import lyrics…
                <input
                  type="file"
                  accept=".lrc,.srt"
                  hidden
                  disabled={lyricsGenPhase !== "idle"}
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
                onHint={emitHint}
              />
              <SelectRow
                label="Position"
                hint="Where the lines sit in the frame"
                value={lyricStyle.position}
                onChange={(position) => store().setLyricStyle({ position })}
                onHint={emitHint}
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
                onHint={emitHint}
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
                onHint={emitHint}
              />
              <SliderRow
                label="Fade"
                hint="Cross-fade time between lines, in seconds"
                min={0}
                max={1}
                step={0.05}
                value={lyricStyle.fadeSec}
                onChange={(v) => store().setLyricStyle({ fadeSec: v })}
                onHint={emitHint}
              />
              <ColorRow
                label="Color"
                hint="Lyric text color"
                value={lyricStyle.color}
                onChange={(color) => store().setLyricStyle({ color })}
                onHint={emitHint}
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
            onHint={emitHint}
          />
          <ToggleRow
            label="Time readout"
            hint="Elapsed / total time, drawn as text"
            checked={audiogram.timeReadout}
            onChange={(v) => store().setAudiogram({ timeReadout: v })}
            onHint={emitHint}
          />
          <ToggleRow
            label="Waveform strip"
            hint="A mini waveform overview with a moving playhead"
            checked={audiogram.waveformStrip}
            onChange={(v) => store().setAudiogram({ waveformStrip: v })}
            onHint={emitHint}
          />
          {(audiogram.progressBar || audiogram.timeReadout || audiogram.waveformStrip) && (
            <>
              <SelectRow
                label="Position"
                hint="Which edge of the frame the audiogram elements sit against"
                value={audiogram.position}
                onChange={(position) => store().setAudiogram({ position })}
                onHint={emitHint}
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
                onHint={emitHint}
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
            onHint={emitHint}
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
        <span className="panel-heading">Visuals</span>
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

      <div className="visuals-body">
        {/* A nav of plain buttons, NOT a tablist: these switch views inside a
            panel, and role="tab" would also rename every item's role out from
            under the suites that address them by button name. */}
        <nav className="visuals-rail" aria-label="Visuals sections" ref={railRef}>
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
          {VISUALS_PAGES.map((p) => {
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
                  onPointerEnter={() => emitHint(p.hint)}
                  onPointerLeave={() => emitHint(null)}
                  onFocus={() => emitHint(p.hint)}
                  onBlur={() => emitHint(null)}
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

        <div className="visuals-page">
          {/* A NON-SCROLLING flex sibling, never position:sticky inside
              .panel-scroll — a sticky header there is the classic way to push
              a trailing row past the viewport with nothing the UI auditor can
              credit as a scrollable ancestor. */}
          <div className="visuals-context">
            <div className="visuals-context-names">
              {/* H14 (Q7): truncation is scoped to this header-local class —
                  `.section-title` is shared with Layers/Builder/Timeline and
                  stays untouched. The `title` attr carries the full name,
                  because Shadertoy imports make preset names unbounded. */}
              <span className="section-title visuals-context-title" title={preset.name}>
                {preset.name}
              </span>
              {/* Only a real style is named here. "Custom" is the ABSENCE of one,
                  and the chips row inside the page already says so — printing it
                  in both places put the same word twice on one screen. */}
              <span className="visuals-style">{activeStyle?.name ?? null}</span>
            </div>
            {!searching && (
              <div className="visuals-context-actions">
                {headerReset && (
                  <button className="text-btn" title={headerReset.hint} onClick={headerReset.run}>
                    {headerReset.label}
                  </button>
                )}
                <button
                  className="text-btn"
                  title="Save the current values as a named look for this visual"
                  onClick={jumpToSaveLook}
                >
                  Save look
                </button>
              </div>
            )}
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
        <FooterHint />
      </div>
    </aside>
  );
}
