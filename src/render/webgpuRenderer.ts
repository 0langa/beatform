import type { AudioFeatures } from "../audio/types";
import { getPrefs } from "../state/prefs";
import { allParams, DEFAULT_MOTION, DEFAULT_POST, paramOr } from "./types";
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
/** Frames a render-target group may sit unused before it is released (M23).
 * ~5 s at 60 fps: long enough that rapid preset cycling (a crossfade per
 * switch) never thrashes allocations, short enough to hand back hundreds of
 * MB during ordinary single-preset viewing. */
const RT_IDLE_FRAMES = 300;
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
const POST_UNIFORM_SIZE = 48; // 9 f32 (8 post params + transparent flag), 16B-aligned
/** Particle uniform block: 24 scalar lanes = 96 bytes. */
const PARTICLE_UNIFORM_SIZE = 96;
/** Fixed particle simulation rate. Steps are keyed to track time
 * (target = floor(time * SIM_FPS)) so the sim speed is frame-rate independent.
 *
 * Each step n runs with pu.time = (n+1)/SIM_FPS — the track time at the END of
 * that step — regardless of how many steps a given frame happens to batch. So
 * step 137 sees the same time whether it ran alone at 60 fps or second-of-two
 * at 30 fps, and the time-driven parts of the sim (flow field, respawn hash)
 * are identical across frame rates and between preview and export.
 *
 * The audio lanes (bass/drive/kick) are still per-FRAME, not per-step: at
 * 30 fps two steps share one feature sample. Resolving features per sim step
 * would mean running the whole feature pipeline 60x/s off the render path.
 * That residual is why PNG-hash baselines are compared at equal fps. */
const SIM_FPS = 60;
const PARTICLE_DT = 1 / SIM_FPS;
/** Live-safety cap on catch-up steps per frame (never hit during export). */
const MAX_SIM_CATCHUP = 8;
/** Uniform slots: one per catch-up step, plus one for the draw pass. Stride is
 * the WebGPU guaranteed minUniformBufferOffsetAlignment. */
const PARTICLE_SLOT_STRIDE = 256;
const PARTICLE_SLOTS = MAX_SIM_CATCHUP + 1;
const PARTICLE_DRAW_SLOT = MAX_SIM_CATCHUP;

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
  /** 1 when the frame is a transparent (premultiplied) delivery — PNG+alpha,
   * VP9-alpha, ProRes 4444. The post chain then has to carry alpha alongside
   * RGB instead of only modifying colour. */
  transparent: f32,
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
    // Transparent delivery: RGB comes from three taps, so coverage must span
    // them too or the fringe is clipped against the centre tap's alpha.
    a = select(g.a, max(g.a, max(r.a, bb.a)), p.transparent > 0.5);
  } else {
    let s = textureSampleLevel(srcTex, srcSmp, in.uv, 0.0);
    col = s.rgb;
    a = s.a;
  }
  // Additive bloom.
  var bloomAdd = vec3f(0.0);
  if (p.bloom > 0.0) {
    bloomAdd = textureSampleLevel(bloomTex, srcSmp, in.uv, 0.0).rgb * p.bloom;
    col = col + bloomAdd;
  }
  // Exposure + tonemap.
  col = col * p.exposure;
  if (p.tonemap > 0.5) { col = aces(col); }
  // Vignette.
  if (p.vignette > 0.0) {
    let d = length(toC) * 1.4142;
    let v = 1.0 - p.vignette * smoothstep(0.4, 1.0, d);
    col = col * v;
    // Transparent delivery: fade coverage with the light, or the corners come
    // out dark-AND-opaque instead of falling away.
    if (p.transparent > 0.5) { a = a * v; }
  }
  // Deterministic film grain (track-time seeded, not Math.random).
  if (p.grain > 0.0) {
    let n = hash(in.uv + fract(p.time)) - 0.5;
    // Premultiplied output divides by alpha on un-premultiply, which would
    // scale grain by 1/a — several times too strong in semi-transparent areas.
    col = col + n * p.grain * select(1.0, a, p.transparent > 0.5);
  }
  // Bloom adds emitted light; in premultiplied output the coverage has to rise
  // with it or the halo is visible in the preview and gone from the file.
  if (p.transparent > 0.5 && p.bloom > 0.0) {
    a = clamp(a + max(bloomAdd.r, max(bloomAdd.g, bloomAdd.b)), 0.0, 1.0);
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
  // Reserved (L24): no built-in preset reads this, but it's a "Legacy"-
  // labeled field in the documented custom-preset ABI (docs/presets.md's
  // audio-uniforms table), so it stays declared AND live rather than frozen
  // — a saved custom preset may still reference it by name.
  beatIntensity: f32,
  rms: f32,
  bass: f32,
  mid: f32,
  treble: f32,
  binCount: u32,
  aspect: f32,
  waveCount: u32,
  // Seconds of TRACK time this frame covers. Lets per-frame accumulations
  // (feedback trails) be expressed per-second instead of per-frame, so they
  // look the same at 30 fps, 60 fps and on a 144 Hz preview. Reuses what was
  // the dead progress lane — no ABI size change.
  dt: f32,
  energy: f32,
  bgMode: u32,
  bgColor: vec4f,
  drive: f32,
  driveBeat: f32,
  voice: f32,
  width: f32, // Reserved (L24): documented ABI ("Stereo width"), unread by any built-in.
  bpm: f32,
  beatPhase: f32,
  barPhase: f32,
  kick: f32,
  snare: f32, // Reserved (L24): documented ABI ("Per-drum onset envelope"), unread by any built-in.
  hat: f32, // Reserved (L24): documented ABI ("Per-drum onset envelope"), unread by any built-in.
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
@group(0) @binding(9) var bgTex: texture_2d<f32>;

// Reserved (L24): raw-index param access, superseded by the generated
// P_<key>() accessors (see setPreset()) which every built-in and custom
// preset now uses instead — zero call sites in this repo. Kept declared,
// not removed: it's cheap (a function definition, not a per-frame cost) and
// an existing hand-written custom preset could conceivably still call it.
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
 * 1 = full curve). At amount 0 it returns the exact nearest bin.
 *
 * nearest and the spline share ONE bin-center anchor (L5): bin i's
 * representative position is (i+0.5)/n, and fi below is x in that
 * fractional-index space — already needed for the spline's own control
 * points. nearest rounds that SAME fi to pick whichever of the spline's two
 * active control points (i1/i2) x is closer to, instead of separately
 * re-deriving a floor(x*n) index with no visible tie to the spline's
 * anchor. Previously the two were only coincidentally equal (they agree
 * almost everywhere on a uniform grid); now it is the same expression. */
fn binAt(x: f32) -> f32 {
  let n = f32(u.binCount);
  let fi = clamp(x, 0.0, 0.999) * n - 0.5;
  let nearest = bins[u32(clamp(round(fi), 0.0, n - 1.0))];
  let amt = specAmt();
  if (amt < 0.001) { return nearest; }
  let i = floor(fi);
  let t = fi - i;
  let i0 = u32(clamp(i - 1.0, 0.0, n - 1.0));
  let i1 = u32(clamp(i, 0.0, n - 1.0));
  let i2 = u32(clamp(i + 1.0, 0.0, n - 1.0));
  let i3 = u32(clamp(i + 2.0, 0.0, n - 1.0));
  return mix(nearest, catmullRom(bins[i0], bins[i1], bins[i2], bins[i3], t), amt);
}

/** peaks[] counterpart to binAt() — same bin-center anchor, see above. */
fn peakAt(x: f32) -> f32 {
  let n = f32(u.binCount);
  let fi = clamp(x, 0.0, 0.999) * n - 0.5;
  let nearest = peaks[u32(clamp(round(fi), 0.0, n - 1.0))];
  let amt = specAmt();
  if (amt < 0.001) { return nearest; }
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

/** Tempo-locked pulse: 1.0 exactly on every beat-grid beat, exponentially
 * decaying toward 0 before the next (sharp ~4 = soft swell, ~8 = punchy).
 * Falls back to the flux-driven driveBeat pulse when the track has no beat
 * grid yet (u.bpm == 0), so one call stays musical either way. */
fn gridPulse(sharp: f32) -> f32 {
  if (u.bpm < 1.0) { return u.driveBeat; }
  return max(exp(-u.beatPhase * sharp) - 0.018, 0.0) / 0.982;
}

/** Continuous beat counter within the bar: 0..4, advancing 1.0 per grid
 * beat. fract() of integer multiples gives tempo-locked scroll/travel that
 * stays continuous across the bar wrap. 0 when the track has no grid. */
fn beatRamp() -> f32 { return u.barPhase * 4.0; }

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

// ---------------------------------------------------------------------------
// Look kit. The difference between the presets that read as professional and
// the ones that read as amateur was never the idea, it was the finishing —
// so the finishing lives here, once, instead of being re-invented per preset.
// ---------------------------------------------------------------------------

/**
 * Inigo Quilez's cosine gradient. Cheap, always-smooth, and it stays
 * SATURATED across the whole ramp, which is what separates a designed palette
 * from the muddy olive/brown you get by lerping two hues through grey.
 * col(t) = a + b * cos(TAU * (c*t + d))
 */
fn cosPalette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(TAU * (c * t + d));
}

/**
 * Domain warping (IQ): fbm of a position that is itself displaced by fbm.
 * One extra octave of cost, but it turns smooth blobby noise into something
 * with filaments and structure — the difference between "fog" and "nebula".
 */
fn warpFbm(p: vec2f, warp: f32) -> f32 {
  let q = vec2f(fbm(p), fbm(p + vec2f(5.2, 1.3)));
  return fbm(p + q * warp);
}

/**
 * Filmic tone curve (ACES approximation, Krzysztof Narkowicz). Lets a preset
 * push highlights way past 1.0 for a genuine hot core instead of flat-topping
 * into a colour-shifted clipped mess. Feed it linear HDR, get displayable.
 */
fn tonemap(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

/** Ordered-ish dither. Dark gradients band badly on 8-bit; +-1/255 of noise
 * costs nothing and removes the stair-stepping that screams "cheap". */
fn grain(uv: vec2f, amt: f32) -> f32 {
  return (hash21(uv * 1024.0 + u.time * 60.0) - 0.5) * amt;
}

/** Radial vignette. 0.25-0.4 reads as "lit"; past ~0.6 it reads as a mistake. */
fn vignette(uv: vec2f, amt: f32) -> f32 {
  let d = distance(uv, vec2f(0.5));
  return 1.0 - d * d * amt;
}

/**
 * Kaleidoscope / club mirror. segments<=1 passes through, 2 is a plain left-
 * right mirror, higher folds into radial wedges. Operates on CENTERED uv.
 */
fn kaleido(p: vec2f, segments: f32) -> vec2f {
  if (segments < 1.5) { return p; }
  if (segments < 2.5) { return vec2f(abs(p.x), p.y); }
  let seg = TAU / segments;
  var a = atan2(p.y, p.x);
  a = abs(a - seg * floor(a / seg + 0.5));
  return vec2f(cos(a), sin(a)) * length(p);
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
  if (u.bgMode == 0u) {
    // The preset's own background is opaque by definition. Fragment presets
    // already return a = 1, but the compute-particle and mesh3d paths clear
    // visTex to a = 0 and emit per-sprite alpha — so without this a PNG
    // sequence or VP9-alpha export on the DEFAULT background came out with a
    // transparent sky behind Spectrum Scape and transparent gaps between
    // Particle Flow's sprites.
    out = vec4f(out.rgb, 1.0);
  }
  if (u.bgMode != 0u) {
    let a = clamp(max(out.r, max(out.g, out.b)), 0.0, 1.0);
    if (u.bgMode == 1u) {
      out = vec4f(u.bgColor.rgb * (1.0 - a) + out.rgb, 1.0);
    } else if (u.bgMode == 3u || u.bgMode == 4u) {
      // Image/video background, cover-fit: fill the frame, crop the excess.
      // For images blur/dim were baked into the bitmap on the CPU; for video
      // the current frame is uploaded to bgTex each rendered frame.
      let dims = vec2f(textureDimensions(bgTex));
      let texAspect = dims.x / max(dims.y, 1.0);
      var buv = uv - 0.5;
      if (texAspect > u.aspect) {
        buv.x *= u.aspect / texAspect;
      } else {
        buv.y *= texAspect / u.aspect;
      }
      let bg = textureSampleLevel(bgTex, overlaySmp, buv + 0.5, 0.0);
      out = vec4f(bg.rgb * (1.0 - a) + out.rgb, 1.0);
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
struct BlendU { mixv: f32, kind: f32, _p1: f32, _p2: f32 }
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

fn bhash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Scene transitions — all pure functions of (from, to, uv, m). m is the
// eased progress 0..1, so the result is deterministic (identical live/export).
// kind: 0 crossfade, 1 wipe L->R, 2 wipe up, 3 radial, 4 zoom-through,
// 5 glitch, 6 hard cut.
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let uv = in.uv;
  let m = bu.mixv;
  let a = textureSampleLevel(fromTex, smp, uv, 0.0);
  let b = textureSampleLevel(toTex, smp, uv, 0.0);
  let k = i32(bu.kind + 0.5);

  if (k == 1) { // wipe left->right, soft edge
    let e = smoothstep(m - 0.04, m + 0.04, uv.x);
    return mix(b, a, e);
  }
  if (k == 2) { // wipe bottom->top
    let e = smoothstep(m - 0.04, m + 0.04, 1.0 - uv.y);
    return mix(b, a, e);
  }
  if (k == 3) { // radial iris from center
    let d = distance(uv, vec2f(0.5, 0.5)) / 0.7071;
    let e = smoothstep(m - 0.04, m + 0.04, d);
    return mix(b, a, e);
  }
  if (k == 4) { // zoom-through: incoming zooms in from 1.4x, crossfade
    let scale = mix(1.4, 1.0, m);
    let zuv = (uv - vec2f(0.5)) * scale + vec2f(0.5);
    let bz = textureSampleLevel(toTex, smp, clamp(zuv, vec2f(0.0), vec2f(1.0)), 0.0);
    return mix(a, bz, m);
  }
  if (k == 5) { // glitch: block displacement peaking mid-transition + channel split
    let g = sin(m * 3.14159265); // 0 at ends, 1 at middle
    let row = floor(uv.y * 24.0);
    let shift = (bhash(vec2f(row, 3.0)) - 0.5) * 0.25 * g;
    let uvB = vec2f(fract(uv.x + shift), uv.y);
    let sp = 0.01 * g;
    let bCtr = textureSampleLevel(toTex, smp, uvB, 0.0);
    let br = textureSampleLevel(toTex, smp, vec2f(fract(uvB.x + sp), uvB.y), 0.0).r;
    let bb = textureSampleLevel(toTex, smp, vec2f(fract(uvB.x - sp), uvB.y), 0.0).b;
    // Keep the incoming frame's alpha — hardcoding 1.0 made transparent
    // (PNG/WebM-alpha) exports opaque for the whole glitch window.
    let bGl = vec4f(br, bCtr.g, bb, bCtr.a);
    return mix(a, bGl, smoothstep(0.0, 1.0, m));
  }
  if (k == 6) { // hard cut at the midpoint (beat-cut when fade is short)
    return select(a, b, m >= 0.5);
  }
  return mix(a, b, m); // 0 crossfade
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

// Overall force-budget multiplier. Before this existed, a particle's
// terminal speed under damping (vel settles toward force*dt/(1-damping) at
// steady state) worked out to roughly 0.03-0.05 NDC/sec at the default
// knobs: crossing the ~0.6 NDC gap from the spawn disc to the 1.15 respawn
// radius took 15-20+ seconds, so the field never had time to develop and
// particles just sat on top of the spawn distribution. That is what actually
// painted the "dense static blob" (confirmed by watching it render, not just
// by theory); the respawn-radius fix further down is the other half of it.
// This raises typical terminal speed into the ~0.15-0.3 NDC/sec range so
// particles visibly traverse the frame in a few seconds.
const FORCE_SCALE: f32 = 3.5;

@compute @workgroup_size(64)
fn cs_sim(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= pu.count) { return; }
  var pos = parts[i].pos;
  var vel = parts[i].vel;
  let seed = h11(f32(i) * 0.61803 + 0.123);
  // Per-particle burst direction; also reused below as the outward-drift
  // fallback at the origin so that edge case doesn't carry a fixed +x bias.
  let bdir = normalize(vec2f(h11(seed * 3.3) - 0.5, h11(seed * 7.7) - 0.5) + vec2f(1e-4));

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
  let r = length(pos);
  var outward = pos * (1.0 / max(r, 1e-5));
  if (r < 1e-4) { outward = bdir; }
  force += outward * (0.03 + pu.drive * 0.05);
  // Radial burst on the selected sync source's beats (falls back to kicks in
  // Kick mode), weighted a bit above the continuous terms so a kick reads as
  // a distinct scatter instead of blending into the ambient flow.
  force += bdir * max(pu.driveBeat, pu.kick * 0.5) * pu.beatBurst * 0.5;
  force *= FORCE_SCALE;

  // Per-step velocity retention, written as a per-second rate raised to dt so
  // its effective strength stays correct even if the sim's fixed step rate
  // (SIM_FPS in webgpuRenderer.ts, currently 60) ever changes. At today's
  // fixed dt=1/60 this is numerically identical to using pu.damping directly
  // per step (pow(d, 1) == d): same behaviour, just frame-rate-honest.
  let retention = pow(clamp(pu.damping, 0.001, 0.999), pu.dt * 60.0);
  vel = vel * retention + force * pu.dt;
  // Beat KICK: an instantaneous velocity impulse on the sync beat, on top of
  // the (damped) burst force above. A force is smoothed away by the damping
  // before it reads as motion; adding straight to velocity makes a kick
  // visibly scatter the field outward, then the flow reclaims it. Gated on a
  // fresh onset (driveBeat near its peak) so it fires once per beat, not every
  // frame of the decay.
  if (pu.driveBeat > 0.6) {
    vel += bdir * pu.driveBeat * pu.beatBurst * 0.06;
  }
  pos += vel * pu.dt;

  // Respawn once a particle drifts out of the framed region. sqrt() on the
  // radius sample makes the respawn disc AREA-uniform, matching the CPU seed
  // in initParticles(). Without it, sampling the radius uniformly instead of
  // its square root packs particles near r=0 (equal-width rings near the
  // centre cover less area but got the same particle count), which is what
  // permanently reinforced a hot core: every respawn re-piled particles on
  // the same spot instead of spreading across the disc. This is the other
  // half of the "dense blob" bug, independent of the velocity fix above.
  if (abs(pos.x) > 1.15 || abs(pos.y) > 1.15) {
    let a = h11(seed * 13.1 + pu.time) * 6.28318530718;
    let rr = sqrt(h11(seed * 5.5 + pu.time * 0.7));
    pos = vec2f(cos(a), sin(a)) * pu.spawnRadius * rr;
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

  // PER-PARTICLE constants, derived from the instance index alone. Never from
  // time: a stochastic value re-rolled every frame gives persistence of vision
  // nothing to lock onto, which is the single biggest reason a particle field
  // reads as TV static instead of as moving matter.
  let seed = f32(ii) * 0.61803 + 0.123;
  // Fake depth. Uniform size + uniform brightness is what made this look like
  // one flat sheet of noise; a spread of apparent distances gives the eye
  // near/far layers to separate, which is most of the "3D" impression.
  let depth = 0.35 + 0.65 * h11(seed * 2.7);
  // Long-tailed brightness instead of a flat random range: most particles
  // land in a modest band and only a rare few (the high tail of rnd^8) spike
  // hot. That reads as a few genuinely bright points in the field instead of
  // a uniform haze that clips to one flat white mass once enough of them
  // additively overlap.
  let rnd = h11(seed * 5.1);
  let bright = 0.2 + 0.35 * rnd + 1.05 * pow(rnd, 8.0);

  // Audio makes the whole field breathe: bass swells every particle, a beat
  // pops them a little bigger. Kept modest so the smooth curl flow still
  // dominates — this is "some reactiveness", not a strobe.
  let sizeReact = 1.0 + pu.bass * 0.35 + pu.driveBeat * 0.6 * pu.beatBurst * 0.35;
  let size = pu.size * depth * (1.0 + speed * pu.sizePulse) * sizeReact;

  // Streak along the direction of travel. A round dot carries no motion
  // information; an elongated one traces its own streamline, which is what
  // makes a curl-noise field read as FLOW rather than as scatter.
  let dir = select(vec2f(1.0, 0.0), p.vel / max(speed, 1e-6), speed > 1e-5);
  let perp = vec2f(-dir.y, dir.x);
  let stretch = 1.0 + min(speed * 26.0, 3.5);
  let off = dir * (c.x * size * stretch) + perp * (c.y * size);

  // pos is in NDC (-1..1 fills the frame); correct sprite x for aspect so
  // dots stay round. y is flipped for clip space.
  let clip = vec2f(p.pos.x + off.x / pu.aspect, -(p.pos.y + off.y));
  let hue = pu.hue + seedHue(ii) * pu.hueSpread + speed * pu.speedColor * 400.0;
  var out: VOut;
  out.pos = vec4f(clip, 0.0, 1.0);
  out.uv = c;
  // Beat flash + bass pump on brightness — the field visibly pulses with the
  // music instead of only its color drifting with speed. Scaled by beatBurst
  // so the one "reactivity" knob drives both the sim scatter and the visual
  // punch, and kept gentle so the flow reads as the main event.
  let glowReact = 1.0 + pu.bass * 0.5 + pu.driveBeat * 1.4 * pu.beatBurst * 0.4;

  // Nearer particles are brighter as well as bigger — the two cues together
  // are what sell depth.
  //
  // Divided by the stretch factor to conserve energy: these sprites are
  // ADDITIVELY blended, so a streak covering 4x the pixels of a dot deposits
  // 4x the light. Without this the field clipped to a solid white blob the
  // moment streaking was introduced (observed, not theorised).
  out.shade = hsl2rgb(hue, pu.sat, 0.6) * pu.brightness * bright * depth * glowReact
            / (0.45 + stretch * 0.75);
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
  // Perspective w == view-space distance from the camera plane, a free fog
  // depth with no extra uniforms. This is the cue that was missing: without
  // it, distant bars cut straight to black instead of receding.
  @location(3) fog: f32,
  @location(4) heightNorm: f32,
}

fn m3_tonemap(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
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
  out.shade = hsl2rgb(m.hue + r * m.hueRange + h * 24.0, 0.9, 0.55);
  out.height = h;
  out.fog = out.pos.w;
  // 0 at the floor, 1 near the top of the tallest bar — drives the hot core.
  out.heightNorm = clamp(h / max(m.heightScale * 0.6, 0.001), 0.0, 1.0);
  return out;
}

@fragment
fn fs_mesh(in: VOut) -> @location(0) vec4f {
  let n = normalize(in.normal);

  // Key light + a dimmer fill from the opposite side, plus a hemisphere
  // ambient (cool from above, near-black from below). A single light over a
  // flat 0.25 ambient is what made the city read as flat plastic; giving the
  // shaded faces some cool sky bounce gives every bar visible form.
  let key = max(dot(n, normalize(vec3f(0.4, 0.9, 0.3))), 0.0);
  let fill = max(dot(n, normalize(vec3f(-0.5, 0.35, -0.6))), 0.0) * 0.35;
  let sky = 0.5 + 0.5 * n.y;                       // 1 facing up, 0 facing down
  let ambient = mix(vec3f(0.03, 0.04, 0.07), vec3f(0.10, 0.12, 0.18), sky);
  var col = in.shade * (ambient + (key * m.light + fill));

  // Hot tops: the tallest bars desaturate toward white and push past 1.0 so
  // the tone map rolls them off as genuine emission rather than flat colour.
  let hot = smoothstep(0.55, 1.0, in.heightNorm);
  col = mix(col, vec3f(1.0), hot * 0.6);
  col += in.shade * hot * (0.6 + m.drive * 0.6 + m.driveBeat * 0.6);

  // Existing height emissive, kept.
  col += in.shade * clamp(in.height, 0.0, m.heightScale * 0.5) * m.emissive
       * (0.7 + m.drive * 0.6 + m.driveBeat * 0.5);

  // Distance fog: recede into a dark blue haze rather than a hard black cut.
  // Density chosen so the far edge of a default-distance camera softens
  // without swallowing the near bars.
  let fogAmt = 1.0 - exp(-in.fog * 0.045);
  let haze = vec3f(0.02, 0.03, 0.06);
  col = mix(col, haze, clamp(fogAmt, 0.0, 0.85));

  col = m3_tonemap(col * 1.1);
  return vec4f(col, 1.0);
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

/**
 * A preset opts into the feedback/trails path by CALLING the ABI helper.
 *
 * Detected on comment-stripped source and requiring an actual call token
 * `feedbackSample(` — a bare mention (`// see feedbackSample`) used to flip a
 * preset into an extra full-frame render pass it never actually used. WGSL has
 * no string literals to worry about, so stripping `//` and block comments is
 * sufficient.
 */
function usesFeedback(preset: PresetDef): boolean {
  const code = preset.wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return /feedbackSample\s*\(/.test(code);
}

/**
 * The shared WGSL prefix for a fragment preset: prelude + composite + FS entry
 * + the generated `P_<key>()` accessors in ABI (param-list) order, terminated
 * with a newline so the preset body starts on its own line. Kept separate from
 * the body so `compilePresetCheck` can measure the prefix line count and remap
 * compiler line numbers back onto the preset source.
 */
function presetPrefix(preset: PresetDef): string {
  const accessors = allParams(preset)
    .map((p, i) => `fn P_${p.key}() -> f32 { return params[${i}u]; }`)
    .join("\n");
  return HEADER + COMPOSITE_BODY + FS_MAIN + accessors + "\n";
}

/**
 * The exact WGSL module source handed to `createShaderModule` for a fragment
 * preset. Single source of truth for `setPreset`, the transition-pipeline
 * build, and `compilePresetCheck` — and the anchor of the golden shader test
 * (shaderGolden.test.ts), which snapshots this per built-in preset so any
 * accidental change to a preset body, the shared prelude, or the accessor ABI
 * fails a fast, GPU-free test instead of silently shipping a visual regression.
 */
export function assemblePresetModule(preset: PresetDef): string {
  return presetPrefix(preset) + preset.wgsl;
}

/**
 * The standalone WGSL sources that never pass through {@link assemblePresetModule}
 * (the compute/instanced-particle, 3D-mesh, crossfade-blend, post, and
 * scene-composite pipelines). Frozen by the golden test alongside the per-preset
 * modules so the whole compiled shader surface is covered, not just fragment
 * presets. These are the literal strings compiled at runtime.
 */
export const SHADER_SOURCES = {
  header: HEADER,
  composite: COMPOSITE_BODY,
  fsMain: FS_MAIN,
  particleSim: PARTICLE_SIM_WGSL,
  particleDraw: PARTICLE_DRAW_WGSL,
  mesh3d: MESH3D_WGSL,
  blend: BLEND_WGSL,
  post: POST_WGSL,
  sceneComposite: COMPOSITE_WGSL,
} as const;

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
  private emptyBg: GPUTexture;
  private bgTexture: GPUTexture | null = null;
  private coverTexture: GPUTexture | null = null;

  // Crossfade machinery: a second compiled preset + params, two offscreen
  // targets and a static blend pass (the render graph's first citizen).
  private transitionPreset: PresetDef | null = null;
  private transitionPipeline: GPURenderPipeline | null = null;
  private transitionPipelineFor: string | null = null;
  private transitionParamsBuf: GPUBuffer;
  private transitionBindGroup: GPUBindGroup | null = null;
  private transitionParamsData = new Float32Array(MAX_PARAMS);
  /** Does the OUTGOING (fading-out) preset call feedbackSample()? See the
   * `fading` branch of render() — an outgoing feedback preset keeps reading
   * the shared history buffer instead of being cut to emptyFeedback (M14). */
  private transitionPresetUsesFeedback = false;
  // Reused per crossfade frame (mix, kind, pad, pad) — avoids a per-frame alloc.
  private blendData = new Float32Array(4);
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
  /** Compiled fragment pipelines, keyed by preset def object (see setPreset).
   * Weak so an unregistered/edited custom preset's pipeline can be collected. */
  /** Per-preset compiled artifacts. `scene` targets the HDR scene texture
   * (the multi-pass graph); `direct` targets the swapchain and exists only
   * once the M24 fast path has needed it (all-neutral post, no multi-pass
   * features). Both share one shader module, so the fast path never pays a
   * second WGSL compile. */
  private pipelineCache = new WeakMap<
    PresetDef,
    { module: GPUShaderModule; scene: GPURenderPipeline; direct?: GPURenderPipeline }
  >();
  /** Previous render's track time, for the per-frame dt uniform (-1 = none). */
  private lastRenderTime = -1;
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

  // M23: full-res HDR targets are allocated on first use but were only ever
  // freed on resize/dispose — after one crossfade plus one feedback/particle/
  // 3D preset, ~330 MB (at 4K) of render targets sat retained for the whole
  // session. Each group stamps the frame it was last used; render() releases
  // a group once it has been idle for RT_IDLE_FRAMES. The ensure* guards
  // re-allocate on the next use, so this trades a one-off (re)allocation on
  // re-entry for hundreds of MB back during ordinary single-preset viewing.
  private frameIndex = 0;
  private fadeLastUsed = -1;
  private feedbackLastUsed = -1;
  private depthLastUsed = -1;
  private graphLastUsed = -1;

  private preset: PresetDef | null = null;
  private uniformData = new ArrayBuffer(UNIFORM_SIZE);
  private uniformF32 = new Float32Array(this.uniformData);
  private uniformU32 = new Uint32Array(this.uniformData);
  private paramsData = new Float32Array(MAX_PARAMS);
  private waveData = new Float32Array(WAVE_POINTS);

  private _onDeviceLost: ((reason: string) => void) | null = null;
  // L7: device.lost is wired inside create() (below), but every caller
  // assigns the public onDeviceLost callback AFTER `await create(...)`
  // returns — a real gap, not a theoretical one: the WebGPU spec allows a
  // device to be lost essentially immediately (the "driver keeps dying"
  // case the retry loop in services.ts exists for). A loss that lands in
  // that gap is captured here instead of being dropped, and delivered as
  // soon as a handler is attached (see the setter below).
  private pendingDeviceLoss: string | null = null;

  /**
   * Fires if the GPU device dies (driver reset, TDR) — host may recreate.
   * If the device was already lost before this was assigned, the buffered
   * reason fires on the next microtask after assignment rather than being
   * silently dropped (L7).
   */
  get onDeviceLost(): ((reason: string) => void) | null {
    return this._onDeviceLost;
  }
  set onDeviceLost(fn: ((reason: string) => void) | null) {
    this._onDeviceLost = fn;
    if (fn && this.pendingDeviceLoss !== null) {
      const reason = this.pendingDeviceLoss;
      this.pendingDeviceLoss = null;
      queueMicrotask(() => fn(reason));
    }
  }
  private disposed = false;

  static async create(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<WebGPURenderer> {
    if (!navigator.gpu) throw new Error("WebGPU not available");
    // GPU preference (Settings ▸ Performance) — a hint for dual-GPU machines.
    // In the export worker localStorage is absent, so prefs resolve to
    // "default" there; the live choice is what matters.
    const pref = getPrefs().powerPreference;
    const adapter = await navigator.gpu.requestAdapter(
      pref === "default" ? undefined : { powerPreference: pref },
    );
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    const renderer = new WebGPURenderer(canvas, device);
    void device.lost.then((info) => {
      if (renderer.disposed) return;
      console.error("[webgpu] device lost:", info.reason, info.message);
      if (renderer._onDeviceLost) {
        renderer._onDeviceLost(info.message);
      } else {
        renderer.pendingDeviceLoss = info.message;
      }
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
    // 1x1 black stand-in for the image background when none is set.
    this.emptyBg = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.emptyBg },
      new Uint8Array([0, 0, 0, 255]),
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
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindLayout],
    });
    // Particle pipelines: compute needs read_write on the state buffer, the
    // draw pass reads it — two layouts over the same buffer.
    this.particleUniform = device.createBuffer({
      size: PARTICLE_SLOT_STRIDE * PARTICLE_SLOTS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleSimLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          // One uniform SLOT per catch-up step, selected by dynamic offset.
          // queue.writeBuffer between compute passes would not work: those
          // writes all land before the encoder's commands are submitted, so
          // every step would read the last value written.
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
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
    this.transitionPresetUsesFeedback = preset ? usesFeedback(preset) : false;
    if (!preset) {
      this.transitionPipeline = null;
      this.transitionPipelineFor = null;
      return;
    }
    if (this.transitionPipelineFor === preset.id) return; // cached
    const module = this.device.createShaderModule({
      code: assemblePresetModule(preset),
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
        // COPY_SRC: a feedback preset crossfading IN copies its own fresh
        // fadeTexA output into histTex every frame during the fade (see the
        // `fading` branch of render()), so its trail keeps evolving instead
        // of freezing for the whole transition and snapping after (M14).
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
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

  /** Clear histTex to transparent black. A fresh feedback preset (built-in
   * switch or the first frame of a crossfade into/out of one) must not
   * inherit trails left over from whatever rendered before it. */
  private clearFeedbackHistory(encoder: GPUCommandEncoder): void {
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
          { binding: 9, resource: (this.bgTexture ?? this.emptyBg).createView() },
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
    d[8] = clearA === 0 ? 1 : 0; // transparent delivery → keep alpha correct
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

  /**
   * Fill one uniform slot. `time` is the slot's own track time: the end of a
   * sim step for the step slots, the frame time for the draw slot.
   */
  private writeParticleSlot(
    slot: number,
    time: number,
    f: AudioFeatures,
    params: ParamValues,
  ): void {
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
    this.device.queue.writeBuffer(
      this.particleUniform,
      slot * PARTICLE_SLOT_STRIDE,
      this.particleData,
    );
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
    // or a multi-second gap (seek) re-seeds and snaps — export runs forward
    // from 0 so this never triggers there, keeping exports bit-reproducible.
    const target = Math.floor(time * SIM_FPS);
    let steps = target - this.simStepsDone;
    if (this.particleInitPending || steps < 0 || steps > SIM_FPS * 2) {
      this.initParticles(count);
      this.simStepsDone = target;
      steps = 0;
    } else if (steps > MAX_SIM_CATCHUP) {
      // Starved frames (hidden window rendering at ~1-3 fps): run the cap's
      // worth and FORGIVE the deficit. Letting it accumulate used to trip the
      // reseed above about once a second — a stuttering respawn disc in the
      // exact background-capture case the frame loop keeps alive for.
      // Continuity beats wall-clock lockstep in a live preview.
      this.simStepsDone = target - MAX_SIM_CATCHUP;
      steps = MAX_SIM_CATCHUP;
    }
    steps = Math.min(steps, MAX_SIM_CATCHUP);

    // One slot per step, each carrying the track time at the END of that step.
    // Absolute step index n always runs at (n+1)/SIM_FPS, so a step's inputs
    // don't depend on how many steps its frame batched.
    for (let k = 0; k < steps; k++) {
      this.writeParticleSlot(k, (this.simStepsDone + k + 1) / SIM_FPS, f, params);
    }
    this.writeParticleSlot(PARTICLE_DRAW_SLOT, time, f, params);
    if (!this.particleSimBind) {
      this.particleSimBind = this.device.createBindGroup({
        layout: this.particleSimLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.particleUniform, offset: 0, size: PARTICLE_UNIFORM_SIZE },
          },
          { binding: 1, resource: { buffer: this.particleBuf! } },
        ],
      });
    }
    const groups = Math.ceil(count / 64);
    for (let k = 0; k < steps; k++) {
      const cp = encoder.beginComputePass();
      cp.setPipeline(this.particleSimPipeline!);
      cp.setBindGroup(0, this.particleSimBind, [k * PARTICLE_SLOT_STRIDE]);
      cp.dispatchWorkgroups(groups);
      cp.end();
    }
    this.simStepsDone += steps;

    if (!this.particleDrawBind) {
      this.particleDrawBind = this.device.createBindGroup({
        layout: this.particleDrawLayout,
        entries: [
          {
            binding: 0,
            resource: {
              buffer: this.particleUniform,
              offset: PARTICLE_DRAW_SLOT * PARTICLE_SLOT_STRIDE,
              size: PARTICLE_UNIFORM_SIZE,
            },
          },
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
    // Fallback comes from the preset's OWN ParamSpec.default (M19) — not a
    // hardcoded literal that could silently drift from spectrum-scape's spec.
    const g = (k: string) => paramOr(this.preset!, params, k);
    // Motion→Rotation scales the auto-orbit speed (0 = camera holds still).
    const yaw = (g("camYaw") + time * g("camSpin") * this.motion.rotation) * deg;
    const pitch = g("camPitch") * deg;
    const dist = g("camDist");
    const fov = g("fov") * deg;
    const targetY = g("targetY");
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
    F[17] = g("spacing");
    F[18] = g("barWidth");
    F[19] = g("heightScale");
    F[20] = g("hue");
    F[21] = g("hueRange");
    F[22] = g("light");
    F[23] = g("emissive");
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

  /**
   * Upload a new overlay bitmap. During a lyric fade or karaoke wipe this is
   * called on nearly every rendered frame (the frame key moves every 1/64
   * alpha step), so — like updateBackgroundVideoFrame — it reuses the texture
   * when dimensions match and only recreates on an actual size change (e.g.
   * a live-canvas resize). Recreating a full-res texture + rebinding 3 bind
   * groups every frame was the previous behavior and is expensive at 4K.
   */
  setOverlay(source: ImageBitmap | null): void {
    if (!source) {
      if (this.overlayTexture) {
        this.overlayTexture.destroy();
        this.overlayTexture = null;
        this.bindGroup = null;
        this.transitionBindGroup = null;
        this.compositeBind = null;
      }
      return;
    }
    if (
      !this.overlayTexture ||
      this.overlayTexture.width !== source.width ||
      this.overlayTexture.height !== source.height
    ) {
      this.overlayTexture?.destroy();
      this.overlayTexture = this.device.createTexture({
        size: [source.width, source.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.bindGroup = null; // rebind with the new texture view
      this.transitionBindGroup = null;
      this.compositeBind = null; // composite pass also samples the overlay
    }
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

  /**
   * Upload one video-background frame to bgTex. Unlike setBackgroundImage this
   * runs every rendered frame, so it reuses the texture (recreating only on a
   * size change) and does NOT close the source — video frames are owned by the
   * store's decoded loop and reused. Bind groups are invalidated only when the
   * texture object actually changes.
   */
  updateBackgroundVideoFrame(source: ImageBitmap): void {
    if (
      !this.bgTexture ||
      this.bgTexture.width !== source.width ||
      this.bgTexture.height !== source.height
    ) {
      this.bgTexture?.destroy();
      this.bgTexture = this.device.createTexture({
        size: [source.width, source.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.bindGroup = null;
      this.transitionBindGroup = null;
      this.compositeBind = null;
    }
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.bgTexture, premultipliedAlpha: false },
      [source.width, source.height],
    );
  }

  setBackgroundImage(source: ImageBitmap | null): void {
    this.bgTexture?.destroy();
    this.bgTexture = null;
    if (source) {
      this.bgTexture = this.device.createTexture({
        size: [source.width, source.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source },
        { texture: this.bgTexture, premultipliedAlpha: true },
        [source.width, source.height],
      );
      source.close(); // ownership transfer, same contract as setCoverArt
    }
    this.bindGroup = null;
    this.transitionBindGroup = null;
    this.compositeBind = null;
  }

  /** Resolves when all submitted GPU work has executed (export frame sync). */
  gpuDone(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Compile a preset's WGSL against the full ABI WITHOUT installing it —
   * the editor's check step. Returns compiler errors ("line N: message",
   * line numbers relative to the USER's code, header subtracted), empty
   * when the shader is clean.
   */
  async compilePresetCheck(preset: PresetDef): Promise<string[]> {
    const specs = allParams(preset);
    if (specs.length > MAX_PARAMS) {
      return [`too many params: ${specs.length} (max ${MAX_PARAMS})`];
    }
    const prefix = presetPrefix(preset);
    const prefixLines = prefix.split("\n").length - 1;
    this.device.pushErrorScope("validation");
    const module = this.device.createShaderModule({ code: prefix + preset.wgsl });
    const info = await module.getCompilationInfo();
    await this.device.popErrorScope().catch(() => null);
    return info.messages
      .filter((m) => m.type === "error")
      .map((m) => `line ${Math.max(1, m.lineNum - prefixLines)}: ${m.message}`);
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
    // Reuse the compiled pipeline for a preset we've already built. Keyed by
    // the def OBJECT, not its id: built-in presets are module singletons so
    // A→B→A hits the cache (it used to pay two full WGSL compiles, a visible
    // hitch on every live switch), while an edited custom preset arrives as a
    // NEW object and correctly recompiles.
    const cached = this.pipelineCache.get(preset);
    if (cached) {
      this.pipeline = cached.scene;
      this.bindGroup = null;
      return;
    }
    const module = this.device.createShaderModule({
      code: assemblePresetModule(preset),
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
    this.pipelineCache.set(preset, { module, scene: this.pipeline });
    this.bindGroup = null; // rebuild lazily (depends on bins buffers)
  }

  /** Swapchain-format variant of the active preset's pipeline, for the M24
   * fast path (neutral post → no HDR intermediate, no fs_final pass). Built
   * lazily from the cached module, then reused for the preset's lifetime. */
  private directPipelineFor(preset: PresetDef): GPURenderPipeline {
    const entry = this.pipelineCache.get(preset);
    if (!entry) throw new Error("direct pipeline requested before setPreset");
    if (!entry.direct) {
      entry.direct = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: entry.module, entryPoint: "vs_main" },
        fragment: {
          module: entry.module,
          entryPoint: "fs_main",
          targets: [{ format: this.format }],
        },
        primitive: { topology: "triangle-list" },
      });
    }
    return entry.direct;
  }

  /** Release render-target groups that have sat unused for RT_IDLE_FRAMES
   * (M23). Bind groups holding views of a destroyed texture are nulled so
   * the lazy getters rebuild them (feedback bindings fall back to
   * emptyFeedback until the targets are needed again). */
  private releaseIdleTargets(): void {
    const idle = (last: number) => this.frameIndex - last > RT_IDLE_FRAMES;
    if (this.fadeTexA && idle(this.fadeLastUsed)) {
      this.fadeTexA.destroy();
      this.fadeTexB?.destroy();
      this.fadeTexA = this.fadeTexB = null;
      this.blendBindGroup = null;
    }
    if (this.visTex && idle(this.feedbackLastUsed)) {
      this.visTex.destroy();
      this.histTex?.destroy();
      this.visTex = this.histTex = null;
      this.compositeBind = null;
      this.bindGroup = null;
      this.transitionBindGroup = null;
    }
    if (this.depthTex && idle(this.depthLastUsed)) {
      this.depthTex.destroy();
      this.depthTex = null;
    }
    if (this.sceneTex && idle(this.graphLastUsed)) {
      this.sceneTex.destroy();
      this.bloomTexA?.destroy();
      this.bloomTexB?.destroy();
      this.sceneTex = this.bloomTexA = this.bloomTexB = null;
      this.brightBind = this.blurHBind = this.blurVBind = this.finalBind = null;
      this.finalBloomSource = null;
    }
  }

  /** All-neutral post = fs_final is a pure copy, so the whole graph can be
   * skipped (M24). bloomThreshold is ignored: it only feeds the bright pass,
   * which bloom = 0 already disables. */
  private postIsNeutral(): boolean {
    const p = this.post;
    return (
      p.bloom <= 0 &&
      p.exposure === 1 &&
      !p.tonemap &&
      p.vignette <= 0 &&
      p.grain <= 0 &&
      p.chromatic <= 0
    );
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

    // Slots 1 (beatIntensity), 19 (width), 24 (snare) and 25 (hat) are unread
    // by any built-in preset but are kept written (not zeroed/skipped): all
    // four are part of the documented custom-preset ABI (see the Uniforms
    // struct comments above and docs/presets.md), so a saved custom preset
    // referencing one by name still gets a live value, not a frozen one (L24).
    this.uniformF32[0] = time;
    this.uniformF32[1] = f.beatIntensity;
    this.uniformF32[2] = f.rms;
    this.uniformF32[3] = f.bass;
    this.uniformF32[4] = f.mid;
    this.uniformF32[5] = f.treble;
    this.uniformU32[6] = f.bins.length;
    this.uniformF32[7] = this.canvas.width / Math.max(1, this.canvas.height);
    this.uniformU32[8] = WAVE_POINTS;
    // Track-time delta for this frame. Derived from successive render times so
    // it is correct on BOTH paths: the export advances time by exactly 1/fps,
    // the live loop by whatever the display did. Seeks/pauses produce negative
    // or huge deltas — fall back to a 60 fps step rather than let a trail
    // vanish or freeze.
    const dtRaw = this.lastRenderTime < 0 ? 0 : time - this.lastRenderTime;
    this.lastRenderTime = time;
    this.uniformF32[9] = dtRaw > 0 && dtRaw <= 0.1 ? dtRaw : 1 / 60;
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
      this.blendData[0] = transition!.mix;
      this.blendData[1] = transition!.kind ?? 0;
      this.device.queue.writeBuffer(this.blendUniform, 0, this.blendData);
      this.ensureFadeTargets();
    }
    // M24 fast path: with an all-neutral post chain and none of the
    // multi-pass features active, fs_final is a pure copy — draw the preset
    // straight to the swapchain and skip the full-res HDR intermediate plus
    // the extra fullscreen pass every frame. This is the app's DEFAULT state
    // (DEFAULT_POST is neutral), so most users get the win.
    const direct =
      !fading && !useFeedback && !particlesActive && !mesh3dActive && this.postIsNeutral();
    // M23: stamp which target groups this frame actually uses; anything idle
    // past RT_IDLE_FRAMES is released after submit.
    this.frameIndex++;
    const feedbackTargetsInUse =
      useFeedback ||
      particlesActive ||
      mesh3dActive ||
      (fading && (this.presetUsesFeedback || this.transitionPresetUsesFeedback));
    if (fading) this.fadeLastUsed = this.frameIndex;
    if (feedbackTargetsInUse) this.feedbackLastUsed = this.frameIndex;
    if (mesh3dActive) this.depthLastUsed = this.frameIndex;
    if (!direct) this.graphLastUsed = this.frameIndex;
    if (!direct) this.ensureGraphTargets();
    // Particles + feedback both draw into visTex, then composite -> sceneTex.
    // A crossfade needs histTex too whenever either side of it uses feedback
    // (M14) — the fading branch below shares it exactly like the plain
    // feedback path does, instead of forcing the outgoing/incoming preset to
    // emptyFeedback or a stale pre-fade snapshot.
    if (feedbackTargetsInUse) this.ensureFeedbackTargets();
    const scene = direct ? null : this.sceneTex!.createView();

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

    if (direct) {
      // M24: preset composites inline straight onto the swapchain.
      drawPass(
        this.directPipelineFor(this.preset),
        this.getBindGroup(),
        this.context.getCurrentTexture().createView(),
      );
    } else if (particlesActive) {
      // Sim + additive draw into visTex, then the shared composite -> sceneTex.
      this.renderParticles(encoder, time, f, params);
      drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene!);
    } else if (mesh3dActive) {
      // Depth-tested 3D bar grid into visTex, then the shared composite.
      this.renderMesh3d(encoder, time, f, params);
      drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene!);
    } else if (useFeedback) {
      // Fresh history holds garbage / a previous preset's trails — clear it
      // before the first feedback frame so trails start from black.
      if (this.feedbackClearPending) this.clearFeedbackHistory(encoder);
      // 1) preset draws its raw visual (samples histTex) into visTex.
      drawPass(this.pipeline, this.getBindGroup(), this.visTex!.createView());
      // 2) composite pass finishes visTex -> sceneTex (bg + overlay).
      drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene!);
      // 3) capture this frame's raw visual as next frame's history.
      encoder.copyTextureToTexture({ texture: this.visTex! }, { texture: this.histTex! }, [
        this.feedbackSize[0],
        this.feedbackSize[1],
      ]);
    } else if (!fading) {
      // Non-feedback: preset composites inline straight into the scene target.
      drawPass(this.pipeline, this.getBindGroup(), scene!);
    } else {
      // M14: a feedback preset crossfading in/out shares histTex with the
      // plain feedback path instead of being forced to emptyFeedback (a
      // visible pop to black on the outgoing side) or left reading whatever
      // pre-fade snapshot happened to be there (stale content that then
      // snaps once the fade ends, on the incoming side).
      //
      // Clear ONLY for the incoming preset, never merely because the outgoing
      // one uses feedback.
      //
      // setPreset() raises feedbackClearPending whenever the ACTIVE preset
      // changes — and at a fade's start the active preset is the INCOMING one.
      // So clearing on `transitionPresetUsesFeedback` wiped the OUTGOING
      // preset's accumulated trail at the exact instant the fade began, while
      // its blend weight was still ~1. That is the pop, measured: fading
      // echo-trails out to metaballs, frame 60 (the fade's first frame, mix~0,
      // so it should look almost identical to frame 59) dropped 73.5% in
      // encoded PNG size — the trail vanishing, not a crossfade.
      //
      // When the incoming preset uses feedback, clearing is still right: it
      // needs a clean slate, and the fadeTexA -> histTex copy below keeps its
      // trail alive from there. When only the OUTGOING one does, the history
      // must survive the fade — it IS that preset's picture. Nothing writes
      // histTex in that case, so the trail holds still for the fade; frozen
      // for a few hundred ms under a falling blend weight is invisible next
      // to a hard cut to black.
      if (this.feedbackClearPending && this.presetUsesFeedback) this.clearFeedbackHistory(encoder);
      // The outgoing pass (below) samples histTex as it stood at the END of
      // the PREVIOUS frame — still the outgoing preset's own last real trail
      // on the fade's first frame (perfect continuity, no pop), and the
      // incoming preset's evolving trail from then on (its blend weight is
      // already falling by that point, so any mismatch matters less).
      drawPass(this.pipeline, this.getBindGroup(), this.fadeTexA!.createView());
      drawPass(
        this.transitionPipeline!,
        this.getTransitionBindGroup(),
        this.fadeTexB!.createView(),
      );
      if (this.presetUsesFeedback) {
        // Keep the incoming preset's trail alive through the whole fade so
        // it continues smoothly once the transition ends, instead of
        // resuming from a stale pre-fade snapshot with a hard snap.
        encoder.copyTextureToTexture({ texture: this.fadeTexA! }, { texture: this.histTex! }, [
          this.feedbackSize[0],
          this.feedbackSize[1],
        ]);
      }
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
      drawPass(this.blendPipeline!, this.blendBindGroup, scene!);
    }

    // Post pass: bloom + tonemap/vignette/grain/chromatic -> swapchain.
    // Skipped on the direct path — the preset already drew the swapchain.
    if (!direct) this.runPost(encoder, time, clearA);
    this.device.queue.submit([encoder.finish()]);
    this.releaseIdleTargets();
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
          // An outgoing preset that itself uses feedback keeps reading the
          // shared history (see the `fading` branch of render()) instead of
          // being cut to black; one that doesn't never samples this anyway.
          {
            binding: 7,
            resource: (this.transitionPresetUsesFeedback && this.histTex
              ? this.histTex
              : this.emptyFeedback
            ).createView(),
          },
          { binding: 8, resource: (this.coverTexture ?? this.emptyCover).createView() },
          { binding: 9, resource: (this.bgTexture ?? this.emptyBg).createView() },
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
    this.emptyBg.destroy();
    this.bgTexture?.destroy();
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
    this.compositeBind = null; // also holds binsBuf/peaksBuf at bindings 1/2
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
          { binding: 9, resource: (this.bgTexture ?? this.emptyBg).createView() },
        ],
      });
    }
    return this.bindGroup;
  }
}
