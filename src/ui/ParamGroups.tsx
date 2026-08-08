import { Fragment, type ReactNode } from "react";
import type { ParamSpec, ParamValues, PresetDef } from "../render/types";
import {
  advancedKeys,
  allParams,
  groupParams,
  paramSearchText,
  presetGroups,
} from "../render/types";
import { ParamRow } from "./kit";

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

/** Prefix for group collapse state inside AppPrefs.collapsedSections. Groups
 * and sections share that one persisted list, so their keys must not collide —
 * no section is ever titled "group:…". */
export const GROUP_KEY = "group:";

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
  params: ParamValues;
  onParam: (key: string, value: number) => void;
  onHint: (hint: string | null) => void;
  /** Group ids whose expert tier is OPEN. Absent/empty = every tier closed. */
  advancedGroups?: readonly string[];
  /** Reports the BARE group id; the caller owns persistence. */
  onToggleAdvanced?: (groupId: string, open: boolean) => void;
  /**
   * @deprecated Wave-A shim so this file compiles against the untouched
   * ParamsPanel call site. `true` == every tier open, which is exactly how
   * `advancedOpen: true` seeds `advancedGroups`. Removed in U5.
   */
  showAdvanced?: boolean;
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
  const openTiers = props.advancedGroups ?? [];
  const allTiersOpen = props.showAdvanced === true; // U5 deletes

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

  const row = (spec: ParamSpec) => (
    <div key={spec.key} className={`param-slot ${advanced.has(spec.key) ? "is-advanced" : ""}`}>
      <ParamRow
        spec={spec}
        value={props.params[spec.key] ?? spec.default}
        onChange={(v) => props.onParam(spec.key, v)}
        onHint={props.onHint}
      />
    </div>
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
        const tierOpen = allTiersOpen || openTiers.includes(group.id);
        const changed = expert.filter(
          (s) => (props.params[s.key] ?? s.default) !== s.default,
        ).length;
        return (
          <section className="param-group" key={group.id}>
            <button
              className={`group-head ${open ? "open" : ""}`}
              aria-expanded={open}
              disabled={searching}
              title={group.hint}
              onPointerEnter={() => props.onHint(group.hint ?? null)}
              onPointerLeave={() => props.onHint(null)}
              onFocus={() => props.onHint(group.hint ?? null)}
              onBlur={() => props.onHint(null)}
              onClick={() => props.onToggleGroup(group.id, !open)}
            >
              <span className="group-chevron">▸</span>
              <span className="group-name">{group.label}</span>
              {/* TOTAL, curated + expert: the badge must not shift under the
                  user when a disclosure opens. */}
              <span className="group-count">{params.length + mine.length}</span>
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
                    onClick={() => props.onToggleAdvanced?.(group.id, !tierOpen)}
                  >
                    <span className="group-chevron">▸</span>
                    <span className="group-advanced-label">
                      {expert.length} expert {expert.length === 1 ? "control" : "controls"}
                    </span>
                    {changed > 0 && (
                      <span
                        className="advanced-count"
                        title="Expert knobs that no longer sit at their factory value"
                      >
                        {changed} changed
                      </span>
                    )}
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
