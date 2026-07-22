import { useEffect } from "react";
import { presets } from "../render/presets";
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
      if (isTextEntry) return;

      const s = store();
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
        const all = [...presets, ...s.customDefs];
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
          // README + docs/guide.md both tell users to press ? for shortcuts.
          s.setShowHelp(!s.showHelp);
          break;
        case "m":
        case "M":
          s.applyVolume(s.volume, !s.muted);
          break;
        case "l":
        case "L":
          s.toggleLoop();
          break;
        case "[":
          s.stepPreset(-1);
          break;
        case "]":
          s.stepPreset(1);
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
        case "\\":
          s.setStageMode(!s.stageMode);
          break;
        case ".":
          if (s.stageMode) s.setBlackout(!s.blackout);
          break;
        case "Escape":
          s.setShowHelp(false);
          s.setShowSettings(false);
          if (!s.exporting) s.setShowExport(false);
          // Never let Escape dismiss a running queue out from under itself.
          if (s.batchStatus !== "running") s.setShowBatch(false);
          if (s.stageMode) s.setStageMode(false);
          // The shader editor is intentionally NOT touched here (L12): it
          // holds unsaved WGSL, so it handles its own Escape locally (with a
          // confirm-before-discard gate) and stops the key event from
          // reaching this handler — see ShaderEditor.tsx's onKeyDown.
          s.setShowPanel(false);
          s.setShowLibrary(false);
          s.setShowTimeline(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
