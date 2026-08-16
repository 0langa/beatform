import { describe, expect, it } from "vitest";
import {
  blendMeasuredRtf,
  estimateGenerateSeconds,
  formatBytes,
  formatEstimate,
  formatEta,
  LYRICS_LANGUAGES,
  missingModels,
  NO_MEASURED_RTF,
  nextStage,
  overallProgress,
  parseDownloadProgress,
  parseSidecarEvent,
  reduceGenProgress,
  tierDownloadBytes,
  tierInstalled,
  tierModelIds,
  type LyricsModelsState,
  type MeasuredRtf,
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
        '{"type":"result","lrcPath":"ssb.lrc","lines":7,"words":52,"alignedLines":7,"lowConfLines":1,"vocalSec":82.86000000000001,"ep":"dml","language":"en"}',
      ),
    ).toEqual({
      type: "result",
      lrcPath: "ssb.lrc",
      lines: 7,
      words: 52,
      alignedLines: 7,
      lowConfLines: 1,
      vocalSec: 82.86000000000001,
      ep: "dml",
      language: "en",
      lineDetails: undefined,
    });
    // Phase-4 per-line confidence rides the result; malformed entries
    // degrade instead of rejecting the event.
    expect(
      parseSidecarEvent(
        '{"type":"result","lrcPath":"y.lrc","lines":2,"words":2,"alignedLines":1,"lowConfLines":1,' +
          '"vocalSec":5,"ep":"cpu","language":"en",' +
          '"lineDetails":[{"conf":0.81,"words":[0.9,"x",0.72]},{"words":[]}]}',
      ),
    ).toMatchObject({
      type: "result",
      lineDetails: [
        { conf: 0.81, words: [0.9, 0.72] },
        { conf: null, words: [] },
      ],
    });
    // A phase-2 result line (no alignment fields) still parses — the counts
    // default to zero, meaning "line-level LRC".
    expect(
      parseSidecarEvent(
        '{"type":"result","lrcPath":"x.lrc","lines":3,"vocalSec":10,"ep":"cpu","language":"en"}',
      ),
    ).toMatchObject({ type: "result", lines: 3, words: 0, alignedLines: 0, lowConfLines: 0 });
    expect(parseSidecarEvent('{"type":"progress","stage":"align","pct":50,"etaSec":12.5}')).toEqual(
      {
        type: "progress",
        stage: "align",
        pct: 50,
        etaSec: 12.5,
        rtf: undefined,
      },
    );
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
  alignInstalled?: boolean;
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
      {
        id: "wav2vec2-align",
        fileName: "wav2vec2-base-960h-ctc-int8.onnx",
        bytes: 121_925_528,
        sha256: "788e",
        role: "alignment",
        installed: overrides?.alignInstalled ?? false,
        partBytes: 0,
      },
      {
        id: "wav2vec2-vocab",
        fileName: "wav2vec2-base-960h-vocab.json",
        bytes: 392,
        sha256: "8ae6",
        role: "alignment",
        installed: overrides?.alignInstalled ?? false,
        partBytes: 0,
      },
    ],
  };
}

describe("tier math", () => {
  it("tiers require isolation, the alignment pair, and their whisper model", () => {
    expect(tierModelIds("small")).toEqual([
      "mdx-voc-ft",
      "wav2vec2-align",
      "wav2vec2-vocab",
      "whisper-small",
    ]);
    expect(tierModelIds("medium")).toEqual([
      "mdx-voc-ft",
      "wav2vec2-align",
      "wav2vec2-vocab",
      "whisper-medium",
    ]);
  });

  it("missing/installed reflect per-model state", () => {
    const none = modelsFixture();
    expect(missingModels(none, "small").map((m) => m.id)).toEqual([
      "mdx-voc-ft",
      "wav2vec2-align",
      "wav2vec2-vocab",
      "whisper-small",
    ]);
    expect(tierInstalled(none, "small")).toBe(false);

    const smallReady = modelsFixture({
      vocInstalled: true,
      smallInstalled: true,
      alignInstalled: true,
    });
    expect(tierInstalled(smallReady, "small")).toBe(true);
    // ...but medium still needs its own whisper model.
    expect(missingModels(smallReady, "medium").map((m) => m.id)).toEqual(["whisper-medium"]);
    // A phase-2 install (no alignment yet) is missing exactly the align pair.
    const p2 = modelsFixture({ vocInstalled: true, smallInstalled: true });
    expect(missingModels(p2, "small").map((m) => m.id)).toEqual([
      "wav2vec2-align",
      "wav2vec2-vocab",
    ]);
  });

  it("download bytes are resume-aware; install total is the full tier", () => {
    const st = modelsFixture({ vocInstalled: true, alignInstalled: true, smallPart: 100_000_000 });
    const { remaining, installTotal } = tierDownloadBytes(st, "small");
    expect(installTotal).toBe(66_762_490 + 487_601_967 + 121_925_528 + 392);
    expect(remaining).toBe(487_601_967 - 100_000_000);
    // The small tier with word alignment ≈ 676 MB — the disclosure number.
    expect(formatBytes(installTotal)).toBe("676 MB");
  });
});

describe("language options (FEAT-004 follow-up c)", () => {
  it("leads with auto-detect, then the common set alphabetically by label", () => {
    expect(LYRICS_LANGUAGES[0]).toEqual({ value: "auto", label: "Auto-detect" });
    const rest = LYRICS_LANGUAGES.slice(1);
    const labels = rest.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("carries a real, curated set — not a stub and not the full ~100-language table", () => {
    const rest = LYRICS_LANGUAGES.slice(1);
    expect(rest.length).toBeGreaterThan(20);
    expect(rest.length).toBeLessThan(80);
  });

  it("every value is unique and a plausible whisper.cpp code (lowercase, 2-3 letters)", () => {
    const values = LYRICS_LANGUAGES.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      if (v === "auto") continue;
      expect(v, `"${v}" is not a lowercase 2-3 letter code`).toMatch(/^[a-z]{2,3}$/);
    }
  });

  it("no flag emoji or other symbols in a label — plain text only", () => {
    for (const { label } of LYRICS_LANGUAGES) {
      // Printable ASCII only: every flag/emoji glyph lives well outside it.
      expect(label, `"${label}" has a non-ASCII character`).toMatch(/^[ -~]+$/);
    }
  });
});

describe("time estimates (sustained-thermal — spike adjustment 1)", () => {
  it("a 4-minute song lands in the spike's measured windows", () => {
    const d = 240;
    // GPU-assisted small: REPORT projects ≈4 min; phase 3 adds the CPU-only
    // align leg (device 0.1-0.4 RTF across thermal states).
    const dmlSmall = estimateGenerateSeconds(d, "small", true);
    expect(dmlSmall.lowSec).toBeGreaterThan(120);
    expect(dmlSmall.highSec).toBeLessThan(7 * 60);
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

/**
 * FEAT-004 follow-up (b): persisting measured RTF into later estimates.
 * Two independent blend rules — updating the persisted history
 * (blendMeasuredRtf, an EWMA) and folding that history into ONE estimate
 * (estimateGenerateSeconds' 4th argument, an even split against the static
 * bound) — each pinned with hand-computed numbers, not just direction
 * checks, per the deterministic-math requirement.
 */
describe("measured-RTF blending (FEAT-004 follow-up b)", () => {
  it("estimateGenerateSeconds with no measured arg is byte-for-byte the old static-only call", () => {
    // Every existing call site (and every test above this one) calls with
    // 3 args — the 4th must default to "no measurement" so none of them
    // silently change behavior.
    const withDefault = estimateGenerateSeconds(240, "small", true);
    const withExplicitNone = estimateGenerateSeconds(240, "small", true, NO_MEASURED_RTF);
    expect(withDefault).toEqual(withExplicitNone);
    // Hand-computed from the static table: d*(iso+wh+align)+overhead.
    expect(withDefault.lowSec).toBeCloseTo(240 * (0.45 + 0.25 + 0.1) + 8, 9);
    expect(withDefault.highSec).toBeCloseTo(240 * (0.7 + 0.45 + 0.4) + 25, 9);
  });

  it("blends a measured value into BOTH bounds by an even split, narrowing the range", () => {
    const measured: MeasuredRtf = {
      isolateDml: 0.6,
      isolateCpu: null,
      whisperSmall: 0.3,
      whisperMedium: null,
      align: 0.2,
    };
    const est = estimateGenerateSeconds(240, "small", true, measured);
    // bound' = bound + 0.5*(measured-bound), summed across the 3 components,
    // times duration, plus the untouched overhead — hand-computed:
    //   iso  0.45->0.525, 0.7->0.65
    //   wh   0.25->0.275, 0.45->0.375
    //   align 0.1->0.15,  0.4->0.30
    //   low  = 240*(0.525+0.275+0.15)+8  = 236
    //   high = 240*(0.65+0.375+0.30)+25  = 343
    expect(est.lowSec).toBeCloseTo(236, 9);
    expect(est.highSec).toBeCloseTo(343, 9);
    // And it must actually be NARROWER than the static-only range, not just
    // different — that is the entire point of a "hardware-detected" feel.
    const base = estimateGenerateSeconds(240, "small", true);
    expect(est.highSec - est.lowSec).toBeLessThan(base.highSec - base.lowSec);
  });

  it("only consults the measured slot matching THIS run's device/tier split — no cross-talk", () => {
    // isolateCpu is wildly different from the static DML range; if it leaked
    // into a dmlAvailable=true call the result would move a lot. It must not.
    const crossTalk: MeasuredRtf = { ...NO_MEASURED_RTF, isolateCpu: 5 };
    const dmlRun = estimateGenerateSeconds(240, "small", true, crossTalk);
    const dmlRunUnmeasured = estimateGenerateSeconds(240, "small", true);
    expect(dmlRun).toEqual(dmlRunUnmeasured);
    // Same story for tier: a medium sample must not move a small-tier call.
    const tierCrossTalk: MeasuredRtf = { ...NO_MEASURED_RTF, whisperMedium: 5 };
    const smallRun = estimateGenerateSeconds(240, "small", false, tierCrossTalk);
    const smallRunUnmeasured = estimateGenerateSeconds(240, "small", false);
    expect(smallRun).toEqual(smallRunUnmeasured);
  });

  it("blendMeasuredRtf: first sample seeds the EWMA exactly, later samples blend at alpha=0.3", () => {
    const first = blendMeasuredRtf(NO_MEASURED_RTF, { isolateDml: 0.5 });
    expect(first.isolateDml).toBe(0.5); // no prior value — the sample IS the estimate
    expect(first.isolateCpu).toBeNull(); // untouched slots stay null
    const second = blendMeasuredRtf(first, { isolateDml: 0.7 });
    // 0.5 + 0.3*(0.7-0.5) = 0.56
    expect(second.isolateDml).toBeCloseTo(0.56, 9);
    const third = blendMeasuredRtf(second, { isolateDml: 0.4 });
    // 0.56 + 0.3*(0.4-0.56) = 0.512
    expect(third.isolateDml).toBeCloseTo(0.512, 9);
  });

  it("blendMeasuredRtf only touches the keys present in the sample — everything else is preserved", () => {
    const prev: MeasuredRtf = {
      isolateDml: 0.5,
      isolateCpu: 2.0,
      whisperSmall: 0.3,
      whisperMedium: null,
      align: 0.2,
    };
    const next = blendMeasuredRtf(prev, { align: 0.3 });
    expect(next.isolateDml).toBe(0.5);
    expect(next.isolateCpu).toBe(2.0);
    expect(next.whisperSmall).toBe(0.3);
    expect(next.whisperMedium).toBeNull();
    expect(next.align).toBeCloseTo(0.2 + 0.3 * (0.3 - 0.2), 9);
  });

  it("blendMeasuredRtf drops a non-finite or non-positive sample instead of poisoning the EWMA", () => {
    const prev: MeasuredRtf = { ...NO_MEASURED_RTF, align: 0.25 };
    for (const bad of [NaN, Infinity, -Infinity, 0, -1]) {
      const next = blendMeasuredRtf(prev, { align: bad });
      expect(next.align, `sample ${bad} should have been rejected`).toBe(0.25);
    }
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
      overallProgress("align", 20),
      overallProgress("align", 100),
      overallProgress("assemble", null),
    ];
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeGreaterThanOrEqual(points[i - 1]);
    }
    expect(points[points.length - 1]).toBeLessThanOrEqual(1);
    expect(overallProgress("isolate", 50)).toBeCloseTo(0.02 + 0.26, 5);
    // The align stage slots between transcribe and assemble.
    expect(overallProgress("align", 0)).toBeCloseTo(0.02 + 0.52 + 0.01 + 0.36, 5);
  });
});

describe("nextStage (FEAT-004 follow-up a)", () => {
  it("walks the pipeline in order", () => {
    expect(nextStage("decode")).toBe("isolate");
    expect(nextStage("isolate")).toBe("vad");
    expect(nextStage("vad")).toBe("transcribe");
    expect(nextStage("transcribe")).toBe("align");
    expect(nextStage("align")).toBe("assemble");
  });

  it("the last stage has no next", () => {
    expect(nextStage("assemble")).toBeNull();
  });
});

describe("reduceGenProgress (FEAT-004 follow-up a)", () => {
  it("a progress event always reports its own stage with starting=false, even with no pct", () => {
    expect(reduceGenProgress({ type: "progress", stage: "isolate", pct: 40, etaSec: 12 })).toEqual({
      stage: "isolate",
      pct: 40,
      etaSec: 12,
      starting: false,
      overall: overallProgress("isolate", 40),
    });
    // No pct at all (a stage that never reports one) is still "running", not
    // "starting" — the whole point of the flag is to distinguish this from
    // the gap right after a stageDone.
    expect(reduceGenProgress({ type: "progress", stage: "align", pct: undefined })).toEqual({
      stage: "align",
      pct: null,
      etaSec: null,
      starting: false,
      overall: overallProgress("align", null),
    });
  });

  it("stageDone reports the NEXT stage, starting=true, no pct/eta — the transitional state", () => {
    // The exact pain point from the owner's first-impressions note: vad
    // (labeled "Finding vocal lines") finishes, transcribe has not sent
    // its first event yet (whisper-medium's worst-case first-token
    // latency), so the stage must already read "transcribe", not "vad".
    expect(reduceGenProgress({ type: "stageDone", stage: "vad", wallSec: 12 })).toEqual({
      stage: "transcribe",
      pct: null,
      etaSec: null,
      starting: true,
      // The overall bar still advances the full weight of the finished
      // stage — "before next" and "before + 100% of vad" are the same sum.
      overall: overallProgress("vad", 100),
    });
  });

  it("the overall fraction at a stageDone transition equals overallProgress(finishedStage, 100)", () => {
    // Property, not just the one hand-picked case above — every
    // intermediate stage's transition must agree with the pre-existing
    // formula, since STAGE_WEIGHTS could be retuned later.
    for (const stage of ["decode", "isolate", "vad", "transcribe", "align"] as const) {
      const next = nextStage(stage);
      expect(next).not.toBeNull();
      const reduced = reduceGenProgress({ type: "stageDone", stage, wallSec: 1 });
      expect(reduced.stage).toBe(next);
      expect(reduced.starting).toBe(true);
      expect(reduced.overall).toBeCloseTo(overallProgress(stage, 100), 9);
    }
  });

  it("the LAST stage (assemble) has no next — keeps the old 100%-and-done shape", () => {
    expect(reduceGenProgress({ type: "stageDone", stage: "assemble", wallSec: 2 })).toEqual({
      stage: "assemble",
      pct: 100,
      etaSec: null,
      starting: false,
      overall: overallProgress("assemble", 100),
    });
  });

  it("a real progress event for the new stage clears starting, even before any pct arrives", () => {
    const transitioning = reduceGenProgress({ type: "stageDone", stage: "vad", wallSec: 12 });
    expect(transitioning.starting).toBe(true);
    const arrived = reduceGenProgress({
      type: "progress",
      stage: transitioning.stage,
      pct: undefined,
    });
    expect(arrived.starting).toBe(false);
    expect(arrived.stage).toBe("transcribe");
  });
});
