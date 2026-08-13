import { useEffect } from "react";
import { orderedPresets } from "../state/presetOrder";
import type { useVizStore } from "../state/store";

/** Input types that are real text entry — these swallow every shortcut. A
 * range/color/checkbox/file input is NOT text entry and must not block Ctrl+Z. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "password", "number", "tel"]);

/** Keys a focused form control handles natively (slider stepping, select
 * navigation) — the global shortcuts must not double-handle them. */
const NATIVE_CONTROL_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  " ",
]);

export function toggleFullscreen(): void {
  // Rejections are expected where the Fullscreen API is policy-blocked
  // (embedded webviews) — treat as a no-op, not an error.
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  } else {
    document.documentElement.requestFullscreen().catch(() => undefined);
  }
}

/**
 * The app's global keyboard map, extracted whole from App.tsx. One window
 * keydown listener; `store` is the stable useVizStore.getState accessor so
 * the listener binds once and reads fresh state per keypress.
 */
export function useAppShortcuts(store: typeof useVizStore.getState): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      const inputType = (el as HTMLInputElement | null)?.type ?? "";
      // Genuine text entry swallows everything, so typing never fires a
      // shortcut and the field keeps its own native undo.
      const isTextEntry =
        tag === "TEXTAREA" ||
        el?.isContentEditable === true ||
        (tag === "INPUT" && TEXT_INPUT_TYPES.has(inputType));

      const s = store();
      // Escape is the universal way out — handled BEFORE every guard. It used
      // to sit behind the SELECT/native-control filters, so with focus on a
      // dropdown Esc was swallowed and Stage mode felt stuck (QWERTZ report).
      if (e.key === "Escape") {
        // …except while TYPING (audit UI-1): Esc in a text field cancels the
        // field, nothing more. The save-look form's own onKeyDown closes its
        // mini-form and the same keypress used to bubble here and tear down
        // the whole panel stack; panel/gallery search lost their query with
        // the surface around them. Blur only — the next Esc (focus now off
        // the field) runs the normal cascade below.
        if (isTextEntry) {
          el?.blur();
          return;
        }
        s.setShowHelp(false);
        s.setShowGuide(false);
        s.setShowSettings(false);
        if (!s.exporting) s.setShowExport(false);
        // Never let Escape dismiss a running queue out from under itself.
        if (s.batchStatus !== "running") s.setShowBatch(false);
        if (s.stageMode) s.setStageMode(false); // also clears blackout
        // The shader editor handles its own Escape (confirm-before-discard)
        // and stops propagation before this handler sees it.
        s.setShowPanel(false);
        s.setShowLibrary(false);
        s.setShowGallery(false);
        s.setShowTimeline(false);
        return;
      }
      if (isTextEntry) return;

      // AltGr (Ctrl+Alt on Windows) TYPES characters on many layouts — on
      // QWERTZ, [ ] \ @ etc. all arrive with ctrlKey+altKey set. Treating
      // those as shortcuts fired random actions while typing (the QWERTZ
      // Stage-mode report). AltGr chords are never app shortcuts.
      if (e.ctrlKey && e.altKey) return;

      // Layout-independent PHYSICAL keys for the performance shortcuts: on
      // QWERTZ (and most non-US layouts) the [ ] \ characters need AltGr,
      // which the guard above ignores — so bind the physical key positions
      // via e.code instead. US layouts hit the same keys either way.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === "BracketLeft") {
          s.stepPreset(-1);
          return;
        }
        if (e.code === "BracketRight") {
          s.stepPreset(1);
          return;
        }
        if (e.code === "Backslash") {
          s.setStageMode(!s.stageMode);
          return;
        }
      }
      // Ctrl/Cmd shortcuts run from anywhere else — including a focused slider
      // or select, which is exactly the moment a user reaches for undo/save.
      // (This branch used to sit BELOW a blanket INPUT/SELECT/TEXTAREA guard,
      // so touching any slider silently killed Ctrl+Z/Y/S/O until focus moved.)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === ",") {
          e.preventDefault();
          s.setShowSettings(!s.showSettings);
        } else if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          void s.saveProject();
        } else if (e.key === "o" || e.key === "O") {
          e.preventDefault();
          void s.openProject();
        } else if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          if (e.shiftKey) s.redo();
          else s.undo();
        } else if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          s.redo();
        }
        return;
      }
      // Plain-key shortcuts: a focused slider/checkbox owns its navigation
      // keys, and a focused <select> owns letters too (they jump options).
      // Everything else (G, T, B, Q, F, \, [, ], digits…) still works.
      if ((tag === "INPUT" || tag === "SELECT") && NATIVE_CONTROL_KEYS.has(e.key)) return;
      if (tag === "SELECT") return;
      // Number keys 1-9 jump to a mode by position, beat-quantized when the
      // Quantize control is on (the switch lands on the next beat/bar).
      if (e.key >= "1" && e.key <= "9") {
        // "Position" means position ON THE STRIP — the digits have to address
        // the chips the user can see, or a custom order would silently break
        // every muscle-memory binding in a live set.
        const all = orderedPresets(s.presetOrder, s.customDefs);
        const target = all[Number(e.key) - 1];
        if (target) s.queuePreset(target.id);
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          void s.togglePlay();
          break;
        case "ArrowLeft":
          s.seekBy(-5);
          break;
        case "ArrowRight":
          s.seekBy(5);
          break;
        case "ArrowUp":
          e.preventDefault();
          s.applyVolume(Math.min(1, s.volume + 0.05), false);
          break;
        case "ArrowDown":
          e.preventDefault();
          s.applyVolume(Math.max(0, s.volume - 0.05), false);
          break;
        case "?":
        case "h":
        case "H":
          // H is the layout-proof binding; ? kept for muscle memory (README
          // and docs historically said "press ?").
          s.setShowHelp(!s.showHelp);
          break;
        // Letters and digits are the only keys whose printed label matches on
        // every major layout (QWERTY/QWERTZ/AZERTY/…) — symbol keys move or
        // need AltGr/Shift. So every performance shortcut has a letter/digit
        // PRIMARY binding; the physical-position symbol keys above stay as
        // secondaries for US-layout muscle memory.
        case "p":
        case "P":
          s.stepPreset(-1);
          break;
        case "n":
        case "N":
          s.stepPreset(1);
          break;
        case "s":
        case "S":
          s.setStageMode(!s.stageMode);
          break;
        case "0":
          // 0 = blackout completes the digit row: 1-9 pick a mode, 0 cuts to
          // black (Stage mode only, like the legacy "." binding).
          if (s.stageMode) s.setBlackout(!s.blackout);
          break;
        case "m":
        case "M":
          s.applyVolume(s.volume, !s.muted);
          break;
        case "l":
        case "L":
          s.toggleLoop();
          break;
        case "i":
        case "I":
          s.setLoopStart();
          break;
        case "o":
        case "O":
          s.setLoopEnd();
          break;
        case "g":
        case "G":
          s.setShowPanel((v) => !v);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "t":
        case "T":
          s.setShowTimeline(!s.showTimeline);
          break;
        case "b":
        case "B":
          // Same guard the ✕, Escape and the backdrop enforce: a running queue
          // must not be dismissable behind the user's back.
          if (!(s.showBatch && s.batchStatus === "running")) s.setShowBatch(!s.showBatch);
          break;
        case "q":
        case "Q":
          s.setShowLibrary(!s.showLibrary);
          break;
        case ".":
          if (s.stageMode) s.setBlackout(!s.blackout);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}

export interface ShortcutRow {
  /** Display labels, e.g. ["Space"], ["N","P"], ["[","]"] */
  keys: string[];
  /** The e.key / e.code literals the handler matches for this row —
   *  the coverage test's join column. */
  literals: string[];
  action: string; // user-facing, friendly voice
  group: "Playback" | "Modes" | "Panels & dialogs" | "Performance" | "Editing";
  note?: string; // e.g. "physical key — layout-independent"
}

// One row per binding, transcribed from the red coverage listing above plus
// the handler's own comments. Groups follow the app's own vocabulary:
// README.md's "Live performance / VJ" bullet and the handler's repeated
// "every performance shortcut has a letter/digit PRIMARY binding" comment
// both use "performance" for mode-stepping, the digit strip, Stage mode and
// blackout together — so that's the "Performance" bucket here, distinct from
// the Preferences dialog's "Modes" tab (preset order), which has no
// keyboard shortcut of its own.
export const SHORTCUT_SHEET: readonly ShortcutRow[] = [
  // Playback
  { keys: ["Space"], literals: [" "], action: "Play or pause", group: "Playback" },
  { keys: ["←"], literals: ["ArrowLeft"], action: "Seek back 5 seconds", group: "Playback" },
  { keys: ["→"], literals: ["ArrowRight"], action: "Seek forward 5 seconds", group: "Playback" },
  { keys: ["↑"], literals: ["ArrowUp"], action: "Raise the volume", group: "Playback" },
  { keys: ["↓"], literals: ["ArrowDown"], action: "Lower the volume", group: "Playback" },
  { keys: ["M"], literals: ["m", "M"], action: "Mute or unmute", group: "Playback" },
  { keys: ["L"], literals: ["l", "L"], action: "Toggle A/B loop", group: "Playback" },
  { keys: ["I"], literals: ["i", "I"], action: "Set the loop start (in point)", group: "Playback" },
  { keys: ["O"], literals: ["o", "O"], action: "Set the loop end (out point)", group: "Playback" },

  // Performance — everything the README's "Live performance / VJ" bullet
  // and the handler's own comments call out as performance shortcuts.
  {
    keys: ["N", "P"],
    literals: ["n", "N", "p", "P"],
    action: "Step to the next or previous visual mode",
    group: "Performance",
  },
  {
    keys: ["[", "]"],
    literals: ["BracketLeft", "BracketRight"],
    action: "Step to the next or previous visual mode",
    group: "Performance",
    note: "physical key — layout-independent",
  },
  {
    keys: ["1–9"],
    literals: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    action: "Jump straight to the mode at that strip position",
    group: "Performance",
  },
  {
    keys: ["S"],
    literals: ["s", "S"],
    action: "Toggle Stage mode",
    group: "Performance",
  },
  {
    keys: ["\\"],
    literals: ["Backslash"],
    action: "Toggle Stage mode",
    group: "Performance",
    note: "physical key — layout-independent",
  },
  {
    keys: ["0"],
    literals: ["0"],
    action: "Cut to black",
    group: "Performance",
    note: "Stage mode only",
  },
  {
    keys: ["."],
    literals: ["."],
    action: "Cut to black",
    group: "Performance",
    note: "Stage mode only — legacy alias for 0",
  },

  // Panels & dialogs
  {
    keys: ["G"],
    literals: ["g", "G"],
    action: "Toggle the Visuals panel",
    group: "Panels & dialogs",
  },
  { keys: ["Q"], literals: ["q", "Q"], action: "Toggle the Library", group: "Panels & dialogs" },
  { keys: ["T"], literals: ["t", "T"], action: "Toggle the Timeline", group: "Panels & dialogs" },
  {
    keys: ["B"],
    literals: ["b", "B"],
    action: "Toggle the batch export queue",
    group: "Panels & dialogs",
  },
  {
    keys: ["H", "?"],
    literals: ["h", "H", "?"],
    action: "Toggle this shortcuts sheet",
    group: "Panels & dialogs",
    note: "H is layout-independent; ? kept for muscle memory",
  },
  {
    keys: ["Ctrl/Cmd+,"],
    literals: [","],
    action: "Toggle Preferences",
    group: "Panels & dialogs",
  },
  { keys: ["F"], literals: ["f", "F"], action: "Toggle fullscreen", group: "Panels & dialogs" },

  // Editing
  { keys: ["Ctrl/Cmd+S"], literals: ["s", "S"], action: "Save the project", group: "Editing" },
  { keys: ["Ctrl/Cmd+O"], literals: ["o", "O"], action: "Open a project", group: "Editing" },
  { keys: ["Ctrl/Cmd+Z"], literals: ["z", "Z"], action: "Undo the last change", group: "Editing" },
  {
    keys: ["Ctrl/Cmd+Shift+Z"],
    literals: ["z", "Z"],
    action: "Redo the last undone change",
    group: "Editing",
    note: "same key as Undo, plus Shift",
  },
  {
    keys: ["Ctrl/Cmd+Y"],
    literals: ["y", "Y"],
    action: "Redo the last undone change",
    group: "Editing",
  },
];

/**
 * Groups SHORTCUT_SHEET rows by `group`, preserving first-seen order — the
 * help dialog's (App.tsx, P-21 Task 6) row-building helper. The guide's own
 * renderers, guideDerived.ts's groupShortcuts() (markdown) and
 * GuideBlocks.tsx's groupShortcuts() (JSX over the DerivedTables shape),
 * each carry their own copy of this same small algorithm — see
 * GuideBlocks.tsx's comment for why; this one stays on the raw ShortcutRow
 * type so App.tsx can consume SHORTCUT_SHEET directly, per this task's
 * interface, with no dependency on the guide's abstraction.
 *
 * Takes `sheet` as a parameter (default SHORTCUT_SHEET) rather than closing
 * over the module constant, so a test can feed a mutated fixture and prove
 * the grouping is actually driven by its argument.
 */
export function groupShortcutRows(
  sheet: readonly ShortcutRow[] = SHORTCUT_SHEET,
): Array<{ group: ShortcutRow["group"]; rows: ShortcutRow[] }> {
  const order: ShortcutRow["group"][] = [];
  const byGroup = new Map<ShortcutRow["group"], ShortcutRow[]>();
  for (const row of sheet) {
    let rows = byGroup.get(row.group);
    if (!rows) {
      rows = [];
      byGroup.set(row.group, rows);
      order.push(row.group);
    }
    rows.push(row);
  }
  return order.map((group) => ({ group, rows: byGroup.get(group)! }));
}
