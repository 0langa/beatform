import { ArrayBufferTarget, Muxer, StreamTarget } from "mp4-muxer";
import { OfflineAnalyzer } from "../audio/offlineSource";
import type { PcmData, SyncSettings } from "../audio/types";
import { WebGPURenderer } from "../render/webgpuRenderer";
import type { BgSettings, ParamValues } from "../render/types";
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
  mode: "buffer" | "stream";
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

  let bytesOut = 0;
  const bufferTarget = job.mode === "buffer" ? new ArrayBufferTarget() : null;
  const muxer = new Muxer({
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

  // Encoder callbacks run async — capture errors, surface them in the loop
  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  videoEncoder.configure(videoConfig);
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  audioEncoder.configure(audioCodec === "aac" ? aacConfig : opusConfig);

  const canvas = new OffscreenCanvas(job.width, job.height);
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
    renderer.resize(job.width, job.height, 1);

    // --- Audio lane: feed the whole buffer in planar chunks
    const CHUNK = 16384;
    const planar = new Float32Array(CHUNK * channels);
    for (let pos = 0; pos < pcm.length; pos += CHUNK) {
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
    }

    // --- Video lane: deterministic frame walk
    const analyzer = new OfflineAnalyzer(pcm, job.fps, 96, job.sync);
    const total = analyzer.frameCount;
    for (let n = 0; n < total; n++) {
      abort();
      if (encoderError) throw encoderError;

      const features = analyzer.nextFrameFeatures();
      renderer.render(features, n / job.fps, job.params);
      // Ensure the GPU finished before snapshotting the canvas
      await renderer.gpuDone();

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((n * 1e6) / job.fps),
        duration: Math.round(1e6 / job.fps),
      });
      videoEncoder.encode(frame, { keyFrame: n % (job.fps * 2) === 0 });
      frame.close();

      // Backpressure: don't let the encode queue grow unbounded
      if (videoEncoder.encodeQueueSize > 8) {
        await new Promise<void>((r) =>
          videoEncoder.addEventListener("dequeue", () => r(), { once: true }),
        );
      }
      // No timer-based yield here: gpuDone() above already yields the event
      // loop every frame (timers are throttled to 1s in hidden tabs and
      // would stall exports; GPU-completion promises are not).
      if (n % 10 === 0) hooks.onProgress?.(n, total);
    }

    await videoEncoder.flush();
    await audioEncoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
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
      if (videoEncoder.state !== "closed") videoEncoder.close();
      if (audioEncoder.state !== "closed") audioEncoder.close();
    } catch {
      // already closed
    }
    renderer.dispose();
  }
}
