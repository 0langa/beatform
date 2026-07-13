import type { AudioFeatures } from "../audio/types";
import { allParams } from "./types";
import type { BgSettings, ParamValues, PresetDef, Renderer } from "./types";

const MAX_PARAMS = 48;
/** Downsampled waveform points exposed to shaders */
const WAVE_POINTS = 512;
/** Uniform struct size in bytes (scalars + vec4 bgColor + sync block) */
const UNIFORM_SIZE = 80;

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
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> bins: array<f32>;
@group(0) @binding(2) var<storage, read> peaks: array<f32>;
@group(0) @binding(3) var<storage, read> params: array<f32>;
@group(0) @binding(4) var<storage, read> waveform: array<f32>;
@group(0) @binding(5) var overlayTex: texture_2d<f32>;
@group(0) @binding(6) var overlaySmp: sampler;

fn param(i: u32) -> f32 { return params[i]; }

/** Spectrum sampled at x in 0..1 (nearest bin) */
fn binAt(x: f32) -> f32 {
  let n = f32(u.binCount);
  return bins[u32(clamp(x, 0.0, 0.999) * n)];
}

fn peakAt(x: f32) -> f32 {
  let n = f32(u.binCount);
  return peaks[u32(clamp(x, 0.0, 0.999) * n)];
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

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  var out = preset(in.uv);
  // Central background compositing: presets author light-over-black
  // (premultiplied form), so a luma-derived alpha lets us re-base them on
  // any background or none — without touching preset code.
  if (u.bgMode != 0u) {
    let a = clamp(max(out.r, max(out.g, out.b)), 0.0, 1.0);
    if (u.bgMode == 1u) {
      out = vec4f(u.bgColor.rgb * (1.0 - a) + out.rgb, 1.0);
    } else {
      out = vec4f(out.rgb, a); // premultiplied alpha
    }
  }
  // Overlay (text/logo layers): premultiplied source-over on top of
  // everything. The default is a 1x1 transparent texture — a no-op.
  let ov = textureSampleLevel(overlayTex, overlaySmp, in.uv, 0.0);
  out = vec4f(ov.rgb + out.rgb * (1.0 - ov.a), min(1.0, ov.a + out.a * (1.0 - ov.a)));
  return out;
}
`;

export class WebGPURenderer implements Renderer {
  readonly kind = "webgpu" as const;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private bg: BgSettings = { mode: 0, color: [0, 0, 0] };

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
    this.overlaySampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
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
      ],
    });
    this.pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindLayout],
    });
  }

  setBackground(bg: BgSettings): void {
    this.bg = bg;
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
    }
    this.bindGroup = null; // rebind with the new texture view
  }

  /** Resolves when all submitted GPU work has executed (export frame sync). */
  gpuDone(): Promise<undefined> {
    return this.device.queue.onSubmittedWorkDone();
  }

  setPreset(preset: PresetDef): void {
    this.preset = preset;
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
      code: HEADER + accessors + "\n" + preset.wgsl,
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
        targets: [{ format: this.format }],
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

  render(f: AudioFeatures, time: number, params: ParamValues): void {
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

    const encoder = this.device.createCommandEncoder();
    const clearA = this.bg.mode === 2 ? 0 : 1;
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: clearA },
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.getBindGroup());
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
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
        ],
      });
    }
    return this.bindGroup;
  }
}
