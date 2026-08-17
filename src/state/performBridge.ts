import type { AudioFeatures } from "../audio/types";
import type {
  BgSettings,
  FeedbackRenderMode,
  MotionSettings,
  ParamValues,
  PostSettings,
  PresetDef,
} from "../render/types";
import type { BuilderStack } from "../render/builder2";
import type { OverlayAsset, OverlayLayer, OverlayMeta } from "../render/overlay";
import type { LyricLine, LyricStyle } from "./lyrics";
import type { AudiogramSettings } from "./audiogram";
import type { Aspect } from "./project";

/**
 * FEAT-009 — the performance-window mirror bridge, primary side.
 *
 * The second display is a RENDER MIRROR, not a second engine: one
 * AudioEngine, one analyzer, one store, one resolve pass — all in the main
 * window. What crosses to the performance window is the POST-RESOLVE
 * renderer input, published from the one live render call site in
 * services.ts, so the output window receives byte-identical numbers to the
 * operator preview and control state is never duplicated (it never crosses
 * at all).
 *
 * Transport is a same-origin BroadcastChannel: both webviews are served
 * from the app's own origin and share one WebView2 environment, so the
 * channel crosses windows inside the browser process — structured clone
 * carries the Float32Array spectrum/waveform lanes as binary (~13 KB a
 * frame), no JSON, no Rust relay. The same code runs in the plain browser
 * build (`npm run dev` + a second tab at `/?perform=1`), which is how the
 * bridge is exercised without a second physical display. If a WebView2
 * build ever broke cross-window channels, the seam to swap is exactly
 * `defaultChannelFactory`.
 *
 * Four payload tiers, so cost tracks change frequency:
 *  - `frame` — per renderer tick (small, typed arrays clone as binary);
 *  - `live`  — blackout/HUD/aspect/motion/smoothing (tiny, any rate);
 *  - `scene` — defs, layer lists, lyric sheets (KBs, edit-rate);
 *  - `assets` — data-URL payloads (cover art, background image/video,
 *    overlay images; can be MBs) — sent ONLY when an asset identity
 *    changes, never re-cloned by a blackout toggle or a dim-slider drag.
 *
 * Determinism law: this module taps the live loop AFTER the shared
 * chokepoints (frameResolve + mod apply). It is live-only surface — nothing
 * in src/export/ knows it exists, and the export path is untouched.
 */

export const PERFORM_CHANNEL_NAME = "beatform-perform-v1";

/** Per-frame payload — everything renderer.render() and its companion
 * setters consumed on the primary for the SAME tick, feedback directive
 * included so texture-feedback state (Spectro Falls, Overgrowth) advances in
 * lockstep on both renderers. */
export interface PerformFrameMsg {
  type: "frame";
  seq: number;
  /** Date.now() at send — same machine on the receiving end, so the
   * receiver can measure delivery lag without a shared performance origin. */
  sentAt: number;
  t: number;
  features: AudioFeatures;
  presetId: string;
  params: ParamValues;
  /** Outgoing crossfade side, when inside a transition window. */
  prevPresetId: string | null;
  prevParams: ParamValues | null;
  mix: number;
  transitionKind: number;
  bg: BgSettings;
  /** POST-modulation post settings — what the primary renderer holds now. */
  post: PostSettings;
  /** Builder Studio per-layer pack when the builder mode is active. */
  builderPack: Float32Array | null;
  feedback: FeedbackRenderMode;
}

/** Fast-changing, tiny state — safe to resend on every toggle/drag step. */
export interface PerformLiveMsg {
  type: "live";
  blackout: boolean;
  /** Output HUD (preset-name flash on switch) — the drawer's toggle. */
  hud: boolean;
  aspect: Aspect;
  motion: MotionSettings;
  smoothSpectrum: boolean;
}

/** Edit-rate structure — everything the output rasterizes or compiles at
 * its own resolution, WITHOUT the data-URL payloads (those are `assets`). */
export interface PerformSceneMsg {
  type: "scene";
  /** Custom/shadertoy defs so presetById resolves them in the perform
   * window's own registry (the export worker uses the same pattern). */
  customDefs: PresetDef[];
  builderStack: BuilderStack;
  /** Bake parameters for the background image/video; the URL rides the
   * assets tier. Null when the effective background is not in that mode. */
  bgImageParams: { blur: number; dim: number } | null;
  bgVideoParams: { blur: number; dim: number } | null;
  overlay: { layers: OverlayLayer[]; meta: OverlayMeta };
  lyrics: { lines: LyricLine[]; style: LyricStyle } | null;
  audiogram: AudiogramSettings | null;
  /** Downsampled |peak| envelope for the audiogram strip, or null. */
  waveformOverview: Float32Array | null;
}

/** The heavy tier: data-URL payloads, diffed by string identity on the
 * publisher so a multi-MB video background is cloned once per asset change
 * and never again. */
export interface PerformAssetsMsg {
  type: "assets";
  /** Effective cover art (center-image override or track art), data URL. */
  coverUrl: string | null;
  bgImageUrl: string | null;
  bgVideoUrl: string | null;
  /** Overlay IMAGE-layer assets only (never background payloads). */
  overlayAssets: Record<string, OverlayAsset>;
}

/** Receiver -> publisher: "a performance surface is listening". Sent on
 * boot and in reply to `hi`. Activates the mirror and requests full state. */
export interface PerformHelloMsg {
  type: "hello";
}

/** Receiver -> publisher: the surface is going away (pagehide). The Tauri
 * `perform:closed` window event covers the destroy() path where pagehide
 * may never fire; either one deactivates the mirror. */
export interface PerformByeMsg {
  type: "bye";
}

/** Publisher -> receiver: "the primary is up". Covers the boot-order race
 * where the performance surface said hello before the publisher existed
 * (browser dev: the /?perform tab opened first). */
export interface PerformHiMsg {
  type: "hi";
}

export type PerformMsg =
  | PerformFrameMsg
  | PerformLiveMsg
  | PerformSceneMsg
  | PerformAssetsMsg
  | PerformHelloMsg
  | PerformByeMsg
  | PerformHiMsg;

/** The structural slice of BroadcastChannel both sides use — injectable so
 * tests run against an in-memory pair and environments without the API
 * degrade to an inert bridge instead of throwing. */
export interface PerformChannel {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

export function defaultChannelFactory(name: string): PerformChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name);
}

/** What the store hands the publisher: builders for the three state tiers.
 * Injected rather than imported so this module stays store-free (services.ts
 * imports it for the per-frame publish, and services must never depend on
 * the store). */
export interface PerformStateProviders {
  getLive(): Omit<PerformLiveMsg, "type">;
  getScene(): Omit<PerformSceneMsg, "type">;
  getAssets(): Omit<PerformAssetsMsg, "type">;
}

/** Rolling publish-cost stats for the lane's measurement duty (exposed via
 * dev hooks; the report quotes them). `framePostMs` is an EMA of the
 * structured-clone + enqueue cost of one frame postMessage. */
export interface PerformBridgeStats {
  framesSent: number;
  statesSent: number;
  framePostMs: number;
}

let channel: PerformChannel | null = null;
let mirrorActive = false;
let seq = 0;
let providers: PerformStateProviders | null = null;
const stats: PerformBridgeStats = { framesSent: 0, statesSent: 0, framePostMs: 0 };

export function performMirrorActive(): boolean {
  return mirrorActive;
}

export function getPerformBridgeStats(): PerformBridgeStats {
  return { ...stats };
}

/**
 * Install the primary-side publisher. Called once from the store's init
 * (main window only — the performance window runs the RECEIVER, never this).
 * Returns a dispose that closes the channel and deactivates the mirror.
 */
export function initPerformPublisher(
  stateProviders: PerformStateProviders,
  factory: (name: string) => PerformChannel | null = defaultChannelFactory,
): () => void {
  disposePerformPublisher();
  providers = stateProviders;
  channel = factory(PERFORM_CHANNEL_NAME);
  if (channel) {
    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as PerformMsg;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "hello") {
        mirrorActive = true;
        publishPerformState();
      } else if (msg.type === "bye") {
        mirrorActive = false;
      }
    };
    // Cover the receiver-booted-first race: any live surface replies hello.
    try {
      channel.postMessage({ type: "hi" } satisfies PerformHiMsg);
    } catch (e) {
      console.warn("[perform] hi failed", e);
    }
  }
  return disposePerformPublisher;
}

export function disposePerformPublisher(): void {
  channel?.close();
  channel = null;
  mirrorActive = false;
  providers = null;
}

/** Deactivate without tearing down — the Tauri `perform:closed` lifecycle
 * event lands here (destroy() can skip pagehide, so `bye` alone is not
 * enough). The channel stays open for the next hello. */
export function notePerformWindowClosed(): void {
  mirrorActive = false;
}

function post(msg: PerformMsg): boolean {
  if (!channel) return false;
  try {
    channel.postMessage(msg);
    return true;
  } catch (e) {
    console.warn("[perform] publish failed", e);
    return false;
  }
}

/** Push all three state tiers — the hello response, and the store's "resync
 * everything" hammer (renderer swaps on the receiver re-prime from these). */
export function publishPerformState(): void {
  if (!mirrorActive || !providers) return;
  if (post({ type: "assets", ...providers.getAssets() })) stats.statesSent++;
  if (post({ type: "scene", ...providers.getScene() })) stats.statesSent++;
  if (post({ type: "live", ...providers.getLive() })) stats.statesSent++;
}

export function publishPerformLive(): void {
  if (!mirrorActive || !providers) return;
  if (post({ type: "live", ...providers.getLive() })) stats.statesSent++;
}

export function publishPerformScene(): void {
  if (!mirrorActive || !providers) return;
  if (post({ type: "scene", ...providers.getScene() })) stats.statesSent++;
}

export function publishPerformAssets(): void {
  if (!mirrorActive || !providers) return;
  if (post({ type: "assets", ...providers.getAssets() })) stats.statesSent++;
}

/**
 * The per-frame publish — one call site, services.ts, immediately after the
 * live renderer.render(). Argument list mirrors exactly what that call
 * consumed; the flat signature (rather than an options object) keeps the
 * inactive path allocation-free.
 */
export function publishPerformFrame(
  features: AudioFeatures,
  t: number,
  presetId: string,
  params: ParamValues,
  prevPresetId: string | null,
  prevParams: ParamValues | null,
  mix: number,
  transitionKind: number,
  bg: BgSettings,
  post_: PostSettings,
  builderPack: Float32Array | null,
  feedback: FeedbackRenderMode,
): void {
  if (!mirrorActive || !channel) return;
  const started = performance.now();
  try {
    channel.postMessage({
      type: "frame",
      seq: seq++,
      sentAt: Date.now(),
      t,
      features,
      presetId,
      params,
      prevPresetId,
      prevParams,
      mix,
      transitionKind,
      bg,
      post: post_,
      builderPack,
      feedback,
    } satisfies PerformFrameMsg);
    stats.framesSent++;
    const cost = performance.now() - started;
    stats.framePostMs =
      stats.framePostMs === 0 ? cost : stats.framePostMs + (cost - stats.framePostMs) * 0.05;
  } catch (e) {
    // A failed clone must never take the live loop down — deactivate and
    // let the next hello re-arm.
    console.warn("[perform] frame publish failed", e);
    mirrorActive = false;
  }
}
