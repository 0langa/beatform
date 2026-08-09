// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SliderRow, ToggleRow } from "./kit";
import { BatchPanel } from "./BatchPanel";
import type { BatchRun } from "../state/batch";
import type { ProjectDocument } from "../state/project";

// BatchPanel is store-direct as of P-12 wave 2, so its Start button reaches
// the real `startBatch`, which is guarded but still resolves the engine on the
// paths that get that far. Same mock shape as the other panel suites.
vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    audioBuffer: null,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn(), reset: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getLiveStemValues: vi.fn(() => undefined),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

const { useVizStore } = await import("../state/store");

/** Captured at module load, actions included — restore by MERGE. */
const PRISTINE = { ...useVizStore.getState() };

/** jest-dom is not wired up here (see kit.test.tsx) — read the property. */
function isDisabled(el: Element | null | undefined): boolean {
  return !!(el as HTMLButtonElement | HTMLInputElement | null)?.disabled;
}

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
});

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

/**
 * Seed the store slices BatchPanel reads and mount it. Since P-12 wave 2 the
 * panel is zero-prop, so the fixture is store state rather than a props bag —
 * and `onStart` is no longer a spy: the assertion is that the real
 * `startBatch` was never reached, observed through `batchError`, which is the
 * store's own record of a refusal.
 */
const RUN: BatchRun = {
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
};

type BatchState = Partial<Parameters<typeof useVizStore.setState>[0]>;

function renderBatch(over: BatchState = {}) {
  act(() =>
    useVizStore.setState({
      batch: RUN,
      batchStatus: "idle",
      batchScanning: 0,
      batchError: null,
      overlayLayers: [],
      aspect: "16:9",
      exporting: null,
      simplifiedRenderer: false,
      ...over,
    }),
  );
  return render(<BatchPanel />);
}

describe("BatchPanel blocks the run up front (F2)", () => {
  it("disables Start with the reason in its tooltip, instead of failing N times", async () => {
    renderBatch({ simplifiedRenderer: true });
    const start = screen.getByRole("button", { name: /Render 1 video/ });
    expect(isDisabled(start)).toBe(true);
    expect(start.getAttribute("title")).toMatch(/WebGPU/);
    await userEvent.click(start);
    // The click did nothing at all: no run started, and the store's own
    // refusal channel stayed empty because the action was never reached.
    expect(useVizStore.getState().batchStatus).toBe("idle");
    expect(useVizStore.getState().batchError).toBeNull();
    // Stated in the panel too — a tooltip alone is invisible on touch and to
    // anyone who does not hover a greyed-out button to ask why.
    expect(screen.getByText(/every job would fail after decoding its track/)).toBeTruthy();
  });

  it("leaves Start alone when hardware rendering is available", async () => {
    renderBatch();
    const start = screen.getByRole("button", { name: /Render 1 video/ });
    expect(isDisabled(start)).toBe(false);
    await userEvent.click(start);
    // The real action ran and refused for its OWN reason (no desktop shell in
    // jsdom) — which is the proof the button is wired, and a reason the
    // blocked case above could never produce.
    expect(useVizStore.getState().batchError).toMatch(/desktop app/);
  });
});

/** The `formatLabel` derivation that was App's last reason to subscribe to all
 * of `exportSettings` (G1's named goal). It now comes from `resIdx` here. */
describe("BatchPanel reads the export format itself (P-12 wave 2)", () => {
  it("renders the resolution label for the stored resIdx, and follows a change", () => {
    renderBatch({
      exportSettings: { ...useVizStore.getState().exportSettings, resIdx: 3 },
    });
    expect(screen.getByText(/4K \(3840×2160\)/)).toBeTruthy();

    act(() =>
      useVizStore.setState({
        exportSettings: { ...useVizStore.getState().exportSettings, resIdx: 0 },
      }),
    );
    expect(screen.getByText(/720p \(1280×720\)/)).toBeTruthy();
  });
});

/**
 * SS-3: batch refusals used to land in exportError — rendered only inside
 * ExportDialog, which is never open at that moment — and Start knew nothing
 * about a running single export. The panel now shows batchError itself and
 * disables Start with the same sentence the store guard refuses with.
 */
describe("BatchPanel surfaces its own refusals (SS-3)", () => {
  it("renders batchError inside the panel", () => {
    renderBatch({
      batchError: "Batch render needs the desktop app (it writes files to a folder)",
    });
    expect(screen.getByText(/needs the desktop app/)).toBeTruthy();
  });

  it("disables Start while a single export runs, stating the shared reason", async () => {
    renderBatch({ exporting: { done: 1, total: 10, speed: null } });
    const start = screen.getByRole("button", { name: /Render 1 video/ });
    expect(isDisabled(start)).toBe(true);
    expect(start.getAttribute("title")).toBe(
      "Finish (or cancel) the running export before starting a batch",
    );
    await userEvent.click(start);
    expect(useVizStore.getState().batchStatus).toBe("idle");
    // Stated in the panel too — a tooltip alone is invisible on touch.
    expect(screen.getAllByText(/running export before starting a batch/)).toHaveLength(1);
    cleanup();

    // …and only ONCE when batchError carries the very sentence the blocked
    // banner already shows (guard fired; the condition still blocks).
    renderBatch({
      exporting: { done: 1, total: 10, speed: null },
      batchError: "Finish (or cancel) the running export before starting a batch",
    });
    expect(screen.getAllByText(/running export before starting a batch/)).toHaveLength(1);
  });

  it("does not read a running batch's own exporting mirror as a block", () => {
    // While the batch itself runs, batchActions mirrors progress into
    // `exporting` — that must not disable/announce anything here.
    renderBatch({ exporting: { done: 1, total: 10, speed: null }, batchStatus: "running" });
    expect(screen.queryByText(/running export before starting a batch/)).toBeNull();
  });
});
