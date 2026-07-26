/**
 * Video codec capability probe + codec-string builder.
 *
 * The app encodes through WebCodecs, so codec availability is whatever the
 * user's hardware/OS exposes — H.264 is effectively universal, HEVC and AV1
 * depend on the GPU and its drivers. The export UI only offers what this
 * probe confirms; the per-job isConfigSupported check in exportCore stays as
 * the authoritative gate (the probe runs at 1080p60, a 4K60 job re-checks at
 * its real dimensions).
 */

export type VideoCodecId = "h264" | "hevc" | "av1" | "vp9a";

/** The codecs that mux into MP4. "vp9a" is the odd one out: it encodes VP9
 * with an alpha plane and muxes into WebM instead — the only browser-encodable
 * path to a transparent *video* (PNG sequences and ProRes 4444 cover the
 * editorial hand-off; this covers OBS/web overlays). */
export type Mp4CodecId = Exclude<VideoCodecId, "vp9a">;

export const CODEC_LABELS: Record<VideoCodecId, string> = {
  h264: "H.264 — plays everywhere",
  hevc: "HEVC — smaller files, Apple-friendly",
  av1: "AV1 — smallest files, newest players",
  vp9a: "VP9 + alpha — transparent WebM overlay",
};

/** Muxer track codec ids — mediabunny's `VideoCodec` vocabulary, which names
 * H.264 "avc". The union is spelled out rather than imported so this module
 * stays a pure capability table with no dependency on the mux library. */
export const MUXER_CODEC: Record<Mp4CodecId, "avc" | "hevc" | "av1"> = {
  h264: "avc",
  hevc: "hevc",
  av1: "av1",
};

/**
 * Codec string with the level picked by throughput (pixels/second), mirroring
 * the original h264Codec() level ladder.
 */
export function codecString(
  codec: VideoCodecId,
  width: number,
  height: number,
  fps: number,
): string {
  const px = width * height * fps;
  switch (codec) {
    case "hevc":
      // Main profile, main tier; levels 4.1 / 5.0 / 5.1
      if (px > 260_000_000) return "hvc1.1.6.L153.B0";
      if (px > 130_000_000) return "hvc1.1.6.L150.B0";
      return "hvc1.1.6.L123.B0";
    case "av1":
      // Main profile, main tier, 8-bit; levels 4.0 / 5.0 / 5.1
      if (px > 260_000_000) return "av01.0.13M.08";
      if (px > 130_000_000) return "av01.0.12M.08";
      return "av01.0.08M.08";
    case "vp9a":
      // Profile 0, 8-bit; levels 4.1 / 5.0 / 5.1 (alpha rides as side data —
      // the codec string describes the color stream)
      if (px > 260_000_000) return "vp09.00.51.08";
      if (px > 130_000_000) return "vp09.00.50.08";
      return "vp09.00.41.08";
    default:
      // H.264 High profile; levels 4.2 / 5.1 / 5.2
      if (px > 260_000_000) return "avc1.640034";
      if (px > 130_000_000) return "avc1.640033";
      return "avc1.64002A";
  }
}

/** Per-codec extras a VideoEncoderConfig needs (bitstream format selection).
 * The hevc key is not in TS's DOM types yet — the spread keeps tsc happy
 * while passing it through to the browser, which does read it. */
export function codecConfigExtras(codec: VideoCodecId): Record<string, unknown> {
  if (codec === "h264") return { avc: { format: "avc" } };
  if (codec === "hevc") return { hevc: { format: "hevc" } };
  return {};
}

export interface CodecSupport {
  h264: boolean;
  hevc: boolean;
  av1: boolean;
  vp9a: boolean;
}

let probePromise: Promise<CodecSupport> | null = null;

/** Probe once per session (results cannot change under a running process). */
export function probeCodecs(): Promise<CodecSupport> {
  probePromise ??= (async () => {
    const test = async (codec: VideoCodecId): Promise<boolean> => {
      try {
        const cfg = {
          codec: codecString(codec, 1920, 1080, 60),
          width: 1920,
          height: 1080,
          bitrate: 12_000_000,
          framerate: 60,
          ...codecConfigExtras(codec),
        } as VideoEncoderConfig;
        return (await VideoEncoder.isConfigSupported(cfg)).supported === true;
      } catch {
        return false;
      }
    };
    const [h264, hevc, av1, vp9a] = await Promise.all([
      test("h264"),
      test("hevc"),
      test("av1"),
      test("vp9a"),
    ]);
    return { h264, hevc, av1, vp9a };
  })();
  return probePromise;
}
