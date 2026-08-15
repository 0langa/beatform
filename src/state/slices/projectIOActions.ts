import { APP_VERSION } from "../../version";
import { safeName } from "../batch";
import { clearHistory, historyDepths, popRedo, popUndo } from "../history";
import { wasPreviousExitClean } from "../persistence";
import {
  isTauri,
  openTextFile,
  quarantineCorruptAutosave,
  quarantineSupersededAutosave,
  readAutosave,
  saveTextFile,
  writeAutosave,
} from "../platform";
import {
  parseProject,
  PROJECT_EXTENSION,
  ProjectParseError,
  serializeProject,
  validateDocument,
  type ProjectDocument,
} from "../project";
import { parseTheme, serializeTheme, ThemeParseError } from "../themes";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

/**
 * Second whole-lane-review round, item 3: React StrictMode (dev only)
 * double-invokes a plain (non-cleanup) effect, so App.tsx's boot
 * useEffect can call `bootDesktopDocument` twice in quick succession
 * while the first call's read is still in flight — same guard-flag shape
 * as `initApp`'s `onCloseRequested` install (store.ts). Reset in a
 * `finally` once a call actually finishes, so this guards CONCURRENT
 * re-entrancy specifically, not repeat calls in general — a later,
 * genuinely sequential call (every test in projectIOActions.test.ts calls
 * this action many times across many `it()` blocks) is never blocked.
 * Module-scoped rather than a VizState field on purpose: it is boot
 * plumbing, not document or session state, and has no reason to be
 * readable from outside this file.
 *
 * Final review round, item 2: this flag is also what makes
 * `bootDesktopDocument`'s ownership synchronously knowable to a caller —
 * see that method's own doc comment (and its VizState declaration in
 * store.ts) for why App.tsx's boot-veil effect needs that.
 */
let bootStarted = false;

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
     * Two guards decide whether the parsed document actually gets applied,
     * covering two DIFFERENT risk classes a slow read (a large embedded
     * background asset, a slow disk) leaves open — whole-lane-review fix I1
     * found the first is not enough on its own:
     *  - `undoDepth === 0`: no raw, record()-backed edit (setParam,
     *    switchPreset, ...) happened since boot. These never call
     *    applyDocument, so only undoDepth catches them.
     *  - `docEpoch === epochAtReadStart`: no applyDocument-backed
     *    replacement (undo, redo, theme-apply, new-project, or — the gap I1
     *    found — a manual project OPEN) happened since boot. `openProject`/
     *    `openProjectText` both FORCE undoDepth to 0 (clearHistory then
     *    `set({undoDepth:0,...})`) — the SAME value a fresh boot already
     *    has — so a drag-dropped .bfproj landing in the read window was
     *    invisible to the undoDepth check alone. docEpoch is a monotonic
     *    counter bumped unconditionally inside applyDocument (see its own
     *    comment in store.ts), so it catches this class the undoDepth guard
     *    structurally cannot.
     * Both together: "nothing has replaced or edited the document by any
     * path since this read started."
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
     * this preserves as a notice (the exact sentence the old restoreAutosave()
     * used) instead of an actionable bar — fired only when there's something
     * genuinely worth telling the user (the previous exit was unclean AND the
     * autosave actually applied; a clean exit, same as today, stays
     * completely silent — the common path). Owner ruling D (final round):
     * this notice is PERSISTENT (`recoveredNotice`, dismissed by its own
     * action), not the transient `flashNotice` — a boot recovery is worth
     * more than 4 seconds of visibility, and a user who stepped away from
     * the machine at exactly the wrong moment must still see it when they
     * come back.
     *
     * Final review round, item 2: returns `null` — synchronously, not a
     * settled Promise — instead of running at all when this particular
     * call is not the owner (isTauri() false, or bootStarted already
     * true). Both guards below are a synchronous PREFIX, checked before
     * the function's own async body ever starts, so a non-owner caller
     * learns that fact at call time, not resolution time. This is what
     * App.tsx's boot-veil effect needs: under React StrictMode's dev-only
     * double-invoke, the SAME effect body runs twice in quick succession,
     * and the second call used to get back an ordinary Promise that
     * resolved (via the old unconditional early `return;`) on the very
     * next microtask — which the effect fed into the veil's race exactly
     * like a real completion, dropping the veil almost immediately while
     * the FIRST call's real read was still in flight. A caller that can
     * tell "I was never the owner" apart from "I was, and I'm done"
     * without waiting on anything can skip touching the veil entirely
     * for the former — see armBootVeilRace in App.tsx.
     */
    bootDesktopDocument(): Promise<void> | null {
      if (!isTauri()) return null;
      // Whole-lane-review round 2, item 3 — see bootStarted's own comment
      // above. Checked AFTER isTauri() so a browser no-op never touches it.
      if (bootStarted) return null;
      bootStarted = true;
      // D1 fix (E2-D1) — opens the boot-settlement window every autosave
      // write-back (runScheduledAutosaveWrite/flushAutosave, store.ts) waits
      // on before ever serializing the document; see awaitBootSettled's own
      // comment in store.ts. Symmetric with `bootStarted` itself: begun here
      // in the same synchronous prefix, ended in the same `finally` below.
      ctx.beginBootRead();
      return (async () => {
        try {
          const epochAtReadStart = get().docEpoch;
          const contents = await readAutosave();
          if (contents !== null) {
            let doc: ProjectDocument | null = null;
            try {
              doc = parseProject(contents);
            } catch (e) {
              // Whole-lane-review fix C2(c): move the bad file aside rather than
              // let the fallback write-back below silently overwrite it — it
              // might still be forensically recoverable, and destroying what
              // might be the user's only copy over a parse bug is worse than a
              // leftover file. Surfaced as the persistent error toast, not a
              // transient notice: this is a real, if rare, event worth a click
              // to dismiss rather than 4 seconds of visibility.
              console.warn("[autosave] unusable — quarantining and falling back", e);
              await quarantineCorruptAutosave();
              set({
                error:
                  "Your autosave file couldn't be read and was moved aside — starting from your last session",
              });
            }
            if (doc !== null) {
              // Whole-lane-review fix C2(a): parsing succeeded. Everything past
              // this point is a SEPARATE failure domain from the parse above —
              // an apply-time exception is caught and logged here, but must
              // NEVER fall through to the write-back below. Before this fix a
              // single try wrapped both parseProject AND applyDocument, so an
              // apply-time hiccup on a perfectly GOOD file fell into the same
              // catch as a corrupt one and the write-back then serialized
              // STALE (pre-apply) state over a file that was actually fine.
              try {
                if (get().undoDepth === 0 && get().docEpoch === epochAtReadStart) {
                  const recovering = !wasPreviousExitClean();
                  // alreadyOnDisk (M2): this is byte-for-byte what was just read
                  // from the file — applying it must not dirty the clean-exit
                  // marker or queue a redundant identical rewrite before the
                  // user has touched anything.
                  get().applyDocument(doc, { alreadyOnDisk: true });
                  if (recovering) set({ recoveredNotice: true });
                } else {
                  console.warn(
                    "[autosave] the document already changed (an edit, or a manual open) before boot resolved — keeping it",
                  );
                  // D1 fix, part (b) — QUARANTINE-ASIDE ON REFUSAL. The file
                  // just read is NOT corrupt (it parsed fine, right above)
                  // — it is only refused because memory outran it. Without
                  // this, the session's ordinary autosave — armed by
                  // whatever edit caused the refusal, or fired by an
                  // ordinary close — serializes the OLDER in-memory
                  // document straight over this file the instant part (a)'s
                  // boot-settlement gate opens, permanently discarding a
                  // file that was never bad, only out-raced. Moving it
                  // aside first means that write can only ever overwrite a
                  // COPY. Best-effort (quarantineSupersededAutosave never
                  // throws): a failed rename here must not be what breaks
                  // boot, same standard as the corrupt-file quarantine
                  // above. See that function's own comment in platform.ts
                  // and .superpowers-repro/e2-deepstate-findings.md (E2-D1).
                  const quarantined = await quarantineSupersededAutosave();
                  if (quarantined !== null) {
                    set({
                      supersededNotice: `Your project changed before a newer autosaved version finished loading, so that version was set aside as "${quarantined}" in your app data folder instead of being overwritten.`,
                    });
                  }
                }
              } catch (e) {
                console.error("[autosave] applying the recovered document failed", e);
              }
              return;
            }
          }
          // Missing, or corrupt (quarantined above): docOf(get()) is already
          // the localStorage fallback (nothing to apply) — just make sure a
          // file exists for next time, immediately rather than debounced.
          void writeAutosave(serializeProject(ctx.docOf(get()), APP_VERSION)).catch((e) => {
            console.warn("[autosave] initial write failed", e);
          });
        } finally {
          bootStarted = false;
          ctx.endBootRead();
        }
      })();
    },
  } satisfies Partial<VizState>;
}
