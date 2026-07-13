import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { OfflineAnalyzer } from "../audio/offlineSource";
import type { SyncSettings } from "../audio/types";
import { WebGPURenderer } from "../render/webgpuRenderer";
import type { BgSettings, ParamValues, PresetDef } from "../render/types";

/**
 * Offline MP4 export — the design in docs/EXPORT-DESIGN.md, realized.
 *
 * Sync is exact by construction: video frame N is rendered from features at
 * t = N/fps of the decoded buffer, and audio timestamps are sample counts
 * over the same buffer. No wall clock anywhere; drift cannot exist.
 *
 * H.264 + AAC (Opus fallback) in MP4 via WebCodecs; hardware encode where
 * available. Renders faster than realtime on GPU presets.
 */
export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  /** Video bitrate, bits/second */
  bitrate: number;
  preset: PresetDef;
  params: ParamValues;
  bg: BgSettings;
  /** Sync-source selection — same values as the live view for WYSIWYG */
  sync?: SyncSettings;
  onProgress?: (framesDone: number, framesTotal: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  seconds: number;
  audioCodec: "aac" | "opus";
}

function h264Codec(width: number, height: number, fps: number): string {
  // High profile; level by throughput (macroblocks/s approximated by pixels*fps)
  const px = width * height * fps;
  if (px > 260_000_000) return "avc1.640034"; // L5.2 (4K60)
  if (px > 130_000_000) return "avc1.640033"; // L5.1 (4K30 / 1440p60)
  return "avc1.64002A"; // L4.2 (up to 1080p60)
}

export async function exportVideo(
  audio: AudioBuffer,
  o: ExportOptions,
): Promise<ExportResult> {
  const abort = () => {
    if (o.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };
  abort();

  const channels = Math.min(2, audio.numberOfChannels) as 1 | 2;
  const sampleRate = audio.sampleRate;

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
    codec: h264Codec(o.width, o.height, o.fps),
    width: o.width,
    height: o.height,
    bitrate: o.bitrate,
    framerate: o.fps,
    latencyMode: "quality",
    avc: { format: "avc" },
  };
  const vSupport = await VideoEncoder.isConfigSupported(videoConfig);
  if (!vSupport.supported) {
    throw new Error(`H.264 encode not supported for ${o.width}x${o.height}@${o.fps}`);
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: o.width, height: o.height },
    audio: { codec: audioCodec, sampleRate, numberOfChannels: channels },
    fastStart: "in-memory",
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

  const canvas = new OffscreenCanvas(o.width, o.height);
  let renderer: WebGPURenderer;
  try {
    renderer = await WebGPURenderer.create(canvas);
  } catch {
    throw new Error("Export requires WebGPU, which is unavailable on this system");
  }

  try {
    renderer.setPreset(o.preset);
    renderer.setBackground(o.bg);
    renderer.resize(o.width, o.height, 1);

    // --- Audio lane: feed the whole buffer in planar chunks
    const CHUNK = 16384;
    const planar = new Float32Array(CHUNK * channels);
    for (let pos = 0; pos < audio.length; pos += CHUNK) {
      abort();
      const frames = Math.min(CHUNK, audio.length - pos);
      for (let ch = 0; ch < channels; ch++) {
        planar.set(audio.getChannelData(ch).subarray(pos, pos + frames), ch * frames);
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
    const analyzer = new OfflineAnalyzer(audio, o.fps, 96, o.sync);
    const total = analyzer.frameCount;
    for (let n = 0; n < total; n++) {
      abort();
      if (encoderError) throw encoderError;

      const features = analyzer.nextFrameFeatures();
      renderer.render(features, n / o.fps, o.params);
      // Ensure the GPU finished before snapshotting the canvas
      await renderer.gpuDone();

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((n * 1e6) / o.fps),
        duration: Math.round(1e6 / o.fps),
      });
      videoEncoder.encode(frame, { keyFrame: n % (o.fps * 2) === 0 });
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
      if (n % 10 === 0) o.onProgress?.(n, total);
    }

    await videoEncoder.flush();
    await audioEncoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    o.onProgress?.(total, total);

    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    return { blob, seconds: audio.duration, audioCodec };
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

/** Trigger a browser download for an export result. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
