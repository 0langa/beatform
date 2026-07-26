import { describe, expect, it } from "vitest";
import { codecConfigExtras, codecString, MUXER_CODEC } from "./codecProbe";

describe("codecString", () => {
  it("picks H.264 levels by throughput", () => {
    expect(codecString("h264", 1920, 1080, 60)).toBe("avc1.64002A"); // 4.2
    expect(codecString("h264", 2560, 1440, 60)).toBe("avc1.640033"); // 5.1
    expect(codecString("h264", 3840, 2160, 30)).toBe("avc1.640033"); // 5.1
    expect(codecString("h264", 3840, 2160, 60)).toBe("avc1.640034"); // 5.2
  });

  it("picks HEVC levels by throughput", () => {
    expect(codecString("hevc", 1920, 1080, 60)).toBe("hvc1.1.6.L123.B0");
    expect(codecString("hevc", 3840, 2160, 30)).toBe("hvc1.1.6.L150.B0");
    expect(codecString("hevc", 3840, 2160, 60)).toBe("hvc1.1.6.L153.B0");
  });

  it("picks AV1 levels by throughput", () => {
    expect(codecString("av1", 1920, 1080, 60)).toBe("av01.0.08M.08");
    expect(codecString("av1", 3840, 2160, 30)).toBe("av01.0.12M.08");
    expect(codecString("av1", 3840, 2160, 60)).toBe("av01.0.13M.08");
  });

  it("picks VP9 levels by throughput (vp9a probes the color stream)", () => {
    expect(codecString("vp9a", 1920, 1080, 60)).toBe("vp09.00.41.08");
    expect(codecString("vp9a", 3840, 2160, 30)).toBe("vp09.00.50.08");
    expect(codecString("vp9a", 3840, 2160, 60)).toBe("vp09.00.51.08");
  });
});

describe("codec plumbing tables", () => {
  it("maps every MP4 codec to a muxer track codec (vp9a is WebM-only)", () => {
    expect(MUXER_CODEC).toEqual({ h264: "avc", hevc: "hevc", av1: "av1" });
    expect("vp9a" in MUXER_CODEC).toBe(false);
  });

  it("selects the MP4 (non-annexb) bitstream format for h264/hevc", () => {
    expect(codecConfigExtras("h264")).toEqual({ avc: { format: "avc" } });
    expect(codecConfigExtras("hevc")).toEqual({ hevc: { format: "hevc" } });
    expect(codecConfigExtras("av1")).toEqual({});
    expect(codecConfigExtras("vp9a")).toEqual({});
  });
});
