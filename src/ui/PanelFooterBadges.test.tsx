// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { KeyEstimate } from "../audio/analysis/keyDetect";
// The DSP, as TEXT. `?raw` is how ModMeters.test.tsx and exportConfig.test.ts
// already reach source, and it is the only way to couple a claim in the UI to
// the code that has to keep it true.
import lufsSource from "../audio/dsp/lufs.ts?raw";
import offlineSourceSrc from "../audio/offlineSource.ts?raw";
import realtimeSourceSrc from "../audio/realtimeSource.ts?raw";
import { PanelFooterBadges } from "./PanelFooterBadges";

/**
 * P-10 — the Visuals footer's four readout chips.
 *
 * A tooltip that states a measurement's basis WRONGLY is worse than no tooltip
 * at all: it is a confident answer nobody will re-check. So this file does two
 * different jobs.
 *
 * The behavioural half asserts what the chips show and, more usefully, when
 * they show nothing — each chip's visibility condition is the honest half of
 * what its tooltip promises.
 *
 * The structural half couples the LUFS wording to the pipeline. The store's
 * `lufs` is whatever `onMeter` was handed, which is `AudioFeatures.lufs`,
 * which BOTH sources set from `this.meter.momentary`, which is a 400 ms ring.
 * Nothing about that chain is visible from this component, and a future switch
 * to short-term or integrated loudness would leave the badge quietly lying.
 * The last test is what notices.
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

/** Captured at module load, actions included — restore by MERGE. */
const PRISTINE = { ...useVizStore.getState() };

/** A fully-analysed track: every chip present, so the absence cases below are
 *  each a single flipped input rather than a different world. Typed with the
 *  real analysis types, so a seed that stopped matching what the pipeline
 *  produces would not compile. */
const ANALYSED: {
  simplifiedRenderer: boolean;
  rendererKind: string;
  beatGrid: BeatGrid | null;
  trackKey: KeyEstimate | null;
  lufs: number | null;
} = {
  simplifiedRenderer: false,
  rendererKind: "webgpu",
  beatGrid: { bpm: 128, beatTimes: new Float32Array([0, 0.47]), hopSec: 0.0116 },
  trackKey: { tonic: 6, mode: "minor", confidence: 0.82, name: "F# minor" },
  lufs: -14.2,
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
  // Standing anti-allocation guard: this component holds five selectors, and
  // an allocating one is a white screen on mount with no React warning.
  expect(consoleErrors.join("\n")).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
});

function seed(over: Partial<typeof ANALYSED> = {}) {
  act(() => useVizStore.setState({ ...ANALYSED, ...over }));
  const { container } = render(<PanelFooterBadges />);
  const badges = () => [...container.querySelectorAll<HTMLElement>(".renderer-badge")];
  return {
    container,
    badges,
    /** The badge whose readout ends in `suffix`, with its tooltip. */
    tip: (suffix: string) =>
      badges()
        .find((b) => b.textContent!.endsWith(suffix))
        ?.getAttribute("title") ?? "",
  };
}

describe("PanelFooterBadges readouts", () => {
  it("explains all four chips without changing a character of what they read", () => {
    const { container, badges } = seed();

    // test:gpu reads `.params-panel`'s textContent and diffs it; `title` is
    // not textContent, which is the whole reason the explanations could be
    // added without a pixel-gate re-bless.
    expect(container.textContent).toBe("webgpu128 BPMF# minor-14.2 LUFS");
    expect(badges()).toHaveLength(4);
    for (const badge of badges()) {
      expect(badge.getAttribute("title"), badge.textContent!).toBeTruthy();
    }
  });

  it("states each chip's condition, not just its name", () => {
    const { tip } = seed();
    // The backend chip is the one that can say something else entirely, so it
    // has to explain what THIS value means rather than what the field is.
    expect(tip("webgpu")).toMatch(/hardware path/i);
    // Tempo and key are offline, whole-track, file-only. All three are
    // conditions a user would otherwise have to infer from an empty footer.
    expect(tip("BPM")).toMatch(/whole track/i);
    expect(tip("BPM")).toMatch(/live system audio/i);
    expect(tip("minor")).toMatch(/whole file/i);
    expect(tip("minor")).toMatch(/Krumhansl/i);
    expect(tip("LUFS")).toMatch(/paused/i);
  });

  it("hides tempo and key exactly when the analysis has none to report", () => {
    // This is what the tooltips' "live system audio" clause describes: going
    // live nulls both (store.ts, toggleLiveInput) and the chips leave.
    const { badges } = seed({ beatGrid: null, trackKey: null });
    expect(badges().map((b) => b.textContent)).toEqual(["webgpu", "-14.2 LUFS"]);
  });

  it("treats a zero tempo as no tempo", () => {
    // `analyzeBeatGrid` returns a grid even when tracking failed; 0 BPM is not
    // a tempo, and a chip reading "0 BPM" would be a claim.
    const { badges } = seed({
      beatGrid: { bpm: 0, beatTimes: new Float32Array(), hopSec: 0.0116 },
    });
    expect(badges().some((b) => b.textContent!.includes("BPM"))).toBe(false);
  });

  it("swaps the backend chip for the fallback's own words and warning colour", () => {
    const { badges, tip } = seed({ simplifiedRenderer: true, rendererKind: "canvas2d" });
    expect(badges()[0].textContent).toBe("simplified");
    expect(badges()[0].className).toContain("danger");
    // The fallback message must name the consequence, not the backend — the
    // backend id was the useless-as-only-signal case (audit F1).
    expect(tip("simplified")).toMatch(/spectrum bars/i);
    expect(tip("simplified")).not.toMatch(/hardware path/i);
  });
});

describe("PanelFooterBadges — the LUFS chip states the basis the pipeline feeds it", () => {
  /** The momentary meter, isolated from `integratedLufs` further down the
   *  file, so "400 ms" is pinned to the LIVE meter's window and not to the
   *  gated block size the offline measurement happens to share. */
  const METER = lufsSource.slice(
    lufsSource.indexOf("export class LoudnessMeter"),
    lufsSource.indexOf("export function integratedLufs"),
  );

  it("both sources feed the pipeline the momentary reading", () => {
    expect(METER.length).toBeGreaterThan(400); // the slice found the class
    expect(realtimeSourceSrc).toMatch(/lufs:[^\n]*\.momentary/);
    expect(offlineSourceSrc).toMatch(/lufs:[^\n]*\.momentary/);
  });

  it("the momentary reading really is a 400 ms window", () => {
    expect(METER).toMatch(/get momentary\(\)/);
    expect(METER).toMatch(/sampleRate \* 0\.4/);
  });

  it("and the badge says exactly that", () => {
    const { tip } = seed();
    const title = tip("LUFS");
    expect(title).toMatch(/^Momentary loudness/);
    expect(title).toContain("400 ms");
    expect(title).toContain("BS.1770");
    // The distinction that motivated re-deriving this: export normalisation
    // targets INTEGRATED loudness (exportCore imports `integratedLufs`), and
    // a reader who assumed this chip was that number would chase a moving
    // target by ear.
    expect(title).toMatch(/not the integrated/i);
  });

  it("and says it is upstream of the volume gain, which is where the tap is", () => {
    // engine.ts wires sources into a unity-gain `tap` that feeds both the
    // analysers and the volume gain, so the meter cannot follow the slider.
    // Stated in the tooltip because the opposite is the natural assumption.
    expect(seed().tip("LUFS")).toMatch(/volume and mute never move it/i);
  });
});
