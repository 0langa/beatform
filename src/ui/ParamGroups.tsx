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
  /** false = essentials (the `params` tier only); true = every knob. */
  showAdvanced: boolean;
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

  // Search deliberately ignores the essentials/all switch. A user who types
  // "vignette" is asking where it is, and answering "nowhere" because the knob
  // happens to live in the expert tier is how the old panel hid two thirds of
  // itself (the advanced drawer was never searched at all).
  const visible: ParamSpec[] = allParams(preset).filter((spec) =>
    searching
      ? paramSearchText(spec).includes(query)
      : props.showAdvanced || !advanced.has(spec.key),
  );

  const extras = (props.extras ?? []).filter((e) => !searching || e.search.includes(query));
  const shown = groupParams(preset, visible);
  // An extra whose group ended up with no visible rows still has to render —
  // groupParams drops empty groups, and the centre-image picker would go with
  // it the moment its group's knobs are filtered out.
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

  return (
    <div className="param-groups">
      {shown.map(({ group, params }) => {
        // While searching every group is forced open: a collapsed group that
        // contains the one match would make search look broken.
        const open = searching || !props.collapsed.includes(GROUP_KEY + group.id);
        const mine = extras.filter((e) => e.group === group.id);
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
              <span className="group-count">{params.length + mine.length}</span>
            </button>
            {open && (
              <div className="param-group-body">
                {params.map((spec) => (
                  <div
                    key={spec.key}
                    // Marks an expert-tier knob once "All" is on, so the extra
                    // rows read as extra instead of merging into the essentials
                    // the user actually reaches for.
                    className={`param-slot ${advanced.has(spec.key) ? "is-advanced" : ""}`}
                  >
                    <ParamRow
                      spec={spec}
                      value={props.params[spec.key] ?? spec.default}
                      onChange={(v) => props.onParam(spec.key, v)}
                      onHint={props.onHint}
                    />
                  </div>
                ))}
                {mine.map((e, i) => (
                  <Fragment key={`x${i}`}>{e.node}</Fragment>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
