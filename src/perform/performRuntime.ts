import { Canvas2DRenderer } from "../render/canvas2dRenderer";
import { WebGPURenderer } from "../render/webgpuRenderer";
import { presetById } from "../render/presets";
import { registerCustomPreset } from "../render/presets/custom";
import { packBuilderParams, rebuildBuilder2, sameF32 } from "../render/builder2";
import { bakeBackgroundBitmap } from "../render/bgImage";
import {
  decodeVideoBgFrames,
  disposeVideoBgFrames,
  videoBgFrameIndex,
  type VideoBgFrames,
} from "../render/videoBg";
import { rasterizeOverlay } from "../render/overlay";
import {
  composeOverlayFrame,
  hasDynamics,
  overlayFrameKeyAt,
  sameOverlayFrame,
  type OverlayDynamics,
  type OverlayFrameKey,
} from "../render/dynamicOverlay";
import {
  composeLyricPlate,
  lyricPlateKeyAt,
  NULL_PLATE_KEY,
  samePlateKey,
  type LyricPlateKey,
} from "../render/lyricPlate";
import { audiogramActive } from "../state/audiogram";
import { BG_VIDEO, type FeedbackRenderMode, type PresetDef, type Renderer } from "../render/types";
import {
  defaultChannelFactory,
  PERFORM_CHANNEL_NAME,
  type PerformAssetsMsg,
  type PerformChannel,
  type PerformFrameMsg,
  type PerformLiveMsg,
  type PerformMsg,
  type PerformSceneMsg,
} from "../state/performBridge";
import type { Aspect } from "../state/project";

/**
 * FEAT-009 — the performance-window runtime: the RECEIVING half of the
 * mirror bridge. Owns a Renderer on the output canvas and applies the four
 * message tiers from the primary window:
 *
 *  - frame messages become exactly the renderer calls the primary made for
 *    the same tick (setPreset/setTransitionPreset/setBackground/setPost/
 *    setBuilderParams/render, feedback directive included);
 *  - live/scene/assets messages carry the out-of-loop state, which this
 *    side rasterizes AT ITS OWN canvas size and native DPR (overlay, lyric
 *    plate, background image) or decodes deterministically (video bg), so
 *    the output is composed for the output display, not upscaled from the
 *    operator preview.
 *
 * No store, no audio, no analysis, no export imports — the mirror cannot
 * duplicate control state because it never receives any, and it cannot
 * drift analytically because every feature frame is the analyzer's own.
 */

export interface PerformSceneView {
  blackout: boolean;
  hud: boolean;
  aspect: Aspect;
}

export interface PerformStatus {
  phase: "waiting" | "live";
  renderer: "webgpu" | "canvas2d" | null;
  warning: string | null;
}

export interface PerformRuntimeCallbacks {
  onStatus(s: PerformStatus): void;
  onScene(v: PerformSceneView): void;
  /** Fired when the active mode changes — the HUD flash's data feed. */
  onPresetName(name: string): void;
}

export interface PerformRuntimeStats {
  framesReceived: number;
  framesRendered: number;
  statesApplied: number;
  /** EMA of send→receive delivery lag, ms (Date.now epoch, same machine). */
  lagMs: number;
  /** EMA of the receiver's apply+render cost per frame, ms. */
  renderMs: number;
  degraded: boolean;
}

export interface PerformRuntimeOptions {
  channelFactory?: (name: string) => PerformChannel | null;
  /** Test seam — swap the real GPU renderer for a fake. */
  createRenderer?: (canvas: HTMLCanvasElement) => Promise<Renderer>;
  now?: () => number;
}

export interface PerformRuntimeHandle {
  dispose(): void;
  getStats(): PerformRuntimeStats;
}

/** Backpressure hysteresis: a sustained delivery lag above DEGRADE_LAG_MS
 * means the output GPU cannot keep the primary's cadence — presentation
 * thins (every 3rd frame) while feedback STATE keeps advancing, and full
 * rate resumes below RECOVER_LAG_MS. Pure so the policy is unit-testable. */
export const DEGRADE_LAG_MS = 120;
export const RECOVER_LAG_MS = 50;

export function nextPresentPolicy(degraded: boolean, lagMs: number): boolean {
  return degraded ? lagMs > RECOVER_LAG_MS : lagMs > DEGRADE_LAG_MS;
}

/**
 * What a degraded (non-presenting) tick still owes the renderer: feedback
 * STATE must advance on every advance tick or the texture-feedback modes
 * would fall out of lockstep with the primary — only the present is
 * skippable. A present-only tick owes nothing and returns null (skip the
 * render call entirely).
 */
export function degradeFeedback(
  mode: FeedbackRenderMode,
  present: boolean,
): FeedbackRenderMode | null {
  if (present) return mode;
  if (mode === "advance-and-present" || mode === "advance-only") return "advance-only";
  return null;
}

/** How long without a frame before the surface reads as "waiting" again. */
const WAITING_AFTER_MS = 2000;

export function startPerformRuntime(
  canvas: HTMLCanvasElement,
  cb: PerformRuntimeCallbacks,
  opts: PerformRuntimeOptions = {},
): PerformRuntimeHandle {
  const factory = opts.channelFactory ?? defaultChannelFactory;
  const now = opts.now ?? (() => Date.now());

  let disposed = false;
  let renderer: Renderer | null = null;
  let rendererKind: "webgpu" | "canvas2d" | null = null;
  let rendererWarning: string | null = null;
  let gpuRetried = false;
  let fallbackCanvas: HTMLCanvasElement | null = null;

  let live: PerformLiveMsg | null = null;
  let scene: PerformSceneMsg | null = null;
  let assets: PerformAssetsMsg | null = null;
  /** Latest frame while the renderer is still creating — applied on ready so
   * first paint doesn't wait for the next tick. */
  let pendingFrame: PerformFrameMsg | null = null;

  // Renderer-call caches, mirroring the primary loop's own.
  let lastDef: PresetDef | null = null;
  let lastPresetId: string | null = null;
  let lastPrevDef: PresetDef | null = null;
  let lastBuilderPack: Float32Array | null = null;

  // Dedupe keys: state messages are snapshots and arrive structured-CLONED,
  // so object identity is useless — an unchanged def must not re-register
  // (that would mint a new identity and force a pipeline rebuild), and an
  // unchanged overlay must not re-rasterize.
  const registeredDefJson = new Map<string, string>();
  let builderJson = "";
  let lyricsJson = "";
  let coverKey = "__unset__";
  let bgImageKey = "__unset__";
  let bgVideoKey = "__unset__";
  let overlayKey = "__unset__";

  let coverToken = 0;
  let bgImageToken = 0;
  let bgVideoToken = 0;
  let overlayToken = 0;
  let plateToken = 0;
  let overlayComposeToken = 0;

  let overlayBase: ImageBitmap | null = null;
  let videoFrames: VideoBgFrames | null = null;
  let lastOverlayKey: OverlayFrameKey | null = null;
  let lastPlateKey: LyricPlateKey = NULL_PLATE_KEY;

  /** Track duration for the audiogram strip — carried by every feature
   * frame, so the mirror needs no transport channel of its own. */
  let lastDuration = 0;

  let degraded = false;
  let presentCounter = 0;
  let lastFrameAt = 0;
  let phase: "waiting" | "live" = "waiting";

  const stats: PerformRuntimeStats = {
    framesReceived: 0,
    framesRendered: 0,
    statesApplied: 0,
    lagMs: 0,
    renderMs: 0,
    degraded: false,
  };

  const pushStatus = () => {
    cb.onStatus({ phase, renderer: rendererKind, warning: rendererWarning });
  };

  /** A data-URL's value fingerprint — FNV-1a over the FULL string (R2-31i).
   * The old length+head+tail sample collided for same-length payloads
   * differing only in the middle (two crops of one image, two re-encodes of
   * one frame), and the receiver then kept showing the old asset. The
   * length rides along so a hash collision would ALSO need matching length.
   * NOT cheap on its own — the full pass measured ~18 ms at a 6 MB image
   * and ~670 ms at the 192 MB video cap — which is why every callsite goes
   * through a memo (below) and only a genuinely new string pays it. */
  const urlKey = (url: string | null): string => {
    if (url === null) return "";
    let h = 0x811c9dc5;
    for (let i = 0; i < url.length; i++) {
      h ^= url.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `${url.length}|${(h >>> 0).toString(36)}`;
  };

  /** Per-callsite memo over urlKey (review D1): applyBgImage/applyBgVideo
   * re-run on EVERY scene message (edit-rate), not only when assets change,
   * and an unmemoized full-string hash put the cost above on this thread per
   * message. Asset strings keep their identity across scene messages (only
   * an assets message replaces them), so string REFERENCE equality is the
   * memo key — a re-delivered assets tier re-hashes once, legitimately. One
   * memo per callsite: the three lanes hold different strings and must not
   * evict each other. */
  const memoUrlKey = () => {
    let lastUrl: string | null = null;
    let lastKey = "";
    return (url: string | null): string => {
      if (url !== lastUrl) {
        lastUrl = url;
        lastKey = urlKey(url);
      }
      return lastKey;
    };
  };
  const coverUrlKey = memoUrlKey();
  const bgImageUrlKey = memoUrlKey();
  const bgVideoUrlKey = memoUrlKey();

  /** Canvas2D on a canvas WebGPU ever claimed throws (context mode is
   * permanent) — same sibling-canvas fallback services.ts uses. */
  const make2d = (): Renderer => {
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
        canvas.style.visibility = "hidden";
        fallbackCanvas = fresh;
      }
      return new Canvas2DRenderer(fallbackCanvas);
    }
  };

  const defaultCreate = async (c: HTMLCanvasElement): Promise<Renderer> => {
    const gpu = await WebGPURenderer.create(c);
    gpu.onDeviceLost = () => {
      // One rebuild, then the 2D fallback — the output window prefers ANY
      // picture over a stall mid-show; the primary's richer retry budget
      // stays an operator-side concern.
      if (disposed) return;
      renderer = null;
      gpu.dispose();
      void (async () => {
        let next: Renderer;
        if (gpuRetried) {
          next = make2d();
        } else {
          gpuRetried = true;
          try {
            next = await (opts.createRenderer ?? defaultCreate)(canvas);
          } catch {
            next = make2d();
          }
        }
        if (disposed) {
          next.dispose();
          return;
        }
        installRenderer(next);
      })();
    };
    return gpu;
  };

  const installRenderer = (next: Renderer) => {
    renderer = next;
    rendererKind = next.kind;
    rendererWarning =
      next.kind === "canvas2d"
        ? "WebGPU unavailable on this display's renderer — simplified output (spectrum bars only)."
        : null;
    // Fresh renderer: nothing it was ever told survives. Clear every dedupe
    // key so the cached state tiers re-prime it in full.
    lastDef = null;
    lastPrevDef = null;
    lastBuilderPack = null;
    lastOverlayKey = null;
    lastPlateKey = NULL_PLATE_KEY;
    registeredDefJson.clear();
    builderJson = "";
    coverKey = "__unset__";
    bgImageKey = "__unset__";
    bgVideoKey = "__unset__";
    overlayKey = "__unset__";
    measure();
    if (live) applyLiveToRenderer(live);
    if (scene) applySceneToRenderer(scene);
    refreshAssetSurfaces();
    pushStatus();
    if (pendingFrame) {
      const f = pendingFrame;
      pendingFrame = null;
      applyFrame(f);
    }
  };

  // ---- sizing --------------------------------------------------------
  // Native DPR, deliberately WITHOUT the operator's previewScale pref: that
  // knob trades operator-preview sharpness for frame rate; the output
  // display renders at its own monitor's full resolution (mixed-DPI setups
  // resolve per-window in WebView2, so devicePixelRatio here is the OUTPUT
  // monitor's factor).
  let lastW = 0;
  let lastH = 0;
  const measure = () => {
    const r = canvas.getBoundingClientRect();
    renderer?.resize(r.width, r.height, window.devicePixelRatio);
    if (canvas.width !== lastW || canvas.height !== lastH) {
      lastW = canvas.width;
      lastH = canvas.height;
      // Raster surfaces are functions of the output pixel size — redo them.
      overlayKey = "__unset__";
      lastOverlayKey = null;
      lastPlateKey = NULL_PLATE_KEY;
      applyOverlay();
    }
  };
  const ro = new ResizeObserver(measure);
  ro.observe(canvas);

  // ---- state application --------------------------------------------
  const dynamicsOf = (): OverlayDynamics => ({
    lyrics: scene?.lyrics ?? undefined,
    audiogram:
      scene?.audiogram && audiogramActive(scene.audiogram)
        ? { settings: scene.audiogram, duration: lastDuration, waveform: scene.waveformOverview }
        : undefined,
  });

  const applyCover = () => {
    const url = assets?.coverUrl ?? null;
    const key = coverUrlKey(url);
    if (key === coverKey) return;
    coverKey = key;
    const token = ++coverToken;
    if (!url) {
      renderer?.setCoverArt(null);
      return;
    }
    void fetch(url)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        if (token === coverToken && !disposed) renderer?.setCoverArt(bmp);
        else bmp.close();
      })
      .catch(() => {
        if (token === coverToken && !disposed) renderer?.setCoverArt(null);
      });
  };

  const applyBgImage = () => {
    const url = assets?.bgImageUrl ?? null;
    const params = scene?.bgImageParams ?? null;
    const key = url && params ? `${bgImageUrlKey(url)}|${params.blur}|${params.dim}` : "";
    if (key === bgImageKey) return;
    bgImageKey = key;
    const token = ++bgImageToken;
    if (!url || !params) {
      // Leave the texture to the video path when video mode owns it —
      // mirrors the primary's applyBgImage/applyVideoBg split.
      if (!(scene?.bgVideoParams && assets?.bgVideoUrl)) renderer?.setBackgroundImage(null);
      return;
    }
    void bakeBackgroundBitmap(url, params.blur, params.dim)
      .then((bmp) => {
        if (token === bgImageToken && !disposed) renderer?.setBackgroundImage(bmp);
        else bmp.close();
      })
      .catch(() => {
        if (token === bgImageToken && !disposed) renderer?.setBackgroundImage(null);
      });
  };

  const applyBgVideo = () => {
    const url = assets?.bgVideoUrl ?? null;
    const params = scene?.bgVideoParams ?? null;
    const key = url && params ? `${bgVideoUrlKey(url)}|${params.blur}|${params.dim}` : "";
    if (key === bgVideoKey) return;
    bgVideoKey = key;
    const token = ++bgVideoToken;
    if (!url || !params) {
      disposeVideoBgFrames(videoFrames);
      videoFrames = null;
      return;
    }
    void fetch(url)
      .then((r) => r.blob())
      .then((blob) => decodeVideoBgFrames(blob, params.dim, params.blur))
      .then((decoded) => {
        if (token !== bgVideoToken || disposed) {
          disposeVideoBgFrames(decoded);
          return;
        }
        disposeVideoBgFrames(videoFrames);
        videoFrames = decoded;
      })
      .catch(() => {
        if (token !== bgVideoToken || disposed) return;
        disposeVideoBgFrames(videoFrames);
        videoFrames = null;
      });
  };

  const applyOverlay = () => {
    if (!scene) return;
    const overlayAssets = assets?.overlayAssets ?? {};
    // Dynamics-active bit (R2-03): when captions/audiogram flip OFF the key
    // must move, or the early-out below would leave the renderer presenting
    // the last COMPOSED frame (a baked caption) forever — this re-raster is
    // what pushes the one dynamics-free overlay, mirroring the main window's
    // refreshOverlay. The ON flip rides the same bit: the re-raster re-retains
    // the base the frame-stream compose path draws on.
    const dynOn = hasDynamics(dynamicsOf()) ? 1 : 0;
    const key = `${canvas.width}x${canvas.height}|dyn:${dynOn}|${JSON.stringify(scene.overlay.layers)}|${JSON.stringify(
      scene.overlay.meta,
    )}|${Object.keys(overlayAssets).sort().join(",")}`;
    if (key === overlayKey) return;
    overlayKey = key;
    const token = ++overlayToken;
    void rasterizeOverlay(
      scene.overlay.layers,
      overlayAssets,
      canvas.width,
      canvas.height,
      scene.overlay.meta,
    )
      .then((bmp) => {
        if (token !== overlayToken || disposed) {
          bmp?.close();
          return;
        }
        const dyn = dynamicsOf();
        if (hasDynamics(dyn)) {
          // Dynamics ride on top: retain the base, let the frame stream
          // compose copies (same ownership rules as the primary).
          overlayBase?.close();
          overlayBase = bmp;
          lastOverlayKey = null;
        } else {
          overlayBase?.close();
          overlayBase = null;
          renderer?.setOverlay(bmp); // takes ownership (null clears)
        }
      })
      .catch((e) => console.error("[perform overlay]", e));
  };

  const refreshAssetSurfaces = () => {
    applyCover();
    applyBgImage();
    applyBgVideo();
    applyOverlay();
  };

  const applyLiveToRenderer = (msg: PerformLiveMsg) => {
    renderer?.setMotion(msg.motion);
    renderer?.setSmoothSpectrum(msg.smoothSpectrum);
  };

  const applyLive = (msg: PerformLiveMsg) => {
    live = msg;
    stats.statesApplied++;
    cb.onScene({ blackout: msg.blackout, hud: msg.hud, aspect: msg.aspect });
    applyLiveToRenderer(msg);
  };

  const applySceneToRenderer = (msg: PerformSceneMsg) => {
    for (const def of msg.customDefs) {
      const j = JSON.stringify(def);
      if (registeredDefJson.get(def.id) !== j) {
        registeredDefJson.set(def.id, j);
        registerCustomPreset(def);
        if (lastPresetId === def.id) lastDef = null; // re-push the new def
      }
    }
    const bj = JSON.stringify(msg.builderStack);
    if (bj !== builderJson) {
      builderJson = bj;
      rebuildBuilder2(msg.builderStack);
      renderer?.setBuilderParams(packBuilderParams(msg.builderStack));
      lastBuilderPack = null; // next frame pack re-uploads over the base
      if (lastPresetId === "builder2") lastDef = null;
    }
    const lj = msg.lyrics ? JSON.stringify(msg.lyrics) : "";
    if (lj !== lyricsJson) {
      lyricsJson = lj;
      lastPlateKey = NULL_PLATE_KEY;
      lastOverlayKey = null;
      if (!msg.lyrics) renderer?.setLyricPlate(null);
    }
  };

  const applyScene = (msg: PerformSceneMsg) => {
    scene = msg;
    stats.statesApplied++;
    applySceneToRenderer(msg);
    // Bake params and overlay structure live here; their asset URLs in the
    // assets tier. Either arriving re-runs the combined appliers.
    applyBgImage();
    applyBgVideo();
    applyOverlay();
  };

  const applyAssets = (msg: PerformAssetsMsg) => {
    assets = msg;
    stats.statesApplied++;
    refreshAssetSurfaces();
  };

  // ---- frame application --------------------------------------------
  const applyFrame = (msg: PerformFrameMsg) => {
    stats.framesReceived++;
    lastFrameAt = now();
    lastDuration = msg.features.duration;
    if (phase !== "live") {
      phase = "live";
      pushStatus();
    }
    if (!renderer) {
      pendingFrame = msg;
      return;
    }
    const lag = Math.max(0, now() - msg.sentAt);
    stats.lagMs = stats.lagMs === 0 ? lag : stats.lagMs + (lag - stats.lagMs) * 0.05;
    degraded = nextPresentPolicy(degraded, stats.lagMs);
    stats.degraded = degraded;
    presentCounter++;
    const present = !degraded || presentCounter % 3 === 0;
    const fb = degradeFeedback(msg.feedback, present);

    const started = performance.now();
    const def = presetById(msg.presetId);
    if (def !== lastDef) {
      renderer.setPreset(def);
      lastDef = def;
    }
    if (msg.presetId !== lastPresetId) {
      lastPresetId = msg.presetId;
      cb.onPresetName(def.name);
    }
    if (msg.prevPresetId) {
      const prev = presetById(msg.prevPresetId);
      if (prev !== lastPrevDef) {
        renderer.setTransitionPreset(prev);
        lastPrevDef = prev;
      }
    } else if (lastPrevDef !== null) {
      renderer.setTransitionPreset(null);
      lastPrevDef = null;
    }
    renderer.setBackground(msg.bg);
    renderer.setPost(msg.post);
    if (msg.builderPack && (!lastBuilderPack || !sameF32(msg.builderPack, lastBuilderPack))) {
      renderer.setBuilderParams(msg.builderPack);
      lastBuilderPack = msg.builderPack;
    }
    if (fb !== null) {
      const transition =
        msg.prevPresetId && msg.prevParams
          ? { params: msg.prevParams, mix: msg.mix, kind: msg.transitionKind }
          : undefined;
      renderer.render(msg.features, msg.t, msg.params, transition, { feedback: fb });
      stats.framesRendered++;
    }
    // Video background: pure frame-index upload, the videoBg contract.
    if (videoFrames && msg.bg.mode === BG_VIDEO && videoFrames.frames.length > 0) {
      const i = videoBgFrameIndex(videoFrames.frames.length, videoFrames.fps, msg.t);
      renderer.updateBackgroundVideoFrame(videoFrames.frames[i]);
    }
    // Overlay dynamics (lyrics caption / audiogram): compose at OUR size on
    // key moves — the same pure key+compose pair both existing loops use.
    const dyn = dynamicsOf();
    if (hasDynamics(dyn)) {
      const key = overlayFrameKeyAt(dyn, msg.t, canvas.width);
      if (!lastOverlayKey || !sameOverlayFrame(key, lastOverlayKey)) {
        lastOverlayKey = key;
        const token = ++overlayComposeToken;
        const oTok = overlayToken;
        void composeOverlayFrame(overlayBase, dyn, msg.t, canvas.width, canvas.height)
          .then((bmp) => {
            if (token === overlayComposeToken && oTok === overlayToken && !disposed) {
              renderer?.setOverlay(bmp);
            } else bmp.close();
          })
          .catch(() => undefined);
      }
    }
    // Lyric plate (Lyric Stage's text input) at OUR size on ITS key grid.
    if (scene?.lyrics) {
      const lines = scene.lyrics.lines;
      const pk = lyricPlateKeyAt(lines, msg.t, canvas.width, canvas.height);
      if (!samePlateKey(pk, lastPlateKey)) {
        lastPlateKey = pk;
        const token = ++plateToken;
        void composeLyricPlate(lines, pk)
          .then((bmp) => {
            if (token === plateToken && !disposed) renderer?.setLyricPlate(bmp);
            else bmp.close();
          })
          .catch(() => undefined);
      }
    }
    const cost = performance.now() - started;
    stats.renderMs = stats.renderMs === 0 ? cost : stats.renderMs + (cost - stats.renderMs) * 0.05;
  };

  // ---- channel -------------------------------------------------------
  const channel = factory(PERFORM_CHANNEL_NAME);
  const sendHello = () => channel?.postMessage({ type: "hello" });
  if (channel) {
    channel.onmessage = (ev: MessageEvent) => {
      if (disposed) return;
      const msg = ev.data as PerformMsg;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "frame") applyFrame(msg);
      else if (msg.type === "live") applyLive(msg);
      else if (msg.type === "scene") applyScene(msg);
      else if (msg.type === "assets") applyAssets(msg);
      else if (msg.type === "hi") sendHello(); // publisher (re)booted after us
    };
    sendHello();
  }
  const onPagehide = () => channel?.postMessage({ type: "bye" });
  window.addEventListener("pagehide", onPagehide);

  // ---- liveness watchdog --------------------------------------------
  const watchdog = setInterval(() => {
    if (phase === "live" && now() - lastFrameAt > WAITING_AFTER_MS) {
      phase = "waiting";
      pushStatus();
      // The primary may have restarted without seeing our hello (dev-server
      // reload) — knock again; a live publisher answers with full state.
      sendHello();
    }
  }, 1000);

  // ---- boot ----------------------------------------------------------
  pushStatus();
  void (async () => {
    let first: Renderer;
    try {
      first = await (opts.createRenderer ?? defaultCreate)(canvas);
    } catch {
      first = make2d();
    }
    if (disposed) {
      first.dispose();
      return;
    }
    installRenderer(first);
  })();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      onPagehide(); // best-effort bye
      window.removeEventListener("pagehide", onPagehide);
      clearInterval(watchdog);
      ro.disconnect();
      channel?.close();
      renderer?.dispose();
      renderer = null;
      overlayBase?.close();
      overlayBase = null;
      disposeVideoBgFrames(videoFrames);
      videoFrames = null;
      fallbackCanvas?.remove();
      fallbackCanvas = null;
      canvas.style.visibility = "";
    },
    getStats: () => ({ ...stats }),
  };
}
