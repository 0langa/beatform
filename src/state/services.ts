import { AudioEngine } from "../audio/engine";
import { RealtimeAnalyzer } from "../audio/realtimeSource";
import { Canvas2DRenderer } from "../render/canvas2dRenderer";
import { WebGPURenderer } from "../render/webgpuRenderer";
import type { BgSettings, ParamValues, PostSettings, PresetDef, Renderer } from "../render/types";
import { applyMods, applyPostMods, createModEvalState } from "./modMatrix";
import { resolveActiveFrame, type FrameResolveInput } from "./frameResolve";
import { presetById } from "../render/presets";
import { BUILDER2_ID, currentBuilderStack, packBuilderFrame, sameF32 } from "../render/builder2";
import { getPrefs, subscribePrefs } from "./prefs";
import type { PlaybackState, SyncSettings } from "../audio/types";

/**
 * Imperative singletons (AudioContext graph, GPU renderer, frame loop) live
 * here, outside React and outside the store. The store orchestrates them via
 * these functions; this module knows nothing about the store — everything it
 * needs per frame is injected as ServiceHooks getters, so the dependency is
 * one-directional (store -> services).
 */
export interface ServiceHooks {
  /** Base preset — the renderer's initial target before the loop runs. */
  getPreset(): PresetDef;
  /** Everything resolveActiveFrame needs, rebuilt from the store per frame. */
  getFrameInput(): FrameResolveInput;
  getBackground(): BgSettings;
  /** The document's post settings, so the loop can apply post-targeted
   * modulation routes per frame (they animate bloom/chromatic/etc.). */
  getPost(): PostSettings;
  getSync(): SyncSettings;
  /** True while the user drags the seek bar — playback pushes pause then. */
  isSeeking(): boolean;
  onPlayback(s: PlaybackState): void;
  /** Actual AudioContext rate for spectrum-resolution diagnostics in UI. */
  onAnalysisSampleRate?(sampleRate: number): void;
  onRendererChanged(kind: Renderer["kind"], warning: string | null): void;
  /** Canvas pixel size changed — overlays re-rasterize at the new size. */
  onResize?(width: number, height: number): void;
  /** Throttled loudness/width readout for meters (~4 Hz while playing). */
  onMeter?(lufs: number, width: number): void;
  /** Stem envelope values at track time t (mod-matrix stem sources). */
  getStemValues?(t: number): Record<string, number> | undefined;
  /** Called once per rendered frame with track time — the store uses it to
   * recompose the lyric/audiogram overlay and upload the video-background
   * frame, both pure functions of t. */
  onFrameTick?(t: number): void;
}

let engine: AudioEngine | null = null;
let analyzer: RealtimeAnalyzer | null = null;
let renderer: Renderer | null = null;
let measure: (() => void) | null = null;
let liveRenderPaused = false;
/** Monotonic count of frames actually PRESENTED to the live canvas. The
 * perf overlay derives FPS/frame-time from this instead of its own rAF
 * ticks: rAF fires at display refresh no matter what, so tick-counting
 * showed 120 on a 120 Hz panel even with the frame cap at 30 — the cap
 * skips presents inside ticks, it doesn't slow the ticks. */
let presentedFrames = 0;

export function getPresentedFrames(): number {
  return presentedFrames;
}
/**
 * Identity guard for the three module-level singletons above (engine already
 * had its own ad hoc version of this — `if (engine === eng) engine = null`).
 * Each initServices() call claims this on entry; its teardown only writes to
 * analyzer/renderer/measure if it still holds the claim.
 *
 * Without this, an overlapping lifecycle (StrictMode double-invoke racing an
 * async device-loss rebuild, or a fast re-init before the previous instance's
 * teardown has actually run) lets instance A's stale teardown null out
 * instance B's still-live renderer and analyzer, and — since the SAME bug
 * used to route the rAF-loop stop through a shared variable too — kill B's
 * frame loop along with it. After that every getAnalyzer() throws for a
 * session the UI still thinks is running.
 */
let activeInstance = 0;
let instanceSeq = 0;

/**
 * How long a rebuilt renderer must survive before its device loss is written
 * off as a one-off and the retry budget is handed back.
 */
const GPU_HEALTHY_MS = 60_000;

/**
 * Stop the live preview from drawing without tearing down the loop.
 *
 * A batch render wants the whole GPU: the preview would otherwise keep
 * submitting work for a canvas nobody is watching, competing with the export
 * for the device. The rAF loop keeps running (transport and metering still
 * update) — only the draw is skipped.
 */
export function setLiveRenderPaused(paused: boolean): void {
  liveRenderPaused = paused;
}

/** Force a size re-measure now (aspect changes shouldn't wait for the
 * ResizeObserver, which doesn't fire in hidden tabs). */
export function remeasure(): void {
  measure?.();
}

export function getEngine(): AudioEngine {
  if (!engine) throw new Error("services not initialized");
  return engine;
}

export function getAnalyzer(): RealtimeAnalyzer {
  if (!analyzer) throw new Error("services not initialized");
  return analyzer;
}

/** The analyzer if services are up, else null. For feeds that ride a store
 * subscription rather than a user action: a subscription can fire in a test
 * (or before initServices in the browser build) where the throwing accessor
 * would take the caller down with it. */
export function peekAnalyzer(): RealtimeAnalyzer | null {
  return analyzer;
}

export function getRenderer(): Renderer | null {
  return renderer;
}

/**
 * Create the audio engine, analyzer and renderer, and start the frame loop.
 * Returns a dispose function (React StrictMode double-invokes effects, so
 * init/dispose must be safely repeatable).
 */
export function initServices(canvas: HTMLCanvasElement, hooks: ServiceHooks): () => void {
  const myInstance = ++instanceSeq;
  activeInstance = myInstance;

  const eng = new AudioEngine();
  engine = eng;
  hooks.onAnalysisSampleRate?.(eng.ctx.sampleRate);
  eng.onStateChange = (s) => {
    if (!hooks.isSeeking()) hooks.onPlayback(s);
  };
  const ana = new RealtimeAnalyzer(eng);
  ana.setSync(hooks.getSync());
  analyzer = ana;

  let disposed = false;
  let raf = 0;
  let ro: ResizeObserver | null = null;
  let unsubPrefs: (() => void) | null = null;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let gpuRetries = 0;
  /** Previous frame's track position, for detecting loop wraps (see below). */
  let lastTrackTime: number | null = null;
  /** Exact wrap signal from AudioEngine. Needed for A-B loops shorter than the
   * old 250 ms backwards-jump heuristic. */
  let lastLoopEpoch = eng.loopEpoch;
  /** Sibling canvas the 2D fallback draws on when the original is unusable. */
  let fallbackCanvas: HTMLCanvasElement | null = null;

  /**
   * Build the Canvas2D fallback. A canvas that has ever been configured for
   * WebGPU can never hand out a 2D context again (context mode is permanent),
   * so after a device loss the fallback must draw on a FRESH canvas layered
   * exactly over the original — constructing it on the WebGPU-claimed canvas
   * throws, and used to leave a permanent black screen with no warning.
   */
  const make2dRenderer = (): Renderer => {
    try {
      return new Canvas2DRenderer(canvas);
    } catch {
      if (!fallbackCanvas) {
        const fresh = document.createElement("canvas");
        fresh.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
        const parent = canvas.parentElement;
        if (parent && getComputedStyle(parent).position === "static") {
          parent.style.position = "relative";
        }
        canvas.insertAdjacentElement("afterend", fresh);
        // The dead WebGPU canvas would otherwise sit on top showing its last
        // frame (or garbage) — hide it; the fallback path is terminal.
        canvas.style.visibility = "hidden";
        fallbackCanvas = fresh;
      }
      return new Canvas2DRenderer(fallbackCanvas);
    }
  };
  /** When the current renderer was installed — drives the retry-budget reset. */
  let installedAt = 0;
  // The frame loop caches which preset/transition it last pushed to the
  // renderer. When the renderer is REPLACED (device-loss rebuild), those
  // caches are stale — the loop wires this up to clear them so the next
  // frame re-issues setPreset/setTransitionPreset onto the fresh renderer.
  let resyncRenderer: () => void = () => {};
  // THIS instance's own current renderer, kept in lockstep with every write
  // to the shared `renderer` below (including the null on device loss). The
  // module-level `renderer` can end up pointing at a NEWER instance's
  // renderer by the time this one is torn down — myRenderer is what lets
  // teardown still dispose OUR OWN GPU resources without touching (or
  // needing to know anything about) whoever the shared slot currently holds.
  let myRenderer: Renderer | null = null;

  const installRenderer = async () => {
    let next: Renderer;
    try {
      const gpu = await WebGPURenderer.create(canvas);
      gpu.onDeviceLost = () => {
        // Driver reset / TDR: rebuild the renderer once, fall back after 2
        if (disposed) return;
        renderer = null;
        myRenderer = null;
        gpu.dispose();
        gpuRetries++;
        void installRenderer().catch(() => {
          // Even the fallback failed — surface it instead of dying silently
          // in a floating promise with the canvas frozen black.
          hooks.onRendererChanged(
            "canvas2d",
            "Rendering failed after a GPU reset — restart the app to recover.",
          );
        });
      };
      if (gpuRetries < 2) {
        next = gpu;
      } else {
        // Out of retries: hand back the device we just created rather than
        // leaking it for the life of the process.
        gpu.onDeviceLost = null;
        gpu.dispose();
        next = make2dRenderer();
      }
      // The budget is meant to catch a device that keeps dying, not to count
      // losses forever: unreset, two unrelated TDRs hours apart would strand
      // the user on Canvas2D for the rest of the session. Once a rebuilt
      // renderer has held up for a while, the trouble is over — forget it.
      installedAt = performance.now();
    } catch {
      next = make2dRenderer();
    }
    if (disposed) {
      next.dispose();
      return;
    }
    next.setPreset(hooks.getPreset());
    next.setBackground(hooks.getBackground());
    const r = canvas.getBoundingClientRect();
    next.resize(r.width, r.height, window.devicePixelRatio * getPrefs().previewScale);
    renderer = next;
    myRenderer = next;
    resyncRenderer(); // a rebuilt renderer must re-receive preset/transition
    hooks.onRendererChanged(
      next.kind,
      next.kind === "canvas2d"
        ? "WebGPU unavailable — using simplified rendering (spectrum bars only). Update your graphics driver or WebView2 runtime for full visuals."
        : null,
    );
  };

  void (async () => {
    await installRenderer();
    if (disposed) return;

    measure = () => {
      const r = canvas.getBoundingClientRect();
      // previewScale multiplies the LIVE backing store only — exports size
      // their own offscreen canvas and never pass through this path.
      renderer?.resize(r.width, r.height, window.devicePixelRatio * getPrefs().previewScale);
      hooks.onResize?.(canvas.width, canvas.height);
    };
    ro = new ResizeObserver(measure);
    ro.observe(canvas);
    // Re-measure when prefs change so a new Preview resolution applies
    // immediately (cheap no-op resize otherwise — resize() early-outs on
    // unchanged dimensions).
    unsubPrefs = subscribePrefs(() => measure?.());

    let lastUiUpdate = 0;
    /** Smoothed output latency (s); <0 = not sampled yet. */
    let latency = -1;
    // Cache the RESOLVED DEF, not its id (L8): saving an edited custom preset
    // in the Shader Editor re-registers a NEW object under the SAME id
    // (render/presets/custom.ts's registry replaces the map entry), so an
    // id-keyed cache never notices the def changed whenever that id happens
    // to already be what's cached — e.g. a scene elsewhere in the timeline
    // that reuses the same custom preset while a different one is currently
    // showing. presetById() is a cheap Map/array lookup and setPreset() has
    // its own object-identity pipeline cache (webgpuRenderer.ts's
    // pipelineCache, keyed by the def object), so comparing and (redundantly)
    // pushing by reference every frame is both correct and free when nothing
    // changed.
    let lastCapDraw = -1e9;
    let currentPreset: PresetDef | null = null;
    let fadeFromPreset: PresetDef | null = null;
    /** True while the renderer holds MODULATED post settings, so the loop
     * knows it still owes the renderer a reset once modulation stops. */
    let postModulated = false;
    /** THIS loop's lag memory for mod routes with attack/release (P-16).
     * Owned here, never shared with exports (which create a fresh one per
     * run). The dt rules inside applyMods snap across seeks on their own;
     * clearing alongside the analyzer's discontinuity reset below also drops
     * memos of routes that no longer exist. */
    const modEval = createModEvalState();
    /** Last builder frame pack uploaded by THIS loop (RP-20) — the dirty
     * check that keeps the per-frame storage-buffer write edit-rate, not
     * frame-rate, while nothing modulates. Cleared on renderer swap so a
     * fresh device gets its first frame pack unconditionally. */
    let lastBuilderPack: Float32Array | null = null;
    resyncRenderer = () => {
      currentPreset = null;
      fadeFromPreset = null;
      lastBuilderPack = null;
    };
    const loop = (tMs: number) => {
      if (disposed) return;
      clearTimeout(fallback);
      const t = tMs / 1000; // wall-clock, ONLY for the analyzer's dt/metering
      // Present what the ears hear: the engine clock and the analyser tap
      // both run ahead of the speakers by the output latency. Smoothed (the
      // browser re-estimates it live and small jumps would judder u.time)
      // and applied only while playing — paused frames must sit exactly on
      // the seek position.
      if (eng.playing) {
        const lat = eng.outputLatency;
        latency = latency < 0 ? lat : latency + (lat - latency) * 0.05;
      }
      const compensated =
        eng.playing && latency > 0 ? Math.max(0, eng.currentTime - latency) : eng.currentTime;
      // Loop wrap. The engine reports position as `raw % duration`, so a
      // looping track silently teleports from the end back to the start with
      // no event to subscribe to — and the analyser would diff the opening
      // bars against the closing ones and fire a phantom onset on every lap.
      // Any sizeable BACKWARD jump means a discontinuity; forward jumps are
      // just frames, and a small backward wobble is latency-estimate jitter.
      const loopEpoch = eng.loopEpoch;
      if (
        loopEpoch !== lastLoopEpoch ||
        (lastTrackTime !== null && lastTrackTime - compensated > 0.25)
      ) {
        ana.reset("seek");
        modEval.routes.clear();
      }
      lastLoopEpoch = loopEpoch;
      lastTrackTime = compensated;
      const features = ana.update(t, compensated);
      // A WebGPU renderer that has survived this long is healthy; give the
      // retry budget back so a later, unrelated device loss still gets its
      // rebuild. Only counts while actually on WebGPU — once we're on the
      // Canvas2D fallback there is no device left to lose, so a reset there
      // would mean nothing.
      if (
        gpuRetries > 0 &&
        installedAt > 0 &&
        tMs - installedAt > GPU_HEALTHY_MS &&
        renderer?.kind === "webgpu"
      ) {
        gpuRetries = 0;
      }
      // Track time drives u.time, timeline and automation on both paths; idle
      // motion freezes when paused. Input sampling still follows the live
      // device, as documented in PREVIEW-EXPORT-CONTRACT.md.
      const trackTime = compensated;
      // Live FPS cap (Settings ▸ Performance): draw-skip, transport-keep.
      // Preview-only by design — exports walk every frame deterministically
      // and never consult this.
      const fpsCap = getPrefs().fpsCap;
      const capSkipped = fpsCap > 0 && tMs - lastCapDraw < 1000 / fpsCap - 1;
      // A capped presentation must not cap texture-feedback STATE. The
      // analyser still runs on every rAF and tells us which calls are its
      // canonical 60 Hz ticks; those ticks render history offscreen below.
      if (capSkipped && !ana.feedbackTicked) {
        raf = requestAnimationFrame(loop);
        fallback = setTimeout(() => {
          cancelAnimationFrame(raf);
          loop(performance.now());
        }, 300);
        if (eng.playing && t - lastUiUpdate > 0.25 && !hooks.isSeeking()) {
          lastUiUpdate = t;
          hooks.onPlayback(eng.state);
        }
        return;
      }
      if (!capSkipped) lastCapDraw = tMs;
      if (liveRenderPaused) {
        // Skip the draw, keep the loop: a paused preview must still refresh
        // the transport below, and the caches stay valid for when it resumes.
        raf = requestAnimationFrame(loop);
        // Re-arm the starvation fallback too. The loop clears it on entry, and
        // rAF does not fire in a hidden window — so without this, pausing for a
        // batch in a backgrounded window kills the loop for good, and the
        // preview never comes back even after the batch finishes.
        fallback = setTimeout(() => {
          cancelAnimationFrame(raf);
          loop(performance.now());
        }, 300);
        if (eng.playing && t - lastUiUpdate > 0.25 && !hooks.isSeeking()) {
          lastUiUpdate = t;
          hooks.onPlayback(eng.state);
        }
        return;
      }
      const rf = resolveActiveFrame(hooks.getFrameInput(), trackTime);
      const activePreset = presetById(rf.presetId);
      if (activePreset !== currentPreset) {
        renderer?.setPreset(activePreset);
        currentPreset = activePreset;
      }
      renderer?.setBackground(rf.bg);
      // Crossfade: keep the outgoing preset compiled while inside the window
      let transition: { params: ParamValues; mix: number; kind: number } | undefined;
      if (rf.prev) {
        const prevPreset = presetById(rf.prev.presetId);
        if (prevPreset !== fadeFromPreset) {
          renderer?.setTransitionPreset(prevPreset);
          fadeFromPreset = prevPreset;
        }
        transition = { params: rf.prev.params, mix: rf.mix, kind: rf.transitionKind };
      } else if (fadeFromPreset !== null) {
        renderer?.setTransitionPreset(null);
        fadeFromPreset = null;
      }
      const stemValues = hooks.getStemValues?.(trackTime);
      // Post-targeted routes animate the post chain. applyPostMods returns the
      // base object itself when nothing targets post, so an unmodulated
      // project does no extra work — but once modulation stops we must push
      // the un-modulated settings back exactly once, or the last animated
      // frame's bloom/chromatic would stick.
      const basePost = hooks.getPost();
      const livePost = applyPostMods(basePost, rf.mods, features, stemValues, modEval);
      if (livePost !== basePost) {
        renderer?.setPost(livePost);
        postModulated = true;
      } else if (postModulated) {
        renderer?.setPost(basePost);
        postModulated = false;
      }
      const frameParams = applyMods(
        activePreset,
        rf.params,
        rf.mods,
        features,
        stemValues,
        modEval,
      );
      // Builder bridge chokepoint (RP-20, determinism law): modulation and
      // automation compose into the params RECORD above, but builder layer
      // values reach the GPU via the builderLayers storage buffer — overlay
      // the resolved virtual values onto the stack pack and upload only when
      // the bytes changed. The export loop calls the SAME packBuilderFrame,
      // which is what keeps preview === file. Crossfades: builderBuf is one
      // shared buffer for the main + transition bind groups, so a
      // builder2↔builder2 fade with two different stacks is unrepresentable —
      // the ACTIVE frame's pack wins (accepted limitation).
      if (rf.presetId === BUILDER2_ID) {
        const packed = packBuilderFrame(currentBuilderStack(), frameParams);
        if (!lastBuilderPack || !sameF32(packed, lastBuilderPack)) {
          renderer?.setBuilderParams(packed);
          lastBuilderPack = packed;
        }
      }
      renderer?.render(features, trackTime, frameParams, transition, {
        feedback: capSkipped
          ? "advance-only"
          : ana.feedbackTicked
            ? "advance-and-present"
            : "present-only",
      });
      if (renderer && !capSkipped) presentedFrames++;
      if (capSkipped) {
        // State advanced offscreen; keep presentation cadence and UI cadence
        // exactly as before.
        raf = requestAnimationFrame(loop);
        fallback = setTimeout(() => {
          cancelAnimationFrame(raf);
          loop(performance.now());
        }, 300);
        if (eng.playing && t - lastUiUpdate > 0.25 && !hooks.isSeeking()) {
          lastUiUpdate = t;
          hooks.onPlayback(eng.state);
        }
        return;
      }
      hooks.onFrameTick?.(trackTime);
      // E2E probe: lets tooling confirm the render loop is alive
      (window as unknown as { __vizFrames: number }).__vizFrames =
        ((window as unknown as { __vizFrames: number }).__vizFrames ?? 0) + 1;
      // Throttled transport refresh while playing
      if (eng.playing && t - lastUiUpdate > 0.25 && !hooks.isSeeking()) {
        lastUiUpdate = t;
        hooks.onPlayback(eng.state);
        hooks.onMeter?.(features.lufs, features.width);
      }
      raf = requestAnimationFrame(loop);
      // rAF starves in hidden/occluded tabs; keep rendering (throttled by
      // the browser to ~1fps) so background use and captures stay live
      fallback = setTimeout(() => {
        cancelAnimationFrame(raf);
        loop(performance.now());
      }, 300);
    };
    raf = requestAnimationFrame(loop);
    // Arm the starvation fallback for the FIRST tick too: in a tab that is
    // hidden from launch (background window, capture setups), rAF never fires
    // at all — without this the loop would never start.
    fallback = setTimeout(() => {
      cancelAnimationFrame(raf);
      loop(performance.now());
    }, 300);
  })();

  // Stops THIS instance's own rAF loop / resize observer. A plain local
  // closure, deliberately NOT stashed in a module-level variable: an earlier
  // version routed this through one (so it could be invoked from outside),
  // and a stale instance's teardown reading that shared slot could end up
  // invoking a NEWER instance's stop function instead of its own, which is
  // precisely how instance A's cleanup used to kill instance B's rAF loop.
  // raf/ro/fallback are private to this call (never shared), so calling this
  // directly is always correct regardless of whether we're still the
  // "active" instance below.
  const stopOwnLoop = () => {
    disposed = true;
    clearTimeout(fallback);
    cancelAnimationFrame(raf);
    ro?.disconnect();
    unsubPrefs?.();
    unsubPrefs = null;
  };

  return () => {
    stopOwnLoop();
    fallbackCanvas?.remove();
    fallbackCanvas = null;
    canvas.style.visibility = "";
    eng.dispose();
    if (engine === eng) engine = null;
    // Always dispose OUR OWN renderer — tracked locally (myRenderer) so this
    // runs whether or not the shared `renderer` slot still points to it.
    myRenderer?.dispose();
    myRenderer = null;
    // Everything below is a module-level singleton shared with whichever
    // initServices call is CURRENTLY active — only touch it if that's still
    // us (see activeInstance's docblock above). In particular, do NOT call
    // renderer?.dispose() here: unlike myRenderer, by this point `renderer`
    // may belong to a newer instance entirely.
    if (activeInstance === myInstance) {
      renderer = null;
      analyzer = null;
      measure = null;
    }
  };
}
