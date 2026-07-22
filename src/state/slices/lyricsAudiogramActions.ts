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
      get().refreshOverlay();
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
