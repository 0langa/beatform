import { readTrackMeta } from "../../audio/trackMeta";
import { isTauri, pickFolder, readBinaryFromPath, scanAudioLibrary } from "../platform";
import { getAnalyzer, getEngine } from "../services";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

/** Orders library clicks by CLICK time, not disk-read completion. */
let libraryClickGen = 0;

export function libraryActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    setShowLibrary(open) {
      set({ showLibrary: open });
    },

    async pickLibraryFolder() {
      if (!isTauri()) {
        set({ error: "The music library needs the desktop app (it scans a folder)" });
        return;
      }
      const dir = await pickFolder("Choose your music folder");
      if (!dir) return;
      set({ libraryScanning: true });
      try {
        const tracks = await scanAudioLibrary(dir);
        set({ library: { dir, tracks } });
        shared.libraryPrefetch = null;
        if (tracks.length === 0) ctx.flashNotice("No audio files found in that folder");
      } catch (e) {
        set({ error: `Library scan failed: ${(e as Error).message}` });
      } finally {
        set({ libraryScanning: false });
      }
    },

    async playLibraryTrack(path) {
      const entry = get().library?.tracks.find((t) => t.path === path);
      if (!entry) return;
      // Claim the click BEFORE the disk read: without this, ordering was
      // decided by read completion — a slow first click could beat a fast
      // second one because loadFile's own generation was claimed too late.
      const click = ++libraryClickGen;
      try {
        // Bytes -> File -> the ordinary loadFile path: decode, tags, cover
        // art, beat-grid analysis and generation guards all come for free.
        const bytes = await readBinaryFromPath(path);
        if (click !== libraryClickGen) return; // a later click superseded us
        const tgBefore = shared.trackLoadGen;
        const file = new File([bytes as BlobPart], entry.fileName);
        await get().loadFile(file);
        // Mark active only if OUR load won: loadFile claims tgBefore+1
        // synchronously, so any other claim since means we were superseded.
        // (Comparing trackName to fileName here mismarked duplicates — two
        // library entries can share a basename across subfolders.)
        if (shared.trackLoadGen === tgBefore + 1) {
          set({ libraryActivePath: path });
          void ctx.prefetchNextLibraryTrack();
        }
      } catch (e) {
        set({ error: `Could not read "${entry.fileName}" (${(e as Error).message})` });
      }
    },

    async advanceLibrary() {
      const s = get();
      if (!s.libraryAutoAdvance || !s.library || !s.libraryActivePath) return;
      const i = s.library.tracks.findIndex((t) => t.path === s.libraryActivePath);
      if (i < 0 || i + 1 >= s.library.tracks.length) return; // end: stop
      const next = s.library.tracks[i + 1];
      const pre = shared.libraryPrefetch;
      if (pre && pre.path === next.path) {
        // Near-gapless: disk read + decode already happened during playback.
        const gen = ++shared.trackLoadGen;
        const engine = getEngine();
        try {
          engine.loadBuffer(pre.buffer, pre.file.name);
          // E3c, and this is the path that reaches the window without a click:
          // auto-advance installs the next song's audio here and plays it,
          // while the beat grid, key, sections and waveform overview below are
          // still the song that just ended. Void them at the buffer, not after
          // the tag scan — `analyzing` goes true with them, so an export fired
          // during an advance waits for this track's grid instead of baking in
          // the last one's.
          ctx.invalidateAnalysis();
          // Different audio entirely (R2-32b): detector history, peak caps,
          // the drive envelope and the grid readouts all describe the song
          // that just ended. Same call, same position as loadFile/loadDemo —
          // this was the one load path that skipped it.
          getAnalyzer().reset("source");
          await engine.play();
          const { meta, coverArt } = await readTrackMeta(pre.file, pre.file.name);
          if (gen !== shared.trackLoadGen) return;
          set({
            trackMeta: meta,
            coverArt,
            stems: [],
            lyrics: null,
            lyricFileName: null,
            libraryActivePath: next.path,
            error: null,
          });
          ctx.applyCoverArt();
          get().refreshOverlay();
          get().analyzeCurrentTrack();
          void ctx.prefetchNextLibraryTrack();
        } catch (e) {
          // Unlike loadFile this path had no catch at all: it is called from
          // `engine.onEnded` as a floating promise, so a rejection was an
          // unhandled one AND — now that this path opens the analysis gate —
          // would leave that gate shut forever.
          if (gen !== shared.trackLoadGen) return;
          set({ error: `Could not play "${next.fileName}" (${(e as Error).message})` });
        } finally {
          // Same rule as loadFile's: close a gate this advance opened that no
          // analysis job will close, and leave a NEWER load's gate alone.
          if (gen === shared.trackLoadGen) ctx.settleUnclaimedAnalysis();
        }
      } else {
        await get().playLibraryTrack(next.path);
      }
    },

    setLibraryAutoAdvance(v) {
      set({ libraryAutoAdvance: v });
    },
  } satisfies Partial<VizState>;
}
