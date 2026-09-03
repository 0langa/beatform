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

// Web MIDI does not exist under jsdom; the drawer decides at import whether to
// show its MIDI section at all, so the adapter is mocked before the import.
const midiStop = vi.fn();
vi.mock("../state/midiInput", () => ({
  midiSupported: () => true,
  startMidi: vi.fn(async () => ({ stop: midiStop })),
}));

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
const { allParams, isModTarget } = await import("../render/types");
const { presetById } = await import("../render/presets");
const { MIDI_COMMANDS } = await import("../state/midi");
const { shared } = await import("../state/slices/shared");

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

/**
 * HD-19 — the drawer is a full MIDI surface: note-learn for the current mode
 * AND for its own controls (blackout, play/pause, next/previous mode), and
 * CC-learn for the active mode's knob targets — all through the one
 * `setMidiLearn` the Live page uses. There is no second learn system.
 */
describe("PerformDrawer MIDI", () => {
  beforeEach(() => {
    shared.midiHandle = null;
    shared.midiStarting = false;
    useVizStore.setState({ midiEnabled: true, midiBindings: [], midiLearn: null });
  });

  it("offers Enable when off, and the enable goes through the store", async () => {
    useVizStore.setState({ midiEnabled: false });
    render(<PerformDrawer />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable MIDI…" }));
    });
    expect(useVizStore.getState().midiEnabled).toBe(true);
    useVizStore.getState().disableMidi();
  });

  it("note target picker: the current mode plus the four VJ commands; Learn note arms the pick", () => {
    render(<PerformDrawer />);
    const pick = screen.getByTitle("What a pad or note triggers") as HTMLSelectElement;
    const preset = presetById(useVizStore.getState().presetId);
    expect([...pick.options].map((o) => o.textContent)).toEqual([
      `Switch to ${preset.name}`,
      ...MIDI_COMMANDS.map((c) => c.label),
    ]);

    // Default: the current mode — exactly the binding the old button armed.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Learn note" }));
    });
    expect(useVizStore.getState().midiLearn).toEqual({ kind: "note", presetId: preset.id });
    // Armed → the same button cancels.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play a note…" }));
    });
    expect(useVizStore.getState().midiLearn).toBeNull();

    act(() => {
      fireEvent.change(pick, { target: { value: "cmd:blackout" } });
      fireEvent.click(screen.getByRole("button", { name: "Learn note" }));
    });
    expect(useVizStore.getState().midiLearn).toEqual({ kind: "command", command: "blackout" });
  });

  it("CC picker lists the active mode's mod-targetable params; Learn CC arms a cc-learn with the spec's range", () => {
    render(<PerformDrawer />);
    const preset = presetById(useVizStore.getState().presetId);
    const targets = allParams(preset).filter(isModTarget);
    expect(targets.length).toBeGreaterThan(0);
    const pick = screen.getByTitle("Which parameter a knob or fader drives") as HTMLSelectElement;
    // Grouped by param group in the picker, so compare as sets, not in declaration order.
    expect([...pick.options].map((o) => o.value).sort()).toEqual(targets.map((p) => p.key).sort());
    // Not offered: "off" params are not CC targets (RP-2).
    for (const off of allParams(preset).filter((p) => !isModTarget(p))) {
      expect([...pick.options].some((o) => o.value === off.key)).toBe(false);
    }

    const chosen = targets[targets.length - 1];
    act(() => {
      fireEvent.change(pick, { target: { value: chosen.key } });
      fireEvent.click(screen.getByRole("button", { name: "Learn CC" }));
    });
    expect(useVizStore.getState().midiLearn).toEqual({
      kind: "cc",
      param: chosen.key,
      min: chosen.min,
      max: chosen.max,
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Move a knob…" }));
    });
    expect(useVizStore.getState().midiLearn).toBeNull();
  });

  it("lists a command binding by its label and removes it through the store", () => {
    useVizStore.setState({
      midiBindings: [
        { kind: "command", note: 36, command: "blackout" },
        { kind: "command", note: 37, command: "nextMode" },
      ],
    });
    render(<PerformDrawer />);
    expect(screen.getByText("Note 36 → Blackout")).toBeTruthy();
    expect(screen.getByText("Note 37 → Next mode")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Note 36 → Blackout" }));
    });
    expect(useVizStore.getState().midiBindings).toEqual([
      { kind: "command", note: 37, command: "nextMode" },
    ]);
  });

  it("Disable is reachable from the drawer too (MIDI now re-arms itself at launch)", () => {
    render(<PerformDrawer />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    });
    expect(useVizStore.getState().midiEnabled).toBe(false);
  });
});
