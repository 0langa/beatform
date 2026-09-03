import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HD-18 / HD-19 — the store side of MIDI:
 *
 * - the enable flag is a preference (beatform.prefs.v1 `midiEnabled`): a
 *   successful enable sets it, disable clears it, and `initApp` re-enables
 *   at boot when it is set — so saved bindings work on launch without a
 *   click;
 * - a note can fire the Perform drawer's own controls (blackout, play/pause,
 *   next/previous mode), and it must do so through EXACTLY the store actions
 *   the keyboard and the drawer buttons call — same arming rule for blackout,
 *   same beat-quantized walk for the mode steps.
 *
 * Same harness as store.test.ts: real store, mocked platform edges (Web
 * Audio, Web MIDI, WebGPU, Tauri fs) that do not exist under node.
 */

class MapStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const storage = new MapStorage();
vi.stubGlobal("localStorage", storage);
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ blob: async () => new Blob() })),
);

// ONE engine object, so togglePlay's play/pause calls can be asserted.
const engine = {
  ctx: { decodeAudioData: vi.fn() },
  currentTime: 0,
  duration: 0,
  playing: false,
  seek: vi.fn(),
  setVolume: vi.fn(),
  onEnded: null as null | (() => void),
  dispose: vi.fn(),
  play: vi.fn(async () => {
    engine.playing = true;
  }),
  pause: vi.fn(() => {
    engine.playing = false;
  }),
};

vi.mock("../services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => engine),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn(), reset: vi.fn() })),
  peekAnalyzer: vi.fn(() => null),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return { ...actual, writeAutosave: vi.fn(async () => {}) };
});

const midiStop = vi.fn();
vi.mock("../midiInput", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../midiInput")>();
  return {
    ...actual,
    startMidi: vi.fn(async () => ({ stop: midiStop })),
  };
});

vi.mock("../../render/overlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../render/overlay")>();
  return { ...actual, rasterizeOverlay: vi.fn(async () => ({ close: vi.fn() })) };
});
vi.mock("../../render/dynamicOverlay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../render/dynamicOverlay")>();
  return { ...actual, composeOverlayFrame: vi.fn(async () => ({ close: vi.fn() })) };
});

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 1,
    height: 1,
    getBoundingClientRect: () => ({ width: 1, height: 1 }),
  } as unknown as HTMLCanvasElement;
}

const NOTE_ON = (n: number, v = 100) => [0x90, n, v];
const LS_MIDI = "viz.midiBindings.v1";

const { useVizStore } = await import("../store");
const { shared } = await import("./shared");
const { getPrefs, setPrefs } = await import("../prefs");
const { startMidi } = await import("../midiInput");
const { orderedPresets } = await import("../presetOrder");

beforeEach(() => {
  // Clean slate for the module-scope MIDI ephemera and everything a case here touches.
  shared.midiHandle = null;
  shared.midiStarting = false;
  useVizStore.setState({
    midiEnabled: false,
    midiDevices: [],
    midiBindings: [],
    midiLearn: null,
    blackout: false,
    stageMode: false,
    performOpen: false,
    notice: null,
    pendingPresetId: null,
    switchQuantize: "off",
  });
  setPrefs({ midiEnabled: false });
  storage.clear();
  vi.mocked(startMidi).mockClear();
  midiStop.mockClear();
  engine.play.mockClear();
  engine.pause.mockClear();
  engine.playing = false;
});

afterEach(() => {
  useVizStore.getState().disableMidi();
});

// Real async work (permission await, initApp) — the same describe budget
// every suite doing real work carries (GATES.md §1).
describe("MIDI enable flag is a preference (HD-18)", { timeout: 30_000 }, () => {
  it("a successful enable sets the pref; disable clears it", async () => {
    expect(getPrefs().midiEnabled).toBe(false);
    await useVizStore.getState().enableMidi();
    expect(useVizStore.getState().midiEnabled).toBe(true);
    expect(getPrefs().midiEnabled).toBe(true);

    useVizStore.getState().disableMidi();
    expect(useVizStore.getState().midiEnabled).toBe(false);
    expect(getPrefs().midiEnabled).toBe(false);
  });

  it("a failed enable (no Web MIDI) tells the user and leaves the pref off", async () => {
    vi.mocked(startMidi).mockResolvedValueOnce(null);
    await useVizStore.getState().enableMidi();
    expect(useVizStore.getState().midiEnabled).toBe(false);
    expect(useVizStore.getState().notice).toMatch(/MIDI isn't available/);
    expect(getPrefs().midiEnabled).toBe(false);
  });

  it("boot: initApp re-enables MIDI when the pref is set, and teardown stops it", async () => {
    setPrefs({ midiEnabled: true });
    const dispose = useVizStore.getState().initApp(fakeCanvas());
    await vi.waitFor(() => expect(useVizStore.getState().midiEnabled).toBe(true));
    expect(startMidi).toHaveBeenCalledTimes(1);
    expect(shared.midiHandle).not.toBeNull();
    dispose();
    expect(midiStop).toHaveBeenCalledTimes(1);
  });

  it("boot: initApp leaves MIDI off when the pref is off", async () => {
    const dispose = useVizStore.getState().initApp(fakeCanvas());
    await new Promise((r) => setTimeout(r, 20));
    expect(startMidi).not.toHaveBeenCalled();
    expect(useVizStore.getState().midiEnabled).toBe(false);
    dispose();
  });

  it("boot: a failed re-enable is silent — no notice on every launch — and keeps the pref", async () => {
    setPrefs({ midiEnabled: true });
    vi.mocked(startMidi).mockResolvedValueOnce(null);
    const dispose = useVizStore.getState().initApp(fakeCanvas());
    await vi.waitFor(() => expect(startMidi).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(useVizStore.getState().midiEnabled).toBe(false);
    expect(useVizStore.getState().notice).toBeNull();
    // The user's choice stands; the next launch tries again, and an explicit
    // Enable still reports the failure (previous case).
    expect(getPrefs().midiEnabled).toBe(true);
    dispose();
  });
});

describe("note → command dispatch takes the drawer's own paths (HD-19)", () => {
  it("blackout toggles only while a performance surface arms it — the same rule as the 0 key and the drawer button", () => {
    useVizStore.setState({
      midiBindings: [{ kind: "command", note: 36, command: "blackout" }],
    });
    // Nothing armed: the message is ignored, exactly like the disabled button.
    useVizStore.getState().handleMidiMessage(NOTE_ON(36));
    expect(useVizStore.getState().blackout).toBe(false);

    useVizStore.setState({ performOpen: true });
    useVizStore.getState().handleMidiMessage(NOTE_ON(36));
    expect(useVizStore.getState().blackout).toBe(true);
    useVizStore.getState().handleMidiMessage(NOTE_ON(36));
    expect(useVizStore.getState().blackout).toBe(false);

    useVizStore.setState({ performOpen: false, stageMode: true });
    useVizStore.getState().handleMidiMessage(NOTE_ON(36));
    expect(useVizStore.getState().blackout).toBe(true);
  });

  it("play/pause goes through togglePlay (the Space path)", async () => {
    useVizStore.setState({
      midiBindings: [{ kind: "command", note: 37, command: "playPause" }],
      liveInputActive: false,
    });
    useVizStore.getState().handleMidiMessage(NOTE_ON(37));
    await vi.waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    useVizStore.getState().handleMidiMessage(NOTE_ON(37));
    await vi.waitFor(() => expect(engine.pause).toHaveBeenCalledTimes(1));
  });

  it("next/previous mode walk the strip through stepPreset — instant with quantize off", () => {
    const s = useVizStore.getState();
    const all = orderedPresets(s.presetOrder, s.customDefs);
    useVizStore.setState({
      presetId: all[0].id,
      midiBindings: [
        { kind: "command", note: 38, command: "nextMode" },
        { kind: "command", note: 39, command: "prevMode" },
      ],
    });
    useVizStore.getState().handleMidiMessage(NOTE_ON(38));
    expect(useVizStore.getState().presetId).toBe(all[1].id);
    useVizStore.getState().handleMidiMessage(NOTE_ON(39));
    expect(useVizStore.getState().presetId).toBe(all[0].id);
    useVizStore.getState().handleMidiMessage(NOTE_ON(39));
    expect(useVizStore.getState().presetId).toBe(all[all.length - 1].id); // wraps
  });

  it("next mode honours beat-quantize exactly like N / the pads (queued, not jumped)", () => {
    const s = useVizStore.getState();
    const all = orderedPresets(s.presetOrder, s.customDefs);
    useVizStore.setState({
      presetId: all[0].id,
      switchQuantize: "beat",
      playback: { ...s.playback, playing: true },
      beatGrid: { bpm: 120, beatTimes: Float32Array.from([0, 0.5, 1, 1.5, 2]), hopSec: 0.0116 },
      pendingPresetId: null,
      midiBindings: [{ kind: "command", note: 38, command: "nextMode" }],
    });
    useVizStore.getState().handleMidiMessage(NOTE_ON(38));
    expect(useVizStore.getState().presetId).toBe(all[0].id);
    expect(useVizStore.getState().pendingPresetId).toBe(all[1].id);
    useVizStore.setState({
      pendingPresetId: null,
      switchQuantize: "off",
      playback: { ...useVizStore.getState().playback, playing: false },
      beatGrid: null,
    });
  });

  it("learn: the first note-on mints the command binding, saves it, and is not also fired", () => {
    useVizStore.setState({
      stageMode: true,
      midiLearn: { kind: "command", command: "blackout" },
    });
    useVizStore.getState().handleMidiMessage([0xb0, 7, 64]); // a CC during a note-learn: ignored
    expect(useVizStore.getState().midiLearn).toEqual({ kind: "command", command: "blackout" });

    useVizStore.getState().handleMidiMessage(NOTE_ON(36));
    expect(useVizStore.getState().midiLearn).toBeNull();
    expect(useVizStore.getState().midiBindings).toEqual([
      { kind: "command", note: 36, command: "blackout" },
    ]);
    expect(useVizStore.getState().blackout).toBe(false); // learning is not firing
    // Persisted through the same validator the boot loader uses.
    expect(JSON.parse(storage.getItem(LS_MIDI) ?? "[]")).toEqual([
      { kind: "command", note: 36, command: "blackout" },
    ]);

    // And now it fires.
    useVizStore.getState().handleMidiMessage(NOTE_ON(36));
    expect(useVizStore.getState().blackout).toBe(true);
  });

  it("re-learning a pad that switched modes turns it into a command pad (one meaning per note)", () => {
    useVizStore.setState({
      midiBindings: [{ kind: "note", note: 36, presetId: "particles" }],
      midiLearn: { kind: "command", command: "playPause" },
    });
    useVizStore.getState().handleMidiMessage(NOTE_ON(36));
    expect(useVizStore.getState().midiBindings).toEqual([
      { kind: "command", note: 36, command: "playPause" },
    ]);
  });
});
