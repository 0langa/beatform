// @vitest-environment jsdom
// PREFS_TABS lives in SettingsDialog.tsx, which imports the zustand store —
// store.ts reads localStorage at module scope (initialPresetId etc.), so
// anything that reaches PREFS_TABS transitively needs a DOM environment.
// Plain node (vitest's default here) throws "localStorage is not defined"
// at import time, not at a normal assertion — verified directly before
// writing this file.
import { describe, expect, it } from "vitest";
import { derivedMarkdown, derivedTables } from "./guideDerived";
import { SHORTCUT_SHEET } from "./useAppShortcuts";
import { MOD_SOURCES } from "../state/modMatrix";
import { PREFS_TABS } from "./SettingsDialog";

/**
 * guideDerived.ts has exactly one job: stop the guide from hand-copying
 * tables that already live somewhere else. Every assertion below traces a
 * DerivedTables field (or a derivedMarkdown() string) back to the one real
 * registry that owns it — SHORTCUT_SHEET, MOD_SOURCES, PREFS_TABS — never to
 * a value re-typed into this file.
 */

describe("derivedTables", () => {
  it("passes SHORTCUT_SHEET through unchanged — the same array, not a copy", () => {
    expect(derivedTables().shortcutSheet).toBe(SHORTCUT_SHEET);
  });

  it("passes MOD_SOURCES through unchanged — the same array, not a copy", () => {
    expect(derivedTables().modSources).toBe(MOD_SOURCES);
  });

  it("carries the two H7a facts (Drive, Drive pulse) — asserted by id read FROM MOD_SOURCES, never hardcoded", () => {
    // BACKLOG.md H7a: "Missing from BOTH (2, found in the code): Drive and
    // Drive pulse, the first two entries of MOD_SOURCES" — the exact
    // regression a hand-copied list could reintroduce. Reading the ids from
    // MOD_SOURCES itself (rather than typing literal id strings here) means
    // this test still means the same thing even if an id is ever renamed —
    // note the registry's actual id for "Drive pulse" is `driveBeat`, not
    // the `drivePulse` spelling in the task brief's prose; sourcing the id
    // from the registry sidesteps that mismatch entirely.
    const drive = MOD_SOURCES.find((s) => s.label === "Drive");
    const drivePulse = MOD_SOURCES.find((s) => s.label === "Drive pulse");
    expect(drive).toBeDefined();
    expect(drivePulse).toBeDefined();
    const ids = derivedTables().modSources.map((s) => s.id);
    expect(ids).toContain(drive!.id);
    expect(ids).toContain(drivePulse!.id);
  });

  it("passes PREFS_TABS through unchanged — the same array, not a copy", () => {
    expect(derivedTables().prefsTabs).toBe(PREFS_TABS);
  });

  it("prefsTabs labels are General/Modes/Performance/Updates, read from the export", () => {
    expect(derivedTables().prefsTabs.map((t) => t.label)).toEqual([
      "General",
      "Modes",
      "Performance",
      "Updates",
    ]);
  });
});

describe("derivedMarkdown().render", () => {
  it('"shortcut-sheet" — one heading per group in first-seen order, a <kbd> + action line per row, notes in parens', () => {
    const md = derivedMarkdown().render("shortcut-sheet");
    // Groups present in SHORTCUT_SHEET today: Playback, Performance,
    // Panels & dialogs, Editing. "Modes" is a declared group with zero rows
    // (Task 2's finding) and must not manufacture an empty heading.
    expect(md).toContain("### Playback");
    expect(md).toContain("### Performance");
    expect(md).toContain("### Panels & dialogs");
    expect(md).toContain("### Editing");
    expect(md).not.toContain("### Modes");
    // A real multi-key row: keys joined " / ", each wrapped in its own <kbd>.
    expect(md).toContain("<kbd>N</kbd> / <kbd>P</kbd> — Step to the next or previous visual mode");
    // A row with a note — the note trails the action, in parentheses.
    expect(md).toContain(
      "<kbd>[</kbd> / <kbd>]</kbd> — Step to the next or previous visual mode (physical key — layout-independent)",
    );
    // Heading precedes its own group's rows.
    expect(md.indexOf("### Playback")).toBeLessThan(md.indexOf("<kbd>Space</kbd>"));
  });

  it("renders exactly one heading per distinct group present in SHORTCUT_SHEET", () => {
    const md = derivedMarkdown().render("shortcut-sheet");
    const groupsInData = new Set(SHORTCUT_SHEET.map((r) => r.group));
    const headingsInMd = md.match(/^### .+$/gm) ?? [];
    expect(headingsInMd.length).toBe(groupsInData.size);
  });

  it("renders exactly one row line per SHORTCUT_SHEET entry", () => {
    const md = derivedMarkdown().render("shortcut-sheet");
    const rowLines = md.split("\n").filter((l) => l.startsWith("<kbd>"));
    expect(rowLines.length).toBe(SHORTCUT_SHEET.length);
  });

  it('"mod-sources" — a "- **<label>**" list from MOD_SOURCES, in registry order, nothing appended', () => {
    const md = derivedMarkdown().render("mod-sources");
    const expected = MOD_SOURCES.map((s) => `- **${s.label}**`).join("\n");
    expect(md).toBe(expected);
    // The LFO-family sentence is Task 5's migration to add via the data —
    // this renderer emits only the list (this task's scope note, not the
    // brief's literal text — see task-3-report.md).
    expect(md).not.toMatch(/LFO/i);
  });

  it('"preferences-tabs" — one bullet, tab labels joined by " · ", built from PREFS_TABS', () => {
    const md = derivedMarkdown().render("preferences-tabs");
    expect(md).toBe("- **General** · **Modes** · **Performance** · **Updates**");
    expect(md).toContain("**Modes**");
  });
});
