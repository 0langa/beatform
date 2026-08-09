import { Fragment, memo, type ReactNode } from "react";
import type { ParamSpec, ParamValues, PresetDef } from "../render/types";
import {
  advancedKeys,
  allParams,
  groupParams,
  paramSearchText,
  presetGroups,
} from "../render/types";
import { useVizStore } from "../state/store";
import { emitHint, ParamRow } from "./kit";
import { GROUP_KEY } from "./paramGroupKey";

/**
 * The parameter area of the settings panel: every knob of the active visual,
 * sorted into its declared group.
 *
 * Extracted from ParamsPanel because it is the part that GROWS. The panel used
 * to render `preset.params` as one flat list and `preset.advanced` as a second
 * flat list behind a disclosure — 35 unlabelled rows on Builder, 32 on Radial
 * Burst, in ABI order. Nothing here knows a single param key: placement comes
 * from `ParamSpec.group`, order from `ParamGroupDef.rank`, so the twentieth
 * setting added to a visual lands correctly without touching this file.
 *
 * The tier (v2.82.0, P-9) is now PER GROUP, not global. Every group buckets its
 * full membership so it always has a header and a stable count; its expert-tier
 * rows sit behind that group's own disclosure. The tier split therefore happens
 * AFTER bucketing — before it, there is no group id to attribute a knob to, and
 * pre-filtering is exactly why Backdrop rendered nothing at all on 13 of 15
 * modes under the old global Essentials/All switch.
 */

/** Re-exported so every UI caller keeps importing it from here. It is DECLARED
 * in a dependency-free module because this file is store-aware since G4, and
 * `prefs.test.ts` (node environment) reads the constant to prove prefs' own
 * copy has not drifted — see the note in paramGroupKey.ts. */
export { GROUP_KEY };

/**
 * How many of `specs` sit off their factory value. A NUMBER, so it is safe as
 * the whole body of a zustand selector: the count is what the UI shows, and
 * subscribing it means a drag re-renders the pill only on the one write that
 * actually flips it. Subscribing `activeParams` instead would re-render on
 * every pointermove to display an unchanged digit.
 *
 * Allocation-free by construction (no `.filter`, no destructuring) — it runs
 * once per notification per group, and zustand notifies on every store write
 * in the app.
 */
export function countOffDefault(params: ParamValues, specs: readonly ParamSpec[]): number {
  let n = 0;
  for (const spec of specs) if ((params[spec.key] ?? spec.default) !== spec.default) n += 1;
  return n;
}

/**
 * ONE param row, subscribed to ONE param (G4).
 *
 * This is the whole slider-drag fix. `setParam` writes a fresh `activeParams`
 * object on every pointermove; while the dock read that object at the top,
 * every one of those writes reconciled ~2,000 lines to move one thumb. The
 * subscription is now here and it is a NUMBER, so a drag re-renders the row
 * being dragged and nothing else — not its group, not ParamGroups, not the
 * panel.
 *
 * `memo` because the props are all stable: `spec` is a module-level object out
 * of the preset registry, and the two marks are booleans. A ParamGroups render
 * (page change, search, a collapse toggle) therefore bails on every row whose
 * marks did not move.
 *
 * The slot DIV is inside the memo boundary on purpose — it is the element both
 * marks live on, so keeping it out would re-render a parent to change a class
 * on a child's wrapper.
 *
 * The `driven` mark is a CLASS on the existing slot and NOTHING ELSE — no
 * fourth child, no badge element. `.param-row` is a THREE-track grid —
 * `var(--row-label-w) minmax(0,1fr) 44px`, the label column being the one thing
 * the dock's container query moves — so an extra child breaks the label column
 * on every page that renders a param row, and any new leaf is one more
 * `text-clip` candidate for `__auditUI` at the 380px dock floor. The tier mark
 * beside it (`is-advanced`) is the same mechanism, for the same reason.
 *
 * The `title` is an attribute, not an element, so it costs nothing here. It
 * only surfaces on the slot's own padding: a row whose spec has a hint puts
 * that hint on the inner `<label>`, and the innermost title wins on hover.
 */
const ParamSlot = memo(function ParamSlot(props: {
  spec: ParamSpec;
  advanced: boolean;
  driven: boolean;
}) {
  const { spec } = props;
  // A PRIMITIVE selector: one number out of the params object. Returning
  // `s.activeParams` and indexing outside would put this row back on every
  // param write in the mode.
  const value = useVizStore((s) => s.activeParams[spec.key] ?? spec.default);
  return (
    <div
      className={`param-slot ${props.advanced ? "is-advanced" : ""} ${
        props.driven ? "is-driven" : ""
      }`}
      title={
        props.driven
          ? "Driven — modulation is moving this while it plays. This slider is still the base value."
          : undefined
      }
    >
      <ParamRow
        spec={spec}
        value={value}
        // getState(), never a subscribed action: actions are built once in
        // create()'s initializer, so this reads a permanently stable function.
        onChange={(v) => useVizStore.getState().setParam(spec.key, v)}
        onHint={emitHint}
      />
    </div>
  );
});

/** The "N changed" pill on a group's expert disclosure. Its own component so
 * the SUBSCRIPTION is its own: see countOffDefault. Renders nothing at zero,
 * exactly as the inline conditional it replaced did. */
function ExpertChanged(props: { specs: readonly ParamSpec[] }) {
  const changed = useVizStore((s) => countOffDefault(s.activeParams, props.specs));
  if (changed === 0) return null;
  return (
    <span className="advanced-count" title="Expert knobs that no longer sit at their factory value">
      {changed} changed
    </span>
  );
}

/** A non-param control that belongs inside a group (the centre-image picker
 * belongs with the Image knobs, not stranded under them). */
export interface ParamGroupExtra {
  /** ParamGroupDef id to append to. */
  group: string;
  /** Lowercased keywords, so search can surface it like a real row. */
  search: string;
  node: ReactNode;
}

export interface ParamGroupsProps {
  preset: PresetDef;
  /* TOMBSTONE (G3/G4, this release) — `params: ParamValues`, `onParam` and
   * `onHint` lived here. All three were pointer-rate channels routed through
   * the caller, which is what made a drag (`onParam`) and a hover (`onHint`)
   * reconcile the whole ~2,000-line dock. Values are now read per ROW straight
   * off the store (see <ParamSlot> below) and hints go to the kit's hint
   * channel, so neither passes through ParamsPanel at all. `driven` and
   * `collapsed` stay props: both change at DOCUMENT rate, and keeping them
   * here is what lets one subscription serve every row. */
  /**
   * Group ids whose expert tier is OPEN. Empty = every tier closed.
   *
   * REQUIRED, and deliberately so: an optional `advancedGroups` silently
   * renders a panel where no disclosure ever opens, which is indistinguishable
   * from a broken toggle. The caller owns persistence, so the caller must say.
   */
  advancedGroups: readonly string[];
  /** Reports the BARE group id; the caller owns persistence. */
  onToggleAdvanced: (groupId: string, open: boolean) => void;
  /* TOMBSTONE (P-9, v2.82.0) — a `showAdvanced?: boolean` prop lived here for
   * one wave, mapping the retired global Essentials/All switch onto "every
   * tier open" so this file could land before ParamsPanel was rewritten. Both
   * the switch and that call site are gone; opening every tier at once is now
   * ParamsPanel's "Show every control", which writes every group id into
   * `advancedGroups` rather than bypassing it. */

  /**
   * Param keys something ELSE is moving right now — a modulation route today,
   * a timeline automation lane the moment H10 lands. Both write the same key
   * without touching the document, so the slider sits exactly where the user
   * left it while the render does something else; the mark is the only place
   * that fact appears on the page where the knob is edited.
   *
   * REQUIRED, for the reason `advancedGroups` above is: an optional set makes
   * a caller that forgets it render a panel where the feature simply never
   * appears, with green typecheck, green lint and green tests. Derive it with
   * `drivenParamKeys(preset, mods)` (src/state/drivenTargets.ts) — this file
   * stays store-unaware, so the caller owns the subscription.
   *
   * Not a live VALUE, deliberately: `.row-value` is the editor (double-click
   * to type), a moving number cannot be double-clicked, and the number you
   * would type is the base while the number shown would be the modulated one.
   */
  driven: ReadonlySet<string>;
  /** Trimmed, lowercased search query. Non-empty = filter rows, ignore tiers. */
  query: string;
  /** Group keys the user collapsed (GROUP_KEY-prefixed), from prefs. */
  collapsed: string[];
  onToggleGroup: (groupId: string, open: boolean) => void;
  extras?: ParamGroupExtra[];
}

export function ParamGroups(props: ParamGroupsProps) {
  const { preset, query } = props;
  const searching = query.length > 0;
  const advanced = advancedKeys(preset);

  // Search deliberately ignores the tier. A user who types "vignette" is
  // asking where it is, and answering "nowhere" because the knob happens to
  // live in the expert tier is how the old panel hid two thirds of itself
  // (the advanced drawer was never searched at all).
  //
  // NOT searching: bucket EVERY param, not a tier-filtered subset. That is
  // what gives each group a stable header and its own disclosure — feeding
  // groupParams the filtered list is why Backdrop rendered NOTHING on 13 of
  // 15 modes in Essentials, and Reaction nothing on radial-burst.
  const all = allParams(preset);
  const visible: ParamSpec[] = searching
    ? all.filter((spec) => paramSearchText(spec).includes(query))
    : all;

  const extras = (props.extras ?? []).filter((e) => !searching || e.search.includes(query));
  /**
   * ── FROZEN SPEC: how a page declares a group subset ────────────────────────
   * Not implemented in 2.82.0 — there is no consumer, and an orphan surface is
   * a defect here (see the .builder-factory-chips note in App.css). When the
   * first real carve-out page exists, copy this EXACTLY. Two rules are binding.
   *
   * RULE 1 — filter the RESOLVED views, never the ParamSpec[].
   *   types.ts:339 is the ONLY place that resolves an absent/unknown `group` to
   *   FALLBACK_GROUP ("more"), and custom.ts:60-68 rebuilds every imported
   *   ParamSpec WITHOUT `group`. Filtering specs therefore strands 100% of every
   *   custom shader and every imported Shadertoy visual, and forces the caller to
   *   re-implement the fallback — the exact duplication the group model prevents.
   *
   * RULE 2 — the catch-all page is the COMPLEMENT, never an allow-list.
   *   The id space is open: 8 shared PARAM_GROUPS ids, "more", and preset-declared
   *   groups (classic `builder` declares ten). One constant, two consumers:
   *     const CARVED_GROUPS = ["color"] as const;              // page A
   *     <ParamGroups groups={{ only:   CARVED_GROUPS }} />     // the carve-out
   *     <ParamGroups groups={{ except: CARVED_GROUPS }} />     // Mode, always
   *   With an allow-list, a new PARAM_GROUPS entry becomes silently unreachable.
   *
   * ── src/render/types.ts ────────────────────────────────────────────────────
   * export type GroupFilter =
   *   | { only: readonly string[] }
   *   | { except: readonly string[] };
   *
   * export function filterGroupViews(
   *   views: ParamGroupView[],
   *   filter?: GroupFilter,
   * ): ParamGroupView[] {
   *   if (!filter) return views;
   *   return "only" in filter
   *     ? views.filter((v) => filter.only.includes(v.group.id))
   *     : views.filter((v) => !filter.except.includes(v.group.id));
   * }
   *
   * ── src/ui/ParamGroups.tsx ─────────────────────────────────────────────────
   *   groups?: GroupFilter;   // in ParamGroupsProps; omitted = every group
   *
   *   // applied to BOTH the views and the extras, before the empty-group
   *   // re-insert loop (or an extra re-inserts a group this page excluded):
   *   const inPage = (id: string) =>
   *     !props.groups ||
   *     ("only" in props.groups
   *       ? props.groups.only.includes(id)
   *       : !props.groups.except.includes(id));
   *   const extras = (props.extras ?? [])
   *     .filter((e) => inPage(e.group))
   *     .filter((e) => !searching || e.search.includes(query));
   *   const shown = filterGroupViews(groupParams(preset, visible), props.groups);
   *
   * ── THREE THINGS THAT BREAK IF THE CALLER FORGETS THEM ─────────────────────
   * 1. SEARCH BLOBS. ParamsPanel.tsx:2175 filters SECTIONS by s.search.includes(q)
   *    while ParamGroups filters ROWS. They agree today only because ParamGroups
   *    renders every group. Each new page's SectionDef.search must be derived from
   *    ITS OWN subset (groupParams -> paramSearchText per member) and the Mode blob
   *    must LOSE the text of the groups it no longer renders. Subsets are disjoint,
   *    so every row still matches exactly once. Do NOT "fix" this by making
   *    ParamGroups ignore the subset while searching — that duplicates every hit
   *    once per page section.
   * 2. EMPTY PAGES. ParamGroups returns null when nothing is shown, but
   *    ParamsPanel's "Nothing here for X." only fires when visibleSections.length
   *    === 0 — a section whose BODY renders null still counts as visible and leaves
   *    a bare PageSection header. Exclude the SectionDef from the array when its
   *    subset is empty for the active preset. Measured absences: `camera` missing
   *    from 15 of 17 presets, `image` from 11, `motion` from spectrum-scape.
   * 3. A NEW RAIL ID IS A PERSISTED VALUE. It must be added to BOTH the
   *    `visualsPage` union (prefs.ts:76) AND the runtime oneOf list
   *    (prefs.ts:239-250). Editing only the type gives green typecheck, green
   *    lint, green tests, and a page that silently never persists. And note the
   *    non-obvious default: an invalid visualsPage does NOT fall back to "mode",
   *    it falls back to TAB_TO_PAGE[paramsTab] — removing an id later needs an
   *    explicit RETIRED_PAGE remap consulted BEFORE oneOf, plus a seeded-storage
   *    test. Never rename a page id in place.
   * ──────────────────────────────────────────────────────────────────────────
   */
  const shown = groupParams(preset, visible);
  // An extra whose group ended up with no visible rows still has to render —
  // groupParams drops empty groups. Only reachable while searching now; kept,
  // because that is exactly when it matters.
  const defs = presetGroups(preset);
  for (const id of new Set(extras.map((e) => e.group))) {
    if (shown.some((g) => g.group.id === id)) continue;
    const def = defs.get(id);
    if (def) shown.push({ group: def, params: [] });
  }
  shown.sort((a, b) => a.group.rank - b.group.rank || a.group.id.localeCompare(b.group.id));

  if (shown.length === 0) {
    return searching ? <p className="panel-empty">No knobs of {preset.name} match that.</p> : null;
  }

  /** One row. Everything about how it renders is documented on <ParamSlot>. */
  const row = (spec: ParamSpec) => (
    <ParamSlot
      key={spec.key}
      spec={spec}
      advanced={advanced.has(spec.key)}
      driven={props.driven.has(spec.key)}
    />
  );

  return (
    <div className="param-groups">
      {shown.map(({ group, params }) => {
        // While searching every group is forced open: a collapsed group that
        // contains the one match would make search look broken.
        const open = searching || !props.collapsed.includes(GROUP_KEY + group.id);
        const mine = extras.filter((e) => e.group === group.id);
        // While searching there is no tier: every match renders in place, with
        // no disclosure to open. A "3 expert controls" button mid-search would
        // be a lie about what is hidden.
        const curated = searching ? params : params.filter((s) => !advanced.has(s.key));
        const expert = searching ? [] : params.filter((s) => advanced.has(s.key));
        const tierOpen = props.advancedGroups.includes(group.id);
        /**
         * Driven knobs of THIS group, counted over its full membership — a
         * route lands on the best-matching knob regardless of tier (recipes,
         * `autoRouteStem`), so a row-only mark is invisible exactly when the
         * target sits in a collapsed group or a shut expert tier, which is the
         * common case. The header has to carry it.
         *
         * MERGED INTO `.group-count`, never a third pill: `.group-head` is a
         * flex of chevron + name + count, and a third leaf at the measured
         * 174px content column is precisely the crowding that got
         * `.param-groups-actions` moved out of `.section-head`. Below the
         * measured 174px the name ellipsises; the pill never wraps.
         */
        const drivenHere = params.filter((s) => props.driven.has(s.key)).length;
        const total = params.length + mine.length;
        return (
          <section className="param-group" key={group.id}>
            <button
              className={`group-head ${open ? "open" : ""}`}
              aria-expanded={open}
              disabled={searching}
              title={group.hint}
              onPointerEnter={() => emitHint(group.hint ?? null)}
              onPointerLeave={() => emitHint(null)}
              onFocus={() => emitHint(group.hint ?? null)}
              onBlur={() => emitHint(null)}
              onClick={() => props.onToggleGroup(group.id, !open)}
            >
              <span className="group-chevron">▸</span>
              <span className="group-name">{group.label}</span>
              {/* TOTAL, curated + expert: the badge must not shift under the
                  user when a disclosure opens. With driven knobs inside it
                  reads "2/7" and tints — the aria-label is what stops that
                  being spoken as "two slash seven", and the pill keeps its
                  bare total the instant the last route goes away. */}
              <span
                className={`group-count ${drivenHere > 0 ? "is-driven" : ""}`}
                aria-label={drivenHere > 0 ? `${drivenHere} of ${total} driven` : undefined}
                title={
                  drivenHere > 0
                    ? `${drivenHere} of ${total} controls here are driven — see the Modulation page`
                    : undefined
                }
              >
                {drivenHere > 0 ? `${drivenHere}/${total}` : total}
              </span>
            </button>
            {open && (
              <div className="param-group-body">
                {curated.map(row)}
                {mine.map((e, i) => (
                  <Fragment key={`x${i}`}>{e.node}</Fragment>
                ))}
                {/* SIBLING of .group-head, never a child: that header is
                    itself a <button>, and a button in a button is invalid
                    HTML the browser reparents, firing both handlers on one
                    click. */}
                {expert.length > 0 && (
                  <button
                    type="button"
                    className={`group-advanced ${tierOpen ? "open" : ""}`}
                    aria-expanded={tierOpen}
                    title="Expert controls — every internal constant of this group"
                    onClick={() => props.onToggleAdvanced(group.id, !tierOpen)}
                  >
                    <span className="group-chevron">▸</span>
                    <span className="group-advanced-label">
                      {expert.length} expert {expert.length === 1 ? "control" : "controls"}
                    </span>
                    <ExpertChanged specs={expert} />
                  </button>
                )}
                {tierOpen && expert.map(row)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
