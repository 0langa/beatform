// @vitest-environment jsdom
//
// NOT because anything here touches the DOM — every case below is plain
// numbers. `devHooks.ts` imports the store, whose module body reads
// `localStorage` at import time (persistence.loadStoredPresetId), so the
// default `node` environment cannot even load the file. The vitest config
// documents this per-file opt-in; it costs one environment, not a suite.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scrollsOnAxis, rendersOwnText, installDevHooks, type AxisScroll } from "./devHooks";
import { useVizStore, type VizState } from "./state/store";
import { shared } from "./state/slices/shared";

/**
 * The three seams `__runExport` cannot be tested through: the audio engine
 * singleton (its buffer identity IS the thing under test), the overlay
 * rasterizer (an await the probe takes before it builds the job — the only
 * place a test can land a track change in the right window) and the exporter
 * itself (real WebGPU, and the assertion is precisely that it is NOT reached).
 */
const fake = vi.hoisted(() => ({
  engine: { audioBuffer: null as AudioBuffer | null, state: { trackName: "probe" } },
  rasterize: vi.fn(async () => null),
  // Params spelled out (unused as they are): the first one is the assertion —
  // the probe must hand the exporter the buffer it captured, not a live read.
  exportVideo: vi.fn(async (_audio: AudioBuffer, _o: unknown) => ({
    bytes: 1,
    seconds: 1,
    audioCodec: "aac" as const,
  })),
}));

vi.mock("./state/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./state/services")>();
  return {
    ...actual,
    getEngine: () => fake.engine as unknown as ReturnType<typeof actual.getEngine>,
    getAnalyzer: () => ({}) as ReturnType<typeof actual.getAnalyzer>,
  };
});
vi.mock("./render/overlay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/overlay")>()),
  rasterizeOverlay: fake.rasterize,
}));
vi.mock("./export/videoExporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./export/videoExporter")>()),
  exportVideo: fake.exportVideo,
}));

/**
 * `__auditUI` is the only gate in the tree that can look at a rendered dock row
 * at all, and it is unreachable from here: it needs a layout engine, and jsdom
 * answers 0 to every geometry question it asks. So the two predicates that
 * decide what it reports are extracted, and this file feeds them the shapes a
 * real engine produced — every number below was MEASURED in the app's own
 * Chromium against the live dock, not invented.
 */

/** A box that is not a scroll container in either direction, walked on x. */
const inert: AxisScroll = {
  axis: "x",
  overflow: "visible",
  crossOverflow: "visible",
  scrollExtent: 200,
  clientExtent: 200,
  crossScrollExtent: 400,
  crossClientExtent: 400,
};

const box = (over: Partial<AxisScroll>): AxisScroll => ({ ...inert, ...over });

describe("scrollsOnAxis", () => {
  it("rejects every overflow value that is not a scroll container", () => {
    for (const overflow of ["visible", "hidden", "clip"]) {
      expect(scrollsOnAxis(box({ overflow, scrollExtent: 428, clientExtent: 204 }))).toBe(false);
    }
  });

  it("credits an explicit `scroll` — the one value the propagation rule never mints", () => {
    expect(scrollsOnAxis(box({ overflow: "scroll", scrollExtent: 428, clientExtent: 204 }))).toBe(
      true,
    );
  });

  it("credits `scroll` even while the other axis is also scrolling", () => {
    // Authored intent beats the disambiguator: `overflow-x: scroll` cannot have
    // arrived by computation, so a scrolling y axis says nothing about it.
    expect(
      scrollsOnAxis(
        box({
          overflow: "scroll",
          crossOverflow: "auto",
          scrollExtent: 428,
          clientExtent: 204,
          crossScrollExtent: 752,
          crossClientExtent: 589,
        }),
      ),
    ).toBe(true);
  });

  it("refuses a scroll container with no range — the clipped-not-scrolled family", () => {
    // Measured: an `overflow: hidden` wrapper inside `.panel-scroll` holding a
    // 400px child leaves the scroller at scrollWidth === clientWidth === 204
    // while the child's rect pokes 199px past the panel. Nothing to scroll,
    // nowhere to go, and the child is genuinely invisible.
    expect(scrollsOnAxis(box({ overflow: "auto", scrollExtent: 204, clientExtent: 204 }))).toBe(
      false,
    );
    expect(scrollsOnAxis(box({ overflow: "scroll", scrollExtent: 204, clientExtent: 204 }))).toBe(
      false,
    );
  });

  it("treats a one-pixel difference as rounding, not as range", () => {
    expect(scrollsOnAxis(box({ overflow: "auto", scrollExtent: 205, clientExtent: 204 }))).toBe(
      false,
    );
    expect(scrollsOnAxis(box({ overflow: "auto", scrollExtent: 206, clientExtent: 204 }))).toBe(
      true,
    );
  });

  it("REFUSES `.panel-scroll`: `auto` on x that is an echo of `overflow-y: auto`", () => {
    // The H16 defect, in numbers taken off the live dock. Specified
    // `overflow-y: auto` alone; measured computed `auto/auto`; a too-wide row
    // pushes scrollWidth to 428 against clientWidth 204 and the box is 752 tall
    // in a 589 viewport. The old walk saw `overflowX === "auto"` here and
    // excused every element in the dock.
    expect(
      scrollsOnAxis({
        axis: "x",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 428,
        clientExtent: 204,
        crossScrollExtent: 752,
        crossClientExtent: 589,
      }),
    ).toBe(false);
  });

  it("keeps `.chips`: `overflow-x: auto` over a single flex row", () => {
    // The mirror shape, and the reason the disambiguator is about RANGE rather
    // than about the computed value: `.chips` specifies only `overflow-x: auto`
    // so its computed y is `auto` too, exactly like `.panel-scroll`'s x. What
    // separates them is that this one has no vertical range to scroll.
    expect(
      scrollsOnAxis({
        axis: "x",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 640,
        clientExtent: 292,
        crossScrollExtent: 24,
        crossClientExtent: 24,
      }),
    ).toBe(true);
  });

  it("keeps `.tl-scroll`: `overflow-y: hidden` is not a scroller, whatever its range", () => {
    expect(
      scrollsOnAxis({
        axis: "x",
        overflow: "auto",
        crossOverflow: "hidden",
        scrollExtent: 1800,
        clientExtent: 900,
        crossScrollExtent: 300,
        crossClientExtent: 120,
      }),
    ).toBe(true);
  });

  it("still credits a VERTICAL scroller that has also gained horizontal range", () => {
    // The over-report this predicate was measured into. `.panel-scroll` with a
    // too-wide row present has range on BOTH axes (measured live: 35px of x
    // range beside its normal y range). The horizontal excuse must die — that
    // is the case above — but the VERTICAL one must survive, because the dock
    // scrolls down perfectly well. A symmetric rule returned 50 findings for
    // one defect, 41 of them below-viewport against a working scroller.
    expect(
      scrollsOnAxis({
        axis: "y",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 752,
        clientExtent: 589,
        crossScrollExtent: 239,
        crossClientExtent: 204,
      }),
    ).toBe(true);
  });

  it("answers the below-viewport walk too — `.chips` has no vertical range", () => {
    // The mirror blind spot, and clause 2 is all it takes: `.chips` computes
    // `overflow-y: auto` purely because `overflow-x: auto` was set, and has no
    // vertical range at all. An element below the fold with only this between
    // it and the body is unreachable; the old regex-on-computed-style credited
    // it as a scroller.
    expect(
      scrollsOnAxis({
        axis: "y",
        overflow: "auto",
        crossOverflow: "auto",
        scrollExtent: 24,
        clientExtent: 24,
        crossScrollExtent: 640,
        crossClientExtent: 292,
      }),
    ).toBe(false);
  });
});

/**
 * `__runExport` is a PARALLEL implementation of the export path, not a caller
 * of `store.runExport` — so it needs its own copy of that path's track-change
 * contract, and its own copy of the proof. It matters more than its line count:
 * every device harness that exports (av1-e2e, heap-soak, shadertoy-smoke,
 * segment-parity-probe) goes through here, and a mixed-track or gridless render
 * that returns a number is a gate measuring the wrong thing while reporting a
 * baseline. Both refusals below must be LOUD — a rejection, never a result.
 */
describe("__runExport track-change guards", () => {
  const track = (id: string) => ({ id }) as unknown as AudioBuffer;
  type RunExport = (o?: Record<string, unknown>) => Promise<{ bytes: number }>;
  const probe = () => (window as unknown as { __runExport: RunExport }).__runExport;
  /** Install with the real document, and only `awaitAnalysis` under test control
   * — the wait is where the store's own barrier can be released by a NEW load
   * rather than by analysis finishing (store.ts:1097-1101). */
  const install = (awaitAnalysis: () => Promise<void> = () => Promise.resolve()) =>
    installDevHooks((): VizState => ({ ...useVizStore.getState(), awaitAnalysis }));

  let gen = 0;
  beforeEach(() => {
    gen = shared.trackLoadGen;
    fake.rasterize.mockClear();
    fake.exportVideo.mockClear();
    fake.engine.audioBuffer = track("A");
  });
  afterEach(() => {
    shared.trackLoadGen = gen; // module-level ephemera: leave it as we found it
  });

  it("exports the buffer it captured when nothing moved", async () => {
    install();
    const info = await probe()({ width: 32, height: 18, fps: 10 });
    expect(info.bytes).toBe(1);
    // The SAME object, not merely a truthy buffer: identity is the whole
    // predicate the guard below asserts, so the happy path has to pin it too.
    expect(fake.exportVideo.mock.calls[0]?.[0]).toBe(fake.engine.audioBuffer);
  });

  it("forwards sections and vocal lines like the app's own export — E3h", async () => {
    // The probe omitted the two TrackInput fields runExport passes
    // (exportActions.ts:429/436), so every device baseline rendered with
    // sectionIndex/sectionPulse dead and no vocal-presence spans — a frame
    // the shipped app never produces. `vocalLines` is ungated on lyricStyle
    // by design, mirroring runExport's "Ungated on purpose".
    useVizStore.setState({
      sections: [0, 12.5, 25],
      lyrics: [{ t: 1, end: 2.5, text: "la" }],
      lyricStyle: { ...useVizStore.getState().lyricStyle, enabled: false },
    });
    install();
    await probe()({ width: 32, height: 18, fps: 10 });
    const opts = fake.exportVideo.mock.calls[0]?.[1] as {
      sections?: number[];
      vocalSpans?: unknown[];
    };
    expect(opts.sections).toEqual([0, 12.5, 25]);
    // Derived by buildExportOptions from vocalLines — present even though the
    // lyric OVERLAY is disabled, exactly as in the app.
    expect(Array.isArray(opts.vocalSpans)).toBe(true);
    expect(opts.vocalSpans!.length).toBeGreaterThan(0);
  });

  it("refuses a track that landed after the analysis wait — the E3d window", async () => {
    // The rasterizer is the last await before the job is built; a track landing
    // there used to be invisible, and the export would have described track B
    // (grid, meta, cover, waveform) over track A's captured audio.
    fake.rasterize.mockImplementationOnce(async () => {
      fake.engine.audioBuffer = track("B");
      return null;
    });
    install();
    await expect(probe()()).rejects.toThrow(/track changed while the export was starting/);
    expect(fake.exportVideo).not.toHaveBeenCalled();
  });

  it("refuses a load that has STARTED but not yet committed its buffer", async () => {
    // Identity is blind here by construction: `loadFile` bumps the counter on
    // its first line while the engine commits the new buffer only after the
    // decode resolves, so the buffer is still A and always will be to this
    // check. Without the counter the probe would render track A perfectly —
    // and report it as a baseline for the track the harness just replaced.
    install(async () => {
      shared.trackLoadGen++;
    });
    await expect(probe()()).rejects.toThrow(/track changed while it was being analyzed/);
    expect(fake.exportVideo).not.toHaveBeenCalled();
    expect(fake.rasterize).not.toHaveBeenCalled(); // refused before any work
  });

  it("leaves no result behind when it refuses", async () => {
    // The side channel a console session reads after the call (docs/presets.md).
    // A refusal that left the PREVIOUS run's frames standing here would be a
    // wrong number that looks right — the exact failure class these guards are
    // for, arriving through the one path that does not return anything.
    install();
    const info = await probe()({ width: 32, height: 18, fps: 10 });
    const w = window as unknown as { __lastExport?: unknown };
    expect(w.__lastExport).toEqual(info);
    fake.rasterize.mockImplementationOnce(async () => {
      fake.engine.audioBuffer = track("B");
      return null;
    });
    await expect(probe()()).rejects.toThrow(/export cancelled/);
    expect(w.__lastExport).toBeUndefined();
  });
});

describe("rendersOwnText", () => {
  it("keeps plain leaves", () => {
    expect(rendersOwnText("SPAN", 0)).toBe(true);
    expect(rendersOwnText("INPUT", 0)).toBe(true);
  });

  it("sees a <select>, whose <option>s are never laid out in the row", () => {
    // Measured: an 80px select showing a 45-character option reports
    // scrollWidth 257 / clientWidth 78 with children.length 2. The old
    // `children.length === 0` test made every truncated dropdown invisible.
    expect(rendersOwnText("SELECT", 2)).toBe(true);
  });

  it("still refuses containers, which is what keeps the auditor readable", () => {
    // A wrapper's scrollWidth overflows whenever ANY descendant does, so
    // admitting containers would report the same clip once per ancestor.
    expect(rendersOwnText("DIV", 3)).toBe(false);
    expect(rendersOwnText("BUTTON", 1)).toBe(false);
  });
});
