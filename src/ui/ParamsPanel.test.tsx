// @vitest-environment jsdom
import { StrictMode, useState, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getPrefs, subscribePrefs } from "../state/prefs";
import { ParamsPanel, type ParamsPanelProps } from "./ParamsPanel";
import { presets } from "../render/presets";
import type { PresetDef } from "../render/types";
import { BG_PRESET, DEFAULT_MOTION, DEFAULT_POST, defaultParams } from "../render/types";
import { DEFAULT_SYNC } from "../audio/types";
import { DEFAULT_AUDIOGRAM } from "../state/audiogram";
import { DEFAULT_LYRIC_STYLE } from "../state/lyrics";
import { defaultBuilderStack } from "../render/builder2";

afterEach(cleanup);

/**
 * The H13 stable-props contract, made testable (audit UI-2/UI-26): ParamsPanel
 * is memo()d so the ~4 Hz playback re-render of App skips its ~2,000 lines —
 * which only holds if EVERY prop keeps a stable identity. The contract was
 * enforced by comments alone and silently broke in App.tsx (three inline
 * arrows + a fresh `userPresets.filter()` per render: onBgPerMode,
 * onPickCenterImage, onClearCenterImage, userPresets — all hoisted now).
 *
 * Probe: the panel's render body unconditionally reads `preset.params`
 * (defaultParams/allParams/…), so a counting getter on that property is a
 * render counter that needs no React internals. memo() bailing out = zero
 * reads on a parent re-render; one unstable prop = the reads resume.
 */

function probedPreset(): { preset: PresetDef; reads: () => number } {
  const base = presets[0];
  let count = 0;
  const preset = { ...base };
  Object.defineProperty(preset, "params", {
    get: () => {
      count++;
      return base.params;
    },
  });
  return { preset, reads: () => count };
}

function makeProps(preset: PresetDef): ParamsPanelProps {
  return {
    preset,
    params: defaultParams(preset),
    onParam: vi.fn(),
    onApplyStyle: vi.fn(),
    onReset: vi.fn(),
    bg: { mode: BG_PRESET, color: [0, 0, 0] },
    onBg: vi.fn(),
    onPickBackgroundImage: vi.fn(),
    onUseAlbumArtBackground: vi.fn(),
    bgPerMode: false,
    onBgPerMode: vi.fn(),
    centerImageName: null,
    onPickCenterImage: vi.fn(),
    onClearCenterImage: vi.fn(),
    onPickVideoBackground: vi.fn(),
    videoBgLoading: false,
    showVideoBg: false,
    sync: DEFAULT_SYNC,
    analysisSampleRate: 48000,
    onSync: vi.fn(),
    rendererKind: "webgpu",
    simplifiedRenderer: false,
    onClose: vi.fn(),
    userPresets: [],
    onSaveUserPreset: vi.fn(),
    onApplyUserPreset: vi.fn(),
    onDeleteUserPreset: vi.fn(),
    onExportUserPreset: vi.fn(),
    onImportUserPreset: vi.fn(),
    onApplyTheme: vi.fn(),
    onExportTheme: vi.fn(),
    aspect: "free",
    onAspect: vi.fn(),
    lufs: null,
    bpm: null,
    keyName: null,
    overlayLayers: [],
    assets: {},
    hasCoverArt: false,
    onAddTextLayer: vi.fn(),
    onAddImageLayer: vi.fn(),
    onAddAlbumArtLayer: vi.fn(),
    onUpdateLayer: vi.fn(),
    onRemoveLayer: vi.fn(),
    smoothSpectrum: false,
    onSmoothSpectrum: vi.fn(),
    post: DEFAULT_POST,
    onPost: vi.fn(),
    motion: DEFAULT_MOTION,
    onMotion: vi.fn(),
    switchQuantize: "off",
    onSwitchQuantize: vi.fn(),
    midiSupported: false,
    midiEnabled: false,
    midiDevices: [],
    midiBindings: [],
    midiLearn: null,
    onEnableMidi: vi.fn(),
    onDisableMidi: vi.fn(),
    onMidiLearn: vi.fn(),
    onRemoveMidiBinding: vi.fn(),
    mods: [],
    stems: [],
    stemAnalyzing: null,
    onAddStem: vi.fn(),
    onRemoveStem: vi.fn(),
    onAutoRouteStem: vi.fn(),
    onAddMod: vi.fn(),
    onUpdateMod: vi.fn(),
    onRemoveMod: vi.fn(),
    lyricFileName: null,
    lyricStyle: DEFAULT_LYRIC_STYLE,
    onImportLyrics: vi.fn(),
    onClearLyrics: vi.fn(),
    onLyricStyle: vi.fn(),
    audiogram: DEFAULT_AUDIOGRAM,
    onAudiogram: vi.fn(),
    builderStack: defaultBuilderStack(),
    onBuilderStack: vi.fn(),
    onBuilderExport: vi.fn(),
    onBuilderImport: vi.fn(),
  };
}

/** Re-renders on demand, like App does at the playback tick — the panel's
 * props keep their identities across those renders (the H13 discipline). */
function Host({ props }: { props: ParamsPanelProps }) {
  const [, setN] = useState(0);
  return (
    <>
      <button onClick={() => setN((n) => n + 1)}>parent tick</button>
      <ParamsPanel {...props} />
    </>
  );
}

/** Same, but with ONE prop rebuilt per render — the defect shape UI-2 fixed
 * in App.tsx (inline arrows / fresh `.filter()` arrays in the JSX). */
function UnstableHost({ props }: { props: ParamsPanelProps }) {
  const [, setN] = useState(0);
  return (
    <>
      <button onClick={() => setN((n) => n + 1)}>parent tick</button>
      <ParamsPanel {...props} onBgPerMode={(v) => props.onBgPerMode(v)} />
    </>
  );
}

describe("modulation & MIDI target lists (RP-2 / RP-14)", () => {
  it('mod:"off" params are absent from the route-target picker', () => {
    // spectrum-bars: "mirror"/"peaks" are pure toggles (mod:"off"); "hue" is a
    // regular target. A route must exist for the picker to render at all.
    const preset = presets.find((p) => p.id === "spectrum-bars")!;
    expect(preset.params.find((p) => p.key === "mirror")?.mod).toBe("off"); // fixture sanity
    const props = {
      ...makeProps(preset),
      mods: [{ id: "r1", source: "kick" as const, param: "hue", amount: 0.5 }],
    };
    render(<ParamsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    const select = screen.getByTitle("Which knob it moves") as HTMLSelectElement;
    const values = [...select.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values).toContain("hue");
    expect(values).not.toContain("mirror");
    expect(values).not.toContain("peaks");
    expect(values).toContain("post:chromatic"); // post targets unaffected
  });

  it("a legacy route to an off param keeps a visible, inert option instead of being rewritten", () => {
    const preset = presets.find((p) => p.id === "spectrum-bars")!;
    const props = {
      ...makeProps(preset),
      mods: [{ id: "r1", source: "kick" as const, param: "mirror", amount: 1 }],
    };
    render(<ParamsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    const select = screen.getByTitle("Which knob it moves") as HTMLSelectElement;
    // The select still SHOWS the route's real target — merely opening the
    // panel must not snap it onto the first modulatable param.
    expect(select.value).toBe("mirror");
    expect(
      [...select.querySelectorAll("option")].some(
        (o) => o.getAttribute("value") === "mirror" && /not modulatable/.test(o.textContent ?? ""),
      ),
    ).toBe(true);
  });
});

describe("ParamsPanel memo (H13 stable-props contract, UI-2)", () => {
  it("does not reconcile when the parent re-renders with stable prop identities", () => {
    const { preset, reads } = probedPreset();
    render(<Host props={makeProps(preset)} />);
    expect(screen.getByText("Visual settings")).toBeTruthy(); // it mounted
    const afterMount = reads();
    expect(afterMount).toBeGreaterThan(0); // the probe is live

    fireEvent.click(screen.getByText("parent tick"));
    fireEvent.click(screen.getByText("parent tick"));

    // memo() bailed out: the panel body never ran again, so nothing re-read
    // the preset's params.
    expect(reads()).toBe(afterMount);
  });

  it("control: one fresh function identity per render defeats the memo", () => {
    const { preset, reads } = probedPreset();
    render(<UnstableHost props={makeProps(preset)} />);
    const afterMount = reads();

    fireEvent.click(screen.getByText("parent tick"));

    // The whole panel reconciled with the parent — proof this harness would
    // have caught the App.tsx inline-arrow regression, and will catch the
    // next one if a future prop skips the useCallback block.
    expect(reads()).toBeGreaterThan(afterMount);
  });
});

describe("no external-store writes during render", () => {
  /** Stand-in for App: subscribed to prefs exactly like App.tsx's
   * useSyncExternalStore(subscribePrefs, getPrefs). A setPrefs call executed
   * while ParamsPanel is rendering schedules an update on this component
   * mid-render — React dev logs "Cannot update a component…". StrictMode is
   * what re-runs useState updaters in the render phase, so it is required
   * for the repro. */
  function PrefsMirror() {
    const p = useSyncExternalStore(subscribePrefs, getPrefs);
    return <span data-testid="prefs-mirror">{p.collapsedSections.length}</span>;
  }

  it("section collapse persists prefs without a render-phase update (StrictMode)", () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      render(
        <StrictMode>
          <PrefsMirror />
          <ParamsPanel {...makeProps(presets[0])} />
        </StrictMode>,
      );
      const toggles = document.querySelectorAll(".section-toggle");
      expect(toggles.length).toBeGreaterThan(0);
      fireEvent.click(toggles[0]);
      fireEvent.click(toggles[0]);
    } finally {
      spy.mockRestore();
    }
    expect(errors.filter((e) => e.includes("Cannot update a component"))).toEqual([]);
  });
});
