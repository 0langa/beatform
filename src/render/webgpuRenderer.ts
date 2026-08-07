import type { AudioFeatures } from "../audio/types";
import { BUILDER_MAX_LAYERS } from "./builder2";
import { getPrefs } from "../state/prefs";
import { FEEDBACK_DT } from "./fixedFeedback";
import { allParams, BG_VIDEO, DEFAULT_MOTION, DEFAULT_POST, paramOr } from "./types";
import { WGSL_HSL2RGB, wgslAcesTonemap } from "./wgslLib";
import type {
  BgSettings,
  Mesh3DSpec,
  MotionSettings,
  ParamValues,
  ParticleSpec,
  PostSettings,
  PresetDef,
  RenderOptions,
  Renderer,
  ShadertoySpec,
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
/** Uniform struct size in bytes (scalars + vec4 bgColor + sync block + motion
 * + the background fit block). 36 f32 lanes, but the struct is 144 not 140:
 * bgOffset is a vec2f, whose 8-byte alignment lands it at byte 136, and WGSL
 * rounds the struct up to a multiple of its largest member alignment (bgColor's
 * 16). Keep this in step with the Uniforms struct below — a short buffer makes
 * every read past it zero, which reads as "the background snapped to stretch". */
const UNIFORM_SIZE = 144;
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
 * at 30 fps, so time-driven flow/respawn inputs use the same state grid.
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
 * vignette -> grain -> swapchain). All effects are pure functions of scene
 * texture + track time, so each path is deterministic for its frame input.
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
${wgslAcesTonemap("aces")}
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
  // Background image/video framing (bgMode 3/4), fed from bg.image/bg.video.
  // CSS object-fit: 0 cover, 1 contain, 2 stretch. Defaults (0 / 1 / 0,0)
  // reproduce the crop the composite pass used to hardcode.
  bgFit: f32,
  bgZoom: f32,
  // vec2f, so it aligns to 8 and sits at byte 136 — see UNIFORM_SIZE.
  bgOffset: vec2f,
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
// Builder Studio per-layer parameters: 16 f32 slots per layer instance
// (slot layout defined in render/builder2.ts). A storage buffer, not the
// 48-lane params array, so a deep layer stack never hits the uniform cap.
@group(0) @binding(10) var<storage, read> builderLayers: array<f32>;

// Builder Studio: parameter slot s (0..15) of layer instance li.
fn LP(li: u32, s: u32) -> f32 { return builderLayers[li * 16u + s]; }

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

/** Aspect (width/height) of the bound cover-art texture. */
fn coverAspect() -> f32 {
  let d = vec2f(textureDimensions(coverTex));
  return d.x / max(d.y, 1.0);
}

/**
 * Fit a box coordinate (0..1 across the destination) onto a texture of
 * arbitrary aspect — CSS object-fit, in the shader.
 *
 * Presets used to map a square box straight onto the image's full 0..1, which
 * silently STRETCHED every non-square cover: a 16:9 photo in a circular core
 * came out squashed. Fitting needs the image aspect, which the texture itself
 * carries, so no uniform is required.
 *
 * mode: 0 = cover (fill the box, crop the overflow), 1 = contain (whole image
 * inside, letterboxed), 2 = stretch (ignore aspect — the old behaviour, kept
 * so a look built on it can be reproduced). zoom magnifies about the centre
 * and offset pans, both in box units.
 *
 * Sampling CLAMPS at the edges, so a contain fit would smear its edge pixels
 * across the letterbox — callers guard with inBox().
 */
fn fitUV(boxUV: vec2f, texAspect: f32, boxAspect: f32, mode: f32, zoom: f32, offset: vec2f) -> vec2f {
  // Pan is subtracted in BOX space, before the zoom divide: applying it after
  // made the displacement scale with zoom, so at 4x an offset of 0.25 threw
  // the image a whole frame away and the usable part of the slider collapsed.
  var c = boxUV - vec2f(0.5) - offset;
  let ratio = texAspect / max(boxAspect, 1e-4);
  if (mode < 0.5) {
    // Written as a multiply by (boxAspect/texAspect), not a divide by ratio:
    // the two are algebraically equal but differ by an ULP, and this is the
    // exact form the hardcoded cover crop used before fitUV replaced it — so
    // a background saved before this helper existed still renders bit-identically.
    if (ratio > 1.0) { c.x = c.x * (boxAspect / max(texAspect, 1e-4)); } else { c.y = c.y * ratio; }
  } else if (mode < 1.5) {
    if (ratio > 1.0) { c.y = c.y * ratio; } else { c.x = c.x / ratio; }
  }
  return c / max(zoom, 0.01) + vec2f(0.5);
}

/** True when a fitted uv lands on the image — false inside a contain fit's
 * letterbox bars, where the caller should keep its own fill. */
fn inBox(uv: vec2f) -> bool {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

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

${WGSL_HSL2RGB}

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
${wgslAcesTonemap("tonemap")}

/** Ordered-ish dither. Dark gradients band badly on 8-bit; +-1/255 of noise
 * costs nothing and removes the stair-stepping that screams "cheap". */
fn grain(uv: vec2f, amt: f32) -> f32 {
  // fract(u.time): unbounded time loses f32 mantissa late in long tracks and
  // the dither slowly froze (audit R7 — the post-chain grain was fixed the
  // same way). Noise repeats its seed each second, invisible for dither.
  return (hash21(uv * 1024.0 + fract(u.time) * 60.0) - 0.5) * amt;
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

// ---- Frame-aware soft limiting (v2.44) ----------------------------------
// The frame in centered() space is the RECTANGLE |x| <= u.aspect*0.5,
// |y| <= 0.5 — not a circle. The old frame-safety rule hard-capped radial
// geometry at a fixed circle (r <= ~0.47, the half-HEIGHT), which sliced
// maxed-out settings along a visible circular edge on wide frames.
// These helpers replace clipping with COMPRESSION: below the knee the
// mapping is identity (defaults render exactly as before), above it the
// value approaches the frame border asymptotically — a hard edge cannot
// exist at ANY setting, by construction. Presets must use these instead of
// min(x, 0.47)-style caps.

// Distance from center to the frame border along direction angle a,
// with a small safety margin. Box reach, not a circle.
fn frameReach(a: f32) -> f32 {
  let c = abs(cos(a));
  let s = abs(sin(a));
  let rx = (u.aspect * 0.5 - 0.015) / max(c, 1e-4);
  let ry = 0.485 / max(s, 1e-4);
  return min(rx, ry);
}

// The largest radius of a FULL circle that fits the frame (short side).
fn frameCircle() -> f32 {
  return min(u.aspect * 0.5, 0.5) - 0.015;
}

// Compress x softly against lim: identity below 72% of lim, smooth
// asymptotic approach above — never reaches lim, never clips.
fn softLimit(x: f32, lim: f32) -> f32 {
  let knee = lim * 0.72;
  if (x <= knee) { return x; }
  return knee + (lim - knee) * tanh((x - knee) / (lim - knee));
}

// Fade against the actual frame BORDER (all four edges), for glow that
// bleeds past geometry. Replaces circular col *= smoothstep(0.5,0.45,r)
// fades, which darkened along a circle instead of the frame.
fn frameFade(p: vec2f) -> f32 {
  let box = vec2f(u.aspect * 0.5, 0.5) - abs(p);
  return smoothstep(0.0, 0.02, min(box.x, box.y));
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
      // Image/video background, framed by the shared fitUV (same helper, same
      // semantics as the centre-image slot). For images blur/dim were baked
      // into the bitmap on the CPU; for video the current frame is uploaded to
      // bgTex each rendered frame.
      let dims = vec2f(textureDimensions(bgTex));
      let buv = fitUV(uv, dims.x / max(dims.y, 1.0), u.aspect, u.bgFit, u.bgZoom, u.bgOffset);
      // Contain (or a zoom below 1, or a pan past the edge) leaves bars where
      // the image is not. Sampling CLAMPS, so those bars would be a smear of
      // the edge pixels — paint the background COLOUR there instead, which is
      // what a letterbox is supposed to be.
      let src = textureSampleLevel(bgTex, overlaySmp, buv, 0.0).rgb;
      let bg = select(u.bgColor.rgb, src, inBox(buv));
      out = vec4f(bg * (1.0 - a) + out.rgb, 1.0);
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

${WGSL_HSL2RGB}

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

/** Mesh-3D uniform: mat4 viewProj (64) + 29 scalar lanes (116) = 180 bytes,
 * padded to the struct's 16-byte alignment = 192. Exported for the test that
 * cross-checks it against the M3U struct's own field list. */
export const MESH3D_UNIFORM_SIZE = 192;

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
  binMap: f32, barShape: f32, saturation: f32, lightness: f32,
  hueLift: f32, driveHeight: f32, hotDrive: f32, hotBeat: f32,
  hotWindow: f32, glowBeat: f32, fillLight: f32, ambientLight: f32,
  fogDensity: f32, bandGlow: f32, bass: f32, mid: f32,
  treble: f32,
}
@group(0) @binding(0) var<uniform> m: M3U;
@group(0) @binding(1) var<storage, read> bins: array<f32>;

${WGSL_HSL2RGB}

// The roster colour-tier scaler — same body as the fragment presets'
// WGSL_COLOR_CONTROLS (colorControls.test.ts pins that text; the mesh module
// is its own compilation unit with no P_<key>() accessors, so the routing
// contract for THIS copy is pinned by spectrumScape.test.ts instead). 1 is a
// pixel-exact no-op: value * 1.0 is exact in IEEE, and the <= 1 branch
// avoids the min() on the neutral path.
fn colorScale(value: f32, control: f32) -> f32 {
  if (control <= 1.0) { return value * control; }
  return min(value * control, 1.0);
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
  // Band response, premixed in the vertex stage: the band energy of this
  // bar's own spectral region times the Band response param. Exactly 0 at
  // the param's default of 0, making the fragment's (1 + band) multiply an
  // exact no-op.
  @location(5) band: f32,
}

${wgslAcesTonemap("m3_tonemap")}

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
  // Frequency position 0..1 of this column — the Layout enum picks the
  // mapping (its lane is binMap: 'layout' is a WGSL reserved word). Rings
  // (the default) is the original radial index: concentric rings pulse with
  // frequency, and fr is the untouched radial expression so the default
  // frame cannot move. Rows reads the grid like a raster (ii sweeps columns
  // then rows), a bass ridge sweeping to treble. Spiral winds the spectrum
  // around the centre; fract wraps it into Archimedean arms.
  let rr = length(vec2f(dx, dz)) / max(m.grid * 0.5, 1.0);
  var fr = rr;
  if (m.binMap > 1.5) {
    fr = fract(rr - atan2(dz, dx) * 0.15915494);
  } else if (m.binMap > 0.5) {
    fr = f32(ii) / max(m.grid * m.grid - 1.0, 1.0);
  }
  let bi = u32(clamp(fr, 0.0, 0.999) * m.binCount);
  // Overall height rides the selected sync source so the Sync panel matters.
  // The drive gain is the Loudness rise param (default = the old 0.7).
  let h = bins[bi] * m.heightScale * (0.7 + m.drive * m.driveHeight) + 0.03;
  // Axis-only scale + translate => axis-aligned normals pass through.
  let world = vec3f(
    inPos.x * m.barWidth + dx * m.spacing,
    inPos.y * h,
    inPos.z * m.barWidth + dz * m.spacing,
  );
  // The same bar WITHOUT the drive gain, for everything that shades rather
  // than positions. GEOMETRY should grow with loudness — that is the point of
  // the sync panel — but hue, the hot-top threshold and the emissive term all
  // read a height that already carries that gain, and each of them multiplies
  // by drive AGAIN in the fragment stage. Loudness therefore landed twice, so
  // on a real master (-7 LUFS) every bar cleared the hot-top threshold at
  // once and the whole city washed to flat white: no skyline, no colour, no
  // depth. Shading off the drive-free height makes "tall" mean tall RELATIVE
  // to the other bars, which is what the hot core was always documented to
  // mean, and leaves the single explicit drive multiplier in the fragment as
  // the one place loudness brightens the scene. At drive == 0 hLit == h, so
  // this is an exact no-op on silence and scales in smoothly from there.
  let hLit = bins[bi] * m.heightScale * 0.7 + 0.03;
  var out: VOut;
  out.pos = m.viewProj * vec4f(world, 1.0);
  // Box normals are axis-aligned, so the non-uniform (barWidth, h, barWidth)
  // bar scale passes them through untouched — that branch is the shipped
  // path, kept bit-exact. The pyramid's slanted faces DO shear under the
  // scale, so the non-box shapes take the inverse-scale (inverse-transpose)
  // route; the round column's normals are all horizontal or vertical, which
  // that route preserves in direction. fs_mesh normalizes.
  out.normal = inNormal;
  if (m.barShape > 0.5) {
    out.normal = inNormal / vec3f(m.barWidth, max(h, 0.001), m.barWidth);
  }
  // Hue rides the frequency position and the bar's own (drive-free) height;
  // saturation/lightness route the authored 0.9/0.55 through the shared
  // colour-tier scalers — pixel-exact at their neutral default of 1.
  out.shade = hsl2rgb(
    m.hue + fr * m.hueRange + hLit * m.hueLift,
    colorScale(0.9, m.saturation),
    colorScale(0.55, m.lightness),
  );
  out.height = hLit;
  out.fog = out.pos.w;
  // Per-region band response: which third of the spectrum this bar sits in
  // picks its band, with linear crossovers between neighbours, and the Band
  // response param scales the result.
  let bandE = mix(
    mix(m.bass, m.mid, clamp(fr * 3.0 - 0.5, 0.0, 1.0)),
    m.treble,
    clamp(fr * 3.0 - 1.5, 0.0, 1.0),
  );
  out.band = bandE * m.bandGlow;
  // 0 at the floor, 1 near the top of the tallest bar — drives the hot core.
  // 0.42 == the old 0.6 threshold folded through hLit's 0.7 gain, so a
  // drive-free frame keeps exactly the hot core it had before. The ceiling is
  // above 1 only so fs_mesh can slide its threshold up on loud material and
  // still have somewhere to slide to; smoothstep clamps, so the un-slid
  // 0.55..1.0 window behaves exactly as it did when this was clamped at 1.
  out.heightNorm = clamp(hLit / max(m.heightScale * 0.42, 0.001), 0.0, 1.7);
  return out;
}

@fragment
fn fs_mesh(in: VOut) -> @location(0) vec4f {
  let n = normalize(in.normal);

  // Key light + a dimmer fill from the opposite side, plus a hemisphere
  // ambient (cool from above, near-black from below). A single light over a
  // flat 0.25 ambient is what made the city read as flat plastic; giving the
  // shaded faces some cool sky bounce gives every bar visible form. The rig
  // SCALES are params (fill default 0.35, ambient default 1 — the shipped
  // literals); the directions stay fixed, they are the mode's signature.
  let key = max(dot(n, normalize(vec3f(0.4, 0.9, 0.3))), 0.0);
  let fill = max(dot(n, normalize(vec3f(-0.5, 0.35, -0.6))), 0.0) * m.fillLight;
  let sky = 0.5 + 0.5 * n.y;                       // 1 facing up, 0 facing down
  let ambient = mix(vec3f(0.03, 0.04, 0.07), vec3f(0.10, 0.12, 0.18), sky) * m.ambientLight;
  var col = in.shade * (ambient + (key * m.light + fill));

  // Hot tops: the tallest bars desaturate toward white and push past 1.0 so
  // the tone map rolls them off as genuine emission rather than flat colour.
  // The window rides drive because heightNorm measures a bar against the
  // TALLEST POSSIBLE bar, not against the tallest bar on screen: on a loud
  // broadband master almost every bin sits high, so a fixed 0.55 threshold
  // fired on the entire city at once and "the tallest bars glow hotter"
  // degenerated into "the whole city is white". Sliding the window up with
  // loudness keeps the hot core on the actual peaks. No-op at drive == 0.
  // The ramp width (Hot top fade, default 0.45) and the drive/beat response
  // scales (defaults 0.6/0.6 — the shipped literals) are params: the beat
  // term is the mode's first real beat-response control.
  let hotLo = 0.55 + m.drive * 0.6;
  let hot = smoothstep(hotLo, hotLo + m.hotWindow, in.heightNorm);
  col = mix(col, vec3f(1.0), hot * 0.6);
  col += in.shade * hot * (0.6 + m.drive * m.hotDrive + m.driveBeat * m.hotBeat);

  // Height emissive, normalised against the Height knob instead of scaling
  // with it. in.height is a WORLD height, so this term used to read
  // heightScale * (bar shape) * emissive: raising Height from 6 to 16 did not
  // just build taller bars, it multiplied their glow by 16/6 as well. Every
  // washed-out style was a tall one (Street Level 13, Canyon 14, Neon Grid
  // 16) and every intact one was near the default — Glow was silently a
  // second Height knob. Dividing by heightScale (and restoring the default
  // heightScale of 6) makes the term depend on the bar's SHAPE only, so Glow
  // means glow at any Height. Identical at heightScale == 6, which is the
  // default and therefore the out-of-box look.
  // The beat term (Glow pulse, default 0.5 — the shipped literal) is the
  // second beat-response param: the whole city's glow pumps with it.
  col += in.shade * clamp(in.height / m.heightScale, 0.0, 0.5) * 6.0 * m.emissive
       * (0.7 + m.drive * 0.6 + m.driveBeat * m.glowBeat);

  // Band response: the bar's own spectral region brightens it — bass bars
  // pump with bass, treble bars shimmer with hats. in.band is 0 at the
  // default, so this is an exact multiply by 1.
  col *= 1.0 + in.band;

  // Distance fog: recede into a dark blue haze rather than a hard black cut.
  // Density is a param (default 0.045, the shipped literal) so the far edge
  // of a default-distance camera softens without swallowing the near bars.
  let fogAmt = 1.0 - exp(-in.fog * m.fogDensity);
  let haze = vec3f(0.02, 0.03, 0.06);
  col = mix(col, haze, clamp(fogAmt, 0.0, 0.85));

  col = m3_tonemap(col * 1.1);
  return vec4f(col, 1.0);
}
`;

/**
 * Vertex ranges of the three bar shapes inside the shared mesh vertex buffer,
 * indexed by spectrum-scape's barShape enum value: [firstVertex, vertexCount].
 * Shape 0 (the box) MUST stay at offset 0 with the exact 36-vertex layout
 * that always shipped — the default draw (36 verts from 0) is then
 * byte-identical to the pre-shape renderer. Exported for the geometry test.
 */
export const MESH3D_BAR_SHAPES: ReadonlyArray<readonly [number, number]> = [
  [0, 36], // box
  [36, 18], // pyramid
  [54, 84], // round (octagonal) column
];

/** Unit-column vertex buffer (x,z in -0.5..0.5, y in 0..1), pos + normal, for
 * instanced 3D bars: the classic 36-vertex box first (byte-stable — see
 * MESH3D_BAR_SHAPES), then the pyramid and round-column variants appended
 * behind it. Culling is disabled so winding order doesn't matter. */
export function cubeColumnVerts(): Float32Array {
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

  // Pyramid (shape 1): four slanted faces to an apex over the same footprint,
  // plus the base. Flat per-face normals; the vertex stage inverse-scales
  // them (slanted normals shear under the non-uniform bar scale — the box's
  // axis-aligned normals never did, which is why the box path skips it).
  type V3 = [number, number, number];
  const norm = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const apex: V3 = [0, 1, 0];
  const base: V3[] = [
    [-0.5, 0, -0.5],
    [0.5, 0, -0.5],
    [0.5, 0, 0.5],
    [-0.5, 0, 0.5],
  ];
  for (let i = 0; i < 4; i++) {
    const a = base[i];
    const b = base[(i + 1) % 4];
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]];
    const n = norm(cross(e2, e1)); // outward + up
    for (const v of [a, b, apex]) out.push(v[0], v[1], v[2], n[0], n[1], n[2]);
  }
  for (const v of [base[0], base[2], base[1], base[0], base[3], base[2]]) {
    out.push(v[0], v[1], v[2], 0, -1, 0);
  }

  // Round column (shape 2): an octagonal prism inscribed in the box
  // footprint. Every normal is horizontal (sides) or vertical (caps), both
  // of which the non-uniform bar scale preserves in direction — the inverse
  // scale the pyramid needs is a direction no-op here.
  const oct: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    oct.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]);
  }
  for (let k = 0; k < 8; k++) {
    const [x0, z0] = oct[k];
    const [x1, z1] = oct[(k + 1) % 8];
    const am = ((k + 0.5) * Math.PI) / 4;
    const n: V3 = [Math.cos(am), 0, Math.sin(am)];
    const qa: V3 = [x0, 0, z0];
    const qb: V3 = [x0, 1, z0];
    const qc: V3 = [x1, 1, z1];
    const qd: V3 = [x1, 0, z1];
    for (const v of [qa, qb, qc, qa, qc, qd]) out.push(v[0], v[1], v[2], n[0], n[1], n[2]);
  }
  for (const [y, ny] of [
    [1, 1],
    [0, -1],
  ] as const) {
    for (let k = 1; k < 7; k++) {
      for (const [x, z] of [oct[0], oct[k], oct[k + 1]]) out.push(x, y, z, 0, ny, 0);
    }
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
export function presetUsesFeedback(preset: PresetDef): boolean {
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
// ---------------------------------------------------------------------------
// Imported Shadertoy visuals (FEAT-001) — dedicated compatibility pipeline.
//
// A `shadertoy` preset's `wgsl` is a COMPLETE fragment module emitted by the
// Rust-side transpiler: own uniform block + four channel textures + one
// sampler on @group(0) bindings 0–5, entry `@fragment fn main`. It cannot
// share the snippet ABI's pipeline layout (11 bindings, storage buffers), so
// it runs on its own layout with this fullscreen-triangle vertex stage
// appended to the module.
// ---------------------------------------------------------------------------

const SHADERTOY_VS_WGSL = /* wgsl */ `
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(pos[i], 0.0, 1.0);
}
`;

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
  shadertoyVs: SHADERTOY_VS_WGSL,
} as const;

/** Shadertoy audio texture geometry: 512 columns, row 0 = spectrum,
 * row 1 = waveform — the site's own music-channel convention. */
export const SHADERTOY_AUDIO_WIDTH = 512;
/** Bytes per shadertoy uniform block (matches the transpiler's emitted
 * struct: 36 f32/i32 lanes, relaxed-layout f32 array tail). */
export const SHADERTOY_UNIFORM_SIZE = 144;

/**
 * Pack the Shadertoy uniform block. EVERY value derives from track time or
 * constants — no wall clock, no mouse, no frame counters that could differ
 * between the live loop and the export loop — so preview === export holds by
 * construction:
 *  - iTime is track time; iFrame/iDate.w are derived from it, never counted.
 *  - iTimeDelta/iFrameRate are the fixed 60 Hz analysis clock, not the
 *    display's — a 144 Hz preview and a 30 fps export see identical values.
 *  - iMouse is 0 (no pointer in an export) and iDate's calendar part is a
 *    fixed epoch, so date-seeded randomness is stable across runs.
 */
export function packShadertoyUniforms(
  buf: ArrayBuffer,
  time: number,
  width: number,
  height: number,
): void {
  const f = new Float32Array(buf);
  const i = new Int32Array(buf);
  f[0] = width;
  f[1] = height;
  f[2] = 1; // iResolution.z — Shadertoy sends pixel aspect, always 1 here
  f[3] = time;
  f[4] = 1 / 60; // iTimeDelta: fixed analysis-clock step
  f[5] = 60; // iFrameRate
  i[6] = Math.round(time * 60); // iFrame on the same fixed clock
  f[7] = 48000; // iSampleRate
  f[8] = 0; // iMouse
  f[9] = 0;
  f[10] = 0;
  f[11] = 0;
  f[12] = 2026; // iDate: fixed epoch + track time as seconds-of-day
  f[13] = 0;
  f[14] = 1;
  f[15] = time;
  // iChannelResolution[4], vec3 stride 16: ch0 is the audio texture, the
  // rest are 1x1 black placeholders.
  f[16] = SHADERTOY_AUDIO_WIDTH;
  f[17] = 2;
  f[18] = 1;
  for (let c = 1; c < 4; c++) {
    f[16 + c * 4] = 1;
    f[17 + c * 4] = 1;
    f[18 + c * 4] = 1;
  }
  // iChannelTime[4], f32 stride 4 (relaxed uniform layout, tint-verified).
  f[32] = time;
  f[33] = time;
  f[34] = time;
  f[35] = time;
}

/**
 * Fill the audio texture's pixel rows (rgba8unorm, value in R) from the same
 * arrays the storage-buffer path uploads, so both ABIs see one truth:
 * row 0 = display spectrum bins linearly resampled across 512 columns
 * (bins are 0..1), row 1 = the already-downsampled 512-point waveform
 * mapped from -1..1 to 0..1, Shadertoy's own encoding.
 */
export function packShadertoyAudioRows(
  out: Uint8Array,
  bins: Float32Array,
  wave: Float32Array,
): void {
  const w = SHADERTOY_AUDIO_WIDTH;
  const n = bins.length;
  for (let x = 0; x < w; x++) {
    let v = 0;
    if (n === 1) {
      v = bins[0];
    } else if (n > 1) {
      const pos = (x / (w - 1)) * (n - 1);
      const i0 = Math.floor(pos);
      const i1 = Math.min(n - 1, i0 + 1);
      v = bins[i0] + (bins[i1] - bins[i0]) * (pos - i0);
    }
    const spec = Math.max(0, Math.min(1, v));
    out[x * 4] = Math.round(spec * 255);
    out[x * 4 + 3] = 255;
    const wv = Math.max(-1, Math.min(1, wave[Math.min(x, wave.length - 1)] ?? 0));
    out[(w + x) * 4] = Math.round((0.5 + 0.5 * wv) * 255);
    out[(w + x) * 4 + 3] = 255;
  }
}

// ---------------------------------------------------------------------------
// FEAT-005 deep-colour frame tap — f16 → u16 conversion (pure, CPU-side).
//
// readbackDeepFrame() maps the rgba16float deep target and hands the encoder
// tightly-packed rgba64le-order u16. The conversion lives in exported pure
// functions (not inline in the readback) because JS has no native f16 decode —
// the IEEE 754 half decode below is hand-rolled and MUST stay pinned by unit
// tests against known bit patterns, or a silent decode bug would ship subtly
// wrong colour in every "10-bit" file while looking plausible on screen.
// ---------------------------------------------------------------------------

/**
 * Decode one IEEE 754 binary16 bit pattern to a JS number.
 * Handles zero, subnormals (exp 0: mant × 2^-24), normals, ±Infinity and NaN.
 */
export function f16BitsToF32(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24; // ±0 and subnormals
  if (exp === 0x1f) return mant !== 0 ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/**
 * One f16 bit pattern → one rgba64le channel value:
 * round(clamp(f16, 0, 1) × 65535). The clamp is the quantize step the deep
 * lane deliberately delays until AFTER tonemapping: fs_final's output is
 * already display-referred 0..1, so anything outside that range is either
 * bloom overshoot (clamps to white, same as the 8-bit path) or a NaN from a
 * degenerate shader input — mapped to 0 (black) because NaN has no order and
 * must never leak driver-dependent garbage into a deterministic export.
 */
export function f16ToUnorm16(bits: number): number {
  const v = f16BitsToF32(bits);
  if (Number.isNaN(v)) return 0;
  return Math.round(Math.min(1, Math.max(0, v)) * 65535);
}

/**
 * Strip WebGPU's 256-byte row alignment from a mapped texture readback:
 * copyTextureToBuffer pads every row to a 256-byte multiple, and the encoder
 * contract is tightly-packed rows. `src` is the mapped buffer viewed as u16
 * words (still f16 bit patterns); output rows are width × 4 words.
 */
export function stripRowPadding(
  src: Uint16Array,
  width: number,
  height: number,
  paddedBytesPerRow: number,
): Uint16Array {
  const rowWords = width * 4; // RGBA, one u16 word per channel
  const srcRowWords = paddedBytesPerRow >> 1;
  const out = new Uint16Array(rowWords * height);
  for (let y = 0; y < height; y++) {
    out.set(src.subarray(y * srcRowWords, y * srcRowWords + rowWords), y * rowWords);
  }
  return out;
}

/** f16-bits → u16 lookup table (all 65536 patterns), built once on first use.
 * A 1080p frame is ~8.3M channel conversions; the table turns each into one
 * indexed load, and — because it is generated FROM f16ToUnorm16 — it cannot
 * drift from the tested decode. */
let f16Lut: Uint16Array | null = null;

/**
 * Fused strip-padding + f16→u16 conversion: one pass, one allocation.
 * Semantically identical to `f16ToUnorm16` mapped over `stripRowPadding`
 * (the unit tests assert exactly that equivalence); fused because composing
 * the two would allocate a second ~16 MB array per 1080p frame.
 */
export function deepFrameToRgba64(
  src: Uint16Array,
  width: number,
  height: number,
  paddedBytesPerRow: number,
): Uint16Array {
  if (!f16Lut) {
    f16Lut = new Uint16Array(0x10000);
    for (let i = 0; i < 0x10000; i++) f16Lut[i] = f16ToUnorm16(i);
  }
  const lut = f16Lut;
  const rowWords = width * 4;
  const srcRowWords = paddedBytesPerRow >> 1;
  const out = new Uint16Array(rowWords * height);
  for (let y = 0; y < height; y++) {
    const s = y * srcRowWords;
    const d = y * rowWords;
    for (let x = 0; x < rowWords; x++) out[d + x] = lut[src[s + x]];
  }
  return out;
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
  private builderBuf: GPUBuffer;
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
  /** Def OBJECT the compiled transition pipeline was built from — identity,
   * not id, for the same reason the main pipelineCache is keyed by object
   * (see setPreset): an edited custom preset keeps its id but arrives as a
   * NEW def, and matching on id here kept serving the pipeline compiled from
   * the OLD WGSL while render() packed transitionParamsData in the new def's
   * ABI order — wrong shader and wrong param mapping for the rest of the
   * fade (RP-1). Built-ins are module singletons, so A→B→A still caches. */
  private transitionPipelineFor: PresetDef | null = null;
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
  /** Active imported-Shadertoy marker (null for every other preset kind). */
  private shadertoySpec: ShadertoySpec | null = null;
  /** Compat-pipeline resources, created on first shadertoy preset. */
  private stBindLayout: GPUBindGroupLayout | null = null;
  private stPipelineLayout: GPUPipelineLayout | null = null;
  private stUniformBuf: GPUBuffer | null = null;
  private stAudioTex: GPUTexture | null = null;
  private stEmptyChannel: GPUTexture | null = null;
  private stSampler: GPUSampler | null = null;
  private stBindGroup: GPUBindGroup | null = null;
  private stUniformData = new ArrayBuffer(SHADERTOY_UNIFORM_SIZE);
  private stAudioData = new Uint8Array(SHADERTOY_AUDIO_WIDTH * 2 * 4);
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
  /** POST_WGSL module, shared by the swapchain and deep fs_final pipelines so
   * enabling deep capture never pays a second compile of identical WGSL. */
  private postModule: GPUShaderModule | null = null;

  // FEAT-005 deep-colour capture: while enabled, the final post pass renders
  // into an offscreen rgba16float target ("deepOut") INSTEAD of the swapchain
  // — post-tonemap, pre-quantize pixels, readable via readbackDeepFrame().
  // "Instead" is deliberate: the only caller is exportCore, which never
  // presents its OffscreenCanvas and never reads it in deep mode, so a second
  // swapchain pass would be pure waste. Shading is byte-identical to the
  // 8-bit path — same POST_WGSL module, same fs_final entry, same bind group;
  // only the attachment format differs — which is what keeps preview===export
  // intact at the pixel-math level.
  private deepCapture = false;
  private deepTex: GPUTexture | null = null;
  private deepSize: [number, number] = [0, 0];
  private deepLastUsed = -1;
  private finalPipelineDeep: GPURenderPipeline | null = null;
  /** Readback staging buffer, reused across frames (recreated on size change). */
  private deepReadBuf: GPUBuffer | null = null;
  private deepReadBufSize = 0;

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
  /** Source = stable fixed-clock history instead of this call's raw visual. */
  private historyCompositeBind: GPUBindGroup | null = null;

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
    // Builder Studio layer params: one 16-f32 block per layer, sized from
    // the REAL cap (audit R4: a hardcoded 16-layer size silently truncated
    // if BUILDER_MAX_LAYERS ever grew past it — LP() would read past the
    // buffer and drop layers with no compile error).
    this.builderBuf = device.createBuffer({
      size: BUILDER_MAX_LAYERS * 16 * 4,
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
        { binding: 10, visibility: GPUShaderStage.FRAGMENT, buffer: storage },
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
    this.transitionPresetUsesFeedback = preset ? presetUsesFeedback(preset) : false;
    if (!preset || preset.shadertoy) {
      // A shadertoy def cannot compile against the snippet ABI, and shadertoy
      // presets hard-cut anyway (`special` in render()) — never build a
      // transition pipeline from one.
      this.transitionPipeline = null;
      this.transitionPipelineFor = null;
      return;
    }
    if (this.transitionPipelineFor === preset) return; // cached (same def object)
    const module = this.device.createShaderModule({
      code: assemblePresetModule(preset),
    });
    this.transitionPipeline = this.device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format: SCENE_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    this.transitionPipelineFor = preset;
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

  /** Upload the Builder Studio per-layer parameter block (builder2.ts packs
   * it). Cheap enough to call on every stack/param edit. */
  setBuilderParams(data: Float32Array): void {
    this.device.queue.writeBuffer(this.builderBuf, 0, data, 0, Math.min(data.length, 256));
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
      const mk = this.postPipelineFor.bind(this);
      this.brightPipeline = mk("fs_bright", SCENE_FORMAT);
      this.blurHPipeline = mk("fs_blur_h", SCENE_FORMAT);
      this.blurVPipeline = mk("fs_blur_v", SCENE_FORMAT);
      this.finalPipeline = mk("fs_final", this.format);
    }
  }

  /** Build one post-chain pipeline from the shared POST_WGSL module. */
  private postPipelineFor(entry: string, format: GPUTextureFormat): GPURenderPipeline {
    if (!this.postModule) {
      this.postModule = this.device.createShaderModule({ code: POST_WGSL });
    }
    return this.device.createRenderPipeline({
      layout: this.postPipelineLayout,
      vertex: { module: this.postModule, entryPoint: "vs" },
      fragment: { module: this.postModule, entryPoint: entry, targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
  }

  /** (Re)create the deep-capture target ("deepOut") + the rgba16float variant
   * of the fs_final pipeline. Lazy: costs nothing until setDeepCapture(true)
   * and the next presented frame. COPY_SRC is the whole point — this is the
   * texture readbackDeepFrame() copies out. */
  private ensureDeepTarget(): void {
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    if (!this.finalPipelineDeep) {
      // Zero new shader text: identical fs_final, only the target format
      // differs (rgba16float instead of the 8-bit swapchain format).
      this.finalPipelineDeep = this.postPipelineFor("fs_final", SCENE_FORMAT);
    }
    if (this.deepTex && this.deepSize[0] === w && this.deepSize[1] === h) return;
    this.deepTex?.destroy();
    this.deepTex = this.device.createTexture({
      size: [w, h],
      format: SCENE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.deepSize = [w, h];
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
    this.historyCompositeBind = null;
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
          { binding: 10, resource: { buffer: this.builderBuf } },
        ],
      });
    }
    return this.compositeBind;
  }

  /** Composite already-advanced history without evaluating the recurrence a
   * second time. Re-evaluation would double-inject fresh content in
   * accumulating presets such as Echo Trails. */
  private getHistoryCompositeBindGroup(): GPUBindGroup {
    if (!this.historyCompositeBind) {
      this.historyCompositeBind = this.device.createBindGroup({
        layout: this.bindLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: this.binsBuf! } },
          { binding: 2, resource: { buffer: this.peaksBuf! } },
          { binding: 3, resource: { buffer: this.paramsBuf } },
          { binding: 4, resource: { buffer: this.waveBuf } },
          { binding: 5, resource: (this.overlayTexture ?? this.emptyOverlay).createView() },
          { binding: 6, resource: this.overlaySampler },
          { binding: 7, resource: this.histTex!.createView() },
          { binding: 8, resource: (this.coverTexture ?? this.emptyCover).createView() },
          { binding: 9, resource: (this.bgTexture ?? this.emptyBg).createView() },
          { binding: 10, resource: { buffer: this.builderBuf } },
        ],
      });
    }
    return this.historyCompositeBind;
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
    // Deep capture routes the final pass into deepOut instead of the
    // swapchain (see the deepCapture field comment for why "instead"). Same
    // bind group, same entry point — only pipeline target format and
    // attachment differ.
    if (this.deepCapture && this.deepTex) {
      pass(this.finalPipelineDeep!, this.finalBind, this.deepTex.createView());
    } else {
      pass(this.finalPipeline!, this.finalBind, this.context.getCurrentTexture().createView());
    }
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
      // Resolve through the preset's OWN spec default, never a literal: a bare
      // `?? 0` here would freeze the sim (damping 0) or hide the field (size 0)
      // for any key a caller omitted, and it silently duplicates a default that
      // can drift from the spec. renderMesh3d already uses paramOr for this.
      F[8 + idx] = paramOr(this.preset!, params, k);
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
    // Same rule as the param upload above: the literal 1 here contradicted the
    // preset's own default of 0.45, so an omitted key drew 2.2x the particles.
    const density = Math.min(
      1,
      Math.max(0, paramOr(this.preset!, params, "density") * this.motion.detail),
    );
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
    F[28] = g("layout"); // the binMap lane — 'layout' is reserved in WGSL
    F[29] = g("barShape");
    F[30] = g("saturation");
    F[31] = g("lightness");
    F[32] = g("hueLift");
    F[33] = g("driveHeight");
    F[34] = g("hotDrive");
    F[35] = g("hotBeat");
    F[36] = g("hotWindow");
    F[37] = g("glowBeat");
    F[38] = g("fillLight");
    F[39] = g("ambientLight");
    F[40] = g("fogDensity");
    F[41] = g("bandGlow");
    // Band lanes for the per-region response — straight AudioFeatures reads,
    // same determinism story as drive/driveBeat above.
    F[42] = f.bass;
    F[43] = f.mid;
    F[44] = f.treble;
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
    // Bar shape picks a vertex range out of the shared shape buffer. The box
    // (0, the default) draws the exact 36-verts-from-0 range the pre-shape
    // renderer drew; Math.round + the fallback keep a garbage stored value
    // from indexing off the table.
    const shape = MESH3D_BAR_SHAPES[Math.round(g("barShape"))] ?? MESH3D_BAR_SHAPES[0];
    pass.draw(shape[1], grid * grid, shape[0]);
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
        this.historyCompositeBind = null;
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
      this.historyCompositeBind = null;
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
    this.historyCompositeBind = null;
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
      this.historyCompositeBind = null;
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
    this.historyCompositeBind = null;
  }

  /** Resolves when all submitted GPU work has executed (export frame sync). */
  gpuDone(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Deep-colour capture (FEAT-005). While enabled, every presented frame runs
   * the FULL render graph (the neutral-post direct-to-swapchain path is
   * bypassed) and the final post pass lands in the offscreen rgba16float
   * deepOut target instead of the swapchain — see the deepCapture field
   * comment for why "instead" and why the pixels stay identical. Export-only
   * by design: the live loop must keep presenting, so it never turns this on.
   */
  setDeepCapture(enabled: boolean): void {
    this.deepCapture = enabled;
    // Targets are lazily (re)created on the next presented frame and reaped
    // by the normal idle-release stamping after disable — no eager teardown
    // here, so a disable/enable pair mid-export cannot thrash allocations.
  }

  /**
   * Read back the most recent deep-captured frame as tightly-packed
   * rgba64le-order u16: R,G,B,A per pixel, row-major, no padding, length
   * width×height×4, value = round(clamp(f16, 0, 1) × 65535).
   *
   * Caller sequence (exportCore): render(...present...) → gpuDone() → this.
   * gpuDone() is NOT required for correctness — the copy below is queued
   * after the frame's passes, so the mapAsync resolves with this frame's
   * pixels either way — but the export loop already awaits it for device-loss
   * detection. One staging buffer is reused across frames; only a resize
   * recreates it.
   */
  async readbackDeepFrame(): Promise<Uint16Array> {
    if (!this.deepCapture) {
      throw new Error("readbackDeepFrame() requires setDeepCapture(true)");
    }
    if (!this.deepTex) {
      throw new Error("readbackDeepFrame() before any deep frame was rendered");
    }
    const [w, h] = this.deepSize;
    // rgba16float = 8 bytes/pixel; rows padded to WebGPU's mandatory 256-byte
    // alignment for buffer copies. The padding is stripped CPU-side below.
    const bytesPerRow = Math.ceil((w * 8) / 256) * 256;
    const size = bytesPerRow * h;
    if (!this.deepReadBuf || this.deepReadBufSize !== size) {
      this.deepReadBuf?.destroy();
      this.deepReadBuf = this.device.createBuffer({
        size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      this.deepReadBufSize = size;
    }
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.deepTex },
      { buffer: this.deepReadBuf, bytesPerRow, rowsPerImage: h },
      [w, h],
    );
    this.device.queue.submit([encoder.finish()]);
    await this.deepReadBuf.mapAsync(GPUMapMode.READ);
    // Convert while mapped (one pass over the padded words), then unmap so
    // the same buffer is free for the next frame's copy.
    const raw = new Uint16Array(this.deepReadBuf.getMappedRange());
    const out = deepFrameToRgba64(raw, w, h, bytesPerRow);
    this.deepReadBuf.unmap();
    return out;
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
    if (preset.shadertoy) {
      // Standalone transpiled module — no snippet prefix. The user wrote
      // GLSL, not this WGSL, so report positions against the generated
      // module; the transpiler already mapped GLSL-level errors upstream.
      // This device pass is the tint gate naga cannot replace (uniformity
      // analysis lives here).
      this.device.pushErrorScope("validation");
      const module = this.device.createShaderModule({
        code: preset.wgsl + SHADERTOY_VS_WGSL,
      });
      const info = await module.getCompilationInfo();
      await this.device.popErrorScope().catch(() => null);
      return info.messages
        .filter((m) => m.type === "error")
        .map((m) => `generated WGSL line ${m.lineNum}: ${m.message}`);
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
    this.presetUsesFeedback = presetUsesFeedback(preset);
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
    // Imported Shadertoy visual: complete standalone module, own pipeline
    // layout (see the SHADERTOY_VS_WGSL block). Shares the same pipeline
    // cache; getBindGroup()/directPipelineFor() branch on the marker.
    this.shadertoySpec = preset.shadertoy ?? null;
    if (this.shadertoySpec) {
      this.ensureShadertoyResources();
      const cachedSt = this.pipelineCache.get(preset);
      if (cachedSt) {
        this.pipeline = cachedSt.scene;
        this.bindGroup = null;
        return;
      }
      const stModule = this.device.createShaderModule({
        code: preset.wgsl + SHADERTOY_VS_WGSL,
      });
      void stModule.getCompilationInfo().then((info) => {
        for (const m of info.messages) {
          if (m.type === "error") {
            console.error(`[shadertoy ${preset.id}] ${m.lineNum}:${m.linePos} ${m.message}`);
          }
        }
      });
      this.pipeline = this.device.createRenderPipeline({
        layout: this.stPipelineLayout!,
        vertex: { module: stModule, entryPoint: "vs_main" },
        fragment: { module: stModule, entryPoint: "main", targets: [{ format: SCENE_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
      this.pipelineCache.set(preset, { module: stModule, scene: this.pipeline });
      this.bindGroup = null;
      return;
    }
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

  /** Lazily create the shadertoy compat pipeline's shared GPU resources —
   * they cost nothing unless an imported visual is actually used. */
  private ensureShadertoyResources(): void {
    if (this.stBindLayout) return;
    const tex = { sampleType: "float" as const };
    this.stBindLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: tex },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: tex },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: tex },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: tex },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    this.stPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.stBindLayout],
    });
    this.stUniformBuf = this.device.createBuffer({
      size: SHADERTOY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.stAudioTex = this.device.createTexture({
      size: [SHADERTOY_AUDIO_WIDTH, 2],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    // 1x1 black for iChannel1..3 — matches Shadertoy's unbound-channel look.
    this.stEmptyChannel = this.device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.stEmptyChannel },
      new Uint8Array([0, 0, 0, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    this.stSampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  private getShadertoyBindGroup(): GPUBindGroup {
    if (!this.stBindGroup) {
      const empty = this.stEmptyChannel!.createView();
      this.stBindGroup = this.device.createBindGroup({
        layout: this.stBindLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.stUniformBuf! } },
          { binding: 1, resource: this.stAudioTex!.createView() },
          { binding: 2, resource: empty },
          { binding: 3, resource: empty },
          { binding: 4, resource: empty },
          { binding: 5, resource: this.stSampler! },
        ],
      });
    }
    return this.stBindGroup;
  }

  /** Per-frame shadertoy uploads: the uniform block and both audio rows.
   * Called after the waveform downsample so row 1 reuses the exact values
   * the storage-buffer ABI receives. */
  private uploadShadertoyFrame(f: AudioFeatures, time: number): void {
    packShadertoyUniforms(
      this.stUniformData,
      time,
      Math.max(1, this.canvas.width),
      Math.max(1, this.canvas.height),
    );
    this.device.queue.writeBuffer(this.stUniformBuf!, 0, this.stUniformData);
    packShadertoyAudioRows(this.stAudioData, f.bins, this.waveData);
    this.device.queue.writeTexture(
      { texture: this.stAudioTex! },
      this.stAudioData,
      { bytesPerRow: SHADERTOY_AUDIO_WIDTH * 4 },
      [SHADERTOY_AUDIO_WIDTH, 2],
    );
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
      this.historyCompositeBind = null;
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
    if (this.deepTex && idle(this.deepLastUsed)) {
      this.deepTex.destroy();
      this.deepTex = null;
      // The staging buffer only exists to read deepTex — release it with the
      // target (at 4K it is ~66 MB, too big to idle for a whole session).
      this.deepReadBuf?.destroy();
      this.deepReadBuf = null;
      this.deepReadBufSize = 0;
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

  render(
    f: AudioFeatures,
    time: number,
    params: ParamValues,
    transition?: TransitionState,
    options?: RenderOptions,
  ): void {
    if (!this.pipeline || !this.preset) return;
    const feedbackMode = options?.feedback ?? "advance-and-present";
    const feedbackAdvance =
      feedbackMode === "advance-and-present" || feedbackMode === "advance-only";
    const feedbackPresent = feedbackMode !== "advance-only";
    // Hidden fixed-clock ticks exist only for texture-feedback presets.
    if (!feedbackPresent && !this.presetUsesFeedback) return;
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
    this.uniformF32[9] = this.presetUsesFeedback
      ? feedbackAdvance
        ? FEEDBACK_DT
        : 0
      : dtRaw > 0 && dtRaw <= 0.1
        ? dtRaw
        : 1 / 60;
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
    // Background framing (bgMode 3/4). Read off THIS renderer's bg, which both
    // the live loop and exportCore set from the same resolved BgSettings every
    // frame — so preview and export cannot drift. Absent fields fall back to
    // the values that reproduce the old hardcoded cover crop.
    const bgFit = this.bg.mode === BG_VIDEO ? this.bg.video : this.bg.image;
    this.uniformF32[32] = bgFit?.fit ?? 0;
    this.uniformF32[33] = bgFit?.zoom ?? 1;
    this.uniformF32[34] = bgFit?.offsetX ?? 0;
    this.uniformF32[35] = bgFit?.offsetY ?? 0;
    // Feedback path is active only when the preset opts in AND we're not
    // mid-crossfade (feedback pauses during transitions). fs_main branches on
    // this: 1 => emit raw visual for the composite pass, 0 => inline composite.
    // Particle and 3D presets take dedicated draw paths and ignore the
    // fragment/feedback/crossfade machinery (they cut, not crossfade).
    const particlesActive = !!this.particleSpec;
    const mesh3dActive = !!this.mesh3dSpec;
    // Shadertoy compat presets cut instead of crossfading (like particles /
    // mesh3d): the blend stage itself is kind-agnostic, but the transition
    // pipeline machinery compiles the outgoing def against the snippet ABI.
    const special = particlesActive || mesh3dActive || !!this.shadertoySpec;
    const fading = !special && !!(transition && this.transitionPipeline && this.transitionPreset);
    // Advance incoming feedback on its fixed clock even while presentation is
    // crossfading. Presentation itself still uses the transition branch.
    const useFeedback =
      !special && this.presetUsesFeedback && (!fading || feedbackMode === "advance-only");
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

    // Imported Shadertoy visual: its own uniform block + audio texture.
    if (this.shadertoySpec) this.uploadShadertoyFrame(f, time);

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
    const shadertoyActive = !!this.shadertoySpec;
    const direct =
      feedbackPresent &&
      !fading &&
      !useFeedback &&
      !particlesActive &&
      !mesh3dActive &&
      // Shadertoy modules cannot inline-composite overlays (that lives in
      // fs_main), so they always route through visTex + fs_composite.
      !shadertoyActive &&
      // Deep capture MUST run the full graph: the direct path draws straight
      // to the 8-bit swapchain, which is exactly the quantize the deep lane
      // exists to avoid — a neutral-post deep export would otherwise capture
      // nothing (deepOut only fills in runPost's final pass).
      !this.deepCapture &&
      this.postIsNeutral();
    const needsGraph = feedbackPresent && !direct;
    // M23: stamp which target groups this frame actually uses; anything idle
    // past RT_IDLE_FRAMES is released after submit.
    this.frameIndex++;
    const feedbackTargetsInUse =
      useFeedback ||
      particlesActive ||
      mesh3dActive ||
      shadertoyActive ||
      (fading && (this.presetUsesFeedback || this.transitionPresetUsesFeedback));
    if (fading) this.fadeLastUsed = this.frameIndex;
    if (feedbackTargetsInUse) this.feedbackLastUsed = this.frameIndex;
    if (mesh3dActive) this.depthLastUsed = this.frameIndex;
    if (needsGraph) this.graphLastUsed = this.frameIndex;
    if (needsGraph) this.ensureGraphTargets();
    // Deep target participates in the same idle-release scheme as the other
    // groups: stamped on every presented deep frame, released after
    // RT_IDLE_FRAMES once capture is switched off (or the caller stops
    // presenting), re-created by the guard on re-entry.
    const deepActive = this.deepCapture && feedbackPresent;
    if (deepActive) {
      this.deepLastUsed = this.frameIndex;
      this.ensureDeepTarget();
    }
    // Particles + feedback both draw into visTex, then composite -> sceneTex.
    // A crossfade needs histTex too whenever either side of it uses feedback
    // (M14) — the fading branch below shares it exactly like the plain
    // feedback path does, instead of forcing the outgoing/incoming preset to
    // emptyFeedback or a stale pre-fade snapshot.
    if (feedbackTargetsInUse) this.ensureFeedbackTargets();
    const scene = needsGraph ? this.sceneTex!.createView() : null;

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
    } else if (shadertoyActive) {
      // Imported Shadertoy module draws the raw visual into visTex, then the
      // shared composite pass layers overlays (lyrics/text) and honours the
      // central background modes — same shape as the particle path.
      drawPass(this.pipeline, this.getShadertoyBindGroup(), this.visTex!.createView());
      drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene!);
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
      if (feedbackMode === "present-history") {
        // This timestamp's fixed state tick already ran. Present that state
        // directly; evaluating an accumulating recurrence twice would inject
        // its fresh source twice.
        drawPass(this.compositePipeline!, this.getHistoryCompositeBindGroup(), scene!);
      } else {
        // 1) preset evaluates fresh visual + stable history into visTex.
        drawPass(this.pipeline, this.getBindGroup(), this.visTex!.createView());
        // 2) presentation is independent from state advancement.
        if (feedbackPresent) {
          drawPass(this.compositePipeline!, this.getCompositeBindGroup(), scene!);
        }
        // 3) only canonical 60 Hz ticks become future history.
        if (feedbackAdvance) {
          encoder.copyTextureToTexture({ texture: this.visTex! }, { texture: this.histTex! }, [
            this.feedbackSize[0],
            this.feedbackSize[1],
          ]);
        }
      }
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
      if (this.presetUsesFeedback && feedbackAdvance) {
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
    if (feedbackPresent && !direct) this.runPost(encoder, time, clearA);
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
          { binding: 10, resource: { buffer: this.builderBuf } },
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
    this.deepTex?.destroy();
    this.deepReadBuf?.destroy();
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
    this.historyCompositeBind = null;
  }

  private getBindGroup(): GPUBindGroup {
    if (this.shadertoySpec) return this.getShadertoyBindGroup();
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
          { binding: 10, resource: { buffer: this.builderBuf } },
        ],
      });
    }
    return this.bindGroup;
  }
}
