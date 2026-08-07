import type { ParamGroupDef, ParamSpec, ParamValues, PresetDef } from "./types";

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
  let tipSoft = softLimit(inner + v * TP(li, 1u), frameReach(a));
  let len = max(tipSoft - inner, 0.0);
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
  let cr = softLimit(TP(li, 0u) + wv * TP(li, 1u) * (0.5 + u.drive * 1.2), frameCircle());
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
  let orbR = softLimit(TP(li, 0u) * (1.0 + level * TP(li, 1u) + beatKick * 0.4) + wob, frameCircle() * 0.92);
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

/** Whitelist-validate an untrusted stack (project files, .bfbuilder). */
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

// --- .bfbuilder file format (share a layer stack as one JSON file) ---

export const BUILDER_FILE_VERSION = 1;

export function serializeBuilderStack(stack: BuilderStack, appVersion: string): string {
  return JSON.stringify(
    { kind: "bfbuilder", schemaVersion: BUILDER_FILE_VERSION, appVersion, stack },
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
  if (typeof f !== "object" || f === null || f.kind !== "bfbuilder") {
    throw new BuilderParseError("Not a .bfbuilder file");
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

/* ---- Virtual per-layer params (RP-20, the Builder bridge) ----------------
 *
 * The compiled builder2 PresetDef carries a REAL `params` list generated from
 * the stack's STRUCTURE, one spec per storage slot: `l<i>.opacity`,
 * `l<i>.hue`, `l<i>.hueSpread`, `l<i>.<paramKey>` (i = layer index in stack
 * order). That is what plugs the whole schema-driven feature stack —
 * modulation routes, MIDI bindings, automation lanes, stem auto-routing,
 * param search, saved looks — into Builder without a second editor: the
 * enumeration caches in types.ts key on the def object, value edits reuse the
 * def, structural edits mint a new one via the structure-key cache below.
 *
 * KEY FORMAT IS FOREVER: virtual keys persist in mod routes, MIDI bindings,
 * automation lanes and saved looks. Addressing is BY INDEX on purpose —
 * reordering the stack retargets an existing route to whatever layer now sits
 * at that index (accepted; routes follow the slot, not the layer identity),
 * and a key whose index/param no longer resolves is simply inert.
 *
 * The values themselves NEVER ride the 48-lane params storage buffer — they
 * live in the builderLayers block exactly as before (packBuilderFrame overlays
 * resolved virtual values onto the stack pack per frame). The renderer skips
 * P_<key>() accessor generation for dotted keys, so the generated WGSL is
 * byte-identical to the pre-bridge output.
 */

const VIRTUAL_KEY_RE = /^l(\d{1,2})\.(.+)$/;

/** True for keys of the `l<i>.<field>` virtual-param shape. */
export function isBuilderVirtualKey(key: string): boolean {
  return VIRTUAL_KEY_RE.test(key);
}

/** Virtual ParamSpec list for a stack's structure. Defaults are the newLayer
 * defaults (opacity 1, hue 210, hueSpread 90, type-param spec defaults) —
 * value-independent, so defs cached by structure key stay correct. */
export function builderVirtualParams(stack: BuilderStack): ParamSpec[] {
  const out: ParamSpec[] = [];
  stack.layers.slice(0, BUILDER_MAX_LAYERS).forEach((l, i) => {
    const t = TYPE_BY_ID.get(l.type);
    const typeLabel = t?.label ?? l.type;
    const group = `l${i}`;
    const label = (p: string) => `L${i + 1} ${typeLabel} · ${p}`;
    out.push(
      {
        key: `l${i}.opacity`,
        label: label("Opacity"),
        group,
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
        hint: "How strongly this layer contributes",
      },
      {
        key: `l${i}.hue`,
        label: label("Hue"),
        group,
        control: "hue",
        min: 0,
        max: 360,
        step: 1,
        default: 210,
        hint: "Base color of this layer",
      },
      {
        key: `l${i}.hueSpread`,
        label: label("Hue spread"),
        group,
        min: 0,
        max: 360,
        step: 1,
        default: 90,
        hint: "How far the color fans out across the layer",
      },
    );
    for (const p of (t?.params ?? []).slice(0, MAX_TYPE_PARAMS)) {
      out.push({
        key: `l${i}.${p.key}`,
        label: label(p.label),
        group,
        min: p.min,
        max: p.max,
        step: p.step,
        default: p.default,
        ...(p.hint ? { hint: p.hint } : {}),
        // Step-1 counts/toggles (bars peak caps, radial symmetry, particle
        // density) quantize applied modulation to whole numbers (RP-2 law);
        // everything else keeps the default smooth behaviour.
        ...(p.step === 1 ? { mod: "snap" as const } : {}),
      });
    }
  });
  return out;
}

/** One panel/optgroup group per layer, ranked after every shared group so the
 * lists read in stack order. */
export function builderVirtualGroups(stack: BuilderStack): ParamGroupDef[] {
  return stack.layers.slice(0, BUILDER_MAX_LAYERS).map((l, i) => ({
    id: `l${i}`,
    label: `Layer ${i + 1} · ${TYPE_BY_ID.get(l.type)?.label ?? l.type}`,
    rank: 100 + i * 10,
  }));
}

/** The stack's CURRENT values as a virtual-key record — the mirror the store
 * writes into paramsByPreset["builder2"] so frameResolve's baseOf() (and
 * everything downstream: mods, automation overlay, saved looks) resolves
 * live stack values naturally. Opacity is the RAW slider value; mute stays a
 * stack-only fact that packBuilderFrame applies at pack time. */
export function builderStackValues(stack: BuilderStack): Record<string, number> {
  const out: Record<string, number> = {};
  stack.layers.slice(0, BUILDER_MAX_LAYERS).forEach((l, i) => {
    out[`l${i}.opacity`] = l.opacity;
    out[`l${i}.hue`] = l.hue;
    out[`l${i}.hueSpread`] = l.hueSpread;
    const t = TYPE_BY_ID.get(l.type);
    for (const p of (t?.params ?? []).slice(0, MAX_TYPE_PARAMS)) {
      out[`l${i}.${p.key}`] = l.params[p.key] ?? p.default;
    }
  });
  return out;
}

/**
 * Apply virtual-key values onto a stack (setParam/MIDI/looks route through
 * this). Returns the patched stack (a new object only when something applied)
 * plus how many keys resolved; keys that don't resolve on this structure —
 * stale bindings, a look saved against a different stack — are skipped.
 * Values clamp to the spec range, mirroring validBuilderStack's clamps.
 */
export function applyVirtualValues(
  stack: BuilderStack,
  values: ParamValues,
): { stack: BuilderStack; applied: number } {
  let layers: BuilderLayer[] | null = null;
  let applied = 0;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) continue;
    const m = VIRTUAL_KEY_RE.exec(key);
    if (!m) continue;
    const i = Number(m[1]);
    if (i >= BUILDER_MAX_LAYERS) continue;
    const src = (layers ?? stack.layers)[i];
    if (!src) continue;
    const field = m[2];
    let next: BuilderLayer | null = null;
    if (field === "opacity") next = { ...src, opacity: clamp(value, 0, 1) };
    else if (field === "hue") next = { ...src, hue: clamp(value, 0, 360) };
    else if (field === "hueSpread") next = { ...src, hueSpread: clamp(value, 0, 360) };
    else {
      const spec = TYPE_BY_ID.get(src.type)?.params.find((p) => p.key === field);
      if (spec) {
        next = { ...src, params: { ...src.params, [field]: clamp(value, spec.min, spec.max) } };
      }
    }
    if (!next) continue;
    if (!layers) layers = stack.layers.slice();
    layers[i] = next;
    applied++;
  }
  return { stack: layers ? { layers } : stack, applied };
}

/**
 * Per-frame resolve chokepoint (determinism law). Modulation and automation
 * compose into the params RECORD, but builder values reach the GPU via the
 * builderLayers storage buffer — this overlays the resolved virtual values
 * onto the stack pack. BOTH render loops (services.ts live, exportCore.ts
 * export) call exactly this function, which is what keeps preview === file.
 *
 * Neutrality: with a record that carries the stack's own values (the mirror,
 * untouched by mods/automation) the result is byte-identical to
 * packBuilderParams(stack) — proven by test.
 */
export function packBuilderFrame(stack: BuilderStack, resolved: ParamValues): Float32Array {
  const data = packBuilderParams(stack);
  stack.layers.slice(0, BUILDER_MAX_LAYERS).forEach((l, i) => {
    const base = i * LAYER_SLOTS;
    const opacity = resolved[`l${i}.opacity`];
    // A muted layer stays muted: mute lives in the stack, not the record.
    if (opacity !== undefined && l.enabled) data[base] = opacity;
    const hue = resolved[`l${i}.hue`];
    if (hue !== undefined) data[base + 1] = hue;
    const hueSpread = resolved[`l${i}.hueSpread`];
    if (hueSpread !== undefined) data[base + 2] = hueSpread;
    const t = TYPE_BY_ID.get(l.type);
    t?.params.forEach((p, n) => {
      if (n >= MAX_TYPE_PARAMS) return;
      const v = resolved[`l${i}.${p.key}`];
      if (v !== undefined) data[base + SLOT_TYPE_PARAMS + n] = v;
    });
  });
  return data;
}

/** Element-wise Float32Array equality — the dirty check both render loops use
 * to upload the frame pack only when the bytes actually changed. */
export function sameF32(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

/**
 * How many compiled structures the def cache keeps.
 *
 * BOUNDED on purpose. The renderer's pipeline cache is a WeakMap keyed by the
 * PresetDef precisely so an edited preset's GPUShaderModule + pipelines become
 * collectable the moment nothing references the def any more. An unbounded Map
 * here held a strong reference to EVERY structure compiled this session, so
 * that weak cache could never drop anything: each add/remove/reorder/blend edit
 * mints a new key, and a long Builder Studio session pinned a shader module and
 * one or two pipelines per edit for as long as the tab lived.
 *
 * 16 comfortably covers the A→B→A shuffling an edit session actually does (the
 * M5 lesson this cache exists for), and an evicted structure costs one
 * recompile, not a wrong render.
 */
export const BUILDER2_DEF_CACHE_MAX = 16;

/** Structure key -> compiled def, least-recently-used FIRST (Map iterates in
 * insertion order, so the eviction candidate is always `keys().next()`). */
const defCache = new Map<string, PresetDef>();
let currentStack: BuilderStack = defaultBuilderStack();
let currentDef: PresetDef = makeDef(currentStack);

function makeDef(stack: BuilderStack): PresetDef {
  const key = stackStructureKey(stack);
  const cached = defCache.get(key);
  if (cached) {
    // Re-insert to move it to the most-recently-used end. Without this the
    // structure the user keeps returning to would age out before the ones they
    // passed through once — the exact opposite of what the cache is for.
    defCache.delete(key);
    defCache.set(key, cached);
    return cached;
  }
  const def: PresetDef = {
    id: BUILDER2_ID,
    name: "Builder",
    description: "Layer-based compositor — stack, blend and tune elements freely",
    // The virtual bridge (RP-20): real specs + per-layer groups, generated
    // from the same structure the WGSL is. Both are pure functions of the
    // structure key, so caching the def caches them correctly; the types.ts
    // WeakMap enumeration caches are correct BY CONSTRUCTION.
    params: builderVirtualParams(stack),
    groups: builderVirtualGroups(stack),
    wgsl: buildStackWgsl(stack),
  };
  defCache.set(key, def);
  if (defCache.size > BUILDER2_DEF_CACHE_MAX) {
    const oldest = defCache.keys().next();
    if (!oldest.done) defCache.delete(oldest.value);
  }
  return def;
}

/** The def for the CURRENT stack structure. */
export function currentBuilder2Def(): PresetDef {
  return currentDef;
}

/** The stack rebuildBuilder2 last installed — what the live render loop packs
 * the per-frame value overlay against (the export core carries its own copy).
 * Kept here so services.ts needs no store dependency for it. */
export function currentBuilderStack(): BuilderStack {
  return currentStack;
}

/** Rebuild after a stack edit. Returns the def (new object only when the
 * structure changed). */
export function rebuildBuilder2(stack: BuilderStack): PresetDef {
  currentStack = stack;
  currentDef = makeDef(stack);
  return currentDef;
}

/* ---- Factory stacks (RP-20) ----------------------------------------------
 *
 * Builder's equivalent of a preset's factory styles — but STRUCTURAL (layers,
 * blends, values), so they are whole stacks, not StyleDef value-bundles, and
 * def.styles stays undefined on purpose (presetStyles.test.ts exempts
 * builder2). The first entry ≙ the classic default stack, matching the styles
 * convention that the first chip reads as active on a fresh Builder.
 *
 * IDS ARE FOREVER once shipped (chips are matched by value, but the ids leak
 * into the GPU pixel-matrix baseline case names).
 */

/** A named factory stack. Apply via copyBuilderStack() so every application
 * gets fresh layer ids. */
export interface BuilderFactoryStack {
  id: string;
  name: string;
  stack: BuilderStack;
}

function factoryLayer(
  type: string,
  over: Partial<Omit<BuilderLayer, "params" | "id" | "type">> & {
    params?: Record<string, number>;
  } = {},
): BuilderLayer {
  const base = newLayer(type);
  return { ...base, ...over, params: { ...base.params, ...over.params } };
}

export const BUILDER_FACTORY_STACKS: BuilderFactoryStack[] = [
  {
    // ≙ defaultBuilderStack(): the classic Builder look, all defaults.
    id: "classic",
    name: "Classic",
    stack: defaultBuilderStack(),
  },
  {
    // Dark club floor: magenta wash, a four-way additive radial, hot rings.
    id: "neon-club",
    name: "Neon club",
    stack: {
      layers: [
        factoryLayer("wash", { hue: 290, hueSpread: 60, params: { glow: 0.35, flash: 0.6 } }),
        factoryLayer("radial", {
          blend: "add",
          hue: 320,
          hueSpread: 140,
          params: { inner: 0.22, len: 0.3, sym: 4 },
        }),
        factoryLayer("rings", {
          blend: "add",
          hue: 280,
          hueSpread: 120,
          params: { sharp: 0.7, bright: 1.1 },
        }),
        factoryLayer("vignette", { params: { amount: 0.8 } }),
      ],
    },
  },
  {
    // Synthwave horizon: warm wash, a low sun orb, a glowing trace over it.
    id: "sunset-drive",
    name: "Sunset drive",
    stack: {
      layers: [
        factoryLayer("wash", { hue: 20, hueSpread: 50, params: { glow: 0.7, flash: 0.25 } }),
        factoryLayer("orb", {
          hue: 10,
          hueSpread: 40,
          params: { size: 0.22, pump: 0.4, wobble: 0.2, beat: 0.5 },
        }),
        factoryLayer("waveline", {
          blend: "screen",
          hue: 35,
          hueSpread: 60,
          params: { y: 0.62, amp: 0.24, glow: 0.7 },
        }),
        factoryLayer("vignette", { params: { amount: 0.5 } }),
      ],
    },
  },
  {
    // Cold drift: dense slow particles behind a breathing waveform circle.
    id: "deep-space",
    name: "Deep space",
    stack: {
      layers: [
        factoryLayer("wash", { hue: 240, hueSpread: 80, params: { glow: 0.25, flash: 0.15 } }),
        factoryLayer("stars", {
          blend: "screen",
          hue: 210,
          hueSpread: 160,
          params: { density: 18, speed: 0.25, streak: 0.2 },
        }),
        factoryLayer("wavecircle", {
          blend: "add",
          hue: 190,
          hueSpread: 70,
          params: { radius: 0.28, amp: 0.1 },
        }),
        factoryLayer("vignette", { params: { amount: 0.9 } }),
      ],
    },
  },
  {
    // Gold eight-way mandala with screened tempo rings.
    id: "cathedral",
    name: "Cathedral",
    stack: {
      layers: [
        factoryLayer("wash", { hue: 45, hueSpread: 30, params: { glow: 0.4, flash: 0.25 } }),
        factoryLayer("radial", {
          hue: 45,
          hueSpread: 25,
          params: { inner: 0.12, len: 0.35, sym: 8 },
        }),
        factoryLayer("rings", {
          blend: "screen",
          hue: 50,
          hueSpread: 40,
          params: { start: 0.1, end: 0.55, bright: 0.6 },
        }),
        factoryLayer("vignette", { params: { amount: 0.7 } }),
      ],
    },
  },
  {
    // Green phosphor test bench: low bars flanked by two additive traces.
    id: "phosphor",
    name: "Phosphor",
    stack: {
      layers: [
        factoryLayer("bars", {
          hue: 130,
          hueSpread: 40,
          params: { height: 0.35, gap: 0.45, glow: 0.3 },
        }),
        factoryLayer("waveline", {
          blend: "add",
          hue: 130,
          hueSpread: 30,
          params: { y: 0.25, amp: 0.12, glow: 0.6 },
        }),
        factoryLayer("waveline", {
          blend: "add",
          hue: 160,
          hueSpread: 30,
          params: { y: 0.75, amp: 0.12, glow: 0.6 },
        }),
        factoryLayer("vignette", { params: { amount: 0.4 } }),
      ],
    },
  },
];

/** Deep-copy a stack with FRESH layer ids — how a factory chip applies, so
 * two applications never collide on instance ids. */
export function copyBuilderStack(stack: BuilderStack): BuilderStack {
  return { layers: stack.layers.map((l) => ({ ...l, id: newLayerId(), params: { ...l.params } })) };
}

/** Structure + values equal, ids ignored — the factory chips' active check. */
export function sameStackValues(a: BuilderStack, b: BuilderStack): boolean {
  if (a.layers.length !== b.layers.length) return false;
  return a.layers.every((l, i) => {
    const m = b.layers[i];
    if (l.type !== m.type || l.blend !== m.blend || l.enabled !== m.enabled) return false;
    if (l.opacity !== m.opacity || l.hue !== m.hue || l.hueSpread !== m.hueSpread) return false;
    const t = TYPE_BY_ID.get(l.type);
    return (t?.params ?? []).every(
      (p) => (l.params[p.key] ?? p.default) === (m.params[p.key] ?? p.default),
    );
  });
}
