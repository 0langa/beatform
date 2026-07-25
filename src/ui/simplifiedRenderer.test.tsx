// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SliderRow, ToggleRow } from "./kit";
import { BatchPanel, type BatchPanelProps } from "./BatchPanel";
import type { BatchRun } from "../state/batch";
import type { ProjectDocument } from "../state/project";

/** jest-dom is not wired up here (see kit.test.tsx) — read the property. */
function isDisabled(el: Element | null | undefined): boolean {
  return !!(el as HTMLButtonElement | HTMLInputElement | null)?.disabled;
}

afterEach(cleanup);

/**
 * Audit F1/F2: when WebGPU is unavailable the app falls back to
 * Canvas2DRenderer, whose setPreset/setMotion/setBuilderParams/
 * setTransitionPreset/setPost are empty stubs and whose render() reads four
 * parameter keys — yet every control stayed live, accepted input and threw it
 * away, and Export/Batch stayed on offer only to fail after a save dialog and
 * a full decode.
 *
 * These cover the two shapes that fix takes in the UI: the kit's
 * `disabledReason` (which is what disables a row AND what it says when you
 * hover it) and the batch panel's up-front block.
 */

describe("kit rows refuse input and say why (F1)", () => {
  const REASON = "Unavailable: hardware rendering isn't available on this system";

  it("ToggleRow with a reason cannot be toggled and carries the reason as its tooltip", async () => {
    const onChange = vi.fn();
    render(<ToggleRow label="Filmic tonemap" hint="normal hint" checked onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledTimes(1); // control: it works normally
    cleanup();

    onChange.mockClear();
    render(
      <ToggleRow
        label="Filmic tonemap"
        hint="normal hint"
        checked
        onChange={onChange}
        disabledReason={REASON}
      />,
    );
    const sw = screen.getByRole("switch");
    expect(isDisabled(sw)).toBe(true);
    await userEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
    // The reason REPLACES the hint — a disabled control whose tooltip still
    // describes what it would do is the mystery this prop exists to avoid.
    expect(sw.closest("label")?.getAttribute("title")).toBe(REASON);
  });

  it("SliderRow with a reason disables the slider and its type-a-value readout", () => {
    const { container } = render(
      <SliderRow
        label="Bloom"
        hint="normal hint"
        min={0}
        max={1}
        step={0.01}
        value={0.5}
        onChange={vi.fn()}
        disabledReason={REASON}
      />,
    );
    expect(isDisabled(container.querySelector("input[type=range]"))).toBe(true);
    const readout = container.querySelector("button.row-value")!;
    expect(isDisabled(readout)).toBe(true);
    // ...and it no longer advertises "double-click to type a value", which it
    // would not honour.
    expect(readout.getAttribute("title")).toBe(REASON);
    expect(container.querySelector("label")?.className).toContain("is-unavailable");
  });

  it("without a reason nothing changes — the normal WebGPU path is untouched", () => {
    const { container } = render(
      <SliderRow
        label="Bloom"
        hint="normal hint"
        min={0}
        max={1}
        step={0.01}
        value={0.5}
        onChange={vi.fn()}
      />,
    );
    expect(isDisabled(container.querySelector("input[type=range]"))).toBe(false);
    expect(container.querySelector("button.row-value")?.getAttribute("title")).toBe(
      "normal hint — double-click to type a value",
    );
    expect(container.querySelector("label")?.className).not.toContain("is-unavailable");
  });
});

function batchProps(over: Partial<BatchPanelProps> = {}): BatchPanelProps {
  return {
    run: {
      // Never read by the panel — it renders tracks, not the frozen document.
      doc: {} as unknown as ProjectDocument,
      tracks: [
        {
          id: "t1",
          file: new File([], "a.mp3"),
          meta: { title: "a", artist: "" },
          metaFromTags: true,
          coverArt: null,
          duration: 10,
        },
      ],
      formats: [],
      outDir: "",
      startedAt: 0,
      jobs: [],
    } satisfies BatchRun,
    status: "idle",
    scanning: 0,
    overlayLayers: [],
    aspect: "16:9",
    formatLabel: "1080p",
    simplifiedRenderer: false,
    onAddTracks: vi.fn(),
    onRemoveTrack: vi.fn(),
    onRetitle: vi.fn(),
    onStart: vi.fn(),
    onSkipJob: vi.fn(),
    onCancel: vi.fn(),
    onRetryFailed: vi.fn(),
    onNewBatch: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

describe("BatchPanel blocks the run up front (F2)", () => {
  it("disables Start with the reason in its tooltip, instead of failing N times", async () => {
    const onStart = vi.fn();
    render(<BatchPanel {...batchProps({ simplifiedRenderer: true, onStart })} />);
    const start = screen.getByRole("button", { name: /Render 1 video/ });
    expect(isDisabled(start)).toBe(true);
    expect(start.getAttribute("title")).toMatch(/WebGPU/);
    await userEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
    // Stated in the panel too — a tooltip alone is invisible on touch and to
    // anyone who does not hover a greyed-out button to ask why.
    expect(screen.getByText(/every job would fail after decoding its track/)).toBeTruthy();
  });

  it("leaves Start alone when hardware rendering is available", async () => {
    const onStart = vi.fn();
    render(<BatchPanel {...batchProps({ onStart })} />);
    const start = screen.getByRole("button", { name: /Render 1 video/ });
    expect(isDisabled(start)).toBe(false);
    await userEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
