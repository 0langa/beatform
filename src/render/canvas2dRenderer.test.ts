import { describe, expect, it } from "vitest";
import {
  Canvas2DRenderer,
  FALLBACK_PARAM_KEYS,
  fallbackHue,
  LED_MATRIX_HUE_KEYS,
} from "./canvas2dRenderer";
import { ledMatrix } from "./presets/ledMatrix";
import { spectrumBars } from "./presets/spectrumBars";
import { allParams, BG_IMAGE, BG_PRESET, BG_SOLID, BG_VIDEO, paramOr } from "./types";
import type { BgFit } from "./types";
import type { AudioFeatures } from "../audio/types";

/**
 * Audit F9: the Canvas2D fallback hardcoded a cover crop and never read the
 * v2.48 background fit/zoom/offset controls at all, so a segmented control and
 * three sliders moved nothing; and BG_VIDEO matched no branch, falling through
 * to the preset's animated hue wash — a background nobody chose.
 *
 * These drive the renderer against a recording 2D context (no jsdom: the
 * class only needs `width`/`height` and the handful of ctx calls below), and
 * assert the destination rectangle drawImage receives. That rectangle is the
 * whole of the fix, and pinning it is also what proves the DEFAULT — a
 * background carrying no fit fields, which is what every project saved before
 * v2.48 holds — still lands exactly where the old cover crop put it.
 */

interface DrawCall {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function harness(canvasW: number, canvasH: number) {
  const draws: DrawCall[] = [];
  const fills: string[] = [];
  let fillStyle = "";
  const ctx = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
    },
    clearRect: () => {},
    fillRect: () => fills.push(fillStyle),
    drawImage: (_img: unknown, dx: number, dy: number, dw: number, dh: number) =>
      draws.push({ dx, dy, dw, dh }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    closePath: () => {},
    fill: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  const canvas = {
    width: canvasW,
    height: canvasH,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { renderer: new Canvas2DRenderer(canvas), draws, fills };
}

/** A bitmap is only ever read for its dimensions on these paths. */
function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

/** Silence: the bars draw nothing, so drawImage calls are the background's. */
const SILENCE: AudioFeatures = {
  bins: new Float32Array(4),
  peaks: new Float32Array(4),
  waveform: new Float32Array(4),
  waveformL: new Float32Array(4),
  waveformR: new Float32Array(4),
  rms: 0,
  energy: 0,
  voice: 0,
  drive: 0,
  driveBeat: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  width: 0,
  lufs: -70,
  kick: 0,
  snare: 0,
  hat: 0,
  bpm: 0,
  beatPhase: 0,
  barPhase: 0,
  beat: false,
  beatIntensity: 0,
  time: 0,
  duration: 0,
};

function drawBg(
  canvasW: number,
  canvasH: number,
  imgW: number,
  imgH: number,
  fit: BgFit | undefined,
): DrawCall {
  const { renderer, draws } = harness(canvasW, canvasH);
  renderer.setBackground({
    mode: BG_IMAGE,
    color: [0, 0, 0],
    image: { assetId: "a", dim: 0, blur: 0, ...fit },
  });
  renderer.setBackgroundImage(bitmap(imgW, imgH));
  renderer.render(SILENCE, 0, {});
  expect(draws).toHaveLength(1);
  return draws[0];
}

describe("Canvas2DRenderer background framing (F9)", () => {
  it("with no fit fields, reproduces the centred cover crop it replaced", () => {
    // A 2:1 image in a 1:1 frame: cover scales by height, crops the sides.
    // Old code: scale = max(400/800, 400/400) = 1 -> 800x400 at (-200, 0).
    expect(drawBg(400, 400, 800, 400, undefined)).toEqual({
      dx: -200,
      dy: 0,
      dw: 800,
      dh: 400,
    });
    // ...and the other orientation: a 1:2 image in a 1:1 frame crops top and
    // bottom instead. Old code: scale = max(400/400, 400/800) = 1.
    expect(drawBg(400, 400, 400, 800, undefined)).toEqual({
      dx: 0,
      dy: -200,
      dw: 400,
      dh: 800,
    });
  });

  it("Fit (contain) letterboxes instead of cropping — the control used to do nothing", () => {
    // Same 2:1 image, same 1:1 frame: now the WHOLE image is inside, with
    // bars above and below.
    expect(drawBg(400, 400, 800, 400, { fit: 1 })).toEqual({
      dx: 0,
      dy: 100,
      dw: 400,
      dh: 200,
    });
  });

  it("Stretch fills the frame exactly, distorting the shape", () => {
    expect(drawBg(400, 400, 800, 400, { fit: 2 })).toEqual({
      dx: 0,
      dy: 0,
      dw: 400,
      dh: 400,
    });
  });

  it("zoom magnifies about the centre and offsets pan in frame units", () => {
    // Stretch keeps the aspect maths out of the way, so this isolates the
    // zoom/offset half of fitUV's inverse.
    expect(drawBg(400, 400, 400, 400, { fit: 2, zoom: 2 })).toEqual({
      dx: -200,
      dy: -200,
      dw: 800,
      dh: 800,
    });
    // Offset is in FRAME widths/heights: +0.25 moves the image a quarter of
    // the frame to the right, and does not scale with zoom.
    expect(drawBg(400, 400, 400, 400, { fit: 2, offsetX: 0.25, offsetY: -0.5 })).toEqual({
      dx: 100,
      dy: -200,
      dw: 400,
      dh: 400,
    });
  });

  it("paints the letterbox in the background COLOUR, like the shader's inBox() branch", () => {
    const { renderer, fills } = harness(400, 400);
    renderer.setBackground({
      mode: BG_IMAGE,
      color: [1, 0, 0],
      image: { assetId: "a", dim: 0, blur: 0, fit: 1 },
    });
    renderer.setBackgroundImage(bitmap(800, 400));
    renderer.render(SILENCE, 0, {});
    expect(fills[0]).toBe("rgb(255 0 0)");
  });

  it("draws a video background as the flat background colour, not the animated wash", () => {
    // BG_VIDEO matched no branch and fell through to the preset background,
    // so choosing Video produced a hue wash that tracked `hue` — a background
    // the user never picked, silently different from every other renderer.
    const { renderer, fills } = harness(400, 400);
    renderer.setBackground({
      mode: BG_VIDEO,
      color: [0, 0.5, 1],
      video: { assetId: "v", dim: 0, blur: 0 },
    });
    renderer.render(SILENCE, 0, { hue: 210 });
    expect(fills[0]).toBe("rgb(0 127.5 255)");
  });

  it("still draws the preset's own animated background for BG_PRESET", () => {
    const { renderer, fills } = harness(400, 400);
    renderer.setBackground({ mode: BG_PRESET, color: [0, 0, 0] });
    renderer.render(SILENCE, 0, { hue: 210 });
    expect(fills.slice(0, 3)).toEqual(["hsl(250 50% 4%)", "hsl(210 85% 45%)", "hsl(210 30% 90%)"]);
  });

  it("applies saturation and lightness to the whole authored look", () => {
    const { renderer, fills } = harness(400, 400);
    renderer.setBackground({ mode: BG_PRESET, color: [0, 0, 0] });
    renderer.render(SILENCE, 0, {
      hue: 210,
      saturation: 0,
      lightness: 2,
    });
    expect(fills.slice(0, 3)).toEqual(["hsl(250 0% 8%)", "hsl(210 0% 90%)", "hsl(210 0% 100%)"]);
  });

  it("fills solid mode with the chosen colour", () => {
    const { renderer, fills } = harness(400, 400);
    renderer.setBackground({ mode: BG_SOLID, color: [0, 0, 0] });
    renderer.render(SILENCE, 0, {});
    expect(fills[0]).toBe("rgb(0 0 0)");
  });
});

/**
 * Audit B0: the fallback bars read `hue`/`hueSpread`, but led-matrix names
 * its hue family `hueShift`/`hueLow`/`hueHigh` — so the one GPU mode with
 * full colour controls lost its hue entirely on the fallback and drew
 * default-blue bars. fallbackHue() maps the wall's low->high gradient onto
 * the bars' left->right sweep, with defaults resolved from the preset's own
 * spec (paramOr — never a re-hardcoded literal, audit RP-9).
 */
describe("Canvas2DRenderer led-matrix hue mapping (B0)", () => {
  it("resolves led-matrix defaults to the wall's green->red sweep, from the spec", () => {
    const { hue, hueSpread } = fallbackHue(ledMatrix, {});
    // Derived from the schema, so a deliberate default retune moves this
    // test's expectation with it instead of pinning stale literals.
    const low = paramOr(ledMatrix, {}, "hueLow");
    const high = paramOr(ledMatrix, {}, "hueHigh");
    expect(hue).toBe(low);
    expect(hueSpread).toBe(high - low);
    // And the shipped defaults ARE the classic green->red wall.
    expect(hue).toBe(120);
    expect(hueSpread).toBe(-120);
  });

  it("honours hueShift and the low/high gradient the user dialed", () => {
    expect(fallbackHue(ledMatrix, { hueShift: 90 })).toEqual({ hue: 210, hueSpread: -120 });
    expect(fallbackHue(ledMatrix, { hueLow: 200, hueHigh: 320 })).toEqual({
      hue: 200,
      hueSpread: 120,
    });
  });

  it("leaves every other preset on the generic hue/hueSpread read", () => {
    expect(fallbackHue(null, { hue: 30, hueSpread: 10 })).toEqual({ hue: 30, hueSpread: 10 });
    expect(fallbackHue(spectrumBars, {})).toEqual({ hue: 210, hueSpread: 80 });
  });

  it("paints led-matrix bars in the mode's palette once the preset is set", () => {
    const { renderer, fills } = harness(400, 400);
    renderer.setBackground({ mode: BG_SOLID, color: [0, 0, 0] });
    renderer.setPreset(ledMatrix);
    renderer.render(SILENCE, 0, {});
    // First bar (bin 0) paints at the gradient's low end — green, not the
    // default-blue 210 the missing key used to fall through to.
    expect(fills).toContain("hsl(120 85% 45%)");
    expect(fills).not.toContain("hsl(210 85% 45%)");
  });

  it("pins the fallback's param-key coverage against the schemas it mirrors", () => {
    // The generic read is spectrum-bars vocabulary — the mode this renderer
    // approximates. A key rename there would orphan the fallback silently.
    const barsKeys = new Set(allParams(spectrumBars).map((p) => p.key));
    for (const key of FALLBACK_PARAM_KEYS) {
      expect(barsKeys.has(key), `spectrum-bars lost fallback key "${key}"`).toBe(true);
    }
    // The led-matrix branch reads its hue family plus the shared generic
    // keys that mode also carries (saturation/lightness/peaks).
    const ledKeys = new Set(allParams(ledMatrix).map((p) => p.key));
    for (const key of [...LED_MATRIX_HUE_KEYS, "saturation", "lightness", "peaks"]) {
      expect(ledKeys.has(key), `led-matrix lost fallback key "${key}"`).toBe(true);
    }
  });
});
