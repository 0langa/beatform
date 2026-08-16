import {
  BUILDER2_ID,
  packBuilderFrame,
  packBuilderParams,
  rebuildBuilder2,
  sameF32,
  validBuilderStack,
} from "../render/builder2";
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  type StreamTargetChunk,
} from "mediabunny";
import { OfflineAnalyzer } from "../audio/offlineSource";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { AudioFeatures, PcmData, SyncSettings } from "../audio/types";
import { integratedLufs, normalizationGainDb } from "../audio/dsp/lufs";
import { TruePeakLimiter } from "../audio/dsp/truepeak";
import { WebGPURenderer } from "../render/webgpuRenderer";
import { presetUsesFeedback } from "../render/webgpuRenderer";
import { FixedFeedbackClock, isFeedbackTick } from "../render/fixedFeedback";
import {
  BG_IMAGE,
  BG_VIDEO,
  type BgSettings,
  type MotionSettings,
  type ParamValues,
  type PostSettings,
  type PresetDef,
  type RenderOptions,
  type TransitionState,
} from "../render/types";
import { applyMods, applyPostMods, createModEvalState, type ModRoute } from "../state/modMatrix";
import type { Timeline } from "../state/timeline";
import { resolveActiveFrame } from "../state/frameResolve";
import { presetById } from "../render/presets";
import {
  codecConfigExtras,
  codecString,
  MUXER_CODEC,
  type Mp4CodecId,
  type VideoCodecId,
} from "./codecProbe";
import { bakeBackgroundBitmap } from "../render/bgImage";
import {
  decodeVideoBgFrames,
  disposeVideoBgFrames,
  videoBgFrameIndex,
  type VideoBgFrames,
} from "../render/videoBg";
import { stemValuesAt, type StemEntry } from "../audio/stems";
import { registerCustomPreset, validCustomPreset } from "../render/presets/custom";
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
import type { LyricLine, LyricStyle } from "../state/lyrics";
import type { VocalSpan } from "../audio/vocalPresence";
import type { AudiogramSettings } from "../state/audiogram";

/**
 * Offline MP4 export — the design in docs/EXPORT-DESIGN.md, realized.
 * Environment-agnostic: runs identically in a Worker (the normal path) or on
 * the main thread (fallback). Everything in ExportJob is structured-cloneable.
 *
 * Sync is exact by construction: video frame N is rendered from features at
 * t = N/fps of the decoded buffer, and audio timestamps are sample counts
 * over the same buffer. No wall clock anywhere; drift cannot exist.
 *
 * H.264 + AAC (Opus fallback) in MP4 via WebCodecs; hardware encode where
 * available. Renders faster than realtime on GPU presets.
 *
 * Both containers are muxed by mediabunny (MP4 and WebM). mp4-muxer used to
 * own the MP4 lane; it is deprecated upstream in favour of mediabunny, which
 * this file already depended on for the VP9-alpha lane.
 *
 * Two output modes, and the difference between them is the whole memory story:
 *  - "stream": fragmented MP4 (fMP4), chunks handed to onChunk as they are
 *    written. Retention is a few chunk-metadata objects per fragment —
 *    measured at ~0.5 MB per minute of output, i.e. ~60 MB across a 2-hour
 *    export, independent of bitrate. This is the path a desktop export takes.
 *  - "buffer": in-memory fastStart, result = one ArrayBuffer. The whole file
 *    is held in RAM until finalize BY DEFINITION — there is nowhere else to
 *    put it — so memory grows at the full output bitrate (~17 MB/min at the
 *    720p30 default of 2 Mbps + 192 kbps audio). Fine for the short clips the
 *    browser-dev harness and Canvas-loop mode make; NOT a path to run an
 *    hour-long mix down. Long exports must supply streamToPath.
 */
export interface ExportJob {
  pcm: PcmData;
  width: number;
  height: number;
  fps: number;
  /** Video bitrate, bits/second */
  bitrate: number;
  /** Video codec (default "h264"). Encode lane only — pixels are identical. */
  codec?: VideoCodecId;
  presetId: string;
  params: ParamValues;
  bg: BgSettings;
  /** Sync-source selection — same values as the live view for WYSIWYG */
  sync?: SyncSettings;
  /** Pre-rasterized overlay (text/logo), premultiplied, at output size. */
  overlay?: ImageBitmap;
  /** Beat grid (already shifted for segments) — visuals lock to it. */
  beatGrid?: BeatGrid;
  /** Section boundaries in seconds (already shifted for segments) — resolve
   * features.sectionIndex / sectionPulse, the preview path's setSections. */
  sections?: number[];
  /** Sung spans in seconds (already shifted for segments) driving
   * features.vocal. Deliberately NOT derived from `lyrics` above: that field
   * only travels when the lyric OVERLAY is enabled, and a modulation source
   * must not switch off because the user stopped drawing the words — preview
   * feeds the same spans ungated, so the two agree. */
  vocalSpans?: VocalSpan[];
  /** Modulation routes for the preset — applied per frame like the live view. */
  mods?: ModRoute[];
  /** Spline-connected spectrum sampling toggle (matches the live view). */
  smoothSpectrum?: boolean;
  /** Post-processing chain (bloom/tonemap/vignette/grain/chromatic). */
  post?: PostSettings;
  /** Global motion masters (rotation/pulse/detail) — matches the live view. */
  motion?: MotionSettings;
  /** Track cover art as a data URL, for presets that sample it (coverSample()). */
  coverArt?: string;
  /** Image background (bg.mode 3): the asset + baked-look parameters. The
   * core bakes with the same shared function as the live view. */
  bgImage?: { dataUrl: string; dim: number; blur: number };
  /** Video background (bg.mode 4): the asset + dim. The core decodes the same
   * capped loop the live view did and uploads a frame per export frame.
   * timeOffset (seconds) shifts the loop index for segment exports so it
   * matches the live view's absolute-track-time loop. */
  bgVideo?: { dataUrl: string; dim: number; blur?: number; timeOffset?: number };
  /**
   * Absolute track time of the exported clip's t=0 — the segment start, 0 for
   * a full-track export. ABSOLUTE BY DESIGN, exactly like `bgVideo.timeOffset`
   * above and for the same reason: a segment export rebases every OTHER
   * time-bearing field onto the clip, and this is the one number that records
   * where the clip sits on the track.
   *
   * The analyzer stamps it onto every frame as `features.timeOrigin`, which is
   * what keeps the tempo-locked LFO sources at the phase the preview shows
   * (E2-R1). `buildJob` always emits it — the segment-shift key census pins
   * that, and segmentLfoPhase.test.ts pins the whole walk end to end.
   *
   * REQUIRED, deliberately. It landed optional because five test fixtures
   * would not compile without it, and `?? 0` at the read site would have made
   * a job that forgot the field render at the wrong moment SILENTLY — the
   * exact failure mode this field exists to close. A missing value is a
   * typecheck error now, and the five fixtures say `timeOrigin: 0` out loud.
   */
  timeOrigin: number;
  /** Imported stems' envelope timelines — mod-matrix stem sources. */
  stems?: StemEntry[];
  /** Timed lyrics (already segment-shifted) + style — composited onto the
   * overlay with the SAME function the live view uses. */
  lyrics?: { lines: LyricLine[]; style: LyricStyle };
  /** Audiogram elements (progress bar / time / waveform strip) — composited
   * per frame from track time + the waveform overview. */
  audiogram?: { settings: AudiogramSettings; waveform: Float32Array | null };
  /** User-authored WGSL presets — re-registered inside the worker so
   * presetById() resolves them there too. */
  customPresets?: PresetDef[];
  /** Builder Studio stack (renders when a presetId resolves to "builder2"). */
  builderStack?: import("../render/builder2").BuilderStack;
  /** Timeline (already shifted for segments) — scenes + automation. */
  timeline?: Timeline;
  /** Per-preset param overrides — scene switches resolve their own base. */
  paramsByPreset?: Record<string, ParamValues>;
  /** Per-preset mod routes — a scene's preset uses its own routes. */
  modsByPreset?: Record<string, ModRoute[]>;
  /**
   * Seamless-loop crossfade (seconds). The final crossfade window blends
   * into the FIRST frames/samples, so the last frame ≈ frame 0 and the loop
   * point is invisible — Spotify Canvas mode. 0/undefined = off.
   */
  loopCrossfadeSec?: number;
  /**
   * "buffer" = in-memory fastStart MP4, "stream" = fragmented MP4 to disk,
   * "png" = PNG image sequence (one file per frame, alpha preserved when the
   * background is transparent). PNG mode encodes no audio and no video codec —
   * it emits frames through hooks.onFrame.
   */
  mode: "buffer" | "stream" | "png";
  /**
   * Deep-colour lane (FEAT-005): render through the full post chain into the
   * renderer's rgba16float tap and hand each frame to hooks.onRawFrame as
   * tightly-packed rgba64le-order u16 — post-tonemap, pre-quantize pixels for
   * a genuine 10-bit sidecar encode. Like the PNG lane, this bypasses the
   * WebCodecs/mediabunny encode entirely (the ffmpeg sidecar owns mux + audio
   * via the same WAV staging ProRes uses), so `mode`'s buffer/stream
   * distinction is inert and `codec` is ignored. Mutually exclusive with
   * mode "png" (two frame sinks would collide) and with loopCrossfadeSec
   * (the loop blend runs through an 8-bit 2D canvas, which would silently
   * re-quantize exactly the pixels this lane exists to protect) — both are
   * rejected at job start rather than half-honoured.
   */
  deepColor?: boolean;
  /**
   * Deep-colour lane, straight-alpha variant (FEAT-005 ProRes 4444 lane).
   * Only meaningful alongside deepColor: true. The renderer's internal
   * convention is premultiplied alpha; ProRes 4444's yuva444p10le decodes its
   * alpha plane straight (unlike AV1's alpha-less yuv420p10le), matching what
   * the 8-bit PNG lane it replaces always delivered (the browser
   * un-premultiplies while encoding PNG). Setting this un-premultiplies each
   * raw frame before it reaches hooks.onRawFrame. Undefined/false keeps the
   * AV1 lane's exact existing premultiplied-passthrough bytes.
   */
  deepStraightAlpha?: boolean;
  /**
   * Loudness normalization for the delivered audio. Undefined = off (the track
   * is encoded at its own level).
   *
   * This deliberately touches the audio lane ONLY — the analyzer keeps reading
   * the untouched buffer, so the visuals are byte-identical whether or not you
   * normalize, and still match the live preview (which plays the original
   * file). Normalization is a delivery step, not a creative one.
   */
  loudness?: LoudnessJob;
}

export interface LoudnessJob {
  /** Integrated loudness to land on, LUFS (e.g. -14 for streaming). */
  targetLufs: number;
  /** True-peak ceiling the limiter enforces, dBTP (e.g. -1). */
  truePeakDb: number;
}

export interface LoudnessResult {
  /** Measured integrated loudness of the source, LUFS. */
  inputLufs: number;
  /** Makeup gain applied to reach the target, dB. */
  gainDb: number;
  /** Highest true peak after gain, before limiting, dBTP. */
  peakInDb: number;
  /** Deepest gain reduction the limiter applied, dB (<= 0). */
  reductionDb: number;
}

export interface ExportCoreResult {
  /** Present in "buffer" mode only. */
  buffer?: ArrayBuffer;
  bytes: number;
  seconds: number;
  audioCodec: "aac" | "opus";
  /** Present when loudness normalization ran. */
  loudness?: LoudnessResult;
}

export interface ExportCoreHooks {
  onProgress?: (framesDone: number, framesTotal: number) => void;
  /**
   * Setup-phase liveness pings (AX-3). Everything before the first onProgress
   * — codec probes, renderer creation, asset decodes, the whole-track
   * loudness measurement, the analyzer mixdowns — can run for tens of seconds
   * on a long track without a single message leaving the worker, and the
   * exporter's silence watchdog read that as a dead worker and re-ran the job
   * inline on the main thread. The worker maps these to `heartbeat` posts so
   * the watchdog can tell "busy setting up" from "dead"; the inline path
   * leaves it unset. Carries no data, never reaches the UI, and (like every
   * hook here) has zero effect on rendered output.
   */
  onHeartbeat?: () => void;
  /**
   * E4a: cadence of the frame-loop liveness pulse, a TEST SEAM — production
   * callers leave it unset (5 s; six beats per 30 s watchdog window). The
   * pulse exists because the loop's organic messages can all legitimately
   * starve: software AV1 at quality latency holds a ~20+ frame lookahead
   * before its FIRST chunk, and progress posts only every 10 frames AFTER
   * the encoder's backpressure await — so a slow encode parked a perfectly
   * healthy worker in >30 s of silence and the watchdog killed it
   * ("stopped responding mid-render", owner-hit on 2.93.0). With the pulse,
   * the watchdog means exactly what its docs say: event-loop death.
   */
  livenessPulseMs?: number;
  /** "stream" mode: sequential-position file chunks (fragmented MP4). */
  /** Stream-mode sink. MAY return a promise; the core awaits it, so a writer
   * that reports completion applies real backpressure to the encoders instead
   * of letting undrained chunks pile up in RAM. */
  onChunk?: (data: Uint8Array, position: number) => void | Promise<void>;
  /**
   * "png" mode: one encoded PNG per frame, in order (index is 0-based).
   *
   * MAY return a promise, and the core AWAITS it — that await is the only
   * backpressure on this lane. The MP4/WebM lanes throttle on
   * `encodeQueueSize`, but PNG/ProRes/GIF/WebP have no encoder queue to watch:
   * the ffmpeg sidecar (or the disk) is typically slower than the GPU render,
   * so a fire-and-forget sink grew the backlog by (render fps − encode fps) ×
   * frame size per second — hundreds of MB/s at 4K, and the likeliest cause of
   * an OOM on a long ProRes or GIF export. The Rust side already blocks on
   * ffmpeg's stdin; awaiting here is what stops that backpressure being
   * discarded in TypeScript.
   */
  onFrame?: (data: Uint8Array, index: number) => void | Promise<void>;
  /**
   * Deep-colour lane (job.deepColor): one raw frame per video frame, in
   * order — tightly-packed rgba64le-order u16 (R,G,B,A per pixel, row-major,
   * no padding), length = width×height×4. Feed it to ffmpeg as
   * `-f rawvideo -pix_fmt rgba64le -s WxH`. Shared by the AV1 and ProRes
   * lanes; the alpha channel's convention (premultiplied vs straight)
   * depends on job.deepStraightAlpha — see its doc.
   *
   * MAY return a promise, and the core AWAITS it — the same backpressure
   * contract as onFrame, and it matters MORE here: a raw 1080p frame is
   * ~16.6 MB (4K ~66 MB), so a fire-and-forget sink would grow the backlog
   * by (render fps − encode fps) × frame size per second and OOM a long
   * export far faster than the PNG lane ever could.
   */
  onRawFrame?: (data: Uint16Array) => void | Promise<void>;
  /**
   * E4b: per-frame phase timing, a TEST SEAM in the same family as
   * onHeartbeat/livenessPulseMs above — no production caller sets this today.
   * Built to answer one question (BACKLOG E4b): does the frame loop's render
   * wait (`renderAt` + `gpuDone()` + any readback) or its encode wait
   * (`add()`/`onFrame`/`onRawFrame` backpressure) dominate wall time, which
   * decides whether a one-frame pipeline overlap is worth building.
   *
   * Zero cost when absent: every timestamp below is gated on this hook
   * existing, so a run with no listener touches performance.now() zero
   * times — pinned by exportCorePhaseSample.test.ts, which spies on it and
   * asserts no calls. Like every hook here, it has zero effect on rendered
   * output BY CONSTRUCTION: each timestamp is read after the call it times
   * and only written into the sample object handed to the caller — nothing
   * computed here is ever read back by the loop itself, so there is no path
   * from this hook's presence to a different renderAt/add/onFrame/onRawFrame
   * argument on any frame.
   */
  onPhaseSample?: (sample: PhaseSample) => void;
  signal?: AbortSignal;
}

/** One frame's wall-clock phase split, ms. See ExportCoreHooks.onPhaseSample. */
export interface PhaseSample {
  /** Frame index, 0-based — matches onProgress's `done` cadence but fires
   * every frame (onProgress only posts every 10th). */
  n: number;
  /** `renderAt(...)` (synchronous submit) through `await gpuDone()`. */
  renderMs: number;
  /** Canvas/deep-target readback: `convertToBlob` (png) or
   * `readbackDeepFrame` (deep). Zero for the ordinary MP4/WebM lane, where
   * the encoder samples the canvas directly — no separate readback step. */
  readbackMs: number;
  /** The frame sink: `videoSource.add()` (MP4/WebM), `onFrame` (png), or
   * `onRawFrame` (deep) — whichever backpressure await this job's mode uses. */
  encodeMs: number;
  /** render + readback + encode + the per-frame audio pump — the full cost
   * this frame added to the loop's wall clock. */
  wallMs: number;
}

const CODEC_NAMES: Record<VideoCodecId, string> = {
  h264: "H.264",
  hevc: "HEVC",
  av1: "AV1",
  vp9a: "VP9 (alpha)",
};

/** Sample rates the WebCodecs Opus encoder accepts (Opus operating rates). */
const OPUS_RATES = new Set([8000, 12000, 16000, 24000, 48000]);

export async function runExportJob(
  job: ExportJob,
  hooks: ExportCoreHooks = {},
): Promise<ExportCoreResult> {
  const abort = () => {
    if (hooks.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };
  abort();

  // Deep-colour lane preconditions — reject impossible combinations up front
  // with a reason, before any GPU/encoder resource exists. See the deepColor
  // field's doc for why each pairing is forbidden.
  const isDeep = job.deepColor === true;
  if (isDeep) {
    if (job.mode === "png") {
      throw new Error("deepColor is mutually exclusive with PNG mode (one frame sink per job)");
    }
    if (job.loopCrossfadeSec) {
      throw new Error(
        "deepColor is mutually exclusive with loop crossfade — the loop blend runs " +
          "through an 8-bit canvas and would re-quantize the deep frames",
      );
    }
    if (!hooks.onRawFrame) {
      // Without a sink every rendered frame would be silently discarded and
      // the job would "succeed" while producing nothing.
      throw new Error("deepColor requires hooks.onRawFrame");
    }
  }

  // Custom WGSL presets: the worker is a fresh module instance with an empty
  // registry — re-register (re-validated; a job is still untrusted input).
  for (const raw of job.customPresets ?? []) {
    const def = validCustomPreset(raw);
    if (def) registerCustomPreset(def);
  }

  // Builder Studio: regenerate the def in THIS module instance (the worker's
  // registry starts empty) so presetById("builder2") resolves to the job's
  // stack. The layer-param upload happens after the renderer exists below.
  const builderStack = job.builderStack ? validBuilderStack(job.builderStack) : null;
  if (builderStack) rebuildBuilder2(builderStack);

  const pcm = job.pcm;
  const channels = Math.min(2, pcm.channels.length) as 1 | 2;
  const sampleRate = pcm.sampleRate;
  // PNG sequence: no muxer, no codecs, no audio — just rendered frames out.
  const isPng = job.mode === "png";

  // --- Audio codec probe: AAC preferred, Opus fallback
  const aacConfig: AudioEncoderConfig = {
    codec: "mp4a.40.2",
    sampleRate,
    numberOfChannels: channels,
    bitrate: 192_000,
  };
  const opusConfig: AudioEncoderConfig = {
    codec: "opus",
    sampleRate,
    numberOfChannels: channels,
    bitrate: 192_000,
  };
  let audioCodec: "aac" | "opus" = "aac";
  let bytesOut = 0;
  // One mediabunny Output drives both containers. MP4 carries h264/hevc/av1 +
  // AAC (Opus fallback); "vp9a" takes the WebM lane instead: VP9 color + alpha
  // planes dual-encoded (mediabunny splits the frames and syncs the encoders)
  // and muxed with BlockAdditions — the transparent-video path. The render walk
  // above these sources is byte-identical either way; only the encode/mux
  // stage differs.
  // Deep mode rides the sidecar exactly like PNG/ProRes: no muxer, no
  // WebCodecs audio — the ffmpeg process encodes audio from the staged WAV.
  const isWebm = !isPng && !isDeep && (job.codec ?? "h264") === "vp9a";
  let output: Output | null = null;
  let videoSource: VideoSampleSource | null = null;
  let audioSource: AudioSampleSource | null = null;
  let bufferTarget: BufferTarget | null = null;

  // Device loss (driver reset / TDR) is silent otherwise: gpuDone() resolves
  // rather than rejects on a lost device, so every subsequent frame renders as
  // black and the export "succeeds" — a valid-looking file with no picture in
  // it. That is worse than failing, so treat it as a hard failure.
  // Encoder failures need no equivalent flag: mediabunny latches them and
  // rethrows from the next `add()` / `finalize()`, inside this function's
  // control flow, which is exactly where they are wanted.
  let deviceLost: Error | null = null;

  /**
   * Stream-mode sink: file chunks out to hooks.onChunk as the muxer writes
   * them. Chunks are batched to ~16 MiB (`chunked`) to keep the write count
   * down, and COPIED because the chunk goes to an async writer chain that
   * outlives this callback while it is still a view into the muxer's batching
   * buffer.
   *
   * Positioned writes, not append-only: the WebM muxer seeks back to patch
   * sizes/cues/duration, and the desktop file writer supports seeks.
   * appendOnly would avoid the seeks but ships a file with no duration or
   * cues — strictly worse. Fragmented MP4 never seeks at all (mediabunny
   * asserts its own monotonicity there), so this costs it nothing.
   */
  const makeStreamTarget = (): StreamTarget =>
    new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        // AWAIT the sink. A WritableStream whose write() resolves immediately
        // applies no backpressure, so the encoders ran as fast as the GPU could
        // feed them while the disk fell behind, and every chunk the writer had
        // not yet flushed stayed live in its promise chain. That retains the
        // whole bitstream — ~16 MB per minute at the 720p30 default — which is
        // what a 2-hour export measured as +152 MB/10 min of growth plus a
        // 130 -> 30 fps decay from the GC pressure. Awaiting here propagates
        // backpressure through mediabunny into the encoders (its StreamTarget
        // docs promise exactly that), so a slow disk throttles the render
        // instead of being buffered in RAM. Same rule the PNG lane already
        // follows by awaiting onFrame.
        write: async (chunk) => {
          const copy = chunk.data.slice();
          bytesOut = Math.max(bytesOut, chunk.position + copy.length);
          await hooks.onChunk?.(copy, chunk.position);
        },
      }),
      { chunked: true },
    );

  if (isWebm) {
    audioCodec = "opus";
    const vSupport = await VideoEncoder.isConfigSupported({
      codec: codecString("vp9a", job.width, job.height, job.fps),
      width: job.width,
      height: job.height,
      bitrate: job.bitrate,
      framerate: job.fps,
    } as VideoEncoderConfig);
    if (!vSupport.supported) {
      throw new Error(
        `VP9 encode not supported for ${job.width}x${job.height}@${job.fps}` +
          " on this machine — switch Codec back to H.264",
      );
    }

    videoSource = new VideoSampleSource({
      codec: "vp9",
      bitrate: job.bitrate,
      alpha: "keep",
      keyFrameInterval: 2, // seconds — matches the MP4 lane's fps*2 frames
      latencyMode: "quality",
    });
    // Opus only runs at its operating rates; mediabunny resamples the audio
    // lane when the track is e.g. 44.1 kHz. The analyzer keeps reading the
    // untouched pcm, so the visuals are unaffected.
    audioSource = new AudioSampleSource({
      codec: "opus",
      bitrate: 192_000,
      ...(OPUS_RATES.has(sampleRate) ? {} : { transform: { sampleRate: 48000 } }),
    });
    bufferTarget = job.mode === "buffer" ? new BufferTarget() : null;
    output = new Output({
      format: new WebMOutputFormat(),
      target: bufferTarget ?? makeStreamTarget(),
    });
    output.addVideoTrack(videoSource, { frameRate: job.fps });
    output.addAudioTrack(audioSource);
    await output.start();
  } else if (!isPng && !isDeep) {
    try {
      if (!(await AudioEncoder.isConfigSupported(aacConfig)).supported) {
        audioCodec = "opus";
      }
    } catch {
      audioCodec = "opus";
    }
    if (audioCodec === "opus" && !(await AudioEncoder.isConfigSupported(opusConfig)).supported) {
      throw new Error("No supported audio encoder (tried AAC, Opus)");
    }

    const codec = (job.codec ?? "h264") as Mp4CodecId;
    const videoConfig = {
      codec: codecString(codec, job.width, job.height, job.fps),
      width: job.width,
      height: job.height,
      bitrate: job.bitrate,
      framerate: job.fps,
      latencyMode: "quality",
      ...codecConfigExtras(codec),
    } as VideoEncoderConfig;
    const vSupport = await VideoEncoder.isConfigSupported(videoConfig);
    if (!vSupport.supported) {
      throw new Error(
        `${CODEC_NAMES[codec]} encode not supported for ${job.width}x${job.height}@${job.fps}` +
          (codec !== "h264" ? " on this machine — switch Codec back to H.264" : ""),
      );
    }

    videoSource = new VideoSampleSource({
      codec: MUXER_CODEC[codec],
      bitrate: job.bitrate,
      // The exact string codecProbe just gated this job with, not mediabunny's
      // own bitrate-derived guess. Encoding at a different level than the one
      // isConfigSupported approved is how a job that "probed fine" fails at
      // frame 0 on a marginal HEVC/AV1 encoder.
      fullCodecString: videoConfig.codec,
      keyFrameInterval: 2, // seconds — the fps*2 cadence, stated in its units
      latencyMode: "quality",
    });
    audioSource = new AudioSampleSource({
      codec: audioCodec,
      bitrate: 192_000,
      // Pin the profile probed above. Left to itself mediabunny would pick
      // HE-AAC (mp4a.40.5/.29) for a track at 24 kHz or below, which is NOT
      // what isConfigSupported approved.
      fullCodecString: audioCodec === "aac" ? aacConfig.codec : opusConfig.codec,
    });
    bufferTarget = job.mode === "buffer" ? new BufferTarget() : null;
    output = new Output({
      format: new Mp4OutputFormat({
        // Streaming writes fragmented MP4: strictly forward, and only the
        // per-fragment index is retained (~0.5 MB/min) rather than the file.
        // "in-memory" holds every sample until finalize — see the note on
        // ExportJob.mode; that is inherent to handing back one ArrayBuffer.
        fastStart: bufferTarget ? "in-memory" : "fragmented",
        // A fragment can only start on a key frame, so this floor and the
        // fps*2 keyframe cadence agree: one fragment per keyframe. Left at the
        // 1 s default the muxer would try (and fail) to cut twice as often.
        minimumFragmentDuration: 2,
      }),
      target: bufferTarget ?? makeStreamTarget(),
    });
    output.addVideoTrack(videoSource, { frameRate: job.fps });
    output.addAudioTrack(audioSource);
    await output.start();
  }

  // Setup heartbeats (AX-3): one after each stage that can be slow, so the
  // worker is never message-silent for longer than a single stage.
  hooks.onHeartbeat?.();

  const canvas = new OffscreenCanvas(job.width, job.height);
  // Loop mode holds the first K frames to blend into the last K (see below)
  const headFrames: ImageBitmap[] = [];
  let renderer: WebGPURenderer;
  try {
    renderer = await WebGPURenderer.create(canvas);
  } catch (e) {
    // Keep the cause: this fires both when the system genuinely has no WebGPU
    // and when a device is transiently unavailable (e.g. just after a driver
    // reset). Reporting the second as the first turns "try again" into a
    // permanent capability claim. (Assigned rather than passed to the
    // constructor — `cause` is ES2022 and this project targets ES2020.)
    const err = new Error("Export requires WebGPU, which is unavailable on this system");
    err.name = "GpuInitError";
    (err as Error & { cause?: unknown }).cause = e;
    throw err;
  }

  renderer.onDeviceLost = (reason: string) => {
    const err = new Error(`GPU device lost during export: ${reason}`);
    err.name = "GpuDeviceLostError";
    deviceLost = err;
  };

  // With dynamic layers (lyrics/audiogram) the static overlay is a
  // compositing BASE that must survive the whole render — the renderer closes
  // whatever it's handed on replace, so it only ever receives composed copies
  // (the frame loop swaps them as the key moves). Otherwise the old direct
  // hand-off stands.
  const dynamics: OverlayDynamics = {
    lyrics: job.lyrics,
    audiogram: job.audiogram
      ? {
          settings: job.audiogram.settings,
          duration: pcm.duration,
          waveform: job.audiogram.waveform,
        }
      : undefined,
  };
  const dynamicOverlay = hasDynamics(dynamics);
  const overlayBase = dynamicOverlay ? (job.overlay ?? null) : null;
  // Hoisted so the finally can dispose it on the abort/failure path too.
  let videoBg: VideoBgFrames | null = null;
  let lastFrameKey: OverlayFrameKey = {
    lyricIdx: -2,
    lyricAlphaQ: -1,
    lyricProgQ: -1,
    progressPx: -2,
    clockSec: -2,
  };
  // The lyric plate's own key memo (Lyric Stage's text input). Separate from
  // the overlay key on purpose: the plate travels with job.lyrics whether or
  // not the caption overlay is enabled, and keys on its own grid.
  let lastPlateKey: LyricPlateKey = NULL_PLATE_KEY;
  // E4a: declared OUTSIDE the try so the finally can always stop it; armed
  // only once setup completes (setup has its own staged heartbeats, AX-3).
  let stopLivenessPulse: () => void = () => {};
  try {
    // Deep lane: flip the renderer into deep capture BEFORE the first frame —
    // every presented frame then runs the full post graph into the rgba16float
    // tap (the neutral-post swapchain fast path is bypassed inside).
    if (isDeep) renderer.setDeepCapture(true);
    renderer.setPreset(presetById(job.presetId));
    renderer.setBackground(job.bg);
    if (!dynamicOverlay) renderer.setOverlay(job.overlay ?? null);
    renderer.setSmoothSpectrum(job.smoothSpectrum === true);
    if (job.post) renderer.setPost(job.post);
    if (job.motion) renderer.setMotion(job.motion);
    // Builder bridge (RP-20): the initial upload doubles as the dirty-check
    // baseline for the per-frame packBuilderFrame overlay below.
    let lastBuilderPack: Float32Array | null = null;
    if (builderStack) {
      lastBuilderPack = packBuilderParams(builderStack);
      renderer.setBuilderParams(lastBuilderPack);
    }
    // Cover art for presets that sample it — decoded here so the export matches
    // the live view. A missing/broken cover just leaves hasCover() false.
    if (job.coverArt) {
      try {
        const blob = await (await fetch(job.coverArt)).blob();
        renderer.setCoverArt(await createImageBitmap(blob));
      } catch {
        // no cover — presets fall back to their plain fill
      }
    }
    // Image background: same shared bake as the live view (WYSIWYG). A
    // broken asset degrades to the preset background — never a black frame.
    // The flag matters: the frame loop calls setBackground(rf.bg) every frame,
    // which would silently restore image mode (and its black frames) if the
    // degrade were applied only once here.
    let bgImageFailed = false;
    if (job.bgImage) {
      try {
        renderer.setBackgroundImage(
          await bakeBackgroundBitmap(job.bgImage.dataUrl, job.bgImage.blur, job.bgImage.dim),
        );
      } catch {
        bgImageFailed = true;
      }
    }
    // Video background: decode the SAME loop the live view decoded (mediabunny
    // is deterministic on the same bytes + dim), then upload the frame for each
    // export frame's track time. A broken decode degrades to the preset bg.
    if (job.bgVideo) {
      try {
        const blob = await (await fetch(job.bgVideo.dataUrl)).blob();
        videoBg = await decodeVideoBgFrames(blob, job.bgVideo.dim, job.bgVideo.blur ?? 0);
      } catch {
        videoBg = null;
      }
    }
    // Renderer + cover/background assets are in — the decodes above are the
    // slowest async stages of setup (a video bg can be a ~200 MB asset).
    hooks.onHeartbeat?.();
    renderer.resize(job.width, job.height, 1);

    // Loop mode: crossfade the tail into the head. Denominator is N+1 so the
    // LAST tail sample/frame approaches — but never equals — the first one:
    // with /N the final blend hit alpha 1.0, making the last frame an exact
    // copy of frame 0, and every loop played the seam twice (a visible 1-frame
    // stutter at 30 fps).
    const xfadeSamples = job.loopCrossfadeSec
      ? Math.min(Math.floor(job.loopCrossfadeSec * sampleRate), Math.floor(pcm.length / 2))
      : 0;
    if (xfadeSamples > 0) {
      for (const data of pcm.channels.slice(0, channels)) {
        const start = pcm.length - xfadeSamples;
        for (let i = 0; i < xfadeSamples; i++) {
          const a = (i + 1) / (xfadeSamples + 1);
          data[start + i] = data[start + i] * (1 - a) + data[i] * a;
        }
      }
    }

    // --- Loudness normalization (audio lane only; the analyzer below reads the
    // untouched pcm, so visuals are unaffected). Measured after the loop
    // crossfade so we measure exactly what gets encoded.
    let limiter: TruePeakLimiter | null = null;
    let loudnessResult: LoudnessResult | undefined;
    let normGainDb = 0;
    let normInputLufs = 0;
    if (audioSource && job.loudness) {
      // The single longest synchronous setup stage — a 2 h track is two
      // biquads over ~700 M samples, tens of seconds on a slow CPU. The
      // heartbeat fires every 10 s of audio measured, so the worker is never
      // silent for the whole measurement (AX-3). Liveness only: the callback
      // observes and cannot change the measured value.
      normInputLufs = integratedLufs(
        pcm.channels.slice(0, channels),
        sampleRate,
        hooks.onHeartbeat,
      );
      normGainDb = normalizationGainDb(normInputLufs, job.loudness.targetLufs);
      limiter = new TruePeakLimiter(
        sampleRate,
        channels,
        Math.pow(10, normGainDb / 20),
        job.loudness.truePeakDb,
      );
    }

    // --- Audio lane: feed the whole buffer in planar chunks (MP4 only — a PNG
    // sequence carries no audio; the user keeps the original track).
    const CHUNK = 16384;
    const planar = new Float32Array(CHUNK * channels);
    // The limiter delays by `lat` samples so it can duck ahead of a peak. Prime
    // it with the first `lat` samples and then read `lat` ahead of what we
    // emit, so its output stays sample-aligned with the video instead of
    // sliding a couple of ms late.
    const lat = limiter?.latency ?? 0;
    if (limiter && lat > 0) {
      const prime = new Float32Array(lat * channels);
      for (let ch = 0; ch < channels; ch++) {
        const src = pcm.channels[ch];
        prime.set(src.subarray(0, Math.min(lat, src.length)), ch * lat);
      }
      limiter.process(prime, lat, channels);
    }
    // The audio lane is a PUMP the video loop drives incrementally (M9).
    // Draining the whole track before the first video frame forced the muxer
    // to buffer every encoded audio chunk (~86 MB per hour, plus hundreds of
    // thousands of sample-metadata objects) until a video DTS existed. The
    // video loop now pumps audio just ahead of the frame it encodes, so the
    // muxer interleaves lanes as it goes and memory stays genuinely flat.
    let audioPos = 0;
    const pumpAudioTo = async (targetSample: number): Promise<void> => {
      if (!audioSource) return;
      const end = Math.min(targetSample, pcm.length);
      while (audioPos < end) {
        abort();
        const pos = audioPos;
        const frames = Math.min(CHUNK, pcm.length - pos);
        for (let ch = 0; ch < channels; ch++) {
          const src = pcm.channels[ch];
          const off = ch * frames;
          const from = pos + lat;
          const n = Math.max(0, Math.min(frames, src.length - from));
          if (n > 0) planar.set(src.subarray(from, from + n), off);
          // Zero-pad past the end so the limiter can flush its look-ahead.
          if (n < frames) planar.fill(0, off + n, off + frames);
        }
        limiter?.process(planar, frames, channels);
        const data = new AudioData({
          format: "f32-planar",
          sampleRate,
          numberOfFrames: frames,
          numberOfChannels: channels,
          timestamp: Math.round((pos * 1e6) / sampleRate),
          data: planar.subarray(0, frames * channels),
        });
        // add() awaits the internal encode queue AND the writer — that await
        // is the whole backpressure story for this lane. Closing the sample
        // closes the wrapped AudioData. finally: a rejection mid-queue (a dead
        // encoder rethrown here) would otherwise leak both.
        const sample = new AudioSample(data);
        try {
          await audioSource.add(sample);
        } finally {
          sample.close();
        }
        audioPos = pos + frames;
      }
    };

    // --- Video lane: deterministic frame walk. Per-frame preset/params/mods/
    // background come from resolveActiveFrame — the SAME pure function the live
    // loop uses, which is what guarantees this file matches the preview.
    let currentPresetId = job.presetId;
    let fadeFromId: string | null = null;
    /** True while the renderer holds MODULATED post settings — see services.ts. */
    let postModulated = false;
    /** FRESH lag memory for this export run (P-16): the frame walk below is
     * strictly sequential from frame 0, so attack/release routes resolve the
     * same smoothed values on every export of the same document —
     * bit-identical files, independent of any live preview state. */
    const modEval = createModEvalState();
    const frameInput = {
      timeline: job.timeline ?? { enabled: false as const, scenes: [], lanes: [] },
      basePresetId: job.presetId,
      baseParams: job.params,
      baseMods: job.mods ?? [],
      baseBg: job.bg,
      paramsByPreset: job.paramsByPreset ?? {},
      modsByPreset: job.modsByPreset ?? {},
    };
    const vocalSpans = job.vocalSpans ?? null;
    // Where this clip's t=0 sits on the track (segment exports), stamped onto
    // every frame so absolute-time sources resolve the preview's value.
    const timeOrigin = job.timeOrigin;
    /**
     * CLIP time -> the RENDERER's clock, and THE ONE PLACE that conversion
     * happens (E2-R1 / option f).
     *
     * `renderer.render`'s time argument is uniform slot 0, `u.time` — read by
     * most presets and by the post chain's film grain, which seeds from
     * `fract(u.time)` (runPost takes the same argument). The live preview
     * feeds it ABSOLUTE track time (services.ts `trackTime`), for the
     * presented frame and the texture-feedback advance alike. This walk counts
     * frames from the clip's own zero, so without the offset a segment or
     * Canvas-loop export drew a different moment of every time-driven shader
     * than the preview showed.
     *
     * BOTH render call sites below go through this — the presented frame and
     * the 60 Hz feedback advance walk — and both are handed CLIP time, so the
     * translation is rigid: the tick times a frame drains (k/60 <= t) keep
     * exactly their spacing and ordering relative to the frame's own t. The
     * two clocks therefore cannot disagree inside one frame, which would be a
     * worse bug than the one this fixes. `renderer.render` is called NOWHERE
     * else in this file; a new render site must call this instead.
     *
     * Everything else in the walk deliberately stays on CLIP time, because
     * buildJob already rebased the document onto the clip: `features.time`,
     * resolveActiveFrame (timeline scenes + automation lanes), stemValuesAt,
     * the overlay compose key and its lyric/audiogram timings (a segment's
     * audiogram reads 0:00 / 0:40 by design), and isFeedbackTick /
     * FixedFeedbackClock, whose 60 Hz state grid is anchored to the clip's
     * first frame. The video background is the one other absolute, and it
     * already carries its own copy of this number as `bgVideo.timeOffset` —
     * the same `segment.start`, applied at its own call site.
     */
    const renderAt = (
      clipTime: number,
      f: AudioFeatures,
      params: ParamValues,
      transition: TransitionState | undefined,
      options: RenderOptions,
    ): void => renderer.render(f, clipTime + timeOrigin, params, transition, options);
    const analyzer = new OfflineAnalyzer(
      pcm,
      job.fps,
      96,
      job.sync,
      job.beatGrid ?? null,
      job.sections ?? null,
      vocalSpans,
      timeOrigin,
    );
    // Analyzer construction mixes the whole track down to mono and primes the
    // pipeline — seconds each on a long track, silently (AX-3).
    hooks.onHeartbeat?.();
    // Feedback state has its own canonical 60 Hz analysis walk. Output fps is
    // presentation cadence only: 24/30 fps exports consume multiple state
    // ticks before a frame, while 90/120/144 fps insert presentation-only
    // frames between ticks. Separate analyser is required because a low-fps
    // frame latches multiple onset ticks into one feature object; replaying
    // that aggregate for history would stamp hits at wrong times.
    //
    // Gated on whether feedback can render at all (AX-2): the walk's only
    // consumer is the advance-only render below, which fires solely for
    // presets that call feedbackSample() — yet the analyzer (a second
    // full-track mono mixdown, ~1.4 GB on a 2 h track) and its 60 Hz DSP walk
    // used to run unconditionally, doubling every export's analysis cost. The
    // presets a job can ever render are the base preset plus the timeline
    // scenes' presets (resolveActiveFrame draws from nothing else, and
    // prevScene is always one of the scenes), so scanning those with the same
    // presetUsesFeedback + presetById the walk itself uses is exact. When
    // none uses feedback, skipping analyzer, clock and walk is
    // output-identical by construction: the walk's setPreset/setBackground/
    // video-frame uploads are all re-issued at frame time below, and its
    // render call never ran.
    const anyPresetUsesFeedback =
      presetUsesFeedback(presetById(frameInput.basePresetId)) ||
      (frameInput.timeline.enabled &&
        frameInput.timeline.scenes.some((s) => presetUsesFeedback(presetById(s.presetId))));
    const feedbackAnalyzer = anyPresetUsesFeedback
      ? new OfflineAnalyzer(
          pcm,
          60,
          96,
          job.sync,
          job.beatGrid ?? null,
          job.sections ?? null,
          vocalSpans,
          // Same clip origin as the presented walk: this walk's features feed
          // applyMods too (below), so an unstamped one would resolve a
          // different LFO phase for the feedback history than for the pixels.
          timeOrigin,
        )
      : null;
    const feedbackClock = anyPresetUsesFeedback ? new FixedFeedbackClock() : null;
    // The 60 Hz feedback tick walk gets its OWN lag memory: it is a separate
    // sequential walk (its own analyzer, its own cadence), and sharing state
    // with the presented walk would make presented-frame smoothing depend on
    // whether a feedback preset happens to be in the job.
    const feedbackModEval = anyPresetUsesFeedback ? createModEvalState() : undefined;
    // Setup is complete; the frame loop's own progress messages take over —
    // and the E4a pulse below guarantees they are never the only liveness
    // signal (see livenessPulseMs). Worker timers do not get the hidden-tab
    // throttling that bans timers from the frame loop's YIELD strategy: this
    // interval only has to beat once per 30 s window, not pace frames.
    hooks.onHeartbeat?.();
    if (hooks.onHeartbeat) {
      const pulse = setInterval(hooks.onHeartbeat, hooks.livenessPulseMs ?? 5000);
      stopLivenessPulse = () => clearInterval(pulse);
    }
    const total = analyzer.frameCount;
    // Loop mode: keep the first K rendered frames; blend them into the last K
    const xfadeFrames = job.loopCrossfadeSec
      ? Math.min(Math.round(job.loopCrossfadeSec * job.fps), Math.floor(total / 2))
      : 0;
    const blendCanvas = xfadeFrames > 0 ? new OffscreenCanvas(job.width, job.height) : null;
    const blendCtx = blendCanvas?.getContext("2d") ?? null;

    for (let n = 0; n < total; n++) {
      abort();
      if (deviceLost) throw deviceLost;
      // E4b test seam — see ExportCoreHooks.onPhaseSample. Gated on the hook
      // existing so an ordinary export (no listener) never calls performance.now()
      // here at all.
      const phaseSample = hooks.onPhaseSample;
      const tFrameStart = phaseSample ? performance.now() : 0;

      const t = n / job.fps;
      // Advance texture-feedback state independently from output cadence.
      // These calls never touch swapchain/post/encoder; renderer returns
      // immediately for presets that do not use feedback. Skipped entirely
      // when no preset in the job uses feedback (AX-2, gate above).
      if (feedbackAnalyzer && feedbackClock) {
        for (const tickTime of feedbackClock.drainThrough(t)) {
          const tickFeatures = feedbackAnalyzer.nextFrameFeatures();
          const tickFrame = resolveActiveFrame(frameInput, tickTime);
          const tickPreset = presetById(tickFrame.presetId);
          if (tickFrame.presetId !== currentPresetId) {
            renderer.setPreset(tickPreset);
            currentPresetId = tickFrame.presetId;
          }
          const tickVideoFailed = tickFrame.bg.mode === BG_VIDEO && !videoBg;
          renderer.setBackground(
            (bgImageFailed && tickFrame.bg.mode === BG_IMAGE) || tickVideoFailed
              ? { ...tickFrame.bg, mode: 0 }
              : tickFrame.bg,
          );
          if (videoBg && tickFrame.bg.mode === BG_VIDEO) {
            const vi = videoBgFrameIndex(
              videoBg.frames.length,
              videoBg.fps,
              tickTime + (job.bgVideo?.timeOffset ?? 0),
            );
            renderer.updateBackgroundVideoFrame(videoBg.frames[vi]);
          }
          if (presetUsesFeedback(tickPreset)) {
            const tickStems = job.stems ? stemValuesAt(job.stems, tickTime) : undefined;
            const tickParams = applyMods(
              tickPreset,
              tickFrame.params,
              tickFrame.mods,
              tickFeatures,
              tickStems,
              feedbackModEval,
            );
            // Same chokepoint as the presented frames below — inert today
            // (no builder layer type samples feedback), correct the day one
            // does.
            if (builderStack && tickFrame.presetId === BUILDER2_ID) {
              const packed = packBuilderFrame(builderStack, tickParams);
              if (!lastBuilderPack || !sameF32(packed, lastBuilderPack)) {
                renderer.setBuilderParams(packed);
                lastBuilderPack = packed;
              }
            }
            renderAt(tickTime, tickFeatures, tickParams, undefined, {
              feedback: "advance-only",
            });
          }
        }
      }

      const features = analyzer.nextFrameFeatures();
      const rf = resolveActiveFrame(frameInput, t);
      if (rf.presetId !== currentPresetId) {
        renderer.setPreset(presetById(rf.presetId));
        currentPresetId = rf.presetId;
      }
      // A failed background-image bake degrades to the preset background for
      // EVERY frame — resolveActiveFrame keeps handing back image mode, and
      // re-applying it verbatim would undo the degrade into black frames.
      const videoModeFailed = rf.bg.mode === BG_VIDEO && !videoBg;
      renderer.setBackground(
        (bgImageFailed && rf.bg.mode === BG_IMAGE) || videoModeFailed
          ? { ...rf.bg, mode: 0 }
          : rf.bg,
      );
      // Upload the video-bg frame for this export frame's track time — pure
      // index, so it matches the live preview frame-for-frame.
      if (videoBg && rf.bg.mode === BG_VIDEO) {
        const vi = videoBgFrameIndex(
          videoBg.frames.length,
          videoBg.fps,
          t + (job.bgVideo?.timeOffset ?? 0),
        );
        renderer.updateBackgroundVideoFrame(videoBg.frames[vi]);
      }
      // Dynamic overlay (lyrics/audiogram): recompose when the key moves — the
      // SAME pure key + compose functions the live loop uses, fed this frame's
      // t, is what makes the file match the preview.
      if (dynamicOverlay) {
        const key = overlayFrameKeyAt(dynamics, t, job.width);
        if (!sameOverlayFrame(key, lastFrameKey)) {
          lastFrameKey = key;
          renderer.setOverlay(
            await composeOverlayFrame(overlayBase, dynamics, t, job.width, job.height),
          );
        }
      }
      // Lyric plate (Lyric Stage's text input): same discipline, its own key.
      // The lines arrive segment-shifted with everything else, so keying on
      // this frame's clip time resolves the plate the preview shows at the
      // matching track moment. Ungated on the caption toggle — the plate
      // serves the PRESET, and job.lyrics travels whenever lines exist.
      if (job.lyrics) {
        const plateKey = lyricPlateKeyAt(job.lyrics.lines, t, job.width, job.height);
        if (!samePlateKey(plateKey, lastPlateKey)) {
          lastPlateKey = plateKey;
          renderer.setLyricPlate(await composeLyricPlate(job.lyrics.lines, plateKey));
        }
      }
      let transition: { params: ParamValues; mix: number; kind: number } | undefined;
      if (rf.prev) {
        if (fadeFromId !== rf.prev.presetId) {
          renderer.setTransitionPreset(presetById(rf.prev.presetId));
          fadeFromId = rf.prev.presetId;
        }
        transition = { params: rf.prev.params, mix: rf.mix, kind: rf.transitionKind };
      } else if (fadeFromId !== null) {
        renderer.setTransitionPreset(null);
        fadeFromId = null;
      }
      const stemValues = job.stems ? stemValuesAt(job.stems, t) : undefined;
      // Post-targeted routes animate the post chain. Identical rule to the
      // live loop (services.ts) — applyPostMods returns the base object when
      // nothing targets post, so an unmodulated export uploads nothing extra
      // and stays byte-identical to before this feature existed.
      if (job.post) {
        const moddedPost = applyPostMods(job.post, rf.mods, features, stemValues, modEval);
        if (moddedPost !== job.post) renderer.setPost(moddedPost);
        else if (postModulated) renderer.setPost(job.post);
        postModulated = moddedPost !== job.post;
      }
      const frameParams = applyMods(
        presetById(rf.presetId),
        rf.params,
        rf.mods,
        features,
        stemValues,
        modEval,
      );
      // Builder bridge chokepoint (RP-20, determinism law): the SAME
      // packBuilderFrame the live loop uses overlays modulated/automated
      // virtual values onto the stack pack — dirty-checked so an unmodulated
      // export uploads exactly once (the setup upload above). Crossfades
      // share one builderBuf, so a builder2↔builder2 fade with two stacks is
      // unrepresentable; the active frame's pack wins (matches live).
      if (builderStack && rf.presetId === BUILDER2_ID) {
        const packed = packBuilderFrame(builderStack, frameParams);
        if (!lastBuilderPack || !sameF32(packed, lastBuilderPack)) {
          renderer.setBuilderParams(packed);
          lastBuilderPack = packed;
        }
      }
      // isFeedbackTick stays on CLIP time: it classifies whether this
      // presentation lands on the SAME fixed 60 Hz state grid FixedFeedbackClock
      // drains above, and that grid is anchored to the clip's first frame.
      renderAt(t, features, frameParams, transition, {
        feedback: isFeedbackTick(t) ? "present-history" : "present-only",
      });
      // Ensure the GPU finished before snapshotting the canvas
      await renderer.gpuDone();
      // gpuDone() resolves on a lost device instead of rejecting, so without
      // this the snapshot below would quietly capture a black frame.
      if (deviceLost) throw deviceLost;
      // E4b: render phase ends here (submit + GPU completion) — see
      // ExportCoreHooks.onPhaseSample. Reused as the readback phase's start
      // below; a lane with no separate readback (the ordinary MP4/WebM
      // encoder branch) leaves readbackMs at exactly 0 by never advancing it.
      const tRenderDone = phaseSample ? performance.now() : 0;

      let source: OffscreenCanvas = canvas;
      if (xfadeFrames > 0) {
        if (n < xfadeFrames) {
          headFrames.push(await createImageBitmap(canvas));
        }
        const tailIndex = n - (total - xfadeFrames);
        if (tailIndex >= 0 && blendCtx && blendCanvas) {
          // N+1 denominator: the last blended frame must approach frame 0,
          // not BE frame 0 — /N ended at alpha 1.0 and every loop played the
          // seam frame twice.
          const alpha = (tailIndex + 1) / (xfadeFrames + 1);
          // Clear first: the canvas persists across the whole window, and on
          // transparent exports source-over compositing accumulated every
          // prior tail frame into ghost trails.
          blendCtx.clearRect(0, 0, blendCanvas.width, blendCanvas.height);
          blendCtx.globalAlpha = 1;
          blendCtx.drawImage(canvas, 0, 0);
          blendCtx.globalAlpha = alpha;
          blendCtx.drawImage(headFrames[tailIndex], 0, 0);
          source = blendCanvas;
        }
      }

      // E4b: readback phase — advanced only by the two lanes that actually
      // read pixels back off the GPU; see ExportCoreHooks.onPhaseSample.
      let tReadbackDone = tRenderDone;
      if (isDeep) {
        // Deep lane: read the rgba16float tap back as packed u16 — the canvas
        // holds nothing in deep mode (the final pass rendered into the
        // offscreen deep target instead of the swapchain), so `source` is
        // deliberately never touched here.
        const raw = await renderer.readbackDeepFrame(job.deepStraightAlpha === true);
        bytesOut += raw.byteLength;
        tReadbackDone = phaseSample ? performance.now() : 0;
        // Awaited: the deep lane's backpressure (see onRawFrame's docs — at
        // ~16.6 MB per 1080p frame this await matters more than the PNG one).
        await hooks.onRawFrame!(raw);
      } else if (isPng) {
        // PNG sequence: snapshot the canvas straight to a file. Alpha survives
        // when the background is transparent (the context is premultiplied).
        const blob = await source.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        bytesOut += bytes.length;
        tReadbackDone = phaseSample ? performance.now() : 0;
        // Awaited: this is the PNG lane's backpressure (see onFrame's docs).
        await hooks.onFrame?.(bytes, n);
      } else {
        // mediabunny timestamps are seconds (it keeps the exact rational and
        // restores it when muxing, so the container timing is not rounded
        // through microseconds). add() feeds the encoder — for VP9+alpha, both
        // encoders — and awaits their queues plus the writer: that await IS the
        // backpressure, which is why no encodeQueueSize watching survives here.
        const sample = new VideoSample(source, {
          timestamp: n / job.fps,
          duration: 1 / job.fps,
        });
        // finally: the rejection window spans mediabunny's whole encoder queue,
        // so a failure at 4K would otherwise leak a full-resolution frame's
        // GPU allocation.
        try {
          // Stated per frame rather than left to keyFrameInterval, because the
          // fragment boundaries in "stream" mode ride on this cadence exactly.
          // Identical to the interval rule for every fps the app offers.
          await videoSource!.add(sample, { keyFrame: n % (job.fps * 2) === 0 });
        } finally {
          sample.close();
        }
      }
      // E4b: encode phase ends here — the frame sink's backpressure await,
      // whichever lane this job took. See ExportCoreHooks.onPhaseSample.
      const tEncodeDone = phaseSample ? performance.now() : 0;

      // M9: keep the audio lane one chunk ahead of the video timestamp just
      // encoded, so the muxer can interleave instead of buffering a lane.
      await pumpAudioTo(Math.ceil(((n + 1) / job.fps) * sampleRate) + CHUNK);
      // No timer-based yield here: gpuDone() above already yields the event
      // loop every frame (timers are throttled to 1s in hidden tabs and
      // would stall exports; GPU-completion promises are not).
      if (phaseSample) {
        phaseSample({
          n,
          renderMs: tRenderDone - tFrameStart,
          readbackMs: tReadbackDone - tRenderDone,
          encodeMs: tEncodeDone - tReadbackDone,
          wallMs: performance.now() - tFrameStart,
        });
      }
      if (n % 10 === 0) hooks.onProgress?.(n, total);
    }

    // Audio may outlast the last video frame by a fraction of a chunk.
    await pumpAudioTo(pcm.length);
    if (limiter) {
      const r = limiter.report;
      loudnessResult = {
        inputLufs: normInputLufs,
        gainDb: normGainDb,
        peakInDb: r.peakInDb,
        reductionDb: r.reductionDb,
      };
    }

    // Last gate before the file is declared good. finalize() flushes the
    // encoders and rethrows any latched encoder error, so there is nothing
    // else to check here.
    if (deviceLost) throw deviceLost;
    if (output) await output.finalize();
    hooks.onProgress?.(analyzer.frameCount, analyzer.frameCount);

    if (bufferTarget) {
      // finalize() above populated the buffer; null here would be a bug.
      const buffer = bufferTarget.buffer!;
      return {
        buffer,
        bytes: buffer.byteLength,
        seconds: pcm.duration,
        audioCodec,
        loudness: loudnessResult,
      };
    }
    return { bytes: bytesOut, seconds: pcm.duration, audioCodec, loudness: loudnessResult };
  } finally {
    // E4a first: success, abort and failure paths all end the pulse here, so
    // a settled job can never beat again (the no-leak test pins this).
    stopLivenessPulse();
    // Abort/failure path: release mediabunny's encoders and writer — it owns
    // every WebCodecs encoder this file creates, so this IS the encoder
    // cleanup. cancel() throws if the output already finalized — the success
    // path — so gate it.
    try {
      if (output && output.state !== "finalized" && output.state !== "canceled") {
        // cancel() returns a promise; swallow a rejected teardown so it can't
        // surface as an unhandled rejection on the abort/failure path.
        output.cancel().catch(() => {});
      }
    } catch {
      // already torn down
    }
    headFrames.forEach((b) => b.close());
    overlayBase?.close();
    disposeVideoBgFrames(videoBg);
    // Never let teardown throw: this runs on the failure path too, and a
    // dispose() that throws on an already-lost device would replace the real
    // error with a confusing one — and skip the rest of the cleanup.
    try {
      renderer.onDeviceLost = null;
      renderer.dispose();
    } catch {
      // device already gone
    }
  }
}
