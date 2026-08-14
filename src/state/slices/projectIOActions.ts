import { APP_VERSION } from "../../version";
import { safeName } from "../batch";
import { clearHistory, historyDepths, popRedo, popUndo } from "../history";
import { wasPreviousExitClean } from "../persistence";
import { isTauri, openTextFile, readAutosave, saveTextFile, writeAutosave } from "../platform";
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
     * P-11: the desktop boot chokepoint. The synchronous initial state (built
     * at module scope in store.ts from the 17 localStorage document keys —
     * see .superpowers/p11-lane-log.md's Task 1 map) is already on screen by
     * the time this runs; it is now ONLY the fallback this function falls
     * back to, never the thing a user is meant to keep looking at. Runs once,
     * unconditionally, every desktop launch — not gated on "did we crash"
     * the way the old `checkAutosaveRecovery` was, because the autosave file
     * is simply the document now, not a special crash artifact.
     *
     * `readAutosave`/`parseProject` are best-effort by construction: missing,
     * unreadable, truncated or newer-schema-than-this-build content all fall
     * back to exactly what's already showing (localStorage's synchronous
     * read), so boot can never white-screen on a bad file. On that fallback
     * path this also establishes the autosave file immediately (rather than
     * waiting up to autosaveIntervalSec for the user's first edit), so the
     * NEXT boot has one to prefer — the plan's recorded "boot from
     * localStorage ONCE" migration preference.
     *
     * `undoDepth === 0` is the guard against the one real risk here: this is
     * async, and if the read is unusually slow (a large embedded background
     * asset, a slow disk) a user could in principle start editing before it
     * resolves. undoDepth is hardcoded to 0 in the synchronous initial state
     * and only ever moves via a record()-backed action, so it is an exact,
     * cheap proxy for "nothing has happened since boot yet" — silently
     * replacing a real in-session edit with whatever was on disk a moment
     * earlier would be its own data-loss bug.
     *
     * Browser build: isTauri() gates this at the one entrypoint — readAutosave
     * and writeAutosave already no-op there too, but the explicit early
     * return keeps that provable by inspection alone.
     *
     * P-11 Task 4 — what became of the old Restore/Discard prompt: applying
     * is no longer conditional on "did we crash" (it happens every launch,
     * silently, per the paragraphs above), so there are never two competing
     * candidate documents for a user to choose between any more — nothing
     * left to discard TO. The one thing that choice-driven flow gave that a
     * silent apply doesn't is AWARENESS that a crash happened at all, which
     * this preserves as a passive, one-time flashNotice (the exact sentence
     * the old restoreAutosave() used) instead of an actionable bar — fired
     * only when there's something genuinely worth telling the user (the
     * previous exit was unclean AND the autosave actually applied; a clean
     * exit, same as today, stays completely silent — the common path).
     */
    async bootDesktopDocument() {
      if (!isTauri()) return;
      const contents = await readAutosave();
      if (contents !== null) {
        try {
          const doc = parseProject(contents);
          if (get().undoDepth === 0) {
            const recovering = !wasPreviousExitClean();
            get().applyDocument(doc);
            if (recovering) ctx.flashNotice("Recovered your work from the last session");
          } else {
            console.warn(
              "[autosave] the user already edited before boot resolved — keeping their edits",
            );
          }
          return;
        } catch (e) {
          console.warn("[autosave] unusable, falling back to the last session cache", e);
        }
      }
      // Missing or unparseable: docOf(get()) is already the localStorage
      // fallback (nothing to apply) — just make sure a file exists for next
      // time, immediately rather than debounced.
      void writeAutosave(serializeProject(ctx.docOf(get()), APP_VERSION)).catch((e) => {
        console.warn("[autosave] initial write failed", e);
      });
    },
  } satisfies Partial<VizState>;
}
