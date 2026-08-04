// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { DEFAULT_PREFS, type PerfOverlayStats } from "../state/prefs";
import { PerfOverlay, type PerfOverlayProps } from "./PerfOverlay";

/**
 * The overlay is a pure DOM diagnostic: it must never intercept pointer
 * input, and its readouts are written via refs from a rAF loop — so the tests
 * drive rAF manually and read textContent, exactly what a user sees.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ALL_ON: PerfOverlayStats = {
  fps: true,
  frameTime: true,
  renderer: true,
  jsHeap: true,
  cpu: true,
  ram: true,
  disk: true,
  gpu: true,
};

function renderOverlay(props: Partial<PerfOverlayProps> = {}) {
  return render(
    <PerfOverlay
      corner={props.corner ?? DEFAULT_PREFS.perfOverlayCorner}
      size={props.size ?? DEFAULT_PREFS.perfOverlaySize}
      color={props.color ?? DEFAULT_PREFS.perfOverlayColor}
      show={props.show ?? ALL_ON}
      rendererKind={props.rendererKind ?? "webgpu"}
    />,
  );
}

/** Install a controllable rAF; returns a step(ms) that advances frames. */
function fakeRaf() {
  let now = 0;
  let queue: Array<(t: number) => void> = [];
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return (ms: number, frames: number) => {
    for (let i = 0; i < frames; i++) {
      now += ms;
      const batch = queue;
      queue = [];
      const t = now;
      act(() => {
        for (const cb of batch) cb(t);
      });
    }
  };
}

describe("PerfOverlay", () => {
  it("shows one labelled row per enabled stat and none for disabled ones", () => {
    const { container } = renderOverlay({
      show: { ...ALL_ON, disk: false, gpu: false },
    });
    const text = container.textContent ?? "";
    for (const label of ["FPS", "Frame", "Renderer", "JS heap", "CPU", "RAM"]) {
      expect(text).toContain(label);
    }
    expect(text).not.toContain("Disk");
    expect(text).not.toContain("GPU");
  });

  it("renders nothing at all when every stat is toggled off", () => {
    const { container } = renderOverlay({
      show: {
        fps: false,
        frameTime: false,
        renderer: false,
        jsHeap: false,
        cpu: false,
        ram: false,
        disk: false,
        gpu: false,
      },
    });
    expect(container.querySelector(".perf-overlay")).toBeNull();
  });

  it("never intercepts pointer input and anchors to the requested corner", () => {
    const { container } = renderOverlay({ corner: "bottom-right" });
    const el = container.querySelector<HTMLElement>(".perf-overlay");
    expect(el).not.toBeNull();
    expect(el!.style.pointerEvents).toBe("none");
    expect(el!.style.bottom).not.toBe("");
    expect(el!.style.right).not.toBe("");
    expect(el!.style.top).toBe("");
    expect(el!.style.left).toBe("");
  });

  it("measures FPS from rAF deltas and writes readouts without re-rendering", () => {
    const step = fakeRaf();
    const { container } = renderOverlay({ rendererKind: "webgpu" });
    // 60 fps for ~1.3 s: the window fills, then a text tick fires (>250 ms).
    step(16.6667, 80);
    const rows = container.querySelectorAll<HTMLElement>(".perf-overlay span");
    const byLabel = new Map<string, string>();
    for (let i = 0; i < rows.length; i += 2) {
      byLabel.set(rows[i].textContent ?? "", rows[i + 1]?.textContent ?? "");
    }
    const fps = parseFloat(byLabel.get("FPS") ?? "");
    expect(fps).toBeGreaterThan(55);
    expect(fps).toBeLessThan(65);
    expect(byLabel.get("Frame")).toMatch(/16\.\d \/ 16\.\d ms/);
    // No canvas in jsdom — the renderer row still names the backend.
    expect(byLabel.get("Renderer")).toBe("webgpu");
    // jsdom has no performance.memory — the guarded readout says so.
    expect(byLabel.get("JS heap")).toBe("n/a");
    // Not running under Tauri — Rust-backed stats are honestly n/a.
    expect(byLabel.get("CPU")).toBe("n/a");
    expect(byLabel.get("RAM")).toBe("n/a");
    expect(byLabel.get("Disk")).toBe("n/a");
    expect(byLabel.get("GPU")).toBe("n/a");
  });
});
