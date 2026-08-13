import type { DerivedKind } from "./guideContent";
import { SHORTCUT_SHEET, type ShortcutRow } from "./useAppShortcuts";
import { MOD_SOURCES } from "../state/modMatrix";
import { PREFS_TABS } from "./SettingsDialog";

/**
 * The one place the guide (both the in-app renderer and the generated
 * docs/guide.md) reaches for tables that already have a real owner
 * elsewhere: the keyboard shortcut sheet, the modulation source list, and
 * the Preferences tab strip. Nothing here re-types content — every field is
 * the source registry itself (or a string built straight from it), so a row
 * added to SHORTCUT_SHEET/MOD_SOURCES/PREFS_TABS shows up in the guide with
 * no second edit and no way to fall behind (this is P-21's whole point,
 * closing BACKLOG.md's H7a).
 */
export interface DerivedTables {
  shortcutSheet: typeof SHORTCUT_SHEET;
  modSources: ReadonlyArray<{ id: string; label: string }>;
  prefsTabs: ReadonlyArray<{ label: string }>;
}

export function derivedTables(): DerivedTables {
  return {
    shortcutSheet: SHORTCUT_SHEET,
    modSources: MOD_SOURCES,
    prefsTabs: PREFS_TABS,
  };
}

/** Groups SHORTCUT_SHEET by `group`, preserving first-seen order — no
 * hand-listed group order to fall out of sync with the data (today that's
 * Playback, Performance, Panels & dialogs, Editing; "Modes" is a declared
 * group with no rows yet, so it never emits an empty heading). */
function groupShortcuts(): Array<[ShortcutRow["group"], ShortcutRow[]]> {
  const order: ShortcutRow["group"][] = [];
  const byGroup = new Map<ShortcutRow["group"], ShortcutRow[]>();
  for (const row of SHORTCUT_SHEET) {
    let rows = byGroup.get(row.group);
    if (!rows) {
      rows = [];
      byGroup.set(row.group, rows);
      order.push(row.group);
    }
    rows.push(row);
  }
  return order.map((group) => [group, byGroup.get(group)!]);
}

function renderShortcutSheetRow(row: ShortcutRow): string {
  const keys = row.keys.map((k) => `<kbd>${k}</kbd>`).join(" / ");
  const note = row.note ? ` (${row.note})` : "";
  return `${keys} — ${row.action}${note}`;
}

function renderShortcutSheet(): string {
  return groupShortcuts()
    .map(([group, rows]) => `### ${group}\n\n${rows.map(renderShortcutSheetRow).join("\n")}`)
    .join("\n\n");
}

function renderModSources(): string {
  // Just the list — the fixed LFO-family sentence is Task 5's migration to
  // append via the data (see task-3-report.md's scope note).
  return MOD_SOURCES.map((s) => `- **${s.label}**`).join("\n");
}

function renderPrefsTabs(): string {
  return `- ${PREFS_TABS.map((t) => `**${t.label}**`).join(" · ")}`;
}

function render(kind: DerivedKind): string {
  if (kind === "shortcut-sheet") return renderShortcutSheet();
  if (kind === "mod-sources") return renderModSources();
  if (kind === "preferences-tabs") return renderPrefsTabs();
  // Exhaustiveness: a new DerivedKind fails typecheck here, not silently.
  return kind satisfies never;
}

export function derivedMarkdown(): { render(kind: DerivedKind): string } {
  return { render };
}
