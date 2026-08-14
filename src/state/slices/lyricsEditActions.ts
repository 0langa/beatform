/**
 * Lyrics correction editor (FEAT-004 phase 4) — store actions.
 *
 * Every mutation goes: snapshot -> pure op from lyricsEdit.ts -> set() ->
 * overlay refresh, so the live karaoke preview updates on the next frame and
 * the render path stays a pure function of (lines, t).
 *
 * Undo is EDITOR-LOCAL. Lyrics are session state (never serialized into
 * .bfproj), so the app's document history cannot carry them without putting
 * megabyte transcripts into every project snapshot; a bounded local stack
 * gives the editor real undo/redo at zero cost to the document machinery.
 * The stacks reset whenever a new lyrics document loads (import, generate,
 * clear) — undoing across two different songs' lyrics helps no one.
 */

import type { LyricLine } from "../lyrics";
import {
  applyLineDetails,
  applyRealignedWords,
  cloneLines,
  deleteLine,
  insertLineAfter,
  lineWindow,
  MAX_TIME_SEC,
  mergeWithNext,
  nudgeLine,
  nudgeWord,
  redistributeWords,
  setLineText,
  setLineTime,
  setWordText,
  setWordTime,
  splitLine,
  writeLrc,
} from "../lyricsEdit";
import type { LineDetail } from "../lyricsGen";
import { wavFromPcm } from "../../audio/dsp/wav";
import { pcmFromAudioBuffer } from "../../audio/offlineSource";
import { isTauri, lyricsAlignLine, lyricsStageAudio, saveTextFile } from "../platform";
import { getEngine } from "../services";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { NULL_FRAME_KEY, shared } from "./shared";

const MAX_UNDO = 100;
/** Slice margin beyond the line window for re-alignment — must exceed the
 * aligner's own ±0.4 s pad so its window never leaves the slice. */
const REALIGN_EDGE_SEC = 0.6;

/**
 * The absolute ceiling a tail line/word's time may clamp to (whole-lane
 * review, IMPORTANT on top of E2-U2): the loaded track's own duration when
 * one is available, else lyricsEdit.ts's MAX_TIME_SEC (5999.99s, matched to
 * lrcTimestamp's own saturation point) as the fallback every OTHER caller
 * still gets. MAX_TIME_SEC alone regressed a legitimate tail edit on any
 * track past ~100 minutes — imported lyrics (no clamp of their own) can
 * genuinely describe one; generateLyrics' own LYRICS_MAX_TRACK_SEC
 * (lyricsGenActions.ts) documents up to 90 minutes as supported for
 * generation, and import has no such ceiling at all. `getEngine()` is the
 * same source `realignLyricLine` below already reads `buf.duration` from —
 * not the store's own playback state, which this pure-editor slice has no
 * other reason to subscribe to.
 */
const lineTimeCeiling = (): number => getEngine().audioBuffer?.duration ?? MAX_TIME_SEC;

// Editor-local undo/redo stacks (module scope, exactly like history.ts —
// depths are mirrored into state so buttons can enable/disable reactively).
let past: LyricLine[][] = [];
let future: LyricLine[][] = [];

export function lyricsEditActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  const depths = () => ({
    lyricsEditUndoDepth: past.length,
    lyricsEditRedoDepth: future.length,
  });

  /** The write ritual shared by every edit: push undo, apply, repaint. */
  const apply = (next: LyricLine[] | null | undefined) => {
    const prev = get().lyrics;
    if (!next || !prev || next === prev) return;
    past.push(cloneLines(prev));
    if (past.length > MAX_UNDO) past.shift();
    future = [];
    set({ lyrics: next, ...depths() });
    shared.lastFrameKey = NULL_FRAME_KEY; // force the next overlay recompose
    get().refreshOverlay();
  };

  return {
    editLyricLineText(i, text) {
      const lines = get().lyrics;
      if (lines) apply(setLineText(lines, i, text));
    },

    setLyricLineTime(i, t) {
      const lines = get().lyrics;
      if (lines) apply(setLineTime(lines, i, t, lineTimeCeiling()));
    },

    nudgeLyricLine(i, deltaSec) {
      const lines = get().lyrics;
      if (lines) apply(nudgeLine(lines, i, deltaSec, lineTimeCeiling()));
    },

    splitLyricLine(i, charPos) {
      const lines = get().lyrics;
      if (lines) apply(splitLine(lines, i, charPos));
    },

    mergeLyricLineWithNext(i) {
      const lines = get().lyrics;
      if (lines) apply(mergeWithNext(lines, i));
    },

    insertLyricLineAfter(i) {
      const lines = get().lyrics;
      if (lines) apply(insertLineAfter(lines, i));
    },

    deleteLyricLine(i) {
      const lines = get().lyrics;
      if (lines) apply(deleteLine(lines, i));
    },

    editLyricWord(i, k, text) {
      const lines = get().lyrics;
      if (lines) apply(setWordText(lines, i, k, text));
    },

    setLyricWordTime(i, k, t) {
      const lines = get().lyrics;
      if (lines) apply(setWordTime(lines, i, k, t, lineTimeCeiling()));
    },

    nudgeLyricWord(i, k, deltaSec) {
      const lines = get().lyrics;
      if (lines) apply(nudgeWord(lines, i, k, deltaSec, lineTimeCeiling()));
    },

    redistributeLyricWords(i) {
      const lines = get().lyrics;
      if (lines) apply(redistributeWords(lines, i));
    },

    undoLyricsEdit() {
      const lines = get().lyrics;
      const snapshot = past.pop();
      if (!lines || !snapshot) return;
      future.push(cloneLines(lines));
      set({ lyrics: snapshot, ...depths() });
      shared.lastFrameKey = NULL_FRAME_KEY;
      get().refreshOverlay();
    },

    redoLyricsEdit() {
      const lines = get().lyrics;
      const snapshot = future.pop();
      if (!lines || !snapshot) return;
      past.push(cloneLines(lines));
      set({ lyrics: snapshot, ...depths() });
      shared.lastFrameKey = NULL_FRAME_KEY;
      get().refreshOverlay();
    },

    /** New lyrics document (import/generate/clear): local history restarts. */
    resetLyricsEditHistory() {
      past = [];
      future = [];
      set(depths());
    },

    /** Attach the generation result's per-line confidence (index-matched to
     * the freshly parsed lines). NOT an edit — no undo entry, no repaint
     * (conf never renders in the overlay). */
    applyLyricsConfidence(details: LineDetail[]) {
      const lines = get().lyrics;
      if (!lines || details.length !== lines.length) return;
      set({ lyrics: applyLineDetails(lines, details) });
    },

    /** Export the current (edited) lines as an .lrc via the save dialog —
     * the durable artifact of every correction session. */
    async exportLyricsLrc() {
      const lines = get().lyrics;
      if (!lines || lines.length === 0) return;
      const name = (get().lyricFileName ?? "lyrics.lrc").replace(/\.(lrc|srt)$/i, "") + ".lrc";
      try {
        const path = await saveTextFile(name, writeLrc(lines), [
          { name: "Timed lyrics", extensions: ["lrc"] },
        ]);
        if (path) ctx.flashNotice(`Lyrics saved — ${path.split(/[\\/]/).pop()}`);
      } catch (e) {
        set({ error: `Could not save lyrics: ${(e as Error).message ?? e}` });
      }
    },

    /**
     * Re-run forced alignment for ONE line against the loaded track (phase-4
     * "re-align line"): cut a short padded slice around the line from the
     * engine's own buffer, stage it (the generation handshake), and run the
     * sidecar's --align-line mode — isolation + CTC only, no whisper, seconds
     * not minutes. The words come back slice-relative and are offset here.
     */
    async realignLyricLine(i) {
      const s = get();
      const lines = s.lyrics;
      if (!lines || i < 0 || i >= lines.length) return;
      if (!isTauri()) {
        set({ error: "Re-align needs the desktop app" });
        return;
      }
      if (s.lyricsGen.phase !== "idle" || s.lyricsRealign) return;
      const engine = getEngine();
      const buf = engine.audioBuffer;
      if (!buf) {
        set({ error: "Load the track this lyric belongs to — re-align listens to the audio" });
        return;
      }
      const line = lines[i];
      const { start, end } = lineWindow(lines, i);
      if (end - start > 30) {
        set({ error: "This line spans too much audio to re-align — split it first" });
        return;
      }
      const sliceStart = Math.max(0, start - REALIGN_EDGE_SEC);
      const sliceEnd = Math.min(buf.duration, end + REALIGN_EDGE_SEC);
      if (sliceEnd - sliceStart < 0.35 || start >= buf.duration) {
        set({ error: "This line lies outside the loaded track's audio" });
        return;
      }
      set({ lyricsRealign: { index: i } });
      // Words are aligned against THIS track's audio (`buf` above). If a new
      // track lands mid-run, the text check below could still pass — same
      // text at the same index in freshly loaded lyrics — with timings that
      // describe the old audio. Same guard as generateLyrics/addStem.
      const gen = shared.trackLoadGen;
      try {
        const pcm = pcmFromAudioBuffer(buf);
        const s0 = Math.max(0, Math.floor(sliceStart * pcm.sampleRate));
        const s1 = Math.min(pcm.length, Math.ceil(sliceEnd * pcm.sampleRate));
        const slice = {
          sampleRate: pcm.sampleRate,
          length: s1 - s0,
          duration: (s1 - s0) / pcm.sampleRate,
          channels: pcm.channels.map((c) => c.subarray(s0, s1)),
        };
        await lyricsStageAudio(wavFromPcm(slice));
        const words = await lyricsAlignLine(
          start - sliceStart,
          end - sliceStart,
          line.text,
          true, // sidecar auto-detects; its CPU fallback is internal
        );
        if (gen !== shared.trackLoadGen) return;
        const now = get().lyrics;
        // The lines may have been edited while the sidecar ran; only apply
        // to the same line with the same text (applyRealignedWords also
        // re-checks the token identity).
        if (!now || now[i]?.text !== line.text) return;
        const offset = words.map((w) => ({
          t: sliceStart + w.t,
          end: sliceStart + w.end,
          conf: w.conf,
          text: w.text,
        }));
        apply(applyRealignedWords(now, i, offset));
        ctx.flashNotice(`Line re-aligned — ${words.length} words timed`);
      } catch (e) {
        const message = String((e as Error).message ?? e);
        if (message !== "cancelled") {
          set({ error: `Re-align failed: ${message}` });
        }
      } finally {
        set({ lyricsRealign: null });
      }
    },
  } satisfies Partial<VizState>;
}
