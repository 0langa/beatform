// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { useVizStore } from "../state/store";
import { useAppShortcuts } from "./useAppShortcuts";
import shortcutsSource from "./useAppShortcuts.ts?raw"; // precedent: loopbackWorklet.test.ts
import { SHORTCUT_SHEET, groupShortcutRows } from "./useAppShortcuts";

afterEach(cleanup);

function Harness({ state }: { state: Record<string, unknown> }) {
  useAppShortcuts((() => state) as unknown as typeof useVizStore.getState);
  return <input aria-label="text entry" />;
}

describe("A-B loop shortcuts", () => {
  it("uses layout-stable I/O keys for loop in/out", () => {
    const state = {
      setLoopStart: vi.fn(),
      setLoopEnd: vi.fn(),
    };
    render(<Harness state={state} />);

    fireEvent.keyDown(window, { key: "i", code: "KeyI" });
    fireEvent.keyDown(window, { key: "O", code: "KeyO" });

    expect(state.setLoopStart).toHaveBeenCalledOnce();
    expect(state.setLoopEnd).toHaveBeenCalledOnce();
  });

  it("does not fire markers while the user is typing", () => {
    const state = {
      setLoopStart: vi.fn(),
      setLoopEnd: vi.fn(),
    };
    const { getByRole } = render(<Harness state={state} />);
    const input = getByRole("textbox", { name: "text entry" });

    fireEvent.keyDown(input, { key: "i", code: "KeyI" });
    fireEvent.keyDown(input, { key: "o", code: "KeyO" });

    expect(state.setLoopStart).not.toHaveBeenCalled();
    expect(state.setLoopEnd).not.toHaveBeenCalled();
  });
});

/**
 * The Escape cascade (audit UI-1): Esc is the universal way out of every
 * surface — EXCEPT while typing, where it must cancel the field and nothing
 * else. Before the guard, cancelling a save-look name or clearing the panel
 * search tore down the whole panel stack with the same keypress.
 */
describe("Escape", () => {
  /** Everything the cascade touches, so a stray extra close would throw. */
  function escState() {
    return {
      exporting: null,
      batchStatus: "idle",
      stageMode: false,
      setShowHelp: vi.fn(),
      setShowGuide: vi.fn(),
      setShowSettings: vi.fn(),
      setShowExport: vi.fn(),
      setShowBatch: vi.fn(),
      setStageMode: vi.fn(),
      setShowPanel: vi.fn(),
      setShowLibrary: vi.fn(),
      setShowGallery: vi.fn(),
      setShowTimeline: vi.fn(),
    };
  }

  it("closes the open surfaces when focus is not in a text field", () => {
    const state = escState();
    render(<Harness state={state} />);

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });

    expect(state.setShowPanel).toHaveBeenCalledWith(false);
    expect(state.setShowLibrary).toHaveBeenCalledWith(false);
    expect(state.setShowGallery).toHaveBeenCalledWith(false);
    expect(state.setShowTimeline).toHaveBeenCalledWith(false);
    expect(state.setShowHelp).toHaveBeenCalledWith(false);
  });

  it("only blurs the field while typing — the panel stack stays up", () => {
    const state = escState();
    const { getByRole } = render(<Harness state={state} />);
    const input = getByRole("textbox", { name: "text entry" });
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    expect(document.activeElement).not.toBe(input);
    expect(state.setShowPanel).not.toHaveBeenCalled();
    expect(state.setShowLibrary).not.toHaveBeenCalled();
    expect(state.setShowGallery).not.toHaveBeenCalled();
    expect(state.setShowTimeline).not.toHaveBeenCalled();
    expect(state.setShowHelp).not.toHaveBeenCalled();
    expect(state.setStageMode).not.toHaveBeenCalled();
  });

  it("a second Escape after the blur runs the normal cascade", () => {
    const state = escState();
    const { getByRole } = render(<Harness state={state} />);
    const input = getByRole("textbox", { name: "text entry" });
    input.focus();

    fireEvent.keyDown(input, { key: "Escape", code: "Escape" }); // blur only
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" }); // way out

    expect(state.setShowPanel).toHaveBeenCalledTimes(1);
    expect(state.setShowPanel).toHaveBeenCalledWith(false);
  });
});

describe("SHORTCUT_SHEET covers the handler, both directions", () => {
  // Every quoted literal the handler compares e.key / e.code against.
  // Matches `e.key === "X"` / `e.code === "KeyX"`, and the `case "X":` lines
  // of the plain-key switch (the brief's starting regex only covered
  // `===`; this handler also has a `switch (e.key)` block, so its NOTE says
  // to extend the regex to match — read the file first).
  const handlerLiterals = new Set(
    [
      ...shortcutsSource.matchAll(/e\.(?:key|code)\s*===\s*"([^"]+)"/g),
      ...shortcutsSource.matchAll(/case\s+"([^"]+)"\s*:/g),
    ]
      .map((m) => m[1])
      // Escape is deliberately NOT a sheet row: it is the universal
      // dismiss cascade, documented in prose, not a binding a user learns.
      .filter((k) => k !== "Escape"),
  );
  // The digit-strip shortcuts (jump to a mode by position) are matched with
  // a static range check — `e.key >= "1" && e.key <= "9"` — not a per-key
  // `===`/`case` literal, so neither regex above can see them. The range is
  // fixed and fully known at read time (unlike a truly dynamic key), so
  // expand it explicitly rather than leaving nine real, user-facing
  // bindings invisible to the coverage test.
  if (/e\.key\s*>=\s*"1"\s*&&\s*e\.key\s*<=\s*"9"/.test(shortcutsSource)) {
    for (let d = 1; d <= 9; d++) handlerLiterals.add(String(d));
  }
  const sheetLiterals = new Set(SHORTCUT_SHEET.flatMap((r) => r.literals));

  it("every handled key has a sheet row", () => {
    expect([...handlerLiterals].filter((k) => !sheetLiterals.has(k))).toEqual([]);
  });
  it("every sheet row exists in the handler", () => {
    expect([...sheetLiterals].filter((k) => !handlerLiterals.has(k))).toEqual([]);
  });
  it("rows carry friendly copy", () => {
    for (const r of SHORTCUT_SHEET) {
      expect(r.keys.length).toBeGreaterThan(0);
      expect(r.action.length).toBeGreaterThan(4);
    }
  });
});

/**
 * groupShortcutRows is the help dialog's (App.tsx) row-building helper —
 * P-21 Task 6. It groups SHORTCUT_SHEET by `group`, preserving first-seen
 * order, the same small algorithm guideDerived.ts's private groupShortcuts()
 * and GuideBlocks.tsx's private groupShortcuts() each carry for their own
 * data shape (see GuideBlocks.tsx's comment for why it isn't shared one more
 * time here) — this copy stays on the raw ShortcutRow type so App.tsx can
 * consume SHORTCUT_SHEET directly, with no dependency on the guide's
 * DerivedTables abstraction.
 *
 * Tested at the data level, not by rendering App.tsx: App.tsx pulls in the
 * whole zustand store, audio engine and canvas wiring, so there is no cheap
 * way to mount it in a test (no existing suite does). The dialog's actual
 * JSX just maps this function's output onto the existing shortcut-row/kbd
 * markup — a mechanical step verified visually in the dev preview instead
 * (task-6-report.md).
 */
describe("groupShortcutRows", () => {
  it("produces exactly one row per SHORTCUT_SHEET entry — the help dialog's count assertion", () => {
    const total = groupShortcutRows().reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(SHORTCUT_SHEET.length);
  });

  it("groups in first-seen order — Playback, Performance, Panels & dialogs, Editing", () => {
    // "Modes" is a declared group (useAppShortcuts.ts's ShortcutRow union)
    // with zero rows today (guideDerived.test.ts's finding) — it must not
    // manufacture an empty heading.
    const groups = groupShortcutRows().map((g) => g.group);
    expect(groups).toEqual(["Playback", "Performance", "Panels & dialogs", "Editing"]);
  });

  it("carries a known row's own action text — Space plays or pauses", () => {
    const playback = groupShortcutRows().find((g) => g.group === "Playback");
    const space = playback?.rows.find((r) => r.keys.includes("Space"));
    expect(space?.action).toBe("Play or pause");
  });

  it("mutation check: dropping a row from the input drops the total by exactly one", () => {
    // Proves the count is actually LIVE off the argument, not a hardcoded
    // or memoized number that happens to equal SHORTCUT_SHEET.length today —
    // the brief's "delete-a-row mutation goes red" requirement. Regressing
    // groupShortcutRows to ignore its parameter (e.g. always closing over
    // the module-level SHORTCUT_SHEET) turns this red while the count-only
    // assertion above would stay green, since both sides would shrink together.
    const withoutFirstRow = SHORTCUT_SHEET.slice(1);
    const total = groupShortcutRows(withoutFirstRow).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(SHORTCUT_SHEET.length - 1);
  });

  it("defaults to SHORTCUT_SHEET when called with no argument", () => {
    expect(groupShortcutRows()).toEqual(groupShortcutRows(SHORTCUT_SHEET));
  });
});
