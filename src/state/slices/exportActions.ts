import { wavFromPcm } from "../../audio/dsp/wav";
import { pcmFromAudioBuffer } from "../../audio/offlineSource";
import { buildExportOptions } from "../../export/buildExportOptions";
import { CODEC_LABELS, probeCodecs } from "../../export/codecProbe";
import { exportVideo } from "../../export/videoExporter";
import { rasterizeOverlay } from "../../render/overlay";
import { audiogramActive } from "../audiogram";
import { safeName } from "../batch";
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

export function exportActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    setShowExport(showExport) {
      set({ showExport });
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
        set({ exportError: SIMPLIFIED_EXPORT_REASON, exportDone: null });
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
      if (isTauri()) {
        if (pngMode) {
          const dir = await pickFolder("Choose a folder for the PNG sequence");
          if (!dir) {
            shared.exportStarting = false;
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
            shared.exportStarting = false;
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
        shared.exportStarting = false;
        return;
      }
      if (genAtStart !== shared.trackLoadGen) {
        set({ exportError: "The track changed while the save dialog was open — export cancelled" });
        shared.exportStarting = false;
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
          shared.exportStarting = false;
          return;
        }
      }

      const ac = new AbortController();
      shared.exportAbort = ac;
      exportStartedAt = performance.now();
      set({
        exportError: null,
        exportDone: null,
        exporting: { done: 0, total: 1, speed: null },
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
              stems: get().stems,
              lyrics:
                get().lyrics && get().lyricStyle.enabled
                  ? { lines: get().lyrics!, style: get().lyricStyle }
                  : undefined,
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
                const elapsed = (performance.now() - exportStartedAt) / 1000;
                set({
                  exporting: {
                    done,
                    total,
                    speed: done > 0 && elapsed > 0 ? done / elapsed : null,
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
        shared.exportStarting = false;
      }
    },

    cancelExport() {
      shared.exportAbort?.abort();
    },
  } satisfies Partial<VizState>;
}
