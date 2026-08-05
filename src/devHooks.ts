import { useVizStore, type VizState } from "./state/store";
import { getAnalyzer, getEngine, getPresentedFrames } from "./state/services";
import { writeLrc } from "./state/lyricsEdit";
import { rasterizeOverlay } from "./render/overlay";
import { exportVideo } from "./export/videoExporter";
import type { VideoCodecId } from "./export/codecProbe";
import { buildExportOptions } from "./export/buildExportOptions";
import { DEFAULT_POST } from "./render/types";
import { audiogramActive } from "./state/audiogram";
import { integratedLufs } from "./audio/dsp/lufs";
import { truePeakDbfs } from "./audio/dsp/truepeak";
import { expandJobs, type BatchRun } from "./state/batch";
import { runBatch } from "./state/batchRunner";
import type { ProjectDocument } from "./state/project";
import { runGpuPixelMatrix } from "./render/gpuMatrix";
import { getPrefs, setPrefs } from "./state/prefs";
import { newUserPresetId, serializeUserPreset } from "./state/userPresets";
import { serializeTheme, type ThemeMeta } from "./state/themes";
import { presets } from "./render/presets";
import { APP_VERSION } from "./version";
import { pcmFromAudioBuffer } from "./audio/offlineSource";
import { wavFromPcm } from "./audio/dsp/wav";
import { proresSetAudio, av1Begin, proresWrite, proresFinish, proresAbort } from "./state/platform";

/**
 * Dev-only E2E probes, extracted whole from App.tsx (they were ~240 lines and
 * half its import list). Installed once by a DEV-gated effect; every probe
 * hangs off `window` so the browser-pane harness can drive the real export
 * and batch pipelines without a filesystem.
 */

/**
 * The store's document slice as a real `ProjectDocument`.
 *
 * ANNOTATED, never cast. Both probes used to hand-roll their own document (or
 * their own ExportOptions) behind an `as unknown as T`, and the cast hid every
 * omission from tsc: the batch probe's doc silently lacked `builderStack`, so
 * exportCore never called rebuildBuilder2 and a Builder-mode run rendered
 * ALL-BLACK frames while reporting `{k:"done"}`; it also lacked the custom
 * defs, so a custom-shader run quietly rendered Spectrum Bars instead. With
 * the annotation, the next field added to ProjectDocument is a compile error
 * here instead of a silently wrong probe run.
 *
 * store.docOf does this for the app, but it lives inside create()'s closure
 * (SliceCtx) and is not on VizState, so the probes cannot borrow it.
 */
function docFromState(s: VizState): ProjectDocument {
  return {
    presetId: s.presetId,
    paramsByPreset: s.paramsByPreset,
    syncByPreset: s.syncByPreset,
    bg: s.bg,
    bgByPreset: s.bgByPreset,
    centerImageByPreset: s.centerImageByPreset,
    overlayLayers: s.overlayLayers,
    assets: s.assets,
    aspect: s.aspect,
    modsByPreset: s.modsByPreset,
    smoothSpectrum: s.smoothSpectrum,
    timeline: s.timeline,
    post: s.post,
    motion: s.motion,
    lyricStyle: s.lyricStyle,
    audiogram: s.audiogram,
    // The WHOLE library, not docOf's referenced-only filter: a probe exists to
    // exercise a specific def, and an empty registry falls back to presets[0]
    // (Spectrum Bars) without saying a word.
    customDefs: s.customDefs,
    builderStack: s.builderStack,
  };
}

/**
 * FNV-1a over raw PNG bytes — a content fingerprint for the export harness.
 * Not cryptographic; it only has to make "these two frames differ" cheap to
 * see across thousands of frames.
 */
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function installDevHooks(store: typeof useVizStore.getState): void {
  (window as unknown as { __runGpuMatrix: unknown }).__runGpuMatrix = runGpuPixelMatrix;
  // The app's store instance (HMR-safe), for state assertions in E2E runs
  (window as unknown as { __store: unknown }).__store = useVizStore;
  // Tauri invoke via the APP's module graph. CDP `Runtime.evaluate` cannot
  // resolve bare specifiers (`import("@tauri-apps/api/core")` throws in the
  // eval context — the v2.68.1 lesson), so harnesses that need an IPC call
  // (lyrics-e2e: debug_set_lyrics_models_dir, lyrics_model_verify) reach it
  // through this hook instead. DEV-gated like every other probe here.
  (window as unknown as { __invoke: unknown }).__invoke = async (
    cmd: string,
    invokeArgs?: Record<string, unknown>,
  ) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(cmd, invokeArgs);
  };
  // The live audio engine, for E2E probes (module import from the console
  // would get a DIFFERENT instance — "services not initialized").
  (window as unknown as { __engine: unknown }).__engine = getEngine();
  // The lyrics-editor LRC writer over the CURRENT store lines — the e2e's
  // round-trip leg (writer -> loadLyricsText -> parser) needs the exact text
  // the Save button would write, without driving a native save dialog.
  (window as unknown as { __lyricsLrc: unknown }).__lyricsLrc = () =>
    writeLrc(useVizStore.getState().lyrics ?? []);
  // Presented-frame counter from the live render loop (perf-overlay FPS
  // source) — lets E2E prove caps/scale act on PRESENTS, not rAF ticks.
  (window as unknown as { __presentedFrames: unknown }).__presentedFrames = getPresentedFrames;
  (window as unknown as { __analyzer: unknown }).__analyzer = getAnalyzer();
  // Gallery seed tooling (FEAT-003): dump every mode's param schema + factory
  // styles so candidate looks can be designed offline...
  (window as unknown as { __presets: unknown }).__presets = () =>
    presets.map((p) => ({
      id: p.id,
      name: p.name,
      params: p.params.map((s) => ({
        key: s.key,
        label: s.label,
        min: s.min,
        max: s.max,
        default: s.default,
        group: s.group ?? null,
      })),
      styles: (p.styles ?? []).map((st) => ({ id: st.id, name: st.name, values: st.values })),
    }));
  // ...and serialize the CURRENT setup through the app's own writers, so a
  // seed .bfpreset/.bftheme is byte-for-byte what the real export buttons
  // would produce (same schema versions, same field rules).
  (window as unknown as { __gallerySerialize: unknown }).__gallerySerialize = (
    kind: "look" | "theme",
    meta: { name: string; author?: string; description?: string },
  ) => {
    const s = store();
    if (kind === "look") {
      return serializeUserPreset({
        id: newUserPresetId(),
        name: meta.name,
        presetId: s.presetId,
        params: { ...(s.paramsByPreset[s.presetId] ?? {}) },
        ...(s.syncByPreset[s.presetId] ? { sync: s.syncByPreset[s.presetId] } : {}),
        createdAt: new Date().toISOString(),
      });
    }
    const themeMeta: ThemeMeta = {
      name: meta.name,
      author: meta.author ?? "Beatform",
      license: "CC0-1.0",
      ...(meta.description !== undefined ? { description: meta.description } : {}),
    };
    return serializeTheme(docFromState(s), themeMeta, APP_VERSION);
  };
  (window as unknown as { __prefs: unknown }).__prefs = { get: getPrefs, set: setPrefs };
  // UI clipping auditor for the browser-pane harness (referenced by the
  // testing hand-off): walks a scope's visible DOM and reports horizontally
  // clipped text, elements poking outside the scope, and content below the
  // viewport with no scrollable ancestor. Pure inspection, DEV-only.
  (window as unknown as { __auditUI: unknown }).__auditUI = (scopeSel: string) => {
    const scope = document.querySelector(scopeSel);
    if (!scope) return { error: "no scope " + scopeSel };
    const sr = scope.getBoundingClientRect();
    const issues: Array<{ kind: string; el: string; px: number }> = [];
    const seen = new Set<string>();
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>("*"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const id =
        (el.className?.toString?.() || el.tagName) + "|" + (el.textContent ?? "").slice(0, 25);
      if (
        el.children.length === 0 &&
        el.scrollWidth > el.clientWidth + 1 &&
        cs.textOverflow !== "ellipsis" &&
        cs.overflowX !== "auto" &&
        cs.overflowX !== "scroll" &&
        !seen.has("clip|" + id)
      ) {
        seen.add("clip|" + id);
        issues.push({ kind: "text-clip", el: id, px: el.scrollWidth - el.clientWidth });
      }
      if ((r.right > sr.right + 2 || r.left < sr.left - 2) && !seen.has("out|" + id)) {
        let p = el.parentElement;
        let scrollable = false;
        while (p && p !== scope.parentElement) {
          const pcs = getComputedStyle(p);
          if (/(auto|scroll)/.test(pcs.overflowX)) {
            scrollable = true;
            break;
          }
          p = p.parentElement;
        }
        if (!scrollable) {
          seen.add("out|" + id);
          issues.push({ kind: "outside-scope-x", el: id, px: Math.round(r.right - sr.right) });
        }
      }
      if (r.bottom > innerHeight + 2 && cs.position !== "fixed" && !seen.has("vp|" + id)) {
        let p = el.parentElement;
        let scrollable = false;
        while (p && p !== document.body) {
          const pcs = getComputedStyle(p);
          if (/(auto|scroll)/.test(pcs.overflowY)) {
            scrollable = true;
            break;
          }
          p = p.parentElement;
        }
        if (!scrollable) {
          seen.add("vp|" + id);
          issues.push({
            kind: "below-viewport-unscrollable",
            el: id,
            px: Math.round(r.bottom - innerHeight),
          });
        }
      }
    }
    return issues;
  };
  (window as unknown as { __loadFile: unknown }).__loadFile = async (url: string, name: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
    const buf = await r.arrayBuffer();
    await store().loadFile(new File([buf], name));
    return getEngine().state;
  };
  (window as unknown as { __runExport: unknown }).__runExport = async (
    opts: Partial<{
      width: number;
      height: number;
      fps: number;
      withOverlay: boolean;
      canvasLoop: { start: number; duration: number };
      post: import("./render/types").PostSettings;
      /** Video codec — mirrors store.runExport's ExportSettings.codec. */
      codec: VideoCodecId;
      /** Render a PNG sequence instead of MP4; frames are counted, not written. */
      png: boolean;
      /**
       * Debug shell only (needs Tauri IPC): run the REAL AV1 10-bit lane —
       * deep-color tap, raw rgba64le frames into the av1 ffmpeg sidecar,
       * finished .mp4 at this path. Mirrors exportActions' av1Mode leg.
       */
      av1Path: string;
      /** Normalize the exported audio (audio lane only). */
      loudness: import("./export/exportCore").LoudnessJob;
      /**
       * Decode the finished MP4 and re-measure it, so normalization is
       * verified end-to-end through the encoder rather than trusting the
       * limiter's own arithmetic.
       */
      verifyAudio: boolean;
    }> = {},
  ) => {
    const buf = getEngine().audioBuffer;
    if (!buf) throw new Error("no track loaded");
    const s = store();
    const w = opts.width ?? 320;
    const h = opts.height ?? 180;
    // Overlay: the document's real layers (mirrors store.runExport), or a
    // synthetic test box when withOverlay is forced.
    let overlay: ImageBitmap | undefined;
    if (opts.withOverlay) {
      const oc = new OffscreenCanvas(w, h);
      const c2d = oc.getContext("2d")!;
      c2d.fillStyle = "rgba(255,40,40,0.9)";
      c2d.fillRect(w * 0.25, h * 0.4, w * 0.5, h * 0.2);
      overlay = oc.transferToImageBitmap();
    } else {
      overlay = (await rasterizeOverlay(s.overlayLayers, s.assets, w, h, s.trackMeta)) ?? undefined;
    }
    const t0 = performance.now();
    // PNG probe: collect frame sizes instead of writing files (no desktop fs
    // in a browser); lets the harness verify the sequence path end-to-end.
    const pngFrames: number[] = [];
    // A per-frame content hash, not just frame 0. Anything that ACCUMULATES
    // across frames (the particle sim, feedback trails) is identical on frame
    // 0 no matter how badly it diverges later, so a frame-0-only baseline
    // silently passes the exact regressions it exists to catch.
    const pngHashes: string[] = [];
    const doc = docFromState(s);
    // AV1 10-bit probe lane: real sidecar handshake, real deep-color tap —
    // the same chain-serialized backpressure as exportActions' av1Mode leg.
    let rawFrames = 0;
    let rawDistinct = 0;
    let proresChain = Promise.resolve();
    const proresFail: { err: unknown } = { err: null };
    if (opts.av1Path) {
      // Headless stand-in for the save dialog's allow_file — debug builds only
      // (the command is a hard error in release).
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("debug_allow_path", { path: opts.av1Path });
      await proresSetAudio(wavFromPcm(pcmFromAudioBuffer(buf)));
      await av1Begin(opts.fps ?? 30, w, h, opts.av1Path);
    }
    // Everything the document contributes goes through the SAME builder the
    // app's export path and the batch runner use. This probe used to re-derive
    // bg / coverArt / bgImage / bgVideo itself — a THIRD copy of rules that
    // buildExportOptions exists to hold exactly once — so every per-mode change
    // (v2.46) had to be made twice, and the copy that was missed is precisely
    // why the probe kept testing a background the app would never render.
    const result = await exportVideo(
      buf,
      buildExportOptions(
        {
          ...doc,
          // Probe-only override. A PARTIAL post object is a trap: `exposure`
          // is a MULTIPLY (1 = neutral), so omitting it lands 0 in the uniform
          // and every frame renders solid black — which silently turned a
          // whole regression baseline into hashes of black frames.
          post: opts.post ? { ...DEFAULT_POST, ...opts.post } : doc.post,
        },
        {
          id: "probe",
          label: "probe",
          w,
          h,
          fps: opts.fps ?? 30,
          mbps: 1,
          format: "mp4",
          codec: opts.codec,
        },
        {
          name: getEngine().state.trackName ?? "visualization",
          meta: s.trackMeta,
          coverArt: s.coverArt,
          beatGrid: s.beatGrid,
          stems: s.stems,
          lyrics:
            s.lyrics && s.lyricStyle.enabled ? { lines: s.lyrics, style: s.lyricStyle } : undefined,
          audiogram: audiogramActive(s.audiogram)
            ? { settings: s.audiogram, waveform: s.waveformOverview }
            : undefined,
          customPresets: s.customDefs,
        },
        overlay,
        {
          onPngFrame: opts.png
            ? (data, index) => {
                pngFrames.push(data.length);
                pngHashes.push(fnv1a(data));
                // Keep frame 0 around so tooling can decode + inspect it.
                if (index === 0) {
                  (window as unknown as { __lastPngFrame: Blob }).__lastPngFrame = new Blob(
                    [data.slice()],
                    { type: "image/png" },
                  );
                }
                // ...and the FINAL frame, which is the only useful one for
                // anything that accumulates. Frame 0 of the particle sim is
                // the initial seeded disc (uniform noise) and frame 0 of a
                // feedback preset has no trail at all, so a frame-0-only probe
                // makes those two look broken when they are working perfectly.
                (window as unknown as { __lastPngFrameEnd: Blob }).__lastPngFrameEnd = new Blob(
                  [data.slice()],
                  { type: "image/png" },
                );
              }
            : undefined,
          deepColor: opts.av1Path ? true : undefined,
          onRawFrame: opts.av1Path
            ? (data: Uint16Array) => {
                rawFrames++;
                // Renderer-leg proof: distinct u16 red-channel values in the
                // final frame. An 8-bit-quantized source can't exceed 256.
                const set = new Set<number>();
                for (let i = 0; i < data.length; i += 4) set.add(data[i]);
                rawDistinct = set.size;
                proresChain = proresChain
                  .then(() =>
                    proresWrite(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
                  )
                  .catch((e: unknown) => {
                    proresFail.err ??= e;
                  });
                return proresChain;
              }
            : undefined,
          segment: opts.canvasLoop,
          loopCrossfadeSec: opts.canvasLoop ? 0.5 : undefined,
          loudness: opts.loudness,
        },
      ),
    ).catch(async (e: unknown) => {
      if (opts.av1Path) await proresAbort().catch(() => undefined);
      throw proresFail.err ?? e;
    });
    if (opts.av1Path) {
      await proresChain;
      if (proresFail.err != null) {
        await proresAbort().catch(() => undefined);
        throw proresFail.err;
      }
      await proresFinish();
    }
    // Decode what we actually wrote and measure it. AAC is lossy, so this is
    // the honest number a delivery target would see — not what we intended.
    let measured: { lufs: number; truePeakDb: number } | undefined;
    if (opts.verifyAudio && result.blob) {
      const ac = new AudioContext();
      try {
        const decoded = await ac.decodeAudioData(await result.blob.arrayBuffer());
        const chans = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
          decoded.getChannelData(i),
        );
        measured = {
          lufs: integratedLufs(chans, decoded.sampleRate),
          truePeakDb: truePeakDbfs(chans),
        };
      } finally {
        await ac.close();
      }
    }
    const info = {
      bytes: result.bytes,
      ms: Math.round(performance.now() - t0),
      audioCodec: result.audioCodec,
      seconds: result.seconds,
      ...(result.loudness ? { loudness: result.loudness } : {}),
      ...(measured ? { measured } : {}),
      ...(opts.png ? { pngFrames: pngFrames.length, pngBytes: pngFrames, pngHashes } : {}),
      ...(opts.av1Path ? { rawFrames, rawDistinct } : {}),
    };
    (window as unknown as { __lastExport: unknown }).__lastExport = info;
    (window as unknown as { __lastExportBlob: Blob | undefined }).__lastExportBlob = result.blob;
    return info;
  };

  // Drives the REAL batch runner without a filesystem: jobs render to blobs
  // instead of streaming to disk, so the loop (per-track decode + analysis,
  // per-job isolation, abort, ordering) can be exercised in browser dev.
  (window as unknown as { __runBatch: unknown }).__runBatch = async (
    files: File[],
    opts: {
      width?: number;
      height?: number;
      fps?: number;
      /** Fail the Nth job (0-based) to prove per-job isolation. */
      failOn?: number;
      /** Loudness target, frozen with the run — the real panel freezes one
       * here too, and without it the probe cannot exercise that lane at all. */
      loudness?: { targetLufs: number; truePeakDb: number };
    } = {},
  ) => {
    // Start clean: addBatchTracks appends (as it should for the real UI),
    // which would silently carry tracks over between probe runs.
    for (const t of store().batch?.tracks ?? []) store().removeBatchTrack(t.id);
    await store().addBatchTracks(files);
    // Re-read AFTER the await: store() is a snapshot and zustand replaces the
    // state object on set, so the pre-await one never sees the new tracks.
    const s = store();
    const tracks = s.batch?.tracks ?? [];
    const fmt = {
      id: "probe",
      label: "probe",
      w: opts.width ?? 192,
      h: opts.height ?? 108,
      fps: opts.fps ?? 30,
      mbps: 1,
      format: "mp4" as const,
    };
    // Annotated, NOT cast: see docFromState. `as unknown as BatchRun` is what
    // let this literal ship without `builderStack`, and the resulting probe
    // reported a clean `{k:"done"}` over all-black frames.
    const run: BatchRun = {
      doc: docFromState(s),
      tracks,
      formats: [fmt],
      outDir: "/probe",
      // Date.now, NOT performance.now — the panel's countdown ticks on the
      // wall clock, so mixing epochs reports an elapsed of ~55 years (see the
      // note on BatchRun.startedAt).
      startedAt: Date.now(),
      jobs: [],
      // Frozen with the run, exactly as batchActions does. The doc only
      // carries a custom preset's ID; without the defs riding along the export
      // worker's registry is empty, presetById falls through to presets[0] and
      // every job silently renders Spectrum Bars.
      customPresets: s.customDefs,
      loudness: opts.loudness,
    };
    run.jobs = expandJobs(run.tracks, run.formats, run.outDir);

    const events: string[] = [];
    const statuses: Record<string, unknown> = {};
    let jobIndex = -1;
    await runBatch(run, {
      // blob mode: no fs needed. Also the injection point for `failOn` —
      // runBatch calls onJobStart OUTSIDE its per-job try, so a throw from
      // there escapes the whole loop and rejects the run, which proves the
      // opposite of the isolation this affordance claims to test. streamPathFor
      // is read inside the try, so a throw here lands in the per-job catch and
      // genuinely exercises "one job's failure is one job's failure".
      streamPathFor: () => {
        if (opts.failOn != null && jobIndex === opts.failOn) throw new Error("probe: injected");
        return undefined;
      },
      onJobStart: (id) => {
        events.push(`start:${id}`);
        jobIndex++;
      },
      onJobUpdate: (id, st) => {
        statuses[id] = st;
        if (st.k !== "running") events.push(`${st.k}:${id}`);
      },
      shouldStop: () => false,
    });
    return {
      jobs: run.jobs.map((j) => ({
        out: j.outPath,
        status: statuses[j.id] ?? j.status,
      })),
      events,
    };
  };
}
