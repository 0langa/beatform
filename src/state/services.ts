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
}

let engine: AudioEngine | null = null;
let analyzer: RealtimeAnalyzer | null = null;
let renderer: Renderer | null = null;
let disposeLoop: (() => void) | null = null;
let measure: (() => void) | null = null;

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
        void installRenderer();
      };
      next = gpuRetries < 2 ? gpu : new Canvas2DRenderer(canvas);
    } catch {
      next = new Canvas2DRenderer(canvas);
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
      const features = ana.update(t);
      // Track time drives everything rendered — u.time, timeline, automation —
      // so preview matches the deterministic export frame-for-frame and idle
      // motion freezes when paused (u.time = eng.currentTime, not wall clock).
      const trackTime = eng.currentTime;
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
        applyMods(presetById(rf.presetId), rf.params, rf.mods, features),
        transition,
      );
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
    analyzer = null;
    eng.dispose();
    if (engine === eng) engine = null;
  };
}
