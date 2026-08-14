import { LyricParseError, parseLyrics } from "../lyrics";
import { saveStoredAudiogram, saveStoredLyricStyle } from "../persistence";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { NULL_FRAME_KEY, shared } from "./shared";

export function lyricsAudiogramActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    loadLyricsText(fileName, contents) {
      try {
        const lyrics = parseLyrics(fileName, contents);
        set({ lyrics, lyricFileName: fileName, error: null });
        get().resetLyricsEditHistory(); // a fresh document, a fresh editor
        shared.lastFrameKey = NULL_FRAME_KEY; // force the first recompose
        get().refreshOverlay();
        ctx.flashNotice(`Lyrics loaded — ${lyrics.length} lines from ${fileName}`);
      } catch (e) {
        set({
          error:
            e instanceof LyricParseError
              ? e.message
              : `Could not read lyrics: ${(e as Error).message}`,
        });
      }
    },

    clearLyrics() {
      set({ lyrics: null, lyricFileName: null });
      get().resetLyricsEditHistory();
      get().refreshOverlay();
    },

    /** Guarded clear (E2-U3). See the VizState doc comment for why the
     *  identity check lives here rather than in clearLyrics itself:
     *  clearLyrics has no id to re-validate against (unlike deleteUserPreset,
     *  which re-reads fresh by id and so can never delete the wrong look),
     *  so re-reading "fresh" state here would just re-clear whatever
     *  landed most recently — exactly the bug. Comparing identity BEFORE
     *  clearing is what actually protects a generation that swapped in new
     *  lyrics while the UI's confirm was open (same "snapshot before the
     *  await, compare after" shape generateLyrics already uses for its own
     *  track-changed-mid-generation race, a few lines away in the sibling
     *  slice). */
    clearLyricsIfUnchanged(expectedFileName) {
      if (get().lyricFileName !== expectedFileName) {
        ctx.flashNotice("Lyrics changed while that confirm was open — nothing removed");
        return false;
      }
      get().clearLyrics();
      return true;
    },

    setLyricStyle(patch) {
      ctx.record("lyric-style"); // document state since schema v9 — undoable
      const lyricStyle = { ...get().lyricStyle, ...patch };
      set({ lyricStyle });
      saveStoredLyricStyle(lyricStyle);
      shared.lastFrameKey = NULL_FRAME_KEY;
      get().refreshOverlay();
    },

    setAudiogram(patch) {
      ctx.record("audiogram"); // document state since schema v9 — undoable
      const audiogram = { ...get().audiogram, ...patch };
      set({ audiogram });
      saveStoredAudiogram(audiogram);
      shared.lastFrameKey = NULL_FRAME_KEY;
      get().refreshOverlay();
    },
  } satisfies Partial<VizState>;
}
