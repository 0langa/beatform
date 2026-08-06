/**
 * Local automatic lyrics (FEAT-004 phase 2) — store actions around the
 * lyrics sidecar: model tier download (resume + verify live in Rust),
 * generation with staged audio, progress, cancel. On success the finished
 * LRC goes through loadLyricsText — the SAME path as the import button, so
 * the overlay, exports and the .bfproj document treat generated lyrics
 * exactly like imported ones.
 */

import { wavFromPcm } from "../../audio/dsp/wav";
import { pcmFromAudioBuffer } from "../../audio/offlineSource";
import {
  missingModels,
  overallProgress,
  parseDownloadProgress,
  parseSidecarEvent,
  tierDownloadBytes,
  TIER_WHISPER_ID,
  type LyricsTier,
  type SidecarEvent,
} from "../lyricsGen";
import {
  askConfirm,
  diskSpace,
  isTauri,
  lyricsDownloadCancel,
  lyricsGenerate,
  lyricsGenerateCancel,
  lyricsGpuProbe,
  lyricsModelDownload,
  lyricsModelsState,
  lyricsStageAudio,
} from "../platform";
import { getEngine } from "../services";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

/** Free-space margin beyond the download itself before we ask instead of
 * just doing it — models land on the app-data volume (usually C:). */
const DISK_MARGIN_BYTES = 500 * 1e6;

export function lyricsGenActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    async refreshLyricsGen() {
      if (!isTauri()) return;
      try {
        const models = await lyricsModelsState();
        set({ lyricsGen: { ...get().lyricsGen, models } });
      } catch (e) {
        set({ error: `Could not read lyrics models: ${(e as Error).message ?? e}` });
        return;
      }
      // The GPU probe spawns the sidecar once (~1 s) and is cached Rust-side;
      // fire it lazily after the models land so the estimate can be honest.
      if (get().lyricsGen.dml === null) {
        try {
          const dml = await lyricsGpuProbe();
          set({ lyricsGen: { ...get().lyricsGen, dml } });
        } catch {
          // Probe failure = estimate falls back to CPU numbers; not an error
          // worth a toast — generation itself still auto-detects.
          set({ lyricsGen: { ...get().lyricsGen, dml: false } });
        }
      }
    },

    async downloadLyricsTier(tier: LyricsTier) {
      const s = get();
      if (!isTauri() || s.lyricsGen.phase !== "idle") return;
      const models = s.lyricsGen.models;
      if (!models) return;
      const missing = missingModels(models, tier);
      if (missing.length === 0) return;

      // Disk pre-flight on the models volume (warn-and-override, the export
      // pre-flight's contract — never a silent hard block).
      const { remaining } = tierDownloadBytes(models, tier);
      const disk = await diskSpace(models.modelsDir);
      if (disk && disk.freeBytes < remaining + DISK_MARGIN_BYTES) {
        const proceed = await askConfirm(
          `This download needs ${Math.round(remaining / 1e6)} MB and drive ${disk.root} has ` +
            `${Math.round(disk.freeBytes / 1e6)} MB free. Download anyway?`,
          "Low disk space",
        );
        if (!proceed) return;
      }

      set({
        lyricsGen: {
          ...get().lyricsGen,
          phase: "downloading",
          download: { id: missing[0].id, received: 0, total: missing[0].bytes },
        },
      });
      try {
        for (const model of missing) {
          await lyricsModelDownload(model.id, (line) => {
            const p = parseDownloadProgress(line);
            if (!p) return;
            set({ lyricsGen: { ...get().lyricsGen, download: p } });
          });
          // Refresh install state between files so the UI ticks per-model.
          const fresh = await lyricsModelsState();
          set({ lyricsGen: { ...get().lyricsGen, models: fresh } });
        }
        ctx.flashNotice("Lyrics models ready");
      } catch (e) {
        const message = String((e as Error).message ?? e);
        if (message !== "cancelled") {
          set({ error: `Model download failed: ${message}` });
        }
      } finally {
        const fresh = await lyricsModelsState().catch(() => get().lyricsGen.models);
        set({
          lyricsGen: { ...get().lyricsGen, phase: "idle", download: null, models: fresh },
        });
      }
    },

    cancelLyricsDownload() {
      void lyricsDownloadCancel();
    },

    async generateLyrics(tier: LyricsTier, language: string) {
      const s = get();
      if (!isTauri()) {
        set({ error: "Lyrics generation needs the desktop app" });
        return;
      }
      if (s.lyricsGen.phase !== "idle") return;
      const engine = getEngine();
      const buf = engine.audioBuffer;
      if (!buf) {
        set({ error: "Load a track first — lyrics are generated from the loaded audio" });
        return;
      }
      // Lyrics are per-track exactly like stems: `buf` is THIS track's audio,
      // and the sidecar runs for minutes — a track loaded meanwhile must not
      // receive the old track's lines (loadFile clears lyrics on purpose;
      // landing these after that clear would re-fill it under the new track's
      // name). Same guard as addStem: capture the generation with the buffer,
      // compare before applying.
      const gen = shared.trackLoadGen;
      if (s.lyrics && s.lyrics.length > 0) {
        // Generated lines land through the SAME store slot as imported ones;
        // never silently replace a file the user imported by hand.
        const replace = await askConfirm(
          `Replace the loaded lyrics (${s.lyricFileName ?? "imported"}) with generated ones?`,
          "Replace lyrics",
        );
        if (!replace) return;
      }

      set({
        lyricsGen: {
          ...get().lyricsGen,
          phase: "generating",
          gen: { stage: "decode", pct: null, etaSec: null, overall: 0 },
        },
      });
      // The terminal result event carries the phase-3 word-timing stats
      // (words, low-confidence lines) — the LRC text itself only carries the
      // timings. Captured here for the post-load notice (an object property,
      // not a bare let: closure writes defeat TS's flow narrowing on locals).
      const captured: { result: Extract<SidecarEvent, { type: "result" }> | null } = {
        result: null,
      };
      const onLine = (line: string) => {
        const ev = parseSidecarEvent(line);
        if (!ev) return;
        if (ev.type === "result") {
          captured.result = ev;
        } else if (ev.type === "progress") {
          set({
            lyricsGen: {
              ...get().lyricsGen,
              gen: {
                stage: ev.stage,
                pct: ev.pct ?? null,
                etaSec: ev.etaSec ?? null,
                overall: overallProgress(ev.stage, ev.pct ?? null),
              },
            },
          });
        } else if (ev.type === "stageDone") {
          set({
            lyricsGen: {
              ...get().lyricsGen,
              gen: {
                stage: ev.stage,
                pct: 100,
                etaSec: null,
                overall: overallProgress(ev.stage, 100),
              },
            },
          });
        }
      };
      // One attempt = stage the decoded track as WAV (works for every source
      // — file, drag-drop, library — because it reads the engine's own
      // buffer), then run the sidecar to completion.
      const attempt = async (useGpu: boolean) => {
        await lyricsStageAudio(wavFromPcm(pcmFromAudioBuffer(buf)));
        return lyricsGenerate({ whisperModelId: TIER_WHISPER_ID[tier], useGpu, language }, onLine);
      };
      try {
        let lrc: string;
        try {
          lrc = await attempt(true); // sidecar auto-detects; CPU fallback inside
        } catch (e) {
          const message = String((e as Error).message ?? e);
          // A native GPU-driver crash kills the sidecar without a Rust error
          // (observed on the reference Iris Xe under sustained thermal load:
          // exit 0xffffffff mid-isolation). Nothing in-process can catch
          // that — the honest recovery is one retry with the GPU stage
          // disabled, announced, not silent.
          if (!/exited abnormally/.test(message)) throw e;
          ctx.flashNotice("Graphics acceleration crashed — retrying on CPU (slower)");
          captured.result = null; // no stale stats from the crashed attempt
          set({
            lyricsGen: {
              ...get().lyricsGen,
              gen: { stage: "decode", pct: null, etaSec: null, overall: 0 },
            },
          });
          lrc = await attempt(false);
        }
        if (gen !== shared.trackLoadGen) {
          ctx.flashNotice("Track changed — generated lyrics discarded");
          return;
        }
        const trackName = engine.state.trackName ?? "track";
        get().loadLyricsText(`${trackName.replace(/\.[^.]+$/, "")} (generated).lrc`, lrc);
        // Word-timing summary on top of loadLyricsText's own notice: how many
        // words got karaoke timing, and how many lines deserve a second look
        // (low aligner confidence or failed alignment). Honest, not scary —
        // sung-lyrics ASR needing fixes is the documented normal.
        const stats = captured.result;
        // Per-line confidence (phase 4): the LRC can't carry it, the result
        // event does — attach it to the parsed lines for the editor's flags.
        if (stats?.lineDetails && get().lyrics) {
          get().applyLyricsConfidence(stats.lineDetails);
        }
        if (stats != null && stats.words > 0 && get().lyrics) {
          const low = stats.lowConfLines;
          ctx.flashNotice(
            `Lyrics ready — ${stats.lines} lines, ${stats.words} words timed` +
              (low > 0 ? `; ${low} low-confidence line${low === 1 ? "" : "s"}` : ""),
          );
        }
      } catch (e) {
        const message = String((e as Error).message ?? e);
        if (message !== "cancelled") {
          set({ error: `Lyrics generation failed: ${message}` });
        }
      } finally {
        set({ lyricsGen: { ...get().lyricsGen, phase: "idle", gen: null } });
      }
    },

    cancelLyricsGenerate() {
      void lyricsGenerateCancel();
    },
  } satisfies Partial<VizState>;
}
