import { ArrayBufferTarget, Muxer, StreamTarget } from "mp4-muxer";
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Output,
  StreamTarget as WebmStreamTarget,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
  type StreamTargetChunk,
} from "mediabunny";
import { OfflineAnalyzer } from "../audio/offlineSource";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { PcmData, SyncSettings } from "../audio/types";
import { integratedLufs, normalizationGainDb } from "../audio/dsp/lufs";
import { TruePeakLimiter } from "../audio/dsp/truepeak";
import { WebGPURenderer } from "../render/webgpuRenderer";
import {
  BG_IMAGE,
  BG_VIDEO,
  type BgSettings,
  type MotionSettings,
  type ParamValues,
  type PostSettings,
  type PresetDef,
} from "../render/types";
import { applyMods, type ModRoute } from "../state/modMatrix";
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
import type { LyricLine, LyricStyle } from "../state/lyrics";
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
 * Two output modes:
 *  - "buffer": classic in-memory mux with fastStart (result = one ArrayBuffer)
 *  - "stream": fragmented MP4, chunks handed to onChunk as they are written —
 *    memory stays flat regardless of export length (hour-long mixes).
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
  /** "stream" mode: sequential-position file chunks (fragmented MP4). */
  onChunk?: (data: Uint8Array, position: number) => void;
  /** "png" mode: one encoded PNG per frame, in order (index is 0-based). */
  onFrame?: (data: Uint8Array, index: number) => void;
  signal?: AbortSignal;
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

  // Custom WGSL presets: the worker is a fresh module instance with an empty
  // registry — re-register (re-validated; a job is still untrusted input).
  for (const raw of job.customPresets ?? []) {
    const def = validCustomPreset(raw);
    if (def) registerCustomPreset(def);
  }

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
  let bufferTarget: ArrayBufferTarget | null = null;
  let muxer: Muxer<ArrayBufferTarget | StreamTarget> | null = null;
  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;
  // "vp9a" takes the mediabunny lane: VP9 color + alpha planes dual-encoded
  // (mediabunny splits the frames and syncs the encoders) and muxed into WebM
  // with BlockAdditions — the transparent-video path. The render walk above
  // these encoders is byte-identical to the MP4 path; only the encode/mux
  // stage differs.
  const isWebm = !isPng && (job.codec ?? "h264") === "vp9a";
  let webmOutput: Output | null = null;
  let webmVideo: VideoSampleSource | null = null;
  let webmAudio: AudioSampleSource | null = null;
  let webmBuffer: BufferTarget | null = null;

  // Encoder callbacks run async — capture errors, surface them in the loop.
  // errorWaiters lets a parked backpressure wait bail immediately when an
  // encoder fails (a failed encoder emits no further "dequeue" events, so a
  // plain dequeue-wait would hang forever).
  let encoderError: Error | null = null;
  const errorWaiters = new Set<(e: Error) => void>();
  const onEncoderError = (e: Error) => {
    encoderError = e;
    for (const w of errorWaiters) w(e);
  };
  // Device loss (driver reset / TDR) is silent otherwise: gpuDone() resolves
  // rather than rejects on a lost device, so every subsequent frame renders as
  // black and the export "succeeds" — a valid-looking file with no picture in
  // it. That is worse than failing, so treat it exactly like an encoder error.
  let deviceLost: Error | null = null;

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

    webmVideo = new VideoSampleSource({
      codec: "vp9",
      bitrate: job.bitrate,
      alpha: "keep",
      keyFrameInterval: 2, // seconds — matches the MP4 lane's fps*2 frames
      latencyMode: "quality",
    });
    // Opus only runs at its operating rates; mediabunny resamples the audio
    // lane when the track is e.g. 44.1 kHz. The analyzer keeps reading the
    // untouched pcm, so the visuals are unaffected.
    webmAudio = new AudioSampleSource({
      codec: "opus",
      bitrate: 192_000,
      ...(OPUS_RATES.has(sampleRate) ? {} : { transform: { sampleRate: 48000 } }),
    });
    webmBuffer = job.mode === "buffer" ? new BufferTarget() : null;
    webmOutput = new Output({
      format: new WebMOutputFormat(),
      // Stream mode uses POSITIONED writes: the WebM muxer seeks back to patch
      // sizes/cues/duration (unlike fragmented MP4's forward-only stream), and
      // the desktop file writer supports seeks. appendOnly would avoid the
      // seeks but ships a file with no duration or cues — strictly worse.
      target:
        webmBuffer ??
        new WebmStreamTarget(
          new WritableStream<StreamTargetChunk>({
            write: (chunk) => {
              // Copy: the chunk goes to an async writer chain that outlives
              // this callback, and the muxer may reuse its buffer.
              const copy = chunk.data.slice();
              bytesOut = Math.max(bytesOut, chunk.position + copy.length);
              hooks.onChunk?.(copy, chunk.position);
            },
          }),
          { chunked: true },
        ),
    });
    webmOutput.addVideoTrack(webmVideo, { frameRate: job.fps });
    webmOutput.addAudioTrack(webmAudio);
    await webmOutput.start();
  } else if (!isPng) {
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

    bufferTarget = job.mode === "buffer" ? new ArrayBufferTarget() : null;
    muxer = new Muxer({
      target:
        bufferTarget ??
        new StreamTarget({
          chunked: true, // batch tiny writes into ~16 MB chunks
          onData: (data, position) => {
            bytesOut = Math.max(bytesOut, position + data.length);
            hooks.onChunk?.(data, position);
          },
        }),
      video: { codec: MUXER_CODEC[codec], width: job.width, height: job.height },
      audio: { codec: audioCodec, sampleRate, numberOfChannels: channels },
      // Streaming writes fragmented MP4: strictly forward, memory stays flat.
      fastStart: bufferTarget ? "in-memory" : "fragmented",
    });

    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer!.addVideoChunk(chunk, meta),
      error: onEncoderError,
    });
    videoEncoder.configure(videoConfig);
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer!.addAudioChunk(chunk, meta),
      error: onEncoderError,
    });
    audioEncoder.configure(audioCodec === "aac" ? aacConfig : opusConfig);
  }

  // Backpressure wait that cannot deadlock: settles on drain, encoder error,
  // or user abort — whichever comes first — and always removes its listeners.
  const QUEUE_MAX = 8;
  const waitForDrain = (encoder: VideoEncoder | AudioEncoder): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (encoderError) return reject(encoderError);
      if (hooks.signal?.aborted) return reject(new DOMException("Export cancelled", "AbortError"));
      const finish = (fn: () => void) => {
        encoder.removeEventListener("dequeue", onDequeue);
        hooks.signal?.removeEventListener("abort", onAbort);
        errorWaiters.delete(onErr);
        fn();
      };
      const onDequeue = () => {
        if (encoder.encodeQueueSize <= QUEUE_MAX) finish(resolve);
      };
      const onAbort = () =>
        finish(() => reject(new DOMException("Export cancelled", "AbortError")));
      const onErr = (e: Error) => finish(() => reject(e));
      encoder.addEventListener("dequeue", onDequeue);
      hooks.signal?.addEventListener("abort", onAbort, { once: true });
      errorWaiters.add(onErr);
    });

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
    for (const w of errorWaiters) w(err);
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
  try {
    renderer.setPreset(presetById(job.presetId));
    renderer.setBackground(job.bg);
    if (!dynamicOverlay) renderer.setOverlay(job.overlay ?? null);
    renderer.setSmoothSpectrum(job.smoothSpectrum === true);
    if (job.post) renderer.setPost(job.post);
    if (job.motion) renderer.setMotion(job.motion);
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
    if ((audioEncoder || webmAudio) && job.loudness) {
      normInputLufs = integratedLufs(pcm.channels.slice(0, channels), sampleRate);
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
    for (let pos = 0; (audioEncoder || webmAudio) && pos < pcm.length; pos += CHUNK) {
      abort();
      // A dead audio encoder otherwise only surfaces as a cryptic
      // InvalidStateError from the next encode() call — throw the real cause.
      if (encoderError) throw encoderError;
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
      if (webmAudio) {
        // add() awaits the internal encode queue — backpressure built in.
        // Closing the sample closes the wrapped AudioData.
        const sample = new AudioSample(data);
        await webmAudio.add(sample);
        sample.close();
      } else {
        audioEncoder!.encode(data);
        data.close();
        // Backpressure the audio lane too: without it the whole track is
        // queued synchronously ahead of the first video frame, and peak memory
        // scales with track length — the opposite of the flat-memory
        // guarantee.
        if (audioEncoder!.encodeQueueSize > QUEUE_MAX) await waitForDrain(audioEncoder!);
      }
    }
    if (limiter) {
      const r = limiter.report;
      loudnessResult = {
        inputLufs: normInputLufs,
        gainDb: normGainDb,
        peakInDb: r.peakInDb,
        reductionDb: r.reductionDb,
      };
    }

    // --- Video lane: deterministic frame walk. Per-frame preset/params/mods/
    // background come from resolveActiveFrame — the SAME pure function the live
    // loop uses, which is what guarantees this file matches the preview.
    let currentPresetId = job.presetId;
    let fadeFromId: string | null = null;
    const frameInput = {
      timeline: job.timeline ?? { enabled: false as const, scenes: [], lanes: [] },
      basePresetId: job.presetId,
      baseParams: job.params,
      baseMods: job.mods ?? [],
      baseBg: job.bg,
      paramsByPreset: job.paramsByPreset ?? {},
      modsByPreset: job.modsByPreset ?? {},
    };
    const analyzer = new OfflineAnalyzer(pcm, job.fps, 96, job.sync, job.beatGrid ?? null);
    const total = analyzer.frameCount;
    // Loop mode: keep the first K rendered frames; blend them into the last K
    const xfadeFrames = job.loopCrossfadeSec
      ? Math.min(Math.round(job.loopCrossfadeSec * job.fps), Math.floor(total / 2))
      : 0;
    const blendCanvas = xfadeFrames > 0 ? new OffscreenCanvas(job.width, job.height) : null;
    const blendCtx = blendCanvas?.getContext("2d") ?? null;

    for (let n = 0; n < total; n++) {
      abort();
      if (encoderError) throw encoderError;
      if (deviceLost) throw deviceLost;

      const features = analyzer.nextFrameFeatures();
      const t = n / job.fps;
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
      renderer.render(
        features,
        t,
        applyMods(
          presetById(rf.presetId),
          rf.params,
          rf.mods,
          features,
          job.stems ? stemValuesAt(job.stems, t) : undefined,
        ),
        transition,
      );
      // Ensure the GPU finished before snapshotting the canvas
      await renderer.gpuDone();
      // gpuDone() resolves on a lost device instead of rejecting, so without
      // this the snapshot below would quietly capture a black frame.
      if (deviceLost) throw deviceLost;

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

      if (isPng) {
        // PNG sequence: snapshot the canvas straight to a file. Alpha survives
        // when the background is transparent (the context is premultiplied).
        const blob = await source.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        bytesOut += bytes.length;
        hooks.onFrame?.(bytes, n);
      } else if (webmVideo) {
        // mediabunny timestamps are seconds. add() splits the frame into
        // color+alpha, feeds both encoders, and awaits their queues —
        // backpressure built in.
        const sample = new VideoSample(source, {
          timestamp: n / job.fps,
          duration: 1 / job.fps,
        });
        await webmVideo.add(sample);
        sample.close();
      } else {
        const frame = new VideoFrame(source, {
          timestamp: Math.round((n * 1e6) / job.fps),
          duration: Math.round(1e6 / job.fps),
        });
        videoEncoder!.encode(frame, { keyFrame: n % (job.fps * 2) === 0 });
        frame.close();
      }

      // Backpressure: don't let the encode queue grow unbounded
      if (videoEncoder && videoEncoder.encodeQueueSize > QUEUE_MAX) {
        await waitForDrain(videoEncoder);
      }
      // No timer-based yield here: gpuDone() above already yields the event
      // loop every frame (timers are throttled to 1s in hidden tabs and
      // would stall exports; GPU-completion promises are not).
      if (n % 10 === 0) hooks.onProgress?.(n, total);
    }

    if (videoEncoder) await videoEncoder.flush();
    if (audioEncoder) await audioEncoder.flush();
    if (encoderError) throw encoderError;
    // Last gate before the file is declared good.
    if (deviceLost) throw deviceLost;
    muxer?.finalize();
    if (webmOutput) await webmOutput.finalize();
    hooks.onProgress?.(analyzer.frameCount, analyzer.frameCount);

    if (bufferTarget) {
      return {
        buffer: bufferTarget.buffer,
        bytes: bufferTarget.buffer.byteLength,
        seconds: pcm.duration,
        audioCodec,
        loudness: loudnessResult,
      };
    }
    if (webmBuffer) {
      // finalize() above populated the buffer; null here would be a bug.
      const buffer = webmBuffer.buffer!;
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
    try {
      if (videoEncoder && videoEncoder.state !== "closed") videoEncoder.close();
      if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close();
    } catch {
      // already closed
    }
    // Abort/failure path: release mediabunny's encoders and writer. cancel()
    // throws if the output already finalized — the success path — so gate it.
    try {
      if (webmOutput && webmOutput.state !== "finalized" && webmOutput.state !== "canceled") {
        // cancel() returns a promise; swallow a rejected teardown so it can't
        // surface as an unhandled rejection on the abort/failure path.
        webmOutput.cancel().catch(() => {});
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
