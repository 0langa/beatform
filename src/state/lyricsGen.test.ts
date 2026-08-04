import { describe, expect, it } from "vitest";
import {
  estimateGenerateSeconds,
  formatBytes,
  formatEstimate,
  formatEta,
  missingModels,
  overallProgress,
  parseDownloadProgress,
  parseSidecarEvent,
  tierDownloadBytes,
  tierInstalled,
  tierModelIds,
  type LyricsModelsState,
} from "./lyricsGen";

describe("sidecar protocol parsing", () => {
  it("parses real device-run lines verbatim", () => {
    // Captured from the phase-2 device run on ssb-navy-solo.wav (Iris Xe).
    expect(
      parseSidecarEvent(
        '{"type":"progress","stage":"isolate","pct":6.25,"etaSec":325.26896550000004,"rtf":3.7732432077414777}',
      ),
    ).toEqual({
      type: "progress",
      stage: "isolate",
      pct: 6.25,
      etaSec: 325.26896550000004,
      rtf: 3.7732432077414777,
    });
    expect(
      parseSidecarEvent(
        '{"type":"stageDone","stage":"isolate","wallSec":38.3406279,"rtf":0.43516148494249396,"detail":"DirectML"}',
      ),
    ).toEqual({
      type: "stageDone",
      stage: "isolate",
      wallSec: 38.3406279,
      rtf: 0.43516148494249396,
      detail: "DirectML",
    });
    expect(
      parseSidecarEvent(
        '{"type":"result","lrcPath":"ssb.lrc","lines":7,"vocalSec":82.86000000000001,"ep":"dml","language":"en"}',
      ),
    ).toEqual({
      type: "result",
      lrcPath: "ssb.lrc",
      lines: 7,
      vocalSec: 82.86000000000001,
      ep: "dml",
      language: "en",
    });
    expect(parseSidecarEvent('{"type":"progress","stage":"decode"}')).toEqual({
      type: "progress",
      stage: "decode",
      pct: undefined,
      etaSec: undefined,
      rtf: undefined,
    });
    expect(parseSidecarEvent('{"type":"cancelled"}')).toEqual({ type: "cancelled" });
    expect(parseSidecarEvent('{"type":"probe","dml":true}')).toEqual({ type: "probe", dml: true });
    expect(
      parseSidecarEvent(
        '{"type":"error","message":"No vocals found — the track appears to be instrumental"}',
      ),
    ).toEqual({ type: "error", message: "No vocals found — the track appears to be instrumental" });
  });

  it("rejects garbage without throwing", () => {
    expect(parseSidecarEvent("")).toBeNull();
    expect(parseSidecarEvent("not json")).toBeNull();
    expect(parseSidecarEvent('"a string"')).toBeNull();
    expect(parseSidecarEvent('{"type":"progress","stage":"nope"}')).toBeNull();
    expect(parseSidecarEvent('{"type":"unknown"}')).toBeNull();
    expect(parseSidecarEvent('{"type":"result"}')).toBeNull();
    // An error with a non-string message still yields a usable event.
    expect(parseSidecarEvent('{"type":"error","message":42}')).toEqual({
      type: "error",
      message: "lyrics generation failed",
    });
  });

  it("parses download progress lines", () => {
    expect(
      parseDownloadProgress('{"id":"whisper-small","received":524288,"total":487601967}'),
    ).toEqual({
      id: "whisper-small",
      received: 524288,
      total: 487601967,
    });
    expect(parseDownloadProgress("junk")).toBeNull();
    expect(parseDownloadProgress('{"id":"x"}')).toBeNull();
  });
});

function modelsFixture(overrides?: {
  vocInstalled?: boolean;
  smallInstalled?: boolean;
  mediumInstalled?: boolean;
  smallPart?: number;
}): LyricsModelsState {
  return {
    modelsDir: "C:\\data\\models",
    models: [
      {
        id: "mdx-voc-ft",
        fileName: "UVR-MDX-NET-Voc_FT.onnx",
        bytes: 66_762_490,
        sha256: "534b",
        role: "isolation",
        installed: overrides?.vocInstalled ?? false,
        partBytes: 0,
      },
      {
        id: "whisper-small",
        fileName: "ggml-small.bin",
        bytes: 487_601_967,
        sha256: "1be3",
        role: "whisper-small",
        installed: overrides?.smallInstalled ?? false,
        partBytes: overrides?.smallPart ?? 0,
      },
      {
        id: "whisper-medium",
        fileName: "ggml-medium.bin",
        bytes: 1_533_763_059,
        sha256: "6c14",
        role: "whisper-medium",
        installed: overrides?.mediumInstalled ?? false,
        partBytes: 0,
      },
    ],
  };
}

describe("tier math", () => {
  it("tiers require isolation plus their whisper model", () => {
    expect(tierModelIds("small")).toEqual(["mdx-voc-ft", "whisper-small"]);
    expect(tierModelIds("medium")).toEqual(["mdx-voc-ft", "whisper-medium"]);
  });

  it("missing/installed reflect per-model state", () => {
    const none = modelsFixture();
    expect(missingModels(none, "small").map((m) => m.id)).toEqual(["mdx-voc-ft", "whisper-small"]);
    expect(tierInstalled(none, "small")).toBe(false);

    const smallReady = modelsFixture({ vocInstalled: true, smallInstalled: true });
    expect(tierInstalled(smallReady, "small")).toBe(true);
    // ...but medium still needs its own whisper model.
    expect(missingModels(smallReady, "medium").map((m) => m.id)).toEqual(["whisper-medium"]);
  });

  it("download bytes are resume-aware; install total is the full tier", () => {
    const st = modelsFixture({ vocInstalled: true, smallPart: 100_000_000 });
    const { remaining, installTotal } = tierDownloadBytes(st, "small");
    expect(installTotal).toBe(66_762_490 + 487_601_967);
    expect(remaining).toBe(487_601_967 - 100_000_000);
    // The small tier at defaults ≈ 554 MB — the number the disclosure shows.
    expect(formatBytes(installTotal)).toBe("554 MB");
  });
});

describe("time estimates (sustained-thermal — spike adjustment 1)", () => {
  it("a 4-minute song lands in the spike's measured windows", () => {
    const d = 240;
    // GPU-assisted small: REPORT projects ≈4 min total.
    const dmlSmall = estimateGenerateSeconds(d, "small", true);
    expect(dmlSmall.lowSec).toBeGreaterThan(120);
    expect(dmlSmall.highSec).toBeLessThan(6.5 * 60);
    // CPU-only medium: REPORT says 15-18 min per song; the range must
    // contain it (sustained numbers, not cold-run flattery).
    const cpuMedium = estimateGenerateSeconds(d, "medium", false);
    expect(cpuMedium.lowSec).toBeLessThan(15 * 60);
    expect(cpuMedium.highSec).toBeGreaterThan(17 * 60);
    // And the difference between DML and CPU isolation is the 4-5x the
    // spike measured — CPU-small must be clearly slower than DML-small.
    const cpuSmall = estimateGenerateSeconds(d, "small", false);
    expect(cpuSmall.lowSec).toBeGreaterThan(dmlSmall.lowSec * 2);
  });

  it("formats honestly at both extremes", () => {
    expect(formatEstimate({ lowSec: 20, highSec: 45 })).toBe("under a minute");
    expect(formatEstimate({ lowSec: 130, highSec: 300 })).toBe("≈2-5 min");
    expect(formatEstimate({ lowSec: 55, highSec: 65 })).toBe("≈1-2 min");
    expect(formatEstimate({ lowSec: 60, highSec: 60 })).toBe("≈1 min");
  });

  it("byte and eta formatting match app conventions", () => {
    expect(formatBytes(66_762_490)).toBe("67 MB");
    expect(formatBytes(1_533_763_059)).toBe("1.53 GB");
    expect(formatEta(185)).toBe("3:05");
    expect(formatEta(0)).toBe("0:00");
  });
});

describe("overall progress", () => {
  it("is monotonic across the stage sequence", () => {
    const points = [
      overallProgress("decode", null),
      overallProgress("isolate", 0),
      overallProgress("isolate", 50),
      overallProgress("isolate", 100),
      overallProgress("vad", null),
      overallProgress("transcribe", 10),
      overallProgress("transcribe", 90),
      overallProgress("assemble", null),
    ];
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeGreaterThanOrEqual(points[i - 1]);
    }
    expect(points[points.length - 1]).toBeLessThanOrEqual(1);
    expect(overallProgress("isolate", 50)).toBeCloseTo(0.02 + 0.275, 5);
  });
});
