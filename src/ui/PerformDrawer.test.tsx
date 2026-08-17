// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * P-4 — the Perform drawer: store-direct operator console. What matters:
 * pads follow the strip order and queue (not hard-switch) modes, blackout
 * arms only with a performance surface up, the second-display block guards
 * itself in the browser build, and every control writes through real store
 * actions.
 */

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
const { PerformDrawer } = await import("./PerformDrawer");
const { orderedPresets } = await import("../state/presetOrder");

const PRISTINE = { ...useVizStore.getState() };

beforeEach(() => {
  useVizStore.setState(PRISTINE, false);
});

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE, false);
});

describe("PerformDrawer", () => {
  it("renders nine pads in strip order and pressing one goes through the queue path", () => {
    const s = useVizStore.getState();
    const expected = orderedPresets(s.presetOrder, s.customDefs).slice(0, 9);
    render(<PerformDrawer />);
    const pads = screen.getByRole("group", { name: "Mode pads" });
    const buttons = [...pads.querySelectorAll("button")];
    expect(buttons).toHaveLength(9);
    expect(buttons.map((b) => b.title)).toEqual(expected.map((p, i) => `${p.name} (${i + 1})`));

    // Press pad 2. With no beat grid the queue path switches instantly —
    // exactly the shipped queuePreset behavior the pads must ride.
    act(() => {
      fireEvent.click(buttons[1]);
    });
    expect(useVizStore.getState().presetId).toBe(expected[1].id);
  });

  it("blackout is disabled with no performance surface, armed by performOpen, and writes the store", () => {
    render(<PerformDrawer />);
    const btn = screen.getByRole("button", { name: "Blackout" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      useVizStore.setState({ performOpen: true });
    });
    expect((screen.getByRole("button", { name: "Blackout" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Blackout" }));
    });
    expect(useVizStore.getState().blackout).toBe(true);
    expect(screen.getByRole("button", { name: /Blacked out/ })).toBeTruthy();
  });

  it("blackout also arms in single-window Stage mode (the preserved fallback)", () => {
    act(() => {
      useVizStore.setState({ stageMode: true });
    });
    render(<PerformDrawer />);
    expect((screen.getByRole("button", { name: "Blackout" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("quantize segments write through setSwitchQuantize", () => {
    render(<PerformDrawer />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bar" }));
    });
    expect(useVizStore.getState().switchQuantize).toBe("bar");
  });

  it("browser build: the second-display block says desktop-only instead of offering a dead button", () => {
    render(<PerformDrawer />);
    expect(screen.getByText("desktop app only")).toBeTruthy();
    // The monitor picker is disabled outside the desktop shell.
    const picker = screen.getByTitle(/Which monitor/);
    expect((picker as HTMLSelectElement).disabled).toBe(true);
  });

  it("close button hides the drawer via the store", () => {
    act(() => {
      useVizStore.setState({ showPerform: true });
    });
    render(<PerformDrawer />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Close the Perform drawer" }));
    });
    expect(useVizStore.getState().showPerform).toBe(false);
  });

  it("sync source select writes the analyzer-facing sync mode", () => {
    render(<PerformDrawer />);
    const select = screen.getByTitle("What the visuals react to");
    act(() => {
      fireEvent.change(select, { target: { value: "bass" } });
    });
    expect(useVizStore.getState().sync.mode).toBe("bass");
  });
});
