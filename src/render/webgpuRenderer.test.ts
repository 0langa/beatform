import { afterAll, describe, expect, it } from "vitest";
import { WebGPURenderer } from "./webgpuRenderer";

/**
 * L7 regression — see WebGPURenderer.create() in ./webgpuRenderer.ts:
 * `device.lost.then(...)` is wired internally, but the PUBLIC `onDeviceLost`
 * callback is assigned by the CALLER only after `create()` has already
 * returned (services.ts / exportCore.ts both do
 * `const gpu = await WebGPURenderer.create(canvas); gpu.onDeviceLost = fn;`).
 * Per the WebGPU spec a device can be lost essentially immediately after
 * creation — exactly the "driver keeps dying" case the retry loop in
 * services.ts exists to handle — so a loss landing in that gap used to be
 * dropped forever: the internal `.then()` callback ran once, read a
 * still-null `onDeviceLost`, and did nothing; no later assignment could
 * ever see it.
 *
 * WebGPURenderer's constructor and create() touch real WebGPU globals
 * (`navigator.gpu`, `GPUBufferUsage`, `GPUTextureUsage`, `GPUShaderStage`)
 * that only exist in a browser; vitest runs this file in Node (see
 * vitest.config.ts). Below is the minimal fake adapter/device/canvas needed
 * to construct a REAL WebGPURenderer and exercise only the device-loss
 * wiring — shader/pipeline objects are created lazily from render()/the
 * various ensure*Pipeline() methods, none of which this test calls, so none
 * of that needs faking.
 */

interface FakeDeviceLostInfo {
  reason: string;
  message: string;
}

interface FakeDevice {
  addEventListener: () => void;
  createBuffer: () => { destroy: () => void };
  createTexture: () => { destroy: () => void };
  createSampler: () => object;
  createBindGroupLayout: () => object;
  createPipelineLayout: () => object;
  queue: {
    writeBuffer: () => void;
    writeTexture: () => void;
    onSubmittedWorkDone: () => Promise<undefined>;
  };
  lost: Promise<FakeDeviceLostInfo>;
  destroy: () => void;
}

/** Replaces (or defines) a global via defineProperty — plain assignment
 * throws for `navigator` in modern Node, which exposes it as a getter-only
 * accessor on globalThis. */
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function installGpuUsageGlobals(): void {
  defineGlobal("GPUBufferUsage", {
    UNIFORM: 64,
    STORAGE: 128,
    COPY_DST: 8,
    COPY_SRC: 4,
    VERTEX: 32,
  });
  defineGlobal("GPUTextureUsage", {
    TEXTURE_BINDING: 4,
    COPY_DST: 2,
    RENDER_ATTACHMENT: 16,
    STORAGE_BINDING: 8,
  });
  defineGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
}

function makeFakeDevice(): {
  device: FakeDevice;
  resolveLost: (info: FakeDeviceLostInfo) => void;
} {
  let resolveLost!: (info: FakeDeviceLostInfo) => void;
  const lost = new Promise<FakeDeviceLostInfo>((res) => {
    resolveLost = res;
  });
  const device: FakeDevice = {
    addEventListener: () => {},
    createBuffer: () => ({ destroy: () => {} }),
    createTexture: () => ({ destroy: () => {} }),
    createSampler: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    queue: {
      writeBuffer: () => {},
      writeTexture: () => {},
      onSubmittedWorkDone: () => Promise.resolve(undefined),
    },
    lost,
    destroy: () => {},
  };
  return { device, resolveLost };
}

function installFakeNavigator(device: FakeDevice): void {
  defineGlobal("navigator", {
    gpu: {
      requestAdapter: async () => ({ requestDevice: async () => device }),
      getPreferredCanvasFormat: () => "bgra8unorm",
    },
  });
}

function makeFakeCanvas(): HTMLCanvasElement {
  return { getContext: () => ({ configure: () => {} }) } as unknown as HTMLCanvasElement;
}

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterAll(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  }
  const g = globalThis as Record<string, unknown>;
  delete g.GPUBufferUsage;
  delete g.GPUTextureUsage;
  delete g.GPUShaderStage;
});

describe("WebGPURenderer device-loss race (L7)", () => {
  it("delivers a loss that happened before onDeviceLost was assigned", async () => {
    installGpuUsageGlobals();
    const { device, resolveLost } = makeFakeDevice();
    installFakeNavigator(device);

    const renderer = await WebGPURenderer.create(makeFakeCanvas());

    // The race: device.lost settles BEFORE the caller assigns a handler —
    // the exact gap after `await create(...)` in services.ts/exportCore.ts.
    resolveLost({ reason: "unknown", message: "simulated TDR" });
    await device.lost; // internal .then(cb), registered first, runs before this settles

    const received: string[] = [];
    renderer.onDeviceLost = (reason) => received.push(reason);

    // Buffered delivery happens on the microtask right after assignment.
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual(["simulated TDR"]);
  });

  it("still delivers normally when the handler is attached before the loss", async () => {
    installGpuUsageGlobals();
    const { device, resolveLost } = makeFakeDevice();
    installFakeNavigator(device);

    const renderer = await WebGPURenderer.create(makeFakeCanvas());
    const received: string[] = [];
    renderer.onDeviceLost = (reason) => received.push(reason);

    resolveLost({ reason: "unknown", message: "normal loss" });
    await device.lost;
    await Promise.resolve();

    expect(received).toEqual(["normal loss"]);
  });

  it("does not resurrect a loss after the renderer has been disposed", async () => {
    installGpuUsageGlobals();
    const { device, resolveLost } = makeFakeDevice();
    installFakeNavigator(device);

    const renderer = await WebGPURenderer.create(makeFakeCanvas());
    renderer.dispose();

    resolveLost({ reason: "destroyed", message: "disposed" });
    await device.lost;
    await Promise.resolve();

    const received: string[] = [];
    renderer.onDeviceLost = (reason) => received.push(reason);
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toEqual([]);
  });
});
