import { Fragment, useMemo } from "react";
import { MAX_STEMS, STEM_TRACK_KEYS } from "../audio/stems";
import { allParams, groupParams, isModTarget, POST_MOD_TARGETS } from "../render/types";
import {
  LFO_SOURCES,
  MOD_SOURCES,
  POST_TARGET_PREFIX,
  type ModCurve,
  type ModSource,
} from "../state/modMatrix";
import { MOD_ROUTE_RECIPES } from "../state/modRoutePresets";
import { selectPreset } from "../state/selectors";
import { useVizStore } from "../state/store";
import { SliderField } from "./kit";

/**
 * The Modulation page (P-1 stage 3) — stems, route recipes, and the route
 * rows that wire an audio feature or beat-locked LFO onto one knob.
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
 * Mounted only while this page is on screen (ParamsPanel's `visibleSections`
 * filter), and while a cross-page search matches the Modulation SectionDef's
 * blob — which stays in ParamsPanel with the rest of the section table.
 */
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

  // What modulation may drive: mod:"off" params (pure toggles and mode-choice
  // enums, RP-2) are not targets, so the picker does not offer them.
  const modTargetGroupViews = useMemo(
    () => groupParams(preset, allParams(preset).filter(isModTarget)),
    [preset],
  );
  const firstModTarget = modTargetGroupViews[0]?.params[0]?.key ?? "";

  // WRITES: one stable accessor; actions are called at the click site. Actions
  // are built once inside create()'s initializer and every write is a partial
  // merge, so their identity is permanently stable — no useCallback.
  const store = useVizStore.getState;

  return (
    <>
      {mods.length === 0 && (
        <p className="section-hint">
          Route any audio feature to any knob of this visual — kick pumps the zoom, hats flicker the
          glow. Applied in exports identically.
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
            <span className="mod-arrow" title="Attack — how long the route takes to rise, seconds">
              A
            </span>
            <SliderField
              label={`${r.source} to ${r.param} attack seconds`}
              min={0}
              max={2}
              step={0.01}
              value={r.attack ?? 0}
              onChange={(v) => store().updateModRoute(r.id, { attack: v === 0 ? undefined : v })}
            />
            <span className="mod-arrow" title="Release — how long the route takes to fall, seconds">
              R
            </span>
            <SliderField
              label={`${r.source} to ${r.param} release seconds`}
              min={0}
              max={2}
              step={0.01}
              value={r.release ?? 0}
              onChange={(v) => store().updateModRoute(r.id, { release: v === 0 ? undefined : v })}
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
  );
}
