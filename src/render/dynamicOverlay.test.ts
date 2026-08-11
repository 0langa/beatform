import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeOverlayFrame,
  hasDynamics,
  overlayFrameKeyAt,
  sameOverlayFrame,
} from "./dynamicOverlay";
import { DEFAULT_AUDIOGRAM, formatClock, type AudiogramSettings } from "../state/audiogram";
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

  it("a missing waveform does not move the progress key", () => {
    // The strip and the bar share one key field, and the strip's SLOT is the
    // setting's, not the data's (see the geometry suite below) — so losing the
    // overview must not change when the compositor re-rasterizes either.
    const strip = { ...DEFAULT_AUDIOGRAM, waveformStrip: true };
    const withWf = { settings: strip, duration: 100, waveform: new Float32Array(8).fill(0.5) };
    expect(
      sameOverlayFrame(
        overlayFrameKeyAt({ audiogram: withWf }, 10, 1000),
        overlayFrameKeyAt({ audiogram: { ...withWf, waveform: null } }, 10, 1000),
      ),
    ).toBe(true);
  });

  it("word timing moves the wipe frame key (re-rasterize on word boundaries)", () => {
    // One line [10, 20) with two words: "slow" sung 10-11, "burn" 15-19.
    const lyrics = {
      lines: [
        {
          t: 10,
          end: null,
          text: "slow burn",
          words: [
            { t: 10, end: 11, text: "slow" },
            { t: 15, end: 19, text: "burn" },
          ],
        },
        { t: 20, end: null, text: "next" },
      ],
      style: { ...DEFAULT_LYRIC_STYLE, fadeSec: 0, anim: "wipe" as const },
    };
    const at = (t: number) => overlayFrameKeyAt({ lyrics }, t, 1000);
    // During "slow": progress sweeps -> key moves between 10.2 and 10.8.
    expect(sameOverlayFrame(at(10.2), at(10.8))).toBe(false);
    // Fill holds through the gap between the words -> key does NOT move.
    expect(sameOverlayFrame(at(11.5), at(14.5))).toBe(true);
    // Plain linear interpolation would have moved across that same span.
    const plain = {
      lines: [{ t: 10, end: null, text: "slow burn" }, lyrics.lines[1]],
      style: lyrics.style,
    };
    expect(
      sameOverlayFrame(
        overlayFrameKeyAt({ lyrics: plain }, 11.5, 1000),
        overlayFrameKeyAt({ lyrics: plain }, 14.5, 1000),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Audiogram stack geometry
// ---------------------------------------------------------------------------

/**
 * The audiogram stacks outward from the frame edge — strip, then bar, then
 * clock — so the strip owns the first slot and everything below it sits on
 * where that slot ended.
 *
 * That slot is reserved by the SETTING, never by the data. `waveformOverview`
 * is null for the whole of a track load (E3c voids it with the rest of the
 * analysis, and a load that fails after the audio has landed leaves it null for
 * good), so a slot that collapsed whenever the bars were missing dropped the
 * bar and the clock ~11% of the frame height on every single track change, then
 * lifted them back when the analysis landed.
 *
 * No canvas in the node environment, so these read a RECORDING 2D context — the
 * same device overlayCompose.test.ts uses, trimmed to what the audiogram draws
 * (audiogram-only dynamics never enter the lyric path, the only one that needs
 * text metrics). Positions come out of the trace, so the assertions are on
 * geometry rather than on "it didn't throw".
 */

type Op = { op: string; args: unknown[] };

class RecordingCanvas {
  ops: Op[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string): OffscreenCanvasRenderingContext2D | null {
    if (kind !== "2d") return null;
    const ops = this.ops;
    return new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) =>
        typeof prop === "string"
          ? (...args: unknown[]) => {
              ops.push({ op: prop, args });
            }
          : undefined,
      set: (_t, prop, value) => {
        ops.push({ op: `set:${String(prop)}`, args: [value] });
        return true;
      },
    }) as unknown as OffscreenCanvasRenderingContext2D;
  }
  transferToImageBitmap(): ImageBitmap {
    return { ops: this.ops.slice() } as unknown as ImageBitmap;
  }
}

const W = 640;
const H = 360;
const DURATION = 30;
const T = 6; // 20% played

/**
 * Every pinned number below, worked out by hand for 640x360 so the pins fail on
 * a geometry change instead of following it:
 *   pad 26, innerW 588, bottom edge 342, top edge 18,
 *   strip 32 + gap 7 = 39 of reservation, bar 3, gap 7.
 */
const RESERVE = 39;

const rects = (ops: Op[]): number[][] =>
  ops.filter((o) => o.op === "fillRect").map((o) => o.args as number[]);
/** The progress bar is the LAST pair of fillRects — track, then played fill. */
const barY = (ops: Op[]): number => rects(ops).slice(-2)[0][1];
const texts = (ops: Op[]): unknown[] =>
  ops.filter((o) => o.op === "fillText").map((o) => o.args[0]);
const clockY = (ops: Op[]): number =>
  (ops.filter((o) => o.op === "fillText")[0].args as [string, number, number])[2];

async function stack(
  patch: Partial<AudiogramSettings>,
  waveform: Float32Array | null,
): Promise<Op[]> {
  const bmp = await composeOverlayFrame(
    null,
    {
      audiogram: {
        settings: { ...DEFAULT_AUDIOGRAM, progressBar: true, timeReadout: true, ...patch },
        duration: DURATION,
        waveform,
      },
    },
    T,
    W,
    H,
  );
  return (bmp as unknown as { ops: Op[] }).ops;
}

const WAVE = new Float32Array(8).fill(0.5);

describe("audiogram stack geometry", () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", RecordingCanvas);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("holds the bar and the clock still while the waveform is missing", async () => {
    // The whole regression, in the state a track load actually produces: the
    // strip is ON (document state, untouched by a load) and the overview is
    // null (session state, voided by one). Nothing below the strip may move.
    for (const [position, bar, clock] of [
      ["bottom", 342 - RESERVE - 3, 342 - RESERVE - 3 - 7],
      ["top", 18 + RESERVE, 18 + RESERVE + 3 + 7],
    ] as const) {
      const drawn = await stack({ waveformStrip: true, position }, WAVE);
      const pending = await stack({ waveformStrip: true, position }, null);

      expect(barY(pending), `${position}: the bar moved when the waveform went away`).toBe(
        barY(drawn),
      );
      expect(clockY(pending), `${position}: the clock moved when the waveform went away`).toBe(
        clockY(drawn),
      );
      // Pinned, not merely equal: two collapsed stacks would agree with each
      // other just as happily as two reserved ones.
      expect([barY(drawn), clockY(drawn)]).toEqual([bar, clock]);

      // Non-vacuity: the bar and the clock must actually have been drawn in the
      // pending frame — an empty trace would satisfy "same y" for free.
      expect(rects(pending).length).toBe(2); // the bar's track + fill, no bars
      expect(rects(drawn).length).toBe(202); // ...plus 200 waveform bars
      expect(texts(pending), "the clock stopped drawing without a waveform").toEqual([
        `${formatClock(T)} / ${formatClock(DURATION)}`,
      ]);
    }
  });

  it("reserves nothing when the strip is OFF", async () => {
    // The other half of the predicate: a slot nobody asked for must never
    // appear. Both stacks sit hard against the frame edge, waveform or not.
    for (const [position, bar, clock] of [
      ["bottom", 342 - 3, 342 - 3 - 7],
      ["top", 18, 18 + 3 + 7],
    ] as const) {
      for (const wf of [WAVE, null]) {
        const ops = await stack({ waveformStrip: false, position }, wf);
        expect([barY(ops), clockY(ops)], `${position}: the OFF stack left the edge`).toEqual([
          bar,
          clock,
        ]);
        expect(rects(ops).length).toBe(2);
      }
    }
  });

  it("draws the strip itself unchanged when the waveform is there", async () => {
    const ops = await stack({ waveformStrip: true, position: "bottom" }, WAVE);
    const bars = rects(ops).slice(0, 200);
    // 200 bars across innerW 588 (bw 2.94), centred on mid = 342 - 32/2 = 326,
    // each 0.5 * (32/2) * 0.95 = 7.6 tall either side of it.
    expect(bars.length).toBe(200);
    expect(bars[0][0]).toBe(26);
    expect(bars[0][1]).toBeCloseTo(318.4, 6);
    expect(bars[0][2]).toBeCloseTo(1.94, 6);
    expect(bars[0][3]).toBeCloseTo(15.2, 6);
    expect(bars[199][0]).toBeCloseTo(26 + 199 * 2.94, 6);
  });

  it("an empty overview reserves the slot too, and draws no bars", async () => {
    // The slot follows the setting, so a zero-length overview lands in exactly
    // the same place a null one does — one predicate, not two.
    const empty = await stack({ waveformStrip: true, position: "bottom" }, new Float32Array(0));
    expect([barY(empty), clockY(empty)]).toEqual([342 - RESERVE - 3, 342 - RESERVE - 3 - 7]);
    expect(rects(empty).length).toBe(2);
  });
});
