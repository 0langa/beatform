import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pruneBitmapCache, rasterizeOverlay, type OverlayLayer } from "./overlay";
import {
  composeOverlayFrame,
  overlayFrameKeyAt,
  sameOverlayFrame,
  type OverlayDynamics,
} from "./dynamicOverlay";
import { DEFAULT_LYRIC_STYLE, type LyricLine, type LyricStyle } from "../state/lyrics";
import { DEFAULT_AUDIOGRAM } from "../state/audiogram";

/**
 * F4 — DIRECT tests for the overlay compose chokepoint.
 *
 * The determinism law names three shared chokepoints; this file is the third
 * one, `rasterizeOverlay` (static text/logo/album-art layers) plus
 * `composeOverlayFrame` (per-frame lyrics + audiogram on top of it). The
 * golden traces and the GPU pixel matrix guard the shader side; nothing
 * guarded these two, even though they are what the live loop (store.ts's
 * onFrameTick / refreshOverlay) and the export walk (exportCore.ts) both call
 * to build the very same bitmap.
 *
 * There is no canvas in the node test environment, so the "pixels" here are a
 * RECORDING 2D context: every property assignment and every draw call, in
 * order, with its arguments. That trace is a faithful proxy for the bitmap —
 * two runs that emit the same op sequence into the same canvas size cannot
 * produce different pixels, and any wall-clock, random or leaked-state term
 * in the draw path perturbs it immediately.
 *
 * The context also emulates one piece of real 2D-spec behaviour on purpose:
 * an UNPARSEABLE `font` assignment is silently IGNORED rather than throwing,
 * which is the whole reason rasterizeOverlay probes with a sentinel.
 */

type Op = { op: string; args: unknown[] };

/** `[weight ]<px>px <family-list>` — the only shorthand shape either path emits. */
const FONT_SHORTHAND = /^(?:(\d{2,4})\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/;
/** One family: a quoted string, or an identifier (letters, digits, space, _ , -). */
const FAMILY_ITEM = /^\s*(?:"[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9 _-]*)\s*$/;

function fontParses(value: string): boolean {
  const m = FONT_SHORTHAND.exec(value.trim());
  return m !== null && m[3].split(",").every((f) => FAMILY_ITEM.test(f));
}

function fontPx(value: string): number {
  const m = FONT_SHORTHAND.exec(value.trim());
  return m ? Number(m[2]) : 10;
}

type FakeBitmap = { __bmp: string; width: number; height: number; close: () => void };

function fakeBitmap(id: string, width = 100, height = 50): FakeBitmap {
  return { __bmp: id, width, height, close: () => {} };
}

/** Bitmaps are recorded by tag, so a trace stays readable and comparable. */
function tag(v: unknown): unknown {
  if (typeof v === "object" && v !== null && "__bmp" in (v as Record<string, unknown>)) {
    return `bmp:${(v as FakeBitmap).__bmp}`;
  }
  return v;
}

function recordingContext(ops: Op[]): OffscreenCanvasRenderingContext2D {
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "measureText") {
        // Deterministic metric: proportional to the glyph count and the
        // current font size, which is all the wrap/karaoke math needs.
        return (text: string) => ({ width: text.length * fontPx(String(state.font)) * 0.5 });
      }
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        ops.push({ op: prop, args: args.map(tag) });
      };
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return true;
      // The 2D spec ignores an unparseable font assignment — no throw, no
      // warning, the previous value stays. rasterizeOverlay's FONT_PROBE
      // exists precisely because of this, so the stub must reproduce it.
      if (prop === "font" && !fontParses(String(value))) return true;
      state[prop] = value;
      ops.push({ op: `set:${prop}`, args: [tag(value)] });
      return true;
    },
  };
  return new Proxy(
    {} as Record<string, unknown>,
    handler,
  ) as unknown as OffscreenCanvasRenderingContext2D;
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
  transferToImageBitmap(): FakeBitmap & { ops: Op[] } {
    return { ...fakeBitmap("composed", this.width, this.height), ops: this.ops.slice() };
  }
}

/** The op trace a compose/rasterize call baked into its bitmap. */
function trace(bmp: ImageBitmap | null): Op[] {
  return (bmp as unknown as { ops: Op[] } | null)?.ops ?? [];
}

function argsOf(ops: Op[], op: string): unknown[][] {
  return ops.filter((o) => o.op === op).map((o) => o.args);
}

const W = 640;
const H = 360;

beforeEach(() => {
  vi.stubGlobal("OffscreenCanvas", RecordingCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pruneBitmapCache(new Set()); // overlay.ts caches decodes across calls
});

// ---------------------------------------------------------------------------
// composeOverlayFrame — the per-frame chokepoint
// ---------------------------------------------------------------------------

/** Word-timed so the karaoke wipe (the only anim reading word times) is live. */
const LINES: LyricLine[] = [
  {
    t: 1,
    end: 4,
    text: "hold the line steady and keep the whole thing moving forward now",
    words: [
      { t: 1, end: 1.6, text: "hold" },
      { t: 1.6, end: 2.4, text: "the" },
      { t: 2.4, end: 3.1, text: "line" },
      { t: 3.1, end: null, text: "steady" },
    ],
  },
  { t: 5, end: 9, text: "second line here" },
];

const WIPE_STYLE: LyricStyle = { ...DEFAULT_LYRIC_STYLE, anim: "wipe", fadeSec: 0.2 };

function waveform(): Float32Array {
  const wf = new Float32Array(64);
  for (let i = 0; i < wf.length; i++) wf[i] = Math.abs(Math.sin(i * 0.7)) * 0.9;
  return wf;
}

function dynamics(lines: LyricLine[] = LINES, style: LyricStyle = WIPE_STYLE): OverlayDynamics {
  return {
    lyrics: { lines, style },
    audiogram: {
      settings: {
        ...DEFAULT_AUDIOGRAM,
        progressBar: true,
        timeReadout: true,
        waveformStrip: true,
      },
      duration: 30,
      waveform: waveform(),
    },
  };
}

const base = () => fakeBitmap("static-overlay", W, H) as unknown as ImageBitmap;

async function compose(
  t: number,
  d: OverlayDynamics = dynamics(),
  withBase: ImageBitmap | null = base(),
): Promise<Op[]> {
  return trace(await composeOverlayFrame(withBase, d, t, W, H));
}

describe("composeOverlayFrame determinism (F4)", () => {
  it("the same inputs at the same track time compose an identical draw trace", async () => {
    const a = await compose(2.37);
    const b = await compose(2.37);

    // Non-vacuity: a trace that came out empty would compare equal to itself
    // and prove nothing. Every dynamic element must actually have drawn.
    expect(a.length).toBeGreaterThan(30);
    expect(argsOf(a, "drawImage")[0]).toEqual(["bmp:static-overlay", 0, 0, W, H]);
    expect(argsOf(a, "fillRect").length).toBeGreaterThan(0); // strip + progress bar
    expect(argsOf(a, "fillText").some((args) => args[0] === "0:02 / 0:30")).toBe(true);
    expect(argsOf(a, "fillText").some((args) => String(args[0]).includes("hold the"))).toBe(true);

    expect(b).toEqual(a);
  });

  it("reads no wall clock and no randomness", async () => {
    // Varying, not constant: if the draw path touched any of these the two
    // traces below would diverge as well as the spies firing.
    let tick = 0;
    const random = vi.spyOn(Math, "random").mockImplementation(() => ((tick += 1) % 7) / 7);
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => 1_600_000_000_000 + (tick += 1));
    const perfNow = vi.spyOn(performance, "now").mockImplementation(() => (tick += 1));

    const a = await compose(2.37);
    const b = await compose(2.37);

    expect(b).toEqual(a);
    expect(random).not.toHaveBeenCalled();
    expect(dateNow).not.toHaveBeenCalled();
    expect(perfNow).not.toHaveBeenCalled();
  });

  it("keeps no state between calls — an interleaved frame cannot change a replay", async () => {
    const first = await compose(2.37);
    const other = await compose(3.62);
    const replay = await compose(2.37);

    expect(replay).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("a base-less compose still draws the dynamic layers and stays deterministic", async () => {
    const a = await compose(2.37, dynamics(), null);
    expect(argsOf(a, "drawImage")).toEqual([]); // nothing to blit under them
    expect(a.length).toBeGreaterThan(20);
    expect(await compose(2.37, dynamics(), null)).toEqual(a);
  });
});

describe("composeOverlayFrame frame-key coupling (F4)", () => {
  /**
   * The compositor only re-rasterizes when `overlayFrameKeyAt` moves, so a
   * frozen bitmap is served for every time that maps to the same key. That is
   * only sound if equal key => equal pixels. For the LYRIC layers the coupling
   * is exact by construction (both sides quantize with the same helpers), and
   * this sweeps a real time range to prove it rather than hand-picking a pair.
   *
   * (The audiogram bar/strip are deliberately out of this claim: their draw
   * geometry is padded, so the key's whole-output-pixel quantization is finer
   * than the bar's own, not identical to it.)
   */
  const lyricsOnly = { lyrics: { lines: LINES, style: WIPE_STYLE } };

  it("every pair of times sharing a lyric frame key composes the identical trace", async () => {
    const byKey = new Map<string, { t: number; ops: Op[] }>();
    let compared = 0;
    for (let i = 0; i <= 600; i++) {
      const t = 0.9 + i / 200; // 0.9 .. 3.9 s, straddling fade-in, wipe and fade-out
      const key = JSON.stringify(overlayFrameKeyAt(lyricsOnly, t, W));
      const ops = await compose(t, lyricsOnly);
      const seen = byKey.get(key);
      if (!seen) {
        byKey.set(key, { t, ops });
        continue;
      }
      compared++;
      expect(ops, `t=${t} shares the frame key of t=${seen.t} but drew differently`).toEqual(
        seen.ops,
      );
    }
    // Non-vacuity: the sweep must actually have found repeats to compare, and
    // must also have found genuinely distinct keys (a key stuck on one value
    // would make the whole assertion above trivially true).
    expect(compared).toBeGreaterThan(100);
    expect(byKey.size).toBeGreaterThan(20);
  });

  it("a key that moves does change the trace", async () => {
    const t1 = 1.5;
    const t2 = 3.0;
    expect(
      sameOverlayFrame(overlayFrameKeyAt(lyricsOnly, t1, W), overlayFrameKeyAt(lyricsOnly, t2, W)),
    ).toBe(false);
    expect(await compose(t2, lyricsOnly)).not.toEqual(await compose(t1, lyricsOnly));
  });

  it("the whole-second clock key matches what the clock actually draws", async () => {
    const clockOnly = {
      audiogram: {
        settings: { ...DEFAULT_AUDIOGRAM, timeReadout: true },
        duration: 30,
        waveform: null,
      },
    };
    const a = await compose(7.05, clockOnly);
    const b = await compose(7.94, clockOnly); // same clockSec => same key
    expect(
      sameOverlayFrame(
        overlayFrameKeyAt(clockOnly, 7.05, W),
        overlayFrameKeyAt(clockOnly, 7.94, W),
      ),
    ).toBe(true);
    expect(b).toEqual(a);
    expect(argsOf(a, "fillText").some((args) => args[0] === "0:07 / 0:30")).toBe(true);

    const c = await compose(8.05, clockOnly); // key moves
    expect(c).not.toEqual(a);
  });
});

describe("composeOverlayFrame under a segment shift (F4)", () => {
  /**
   * A segment export slices the audio to t=0 and shifts every TRACK-time
   * quantity by the segment start, so the compose path sees clip time. The
   * invariant: the same musical moment must compose identically either way.
   */
  const S = 8;
  const shiftLine = (l: LyricLine, withWords: boolean): LyricLine => ({
    ...l,
    t: l.t - S,
    end: l.end === null ? null : l.end - S,
    ...(withWords && l.words
      ? {
          words: l.words.map((w) => ({ ...w, t: w.t - S, end: w.end === null ? null : w.end - S })),
        }
      : {}),
  });

  const trackLines = LINES.map((l) => ({
    ...l,
    t: l.t + S,
    end: l.end === null ? null : l.end + S,
    words: l.words?.map((w) => ({ ...w, t: w.t + S, end: w.end === null ? null : w.end + S })),
  }));

  it("clip time with fully shifted lines composes exactly what track time composed", async () => {
    for (const t of [9.4, 10.2, 11.05, 11.9]) {
      const full = await compose(t, { lyrics: { lines: trackLines, style: WIPE_STYLE } });
      const clip = await compose(t - S, {
        lyrics: { lines: trackLines.map((l) => shiftLine(l, true)), style: WIPE_STYLE },
      });
      expect(clip, `segment-shifted compose diverged at t=${t}`).toEqual(full);
    }
  });

  it("the karaoke wipe reads WORD times, so a line-only shift is not equivalent", async () => {
    // Pins why the shift has to reach into `words`: lyricProgressAt drives the
    // wipe from each word's own span, so leaving the words in track time while
    // the line moves to clip time changes the composed frame. Guards anyone
    // adding a second shift site (or trimming this one) from assuming the
    // line-level fields are the whole of a lyric's timing.
    const t = 10.2;
    const full = await compose(t, { lyrics: { lines: trackLines, style: WIPE_STYLE } });
    const lineOnly = await compose(t - S, {
      lyrics: { lines: trackLines.map((l) => shiftLine(l, false)), style: WIPE_STYLE },
    });
    expect(lineOnly).not.toEqual(full);
  });
});

// ---------------------------------------------------------------------------
// rasterizeOverlay — the static text / logo / album-art chokepoint
// ---------------------------------------------------------------------------

const ASSET_SIZES: Record<string, [number, number]> = {
  "data:image/png;base64,LOGO": [200, 100],
  "data:image/png;base64,LOGO-V2": [80, 80],
  "data:image/png;base64,COVER": [300, 300],
};

function stubAssetDecoding(): void {
  vi.stubGlobal("fetch", async (url: string) => ({ blob: async () => ({ url }) }));
  vi.stubGlobal("createImageBitmap", async (blob: { url: string }) => {
    const [w, h] = ASSET_SIZES[blob.url] ?? [100, 50];
    return fakeBitmap(blob.url.slice(-10), w, h);
  });
}

const META = { title: "Night Drive", artist: "Kolm" };

const textLayer: OverlayLayer = {
  id: "t1",
  type: "text",
  text: "{title} — {artist}",
  font: "Georgia",
  weight: 700,
  size: 0.06,
  color: [1, 0.5, 0.25],
  opacity: 0.8,
  letterSpacing: 0.05,
  anchor: "bc",
  offset: [0, -0.06],
  glow: 0.4,
  uppercase: true,
};

const logoLayer: OverlayLayer = {
  id: "i1",
  type: "image",
  assetId: "logo",
  size: 0.2,
  opacity: 0.9,
  anchor: "tr",
  offset: [-0.03, 0.05],
  rounded: 0.1,
};

const assets = (dataUrl = "data:image/png;base64,LOGO") => ({
  logo: { id: "logo", name: "logo.png", dataUrl },
});

describe("rasterizeOverlay determinism (F4)", () => {
  beforeEach(stubAssetDecoding);

  it("the same document rasterizes an identical trace twice", async () => {
    const a = trace(await rasterizeOverlay([textLayer, logoLayer], assets(), W, H, META));
    const b = trace(await rasterizeOverlay([textLayer, logoLayer], assets(), W, H, META));

    expect(argsOf(a, "fillText")).toEqual([["NIGHT DRIVE — KOLM", 320, 338.4]]);
    expect(argsOf(a, "drawImage").length).toBe(1);
    expect(b).toEqual(a);
  });

  it("is resolution-independent — doubling the output doubles every geometry term", async () => {
    const one = trace(await rasterizeOverlay([textLayer, logoLayer], assets(), W, H, META));
    const two = trace(await rasterizeOverlay([textLayer, logoLayer], assets(), W * 2, H * 2, META));

    const px = (ops: Op[]) => {
      const fonts = argsOf(ops, "set:font");
      return fontPx(String(fonts[fonts.length - 1][0]));
    };
    expect(px(two)).toBe(px(one) * 2);

    const spacing = (ops: Op[]) =>
      Number(String(argsOf(ops, "set:letterSpacing")[0][0]).slice(0, -2));
    expect(spacing(two)).toBeCloseTo(spacing(one) * 2, 10);

    expect(Number(argsOf(two, "set:shadowBlur")[0][0])).toBeCloseTo(
      Number(argsOf(one, "set:shadowBlur")[0][0]) * 2,
      10,
    );

    const [, x1, y1] = argsOf(one, "fillText")[0] as [string, number, number];
    const [, x2, y2] = argsOf(two, "fillText")[0] as [string, number, number];
    expect([x2, y2]).toEqual([x1 * 2, y1 * 2]);

    const box1 = (argsOf(one, "drawImage")[0] as [string, number, number, number, number]).slice(1);
    const box2 = (argsOf(two, "drawImage")[0] as [string, number, number, number, number]).slice(1);
    expect(box2).toEqual((box1 as number[]).map((v) => v * 2));

    // Colours and text are size-invariant — a scaled trace must not restyle.
    expect(argsOf(two, "set:fillStyle")).toEqual(argsOf(one, "set:fillStyle"));
    expect(argsOf(two, "fillText")[0][0]).toBe(argsOf(one, "fillText")[0][0]);
  });

  it("degrades an unparseable font family to Arial instead of the 10px default", async () => {
    // The 2D spec ignores the assignment silently, so without the sentinel
    // probe the layer would render at 10px sans-serif in BOTH preview and
    // export with nothing reported anywhere.
    const bad = trace(await rasterizeOverlay([{ ...textLayer, font: "Ha; }x" }], {}, W, H, META));
    const px = textLayer.size * H; // 0.06 of the output height
    const fonts = argsOf(bad, "set:font").map((a) => String(a[0]));
    expect(fonts).toEqual(["1px monospace", `700 ${px}px Arial`]);

    const good = trace(await rasterizeOverlay([textLayer], {}, W, H, META));
    expect(argsOf(good, "set:font").map((a) => String(a[0]))).toEqual([
      "1px monospace",
      `700 ${px}px Georgia`,
    ]);
    // Same geometry either way — only the family degraded.
    expect(argsOf(bad, "fillText")).toEqual(argsOf(good, "fillText"));
  });

  it("re-decodes when an asset id is reused with different bytes", async () => {
    // Save-as + edit, or a gallery item, can reuse an id for new image bytes.
    // An id-only cache would keep serving the stale bitmap — in exports too.
    const first = trace(await rasterizeOverlay([logoLayer], assets(), W, H, META));
    const second = trace(
      await rasterizeOverlay([logoLayer], assets("data:image/png;base64,LOGO-V2"), W, H, META),
    );
    expect(argsOf(first, "drawImage")[0][0]).toBe("bmp:ase64,LOGO");
    expect(argsOf(second, "drawImage")[0][0]).toBe("bmp:64,LOGO-V2");
    // ...and the new aspect ratio is honoured (200x100 box vs a square one).
    const box = (ops: Op[]) =>
      (ops.filter((o) => o.op === "drawImage")[0].args as number[]).slice(3);
    expect(box(first)).not.toEqual(box(second));
  });

  it("skips a missing or corrupt asset instead of losing the whole overlay", async () => {
    const missing = trace(await rasterizeOverlay([logoLayer, textLayer], {}, W, H, META));
    expect(argsOf(missing, "drawImage")).toEqual([]);
    expect(argsOf(missing, "fillText").length).toBe(1);

    vi.stubGlobal("fetch", async () => {
      throw new Error("corrupt asset");
    });
    const corrupt = trace(await rasterizeOverlay([logoLayer, textLayer], assets(), W, H, META));
    expect(argsOf(corrupt, "drawImage")).toEqual([]);
    expect(argsOf(corrupt, "fillText").length).toBe(1);
  });

  it("returns null when nothing would be drawn", async () => {
    expect(await rasterizeOverlay([], assets(), W, H, META)).toBeNull();
    expect(await rasterizeOverlay([{ ...textLayer, opacity: 0 }], assets(), W, H, META)).toBeNull();
    expect(await rasterizeOverlay([textLayer], assets(), 1, 1, META)).toBeNull();
  });
});
