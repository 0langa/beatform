import { APP_VERSION } from "../../version";
import { safeName } from "../batch";
import { clearHistory, historyDepths, popRedo, popUndo } from "../history";
import { wasPreviousExitClean } from "../persistence";
import { clearAutosave, isTauri, openTextFile, readAutosave, saveTextFile } from "../platform";
import {
  parseProject,
  PROJECT_EXTENSION,
  ProjectParseError,
  serializeProject,
  validateDocument,
} from "../project";
import { parseTheme, serializeTheme, ThemeParseError } from "../themes";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

export function projectIOActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    applyTheme(document, name) {
      // ONE history entry: Ctrl+Z restores the entire previous setup.
      ctx.record("theme");
      get().applyDocument(document);
      ctx.flashNotice(`Theme "${name}" applied`);
    },

    importThemeText(contents) {
      try {
        const { meta, document } = parseTheme(contents);
        get().applyTheme(document, meta.name);
        if (meta.author !== "unknown") ctx.flashNotice(`"${meta.name}" by ${meta.author} applied`);
      } catch (e) {
        set({
          error:
            e instanceof ThemeParseError
              ? `Could not import theme: ${e.message}`
              : `Could not import theme: ${(e as Error).message}`,
        });
      }
    },

    async exportCurrentTheme(meta) {
      try {
        const path = await saveTextFile(
          `${safeName(meta.name)}.bftheme`,
          serializeTheme(ctx.docOf(get()), meta, APP_VERSION),
          [{ name: "Beatform theme", extensions: ["bftheme"] }],
        );
        if (path) ctx.flashNotice(`Theme "${meta.name}" saved — share the file anywhere`);
      } catch (e) {
        set({ error: `Could not save theme: ${(e as Error).message}` });
      }
    },

    undo() {
      const snapshot = popUndo(ctx.docOf(get()));
      if (snapshot) {
        get().applyDocument(snapshot);
        ctx.flashNotice("Undone");
      }
      const d = historyDepths();
      set({ undoDepth: d.undo, redoDepth: d.redo });
    },

    redo() {
      const snapshot = popRedo(ctx.docOf(get()));
      if (snapshot) {
        get().applyDocument(snapshot);
        ctx.flashNotice("Redone");
      }
      const d = historyDepths();
      set({ undoDepth: d.undo, redoDepth: d.redo });
    },

    newProject() {
      // One-click escape hatch back to a clean document: everything a
      // project file carries resets to defaults (timeline OFF, overlays and
      // assets gone, params/post/motion/lyric style/audiogram/builder stack
      // default). Session things (loaded track, volume, prefs) stay. Runs
      // through the ordinary undo path, so it is a single Ctrl+Z to regret.
      ctx.record("new-project");
      get().applyDocument(validateDocument({}));
      ctx.flashNotice("New project — everything reset to defaults");
    },

    async saveProject() {
      // docOf, not a hand-copied literal: the inline copy silently missed
      // every new document field (it shipped v9 saves without lyricStyle).
      const doc = ctx.docOf(get());
      try {
        const saved = await saveTextFile(
          `visualization.${PROJECT_EXTENSION}`,
          serializeProject(doc, APP_VERSION),
          [{ name: "Beatform project", extensions: [PROJECT_EXTENSION] }],
        );
        if (saved) ctx.flashNotice(`Project saved${isTauri() ? ` to ${saved}` : ""}`);
      } catch (e) {
        set({ error: `Could not save project: ${(e as Error).message}` });
      }
    },

    /**
     * Open a project from text the caller already has — the drag-drop path.
     * Shares every rule with openProject(): parse BEFORE clearHistory so a
     * corrupt file can't cost the undo stack, then applyDocument.
     *
     * Without this, a dropped .bfproj fell through the drop handler's
     * extension dispatch to loadFile() and was handed to the AUDIO decoder,
     * which reported the baffling "Unable to decode audio data".
     */
    openProjectText(name, contents) {
      try {
        const doc = parseProject(contents);
        clearHistory();
        get().applyDocument(doc);
        set({ undoDepth: 0, redoDepth: 0 });
        ctx.flashNotice(`Project "${name}" loaded`);
      } catch (e) {
        set({
          error:
            e instanceof ProjectParseError
              ? `Could not open project: ${e.message}`
              : `Could not open project: ${(e as Error).message}`,
        });
      }
    },

    async openProject() {
      try {
        const picked = await openTextFile([
          { name: "Beatform project", extensions: [PROJECT_EXTENSION] },
        ]);
        if (!picked) return;
        // Parse BEFORE clearing history: a corrupt file must not cost the
        // session's undo stack when nothing gets loaded.
        const doc = parseProject(picked.contents);
        clearHistory();
        get().applyDocument(doc);
        set({ undoDepth: 0, redoDepth: 0 });
        ctx.flashNotice(`Project "${picked.name}" loaded`);
      } catch (e) {
        set({
          error:
            e instanceof ProjectParseError
              ? `Could not open project: ${e.message}`
              : `Could not open project: ${(e as Error).message}`,
        });
      }
    },

    /**
     * Boot-time half of the autosave. Offers recovery only when the last
     * session did NOT exit cleanly — an ordinary quit leaves the marker at "1"
     * and this returns silently, so the common path shows nothing at all.
     *
     * Everything here is best-effort: a missing, unparseable or truncated
     * autosave must never keep the app from starting.
     */
    async checkAutosaveRecovery() {
      if (wasPreviousExitClean()) {
        // Clean quit — the file on disk is a duplicate of what localStorage
        // already restored. Drop it so a LATER crash can't offer stale work.
        void clearAutosave();
        return;
      }
      const contents = await readAutosave();
      if (contents === null) return;
      try {
        set({ recoveredDoc: parseProject(contents) });
      } catch (e) {
        console.warn("[autosave] unusable, discarding", e);
        void clearAutosave();
      }
    },

    restoreAutosave() {
      const doc = get().recoveredDoc;
      if (!doc) return;
      // Same treatment as opening a project: the recovered document becomes
      // the new baseline, so undo can't step back into the pre-boot state.
      clearHistory();
      set({ recoveredDoc: null, undoDepth: 0, redoDepth: 0 });
      get().applyDocument(doc);
      ctx.flashNotice("Recovered your work from the last session");
    },

    dismissAutosave() {
      set({ recoveredDoc: null });
      void clearAutosave();
    },
  } satisfies Partial<VizState>;
}
