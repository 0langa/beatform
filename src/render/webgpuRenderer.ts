import type { AudioFeatures } from "../audio/types";
import type { ParamValues, PresetDef, Renderer } from "./types";

const MAX_PARAMS = 16;

/**
 * WebGPU renderer. Fullscreen-triangle pass; the active preset supplies the
 * fragment logic as WGSL. Spectrum data reaches the GPU as storage buffers,
 * scalar features as one uniform struct — presets read both through a fixed
 * header so every preset sees the same ABI.
 */
const HEADER = /* wgsl */ `
struct Uniforms {
  time: f32,
  beatIntensity: f32,
  rms: f32,
  bass: f32,
  mid: f32,
  treble: f32,
  binCount: u32,
  aspect: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> bins: array<f32>;
@group(0) @binding(2) var<storage, read> peaks: array<f32>;
@group(0) @binding(3) var<storage, read> params: array<f32>;

fn param(i: u32) -> f32 { return params[i]; }

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
  return preset(in.uv);
}
`;

export class WebGPURenderer implements Renderer {
  readonly kind = "webgpu" as const;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: HTMLCanvasElement;

  private pipeline: GPURenderPipeline | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuf: GPUBuffer;
  private binsBuf: GPUBuffer | null = null;
  private peaksBuf: GPUBuffer | null = null;
  private paramsBuf: GPUBuffer;
  private binCapacity = 0;

  private preset: PresetDef | null = null;
  private uniformData = new ArrayBuffer(32);
  private uniformF32 = new Float32Array(this.uniformData);
  private uniformU32 = new Uint32Array(this.uniformData);
  private paramsData = new Float32Array(MAX_PARAMS);

  static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
    if (!navigator.gpu) throw new Error("WebGPU not available");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    return new WebGPURenderer(canvas, device);
  }

  private constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    this.canvas = canvas;
    this.device = device;
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("No webgpu canvas context");
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format: this.format,
      alphaMode: "opaque",
    });
    this.uniformBuf = device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paramsBuf = device.createBuffer({
      size: MAX_PARAMS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  setPreset(preset: PresetDef): void {
    this.preset = preset;
    const module = this.device.createShaderModule({
      code: HEADER + preset.wgsl,
    });
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
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
    this.device.queue.writeBuffer(this.uniformBuf, 0, this.uniformData);
    this.device.queue.writeBuffer(this.binsBuf!, 0, f.bins);
    this.device.queue.writeBuffer(this.peaksBuf!, 0, f.peaks);

    this.paramsData.fill(0);
    this.preset.params.forEach((p, i) => {
      if (i < MAX_PARAMS) this.paramsData[i] = params[p.key] ?? p.default;
    });
    this.device.queue.writeBuffer(this.paramsBuf, 0, this.paramsData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
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
    this.uniformBuf.destroy();
    this.paramsBuf.destroy();
    this.binsBuf?.destroy();
    this.peaksBuf?.destroy();
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
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuf } },
          { binding: 1, resource: { buffer: this.binsBuf! } },
          { binding: 2, resource: { buffer: this.peaksBuf! } },
          { binding: 3, resource: { buffer: this.paramsBuf } },
        ],
      });
    }
    return this.bindGroup;
  }
}
