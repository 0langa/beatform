import type { AudioFeatures } from "../audio/types";
import { allParams, DEFAULT_MOTION, DEFAULT_POST } from "./types";
import type {
  BgSettings,
  Mesh3DSpec,
  MotionSettings,
  ParamValues,
  ParticleSpec,
  PostSettings,
  PresetDef,
  Renderer,
  TransitionState,
} from "./types";

const MAX_PARAMS = 48;
/** Downsampled waveform points exposed to shaders */
const WAVE_POINTS = 512;
/** Uniform struct size in bytes (scalars + vec4 bgColor + sync block + motion) */
const UNIFORM_SIZE = 128;
/**
 * The scene (preset + background + overlay + crossfade) renders into an HDR
 * intermediate at this format; the post chain then tonemaps/blooms it to the
 * swapchain. HDR lets bloom's bright-pass see values above 1.
 */
const SCENE_FORMAT: GPUTextureFormat = "rgba16float";
/** Post uniform block: 8 f32 lanes = 32 bytes (16-byte aligned). */
const POST_UNIFORM_SIZE = 32;
/** Particle uniform block: 24 scalar lanes = 96 bytes. */
const PARTICLE_UNIFORM_SIZE = 96;
/** Fixed particle simulation rate. Steps are keyed to track time
 * (target = floor(time * SIM_FPS)) so the sim speed is frame-rate independent
 * and exports are bit-reproducible regardless of output fps. */
const SIM_FPS = 60;
const PARTICLE_DT = 1 / SIM_FPS;
/** Live-safety cap on catch-up steps per frame (never hit during export). */
const MAX_SIM_CATCHUP = 8;

/**
 * Post-processing WGSL. One module, three entry points sharing a fullscreen
 * triangle: bright-pass (HDR -> thresholded bloom seed), separable blur, and
 * the final composite (scene + bloom -> exposure -> ACES -> chromatic ->
 * vignette -> grain -> swapchain). All effects are pure functions of the
 * scene texture + track time, so live and export match exactly.
 */
const POST_WGSL = /* wgsl */ `
struct PostU {
  bloom: f32,
  bloomThreshold: f32,
  exposure: f32,
  tonemap: f32,
  vignette: f32,
  grain: f32,
  chromatic: f32,
  time: f32,
}
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSmp: sampler;
@group(0) @binding(2) var<uniform> p: PostU;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VSOut;
  out.pos = vec4f(pos[vi], 0.0, 1.0);
  out.uv = vec2f(pos[vi].x * 0.5 + 0.5, 1.0 - (pos[vi].y * 0.5 + 0.5));
  return out;
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// Bright-pass: keep the amount each pixel exceeds the threshold.
@fragment
fn fs_bright(in: VSOut) -> @location(0) vec4f {
  let c = textureSampleLevel(srcTex, srcSmp, in.uv, 0.0).rgb;
  let l = luma(c);
  let k = max(0.0, l - p.bloomThreshold);
  let w = k / max(l, 1e-4);
  return vec4f(c * w, 1.0);
}

// 9-tap separable Gaussian; horizontal and vertical are separate entry
// points (fs_blur_h/fs_blur_v) so the direction is a compile-time constant.
fn blur(in: VSOut, dir: vec2f) -> vec4f {
  let dims = vec2f(textureDimensions(srcTex, 0));
  let step = dir / dims;
  let w = array<f32, 5>(0.227027, 0.194594, 0.121621, 0.054054, 0.016216);
  var col = textureSampleLevel(srcTex, srcSmp, in.uv, 0.0).rgb * w[0];
  for (var i = 1; i < 5; i = i + 1) {
    let o = step * f32(i);
    col = col + textureSampleLevel(srcTex, srcSmp, in.uv + o, 0.0).rgb * w[i];
    col = col + textureSampleLevel(srcTex, srcSmp, in.uv - o, 0.0).rgb * w[i];
  }
  return vec4f(col, 1.0);
}
@fragment
fn fs_blur_h(in: VSOut) -> @location(0) vec4f { return blur(in, vec2f(1.0, 0.0)); }
@fragment
fn fs_blur_v(in: VSOut) -> @location(0) vec4f { return blur(in, vec2f(0.0, 1.0)); }

// ACES filmic approximation (Narkowicz).
fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn hash(uv: vec2f) -> f32 {
  return fract(sin(dot(uv, vec2f(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs_final(in: VSOut) -> @location(0) vec4f {
  let center = vec2f(0.5, 0.5);
  let toC = in.uv - center;
  // Chromatic aberration: sample RGB along the radial, growing toward edges.
  var col: vec3f;
  var a: f32;
  if (p.chromatic > 0.0) {
    let off = toC * p.chromatic * 0.03 * dot(toC, toC) * 4.0;
    let r = textureSampleLevel(srcTex, srcSmp, in.uv + off, 0.0);
    let g = textureSampleLevel(srcTex, srcSmp, in.uv, 0.0);
    let bb = textureSampleLevel(srcTex, srcSmp, in.uv - off, 0.0);
    col = vec3f(r.r, g.g, bb.b);
    a = g.a;
  } else {
    let s = textureSampleLevel(srcTex, srcSmp, in.uv, 0.0);
    col = s.rgb;
    a = s.a;
  }
  // Additive bloom.
  if (p.bloom > 0.0) {
    col = col + textureSampleLevel(bloomTex, srcSmp, in.uv, 0.0).rgb * p.bloom;
  }
  // Exposure + tonemap.
  col = col * p.exposure;
  if (p.tonemap > 0.5) { col = aces(col); }
  // Vignette.
  if (p.vignette > 0.0) {
    let d = length(toC) * 1.4142;
    col = col * (1.0 - p.vignette * smoothstep(0.4, 1.0, d));
  }
  // Deterministic film grain (track-time seeded, not Math.random).
  if (p.grain > 0.0) {
    let n = hash(in.uv + fract(p.time)) - 0.5;
    col = col + n * p.grain;
  }
  return vec4f(col, a);
}
`;

/**
 * WebGPU renderer. Fullscreen-triangle pass; the active preset supplies the
 * fragment logic as WGSL. Spectrum/waveform data reach the GPU as storage
 * buffers, scalar features as one uniform struct — presets read both through
 * this fixed header so every preset sees the same ABI, plus a small shared
 * helper library (hsl2rgb, hashes, value noise, fbm).
 */
const HEADER = /* wgsl */ `
const TAU: f32 = 6.28318530718;

struct Uniforms {
  time: f32,
  beatIntensity: f32,
  rms: f32,
  bass: f32,
  mid: f32,
  treble: f32,
  binCount: u32,
  aspect: f32,
  waveCount: u32,
  progress: f32,
  energy: f32,
  bgMode: u32,
  bgColor: vec4f,
  drive: f32,
  driveBeat: f32,
  voice: f32,
  width: f32,
  bpm: f32,
  beatPhase: f32,
  barPhase: f32,
  kick: f32,
  snare: f32,
  hat: f32,
  smoothBins: f32,
  feedbackOn: f32,
  spin: f32,
  pulse: f32,
  detail: f32,
  specSmooth: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> bins: array<f32>;
@group(0) @binding(2) var<storage, read> peaks: array<f32>;
@group(0) @binding(3) var<storage, read> params: array<f32>;
@group(0) @binding(4) var<storage, read> waveform: array<f32>;
@group(0) @binding(5) var overlayTex: texture_2d<f32>;
@group(0) @binding(6) var overlaySmp: sampler;
@group(0) @binding(7) var feedbackTex: texture_2d<f32>;
@group(0) @binding(8) var coverTex: texture_2d<f32>;

fn param(i: u32) -> f32 { return params[i]; }

/** The track's embedded cover art. uv is 0..1 across the image. hasCover() is
 * false when the track has none (a 1x1 stand-in is bound), so presets can fall
 * back to a plain fill. */
fn coverSample(uv: vec2f) -> vec4f {
  return textureSampleLevel(coverTex, overlaySmp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
fn hasCover() -> bool { return textureDimensions(coverTex).x > 1u; }

/** Previous frame's raw visual (HDR), for trails/feedback. A preset that
 * calls this opts into the feedback path: its output is captured and fed back
 * next frame. Off-screen samples clamp to the edge. Deterministic — same
 * frame sequence in live and export yields the same trails. */
fn feedbackSample(uv: vec2f) -> vec4f {
  return textureSampleLevel(feedbackTex, overlaySmp, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}

fn catmullRom(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
  let t2 = t * t;
  let t3 = t2 * t;
  return max(0.0, 0.5 * ((2.0 * p1) + (-p0 + p2) * t
    + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
    + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3));
}

/** Amount of spatial spectrum smoothing: the "Smooth curve" toggle (full
 * spline) OR the Motion "Spectrum smooth" amount, whichever is larger. */
fn specAmt() -> f32 { return max(u.smoothBins, u.specSmooth); }

/** Spectrum sampled at x in 0..1. Blends the raw nearest bin toward a
 * Catmull-Rom spline by the smoothing amount (0 = hard bins / classic look,
 * 1 = full curve). At amount 0 it returns the exact nearest bin. */
fn binAt(x: f32) -> f32 {
  let n = f32(u.binCount);
  let nearest = bins[u32(clamp(x, 0.0, 0.999) * n)];
  let amt = specAmt();
  if (amt < 0.001) { return nearest; }
  let fi = clamp(x, 0.0, 0.999) * n - 0.5;
  let i = floor(fi);
  let t = fi - i;
  let i0 = u32(clamp(i - 1.0, 0.0, n - 1.0));
  let i1 = u32(clamp(i, 0.0, n - 1.0));
  let i2 = u32(clamp(i + 1.0, 0.0, n - 1.0));
  let i3 = u32(clamp(i + 2.0, 0.0, n - 1.0));
  return mix(nearest, catmullRom(bins[i0], bins[i1], bins[i2], bins[i3], t), amt);
}

fn peakAt(x: f32) -> f32 {
  let n = f32(u.binCount);
  let nearest = peaks[u32(clamp(x, 0.0, 0.999) * n)];
  let amt = specAmt();
  if (amt < 0.001) { return nearest; }
  let fi = clamp(x, 0.0, 0.999) * n - 0.5;
  let i = floor(fi);
  let t = fi - i;
  let i0 = u32(clamp(i - 1.0, 0.0, n - 1.0));
  let i1 = u32(clamp(i, 0.0, n - 1.0));
  let i2 = u32(clamp(i + 1.0, 0.0, n - 1.0));
  let i3 = u32(clamp(i + 2.0, 0.0, n - 1.0));
  return mix(nearest, catmullRom(peaks[i0], peaks[i1], peaks[i2], peaks[i3], t), amt);
}

/** Waveform sampled at x in 0..1, linear interpolation, -1..1 */
fn waveAt(x: f32) -> f32 {
  let n = f32(u.waveCount);
  let fi = clamp(x, 0.0, 0.999) * (n - 1.0);
  let i = u32(fi);
  let fr = fract(fi);
  return mix(waveform[i], waveform[min(i + 1u, u.waveCount - 1u)], fr);
}

fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = fract(h / 360.0) * 6.0;
  let x = c * (1.0 - abs(hp % 2.0 - 1.0));
  var rgb = vec3f(0.0);
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(l - c * 0.5);
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 345.45));
  q += dot(q, q + 34.345);
  return fract(q.x * q.y);
}

fn hash11(p: f32) -> f32 {
  return fract(sin(p * 127.1) * 43758.5453);
}

fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm(pIn: vec2f) -> f32 {
  var p = pIn;
  var v = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 5; i++) {
    v += amp * noise2(p);
    p = p * 2.03 + vec2f(11.7, 5.3);
    amp *= 0.5;
  }
  return v;
}

fn rot2(a: f32) -> mat2x2f {
  let c = cos(a);
  let s = sin(a);
  return mat2x2f(c, -s, s, c);
}

/** uv centered at 0, x corrected for aspect ratio */
fn centered(uv: vec2f) -> vec2f {
  return vec2f((uv.x - 0.5) * u.aspect, uv.y - 0.5);
}

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  // Fullscreen triangle
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VSOut;
  out.pos = vec4f(pos[vi], 0.0, 1.0);
  out.uv = vec2f(pos[vi].x * 0.5 + 0.5, 1.0 - (pos[vi].y * 0.5 + 0.5));
  return out;
}
`;

/** The preset scene entry point. Split out of HEADER because it references
 * preset() — only preset modules (HEADER + COMPOSITE_BODY + FS_MAIN + preset)
 * define preset(); the standalone composite module must NOT include it. */
const FS_MAIN = /* wgsl */ `
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let out = preset(in.uv);
  // Feedback path: emit the raw visual; a separate composite pass applies the
  // background + overlay after the frame is captured for trails. Keeps the
  // fed-back buffer free of background/overlay so trails don't accumulate them.
  if (u.feedbackOn > 0.5) { return out; }
  return composite(out, in.uv);
}
`;

/** Background re-basing + overlay source-over. Shared by the inline path
 * (fs_main, non-feedback) and the standalone composite pass (feedback path)
 * so both produce identical pixels. Presets author light-over-black
 * (premultiplied), so a luma-derived alpha re-bases them on any background. */
const COMPOSITE_BODY = /* wgsl */ `
fn composite(color: vec4f, uv: vec2f) -> vec4f {
  var out = color;
  if (u.bgMode != 0u) {
    let a = clamp(max(out.r, max(out.g, out.b)), 0.0, 1.0);
    if (u.bgMode == 1u) {
      out = vec4f(u.bgColor.rgb * (1.0 - a) + out.rgb, 1.0);
    } else {
      out = vec4f(out.rgb, a); // premultiplied alpha
    }
  }
  let ov = textureSampleLevel(overlayTex, overlaySmp, uv, 0.0);
  out = vec4f(ov.rgb + out.rgb * (1.0 - ov.a), min(1.0, ov.a + out.a * (1.0 - ov.a)));
  return out;
}
`;

/** Standalone composite pass (feedback path). Reuses the full preset ABI
 * (HEADER + COMPOSITE_BODY) and pipeline layout: binding 7 (feedbackTex) is
 * bound to the just-rendered raw visual for this pass, so `composite()`,
 * `u`, and the overlay are all in scope with no extra bindings. */
const COMPOSITE_WGSL = /* wgsl */ `
@fragment
fn fs_composite(in: VSOut) -> @location(0) vec4f {
  let raw = textureSampleLevel(feedbackTex, overlaySmp, in.uv, 0.0);
  return composite(raw, in.uv);
}
`;

const BLEND_WGSL = /* wgsl */ `
struct BlendU { mixv: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(0) var fromTex: texture_2d<f32>;
@group(0) @binding(1) var toTex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var<uniform> bu: BlendU;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VSOut;
  out.pos = vec4f(pos[vi], 0.0, 1.0);
  out.uv = vec2f(pos[vi].x * 0.5 + 0.5, 1.0 - (pos[vi].y * 0.5 + 0.5));
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let a = textureSampleLevel(fromTex, smp, in.uv, 0.0);
  let b = textureSampleLevel(toTex, smp, in.uv, 0.0);
  return mix(a, b, bu.mixv);
}
`;

/** Order of a particle preset's params (main + advanced) mapped into the
 * particle uniform. The preset MUST declare these keys; the renderer copies
 * each ParamValues[key] into the matching PU field. */
const PARTICLE_PARAM_KEYS = [
  "hue",
  "flowScale",
  "flowStrength",
  "swirl",
  "damping",
  "gravity",
  "size",
  "sizePulse",
  "brightness",
  "beatBurst",
  "hueSpread",
  "speedColor",
  "spawnRadius",
  "density",
  "audioFlow",
  "sat",
] as const;

/**
 * GPU compute-particle system: one storage buffer of {pos, vel}, advanced by a
 * curl-noise flow field plus audio forces (bass-scaled flow, per-particle beat
 * bursts), then drawn as additive round sprites (instanced quads). Everything
 * is a pure function of the seeded state + the per-step uniform, so a fixed sim
 * rate keyed to track time makes exports bit-reproducible.
 *
 * Split into two modules: the sim binds `parts` read_write (compute), the draw
 * binds it read-only — a vertex stage may not touch a writable storage buffer.
 */
const PARTICLE_STRUCTS = /* wgsl */ `
struct Particle { pos: vec2f, vel: vec2f }
struct PU {
  dt: f32, time: f32, aspect: f32, count: u32,
  bass: f32, drive: f32, driveBeat: f32, kick: f32,
  hue: f32, flowScale: f32, flowStrength: f32, swirl: f32,
  damping: f32, gravity: f32, size: f32, sizePulse: f32,
  brightness: f32, beatBurst: f32, hueSpread: f32, speedColor: f32,
  spawnRadius: f32, density: f32, audioFlow: f32, sat: f32,
}
@group(0) @binding(0) var<uniform> pu: PU;
fn h11(p: f32) -> f32 { return fract(sin(p * 127.1) * 43758.5453); }
`;

const PARTICLE_SIM_WGSL =
  PARTICLE_STRUCTS +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> parts: array<Particle>;

fn h21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 345.45));
  q += dot(q, q + 34.345);
  return fract(q.x * q.y);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = h21(i); let b = h21(i + vec2f(1.0, 0.0));
  let c = h21(i + vec2f(0.0, 1.0)); let d = h21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}
// Curl of a scalar noise field => divergence-free flow (no sources/sinks).
fn curl(p: vec2f) -> vec2f {
  let e = 0.02;
  let dx = vnoise(p + vec2f(e, 0.0)) - vnoise(p - vec2f(e, 0.0));
  let dy = vnoise(p + vec2f(0.0, e)) - vnoise(p - vec2f(0.0, e));
  return vec2f(dy, -dx) / (2.0 * e);
}

@compute @workgroup_size(64)
fn cs_sim(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= pu.count) { return; }
  var pos = parts[i].pos;
  var vel = parts[i].vel;
  let seed = h11(f32(i) * 0.61803 + 0.123);

  // Curl-noise flow, drifting over time, amplified by bass. The fixed scale
  // factors keep raw curl / positional terms in a sane velocity range so the
  // exposed knobs read as intuitive 0..2 multipliers.
  let fp = pos * pu.flowScale + vec2f(pu.time * 0.05, pu.time * 0.037);
  // Flow rides both the bass and the selected sync source, so the Sync panel
  // visibly changes how the field surges.
  var force = curl(fp) * pu.flowStrength * 0.04
            * (1.0 + pu.bass * pu.audioFlow * 0.4 + pu.drive * pu.audioFlow);
  // Rotational swirl around center + gentle pull so the field stays framed.
  force += vec2f(-pos.y, pos.x) * pu.swirl * 0.4;
  force += -pos * pu.gravity * 0.3;
  // Steady outward drift: with the center respawn this makes a fountain, so the
  // curl field bends the outflow into visible radiating tendrils (a uniform
  // fill would look like static under divergence-free flow). Loudness feeds it.
  let outward = normalize(pos + vec2f(1e-5, 0.0));
  force += outward * (0.03 + pu.drive * 0.05);
  // Per-particle radial burst on kicks.
  let bdir = normalize(vec2f(h11(seed * 3.3) - 0.5, h11(seed * 7.7) - 0.5) + vec2f(1e-4));
  // Burst on the selected sync source's beats (falls back to kicks in Kick mode).
  force += bdir * max(pu.driveBeat, pu.kick * 0.5) * pu.beatBurst * 0.3;

  vel = vel * pu.damping + force * pu.dt;
  pos += vel * pu.dt;

  // Respawn once a particle drifts out of the framed region.
  if (abs(pos.x) > 1.15 || abs(pos.y) > 1.15) {
    let a = h11(seed * 13.1 + pu.time) * 6.28318530718;
    pos = vec2f(cos(a), sin(a)) * pu.spawnRadius * h11(seed * 5.5 + pu.time * 0.7);
    vel = vec2f(0.0);
  }
  parts[i].pos = pos;
  parts[i].vel = vel;
}
`;

const PARTICLE_DRAW_WGSL =
  PARTICLE_STRUCTS +
  /* wgsl */ `
@group(0) @binding(1) var<storage, read> parts: array<Particle>;

fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = fract(h / 360.0) * 6.0;
  let x = c * (1.0 - abs(hp % 2.0 - 1.0));
  var rgb = vec3f(0.0);
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(l - c * 0.5);
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) shade: vec3f,
}
@vertex
fn vs_draw(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let c = corners[vi];
  let p = parts[ii];
  let speed = length(p.vel);
  let size = pu.size * (1.0 + speed * pu.sizePulse);
  // pos is in NDC (-1..1 fills the frame); correct sprite x for aspect so
  // dots stay round. y is flipped for clip space.
  let clip = vec2f(p.pos.x + c.x * size / pu.aspect, -(p.pos.y + c.y * size));
  let hue = pu.hue + seedHue(ii) * pu.hueSpread + speed * pu.speedColor * 400.0;
  var out: VOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.uv = c;
  out.shade = hsl2rgb(hue, pu.sat, 0.6) * pu.brightness;
  return out;
}
fn seedHue(ii: u32) -> f32 { return h11(f32(ii) * 0.61803 + 0.123) - 0.5; }

@fragment
fn fs_draw(in: VOut) -> @location(0) vec4f {
  // Soft round sprite; additive so overlaps bloom into bright cores.
  let d = length(in.uv);
  let a = smoothstep(1.0, 0.0, d);
  let core = smoothstep(0.5, 0.0, d);
  let col = in.shade * (a + core * 1.5);
  return vec4f(col, a);
}
`;

/** Mesh-3D uniform: mat4 viewProj (64) + 12 scalar lanes (48) = 112 bytes. */
const MESH3D_UNIFORM_SIZE = 112;

/**
 * 3D pass: a depth-tested grid of instanced columns whose heights follow the
 * spectrum, lit by one directional light and viewed through a perspective
 * camera. Bar heights are read from the shared bins storage buffer in the
 * vertex stage; the camera's viewProj is computed on the CPU from params so it
 * is keyframeable. Draws into visTex (light-over-black) -> composite -> post.
 */
const MESH3D_WGSL = /* wgsl */ `
struct M3U {
  viewProj: mat4x4f,
  grid: f32, spacing: f32, barWidth: f32, heightScale: f32,
  hue: f32, hueRange: f32, light: f32, emissive: f32,
  binCount: f32, time: f32, drive: f32, driveBeat: f32,
}
@group(0) @binding(0) var<uniform> m: M3U;
@group(0) @binding(1) var<storage, read> bins: array<f32>;

fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = fract(h / 360.0) * 6.0;
  let x = c * (1.0 - abs(hp % 2.0 - 1.0));
  var rgb = vec3f(0.0);
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(l - c * 0.5);
}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) normal: vec3f,
  @location(1) shade: vec3f,
  @location(2) height: f32,
}

@vertex
fn vs_mesh(
  @location(0) inPos: vec3f,
  @location(1) inNormal: vec3f,
  @builtin(instance_index) ii: u32,
) -> VOut {
  let g = u32(m.grid);
  let col = f32(ii % g);
  let row = f32(ii / g);
  let half = (m.grid - 1.0) * 0.5;
  let dx = col - half;
  let dz = row - half;
  // Radial index into the spectrum -> concentric rings pulse with frequency.
  let r = length(vec2f(dx, dz)) / max(m.grid * 0.5, 1.0);
  let bi = u32(clamp(r, 0.0, 0.999) * m.binCount);
  // Overall height rides the selected sync source so the Sync panel matters.
  let h = bins[bi] * m.heightScale * (0.7 + m.drive * 0.7) + 0.03;
  // Axis-only scale + translate => axis-aligned normals pass through.
  let world = vec3f(
    inPos.x * m.barWidth + dx * m.spacing,
    inPos.y * h,
    inPos.z * m.barWidth + dz * m.spacing,
  );
  var out: VOut;
  out.pos = m.viewProj * vec4f(world, 1.0);
  out.normal = inNormal;
  out.shade = hsl2rgb(m.hue + r * m.hueRange + h * 24.0, 0.85, 0.55);
  out.height = h;
  return out;
}

@fragment
fn fs_mesh(in: VOut) -> @location(0) vec4f {
  let n = normalize(in.normal);
  let lightDir = normalize(vec3f(0.4, 0.9, 0.3));
  let diff = max(dot(n, lightDir), 0.0);
  let lit = in.shade * (0.25 + diff * m.light);
  // Emissive rises with height so tall bars glow (bloom picks them up).
  let emis = in.shade * clamp(in.height, 0.0, 3.0) * m.emissive * (0.7 + m.drive * 0.6 + m.driveBeat * 0.5);
  return vec4f(lit + emis, 1.0);
}
`;

/** 36-vertex unit column (x,z in -0.5..0.5, y in 0..1), pos + normal, for
 * instanced 3D bars. Culling is disabled so winding order doesn't matter. */
function cubeColumnVerts(): Float32Array {
  const faces: Array<{ n: [number, number, number]; q: Array<[number, number, number]> }> = [
    {
      n: [0, 1, 0],
      q: [
        [-0.5, 1, -0.5],
        [0.5, 1, -0.5],
        [0.5, 1, 0.5],
        [-0.5, 1, 0.5],
      ],
    },
    {
      n: [0, -1, 0],
      q: [
        [-0.5, 0, 0.5],
        [0.5, 0, 0.5],
        [0.5, 0, -0.5],
        [-0.5, 0, -0.5],
      ],
    },
    {
      n: [0, 0, 1],
      q: [
        [-0.5, 0, 0.5],
        [-0.5, 1, 0.5],
        [0.5, 1, 0.5],
        [0.5, 0, 0.5],
      ],
    },
    {
      n: [0, 0, -1],
      q: [
        [0.5, 0, -0.5],
        [0.5, 1, -0.5],
        [-0.5, 1, -0.5],
        [-0.5, 0, -0.5],
      ],
    },
    {
      n: [1, 0, 0],
      q: [
        [0.5, 0, 0.5],
        [0.5, 1, 0.5],
        [0.5, 1, -0.5],
        [0.5, 0, -0.5],
      ],
    },
    {
      n: [-1, 0, 0],
      q: [
        [-0.5, 0, -0.5],
        [-0.5, 1, -0.5],
        [-0.5, 1, 0.5],
        [-0.5, 0, 0.5],
      ],
    },
  ];
  const out: number[] = [];
  for (const f of faces) {
    const [a, b, c, d] = f.q;
    for (const v of [a, b, c, a, c, d]) out.push(v[0], v[1], v[2], f.n[0], f.n[1], f.n[2]);
  }
  return new Float32Array(out);
}

// Column-major 4x4 helpers (WGSL mat4x4f is column-major; WebGPU depth is 0..1).
function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far * nf;
  m[11] = -1;
  m[14] = far * near * nf;
  return m;
}
function mat4LookAt(
  eye: [number, number, number],
  center: [number, number, number],
  up: [number, number, number],
): Float32Array {
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0];
  m[1] = y[0];
  m[2] = z[0];
  m[3] = 0;
  m[4] = x[1];
  m[5] = y[1];
  m[6] = z[1];
  m[7] = 0;
  m[8] = x[2];
  m[9] = y[2];
  m[10] = z[2];
  m[11] = 0;
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}
function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** A preset opts into the feedback/trails path by referencing the ABI helper. */
function usesFeedback(preset: PresetDef): boolean {
  return preset.wgsl.includes("feedbackSample");
}

export class WebGPURenderer implements Renderer {
  readonly kind = "webgpu" as const;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private bg: BgSettings = { mode: 0, color: [0, 0, 0] };
  private smoothBins = false;
  private motion: MotionSettings = { ...DEFAULT_MOTION };

  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindLayout: GPUBindGroupLayout;
  private pipelineLayout: GPUPipelineLayout;
  private uniformBuf: GPUBuffer;
  private binsBuf: GPUBuffer | null = null;
  private peaksBuf: GPUBuffer | null = null;
  private paramsBuf: GPUBuffer;
  private waveBuf: GPUBuffer;
  private binCapacity = 0;
  /** 1x1 transparent stand-in bound when no overlay is set. */
  private emptyOverlay: GPUTexture;
  private overlayTexture: GPUTexture | null = null;
  private overlaySampler: GPUSampler;
  /** 1x1 stand-in bound when the track has no cover art (hasCover() = false). */
  private emptyCover: GPUTexture;
  private coverTexture: GPUTexture | null = null;

  // Crossfade machinery: a second compiled preset + params, two offscreen
  // targets and a static blend pass (the render graph's first citizen).
  private transitionPreset: PresetDef | null = null;
  private transitionPipeline: GPURenderPipeline | null = null;
  private transitionPipelineFor: string | null = null;
  private transitionParamsBuf: GPUBuffer;
  private transitionBindGroup: GPUBindGroup | null = null;
  private transitionParamsData = new Float32Array(MAX_PARAMS);
  private fadeTexA: GPUTexture | null = null;
  private fadeTexB: GPUTexture | null = null;
  private fadeSize: [number, number] = [0, 0];
  private blendPipeline: GPURenderPipeline | null = null;
  private blendUniform: GPUBuffer;
  private blendBindGroup: GPUBindGroup | null = null;

  // Render graph: preset draws into sceneTex (HDR); a post chain (bloom +
  // final composite) reads it and writes the swapchain.
  private post: PostSettings = { ...DEFAULT_POST };
  private sceneTex: GPUTexture | null = null;
  private bloomTexA: GPUTexture | null = null;
  private bloomTexB: GPUTexture | null = null;
  private graphSize: [number, number] = [0, 0];
  private postUniform: GPUBuffer;
  private postUniformData = new Float32Array(POST_UNIFORM_SIZE / 4);
  private postSampler: GPUSampler;
  private brightPipeline: GPURenderPipeline | null = null;
  private blurHPipeline: GPURenderPipeline | null = null;
  private blurVPipeline: GPURenderPipeline | null = null;
  private finalPipeline: GPURenderPipeline | null = null;
  private emptyBloom: GPUTexture;
  private postBindLayout: GPUBindGroupLayout;
  private postPipelineLayout: GPUPipelineLayout;
  private brightBind: GPUBindGroup | null = null;
  private blurHBind: GPUBindGroup | null = null;
  private blurVBind: GPUBindGroup | null = null;
  private finalBind: GPUBindGroup | null = null;
  private finalBloomSource: GPUTexture | null = null;

  // Feedback/trails: presets that call feedbackSample() render their raw
  // visual into visTex; a composite pass finishes it into sceneTex, and the
  // raw visual is copied into histTex to feed back next frame. Gated per
  // preset (WGSL scan) so non-feedback presets keep the byte-identical inline
  // composite path with zero extra passes.
  private presetUsesFeedback = false;
  private feedbackClearPending = false;
  private visTex: GPUTexture | null = null;
  private histTex: GPUTexture | null = null;
  private feedbackSize: [number, number] = [0, 0];
  private emptyFeedback: GPUTexture;
  private compositePipeline: GPURenderPipeline | null = null;
  private compositeBind: GPUBindGroup | null = null;

  // Compute-particle system: a {pos,vel} storage buffer advanced by a compute
  // pass at a fixed sim rate, drawn as additive sprites into visTex (then the
  // shared composite + post). Only active for presets with a `particles` spec.
  private particleSpec: ParticleSpec | null = null;
  private particleBuf: GPUBuffer | null = null;
  private particleCapacity = 0;
  private particleUniform: GPUBuffer;
  private particleData = new ArrayBuffer(PARTICLE_UNIFORM_SIZE);
  private particleF32 = new Float32Array(this.particleData);
  private particleU32 = new Uint32Array(this.particleData);
  private particleSimPipeline: GPUComputePipeline | null = null;
  private particleDrawPipeline: GPURenderPipeline | null = null;
  private particleSimLayout: GPUBindGroupLayout;
  private particleDrawLayout: GPUBindGroupLayout;
  private particleSimBind: GPUBindGroup | null = null;
  private particleDrawBind: GPUBindGroup | null = null;
  private simStepsDone = 0;
  private particleInitPending = false;

  // 3D pass: depth-tested instanced column grid through a perspective camera.
  // Active only for presets with a `mesh3d` spec.
  private mesh3dSpec: Mesh3DSpec | null = null;
  private mesh3dUniform: GPUBuffer;
  private mesh3dData = new ArrayBuffer(MESH3D_UNIFORM_SIZE);
  private mesh3dF32 = new Float32Array(this.mesh3dData);
  private cubeBuf: GPUBuffer;
  private mesh3dPipeline: GPURenderPipeline | null = null;
  private mesh3dLayout: GPUBindGroupLayout;
  private mesh3dBind: GPUBindGroup | null = null;
  private depthTex: GPUTexture | null = null;
  private depthSize: [number, number] = [0, 0];

  private preset: PresetDef | null = null;
  private uniformData = new ArrayBuffer(UNIFORM_SIZE);
  private uniformF32 = new Float32Array(this.uniformData);
  private uniformU32 = new Uint32Array(this.uniformData);
  private paramsData = new Float32Array(MAX_PARAMS);
  private waveData = new Float32Array(WAVE_POINTS);

  /** Fires if the GPU device dies (driver reset, TDR) — host may recreate. */
  onDeviceLost: ((reason: string) => void) | null = null;
  private disposed = false;

  static async create(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<WebGPURenderer> {
    if (!navigator.gpu) throw new Error("WebGPU not available");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    const renderer = new WebGPURenderer(canvas, device);
    void device.lost.then((info) => {
      if (renderer.disposed) return;
      console.error("[webgpu] device lost:", info.reason, info.message);
      renderer.onDeviceLost?.(info.message);
    });
    return renderer;
  }

  private constructor(canvas: HTMLCanvasElement | OffscreenCanvas, device: GPUDevice) {
    this.canvas = canvas;
    this.device = device;
    // Surface GPU validation failures loudly; __gpuErrors is an E2E probe
    device.addEventListener("uncapturederror", (e) => {
      console.error("[webgpu]", (e as GPUUncapturedErrorEvent).error.message);
      const g = globalThis as unknown as { __gpuErrors: number };
      g.__gpuErrors = (g.__gpuErrors ?? 0) + 1;
    });
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new Error("No webgpu canvas context");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format: this.format,
      // premultiplied: identical to opaque while alpha stays 1, enables the
      // transparent background mode without reconfiguring
      alphaMode: "premultiplied",
    });
    this.uniformBuf = device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paramsBuf = device.createBuffer({
      size: MAX_PARAMS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.waveBuf = device.createBuffer({
      size: WAVE_POINTS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.emptyOverlay = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.emptyOverlay },
      new Uint8Array([0, 0, 0, 0]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    this.emptyCover = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.emptyCover },
      new Uint8Array([0, 0, 0, 0]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    this.overlaySampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.transitionParamsBuf = device.createBuffer({
      size: MAX_PARAMS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.blendUniform = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.postUniform = device.createBuffer({
      size: POST_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.postSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    // 1x1 black stand-in bound as the bloom texture when bloom is off.
    this.emptyBloom = device.createTexture({
      size: [1, 1],
      format: SCENE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // 1x1 black stand-in bound at binding 7 when the active preset has no
    // feedback (keeps the shared bind layout satisfied without a history tex).
    this.emptyFeedback = device.createTexture({
      size: [1, 1],
      format: SCENE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // One explicit layout for every post pass (0 src tex, 1 sampler, 2 uniform,
    // 3 bloom tex) — an "auto" layout would strip the unused bloom binding
    // from the bright/blur passes and give each pipeline a different layout.
    this.postBindLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.postPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.postBindLayout],
    });
    // Explicit layout: presets bind the full ABI even for buffers they don't
    // reference ("auto" layout would strip unused bindings and break the
    // shared bind group).
    const storage = { type: "read-only-storage" as const };
    this.bindLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: storage },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: storage },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: storage },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: storage },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindLayout],
    });
    // Particle pipelines: compute needs read_write on the state buffer, the
    // draw pass reads it — two layouts over the same buffer.
    this.particleUniform = device.createBuffer({
      size: PARTICLE_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleSimLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.particleDrawLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
      ],
    });
    // 3D pass: camera/params uniform + a static cube column vertex buffer.
    this.mesh3dUniform = device.createBuffer({
      size: MESH3D_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const cube = cubeColumnVerts();
    this.cubeBuf = device.createBuffer({
      size: cube.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.cubeBuf, 0, cube);
    this.mesh3dLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
  }

  setBackground(bg: BgSettings): void {
    this.bg = bg;
  }

  setSmoothSpectrum(v: boolean): void {
    this.smoothBins = v;
  }

  setMotion(motion: MotionSettings): void {
    this.motion = motion;
  }

  setTransitionPreset(preset: PresetDef | null): void {
    this.transitionPreset = preset;
    if (!preset) {
      this.transitionPipeline = null;
      this.transitionPipelineFor = null;
      return;
    }
    if (this.transitionPipelineFor === preset.id) return; // cached
    const specs = allParams(preset);
    const accessors = specs
      .map((p, i) => `fn P_${p.key}() -> f32 { return params[${i}u]; }`)
      .join("\n");
    const module = this.device.createShaderModule({
      code: HEADER + COMPOSITE_BODY + FS_MAIN + accessors + "\n" + preset.wgsl,
    });
    this.transitionPipeline = this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format: SCENE_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    this.transitionPipelineFor = preset.id;
    this.transitionBindGroup = null;
  }

  private ensureFadeTargets(): void {
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    if (this.fadeTexA && this.fadeSize[0] === w && this.fadeSize[1] === h) return;
    this.fadeTexA?.destroy();
    this.fadeTexB?.destroy();
    const make = () =>
      this.device.createTexture({
        size: [w, h],
        format: SCENE_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.fadeTexA = make();
    this.fadeTexB = make();
    this.fadeSize = [w, h];
    this.blendBindGroup = null;
    if (!this.blendPipeline) {
      const module = this.device.createShaderModule({ code: BLEND_WGSL });
      this.blendPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_main", targets: [{ format: SCENE_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
    }
  }

  setPost(post: PostSettings): void {
    this.post = post;
  }

  /** (Re)create the HDR scene target + half-res bloom targets + post pipelines. */
  private ensureGraphTargets(): void {
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    if (this.sceneTex && this.graphSize[0] === w && this.graphSize[1] === h) return;
    this.sceneTex?.destroy();
    this.bloomTexA?.destroy();
    this.bloomTexB?.destroy();
    const tex = (tw: number, th: number) =>
      this.device.createTexture({
        size: [Math.max(1, tw), Math.max(1, th)],
        format: SCENE_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.sceneTex = tex(w, h);
    const bw = Math.max(1, w >> 1);
    const bh = Math.max(1, h >> 1);
    this.bloomTexA = tex(bw, bh);
    this.bloomTexB = tex(bw, bh);
    this.graphSize = [w, h];
    this.brightBind = null;
    this.blurHBind = null;
    this.blurVBind = null;
    this.finalBind = null;

    if (!this.finalPipeline) {
      const module = this.device.createShaderModule({ code: POST_WGSL });
      const mk = (entry: string, format: GPUTextureFormat) =>
        this.device.createRenderPipeline({
          layout: this.postPipelineLayout,
          vertex: { module, entryPoint: "vs" },
          fragment: { module, entryPoint: entry, targets: [{ format }] },
          primitive: { topology: "triangle-list" },
        });
      this.brightPipeline = mk("fs_bright", SCENE_FORMAT);
      this.blurHPipeline = mk("fs_blur_h", SCENE_FORMAT);
      this.blurVPipeline = mk("fs_blur_v", SCENE_FORMAT);
      this.finalPipeline = mk("fs_final", this.format);
    }
  }

  /** (Re)create the feedback targets (raw visual + history) and the composite
   * pipeline. visTex is the preset's raw output this frame; histTex holds the
   * previous frame's raw visual for feedbackSample(). */
  private ensureFeedbackTargets(): void {
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    if (!this.compositePipeline) {
      const module = this.device.createShaderModule({
        code: HEADER + COMPOSITE_BODY + COMPOSITE_WGSL,
      });
      this.compositePipeline = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_composite", targets: [{ format: SCENE_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
    }
    if (this.visTex && this.feedbackSize[0] === w && this.feedbackSize[1] === h) return;
    this.visTex?.destroy();
    this.histTex?.destroy();
    const make = () =>
      this.device.createTexture({
        size: [w, h],
        format: SCENE_FORMAT,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      });
    this.visTex = make();
    this.histTex = make();
    this.feedbackSize = [w, h];
    this.feedbackClearPending = true; // fresh targets hold garbage
    this.compositeBind = null;
    this.bindGroup = null; // binding 7 (histTex view) changed
    this.transitionBindGroup = null;
  }

  /** Composite-pass bind group: full ABI, but binding 7 = the freshly-rendered
   * raw visual (visTex) instead of the history texture. */
  private getCompositeBindGroup(): GPUBindGroup {
    if (!this.compositeBind) {
      this.compositeBind = this.device.createBindGroup({
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: this.binsBuf! } },
          { binding: 2, resource: { buffer: this.peaksBuf! } },
          { binding: 3, resource: { buffer: this.paramsBuf } },
          { binding: 4, resource: { buffer: this.waveBuf } },
          { binding: 5, resource: (this.overlayTexture ?? this.emptyOverlay).createView() },
          { binding: 6, resource: this.overlaySampler },
          { binding: 7, resource: this.visTex!.createView() },
          { binding: 8, resource: (this.coverTexture ?? this.emptyCover).createView() },
        ],
      });
    }
    return this.compositeBind;
  }

  /** A post-pass bind group: src texture + optional bloom texture. */
  private postBind(src: GPUTexture, bloom: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.postBindLayout,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.postSampler },
        { binding: 2, resource: { buffer: this.postUniform } },
        { binding: 3, resource: bloom.createView() },
      ],
    });
  }

  /** Run bloom (if enabled) + the final composite, appending to `encoder`. */
  private runPost(encoder: GPUCommandEncoder, time: number, clearA: number): void {
    const d = this.postUniformData;
    d[0] = this.post.bloom;
    d[1] = this.post.bloomThreshold;
    d[2] = this.post.exposure;
    d[3] = this.post.tonemap ? 1 : 0;
    d[4] = this.post.vignette;
    d[5] = this.post.grain;
    d[6] = this.post.chromatic;
    d[7] = time;
    this.device.queue.writeBuffer(this.postUniform, 0, d);

    const pass = (pipe: GPURenderPipeline, bind: GPUBindGroup, view: GPUTextureView) => {
      const rp = encoder.beginRenderPass({
        colorAttachments: [
          { view, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: clearA }, storeOp: "store" },
        ],
      });
      rp.setPipeline(pipe);
      rp.setBindGroup(0, bind);
      rp.draw(3);
      rp.end();
    };

    let bloomSource = this.emptyBloom;
    if (this.post.bloom > 0) {
      // bright: scene -> bloomA; blurH: bloomA -> bloomB; blurV: bloomB -> bloomA
      if (!this.brightBind) this.brightBind = this.postBind(this.sceneTex!, this.emptyBloom);
      if (!this.blurHBind) this.blurHBind = this.postBind(this.bloomTexA!, this.emptyBloom);
      if (!this.blurVBind) this.blurVBind = this.postBind(this.bloomTexB!, this.emptyBloom);
      pass(this.brightPipeline!, this.brightBind, this.bloomTexA!.createView());
      pass(this.blurHPipeline!, this.blurHBind, this.bloomTexB!.createView());
      pass(this.blurVPipeline!, this.blurVBind, this.bloomTexA!.createView());
      bloomSource = this.bloomTexA!;
    }
    if (!this.finalBind || this.finalBloomSource !== bloomSource) {
      this.finalBind = this.postBind(this.sceneTex!, bloomSource);
      this.finalBloomSource = bloomSource;
    }
    pass(this.finalPipeline!, this.finalBind, this.context.getCurrentTexture().createView());
  }

  private ensureParticleBuffers(count: number): void {
    if (this.particleBuf && count <= this.particleCapacity) return;
    this.particleBuf?.destroy();
    this.particleBuf = this.device.createBuffer({
      size: count * 16, // pos.xy + vel.xy, all f32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.particleCapacity = count;
    this.particleSimBind = null;
    this.particleDrawBind = null;
  }

  private ensureParticlePipelines(): void {
    if (this.particleSimPipeline) return;
    const simModule = this.device.createShaderModule({ code: PARTICLE_SIM_WGSL });
    const drawModule = this.device.createShaderModule({ code: PARTICLE_DRAW_WGSL });
    this.particleSimPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.particleSimLayout] }),
      compute: { module: simModule, entryPoint: "cs_sim" },
    });
    this.particleDrawPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.particleDrawLayout] }),
      vertex: { module: drawModule, entryPoint: "vs_draw" },
      fragment: {
        module: drawModule,
        entryPoint: "fs_draw",
        targets: [
          {
            format: SCENE_FORMAT,
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  /** Deterministic seeded init: particles seeded across a central disc with a
   * small outward velocity, so the curl field + outward drift form a radiating
   * fountain (divergence-free flow keeps a uniform fill looking like static, so
   * a center-weighted spawn is what gives visible streams). Runs on the CPU
   * (setup, not per-pixel) so a plain hash is fine. */
  private initParticles(count: number): void {
    const data = new Float32Array(count * 4);
    const h = (n: number) => {
      const s = Math.sin(n) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let i = 0; i < count; i++) {
      // sqrt radius => uniform area density within the disc.
      const r = Math.sqrt(h(i * 2.11 + 0.7)) * 0.9;
      const a = h(i * 3.73 + 1.3) * Math.PI * 2;
      data[i * 4] = Math.cos(a) * r;
      data[i * 4 + 1] = Math.sin(a) * r;
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 0;
    }
    this.device.queue.writeBuffer(this.particleBuf!, 0, data);
    this.particleInitPending = false;
  }

  private writeParticleUniform(time: number, f: AudioFeatures, params: ParamValues): void {
    const F = this.particleF32;
    F[0] = PARTICLE_DT;
    F[1] = time;
    F[2] = this.canvas.width / Math.max(1, this.canvas.height);
    this.particleU32[3] = this.particleSpec!.count;
    F[4] = f.bass;
    F[5] = f.drive;
    F[6] = f.driveBeat;
    F[7] = f.kick;
    PARTICLE_PARAM_KEYS.forEach((k, idx) => {
      F[8 + idx] = params[k] ?? 0;
    });
    // Motion masters: swirl obeys Rotation, beat burst obeys Pulse.
    F[8 + PARTICLE_PARAM_KEYS.indexOf("swirl")] *= this.motion.rotation;
    F[8 + PARTICLE_PARAM_KEYS.indexOf("beatBurst")] *= this.motion.pulse;
    this.device.queue.writeBuffer(this.particleUniform, 0, this.particleData);
  }

  /** Run the particle sim (fixed steps keyed to track time) and draw the
   * particles additively into visTex. Returns after the draw; the caller
   * composites visTex -> sceneTex and runs post. */
  private renderParticles(
    encoder: GPUCommandEncoder,
    time: number,
    f: AudioFeatures,
    params: ParamValues,
  ): void {
    const count = this.particleSpec!.count;
    this.ensureParticlePipelines();

    // Advance the sim to floor(time * SIM_FPS) total steps. A backwards jump
    // or a large gap (seek) re-seeds and snaps — export runs forward from 0 so
    // this never triggers there, keeping exports bit-reproducible.
    const target = Math.floor(time * SIM_FPS);
    let steps = target - this.simStepsDone;
    if (this.particleInitPending || steps < 0 || steps > MAX_SIM_CATCHUP * 4) {
      this.initParticles(count);
      this.simStepsDone = target;
      steps = 0;
    }
    steps = Math.min(steps, MAX_SIM_CATCHUP);

    this.writeParticleUniform(time, f, params);
    if (!this.particleSimBind) {
      this.particleSimBind = this.device.createBindGroup({
        layout: this.particleSimLayout,
        entries: [
          { binding: 0, resource: { buffer: this.particleUniform } },
          { binding: 1, resource: { buffer: this.particleBuf! } },
        ],
      });
    }
    const groups = Math.ceil(count / 64);
    for (let k = 0; k < steps; k++) {
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.particleSimPipeline!);
      cp.setBindGroup(0, this.particleSimBind);
      cp.dispatchWorkgroups(groups);
      cp.end();
    }
    this.simStepsDone += steps;

    if (!this.particleDrawBind) {
      this.particleDrawBind = this.device.createBindGroup({
        layout: this.particleDrawLayout,
        entries: [
          { binding: 0, resource: { buffer: this.particleUniform } },
          { binding: 1, resource: { buffer: this.particleBuf! } },
        ],
      });
    }
    const density = Math.min(1, Math.max(0, (params["density"] ?? 1) * this.motion.detail));
    const drawCount = Math.max(1, Math.floor(count * density));
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.visTex!.createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.particleDrawPipeline!);
    pass.setBindGroup(0, this.particleDrawBind);
    pass.draw(6, drawCount);
    pass.end();
  }

  private ensureMesh3dPipeline(): void {
    if (this.mesh3dPipeline) return;
    const module = this.device.createShaderModule({ code: MESH3D_WGSL });
    this.mesh3dPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.mesh3dLayout] }),
      vertex: {
        module,
        entryPoint: "vs_mesh",
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs_mesh", targets: [{ format: SCENE_FORMAT }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
  }

  private ensureDepth(w: number, h: number): void {
    if (this.depthTex && this.depthSize[0] === w && this.depthSize[1] === h) return;
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      size: [w, h],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthSize = [w, h];
  }

  /** Draw the instanced 3D bar grid into visTex (depth-tested). */
  private renderMesh3d(
    encoder: GPUCommandEncoder,
    time: number,
    f: AudioFeatures,
    params: ParamValues,
  ): void {
    this.ensureMesh3dPipeline();
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    this.ensureDepth(w, h);

    const deg = Math.PI / 180;
    const g = (k: string, d: number) => params[k] ?? d;
    // Motion→Rotation scales the auto-orbit speed (0 = camera holds still).
    const yaw = (g("camYaw", 30) + time * g("camSpin", 12) * this.motion.rotation) * deg;
    const pitch = g("camPitch", 32) * deg;
    const dist = g("camDist", 15);
    const fov = g("fov", 50) * deg;
    const targetY = g("targetY", 1);
    const cp = Math.cos(pitch);
    const eye: [number, number, number] = [
      Math.sin(yaw) * cp * dist,
      Math.sin(pitch) * dist + targetY,
      Math.cos(yaw) * cp * dist,
    ];
    const proj = mat4Perspective(fov, w / h, 0.1, 100);
    const view = mat4LookAt(eye, [0, targetY, 0], [0, 1, 0]);
    const vp = mat4Mul(proj, view);

    const F = this.mesh3dF32;
    F.set(vp, 0);
    F[16] = this.mesh3dSpec!.grid;
    F[17] = g("spacing", 0.6);
    F[18] = g("barWidth", 0.42);
    F[19] = g("heightScale", 6);
    F[20] = g("hue", 200);
    F[21] = g("hueRange", 120);
    F[22] = g("light", 0.9);
    F[23] = g("emissive", 0.5);
    F[24] = f.bins.length;
    F[25] = time;
    F[26] = f.drive;
    F[27] = f.driveBeat * this.motion.pulse; // beat pop obeys Pulse
    this.device.queue.writeBuffer(this.mesh3dUniform, 0, this.mesh3dData);

    if (!this.mesh3dBind) {
      this.mesh3dBind = this.device.createBindGroup({
        layout: this.mesh3dLayout,
        entries: [
          { binding: 0, resource: { buffer: this.mesh3dUniform } },
          { binding: 1, resource: { buffer: this.binsBuf! } },
        ],
      });
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.visTex!.createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTex!.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(this.mesh3dPipeline!);
    pass.setVertexBuffer(0, this.cubeBuf);
    pass.setBindGroup(0, this.mesh3dBind);
    const grid = this.mesh3dSpec!.grid;
    pass.draw(36, grid * grid);
    pass.end();
  }

  setOverlay(source: ImageBitmap | null): void {
    this.overlayTexture?.destroy();
    this.overlayTexture = null;
    if (source) {
      this.overlayTexture = this.device.createTexture({
        size: [source.width, source.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture: this.overlayTexture, premultipliedAlpha: true },
        [source.width, source.height],
      );
      // The copy snapshots the source synchronously; WebGPU does not retain
      // the bitmap. Release it now — the store rasterizes a fresh overlay on
      // every debounced change, so without this each one leaks until GC.
      source.close();
    }
    this.bindGroup = null; // rebind with the new texture view
    this.transitionBindGroup = null;
    this.compositeBind = null; // composite pass also samples the overlay
  }

  setCoverArt(source: ImageBitmap | null): void {
    this.coverTexture?.destroy();
    this.coverTexture = null;
    if (source) {
      this.coverTexture = this.device.createTexture({
        size: [source.width, source.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture: this.coverTexture, premultipliedAlpha: true },
        [source.width, source.height],
      );
      // The copy snapshots the bitmap synchronously; release it (same reason as
      // setOverlay — the host decodes a fresh one on every track change).
      source.close();
    }
    this.bindGroup = null;
    this.transitionBindGroup = null;
    this.compositeBind = null;
  }

  /** Resolves when all submitted GPU work has executed (export frame sync). */
  gpuDone(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone();
  }

  setPreset(preset: PresetDef): void {
    this.preset = preset;
    // Feedback is opt-in per preset (WGSL references feedbackSample). A new
    // preset must not inherit the previous one's trails, so clear the history.
    this.presetUsesFeedback = usesFeedback(preset);
    this.feedbackClearPending = true;
    // Particle preset: (re)allocate state and re-seed on the next frame.
    this.particleSpec = preset.particles ?? null;
    if (this.particleSpec) {
      this.ensureParticleBuffers(this.particleSpec.count);
      this.particleInitPending = true;
      this.simStepsDone = 0;
    }
    // 3D preset marker (camera + grid params drive it via the normal params).
    this.mesh3dSpec = preset.mesh3d ?? null;
    // Generate named accessors (P_<key>) for every param in ABI order so
    // preset WGSL never touches raw indices.
    const specs = allParams(preset);
    if (specs.length > MAX_PARAMS) {
      console.error(`[preset ${preset.id}] ${specs.length} params > ${MAX_PARAMS}`);
    }
    const accessors = specs
      .map((p, i) => `fn P_${p.key}() -> f32 { return params[${i}u]; }`)
      .join("\n");
    const module = this.device.createShaderModule({
      code: HEADER + COMPOSITE_BODY + FS_MAIN + accessors + "\n" + preset.wgsl,
    });
    // Surface WGSL mistakes during preset development
    void module.getCompilationInfo().then((info) => {
      for (const m of info.messages) {
        if (m.type === "error") {
          console.error(`[preset ${preset.id}] ${m.lineNum}:${m.linePos} ${m.message}`);
        }
      }
    });
    this.pipeline = this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: {
        module,
        entryPoint: "fs_main",
        targets: [{ format: SCENE_FORMAT }], // preset draws into the HDR scene target
      },
      primitive: { topology: "triangle-list" },
    });
    this.bindGroup = null; // rebuild lazily (depends on bins buffers)
  }

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render(f: AudioFeatures, time: number, params: ParamValues, transition?: TransitionState): void {
    if (!this.pipeline || !this.preset) return;
    this.ensureBinBuffers(f.bins.length);

    this.uniformF32[0] = time;
    this.uniformF32[1] = f.beatIntensity;
    this.uniformF32[2] = f.rms;
    this.uniformF32[3] = f.bass;
    this.uniformF32[4] = f.mid;
    this.uniformF32[5] = f.treble;
    this.uniformU32[6] = f.bins.length;
    this.uniformF32[7] = this.canvas.width / Math.max(1, this.canvas.height);
    this.uniformU32[8] = WAVE_POINTS;
    this.uniformF32[9] = f.duration > 0 ? f.time / f.duration : 0;
    this.uniformF32[10] = f.energy;
    this.uniformU32[11] = this.bg.mode;
    this.uniformF32[12] = this.bg.color[0];
    this.uniformF32[13] = this.bg.color[1];
    this.uniformF32[14] = this.bg.color[2];
    this.uniformF32[15] = 1;
    this.uniformF32[16] = f.drive;
    this.uniformF32[17] = f.driveBeat;
    this.uniformF32[18] = f.voice;
    this.uniformF32[19] = f.width;
    this.uniformF32[20] = f.bpm;
    this.uniformF32[21] = f.beatPhase;
    this.uniformF32[22] = f.barPhase;
    this.uniformF32[23] = f.kick;
    this.uniformF32[24] = f.snare;
    this.uniformF32[25] = f.hat;
    this.uniformF32[26] = this.smoothBins ? 1 : 0;
    // Global motion masters — presets read these to scale rotation, pulse and
    // element count consistently. Defaults (1) leave every preset as authored.
    this.uniformF32[28] = this.motion.rotation;
    this.uniformF32[29] = this.motion.pulse;
    this.uniformF32[30] = this.motion.detail;
    this.uniformF32[31] = this.motion.spectrumSmooth;
    // Feedback path is active only when the preset opts in AND we're not
    // mid-crossfade (feedback pauses during transitions). fs_main branches on
    // this: 1 => emit raw visual for the composite pass, 0 => inline composite.
    // Particle and 3D presets take dedicated draw paths and ignore the
    // fragment/feedback/crossfade machinery (they cut, not crossfade).
    const particlesActive = !!this.particleSpec;
    const mesh3dActive = !!this.mesh3dSpec;
    const special = particlesActive || mesh3dActive;
    const fading = !special && !!(transition && this.transitionPipeline && this.transitionPreset);
    const useFeedback = !special && this.presetUsesFeedback && !fading;
    this.uniformF32[27] = useFeedback ? 1 : 0;
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniformData);
    this.device.queue.writeBuffer(this.binsBuf!, 0, f.bins);
    this.device.queue.writeBuffer(this.peaksBuf!, 0, f.peaks);

    // Downsample waveform to a fixed-size buffer (chunk means)
    const src = f.waveform;
    const chunk = Math.max(1, Math.floor(src.length / WAVE_POINTS));
    for (let i = 0; i < WAVE_POINTS; i++) {
      let s = 0;
      const base = Math.min(src.length - chunk, i * chunk);
      for (let j = 0; j < chunk; j++) s += src[base + j];
      this.waveData[i] = s / chunk;
    }
    this.device.queue.writeBuffer(this.waveBuf, 0, this.waveData);

    this.paramsData.fill(0);
    allParams(this.preset).forEach((p, i) => {
      if (i < MAX_PARAMS) this.paramsData[i] = params[p.key] ?? p.default;
    });
    this.device.queue.writeBuffer(this.paramsBuf, 0, this.paramsData);

    const clearA = this.bg.mode === 2 ? 0 : 1;
    if (fading) {
      // Outgoing setup's params into the second storage buffer
      this.transitionParamsData.fill(0);
      allParams(this.transitionPreset!).forEach((p, i) => {
        if (i < MAX_PARAMS) this.transitionParamsData[i] = transition!.params[p.key] ?? p.default;
      });
      this.device.queue.writeBuffer(this.transitionParamsBuf, 0, this.transitionParamsData);
      this.device.queue.writeBuffer(
        this.blendUniform,
        0,
        new Float32Array([transition!.mix, 0, 0, 0]),
      );
      this.ensureFadeTargets();
    }
    this.ensureGraphTargets();
    // Particles + feedback both draw into visTex, then composite -> sceneTex.
    if (useFeedback || particlesActive || mesh3dActive) this.ensureFeedbackTargets();
    const scene = this.sceneTex!.createView();

    const encoder = this.device.createCommandEncoder();
    const drawPass = (
      pipeline: GPURenderPipeline,
      bindGroup: GPUBindGroup,
      view: GPUTextureView,
    ) => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: clearA }, storeOp: "store" },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    };

    if (particlesActive) {
      // Sim + additive draw into visTex, then the shared composite -> sceneTex.
      this.renderParticles(encoder, time, f, params);
      drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene);
    } else if (mesh3dActive) {
      // Depth-tested 3D bar grid into visTex, then the shared composite.
      this.renderMesh3d(encoder, time, f, params);
      drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene);
    } else if (useFeedback) {
      // Fresh history holds garbage / a previous preset's trails — clear it
      // before the first feedback frame so trails start from black.
      if (this.feedbackClearPending) {
        const clear = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: this.histTex!.createView(),
              loadOp: "clear",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              storeOp: "store",
            },
          ],
        });
        clear.end();
        this.feedbackClearPending = false;
      }
      // 1) preset draws its raw visual (samples histTex) into visTex.
      drawPass(this.pipeline, this.getBindGroup(), this.visTex!.createView());
      // 2) composite pass finishes visTex -> sceneTex (bg + overlay).
      drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene);
      // 3) capture this frame's raw visual as next frame's history.
      encoder.copyTextureToTexture({ texture: this.visTex! }, { texture: this.histTex! }, [
        this.feedbackSize[0],
        this.feedbackSize[1],
      ]);
    } else if (!fading) {
      // Non-feedback: preset composites inline straight into the scene target.
      drawPass(this.pipeline, this.getBindGroup(), scene);
    } else {
      drawPass(this.pipeline, this.getBindGroup(), this.fadeTexA!.createView());
      drawPass(
        this.transitionPipeline!,
        this.getTransitionBindGroup(),
        this.fadeTexB!.createView(),
      );
      if (!this.blendBindGroup) {
        this.blendBindGroup = this.device.createBindGroup({
          layout: this.blendPipeline!.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.fadeTexB!.createView() },
            { binding: 1, resource: this.fadeTexA!.createView() },
            { binding: 2, resource: this.overlaySampler },
            { binding: 3, resource: { buffer: this.blendUniform } },
          ],
        });
      }
      drawPass(this.blendPipeline!, this.blendBindGroup, scene);
    }

    // Post pass: bloom + tonemap/vignette/grain/chromatic -> swapchain.
    this.runPost(encoder, time, clearA);
    this.device.queue.submit([encoder.finish()]);
  }

  private getTransitionBindGroup(): GPUBindGroup {
    if (!this.transitionBindGroup) {
      this.transitionBindGroup = this.device.createBindGroup({
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: this.binsBuf! } },
          { binding: 2, resource: { buffer: this.peaksBuf! } },
          { binding: 3, resource: { buffer: this.transitionParamsBuf } },
          { binding: 4, resource: { buffer: this.waveBuf } },
          {
            binding: 5,
            resource: (this.overlayTexture ?? this.emptyOverlay).createView(),
          },
          { binding: 6, resource: this.overlaySampler },
          // Feedback is paused during crossfades: bind the empty history so a
          // transition preset's feedbackSample() reads black.
          { binding: 7, resource: this.emptyFeedback.createView() },
          { binding: 8, resource: (this.coverTexture ?? this.emptyCover).createView() },
        ],
      });
    }
    return this.transitionBindGroup;
  }

  dispose(): void {
    this.disposed = true;
    this.uniformBuf.destroy();
    this.paramsBuf.destroy();
    this.waveBuf.destroy();
    this.binsBuf?.destroy();
    this.peaksBuf?.destroy();
    this.overlayTexture?.destroy();
    this.emptyOverlay.destroy();
    this.coverTexture?.destroy();
    this.emptyCover.destroy();
    this.transitionParamsBuf.destroy();
    this.blendUniform.destroy();
    this.fadeTexA?.destroy();
    this.fadeTexB?.destroy();
    this.postUniform.destroy();
    this.emptyBloom.destroy();
    this.sceneTex?.destroy();
    this.bloomTexA?.destroy();
    this.bloomTexB?.destroy();
    this.emptyFeedback.destroy();
    this.visTex?.destroy();
    this.histTex?.destroy();
    this.particleUniform.destroy();
    this.particleBuf?.destroy();
    this.mesh3dUniform.destroy();
    this.cubeBuf.destroy();
    this.depthTex?.destroy();
    this.device.destroy();
  }

  private ensureBinBuffers(count: number): void {
    if (count <= this.binCapacity && this.binsBuf) return;
    this.binsBuf?.destroy();
    this.peaksBuf?.destroy();
    const size = count * 4;
    this.binsBuf = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.peaksBuf = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.binCapacity = count;
    this.bindGroup = null;
    this.transitionBindGroup = null;
    this.mesh3dBind = null; // references binsBuf
  }

  private getBindGroup(): GPUBindGroup {
    if (!this.bindGroup) {
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: this.binsBuf! } },
          { binding: 2, resource: { buffer: this.peaksBuf! } },
          { binding: 3, resource: { buffer: this.paramsBuf } },
          { binding: 4, resource: { buffer: this.waveBuf } },
          {
            binding: 5,
            resource: (this.overlayTexture ?? this.emptyOverlay).createView(),
          },
          { binding: 6, resource: this.overlaySampler },
          {
            binding: 7,
            resource: (this.presetUsesFeedback && this.histTex
              ? this.histTex
              : this.emptyFeedback
            ).createView(),
          },
          { binding: 8, resource: (this.coverTexture ?? this.emptyCover).createView() },
        ],
      });
    }
    return this.bindGroup;
  }
}
