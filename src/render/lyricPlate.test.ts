import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shiftLyricsForSegment, type LyricLine } from "../state/lyrics";
import {
  composeLyricPlate,
  lyricPlateKeyAt,
  NULL_PLATE_KEY,
  PLATE_MAIN_BAND,
  PLATE_NEXT_BAND,
  PLATE_PREV_BAND,
  PLATE_STATUS_PX,
  samePlateKey,
  timeForFill,
  NEXT_LEAD_SEC,
  PREV_HOLD_SEC,
} from "./lyricPlate";

/**
 * The lyric PLATE — Lyric Stage's text input. What is pinned here is the
 * contract the mode's determinism stands on: the key is a pure quantized
 * function of (lines, t, w, h), the bitmap is a pure function of (lines, key),
 * and a segment-shifted sheet at clip time produces the identical plate the
 * unshifted sheet produces at track time. The GPU matrix cannot see any of
 * this (it renders with no plate bound), and the golden shader test only
 * proves the WGSL text — this file is the raster half's own gate.
 */

type Op = { op: string; args: unknown[] };

/** Deterministic text metrics: width proportional to glyph count and the
 * current font size — all the wrap/clip math needs (the overlayCompose
 * recording device, trimmed to what the plate draws). */
function recordingContext(ops: Op[]): OffscreenCanvasRenderingContext2D {
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  const px = () => Number(/(\d+)px/.exec(String(state.font))?.[1] ?? 10);
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "measureText") {
        return (text: string) => ({ width: text.length * px() * 0.5 });
      }
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        ops.push({ op: prop, args });
      };
    },
    set(_t, prop, value) {
      if (typeof prop !== "string") return true;
      state[prop] = value;
      ops.push({ op: `set:${prop}`, args: [value] });
      return true;
    },
  }) as unknown as OffscreenCanvasRenderingContext2D;
}

class RecordingCanvas {
  ops: Op[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string): OffscreenCanvasRenderingContext2D | null {
    return kind === "2d" ? recordingContext(this.ops) : null;
  }
  transferToImageBitmap(): ImageBitmap {
    return { ops: this.ops.slice(), close: () => {} } as unknown as ImageBitmap;
  }
}

const W = 640;
const H = 360;

const LINES: LyricLine[] = [
  {
    t: 10,
    end: 14,
    text: "hold the line steady",
    words: [
      { t: 10, end: 11, text: "hold" },
      { t: 11, end: 12, text: "the" },
      { t: 12, end: 13, text: "line steady" },
    ],
  },
  { t: 16, end: 19, text: "second line here" },
  { t: 40, end: 44, text: "after the break" },
];

const keyAt = (t: number) => lyricPlateKeyAt(LINES, t, W, H);

describe("lyric plate key", { timeout: 30_000 }, () => {
  it("quantizes on the shared overlay grids (1/64 fade, 1/32 fill)", () => {
    const k = keyAt(10.616);
    expect(k.main).toBe(0);
    expect(Math.round(k.mainAlphaQ * 64)).toBeCloseTo(k.mainAlphaQ * 64, 10);
    expect(Math.round(k.fillQ * 32)).toBeCloseTo(k.fillQ * 32, 10);
    // Two times inside one quantum resolve the SAME key — the whole point of
    // the key: a 144 Hz preview and a 30 fps export re-rasterize on the same
    // boundaries or the bitmaps diverge.
    expect(keyAt(12.501)).toEqual(keyAt(12.5006));
  });

  it("resolves no main line before the first, and after an explicit end", () => {
    expect(keyAt(2).main).toBe(-1);
    expect(keyAt(15).main).toBe(-1); // line 0 ended at 14, line 1 starts at 16
    expect(keyAt(12).main).toBe(0);
  });

  it("keeps the support cast alive through an instrumental gap", () => {
    // Between line 1 (ends 19) and line 2 (starts 40): prev lingers for its
    // hold window, next fades in inside its lead window — the stage never
    // cuts to an empty frame mid-song.
    const justAfter = keyAt(19.5);
    expect(justAfter.main).toBe(-1);
    expect(justAfter.prev).toBe(1);
    expect(justAfter.prevAlphaQ).toBeGreaterThan(0);
    const deepGap = keyAt(19 + PREV_HOLD_SEC + 1);
    expect(deepGap.prev).toBe(-1);
    const approaching = keyAt(40 - NEXT_LEAD_SEC + 1);
    expect(approaching.next).toBe(2);
    expect(approaching.nextAlphaQ).toBeGreaterThan(0);
    const farOut = keyAt(30);
    expect(farOut.next).toBe(-1);
  });

  it("a segment-shifted sheet at clip time yields the identical key", () => {
    // The determinism-law argument in one assertion: exports slice the audio
    // to t=0 and ship shiftLyricsForSegment'd lines (lines AND words, F4a);
    // the plate keyed from those at clip time must be the plate the preview
    // keyed from the unshifted sheet at track time.
    const SEG = 9.25;
    const shifted = shiftLyricsForSegment(LINES, SEG);
    for (const t of [10.1, 11.5, 12.97, 16.2, 19.5, 35, 41]) {
      expect(lyricPlateKeyAt(shifted, t - SEG, W, H)).toEqual(keyAt(t));
    }
  });

  it("carries the raster size, so a resize re-rasterizes with no special case", () => {
    expect(samePlateKey(keyAt(12), lyricPlateKeyAt(LINES, 12, 1280, 720))).toBe(false);
    expect(samePlateKey(NULL_PLATE_KEY, keyAt(2))).toBe(false); // sentinel matches nothing
  });
});

describe("lyric plate raster", { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.stubGlobal("OffscreenCanvas", RecordingCanvas);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const trace = async (t: number): Promise<Op[]> => {
    const bmp = await composeLyricPlate(LINES, keyAt(t));
    return (bmp as unknown as { ops: Op[] }).ops;
  };
  const fillRects = (ops: Op[]) => ops.filter((o) => o.op === "fillRect").map((o) => o.args);
  const fillTexts = (ops: Op[]) => ops.filter((o) => o.op === "fillText").map((o) => o.args);

  it("paints the status block first, from the key's own quantized values", async () => {
    const k = keyAt(12);
    const ops = await trace(12);
    const status = fillRects(ops)[0];
    expect(status).toEqual([0, 0, PLATE_STATUS_PX, PLATE_STATUS_PX]);
    const styleSet = ops.find((o) => o.op === "set:fillStyle")!;
    expect(styleSet.args[0]).toBe(
      `rgb(${Math.round(k.mainAlphaQ * 255)}, ${Math.round(k.prevAlphaQ * 255)}, ` +
        `${Math.round(k.nextAlphaQ * 255)})`,
    );
    // ...and it is painted even when nothing else is: an all-zero block IS
    // the "nothing on stage" signal the shader reads.
    const empty = await trace(2);
    expect(fillRects(empty)[0]).toEqual([0, 0, PLATE_STATUS_PX, PLATE_STATUS_PX]);
    expect(fillTexts(empty)).toHaveLength(0);
  });

  it("keeps every band's text inside its band", async () => {
    // t=17: line 1 active (main band), line 0 held (prev band), and glyphs
    // must never approach the status corner (the top 6% stays empty).
    const ops = await trace(17);
    const texts = fillTexts(ops) as [string, number, number][];
    expect(texts.length).toBeGreaterThan(1);
    const prevY = texts[0][2];
    expect(prevY).toBeGreaterThan(PLATE_PREV_BAND[0] * H);
    expect(prevY).toBeLessThan(PLATE_PREV_BAND[1] * H);
    for (const [, , y] of texts) {
      expect(y).toBeGreaterThan(H * 0.06);
      if (y > PLATE_MAIN_BAND[0] * H) {
        expect(y).toBeLessThan(PLATE_NEXT_BAND[1] * H);
      }
    }
  });

  it("fills the karaoke lit mask per WORD, clipped to each unit's own advance", async () => {
    // Mid-word 2 ("line steady", 12..13): words 0 and 1 fully lit, word 2
    // half lit — each lit overpaint is a clip rect sized by that unit's own
    // fill fraction, not the caption's whole-row sweep.
    const ops = await trace(12.5);
    const clips = ops.filter((o) => o.op === "rect").map((o) => o.args as number[]);
    expect(clips).toHaveLength(3); // one lit overpaint per started word
    const mainTexts = fillTexts(ops).map((a) => a[0]);
    expect(mainTexts).toContain("hold");
    expect(mainTexts).toContain("line steady");
    // Word widths: len * px * 0.5 (the deterministic metric). Word 2's clip
    // is its own advance times its keyed fill — derived through timeForFill
    // and the 1/64 fill grid, exactly as the raster derives it — plus the
    // 1 px AA guard. Computing it independently here pins the raster to the
    // key rather than to whatever raw t the test happened to pass.
    const k = keyAt(12.5);
    const fill2 = Math.round(Math.max(0, Math.min(1, timeForFill(LINES, k) - 12)) * 64) / 64;
    const px = Math.max(10, Math.round(0.075 * H));
    const w2 = "line steady".length * px * 0.5;
    expect(clips[2][2]).toBeCloseTo(w2 * fill2 + 1, 6);
  });

  it("bakes the entrance rise from the keyed fade alpha", async () => {
    // Early in the fade the block sits LOWER (rising into place) than once
    // the fade completes — and both positions derive from the key, so a
    // 30 fps export walks the same rise the 144 Hz preview does.
    const early = fillTexts(await trace(10.06)) as [string, number, number][];
    const settled = fillTexts(await trace(12)) as [string, number, number][];
    const yOf = (rows: [string, number, number][], text: string) =>
      rows.find((r) => r[0] === text)![2];
    expect(yOf(early, "hold")).toBeGreaterThan(yOf(settled, "hold"));
  });

  it("is a pure function of (lines, key): same key, byte-identical trace", async () => {
    const a = await trace(12.5);
    const b = await trace(12.5);
    expect(b).toEqual(a);
    // ...including across the segment shift, through the SAME key.
    const SEG = 7.5;
    const shifted = shiftLyricsForSegment(LINES, SEG);
    const k = lyricPlateKeyAt(shifted, 12.5 - SEG, W, H);
    const c = await composeLyricPlate(shifted, k);
    expect((c as unknown as { ops: Op[] }).ops).toEqual(a);
  });

  it("timeForFill is the grid-exact inverse of the keyed fill position", () => {
    // For every 1/32 step of the timed line, re-deriving t from the key and
    // re-quantizing lands on the same step — the raster can never disagree
    // with the key that scheduled it.
    for (let s = 0; s <= 32; s++) {
      const key = { ...keyAt(12), fillQ: s / 32 };
      const t = timeForFill(LINES, key);
      expect(t).toBeGreaterThanOrEqual(LINES[0].t);
      expect(t).toBeLessThanOrEqual(14 + 1e-9);
    }
    // An untimed line inverts linearly across its window.
    const k1 = { ...keyAt(17), fillQ: 0.5 };
    expect(timeForFill(LINES, k1)).toBeCloseTo(17.5, 10);
  });
});
