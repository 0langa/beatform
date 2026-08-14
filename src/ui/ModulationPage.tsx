import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MAX_STEMS, STEM_TRACK_KEYS } from "../audio/stems";
import {
  allParams,
  groupParams,
  isModTarget,
  POST_MOD_TARGETS,
  type ParamGroupView,
  type ParamSpec,
  type PostSettings,
} from "../render/types";
import {
  LFO_SOURCES,
  MOD_LAG_MAX_SEC,
  MOD_SOURCES,
  POST_TARGET_PREFIX,
  type ModCurve,
  type ModRoute,
  type ModSource,
} from "../state/modMatrix";
import { MOD_ROUTE_RECIPES } from "../state/modRoutePresets";
import { selectPreset } from "../state/selectors";
import { useVizStore } from "../state/store";
import { formatValue, Segmented, SECONDS, SliderField } from "./kit";
import { meterRef, ModMeterDriver } from "./ModMeters";
import { Switch } from "./Switch";

/**
 * The Modulation page (P-1 stage 3) — one CARD PER MODULATED CONTROL.
 *
 * Why target-first, and why exactly one layout at every dock width:
 *  - The target is the primary key of a route in all 13 shipped factory
 *    themes (distinct targets === route count in 13/13), the target axis is
 *    the smaller one (26-37 targets vs 34-62 sources), and the card's
 *    grouping key IS applyMods' accumulation key — `out[route.param]` is read
 *    back and clamped once per route (modMatrix.ts), so two routes on one
 *    knob genuinely are one stack and belong in one card.
 *  - The content column here is `dockWidth - 206` (gutter, dock border, the
 *    136px section rail + its border, .panel-scroll's 28px padding, the thin
 *    scrollbar). That is 174px at the 380px minimum, 274px at the 480px
 *    default and 554px at the 760px maximum. A two-column grid needs 720px
 *    and a `@container (min-width: 560px)` threshold can never fire, so
 *    there is NO container query, NO breakpoint and NO multi-column here.
 *    Extra width goes into the range track and the two pickers' ellipsis.
 *
 * DETERMINISM: this page is a VIEW OVER applyMods, never a second evaluator.
 * It renders the document and the target's spec, and the live marker is
 * driven from outside by the meter engine writing one CSS custom property
 * (`--v`) on `.mod-swing-arm` / `.mod-meter-fill`. Nothing here imports
 * ModEvalState, createModEvalState or routeValue — routeValue mutates the
 * caller's lag memo, so a UI call would advance every lagged route's envelope
 * a second time per frame and change what the renderer draws. The one thing
 * this page hands the meter engine beyond source/curve is a route's bare id
 * string (H9, RouteMeter below) — the engine, not this page, turns that into
 * a published post-lag number by reading services.ts's read-only copy.
 *
 * Its own component purely for SUBSCRIPTION GRANULARITY, in the shape
 * <PanelFooterBadges /> established: `stems` and `stemAnalyzing` are read by
 * nothing else in the Visuals, so a stem import must not reconcile the
 * panel's ~2,000 lines. ParamsPanel keeps `activeMods` for the rail badge and
 * keeps its own `modTargetGroupViews`/`firstModTarget` for the MIDI picker,
 * which is a different section on a different page.
 *
 * ZERO PROPS, store-direct, one field per hook. zustand v5 hands the selector
 * straight to useSyncExternalStore with no equality function, so a selector
 * that allocates (object/array literal, spread, .filter/.map/.slice) is
 * "Maximum update depth exceeded" ON MOUNT — a white screen, not a slow
 * render. Everything derived allocates inside useMemo instead; lint blocks the
 * allocating shapes at author time.
 *
 * NOTHING NEW IS PERSISTED. Card disclosure and the source filter are
 * component state: `validPrefs` prunes every key that is not `group:`-
 * prefixed, and a `ModRoute` field for view state would be stripped by
 * validModRoutes on the next load of every saved project and .bftheme.
 *
 * Mounted only while this page is on screen (ParamsPanel's `visibleSections`
 * filter), and while a cross-page search matches the Modulation SectionDef's
 * blob — which stays in ParamsPanel with the rest of the section table.
 */

/**
 * The card's heading: the tail after the LAST " · ".
 *
 * Measured over all 427 target labels in the registry: median 10 chars, p90
 * 15, max 31 — and every label over 18 chars is a Builder v2 virtual param of
 * the form `L2 Particles · Density`, which already sits under a group header
 * reading `Layer 2 · Particles`. No built-in preset label contains " · " at
 * all (pinned by a test), so this rule fires ONLY where the prefix is already
 * on screen, and never shortens a built-in. Result: heading <= 20 chars
 * everywhere, which fits the 174px column without the ellipsis firing.
 */
export function cardHeading(label: string): string {
  const i = label.lastIndexOf(" · ");
  return i < 0 ? label : label.slice(i + 3);
}

const POST_GROUP = "Post-processing";
/** Group header for a route whose target this visual does not have. */
const INERT_GROUP = "Not on this visual";

/** Where one target sits in the card list, plus the spec the card renders. */
interface TargetPlace {
  label: string;
  spec: ParamSpec;
  group: string;
  rank: number;
  order: number;
}

/** One card: a target, its place, and every route stacked on it. */
interface ModCard {
  param: string;
  label: string;
  heading: string;
  spec: ParamSpec | null;
  group: string;
  rank: number;
  order: number;
  routes: ModRoute[];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The target option list, shared by the card header picker and the create
 * picker. A native <select> over the registry's own optgroups is the only
 * enumeration surface that is keyboard- and screen-reader-complete for free,
 * and it is what keeps the registry-derived assertions in the panel suite
 * meaningful — so the two pickers stay <select>s. What died is the 96px
 * `.mod-select` cap: both get the full content column with `min-width: 0`.
 * The rule itself was deleted in 2.84.0 once it was confirmed to have no
 * emitter left anywhere; see its tombstone in App.css beside `.mod-create`.
 */
function TargetOptions(props: {
  groups: ParamGroupView[];
  /** A route's current target, so a legacy/off one keeps a visible option. */
  current?: string;
  /** Already-routed targets — offered but disabled in the CREATE picker, so
   *  N picks can no longer stack N compounding routes on one knob. */
  routed?: ReadonlySet<string>;
}) {
  const { current, routed } = props;
  return (
    <>
      {/* Grouped by the SAME ParamSpec.group the panel lays out, so a 35-knob
          visual reads as eight short lists instead of one unsearchable run. */}
      {props.groups.map(({ group, params }) => (
        <optgroup key={group.id} label={group.label}>
          {params.map((p) => (
            <option
              key={p.key}
              value={p.key}
              title={p.label}
              disabled={routed?.has(p.key) ?? false}
            >
              {cardHeading(p.label)}
              {routed?.has(p.key) ? " · routed" : ""}
            </option>
          ))}
        </optgroup>
      ))}
      {/* A route saved before a param went mod:"off" (or whose param this
          preset lacks) still needs a visible, selected option — silently
          snapping the select to the first entry would rewrite the route on
          the next unrelated edit. Such routes are inert in applyMods. */}
      {current !== undefined &&
        current.length > 0 &&
        !current.startsWith(POST_TARGET_PREFIX) &&
        !props.groups.some(({ params }) => params.some((p) => p.key === current)) && (
          <option value={current}>{`${current} (not modulatable)`}</option>
        )}
      {/* Post targets are namespaced ("post:chromatic") so they can live in
          the same route list as preset params. */}
      <optgroup label={POST_GROUP}>
        {POST_MOD_TARGETS.map((p) => {
          const key = `${POST_TARGET_PREFIX}${p.key}`;
          return (
            <option key={p.key} value={key} disabled={routed?.has(key) ?? false}>
              {p.label}
              {routed?.has(key) ? " · routed" : ""}
            </option>
          );
        })}
      </optgroup>
    </>
  );
}

/**
 * THE ONE CROSS-UNIT SEAM. These two leaves are the only elements this page
 * hands to the meter engine; the engine writes `--v` (0..1) on them every
 * frame and touches nothing else. All geometry is CSS (`scaleX` on the chip
 * fill, `translateX` on the swing arm) — compositor-only, so a tick never
 * lays out or repaints a card.
 *
 * Both are COMPONENTS rather than an inline `ref={meterRef({...})}`, and that
 * is a measured choice, not ceremony. A ref callback built during render has a
 * fresh identity every render, so React runs its cleanup and re-registers —
 * and the cleanup deliberately removes `--v` (a re-registered element must not
 * keep a stale quantum). This page re-renders once per pointer move while a
 * Depth slider is dragged, so with an inline ref every meter on screen would
 * be stripped back to its resting position on every frame of that drag; on a
 * PAUSED track it would then stay there for up to 250 ms, because the driver's
 * "track time did not move" fast path skips the write until the next text
 * tick. Memoized on their primitive fields — `source` alone for the chip
 * meter, `source`/`curve`/`routeId` for the swing arm — the registration
 * survives depth drags, card disclosure, source filtering, retargeting and
 * stem imports, and re-registers exactly when the value being displayed
 * would change anyway (routeId flips between a route's id and undefined
 * exactly when rise/fall crosses zero, which is such a case).
 *
 * Neither component holds the spec in a ref or mutates it: `meterRef` is
 * re-called with a fresh spec when, and only when, its inputs change.
 */
function SourceMeter(props: { source: ModSource }) {
  const { source } = props;
  const ref = useMemo(() => meterRef({ source }), [source]);
  return (
    <span className="mod-chip-meter">
      <span className="mod-meter-fill" ref={ref} />
    </span>
  );
}

/** The diamond that walks a route's painted range. `curve` is display-only.
 *  `routeId` is this route's id, passed ONLY while it carries attack/release
 *  (H9) — the caller below gates on that, not this component, so a lag-less
 *  route stays on the exact same instant-math path it always was. With a
 *  routeId, the meter prefers the loop's own published post-lag value for
 *  any frame it has one; see ModMeters.tsx's file header for the full
 *  contract. */
function RouteMeter(props: { source: ModSource; curve?: ModCurve; routeId?: string }) {
  const { source, curve, routeId } = props;
  const ref = useMemo(() => meterRef({ source, curve, routeId }), [source, curve, routeId]);
  return (
    <span className="mod-swing-arm" ref={ref}>
      <span className="mod-diamond" />
    </span>
  );
}

export function ModulationPage() {
  /**
   * The active mode's def, resolved INSIDE the selector. `selectPreset` is a
   * one-field selector over `presetId` that returns a reference the module
   * registry already owns, so it is safe here — and resolving at selector time
   * is what picks up a custom-shader re-save or a Builder stack rebuild under
   * the same id. Keying the memo below on the raw id string instead would
   * freeze the target list against a stale param schema.
   */
  const preset = useVizStore(selectPreset);
  /** The store field is `activeMods`; the retired prop was called `mods`. */
  const mods = useVizStore((s) => s.activeMods);
  const stems = useVizStore((s) => s.stems);
  const stemAnalyzing = useVizStore((s) => s.stemAnalyzing);
  /** Base values — what each card's range is measured FROM. Both are plain
   *  document fields, so both selectors return a store-owned reference. */
  const params = useVizStore((s) => s.activeParams);
  const post = useVizStore((s) => s.post);

  /** Open cards and the source filter are view state and stay component-local
   *  (see the file header: nothing new is persisted). */
  const [openCards, setOpenCards] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [pickedSource, setPickedSource] = useState<string | null>(null);

  /** Drag-reorder (H12) visual feedback ONLY — view state, same as above.
   *  `paramKey` scopes it to one card (cards render independently, and the
   *  keys below are indices WITHIN that card's own route list, not into
   *  `activeMods`). The gesture's actual source of truth lives in local
   *  closures inside startRouteDrag, not here — see its own doc comment. */
  const [dragHint, setDragHint] = useState<{ paramKey: string; from: number; over: number } | null>(
    null,
  );
  /** Escape hatch for a drag left in progress when this page unmounts (dock
   *  navigation mid-drag). Nothing else tears down the raw
   *  addEventListener calls startRouteDrag makes outside React — the grip's
   *  own pointerup/pointercancel still land on it once removed from the DOM
   *  in most engines, but the window `keydown` listener would not
   *  otherwise ever go away. Reassigned by every startRouteDrag call,
   *  cleared by its own `end()`; the unmount effect below just needs
   *  SOMETHING to call if one is still armed. */
  const cancelDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelDragRef.current?.(), []);

  // What modulation may drive: mod:"off" params (pure toggles and mode-choice
  // enums, RP-2) are not targets, so the picker does not offer them.
  const modTargetGroupViews = useMemo(
    () => groupParams(preset, allParams(preset).filter(isModTarget)),
    [preset],
  );

  /** target key -> label, spec and sort position. Post targets sort after
   *  every preset group; an unknown target falls through to INERT_GROUP. */
  const places = useMemo(() => {
    const m = new Map<string, TargetPlace>();
    modTargetGroupViews.forEach(({ group, params: ps }, rank) => {
      ps.forEach((p, order) => {
        m.set(p.key, { label: p.label, spec: p, group: group.label, rank, order });
      });
    });
    const postRank = modTargetGroupViews.length;
    POST_MOD_TARGETS.forEach((p, order) => {
      m.set(`${POST_TARGET_PREFIX}${p.key}`, {
        label: p.label,
        spec: p,
        group: POST_GROUP,
        rank: postRank,
        order,
      });
    });
    return m;
  }, [modTargetGroupViews]);

  /** One card per distinct target, routes kept in DOCUMENT order inside it —
   *  applyMods sums in array order, so the card must not reorder them. */
  const cards = useMemo(() => {
    const byParam = new Map<string, ModRoute[]>();
    for (const r of mods) {
      const stack = byParam.get(r.param);
      if (stack) stack.push(r);
      else byParam.set(r.param, [r]);
    }
    const out: ModCard[] = [];
    for (const [param, routes] of byParam) {
      const place = places.get(param);
      const label = place?.label ?? param;
      out.push({
        param,
        label,
        heading: cardHeading(label),
        spec: place?.spec ?? null,
        group: place?.group ?? INERT_GROUP,
        rank: place?.rank ?? Number.MAX_SAFE_INTEGER,
        order: place?.order ?? 0,
        routes,
      });
    }
    out.sort((a, b) => a.rank - b.rank || a.order - b.order || a.heading.localeCompare(b.heading));
    return out;
  }, [mods, places]);

  /** Every source id the document actually uses, in first-seen order. Meters
   *  exist per source-IN-USE and per route — never one per registry entry. */
  const sourcesInUse = useMemo(() => {
    const seen = new Set<string>();
    const out: ModSource[] = [];
    for (const r of mods) {
      if (seen.has(r.source)) continue;
      seen.add(r.source);
      out.push(r.source);
    }
    return out;
  }, [mods]);

  /** Source id -> the label the pickers and chips print. */
  const sourceLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of MOD_SOURCES) m.set(s.id, s.label);
    for (const s of LFO_SOURCES) m.set(s.id, s.label);
    for (const st of stems) {
      for (const k of STEM_TRACK_KEYS) m.set(`${st.slot}:${k}`, `${st.analysis.name}: ${k}`);
    }
    return m;
  }, [stems]);

  /** Targets already carrying a route — the create picker greys these out. */
  const routed = useMemo(() => new Set(mods.map((r) => r.param)), [mods]);

  // DERIVED, never stored back: a filter on a source whose last route was
  // just deleted resolves to "no filter" instead of an empty page, with no
  // render-phase setState to get there.
  const filter =
    pickedSource !== null && sourcesInUse.includes(pickedSource as ModSource) ? pickedSource : null;
  const shown = useMemo(
    () =>
      filter === null ? cards : cards.filter((c) => c.routes.some((r) => r.source === filter)),
    [cards, filter],
  );

  // WRITES: one stable accessor; actions are called at the click site. Actions
  // are built once inside create()'s initializer and every write is a partial
  // merge, so their identity is permanently stable — no useCallback.
  const store = useVizStore.getState;

  const toggleCard = (key: string) =>
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** The value a card's range starts from: the knob as the user set it. */
  const baseOf = (card: ModCard): number | null => {
    if (!card.spec) return params[card.param] ?? null;
    if (card.param.startsWith(POST_TARGET_PREFIX)) {
      const key = card.param.slice(POST_TARGET_PREFIX.length) as keyof PostSettings;
      const v = post[key];
      return typeof v === "number" ? v : card.spec.default;
    }
    return params[card.param] ?? card.spec.default;
  };

  const sourceName = (id: string) => sourceLabels.get(id) ?? id;

  /** Drag class for one route row, mirroring PresetOrderEditor's own
   *  `dragging` / `drop-before` / `drop-after` scheme exactly (name and
   *  meaning) so the two drag affordances in this app read identically.
   *  `ri` is this row's index within ITS OWN card — the same space
   *  `dragHint.from`/`.over` live in. */
  const dragClassFor = (paramKey: string, ri: number): string => {
    if (!dragHint || dragHint.paramKey !== paramKey) return "";
    if (dragHint.from === ri) return " dragging";
    if (dragHint.over === ri) return dragHint.from < ri ? " drop-after" : " drop-before";
    return "";
  };

  /**
   * Pointer-based drag reorder (H12) — the PRIMARY gesture; the ▲▼ buttons
   * rendered beside the grip are the keyboard/complement path, and both
   * end at the exact same `reorderModRoutes` call, so they can never
   * disagree about what a "move" means.
   *
   * Scoped to the grip element alone via `e.currentTarget`, never the
   * whole row: a whole-row `draggable`/pointer-drag would fight the row's
   * OWN controls (the source select, the Depth/Rise/Fall sliders, the mute
   * switch) — starting a drag from the Depth slider's thumb must adjust
   * Depth, not reorder the route. `touch-action: none` on `.mod-route-grip`
   * (App.css) is the other half of that isolation: without it, a touch-drag
   * begun on the grip would be stolen by the dock's own scroll container
   * before a single pointermove reached this handler.
   *
   * Pointer CAPTURE (`el.setPointerCapture`, matching App.tsx's
   * startVisualsResize/startLibraryResize idiom exactly) is what keeps the
   * gesture alive even once the pointer strays outside the grip's own
   * bounds — required here since the grip is a handful of pixels inside a
   * scrollable dock column. Capture means native pointerenter/leave on the
   * ROWS themselves never fires during the drag (every subsequent pointer
   * event for this pointerId is redirected to the grip), so hit-testing
   * uses `document.elementFromPoint` + a `data-mod-route-param`/
   * `data-mod-route-index` pair on each row instead of relying on that —
   * the one substitute that still answers "what's under the pointer" while
   * captured, and it needs no `getBoundingClientRect` math of its own.
   *
   * COMMITS ON DROP: `reorderModRoutes` (and therefore the single
   * "mod-reorder" history record it makes) is called from EXACTLY one
   * place — the pointerup handler — never from a move. Escape or a
   * `pointercancel` (window drag-out, pen palm rejection, browser-
   * initiated) tear down through the identical `end()` but pass
   * `commit=false`, so a cancelled drag calls `reorderModRoutes` zero
   * times: no mutation, no history entry, not even the no-op-but-harmless
   * call a same-position drop would make.
   */
  const startRouteDrag =
    (paramKey: string, from: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault(); // no native text-selection/drag-image while dragging
      let over = from;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      setDragHint({ paramKey, from, over });

      const onMove = (ev: PointerEvent) => {
        const hit = (
          document.elementFromPoint(ev.clientX, ev.clientY) as Element | null
        )?.closest<HTMLElement>("[data-mod-route-param]");
        if (!hit || hit.dataset.modRouteParam !== paramKey) return;
        const idx = Number(hit.dataset.modRouteIndex);
        if (Number.isNaN(idx) || idx === over) return;
        over = idx;
        setDragHint({ paramKey, from, over });
      };
      const onUp = () => end(true);
      const onCancel = () => end(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") end(false);
      };
      // Hoisted function declaration: onUp/onCancel/onKey above reference it
      // by name before this line runs, which is fine — none of them are
      // actually CALLED until the browser dispatches an event, by which
      // point the whole synchronous body below has long since executed.
      function end(commit: boolean) {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        // Unconditional, every exit path (drop, Escape, pointercancel): a
        // captured pointer released only implicitly by pointerup means an
        // Escape-cancelled drag leaves the grip capturing until the
        // physical button-up eventually fires — every pointermove until
        // then keeps landing here instead of wherever the cursor actually
        // is. Releasing a pointerId this element does not currently
        // capture is a no-op, never a throw, so calling it on every path
        // (including the already-released pointerup case) is safe.
        el.releasePointerCapture(e.pointerId);
        cancelDragRef.current = null;
        setDragHint(null);
        if (commit) store().reorderModRoutes(paramKey, from, over);
      }
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      cancelDragRef.current = () => end(false);
    };

  return (
    <>
      {/* EXACTLY ONE driver for the whole page. It renders null and owns no
          DOM — it is the single rAF that samples the analyzer and writes `--v`
          on every element the two meter components registered. Mounted HERE,
          inside the Modulation SectionDef's body, so its lifetime is the
          page's: ParamsPanel's `visibleSections` filter unmounts this subtree
          on any other destination and the effect's cleanup cancels the frame.
          Nothing above this point in the tree ticks at frame rate. */}
      <ModMeterDriver />

      {mods.length === 0 && (
        <p className="section-hint mod-empty">
          Modulation lets the music move a knob for you. Pick a control below, choose what drives it
          — kick, bass, vocals or a beat-locked LFO — then set how far it swings. Your own value
          stays the resting point, and an export renders exactly the movement you see here.
        </p>
      )}

      {/* PRIMARY ACTION, target-first. A picker rather than a button: "+ Route"
          wrote `param: ""` on any visual with no modulatable knobs (the route
          then vanished on reload), and it stacked a fresh compounding route on
          every extra click. Both are unreachable from a list of real targets
          whose already-routed entries are disabled. */}
      <div className="save-look-row">
        <select
          className="select mod-create"
          value=""
          title="Choose a knob to modulate"
          aria-label="Modulate a control"
          onChange={(e) => {
            const param = e.target.value;
            if (param) store().addModRoute("kick", param);
          }}
        >
          <option value="">+ Modulate a control…</option>
          <TargetOptions groups={modTargetGroupViews} routed={routed} />
        </select>
      </div>
      {modTargetGroupViews.length === 0 && (
        <p className="section-hint">
          This visual has no knobs to modulate. Post-processing is still on the list — those routes
          follow the image wherever the mode goes.
        </p>
      )}

      {/* Route recipes (P-7): curated one-or-two-route starting points, always
          visible — a chip ADDS plain routes targeting this visual's
          best-matching knobs, and from there they are ordinary cards. */}
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

      {/* Live source meters, one per source IN USE. Each chip also filters the
          cards below it — click again (or the same chip) to clear. */}
      {sourcesInUse.length > 0 && (
        <div className="mod-sources">
          <span className="mod-sources-label">Driven by</span>
          {sourcesInUse.map((id) => (
            <button
              key={id}
              className={`style-chip mod-source-chip${filter === id ? " active" : ""}`}
              aria-pressed={filter === id}
              title={
                filter === id
                  ? "Showing only the controls this drives — click to show all again"
                  : `Show only the controls ${sourceName(id)} drives`
              }
              onClick={() => setPickedSource(filter === id ? null : id)}
            >
              <span className="mod-chip-label">{sourceName(id)}</span>
              <SourceMeter source={id} />
            </button>
          ))}
        </div>
      )}

      {shown.map((card, i) => {
        const spec = card.spec;
        const base = baseOf(card);
        const open = openCards.has(card.param);
        return (
          <Fragment key={card.param}>
            {(i === 0 || shown[i - 1].group !== card.group) && (
              <div className="mod-group-head">{card.group}</div>
            )}
            <div className="mod-card">
              <div className="mod-card-head">
                {/* LEADING triangle, the app's own disclosure idiom
                    (ParamGroups' `.group-chevron`), and leading for a reason:
                    a trailing one sits right beside the target select's native
                    arrow and the two read as one ambiguous pair of chevrons. */}
                <button
                  className="mod-card-toggle"
                  aria-expanded={open}
                  aria-label={`Response shape for ${card.label}`}
                  title="Response curve, rise and fall for this control"
                  onClick={() => toggleCard(card.param)}
                >
                  <span className="mod-card-chevron">▸</span>
                </button>
                <select
                  className="select mod-card-target"
                  value={card.param}
                  title="Which knob it moves"
                  aria-label={`Modulate ${card.label}`}
                  onChange={(e) => {
                    // EVERY route on the card moves. updateModRoute re-reads
                    // get() per call, so a stack of two does not last-write-win
                    // itself back down to one.
                    const param = e.target.value;
                    for (const r of card.routes) store().updateModRoute(r.id, { param });
                  }}
                >
                  <TargetOptions groups={modTargetGroupViews} current={card.param} />
                </select>
                {/* NO resting-value column here, deliberately. Measured at the
                    380px minimum: a 44px readout leaves the heading 59px of
                    text, and the p90 target label is ~90px — so the card's own
                    name would truncate on most controls, which is exactly the
                    defect (`.mod-select`'s 96px cap, the rule itself deleted
                    in 2.84.0) this page exists to fix.
                    The resting value is the LEFT side of every route's
                    `210 → 360` line, paired with where the route takes it,
                    which is strictly more useful than the number alone. */}
              </div>

              {card.routes.map((r, ri) => {
                const src = sourceName(r.source);
                const shape = shapeSummary(r);
                // The range this route paints: from the resting value to what
                // the knob reaches at full signal, clamped by the spec exactly
                // the way applyMods clamps it.
                let track: CSSProperties | null = null;
                let rangeText = "";
                let rangeTitle = "";
                if (spec && base !== null) {
                  const span = spec.max - spec.min;
                  const raw = base + r.amount * span;
                  const reach = clamp(raw, spec.min, spec.max);
                  const pct = (v: number) =>
                    span > 0 ? clamp((v - spec.min) / span, 0, 1) * 100 : 0;
                  const a = pct(base);
                  const b = pct(reach);
                  const rising = r.amount >= 0;
                  track = {
                    "--from": `${Math.min(a, b)}%`,
                    "--span": `${Math.abs(b - a)}%`,
                    "--start": rising ? 0 : 1,
                    "--dir": rising ? 1 : -1,
                  } as CSSProperties;
                  rangeText = `${formatValue(undefined, base, spec.step)} → ${formatValue(undefined, reach, spec.step)}`;
                  rangeTitle =
                    `${card.label} rests at ${formatValue(undefined, base, spec.step)} and reaches ` +
                    `${formatValue(undefined, reach, spec.step)} when ${src} peaks` +
                    (raw === reach ? "" : " — the knob's own limit stops it there");
                }
                return (
                  <div
                    key={r.id}
                    className={`mod-route${r.muted ? " muted" : ""}${dragClassFor(card.param, ri)}`}
                    // Drag hit-testing target (startRouteDrag, above) — read
                    // via document.elementFromPoint while the pointer is
                    // captured on another row's grip, never queried by index
                    // or rect math.
                    data-mod-route-param={card.param}
                    data-mod-route-index={ri}
                  >
                    <div className="mod-route-head">
                      {/* H12: on = active (v1 behavior, absent muted). The
                          patch omits the key on unmute rather than writing a
                          literal `false` — the curve/attack/release idiom
                          below (`v === "linear" ? undefined : v`) — so a
                          route merely LOOKED at keeps its v1 shape. */}
                      <Switch
                        checked={!r.muted}
                        onChange={(on) =>
                          store().updateModRoute(r.id, { muted: on ? undefined : true })
                        }
                        title={r.muted ? "Unmute this route" : "Mute this route"}
                        label={
                          r.muted
                            ? `Resume ${src} moving ${card.label}`
                            : `Pause ${src} moving ${card.label}`
                        }
                      />
                      <select
                        className="select mod-source"
                        value={r.source}
                        title="What drives this route"
                        aria-label={`What moves ${card.label}`}
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
                        {/* Stems are runtime-only while the routes to them
                            persist, so EVERY reopened stem project has routes
                            whose source matches no option. Without this the
                            route row's primary text renders blank. */}
                        {r.source.startsWith("stem") && !sourceLabels.has(r.source) && (
                          <option value={r.source}>{`${r.source} (stem not loaded)`}</option>
                        )}
                        {/* Beat-locked LFOs: pure functions of track time and
                            the beat grid (falls back to a 120-BPM clock before
                            analysis). */}
                        <optgroup label="LFO — beat-synced">
                          {LFO_SOURCES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      {/* Reorder (H12): only when there is more than one route
                          to reorder — a stacked card is the exception (0 of the
                          43 routes in the 13 shipped factory themes share a
                          param), so a single-route card never shows a grip and
                          two buttons that could only ever be disabled/inert.
                          Indices are WITHIN this card's own list, matching
                          reorderRoutes' contract (modMatrix.ts) exactly. Drag
                          (the grip) is the primary gesture; ▲▼ are the
                          keyboard/complement path — both call the identical
                          store action, so they can never disagree. */}
                      {card.routes.length > 1 && (
                        <>
                          <button
                            type="button"
                            className="mod-route-grip"
                            title="Drag to reorder — or use the move buttons"
                            aria-label={`Reorder ${src} for ${card.label}`}
                            onPointerDown={startRouteDrag(card.param, ri)}
                          >
                            ⠿
                          </button>
                          <button
                            className="chip-x"
                            title="Move earlier"
                            aria-label={`Move ${src} earlier in the stack for ${card.label}`}
                            disabled={ri === 0}
                            onClick={() => store().reorderModRoutes(card.param, ri, ri - 1)}
                          >
                            ▲
                          </button>
                          <button
                            className="chip-x"
                            title="Move later"
                            aria-label={`Move ${src} later in the stack for ${card.label}`}
                            disabled={ri === card.routes.length - 1}
                            onClick={() => store().reorderModRoutes(card.param, ri, ri + 1)}
                          >
                            ▼
                          </button>
                        </>
                      )}
                      <button
                        className="chip-x"
                        title="Remove this route"
                        aria-label={`Stop ${src} from moving ${card.label}`}
                        onClick={() => store().removeModRoute(r.id)}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="mod-depth">
                      <span className="mod-depth-label">Depth</span>
                      <SliderField
                        label={`How far ${src} moves ${card.label}`}
                        hint="Share of the knob's own range added at full signal — negative pulls the other way"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={r.amount}
                        onChange={(amount) => store().updateModRoute(r.id, { amount })}
                      />
                    </div>

                    {track ? (
                      <div className="mod-range">
                        <span className="mod-range-text" title={rangeTitle}>
                          {rangeText}
                        </span>
                        <span className="mod-range-track" style={track}>
                          <span className="mod-range-fill" />
                          <span className="mod-range-swing">
                            <RouteMeter
                              source={r.source}
                              curve={r.curve}
                              // H9: only a route that actually carries lag
                              // gets its id — see RouteMeter's own doc
                              // comment for why the gate lives here.
                              routeId={
                                (r.attack ?? 0) > 0 || (r.release ?? 0) > 0 ? r.id : undefined
                              }
                            />
                          </span>
                        </span>
                      </div>
                    ) : (
                      <p className="mod-inert">
                        This visual has no {card.param} knob, so the route does nothing. Retarget it
                        above, or remove it.
                      </p>
                    )}

                    {/* The disclosure is never width-gated, so a non-default
                        shape must still be readable while it is closed. */}
                    {!open && shape !== null && <p className="mod-shape-summary">{shape}</p>}

                    {open && (
                      <div className="mod-shape">
                        <Segmented<ModCurve>
                          ariaLabel={`Response curve for ${src} to ${card.heading}`}
                          value={r.curve ?? "linear"}
                          options={CURVE_OPTIONS}
                          onChange={(v) =>
                            store().updateModRoute(r.id, {
                              // Linear writes `undefined`, never the literal —
                              // a route that merely got LOOKED at must keep its
                              // v1 shape in every saved document.
                              curve: v === "linear" ? undefined : v,
                            })
                          }
                        />
                        <div className="mod-lag">
                          <span className="mod-depth-label">Rise</span>
                          <SliderField
                            label={`Rise time for ${src} to ${card.label}`}
                            hint="How long the knob takes to follow the source up"
                            min={0}
                            max={MOD_LAG_MAX_SEC}
                            step={0.01}
                            format={SECONDS}
                            value={r.attack ?? 0}
                            onChange={(v) =>
                              store().updateModRoute(r.id, { attack: v === 0 ? undefined : v })
                            }
                          />
                        </div>
                        <div className="mod-lag">
                          <span className="mod-depth-label">Fall</span>
                          <SliderField
                            label={`Fall time for ${src} to ${card.label}`}
                            hint="How long the knob takes to fall back once the source drops"
                            min={0}
                            max={MOD_LAG_MAX_SEC}
                            step={0.01}
                            format={SECONDS}
                            value={r.release ?? 0}
                            onChange={(v) =>
                              store().updateModRoute(r.id, { release: v === 0 ? undefined : v })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

/** Curve choices. Module scope: a fresh array per render would remount the
 *  Segmented's buttons on every keystroke elsewhere in the panel. */
const CURVE_OPTIONS: Array<{ value: ModCurve; label: string; hint: string }> = [
  { value: "linear", label: "Linear", hint: "Straight through — the knob follows the source 1:1" },
  { value: "exp", label: "Exp", hint: "Squares the source, so only the peaks move the knob much" },
  {
    value: "smooth",
    label: "Smooth",
    hint: "Eases both ends, so the knob settles instead of snapping",
  },
];

/**
 * What a collapsed card still has to say about a route's shape. Empty for the
 * default (linear, no lag), which is every one of the 43 routes in the 13
 * shipped factory themes — so the common card pays nothing for this.
 */
function shapeSummary(r: ModRoute): string | null {
  const bits: string[] = [];
  if (r.curve === "exp") bits.push("Exp");
  else if (r.curve === "smooth") bits.push("Smooth");
  if (r.attack) bits.push(`rise ${r.attack.toFixed(2)} s`);
  if (r.release) bits.push(`fall ${r.release.toFixed(2)} s`);
  return bits.length > 0 ? bits.join(" · ") : null;
}
