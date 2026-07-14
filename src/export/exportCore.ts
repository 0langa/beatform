import { ArrayBufferTarget, Muxer, StreamTarget } from "mp4-muxer";
import { OfflineAnalyzer } from "../audio/offlineSource";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { PcmData, SyncSettings } from "../audio/types";
import { WebGPURenderer } from "../render/webgpuRenderer";
import type { BgSettings, MotionSettings, ParamValues, PostSettings } from "../render/types";
import { applyMods, type ModRoute } from "../state/modMatrix";
import type { Timeline } from "../state/timeline";
import { resolveActiveFrame } from "../state/frameResolve";
import { presetById } from "../render/presets";

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
}

export interface ExportCoreResult {
  /** Present in "buffer" mode only. */
  buffer?: ArrayBuffer;
  bytes: number;
  seconds: number;
  audioCodec: "aac" | "opus";
}

export interface ExportCoreHooks {
  onProgress?: (framesDone: number, framesTotal: number) => void;
  /** "stream" mode: sequential-position file chunks (fragmented MP4). */
  onChunk?: (data: Uint8Array, position: number) => void;
  /** "png" mode: one encoded PNG per frame, in order (index is 0-based). */
  onFrame?: (data: Uint8Array, index: number) => void;
  signal?: AbortSignal;
}

function h264Codec(width: number, height: number, fps: number): string {
  // High profile; level by throughput (macroblocks/s approximated by pixels*fps)
  const px = width * height * fps;
  if (px > 260_000_000) return "avc1.640034"; // L5.2 (4K60)
  if (px > 130_000_000) return "avc1.640033"; // L5.1 (4K30 / 1440p60)
  return "avc1.64002A"; // L4.2 (up to 1080p60)
}

export async function runExportJob(
  job: ExportJob,
  hooks: ExportCoreHooks = {},
): Promise<ExportCoreResult> {
  const abort = () => {
    if (hooks.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };
  abort();

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

  if (!isPng) {
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

    const videoConfig: VideoEncoderConfig = {
      codec: h264Codec(job.width, job.height, job.fps),
      width: job.width,
      height: job.height,
      bitrate: job.bitrate,
      framerate: job.fps,
      latencyMode: "quality",
      avc: { format: "avc" },
    };
    const vSupport = await VideoEncoder.isConfigSupported(videoConfig);
    if (!vSupport.supported) {
      throw new Error(`H.264 encode not supported for ${job.width}x${job.height}@${job.fps}`);
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
      video: { codec: "avc", width: job.width, height: job.height },
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
  } catch {
    throw new Error("Export requires WebGPU, which is unavailable on this system");
  }

  try {
    renderer.setPreset(presetById(job.presetId));
    renderer.setBackground(job.bg);
    renderer.setOverlay(job.overlay ?? null);
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
    renderer.resize(job.width, job.height, 1);

    // Loop mode: crossfade the tail into the head so sample/frame N-1
    // lands back exactly where sample/frame 0 started.
    const xfadeSamples = job.loopCrossfadeSec
      ? Math.min(Math.floor(job.loopCrossfadeSec * sampleRate), Math.floor(pcm.length / 2))
      : 0;
    if (xfadeSamples > 0) {
      for (const data of pcm.channels.slice(0, channels)) {
        const start = pcm.length - xfadeSamples;
        for (let i = 0; i < xfadeSamples; i++) {
          const a = (i + 1) / xfadeSamples;
          data[start + i] = data[start + i] * (1 - a) + data[i] * a;
        }
      }
    }

    // --- Audio lane: feed the whole buffer in planar chunks (MP4 only — a PNG
    // sequence carries no audio; the user keeps the original track).
    const CHUNK = 16384;
    const planar = new Float32Array(CHUNK * channels);
    for (let pos = 0; audioEncoder && pos < pcm.length; pos += CHUNK) {
      abort();
      const frames = Math.min(CHUNK, pcm.length - pos);
      for (let ch = 0; ch < channels; ch++) {
        planar.set(pcm.channels[ch].subarray(pos, pos + frames), ch * frames);
      }
      const data = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: channels,
        timestamp: Math.round((pos * 1e6) / sampleRate),
        data: planar.subarray(0, frames * channels),
      });
      audioEncoder.encode(data);
      data.close();
      // Backpressure the audio lane too: without it the whole track is queued
      // synchronously ahead of the first video frame, and peak memory scales
      // with track length — the opposite of the flat-memory guarantee.
      if (audioEncoder.encodeQueueSize > QUEUE_MAX) await waitForDrain(audioEncoder);
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

      const features = analyzer.nextFrameFeatures();
      const t = n / job.fps;
      const rf = resolveActiveFrame(frameInput, t);
      if (rf.presetId !== currentPresetId) {
        renderer.setPreset(presetById(rf.presetId));
        currentPresetId = rf.presetId;
      }
      renderer.setBackground(rf.bg);
      let transition: { params: ParamValues; mix: number } | undefined;
      if (rf.prev) {
        if (fadeFromId !== rf.prev.presetId) {
          renderer.setTransitionPreset(presetById(rf.prev.presetId));
          fadeFromId = rf.prev.presetId;
        }
        transition = { params: rf.prev.params, mix: rf.mix };
      } else if (fadeFromId !== null) {
        renderer.setTransitionPreset(null);
        fadeFromId = null;
      }
      renderer.render(
        features,
        t,
        applyMods(presetById(rf.presetId), rf.params, rf.mods, features),
        transition,
      );
      // Ensure the GPU finished before snapshotting the canvas
      await renderer.gpuDone();

      let source: OffscreenCanvas = canvas;
      if (xfadeFrames > 0) {
        if (n < xfadeFrames) {
          headFrames.push(await createImageBitmap(canvas));
        }
        const tailIndex = n - (total - xfadeFrames);
        if (tailIndex >= 0 && blendCtx && blendCanvas) {
          const alpha = (tailIndex + 1) / xfadeFrames;
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
    muxer?.finalize();
    hooks.onProgress?.(analyzer.frameCount, analyzer.frameCount);

    if (bufferTarget) {
      return {
        buffer: bufferTarget.buffer,
        bytes: bufferTarget.buffer.byteLength,
        seconds: pcm.duration,
        audioCodec,
      };
    }
    return { bytes: bytesOut, seconds: pcm.duration, audioCodec };
  } finally {
    try {
      if (videoEncoder && videoEncoder.state !== "closed") videoEncoder.close();
      if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close();
    } catch {
      // already closed
    }
    headFrames.forEach((b) => b.close());
    renderer.dispose();
  }
}
