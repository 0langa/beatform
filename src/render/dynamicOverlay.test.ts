import { describe, expect, it } from "vitest";
import { hasDynamics, overlayFrameKeyAt, sameOverlayFrame } from "./dynamicOverlay";
import { DEFAULT_AUDIOGRAM, formatClock } from "../state/audiogram";
import { DEFAULT_LYRIC_STYLE } from "../state/lyrics";

describe("formatClock", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3661)).toBe("1:01:01");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("overlay dynamics gating", () => {
  it("hasDynamics only when something is on", () => {
    expect(hasDynamics({})).toBe(false);
    expect(
      hasDynamics({
        lyrics: { lines: [{ t: 0, end: null, text: "x" }], style: DEFAULT_LYRIC_STYLE },
      }),
    ).toBe(true);
    expect(hasDynamics({ lyrics: { lines: [], style: DEFAULT_LYRIC_STYLE } })).toBe(false);
    expect(
      hasDynamics({
        audiogram: {
          settings: { ...DEFAULT_AUDIOGRAM, progressBar: true },
          duration: 10,
          waveform: null,
        },
      }),
    ).toBe(true);
    expect(
      hasDynamics({ audiogram: { settings: DEFAULT_AUDIOGRAM, duration: 10, waveform: null } }),
    ).toBe(false);
  });
});

describe("overlayFrameKeyAt", () => {
  const ag = {
    settings: { ...DEFAULT_AUDIOGRAM, progressBar: true, timeReadout: true },
    duration: 100,
    waveform: null,
  };

  it("quantizes progress to pixels and clock to whole seconds", () => {
    const k1 = overlayFrameKeyAt({ audiogram: ag }, 10.0, 1000); // 10% -> px 100
    const k2 = overlayFrameKeyAt({ audiogram: ag }, 10.04, 1000); // same px, same sec
    expect(k1.progressPx).toBe(100);
    expect(k1.clockSec).toBe(10);
    expect(sameOverlayFrame(k1, k2)).toBe(true);
    const k3 = overlayFrameKeyAt({ audiogram: ag }, 11.0, 1000); // px 110, sec 11
    expect(sameOverlayFrame(k1, k3)).toBe(false);
  });

  it("no audiogram -> inactive key fields", () => {
    const k = overlayFrameKeyAt({}, 5, 1000);
    expect(k.progressPx).toBe(-1);
    expect(k.clockSec).toBe(-1);
    expect(k.lyricIdx).toBe(-1);
  });
});
