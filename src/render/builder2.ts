import type { ParamSpec, PresetDef } from "./types";

/**
 * Builder Studio — the data-driven layer compositor (v2.42.0).
 *
 * A stack is an ordered list of layer INSTANCES (arbitrary count up to
 * BUILDER_MAX_LAYERS, duplicates welcome), each with its own enable, blend,
 * opacity, color and per-type parameters. The stack compiles to ONE fragment
 * preset: the snippet library below contributes a `layer_<type>` function per
 * distinct type used, and the generated `preset()` calls them in stack order.
 *
 * Per-instance parameters do NOT ride the 48-lane `params` array (a deep
 * stack would blow it). They live in the `builderLayers` storage buffer
 * (binding 10; 16 f32 slots per layer, read via `LP(li, slot)`), so a
 * parameter tweak is a buffer write, never a recompile. Only STRUCTURAL
 * edits (add/remove/reorder/type/blend) generate a new PresetDef — cached by
 * structure key, so A→B→A stack shapes reuse compiled pipelines (the M5
 * lesson).
 *
 * Determinism: snippets read only the audio ABI (u.*, bins/peaks/waveform)
 * and LP() — no wall-clock, no Math.random. Same rules as every preset.
 *
 * The ORIGINAL `builder` preset is untouched: existing projects keep
 * rendering byte-identically. Builder Studio is a separate preset id.
 */

export const BUILDER2_ID = "builder2";
export const BUILDER_MAX_LAYERS = 12;
/** f32 slots per layer instance in the storage buffer. */
export const LAYER_SLOTS = 16;
/** Slot assignments: 0 = effective opacity (0 when muted), 1 = hue offset,
 * 2 = hue spread, 3.. = per-type params in spec order. */
const SLOT_TYPE_PARAMS = 3;
/** Type params per layer = slots minus the three fixed ones. */
export const MAX_TYPE_PARAMS = LAYER_SLOTS - SLOT_TYPE_PARAMS;

export type BuilderBlend = "normal" | "add" | "screen";

export interface BuilderLayer {
  /** Instance id (list keys / reorder). */
  id: string;
  /** Layer type — key into BUILDER_LAYER_TYPES. */
  type: string;
  enabled: boolean;
  /** 0..1, multiplied into the blend. */
  opacity: number;
  blend: BuilderBlend;
  /** Per-layer color: hue offset (deg) + spread. */
  hue: number;
  hueSpread: number;
  /** Per-type parameter values, keyed by ParamSpec key. */
  params: Record<string, number>;
}

export interface BuilderStack {
  layers: BuilderLayer[];
}

export interface BuilderLayerType {
  type: string;
  label: string;
  description: string;
  /** Per-instance params (≤ MAX_TYPE_PARAMS). Slot = 3 + index. */
  params: ParamSpec[];
  /** WGSL: must define `fn layer_<type>(uv: vec2f, li: u32, colIn: vec3f) -> vec3f`
   * returning the fully composited result over colIn. Reads its parameters
   * via TP(li, n) = LP(li, 3+n) in spec order; hue/spread via LH(li)/LS(li). */
  wgsl: string;
}

/** Shared snippet prelude: fixed-slot accessors every layer function uses. */
const LAYER_PRELUDE = /* wgsl */ `
fn LH(li: u32) -> f32 { return LP(li, 1u); }   // hue offset (deg)
fn LSp(li: u32) -> f32 { return LP(li, 2u); }  // hue spread
fn TP(li: u32, n: u32) -> f32 { return LP(li, 3u + n); }
`;

/* ---- Layer type library. Bodies are ports of the classic Builder blocks
 * (same math, params moved to storage slots, per-layer hue/spread). ---- */

const washType: BuilderLayerType = {
  type: "wash",
  label: "Background wash",
  description: "Soft center glow + a tempo-true beat flash — the classic Builder backdrop",
  params: [
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "flash", label: "Beat flash", min: 0, max: 1, step: 0.01, default: 0.35 },
  ],
  wgsl: /* wgsl */ `
fn layer_wash(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  let p = centered(uv);
  let r = length(p);
  let beatP = max(u.driveBeat, gridPulse(6.0));
  var col = colIn;
  col += hsl2rgb(LH(li) + 40.0, 0.5, 0.05 + u.bass * 0.04) * (1.0 - r * 0.8) * TP(li, 0u) * 2.0;
  col += hsl2rgb(LH(li), 0.7, 0.5) * beatP * TP(li, 1u) * (1.0 - r);
  return col;
}`,
};

const starsType: BuilderLayerType = {
  type: "stars",
  label: "Particles",
  description: "Drifting bokeh particles with per-particle wander and a beat scatter",
  params: [
    { key: "density", label: "Density", min: 4, max: 24, step: 1, default: 10 },
    { key: "speed", label: "Drift speed", min: 0, max: 2, step: 0.01, default: 0.6 },
    { key: "streak", label: "Beat scatter", min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  wgsl: /* wgsl */ `
fn layer_stars(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  var col = colIn;
  let pp = vec2f(uv.x * u.aspect, uv.y);
  let spd = TP(li, 1u) * (0.3 + u.drive * 0.9);
  for (var l = 0; l < 2; l++) {
    let fl = f32(l);
    let n = TP(li, 0u) * (1.0 + fl * 0.4);
    let q = pp * n - vec2f(0.0, -u.time * spd * n * 0.1);
    let base = floor(q);
    let f = q - base;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let cell = base + vec2f(f32(dx), f32(dy));
        let h1 = hash21(cell + fl * 77.3);
        if (h1 > 0.65) { continue; }
        let h2 = hash21(cell + fl * 77.3 + 31.7);
        let h3 = hash21(cell + fl * 77.3 + 63.1);
        let ph = h2 * TAU;
        let wob = vec2f(sin(u.time * 0.4 * (0.5 + h2) + ph),
                        cos(u.time * 0.4 * (0.7 + h3) + ph * 1.7)) * 0.3;
        let scat = normalize(vec2f(h2 - 0.5, h3 - 0.5) + 1e-4)
                 * u.driveBeat * TP(li, 2u) * 0.5;
        let d = f - (vec2f(f32(dx), f32(dy)) + 0.5 + wob + scat);
        let s = 0.14 * (0.5 + h1) * (1.0 - fl * 0.25);
        let dist = length(d);
        let core = smoothstep(s * 0.38, s * 0.16, dist);
        let halo = exp(-dot(d, d) / max(s * s * 0.5, 1e-5)) * 0.15;
        col += hsl2rgb(LH(li) + (h2 - 0.5) * LSp(li), 0.5, 0.8)
             * (core + halo) * (1.0 - fl * 0.3) * 0.8;
      }
    }
  }
  return col;
}`,
};

const barsType: BuilderLayerType = {
  type: "bars",
  label: "Spectrum bars",
  description: "Bottom-anchored spectrum bars (honors Detail + Smooth-spectrum masters)",
  params: [
    { key: "height", label: "Height", min: 0.1, max: 0.9, step: 0.01, default: 0.5 },
    { key: "gap", label: "Gap", min: 0, max: 0.6, step: 0.01, default: 0.25 },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "peaks", label: "Peak caps", min: 0, max: 1, step: 1, default: 1 },
  ],
  wgsl: /* wgsl */ `
fn layer_bars(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  var col = colIn;
  let n = round(mix(8.0, f32(u.binCount), u.detail));
  let fi = clamp(uv.x * n, 0.0, n - 0.001);
  let i = u32(fi);
  let inBar = fract(fi);
  let barCenter = (f32(i) + 0.5) / n;
  var v = binAt(barCenter);
  var pk = peakAt(barCenter);
  var gapMask = step(TP(li, 1u) * 0.5, inBar) * step(inBar, 1.0 - TP(li, 1u) * 0.5);
  if (u.smoothBins > 0.5) {
    v = binAt(uv.x);
    pk = peakAt(uv.x);
    gapMask = 1.0;
  }
  let y = 1.0 - uv.y;
  let barH = v * TP(li, 0u);
  let bHue = LH(li) + (fi / n) * LSp(li);
  if (y < barH) {
    let g = y / max(barH, 0.001);
    col = mix(col, hsl2rgb(bHue, 0.85, 0.35 + g * 0.3), gapMask);
  } else {
    col += hsl2rgb(bHue, 0.9, 0.5) * exp(-(y - barH) * 12.0) * TP(li, 2u) * v * gapMask;
  }
  if (TP(li, 3u) > 0.5) {
    let capD = abs(y - pk * TP(li, 0u));
    col += hsl2rgb(bHue, 0.3, 0.9) * smoothstep(0.005, 0.0, capD) * gapMask * 0.8;
  }
  return col;
}`,
};

const radialType: BuilderLayerType = {
  type: "radial",
  label: "Radial ring",
  description: "Mirrored spectrum bars radiating from a center ring",
  params: [
    { key: "inner", label: "Ring size", min: 0.05, max: 0.4, step: 0.01, default: 0.18 },
    { key: "len", label: "Bar reach", min: 0.05, max: 0.45, step: 0.01, default: 0.22 },
    { key: "sym", label: "Symmetry", min: 1, max: 8, step: 1, default: 2 },
  ],
  wgsl: /* wgsl */ `
fn layer_radial(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  var col = colIn;
  let p = centered(uv);
  let r = length(p);
  let a = atan2(p.y, p.x);
  let seg = fract(a / TAU * TP(li, 2u) + 10.0);
  let xs = abs(seg * 2.0 - 1.0);
  let v = binAt(xs);
  let inner = TP(li, 0u) * (1.0 + u.bass * 0.1);
  let len = min(v * TP(li, 1u), max(0.0, 0.47 - inner));
  let rHue = LH(li) + xs * LSp(li);
  let inBar = step(inner, r) * step(r, inner + len);
  let radial = (r - inner) / max(len, 0.001);
  col = mix(col, hsl2rgb(rHue, 0.85, 0.35 + radial * 0.35), inBar);
  col += hsl2rgb(rHue, 0.9, 0.5) * exp(-max(r - inner - len, 0.0) * 16.0) * 0.4 * v
       * step(inner + len, r);
  return col;
}`,
};

const ringsType: BuilderLayerType = {
  type: "rings",
  label: "Pulse rings",
  description: "Tempo-locked rings born on each beat, arriving as the next lands",
  params: [
    { key: "start", label: "Born at", min: 0, max: 0.3, step: 0.01, default: 0.05 },
    { key: "end", label: "Reach", min: 0.2, max: 0.7, step: 0.01, default: 0.48 },
    { key: "sharp", label: "Sharpness", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "bright", label: "Brightness", min: 0, max: 1.5, step: 0.01, default: 0.8 },
  ],
  wgsl: /* wgsl */ `
fn layer_rings(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  var col = colIn;
  let r = length(centered(uv));
  var pt = 1.0 - u.driveBeat;
  var amp = u.driveBeat;
  if (u.bpm > 0.5) {
    pt = u.beatPhase;
    amp = max(exp(-u.beatPhase * 2.5) - 0.08, 0.0) / 0.92;
  }
  if (amp > 0.005) {
    let ringR = mix(TP(li, 0u), TP(li, 1u), pt);
    let d = abs(r - ringR);
    let ringHue = LH(li) + 15.0 + pt * LSp(li) * 0.3;
    col += hsl2rgb(ringHue, 0.8, 0.55)
         * exp(-d * (30.0 + TP(li, 2u) * 90.0)) * amp * TP(li, 3u);
  }
  return col;
}`,
};

const waveCircleType: BuilderLayerType = {
  type: "wavecircle",
  label: "Waveform circle",
  description: "The live waveform bent into a breathing circle",
  params: [
    { key: "radius", label: "Radius", min: 0.1, max: 0.42, step: 0.01, default: 0.24 },
    { key: "amp", label: "Wave depth", min: 0, max: 0.2, step: 0.005, default: 0.08 },
  ],
  wgsl: /* wgsl */ `
fn layer_wavecircle(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  var col = colIn;
  let p = centered(uv);
  let r = length(p);
  let a = atan2(p.y, p.x);
  let wv = waveAt(fract(a / TAU + 0.5));
  let cr = min(TP(li, 0u) + wv * TP(li, 1u) * (0.5 + u.drive * 1.2), 0.47);
  let d = abs(r - cr);
  let cHue = LH(li) + 30.0 + wv * 25.0;
  col += hsl2rgb(cHue, 0.7, 0.55) * smoothstep(0.004, 0.0008, d) * 0.7;
  col += hsl2rgb(cHue, 0.8, 0.5) * exp(-d * 110.0) * 0.25;
  return col;
}`,
};

const orbType: BuilderLayerType = {
  type: "orb",
  label: "Orb core",
  description: "A pumping center orb that pops on the beat",
  params: [
    { key: "size", label: "Size", min: 0.05, max: 0.35, step: 0.01, default: 0.16 },
    { key: "pump", label: "Pump", min: 0, max: 1.5, step: 0.01, default: 0.7 },
    { key: "wobble", label: "Wobble", min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: "beat", label: "Beat pop", min: 0, max: 1.5, step: 0.01, default: 0.8 },
  ],
  wgsl: /* wgsl */ `
fn layer_orb(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  var col = colIn;
  let p = centered(uv);
  let r = length(p);
  let a = atan2(p.y, p.x);
  let level = clamp(u.drive * 1.6, 0.0, 1.0);
  let beatKick = clamp(gridPulse(7.0) * TP(li, 3u), 0.0, 1.0);
  let spin = u.time * 0.35;
  let amp = TP(li, 0u) * TP(li, 2u) * (0.1 + level * 0.35);
  let wob = sin(a * 3.0 + spin) * amp + sin(a * 6.0 - spin * 0.8 + 1.5) * amp * 0.4;
  let orbR = min(TP(li, 0u) * (1.0 + level * TP(li, 1u) + beatKick * 0.4) + wob, 0.44);
  let inside = smoothstep(orbR, orbR - 0.01, r);
  let body = hsl2rgb(LH(li) + 20.0, 0.7, 0.18 + level * 0.3 + beatKick * 0.25 + exp(-r * 6.0) * 0.2);
  col = mix(col, body, inside);
  col += hsl2rgb(LH(li) + 20.0, 0.8, 0.6) * smoothstep(0.005, 0.0, abs(r - orbR)) * 0.6;
  return col;
}`,
};

const waveLineType: BuilderLayerType = {
  type: "waveline",
  label: "Wave line",
  description: "A glowing horizontal oscilloscope trace",
  params: [
    { key: "y", label: "Position", min: 0.1, max: 0.9, step: 0.01, default: 0.5 },
    { key: "amp", label: "Amplitude", min: 0, max: 0.4, step: 0.01, default: 0.18 },
    { key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  wgsl: /* wgsl */ `
fn layer_waveline(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  var col = colIn;
  let w = (waveAt(uv.x) * 0.5 + waveAt(uv.x + 0.008) * 0.3 + waveAt(uv.x - 0.008) * 0.2)
        / (0.35 + u.drive * 1.2);
  let y = TP(li, 0u) + clamp(w * TP(li, 1u), -0.4, 0.4);
  let d = abs(uv.y - y);
  let lHue = LH(li) + w * 30.0;
  col += hsl2rgb(lHue, 0.85, 0.62) * smoothstep(0.003, 0.0007, d);
  col += hsl2rgb(lHue, 0.9, 0.5) * exp(-d * (100.0 - TP(li, 2u) * 60.0)) * (0.3 + TP(li, 2u) * 0.5);
  return col;
}`,
};

const vignetteType: BuilderLayerType = {
  type: "vignette",
  label: "Vignette",
  description: "Darkens toward the corners — a finishing layer for the stack",
  params: [{ key: "amount", label: "Amount", min: 0, max: 1.5, step: 0.01, default: 0.6 }],
  wgsl: /* wgsl */ `
fn layer_vignette(uv: vec2f, li: u32, colIn: vec3f) -> vec3f {
  let r = length(centered(uv));
  return colIn * (1.0 - r * r * TP(li, 0u));
}`,
};

export const BUILDER_LAYER_TYPES: BuilderLayerType[] = [
  washType,
  starsType,
  barsType,
  radialType,
  ringsType,
  waveCircleType,
  orbType,
  waveLineType,
  vignetteType,
];

const TYPE_BY_ID = new Map(BUILDER_LAYER_TYPES.map((t) => [t.type, t]));

export function builderLayerType(type: string): BuilderLayerType | undefined {
  return TYPE_BY_ID.get(type);
}

let idSeq = 0;
export function newLayerId(): string {
  // Not Date.now(): determinism rules ban wall-clock in anything that could
  // reach a pixel, and ids only need in-session uniqueness (persisted ids
  // travel with the document).
  idSeq += 1;
  return `bl-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newLayer(type: string): BuilderLayer {
  const t = TYPE_BY_ID.get(type);
  const params: Record<string, number> = {};
  for (const p of t?.params ?? []) params[p.key] = p.default;
  return {
    id: newLayerId(),
    type,
    enabled: true,
    opacity: 1,
    blend: "normal",
    hue: 210,
    hueSpread: 90,
    params,
  };
}

/** The starter stack — the classic Builder look, now editable layer by layer. */
export function defaultBuilderStack(): BuilderStack {
  return {
    layers: [newLayer("wash"), newLayer("stars"), newLayer("bars"), newLayer("rings")],
  };
}

/** Whitelist-validate an untrusted stack (project files, .avbuilder). */
export function validBuilderStack(v: unknown): BuilderStack {
  const raw = (typeof v === "object" && v !== null ? v : {}) as Partial<BuilderStack>;
  const layers: BuilderLayer[] = [];
  if (Array.isArray(raw.layers)) {
    for (const l of raw.layers as Array<Partial<BuilderLayer>>) {
      if (layers.length >= BUILDER_MAX_LAYERS) break;
      if (typeof l !== "object" || l === null) continue;
      const t = typeof l.type === "string" ? TYPE_BY_ID.get(l.type) : undefined;
      if (!t) continue;
      const num = (x: unknown, def: number, lo: number, hi: number) =>
        typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def;
      const params: Record<string, number> = {};
      for (const p of t.params) {
        params[p.key] = num(
          (l.params as Record<string, unknown> | undefined)?.[p.key],
          p.default,
          p.min,
          p.max,
        );
      }
      layers.push({
        id: typeof l.id === "string" && l.id ? l.id.slice(0, 24) : newLayerId(),
        type: t.type,
        enabled: l.enabled !== false,
        opacity: num(l.opacity, 1, 0, 1),
        blend: l.blend === "add" || l.blend === "screen" ? l.blend : "normal",
        hue: num(l.hue, 210, 0, 360),
        hueSpread: num(l.hueSpread, 90, 0, 360),
        params,
      });
    }
  }
  return { layers };
}

// --- .avbuilder file format (share a layer stack as one JSON file) ---

export const BUILDER_FILE_VERSION = 1;

export function serializeBuilderStack(stack: BuilderStack, appVersion: string): string {
  return JSON.stringify(
    { kind: "avbuilder", schemaVersion: BUILDER_FILE_VERSION, appVersion, stack },
    null,
    2,
  );
}

export class BuilderParseError extends Error {}

export function parseBuilderStack(json: string): BuilderStack {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BuilderParseError("Not a valid JSON file");
  }
  const f = raw as {
    kind?: string;
    schemaVersion?: number;
    stack?: unknown;
  };
  if (typeof f !== "object" || f === null || f.kind !== "avbuilder") {
    throw new BuilderParseError("Not an .avbuilder file");
  }
  if (typeof f.schemaVersion !== "number" || f.schemaVersion > BUILDER_FILE_VERSION) {
    throw new BuilderParseError("Builder file from a newer app version; update the app");
  }
  return validBuilderStack(f.stack);
}

/** Structural identity: anything that changes the GENERATED CODE. Values
 * (opacity/hue/params) live in the storage buffer and don't recompile. */
export function stackStructureKey(stack: BuilderStack): string {
  return stack.layers.map((l) => `${l.type}.${l.blend}`).join("|") || "empty";
}

/** Pack the stack's values into the builderLayers storage block. */
export function packBuilderParams(stack: BuilderStack): Float32Array {
  const data = new Float32Array(BUILDER_MAX_LAYERS * LAYER_SLOTS);
  stack.layers.slice(0, BUILDER_MAX_LAYERS).forEach((l, i) => {
    const t = TYPE_BY_ID.get(l.type);
    const base = i * LAYER_SLOTS;
    data[base] = l.enabled ? l.opacity : 0;
    data[base + 1] = l.hue;
    data[base + 2] = l.hueSpread;
    t?.params.forEach((p, n) => {
      if (n < MAX_TYPE_PARAMS) data[base + SLOT_TYPE_PARAMS + n] = l.params[p.key] ?? p.default;
    });
  });
  return data;
}

/** Emit the blend line for one instance. `lcol` is the layer's full result
 * over colIn, so its own contribution is (lcol - colBefore) — blend modes
 * act on that contribution, which keeps "add"/"screen" meaningful for layers
 * that internally mix rather than add. */
function blendLine(blend: BuilderBlend, i: number): string {
  const op = `LP(${i}u, 0u)`;
  switch (blend) {
    case "add":
      return `col += max(lcol${i} - col, vec3f(0.0)) * ${op};`;
    case "screen":
      return (
        `let d${i} = clamp(max(lcol${i} - col, vec3f(0.0)) * ${op}, vec3f(0.0), vec3f(1.0));\n` +
        `  col = 1.0 - (1.0 - col) * (1.0 - d${i});`
      );
    default:
      return `col = mix(col, lcol${i}, ${op});`;
  }
}

/** Generate the full preset WGSL for a stack: used snippet functions +
 * a preset() that runs the layers in order. */
export function buildStackWgsl(stack: BuilderStack): string {
  const used = [...new Set(stack.layers.map((l) => l.type))]
    .map((t) => TYPE_BY_ID.get(t))
    .filter((t): t is BuilderLayerType => !!t);
  const body = stack.layers
    .slice(0, BUILDER_MAX_LAYERS)
    .map((l, i) => {
      return `  let lcol${i} = layer_${l.type}(uv, ${i}u, col);\n  ${blendLine(l.blend, i)}`;
    })
    .join("\n");
  return (
    LAYER_PRELUDE +
    used.map((t) => t.wgsl).join("\n") +
    `
fn preset(uv: vec2f) -> vec4f {
  var col = vec3f(0.0);
${body}
  return vec4f(col, 1.0);
}`
  );
}

/* ---- The live def: "builder2" resolves to a generated PresetDef whose
 * OBJECT IDENTITY changes only on structural edits, so the render loop's
 * identity check and the renderer's pipeline cache both do the right thing
 * for free. ---- */

const defCache = new Map<string, PresetDef>();
let currentDef: PresetDef = makeDef(defaultBuilderStack());

function makeDef(stack: BuilderStack): PresetDef {
  const key = stackStructureKey(stack);
  const cached = defCache.get(key);
  if (cached) return cached;
  const def: PresetDef = {
    id: BUILDER2_ID,
    name: "Builder Studio",
    description: "Layer-based compositor — stack, blend and tune elements freely",
    params: [],
    wgsl: buildStackWgsl(stack),
  };
  defCache.set(key, def);
  return def;
}

/** The def for the CURRENT stack structure. */
export function currentBuilder2Def(): PresetDef {
  return currentDef;
}

/** Rebuild after a stack edit. Returns the def (new object only when the
 * structure changed). */
export function rebuildBuilder2(stack: BuilderStack): PresetDef {
  currentDef = makeDef(stack);
  return currentDef;
}
