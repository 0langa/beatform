import { wavFromPcm } from "../../audio/dsp/wav";
import { pcmFromAudioBuffer } from "../../audio/offlineSource";
import { buildExportOptions } from "../../export/buildExportOptions";
import { CODEC_LABELS, probeCodecs } from "../../export/codecProbe";
import { exportVideo } from "../../export/videoExporter";
import { rasterizeOverlay } from "../../render/overlay";
import { audiogramActive } from "../audiogram";
import { safeName } from "../batch";
import { ANALYSIS_TIMEOUT_MS } from "../batchRunner";
import { autoBitrateMbps, RESOLUTIONS, SIMPLIFIED_EXPORT_REASON } from "../exportConfig";
import {
  animBegin,
  askConfirm,
  av1Begin,
  diskSpace,
  downloadBlob,
  isTauri,
  pickFolder,
  pickSavePath,
  proresAbort,
  proresBegin,
  proresFinish,
  proresSetAudio,
  proresWrite,
  scratchDir,
} from "../platform";
import {
  estimateExportBytes,
  preflightWarning,
  translateExportError,
  type ExportFormatKind,
} from "../../export/diskPreflight";
import { saveStoredExportSettings } from "../persistence";
import { getEngine } from "../services";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

let exportStartedAt = 0;
/**
 * E4b: recent (elapsedMs-since-start, done) samples for the windowed fps
 * readout, reset alongside exportStartedAt at the top of every export. The
 * dialog's fps used to be a pure cumulative average (done/elapsed since
 * start) — accurate on average, but it rides the encoder-queue fill at
 * render speed for the first few seconds and then decays toward the real
 * steady-state rate for the rest of the run, which is what the owner watched
 * as "16 fps -> 7 fps at 16%" (BACKLOG E4b). This ring keeps only the last
 * SPEED_WINDOW_MS of onProgress samples so the readout tracks the CURRENT
 * rate instead.
 */
let speedWindow: Array<{ t: number; done: number }> = [];
/** Window width for the fps readout above. onProgress fires every 10 frames
 * (exportCore.ts), so 5 s covers several samples even on a fast 60 fps job. */
const SPEED_WINDOW_MS = 5000;

/** The refusal when analysis never lands — one sentence, one place. */
export const ANALYSIS_TIMEOUT_REASON =
  `The track's beat analysis did not finish within ${ANALYSIS_TIMEOUT_MS / 1000}s. ` +
  `Export cancelled rather than render without the beat grid the preview is using — ` +
  `reload the track and try again.`;

/**
 * Wait for `store.awaitAnalysis()`, bounded — the interactive half of the rule
 * batchRunner has always enforced per track (batchRunner.ts:197-215).
 *
 * The bound is batch's own `ANALYSIS_TIMEOUT_MS`, deliberately: it is a
 * LIVENESS net for the one case `trackAnalysis.ts` cannot bound itself (a
 * worker that simply never replies), and that case does not become more or
 * less likely because a human is watching. A tighter interactive number would
 * be a second, unmeasured mechanism for the same problem — and it would
 * false-refuse the slow-machine-plus-long-track case that this number was
 * measured to survive. What makes the generous bound acceptable here is that
 * the wait happens with `exporting` already set, so the panel's Cancel button
 * is on screen for every second of it — hence the signal.
 *
 * Not a copy of `raceAgainstStop`: that helper is module-private to
 * batchRunner and polls because it is handed a `shouldStop()` predicate. Here
 * there is a real AbortSignal, so this listens instead of polling.
 */
async function awaitAnalysisBounded(wait: Promise<void>, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      wait,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(ANALYSIS_TIMEOUT_REASON)), ANALYSIS_TIMEOUT_MS);
        onAbort = () => {
          // AbortError: runExport's catch reads that as "the user cancelled"
          // and shows nothing, which is exactly right for a Cancel click.
          const e = new Error("Export cancelled");
          e.name = "AbortError";
          reject(e);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function exportActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    setShowExport(showExport) {
      set({
        showExport,
        // E2-U5, extended (whole-lane review, one-liner (a)): a reopened
        // dialog must never show a stale RESULT — failure OR success — as
        // if it just happened. exportDone/exportDonePath get the identical
        // treatment exportError already does, and for the identical reason:
        // "Show in folder" (ExportDialog.tsx) reads exportDonePath, so a
        // stale one left over from a PRIOR run would happily reveal the
        // wrong file on an unrelated reopen. Unconditional on every open,
        // not just after a known-orphaned run — by construction the dialog
        // was closed just before this call, so anything already sitting in
        // the store is from before THIS viewing regardless of how the
        // previous run ended. A run still in flight (exporting or
        // exportPreparing) already has all three fields null — runExport
        // clears exportError/exportDone/exportDonePath together, in the
        // same set() call, the moment it actually starts encoding — so
        // this is a no-op for that case.
        ...(showExport ? { exportError: null, exportDone: null, exportDonePath: null } : null),
      });
      // Probe codec support the first time the panel opens — the result is
      // hardware-fixed for the session, and the select renders from it.
      if (showExport && !get().codecSupport) {
        void probeCodecs().then((codecSupport) => {
          set({ codecSupport });
          // A previously chosen codec can be unsupported (settings survive
          // the probe in dev hot-reload scenarios) — snap back to H.264.
          if (!codecSupport[get().exportSettings.codec]) {
            get().setExportSettings({ codec: "h264" });
          }
        });
      }
    },

    setExportSettings(patch) {
      const next = { ...get().exportSettings, ...patch };
      // Canvas loops upload as videos — PNG/ProRes/AV1 make no sense there,
      // and leaving them selected silently exported an MP4 while the panel
      // still said PNG. Coerce so the UI always tells the truth.
      if (
        next.mode === "canvas" &&
        (next.format === "png" || next.format === "prores" || next.format === "av1-10")
      ) {
        next.format = "mp4";
      }
      set({ exportSettings: next });
      saveStoredExportSettings(next);
    },

    async runExport() {
      // F2: the export worker builds its own WebGPU device, so on the Canvas2D
      // fallback exportCore threw GpuInitError — but only after the native save
      // dialog, the overlay raster and a full decode. Refuse FIRST, with the
      // same sentence the (already disabled) Export buttons put in their
      // tooltip, so the user never picks a destination for a file that was
      // never going to be written.
      if (get().simplifiedRenderer) {
        set({ exportError: SIMPLIFIED_EXPORT_REASON, exportDone: null, exportDonePath: null });
        return;
      }
      const engine = getEngine();
      const buf = engine.audioBuffer;
      if (!buf) return;
      // Re-entrancy guard. The UI hides the Export button while `exporting` is
      // set, but that is not a guarantee: a batch clears `exporting` between
      // jobs while it decodes the next track, and a second export starting
      // there would overwrite the shared abort controller and break cancel for
      // the run that is already going.
      if (get().exporting || get().batchStatus === "running" || shared.exportStarting) return;
      // `exporting` is only set AFTER the native save dialog below — claim the
      // slot synchronously so a double-click cannot pass the guard twice and
      // clobber the shared abort controller (same hole startBatch had).
      shared.exportStarting = true;
      // Reactive mirror of the claim above (E2-U5): `exporting` itself stays
      // null through the native save dialog and the disk pre-flight below —
      // both take real user/async time — so ExportDialog had nothing
      // reactive to gate its own dismissal on until encoding actually
      // began. Cleared through `endExportPreparing` below on every exit
      // path, the same set of places that already clear `shared.
      // exportStarting`, so the two can never drift out of sync.
      set({ exportPreparing: true });
      // Every early-return path below used to clear ONLY shared.
      // exportStarting; now it clears this reactive mirror too, in one
      // place, so a future added return can't clear one and forget the
      // other.
      const endExportPreparing = () => {
        shared.exportStarting = false;
        set({ exportPreparing: false });
      };
      const settings = get().exportSettings;
      const canvasMode = settings.mode === "canvas";
      // Canvas loops are fixed to the Spotify spec: 9:16, 30 fps, 3-8 s
      const res = canvasMode ? { w: 1080, h: 1920 } : RESOLUTIONS[settings.resIdx];
      const fps = canvasMode ? 30 : settings.fps;
      const mbps = settings.autoRate ? autoBitrateMbps(res.w, res.h, fps) : settings.manualMbps;
      const segment = canvasMode
        ? {
            start: Math.max(
              0,
              Math.min(settings.canvasStart, buf.duration - settings.canvasDuration),
            ),
            duration: Math.min(settings.canvasDuration, buf.duration),
          }
        : undefined;
      // Same filename rules as the batch queue — the old \w-based sanitizer
      // silently destroyed every non-ASCII title ("夜に駆ける" -> "").
      const baseName = `${safeName(engine.state.trackName ?? "visualization")}${canvasMode ? "-canvas" : ""}`;
      const pngMode = settings.format === "png" && !canvasMode;
      // ProRes goes through the ffmpeg sidecar; canvas loops stay MP4.
      const proresMode = settings.format === "prores" && !canvasMode;
      // AV1 10-bit: the same sidecar session commands, but fed raw rgba64le
      // frames from the deep-color tap instead of encoded PNGs.
      const av1Mode = settings.format === "av1-10" && !canvasMode;
      // GIF/WebP loops go through the same sidecar — allowed in canvas mode
      // too (a seamless 3-8 s loop is the format's whole point).
      const animFormat =
        settings.format === "gif" || settings.format === "webp" ? settings.format : null;
      // VP9+alpha muxes into WebM (canvas loops force H.264, so never there).
      const webmMode = settings.format === "mp4" && settings.codec === "vp9a" && !canvasMode;
      const ext = proresMode ? ".mov" : animFormat ? `.${animFormat}` : webmMode ? ".webm" : ".mp4";
      const fileName = `${baseName}${ext}`;
      // Desktop: pick the destination BEFORE rendering — a cancelled dialog
      // after a long 4K render would throw the work away.
      // The dialog is also a window where a new track can land (loadFile has
      // no export guard, deliberately): `buf` above is the OLD track, while
      // everything read after the dialog (meta, grid, stems, cover) would be
      // the NEW one — a mixed-track export. Detect and bail instead.
      const genAtStart = shared.trackLoadGen;
      let savePath: string | null = null;
      let pngDir: string | null = null;
      /** %TEMP% path, retained so a failure can re-measure its volume. */
      let scratchPathForError: string | null = null;
      // Whole-lane review, IMPORTANT: this whole span (the native save
      // dialog through the desktop-only refusal) sat OUTSIDE any try/catch
      // — pickFolder/pickSavePath are real Tauri plugin calls that CAN
      // throw (the ACL-throw precedent is real: ShaderEditor.tsx's own
      // comment records askConfirm throwing "not allowed by ACL" in an
      // installed build). An uncaught throw here would skip every
      // endExportPreparing() call below, leaving shared.exportStarting
      // (and its reactive mirror, exportPreparing) stuck true forever —
      // the SAME "stuck busy" class E2-U5 exists to prevent, just reached
      // through a throw instead of a dismissal.
      try {
        if (isTauri()) {
          if (pngMode) {
            const dir = await pickFolder("Choose a folder for the PNG sequence");
            if (!dir) {
              endExportPreparing();
              return;
            }
            // Keep each run in its own subfolder so sequences never interleave.
            pngDir = `${dir}/${baseName}_frames`;
          } else {
            savePath = await pickSavePath(
              fileName,
              proresMode
                ? [{ name: "QuickTime (ProRes)", extensions: ["mov"] }]
                : av1Mode
                  ? [{ name: "MP4 (AV1 10-bit)", extensions: ["mp4"] }]
                  : animFormat
                    ? [
                        {
                          name: animFormat === "gif" ? "GIF animation" : "WebP animation",
                          extensions: [animFormat],
                        },
                      ]
                    : webmMode
                      ? [{ name: "WebM video", extensions: ["webm"] }]
                      : [{ name: "MP4 video", extensions: ["mp4"] }],
            );
            if (!savePath) {
              endExportPreparing();
              return;
            }
          }
        } else if (pngMode || proresMode || av1Mode || animFormat) {
          set({
            exportError: pngMode
              ? "PNG sequence export needs the desktop app (it writes a folder)"
              : animFormat
                ? "GIF/WebP export needs the desktop app (it runs the bundled ffmpeg)"
                : av1Mode
                  ? "AV1 10-bit export needs the desktop app (it runs the bundled ffmpeg)"
                  : "ProRes export needs the desktop app (it runs the bundled ffmpeg)",
          });
          endExportPreparing();
          return;
        }
      } catch (e) {
        endExportPreparing();
        set({
          exportError: `Could not open the save dialog: ${(e as Error)?.message ?? String(e)}`,
        });
        return;
      }
      if (genAtStart !== shared.trackLoadGen) {
        set({ exportError: "The track changed while the save dialog was open — export cancelled" });
        endExportPreparing();
        return;
      }

      // Disk pre-flight. The export that motivated this rendered for eleven
      // minutes and wrote 7.5 GB before dying, because the SYSTEM drive was
      // full — the output drive had 518 GB free and was never the problem.
      // Both volumes are checked, and the warning names whichever is short.
      // Warn-and-override: the estimate is an estimate, and the user may know
      // about space we cannot see.
      const destination = savePath ?? pngDir;
      if (destination) {
        // Whole-lane review, IMPORTANT: same reasoning as the save-dialog
        // try/catch above — scratchDir/diskSpace are Tauri commands and
        // askConfirm's own ACL-throw precedent applies here just as much
        // as it does to the save dialog. This span used to sit outside any
        // try/catch too.
        try {
          const scratchPath = await scratchDir();
          scratchPathForError = scratchPath;
          const [outVol, scratchVol] = await Promise.all([
            diskSpace(destination),
            scratchPath ? diskSpace(scratchPath) : Promise.resolve(null),
          ]);
          const kind: ExportFormatKind = pngMode
            ? "png"
            : proresMode
              ? "prores"
              : av1Mode
                ? "av1-10"
                : (animFormat ?? (webmMode ? "webm" : "mp4"));
          const warning = preflightWarning(
            estimateExportBytes({
              format: kind,
              width: res.w,
              height: res.h,
              fps,
              seconds: segment ? segment.duration : buf.duration,
              bitrate: mbps * 1e6,
              sampleRate: buf.sampleRate,
              channels: buf.numberOfChannels,
            }),
            outVol,
            scratchVol,
          );
          if (warning && !(await askConfirm(warning, "Low disk space"))) {
            endExportPreparing();
            return;
          }
        } catch (e) {
          endExportPreparing();
          set({ exportError: `Could not check disk space: ${(e as Error)?.message ?? String(e)}` });
          return;
        }
      }

      const ac = new AbortController();
      shared.exportAbort = ac;
      exportStartedAt = performance.now();
      speedWindow = [];
      set({
        exportError: null,
        exportDone: null,
        exportDonePath: null,
        exporting: { done: 0, total: 1, speed: null, avgSpeed: null },
      });
      // ProRes: frames stream to the ffmpeg sidecar as they render; writes
      // are chained so ordering is exact, and a dead sidecar aborts the
      // render instead of piling frames into a rejected promise.
      let proresChain = Promise.resolve();
      // Object holder: assignments happen inside callbacks, which TS's flow
      // analysis can't see on a plain let (it narrows the reads to null).
      // `unknown`, not Error: Tauri command rejections are raw strings.
      const proresFail: { err: unknown } = { err: null };
      // GIF/WebP share the ProRes frame pipe (one sidecar session at a time),
      // and so does AV1 — but AV1 is fed raw rgba64le frames (onRawFrame),
      // not encoded PNGs, so the PNG-frame sink is gated separately below.
      const pngSidecarMode = proresMode || !!animFormat;
      const sidecarMode = pngSidecarMode || av1Mode;
      // Tauri invoke() rejects with the Rust command's raw STRING, not an
      // Error — reading .message off it yields undefined, which is what the
      // export error toast used to show for every sidecar failure.
      const errText = (x: unknown): string =>
        x instanceof Error ? x.message : typeof x === "string" ? x : String(x);
      // Hoisted so the finally can close it even when exportVideo throws (e.g.
      // WebGPU init fails) — the batch runner already closes its overlay; this
      // path leaked the rasterized ImageBitmap on the error path.
      let overlayBitmap: ImageBitmap | undefined;
      try {
        // E2-R2, the divergence this whole guard exists for. `analyzeTrack` is
        // async, so between loading a track and its analysis landing the store
        // holds `beatGrid: null, sections: []` — and the export read whatever
        // was there at that instant. An export fired in that window rendered
        // with NO grid (bpm 0, no beatPhase/barPhase, no beatIndex/barIndex,
        // no sectionIndex/sectionPulse, and tempo-locked LFOs on their
        // 120-BPM-equivalent fallback clock) while the preview a moment later
        // had the real one. Measured on device: 120/120 frames differed from
        // the same export run after analysis; with analysis awaited first,
        // 0/120. Nothing looked broken, which is why nobody would report it.
        //
        // Waited HERE, not before the save dialog: on desktop the dialog is
        // seconds of user time and analysis is ~0.5 s for a normal track, so
        // in the path that matters this costs exactly nothing. `exporting` is
        // already set, so the panel shows progress and a working Cancel.
        await awaitAnalysisBounded(get().awaitAnalysis(), ac.signal);
        // A new track can land while we wait — same hazard the pre-dialog
        // check above exists for, and the same answer: `buf` is the OLD
        // track's audio, everything read below would be the NEW track's.
        if (genAtStart !== shared.trackLoadGen) {
          throw new Error("The track changed while it was being analyzed — export cancelled");
        }
        if (proresMode && savePath) {
          // Original (un-normalized) audio: a mezzanine keeps source levels.
          await proresSetAudio(wavFromPcm(pcmFromAudioBuffer(buf)));
          await proresBegin(fps, savePath);
        } else if (av1Mode && savePath) {
          // Same staged-WAV handshake as ProRes (ffmpeg re-encodes it to AAC
          // in the .mp4); raw frames need width/height pinned at spawn time.
          await proresSetAudio(wavFromPcm(pcmFromAudioBuffer(buf)));
          await av1Begin(fps, res.w, res.h, savePath);
        } else if (animFormat && savePath) {
          // GIF's single-pass palettegen graph makes ffmpeg buffer EVERY
          // decoded frame until EOF (audit E2) — a long track at full fps is
          // a guaranteed sidecar OOM, not a slow export. Cap GIF at ~3
          // minutes of frames with a clear pointer to the formats built for
          // long content; WebP streams and is unaffected.
          const gifFrames = (canvasMode ? settings.canvasDuration : buf.duration) * fps;
          if (animFormat === "gif" && gifFrames > 5400) {
            throw new Error(
              "GIF exports are limited to ~3 minutes (the encoder holds every frame in memory). For longer clips use animated WebP or MP4; for loops, Canvas loop mode.",
            );
          }
          await animBegin(animFormat, fps, savePath);
        }
        // Same rasterizer as the live view, at export resolution — WYSIWYG
        overlayBitmap =
          (await rasterizeOverlay(
            get().overlayLayers,
            get().assets,
            res.w,
            res.h,
            get().trackMeta,
          )) ?? undefined;
        const overlay = overlayBitmap;
        // E3d — the LAST word before the store is read, and the only check that
        // can be. Both checks above compare generations, which is necessary but
        // not sufficient on two separate counts.
        //
        // (a) Distance. The generation check sits immediately after the
        // analysis wait, but everything that actually DESCRIBES the track —
        // meta, cover, grid, sections, stems, lyrics, waveform — is read below,
        // several awaits later (the sidecar audio handshake, the sidecar
        // session, the overlay raster). A track landing in that gap was
        // invisible: nothing re-checked.
        //
        // (b) The counter cannot close it even in principle. `loadFile` bumps
        // `shared.trackLoadGen` on its FIRST line (store.ts) and only then
        // parks on the decode, while the engine commits the new buffer only
        // AFTER that decode resolves (engine.ts). So there is a real interval
        // where the generation is already the NEW load's while
        // `engine.audioBuffer` is still the OLD one. An export starting there
        // captures OLD audio under a NEW generation, and every later
        // `genAtStart !== shared.trackLoadGen` compares two equal numbers —
        // forever. It would encode track A's audio against track B's grid,
        // sections and waveform, and report success.
        //
        // So re-assert IDENTITY, not generation: the audio we are about to
        // describe must still be the audio we captured. That is the predicate
        // that matters — `buf` is the PCM being encoded, everything read below
        // describes whatever the engine holds NOW — and it subsumes the
        // counter, because a track change always ends with a different buffer
        // in the engine no matter which order the two events happened in.
        //
        // Live input is deliberately untouched by this and needs no special
        // case: `startLiveInput`/`stopLiveInput` never write `engine.buffer`
        // (the track stays loaded, only the analysis graph is re-pointed), so a
        // live-mode export of the still-loaded track compares a buffer against
        // itself. Scoping the check to "file tracks only" would have been the
        // wrong fix for a hazard that does not exist.
        if (getEngine().audioBuffer !== buf) {
          throw new Error("The track changed while the export was starting — export cancelled");
        }
        // Everything the document contributes is resolved by the shared
        // builder, so the batch runner and this path cannot drift apart.
        const result = await exportVideo(
          buf,
          buildExportOptions(
            ctx.docOf(get()),
            {
              id: "live",
              label: "Export",
              w: res.w,
              h: res.h,
              fps,
              mbps,
              format: "mp4",
              // Canvas loops stay H.264 — they are for upload to platforms
              // whose ingest is pickiest about codecs.
              codec: canvasMode ? "h264" : settings.codec,
            },
            {
              name: engine.state.trackName ?? "visualization",
              meta: get().trackMeta,
              coverArt: get().coverArt,
              beatGrid: get().beatGrid,
              sections: get().sections,
              stems: get().stems,
              lyrics:
                get().lyrics && get().lyricStyle.enabled
                  ? { lines: get().lyrics!, style: get().lyricStyle }
                  : undefined,
              // Ungated on purpose — see TrackInput.vocalLines.
              vocalLines: get().lyrics ?? undefined,
              audiogram: audiogramActive(get().audiogram)
                ? { settings: get().audiogram, waveform: get().waveformOverview }
                : undefined,
              customPresets: get().customDefs,
            },
            overlay,
            {
              // Desktop: stream straight to the picked file (flat memory);
              // browser dev falls back to an in-memory blob + download.
              // ProRes renders PNG frames into the sidecar instead.
              streamToPath: sidecarMode ? undefined : (savePath ?? undefined),
              pngDir: pngDir ?? undefined,
              onPngFrame: pngSidecarMode
                ? (data) => {
                    proresChain = proresChain
                      .then(() => proresWrite(data))
                      .catch((e: unknown) => {
                        proresFail.err ??= e;
                        ac.abort(); // stop rendering — ffmpeg is gone
                      });
                    // RETURN the chain: the core awaits it, so the render is
                    // paced by ffmpeg's blocking stdin write instead of piling
                    // 4K PNGs up in memory. Without this the Rust-side
                    // backpressure was discarded here.
                    return proresChain;
                  }
                : undefined,
              // AV1 10-bit: ask the core for the deep-color tap, and feed the
              // raw frames down the same serialized sidecar chain as ProRes'
              // PNGs — same ordering guarantee, same ffmpeg backpressure.
              deepColor: av1Mode ? true : undefined,
              onRawFrame: av1Mode
                ? (data: Uint16Array) => {
                    proresChain = proresChain
                      .then(() =>
                        // The Uint16Array is tightly-packed R,G,B,A u16s; its
                        // underlying bytes go to the write command verbatim.
                        // Assumption, noted: JS typed arrays use the host's
                        // byte order, which is little-endian on every target
                        // this app ships to — so the raw byte view IS the
                        // rgba64le stream ffmpeg was told to expect.
                        proresWrite(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
                      )
                      .catch((e: unknown) => {
                        proresFail.err ??= e;
                        ac.abort(); // stop rendering — ffmpeg is gone
                      });
                    // RETURN the chain: the core awaits it (backpressure).
                    return proresChain;
                  }
                : undefined,
              segment,
              loopCrossfadeSec: canvasMode ? 0.5 : undefined,
              // Only MP4 normalizes: PNG carries no audio, and the sidecar
              // mezzanine lanes (ProRes, AV1 10-bit) deliberately keep the
              // source levels — a mastering deliverable is not re-leveled.
              loudness:
                settings.loudnessTarget != null && settings.format === "mp4"
                  ? { targetLufs: settings.loudnessTarget, truePeakDb: settings.truePeakDb }
                  : undefined,
              signal: ac.signal,
              onProgress: (done, total) => {
                const now = performance.now();
                const elapsed = (now - exportStartedAt) / 1000;
                // Windowed rate (E4b): drop samples older than the window,
                // always keeping at least the one just pushed so the first
                // call of a run never reads an empty ring.
                speedWindow.push({ t: now, done });
                const windowStartT = now - SPEED_WINDOW_MS;
                while (speedWindow.length > 1 && speedWindow[0].t < windowStartT) {
                  speedWindow.shift();
                }
                const oldest = speedWindow[0];
                const windowSecs = (now - oldest.t) / 1000;
                const windowDone = done - oldest.done;
                set({
                  exporting: {
                    done,
                    total,
                    speed: windowSecs > 0 && windowDone > 0 ? windowDone / windowSecs : null,
                    avgSpeed: done > 0 && elapsed > 0 ? done / elapsed : null,
                  },
                });
              },
            },
          ),
        );
        if (sidecarMode) {
          // All frames rendered — drain the pipe, close it, wait for ffmpeg.
          await proresChain;
          if (proresFail.err != null) throw proresFail.err;
          await proresFinish();
          set({
            exportDone: proresMode
              ? `ProRes 4444 MOV (PCM audio) saved to ${savePath}`
              : av1Mode
                ? `AV1 10-bit MP4 (AAC audio) saved to ${savePath}`
                : `${animFormat === "gif" ? "GIF" : "WebP"} loop saved to ${savePath}`,
            exportDonePath: savePath,
          });
        } else {
          if (result.blob) downloadBlob(result.blob, fileName);
          set({
            exportDone: pngDir
              ? `${(result.bytes / 1e6).toFixed(1)} MB PNG sequence saved to ${pngDir}`
              : `${(result.bytes / 1e6).toFixed(1)} MB ${
                  webmMode
                    ? "WebM (VP9 + alpha"
                    : `MP4 (${CODEC_LABELS[canvasMode ? "h264" : settings.codec].split(" ")[0]}`
                } + ${result.audioCodec.toUpperCase()}) saved${savePath ? ` to ${savePath}` : ""}`,
            // Browser downloads set neither: there is no path to reveal.
            exportDonePath: pngDir ?? savePath ?? null,
          });
        }
      } catch (e) {
        if (sidecarMode) await proresAbort().catch(() => undefined);
        // A dead sidecar aborts the render, so the surfaced error arrives
        // wearing an AbortError coat — check the sidecar failure FIRST or a
        // mid-render ffmpeg death reads as a user cancel and shows nothing.
        // Disk failures arrive wearing the wrong label — most notably the Blob
        // API's NotReadableError, whose stock text blames "permission
        // problems" and points the user at the drive they exported TO, which
        // is the one drive known to be fine. Translate first, fall back to the
        // raw text when it is not a disk problem.
        const raw = proresFail.err ?? e;
        if (proresFail.err != null || (e as Error)?.name !== "AbortError") {
          // NotReadableError is ambiguous. Re-measure scratch NOW instead of
          // turning a stale preflight snapshot into a confident disk diagnosis.
          const scratchNow = scratchPathForError ? await diskSpace(scratchPathForError) : null;
          set({ exportError: translateExportError(raw, scratchNow) ?? errText(raw) });
        }
      } finally {
        overlayBitmap?.close();
        set({ exporting: null });
        shared.exportAbort = null;
        endExportPreparing();
      }
    },

    cancelExport() {
      shared.exportAbort?.abort();
    },
  } satisfies Partial<VizState>;
}
