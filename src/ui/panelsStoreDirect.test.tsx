// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PresetDef } from "../render/types";
import type { LibraryTrack } from "../state/platform";
import { renderProbe } from "./testing/renderProbe";
import { PresetStrip } from "./PresetStrip";
import { LibraryPanel } from "./LibraryPanel";
import { ShaderEditor } from "./ShaderEditor";
import { ShadertoyImport } from "./ShadertoyImport";

/**
 * First coverage for the four P-12 wave 2 panels that had none — PresetStrip,
 * LibraryPanel, ShaderEditor and ShadertoyImport. (PlayerBar, TimelinePanel
 * and BatchPanel keep their own files.)
 *
 * Each panel gets the two claims the migration actually makes:
 *
 *  1. it renders from the STORE, with no props to hand it anything, and
 *  2. its controls write back through real store actions.
 *
 * Plus, for the two panels that are mounted while music plays, the claim that
 * matters most: the 4 Hz playback tick and the per-frame export tick must cost
 * them nothing. `renderProbe()` is the right instrument for exactly this case
 * — a store write reaching a zero-prop component originates INSIDE the probed
 * subtree — and every write below installs a fresh value, since an
 * identity-preserving one is absorbed by zustand and would leave the
 * assertion green with the subscription re-added.
 */

const askConfirmMock = vi.fn(async (_message: string, _title: string) => true);
vi.mock("../state/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/platform")>();
  return {
    ...actual,
    writeAutosave: vi.fn(async () => {}),
    // The shader chip's delete is confirm-guarded since R2-20; jsdom has no
    // native dialog, so the mock answers "yes" unless a test overrides it.
    askConfirm: (message: string, title: string) => askConfirmMock(message, title),
  };
});

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

// Two browser APIs the strip's edge-fade and keep-active-chip-visible effects
// use that jsdom does not implement at all. Stubbed rather than worked around:
// they are layout affordances with nothing to assert, and without them the
// effects THROW during commit, which fails every PresetStrip case for a reason
// that has nothing to do with what is being tested.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const PLAYBACK = {
  playing: true,
  time: 30,
  duration: 100,
  trackName: "drop.wav",
  loop: false,
  loopStart: null,
  loopEnd: null,
};

let errorSpy: ReturnType<typeof vi.spyOn>;
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleErrors = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  cleanup();
  useVizStore.setState(PRISTINE);
  errorSpy.mockRestore();
  // The standing anti-allocation guard: both PresetStrip and TimelinePanel
  // build their chip list with useMemo rather than inside a selector, and the
  // `.filter()`/`.map()` selector shape dies on mount with no React warning at
  // all — this is what would notice.
  expect(consoleErrors.join("\n")).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
});

describe("PresetStrip is store-direct (P-12 wave 2)", () => {
  it("renders the user's order, marks the active chip, and queues a switch on click", () => {
    act(() =>
      useVizStore.setState({
        presetId: "nebula",
        pendingPresetId: null,
        presetThumbs: null,
        customDefs: [],
        simplifiedRenderer: false,
      }),
    );
    render(<PresetStrip />);

    const active = document.querySelector(".chip.active");
    expect(active?.getAttribute("data-preset-id")).toBe("nebula");

    fireEvent.click(screen.getByRole("button", { name: "Spectrum Bars" }));
    // queuePreset, not switchPreset: with quantize off and nothing playing it
    // lands immediately, which is the behaviour App's retired forwarder had.
    expect(useVizStore.getState().presetId).toBe("spectrum-bars");
  });

  it("disables the + chip on the Canvas2D fallback and says why (F1)", () => {
    act(() => useVizStore.setState({ simplifiedRenderer: true }));
    render(<PresetStrip />);
    const plus = document.querySelector<HTMLButtonElement>(".chip-new")!;
    expect(plus.disabled).toBe(true);
    expect(plus.getAttribute("title")).toMatch(/WebGPU/);
  });

  it("opens the shader editor from the + chip", () => {
    act(() => useVizStore.setState({ simplifiedRenderer: false, showShaderEditor: false }));
    render(<PresetStrip />);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".chip-new")!);
    expect(useVizStore.getState().showShaderEditor).toBe(true);
  });

  it("costs nothing on the 4 Hz playback tick or the per-frame export tick", () => {
    act(() => useVizStore.setState({ playback: PLAYBACK, presetId: "nebula" }));
    const { Probe, commits } = renderProbe();
    render(
      <Probe>
        <PresetStrip />
      </Probe>,
    );
    const before = commits();
    expect(before).toBeGreaterThan(0); // the probe is live

    act(() => useVizStore.setState({ playback: { ...PLAYBACK, time: 44 } }));
    act(() => useVizStore.setState({ exporting: { done: 1, total: 10, speed: 1 } }));
    act(() => useVizStore.setState({ lufs: -14.2 }));

    // The strip is ALWAYS mounted, which is what made this the reason it was
    // memo()d in the first place.
    expect(commits()).toBe(before);

    // …and it is not inert: a switch it DOES read reconciles it and lands.
    // Not an exact count here — the keep-the-active-chip-visible effect
    // re-runs on this write too — so the DOM is the claim.
    act(() => useVizStore.setState({ presetId: "aurora" }));
    expect(commits()).toBeGreaterThan(before);
    expect(document.querySelector(".chip.active")?.getAttribute("data-preset-id")).toBe("aurora");
  });
});

describe("LibraryPanel is store-direct (P-12 wave 2)", () => {
  const track = (n: string, title: string, artist: string, sec: number): LibraryTrack => ({
    path: `D:/Music/${n}`,
    fileName: n,
    title,
    artist,
    album: null,
    durationSec: sec,
  });
  const LIBRARY = {
    dir: "D:/Music/Beats 2026",
    tracks: [track("a.mp3", "Alpha", "Ann", 65), track("b.mp3", "Beta", "Bo", 130)],
  };

  it("renders the scanned folder and marks the playing row", () => {
    act(() =>
      useVizStore.setState({
        library: LIBRARY,
        libraryScanning: false,
        libraryActivePath: "D:/Music/b.mp3",
        libraryAutoAdvance: true,
      }),
    );
    render(<LibraryPanel />);

    expect(screen.getByText(/Beats 2026 — 2 tracks/)).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(document.querySelector(".library-row.active")?.getAttribute("title")).toBe(
      "D:/Music/b.mp3",
    );
  });

  it("writes auto-advance and the close back through the store", () => {
    act(() =>
      useVizStore.setState({
        library: LIBRARY,
        libraryScanning: false,
        libraryAutoAdvance: false,
        showLibrary: true,
      }),
    );
    render(<LibraryPanel />);

    fireEvent.click(screen.getByRole("switch", { name: "Auto-play next" }));
    expect(useVizStore.getState().libraryAutoAdvance).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Close library" }));
    expect(useVizStore.getState().showLibrary).toBe(false);
  });

  it("costs nothing on the 4 Hz playback tick — it can hold 5,000 rows", () => {
    act(() =>
      useVizStore.setState({ library: LIBRARY, libraryScanning: false, playback: PLAYBACK }),
    );
    const { Probe, commits } = renderProbe();
    render(
      <Probe>
        <LibraryPanel />
      </Probe>,
    );
    const before = commits();
    expect(before).toBeGreaterThan(0);

    act(() => useVizStore.setState({ playback: { ...PLAYBACK, time: 44 } }));
    act(() => useVizStore.setState({ activeParams: { hue: 0.5 } }));
    expect(commits()).toBe(before);

    // Not inert: the row the library itself moves to reconciles it once.
    act(() => useVizStore.setState({ libraryActivePath: "D:/Music/a.mp3" }));
    expect(commits()).toBe(before + 1);
    expect(document.querySelector(".library-row.active")?.getAttribute("title")).toBe(
      "D:/Music/a.mp3",
    );
  });
});

/** A saved WGSL visual and an IMPORTED (Shadertoy) one — the editor treats the
 * two differently, and that split is what ShadertoyImport's store-resolved
 * `editDef` has to get right. */
const WGSL_DEF: PresetDef = {
  id: "custom-1",
  name: "My Visual",
  params: [],
  wgsl: "// mine",
};
const IMPORTED_DEF: PresetDef = {
  id: "custom-2",
  name: "Warp Tunnel",
  params: [],
  wgsl: "// generated",
  shadertoy: {
    glsl: "void mainImage(out vec4 c, in vec2 p) {}",
    author: "iq",
    source: "https://shadertoy.com/view/xyz",
    license: "CC BY-NC-SA 3.0",
  },
};

describe("ShaderEditor is store-direct (P-12 wave 2)", () => {
  it("lists the saved visuals from the store and opens the Shadertoy dialog", () => {
    act(() =>
      useVizStore.setState({
        customDefs: [WGSL_DEF, IMPORTED_DEF],
        showShadertoyImport: false,
        shadertoyImportEditId: null,
      }),
    );
    render(<ShaderEditor />);

    expect(screen.getByRole("button", { name: "My Visual" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Warp Tunnel" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Shadertoy…" }));
    expect(useVizStore.getState().showShadertoyImport).toBe(true);
    // A FRESH import carries no edit id.
    expect(useVizStore.getState().shadertoyImportEditId).toBeNull();
  });

  it("hands an imported visual to the GLSL dialog instead of loading its generated WGSL", () => {
    act(() =>
      useVizStore.setState({
        customDefs: [IMPORTED_DEF],
        showShadertoyImport: false,
        shadertoyImportEditId: null,
      }),
    );
    render(<ShaderEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Warp Tunnel" }));

    expect(useVizStore.getState().showShadertoyImport).toBe(true);
    expect(useVizStore.getState().shadertoyImportEditId).toBe("custom-2");
    // The generated WGSL must never reach the code box — that is the whole
    // reason the branch exists.
    expect(document.querySelector<HTMLTextAreaElement>(".shader-code")?.value).not.toContain(
      "// generated",
    );
  });

  it("deletes through the real store action, behind the R2-20 confirm", async () => {
    act(() => useVizStore.setState({ customDefs: [WGSL_DEF], presetId: "nebula" }));
    render(<ShaderEditor />);
    askConfirmMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: 'Delete "My Visual"' }));
    await act(async () => {});
    expect(askConfirmMock).toHaveBeenCalledTimes(1);
    expect(useVizStore.getState().customDefs).toHaveLength(0);
  });
});

describe("ShadertoyImport is store-direct (P-12 wave 2)", () => {
  it("resolves the def being re-edited from customDefs + the edit id", () => {
    act(() =>
      useVizStore.setState({
        customDefs: [WGSL_DEF, IMPORTED_DEF],
        shadertoyImportEditId: "custom-2",
        showShadertoyImport: true,
      }),
    );
    render(<ShadertoyImport />);

    // This is the derivation that replaced App's `customDefs.find(...)` prop.
    expect(screen.getByText("Edit imported shader")).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Shadertoy GLSL source").value).toBe(
      IMPORTED_DEF.shadertoy!.glsl,
    );
    expect(screen.getByLabelText<HTMLInputElement>("Visual name").value).toBe("Warp Tunnel");
    expect(screen.getByLabelText<HTMLInputElement>("Original author").value).toBe("iq");
  });

  it("opens blank for a fresh import and closes through the store", () => {
    act(() =>
      useVizStore.setState({
        customDefs: [IMPORTED_DEF],
        shadertoyImportEditId: null,
        showShadertoyImport: true,
      }),
    );
    render(<ShadertoyImport />);

    expect(screen.getByText("Import Shadertoy shader")).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Shadertoy GLSL source").value).toBe("");

    // A clean dialog closes without a confirm (nothing to lose — L12).
    fireEvent.click(screen.getByRole("button", { name: "Close import dialog" }));
    expect(useVizStore.getState().showShadertoyImport).toBe(false);
    expect(useVizStore.getState().shadertoyImportEditId).toBeNull();
  });
});
