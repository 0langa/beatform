import { AudioEngine } from "../audio/engine";
import { RealtimeAnalyzer } from "../audio/realtimeSource";
import { Canvas2DRenderer } from "../render/canvas2dRenderer";
import { WebGPURenderer } from "../render/webgpuRenderer";
import type { BgSettings, ParamValues, PresetDef, Renderer } from "../render/types";
import { applyMods } from "./modMatrix";
import { resolveActiveFrame, type FrameResolveInput } from "./frameResolve";
import { presetById } from "../render/presets";
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
  getSync(): SyncSettings;
  /** True while the user drags the seek bar — playback pushes pause then. */
  isSeeking(): boolean;
  onPlayback(s: PlaybackState): void;
  onRendererChanged(kind: Renderer["kind"], warning: string | null): void;
  /** Canvas pixel size changed — overlays re-rasterize at the new size. */
  onResize?(width: number, height: number): void;
  /** Throttled loudness/width readout for meters (~4 Hz while playing). */
  onMeter?(lufs: number, width: number): void;
  /** Stem envelope values at track time t (mod-matrix stem sources). */
  getStemValues?(t: number): Record<string, number> | undefined;
  /** Called once per rendered frame with track time — the store recomposes
   * the lyric overlay when (and only when) the active line/fade step moves. */
  onLyricTick?(t: number): void;
}

let engine: AudioEngine | null = null;
let analyzer: RealtimeAnalyzer | null = null;
let renderer: Renderer | null = null;
let disposeLoop: (() => void) | null = null;
let measure: (() => void) | null = null;
let liveRenderPaused = false;

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

export function getRenderer(): Renderer | null {
  return renderer;
}

/**
 * Create the audio engine, analyzer and renderer, and start the frame loop.
 * Returns a dispose function (React StrictMode double-invokes effects, so
 * init/dispose must be safely repeatable).
 */
export function initServices(canvas: HTMLCanvasElement, hooks: ServiceHooks): () => void {
  const eng = new AudioEngine();
  engine = eng;
  eng.onStateChange = (s) => {
    if (!hooks.isSeeking()) hooks.onPlayback(s);
  };
  const ana = new RealtimeAnalyzer(eng);
  ana.setSync(hooks.getSync());
  analyzer = ana;

  let disposed = false;
  let raf = 0;
  let ro: ResizeObserver | null = null;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let gpuRetries = 0;
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

  const installRenderer = async () => {
    let next: Renderer;
    try {
      const gpu = await WebGPURenderer.create(canvas);
      gpu.onDeviceLost = () => {
        // Driver reset / TDR: rebuild the renderer once, fall back after 2
        if (disposed) return;
        renderer = null;
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
    next.resize(r.width, r.height, window.devicePixelRatio);
    renderer = next;
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
      renderer?.resize(r.width, r.height, window.devicePixelRatio);
      hooks.onResize?.(canvas.width, canvas.height);
    };
    ro = new ResizeObserver(measure);
    ro.observe(canvas);

    let lastUiUpdate = 0;
    /** Smoothed output latency (s); <0 = not sampled yet. */
    let latency = -1;
    let currentPresetId: string | null = null;
    let fadeFromId: string | null = null;
    resyncRenderer = () => {
      currentPresetId = null;
      fadeFromId = null;
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
      // Track time drives everything rendered — u.time, timeline, automation —
      // so preview matches the deterministic export frame-for-frame and idle
      // motion freezes when paused (track time, not wall clock).
      const trackTime = compensated;
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
      if (rf.presetId !== currentPresetId) {
        renderer?.setPreset(presetById(rf.presetId));
        currentPresetId = rf.presetId;
      }
      renderer?.setBackground(rf.bg);
      // Crossfade: keep the outgoing preset compiled while inside the window
      let transition: { params: ParamValues; mix: number } | undefined;
      if (rf.prev) {
        if (fadeFromId !== rf.prev.presetId) {
          renderer?.setTransitionPreset(presetById(rf.prev.presetId));
          fadeFromId = rf.prev.presetId;
        }
        transition = { params: rf.prev.params, mix: rf.mix };
      } else if (fadeFromId !== null) {
        renderer?.setTransitionPreset(null);
        fadeFromId = null;
      }
      renderer?.render(
        features,
        trackTime,
        applyMods(
          presetById(rf.presetId),
          rf.params,
          rf.mods,
          features,
          hooks.getStemValues?.(trackTime),
        ),
        transition,
      );
      hooks.onLyricTick?.(trackTime);
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

  disposeLoop = () => {
    disposed = true;
    clearTimeout(fallback);
    cancelAnimationFrame(raf);
    ro?.disconnect();
    measure = null;
  };

  return () => {
    disposeLoop?.();
    disposeLoop = null;
    renderer?.dispose();
    renderer = null;
    fallbackCanvas?.remove();
    fallbackCanvas = null;
    canvas.style.visibility = "";
    analyzer = null;
    eng.dispose();
    if (engine === eng) engine = null;
  };
}
