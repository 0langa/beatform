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
import {
  proresSetAudio,
  av1Begin,
  proresBegin,
  proresWrite,
  proresFinish,
  proresAbort,
} from "./state/platform";
// The track-load counter itself, not a store field — it lives outside the
// state object on purpose (slices/shared.ts), so `store()` cannot hand it over
// and __runExport's guard below has to read it where runExport reads it.
import { shared } from "./state/slices/shared";

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
 * One box's scroll story on ONE axis, as plain numbers rather than an Element.
 *
 * The predicate below is the only genuinely load-bearing logic in `__auditUI`,
 * and it is unreachable from a unit test through the DOM: jsdom answers 0 to
 * every geometry question, so the only way to test it is to hand it the shapes
 * a real layout engine would have produced.
 */
export type AxisScroll = {
  /** Which axis is being walked. The predicate is NOT symmetric — see below. */
  axis: "x" | "y";
  /** Computed `overflow-x`/`overflow-y` on the axis being walked. */
  overflow: string;
  /** ...and on the other one, which is the whole reason this type exists. */
  crossOverflow: string;
  /** `scrollWidth`/`scrollHeight` and its `client*` twin, on the walked axis. */
  scrollExtent: number;
  clientExtent: number;
  /** The same pair on the other axis. */
  crossScrollExtent: number;
  crossClientExtent: number;
};

/**
 * Does this box GENUINELY scroll on the walked axis — can the user actually
 * move it to reveal something sitting outside it?
 *
 * `getComputedStyle(el).overflowX === "auto"` is NOT that question, and
 * believing it was is why a 0px-wide slider shipped for three releases. CSS
 * computes `visible` to `auto` on one axis whenever the other axis is a
 * scroller, and the computed value keeps no record of which axis the author
 * asked for. Measured in the app's own engine: specified `visible/auto` and
 * `visible/hidden` both compute to `auto/...`, i.e. `.panel-scroll`'s single
 * `overflow-y: auto` makes it look like a horizontal scroller to the CSSOM.
 * Every element in the dock has it as an ancestor, so the `outside-scope-x`
 * walk found a "scrollable" ancestor for all of them and could never fire.
 *
 * Three clauses, each answering a different way of not-scrolling:
 *
 * 1. `visible` / `hidden` / `clip` — not a scroll container at all.
 * 2. No scroll RANGE. `auto` means "a scrollbar only if one is needed"; with
 *    `scrollExtent <= clientExtent` there is no scrollbar and nowhere to go, so
 *    a child outside the box is CLIPPED, not scrolled to. Measured: an
 *    `overflow: hidden` wrapper inside `.panel-scroll` holding a 400px child
 *    leaves the scroller at scrollWidth === clientWidth while the child's rect
 *    pokes 199px past the panel — invisible content that the old walk excused.
 *    `scroll` gets the same treatment: a permanently drawn scrollbar with zero
 *    range still scrolls nowhere.
 * 3. The propagation trap itself, and this clause is HORIZONTAL-ONLY.
 *    `scroll` is the one value the rule never mints, so it is proof of intent
 *    and short-circuits first. A bare `auto` cannot be proven either way from
 *    computed style, so it is read from what the box is DOING — but only on x,
 *    because the two axes are not symmetric in authoring. Documents flow
 *    downward: a box that scrolls vertically is doing the ordinary thing, while
 *    horizontal scrolling is the exception an author has to ask for. So a box
 *    that is ALSO an actively-scrolling vertical scroller is overwhelmingly
 *    likely to have had its `overflow-x: auto` minted by the rule. That is
 *    exactly `.panel-scroll` and exactly not `.chips` (`overflow-x: auto`, one
 *    flex row, no vertical range — caught by clause 2) or `.tl-scroll`
 *    (`overflow-y: hidden`, not a y scroller at all).
 *
 *    Applying it symmetrically was MEASURED to be wrong, on the live dock: with
 *    a too-wide row present, `.panel-scroll` has range on both axes, so a
 *    symmetric rule denied its VERTICAL excuse too and the auditor returned 50
 *    findings for one defect — 41 of them `below-viewport-unscrollable` against
 *    a scroller that scrolls down perfectly well. On y, clause 2 already covers
 *    the mirror blind spot (`.chips` computes `overflow-y: auto` from its own
 *    `overflow-x` and has no vertical range), so y needs nothing more.
 *
 * The residual over-report is a box that scrolls in BOTH axes on purpose
 * (`overflow: auto` over content that is both tall and wide) with an element
 * child poking outside the audited scope. In this tree that set is empty: the
 * only two such boxes are `.crash-detail` and `.shader-src`, both hold text
 * nodes rather than element children (so `querySelectorAll("*")` finds nothing
 * inside them) and neither is inside an audited scope. Erring that way is also
 * the right direction — inside a fixed-size panel, "content pokes out of a box
 * scrolling in two directions" is a finding, not noise.
 */
export function scrollsOnAxis(m: AxisScroll): boolean {
  if (m.overflow !== "auto" && m.overflow !== "scroll") return false;
  // +1, matching the text-clip check below: sub-pixel layout rounds these two
  // apart by fractions on perfectly fitting content.
  if (m.scrollExtent <= m.clientExtent + 1) return false;
  if (m.overflow === "scroll") return true;
  if (m.axis === "y") return true;
  const crossScrolls =
    (m.crossOverflow === "auto" || m.crossOverflow === "scroll") &&
    m.crossScrollExtent > m.crossClientExtent + 1;
  return !crossScrolls;
}

/**
 * Form controls that paint their own text and whose element children are not
 * laid out in flow. Exactly one member, and the list is written as a set so the
 * next one is an addition rather than a rewrite.
 *
 * A `<select>`'s `<option>`s never become boxes in the row: the closed control
 * paints the selected option's label itself. Measured in the app's engine, an
 * 80px select showing a 45-character option reports scrollWidth 257 against
 * clientWidth 78 — a 179px clip — with `children.length === 2`.
 */
const SELF_RENDERED_TEXT_TAGS = new Set(["SELECT"]);

/**
 * Is this element a leaf for TEXT purposes — is the text we are about to
 * measure its own, rather than a descendant's?
 *
 * `children.length === 0` alone was the test, and it is why no truncated
 * dropdown in the tree was ever reported. Widening it to every element with
 * children would be worse than the gap: a container's `scrollWidth` overflows
 * whenever ANY descendant does, so every wrapper in the dock would report the
 * same clip its child already reported, and the auditor would drown.
 */
export function rendersOwnText(tagName: string, childCount: number): boolean {
  return childCount === 0 || SELF_RENDERED_TEXT_TAGS.has(tagName);
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
  // Its two former blind spots — a computed-style-only scroll test, and a
  // text-clip check that skipped anything with element children — are fixed in
  // `scrollsOnAxis` / `rendersOwnText` above, where they are unit-testable.
  (window as unknown as { __auditUI: unknown }).__auditUI = (scopeSel: string) => {
    const scope = document.querySelector(scopeSel);
    if (!scope) return { error: "no scope " + scopeSel };
    const sr = scope.getBoundingClientRect();
    const issues: Array<{ kind: string; el: string; px: number }> = [];
    const seen = new Set<string>();
    // Both walks below ask `scrollsOnAxis` the same question about a box, once
    // per axis; this is the only place that knows which DOM property is which
    // axis, so the predicate itself stays plain data and stays testable.
    const axisOf = (el: Element, cs: CSSStyleDeclaration, horizontal: boolean): AxisScroll =>
      horizontal
        ? {
            axis: "x",
            overflow: cs.overflowX,
            crossOverflow: cs.overflowY,
            scrollExtent: el.scrollWidth,
            clientExtent: el.clientWidth,
            crossScrollExtent: el.scrollHeight,
            crossClientExtent: el.clientHeight,
          }
        : {
            axis: "y",
            overflow: cs.overflowY,
            crossOverflow: cs.overflowX,
            scrollExtent: el.scrollHeight,
            clientExtent: el.clientHeight,
            crossScrollExtent: el.scrollWidth,
            crossClientExtent: el.clientWidth,
          };
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>("*"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const id =
        (el.className?.toString?.() || el.tagName) + "|" + (el.textContent ?? "").slice(0, 25);
      if (
        rendersOwnText(el.tagName, el.children.length) &&
        el.scrollWidth > el.clientWidth + 1 &&
        cs.textOverflow !== "ellipsis" &&
        // The element's own horizontal scrollbar excuses its own clipped text —
        // but only a REAL one. Same propagation trap as the walks below: a
        // `overflow-y: auto` box reads as `overflow-x: auto` to the CSSOM.
        !scrollsOnAxis(axisOf(el, cs, true)) &&
        !seen.has("clip|" + id)
      ) {
        seen.add("clip|" + id);
        issues.push({ kind: "text-clip", el: id, px: el.scrollWidth - el.clientWidth });
      }
      if ((r.right > sr.right + 2 || r.left < sr.left - 2) && !seen.has("out|" + id)) {
        let p = el.parentElement;
        let scrollable = false;
        while (p && p !== scope.parentElement) {
          if (scrollsOnAxis(axisOf(p, getComputedStyle(p), true))) {
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
          if (scrollsOnAxis(axisOf(p, getComputedStyle(p), false))) {
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
      /**
       * Debug shell only (needs Tauri IPC): run the REAL ProRes 4444 deep
       * lane (FEAT-005 follow-up) — same raw rgba64le deep-color tap as
       * av1Path, but through prores_begin (yuva444p10le, straight alpha)
       * instead of av1_begin. Mirrors exportActions' proresMode leg exactly,
       * including deepStraightAlpha — the un-premultiply av1Path's lane
       * never needed (AV1's yuv420p10le carries no alpha at all). Mutually
       * exclusive with av1Path; av1Path wins if both are somehow set.
       */
      proresPath: string;
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
    // Nothing this hook produces may outlive a run that did not finish: these
    // are the side channel a console session (docs/presets.md) and any future
    // harness read AFTER the call, and a refusal that left the PREVIOUS run's
    // frames standing here would be a wrong number that looks right.
    const win = window as unknown as {
      __lastExport?: unknown;
      __lastExportBlob?: Blob;
      __lastPngFrame?: Blob;
      __lastPngFrameEnd?: Blob;
    };
    win.__lastExport = undefined;
    win.__lastExportBlob = undefined;
    win.__lastPngFrame = undefined;
    win.__lastPngFrameEnd = undefined;
    const buf = getEngine().audioBuffer;
    if (!buf) throw new Error("no track loaded");
    // Sampled with `buf`, and read twice below — the same pair runExport keeps
    // (E3d), because the counter and the buffer answer different halves of the
    // same question and neither answers both.
    const genAtStart = shared.trackLoadGen;
    // Wait for track analysis, exactly as runExport now does (E3b). Without
    // this the hook reads `s.beatGrid` mid-analysis and exports with NO grid —
    // and because every device harness that exports goes through here, a gate
    // could silently measure a gridless render and call it a baseline. Awaited
    // BEFORE the store snapshot below, or the snapshot captures the nulls.
    await store().awaitAnalysis();
    // Re-read the counter the instant that wait resolves, where runExport reads
    // it (exportActions.ts:332). The barrier is not released only by analysis
    // FINISHING: a superseding load frees the previous barrier's waiters on
    // purpose (store.ts:1097-1101), so this wait can resolve straight onto the
    // nulls that load just wrote — E3b's gridless export, arriving through
    // E3c's door.
    //
    // The identity check further down subsumes this one for a track that has
    // already LANDED, but not for one still in flight: `loadFile` bumps the
    // counter on its first line while the engine commits the new buffer only
    // after the decode resolves (engine.ts:265), so in that window `buf` is
    // unchanged and identity sees nothing at all. For a harness that window is
    // the whole point — the export would be perfectly coherent and about the
    // track the harness just REPLACED, i.e. a baseline measuring the wrong
    // song. Refused here, which is also before the overlay raster and before
    // any ffmpeg session exists to have to abort.
    if (genAtStart !== shared.trackLoadGen) {
      throw new Error("The track changed while it was being analyzed — export cancelled");
    }
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
    // AV1 10-bit / ProRes 4444-deep probe lane: real sidecar handshake, real
    // deep-color tap — the same chain-serialized backpressure as
    // exportActions' av1Mode/proresMode legs. rawPath is whichever of the two
    // mutually-exclusive options was set (av1Path wins if somehow both are).
    let rawFrames = 0;
    let rawDistinct = 0;
    let proresChain = Promise.resolve();
    const proresFail: { err: unknown } = { err: null };
    const rawPath = opts.av1Path ?? opts.proresPath;
    if (rawPath) {
      // Headless stand-in for the save dialog's allow_file — debug builds only
      // (the command is a hard error in release).
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("debug_allow_path", { path: rawPath });
      await proresSetAudio(wavFromPcm(pcmFromAudioBuffer(buf)));
      if (opts.av1Path) {
        await av1Begin(opts.fps ?? 30, w, h, opts.av1Path);
      } else {
        await proresBegin(opts.fps ?? 30, w, h, opts.proresPath!);
      }
    }
    // E3d, and the LAST word before the snapshot and the live engine are read
    // into the job below. The counter above cannot be that word on two counts.
    // Distance: it is several awaits back by now (the overlay raster, the av1
    // sidecar handshake), and a track landing in that gap was invisible.
    // And principle: `loadFile` bumps the counter on its first line while the
    // engine commits the new buffer only after the decode resolves, so a run
    // that STARTED inside that window captured OLD audio under a NEW
    // generation and every later comparison is two equal numbers forever — it
    // would encode track A's audio under track B's grid and report success.
    //
    // So re-assert IDENTITY: the audio we are about to describe must still be
    // the audio we captured. Nothing awaits between here and those reads —
    // `buildExportOptions`' arguments (the `s.*` reads, `getEngine().state`)
    // are evaluated synchronously, and the only await is on the promise
    // `exportVideo` returns.
    //
    // This THROWS, and a harness must never be able to read a refusal as a
    // result: every caller surfaces the rejection (av1-e2e and heap-soak stash
    // it via `.catch` and rethrow, shadertoy-smoke's page-side IIFE rejects
    // into exceptionDetails, segment-parity-probe leaves `failed` undefined and
    // exits non-zero).
    if (getEngine().audioBuffer !== buf) {
      // The av1/ProRes lane already has a live ffmpeg session; a refusal that
      // walked away from its stdin would hang the sidecar and the next run
      // with it.
      if (rawPath) await proresAbort().catch(() => undefined);
      throw new Error("The track changed while the export was starting — export cancelled");
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
          // E3h: the two fields this probe used to OMIT while runExport passed
          // them (exportActions.ts:429/436) — every device baseline rendered
          // with sectionIndex/sectionPulse dead and no vocal-presence spans, a
          // frame the shipped app never produces.
          sections: s.sections,
          stems: s.stems,
          lyrics:
            s.lyrics && s.lyricStyle.enabled ? { lines: s.lyrics, style: s.lyricStyle } : undefined,
          // Ungated on lyricStyle by design, mirroring runExport's own
          // "Ungated on purpose — see TrackInput.vocalLines".
          vocalLines: s.lyrics ?? undefined,
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
                  win.__lastPngFrame = new Blob([data.slice()], { type: "image/png" });
                }
                // ...and the FINAL frame, which is the only useful one for
                // anything that accumulates. Frame 0 of the particle sim is
                // the initial seeded disc (uniform noise) and frame 0 of a
                // feedback preset has no trail at all, so a frame-0-only probe
                // makes those two look broken when they are working perfectly.
                win.__lastPngFrameEnd = new Blob([data.slice()], { type: "image/png" });
              }
            : undefined,
          deepColor: rawPath ? true : undefined,
          // Straight-alpha un-premultiply only for the ProRes lane — mirrors
          // exportActions' `deepStraightAlpha: proresMode ? true : undefined`
          // exactly. av1Path's yuv420p10le carries no alpha at all, so its raw
          // premultiplied bytes must stay untouched (deepFrameToRgba64, not
          // deepFrameToStraightRgba64) — same distinction videoExporter.ts
          // documents at ExportJob.deepStraightAlpha.
          deepStraightAlpha: opts.proresPath ? true : undefined,
          onRawFrame: rawPath
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
      if (rawPath) await proresAbort().catch(() => undefined);
      throw proresFail.err ?? e;
    });
    if (rawPath) {
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
      ...(rawPath ? { rawFrames, rawDistinct } : {}),
    };
    // Published only now, on the ONE path that produced a real export.
    win.__lastExport = info;
    win.__lastExportBlob = result.blob;
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
