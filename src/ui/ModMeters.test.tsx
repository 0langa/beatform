// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { AudioFeatures } from "../audio/types";
import { DEFAULT_PREFS, setPrefs, subscribePrefs } from "../state/prefs";
import { shapedValue, sourceValue } from "../state/modMatrix";
import { renderProbe } from "./testing/renderProbe";
import { ModMeterDriver, __meterCount, meterRef, type MeterSpec } from "./ModMeters";
import modMatrixSource from "../state/modMatrix.ts?raw";
import modMetersSource from "./ModMeters.tsx?raw";

/**
 * The meter engine's contract, and the two things that would let it ship
 * broken with every other test in the repo still green.
 *
 * R-1 — SILENCE. P-1 asks for live meters inside the exact panel v2.80.0 and
 * v2.82.0 spent two releases making cheap; the headline fix there was
 * stopping a 4 Hz LUFS tick from reconciling ~2,000 lines. A meter that
 * re-renders React at 60 Hz undoes that silently: ParamsPanel's T1-T6 poke
 * `lufs`/`playback`/`exporting`/`stereoWidth`, not the feature tick, so all
 * six stay green under a 60 Hz setState in a new leaf.
 *
 * 5a — VACUITY. A test that asserts ONLY "zero commits" passes perfectly on a
 * meter whose data source is null in jsdom, whose effect early-returns, or
 * that was never wired at all: it proves zero re-renders by proving zero
 * work. So the headline test asserts LIVENESS and SILENCE over the SAME
 * driven frames, and every gate test below says out loud which half it would
 * be vacuous without.
 *
 * WU-2 ships the engine headless — no CSS, no card markup — so the host here
 * is a stand-in for WU-3's card: one element per meter carrying `meterRef`,
 * one `<ModMeterDriver />`, and a store subscription of the kind a real card
 * has. It is deliberately NOT ParamsPanel: the cards do not call meterRef
 * until WU-5 wires them, and a test that mounted the panel today would find
 * zero meters and assert nothing.
 */

/** Controllable analyzer + published stems behind the services mock. */
const svc = vi.hoisted(() => ({
  analyzer: null as { features: AudioFeatures } | null,
  peekCalls: 0,
  stems: undefined as Record<string, number> | undefined,
}));

vi.mock("../state/services", () => ({
  initServices: vi.fn(() => vi.fn()),
  getEngine: vi.fn(() => ({
    ctx: { decodeAudioData: vi.fn() },
    currentTime: 0,
    duration: 0,
    playing: false,
    setVolume: vi.fn(),
    onEnded: null,
    dispose: vi.fn(),
  })),
  getAnalyzer: vi.fn(() => ({ setSync: vi.fn() })),
  peekAnalyzer: vi.fn(() => {
    svc.peekCalls += 1;
    return svc.analyzer;
  }),
  getLiveStemValues: vi.fn(() => svc.stems),
  getPresentedFrames: vi.fn(() => 0),
  getRenderer: vi.fn(() => null),
  setLiveRenderPaused: vi.fn(),
  remeasure: vi.fn(),
}));

const { useVizStore } = await import("../state/store");

/** Merge-restore, never setState(x, true): a replace would drop the actions. */
const PRISTINE = { ...useVizStore.getState() };

/** The scripted feature frame — ONE object, mutated in place, exactly like
 * RealtimeAnalyzer's (`get features()` hands back the pipeline's live
 * snapshot; see its docblock). A test that swapped in a fresh object each
 * frame would be testing a source the app does not have. */
function scriptedFeatures(): AudioFeatures {
  return {
    rms: 0,
    energy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    voice: 0,
    drive: 0,
    driveBeat: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    width: 0,
    lufs: -70,
    beatPhase: 0,
    barPhase: 0,
    bpm: 0,
    time: 0,
    duration: 0,
    beat: false,
    beatIntensity: 0,
    bins: new Float32Array(96),
    peaks: new Float32Array(96),
    waveform: new Float32Array(256),
    waveformL: new Float32Array(256),
    waveformR: new Float32Array(256),
  } as AudioFeatures;
}

let features: AudioFeatures;

/**
 * Controllable rAF, the PerfOverlay.test.tsx pattern plus TRACK time: the
 * driver holds on an unchanged `features.time` (the paused-preview rule), so
 * a clock that advanced only the rAF timestamp would freeze every meter and
 * make the liveness half unprovable.
 */
function fakeRaf() {
  let now = 0;
  let seq = 0;
  let queue = new Map<number, (t: number) => void>();
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    const id = ++seq;
    queue.set(id, cb);
    return id;
  });
  // A REAL cancel, unlike PerfOverlay.test.tsx's no-op: teardown and the
  // StrictMode double-invoke are two of the things under test here, and both
  // are indistinguishable from a leak when cancellation does nothing.
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue.delete(id);
  });
  return (ms: number, frames: number, { advanceTrack = true } = {}) => {
    for (let i = 0; i < frames; i++) {
      now += ms;
      if (advanceTrack) features.time += ms / 1000;
      const batch = queue;
      queue = new Map();
      const t = now;
      act(() => {
        for (const cb of batch.values()) cb(t);
      });
    }
  };
}

/**
 * Render-body executions of the host — the direct analogue of
 * ParamsPanel.test.tsx's `probePresetParams().reads()`, which cannot be used
 * here because the host is not the panel.
 *
 * A counting GETTER the body reads, not a variable the body reassigns:
 * reassigning module state during render is itself the impurity
 * `react-hooks/globals` bans, and probePresetParams is a getter for the same
 * reason.
 */
const body = {
  n: 0,
  /** Read unconditionally from the render body; renders nothing. */
  get tick(): null {
    body.n += 1;
    return null;
  },
};
const hostRenders = () => body.n;

function MeterHost({ specs }: { specs: MeterSpec[] }) {
  // A card subscribes to the document; if anything in the meter path wrote to
  // the store, this canary commits and both silence assertions catch it.
  const presetId = useVizStore((s) => s.presetId);
  return (
    <div className="mod-cards" data-preset={presetId}>
      {body.tick}
      {specs.map((spec, i) => (
        <div key={i} className="mod-card">
          <div data-testid={`meter-${i}`} ref={meterRef(spec)} />
          <span
            data-testid={`readout-${i}`}
            ref={(el) => {
              // The spec is read live on every tick, so a readout may attach
              // after the meter registers (documented on MeterSpec.readout).
              spec.readout = el;
            }}
          />
        </div>
      ))}
      <ModMeterDriver />
    </div>
  );
}

function v(el: Element | null): string {
  return (el as HTMLElement).style.getPropertyValue("--v");
}

beforeEach(() => {
  features = scriptedFeatures();
  svc.analyzer = { features };
  svc.peekCalls = 0;
  svc.stems = undefined;
  body.n = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useVizStore.setState(PRISTINE);
  setPrefs(DEFAULT_PREFS);
  // Ref cleanups run on unmount; if one ever stops firing, the module-level
  // registry leaks across the whole suite and every later test lies.
  expect(__meterCount()).toBe(0);
});

describe("T15 — liveness and silence, measured over the same frames", () => {
  it("tracks the audio through --v while committing React exactly zero times", () => {
    const step = fakeRaf();
    // Two meters: a linear one and a curved one, so the curve stage is
    // covered by the same driven frames.
    const specs: MeterSpec[] = [{ source: "bass" }, { source: "rms", curve: "exp" }];

    let storeNotifications = 0;
    let prefsNotifications = 0;

    features.bass = 0.25;
    features.rms = 0.5;

    const { Probe, commits } = renderProbe();
    const { container } = render(
      <Probe>
        <MeterHost specs={specs} />
      </Probe>,
    );

    const unsubStore = useVizStore.subscribe(() => {
      storeNotifications += 1;
    });
    const unsubPrefs = subscribePrefs(() => {
      prefsNotifications += 1;
    });

    try {
      // 40 frames at value A.
      step(16, 40);
      const meterA = container.querySelector('[data-testid="meter-0"]');
      const curvedA = container.querySelector('[data-testid="meter-1"]');
      const vA = v(meterA);
      const vCurvedA = v(curvedA);

      // Both probes must be LIVE before anything is claimed about them
      // staying put — this is the difference between "React was silent" and
      // "nothing was ever rendered".
      expect(commits()).toBeGreaterThan(0);
      expect(hostRenders()).toBeGreaterThan(0);
      expect(vA).not.toBe("");

      const commitsBefore = commits();
      const rendersBefore = hostRenders();

      // The audio moves.
      features.bass = 0.75;
      features.rms = 1;
      step(16, 40);

      // (1) LIVENESS — the displayed value is what the SHIPPING evaluator
      //     resolves. Computed by importing sourceValue/shapedValue, never
      //     by re-deriving v²(3−2v) in the test: a forked copy here is
      //     exactly the second evaluator the determinism law forbids, and it
      //     would agree with a forked copy in the UI forever.
      expect(Number(v(meterA))).toBe(shapedValue(undefined, sourceValue(features, "bass")));
      expect(Number(v(curvedA))).toBe(shapedValue("exp", sourceValue(features, "rms")));
      // …and the curve is genuinely applied: exp(1.0) happens to be 1.0, so
      // pin the earlier frame where exp(0.5) = 0.25 ≠ 0.5.
      expect(Number(vCurvedA)).toBe(0.25);

      // (2) it MOVED.
      expect(v(meterA)).not.toBe(vA);
      expect(v(curvedA)).not.toBe(vCurvedA);

      // (3) React committed nothing over those same 40 frames.
      expect(commits()).toBe(commitsBefore);
      // (4) …and the host's render body never ran again.
      expect(hostRenders()).toBe(rendersBefore);
      // (5) no store write, no prefs write. A subscription-shaped "fix" of
      //     useVizStore.getState() would not add notifications, but (3)/(4)
      //     catch that; this catches the reverse — a meter that publishes.
      expect(storeNotifications).toBe(0);
      expect(prefsNotifications).toBe(0);
    } finally {
      unsubStore();
      unsubPrefs();
    }
  });

  it("reads stem sources from the LOOP's published Record, not its own resolve", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "stem1:kick" }];
    const { container } = render(<MeterHost specs={specs} />);
    const el = container.querySelector('[data-testid="meter-0"]');

    // No stems loaded: the source reads 0, silently inert.
    step(16, 4);
    expect(Number(v(el))).toBe(0);

    svc.stems = { "stem1:kick": 0.5 };
    step(16, 4);
    expect(Number(v(el))).toBe(sourceValue(features, "stem1:kick", svc.stems));
    expect(Number(v(el))).toBe(0.5);

    svc.stems = { "stem1:kick": 0.25 };
    step(16, 4);
    expect(Number(v(el))).toBe(0.25);
  });

  it("shows the raw source through the curve for a lagged route — never the smoothed value", () => {
    // D4, said out loud as a test: attack/release are DISPLAY-invisible here.
    // The engine's lag stage is caller-state-mutating and stays private; a UI
    // that reproduced it would advance the loop's envelopes a second time per
    // frame and change what the renderer draws.
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    const { container } = render(<MeterHost specs={specs} />);
    const el = container.querySelector('[data-testid="meter-0"]');

    features.bass = 0;
    step(16, 2);
    expect(Number(v(el))).toBe(0);

    // A step the size a 2 s attack would take seconds to follow: the meter
    // lands on it in one frame, by construction.
    features.bass = 0.75;
    step(16, 1);
    expect(Number(v(el))).toBe(0.75);
  });

  it("is StrictMode-idempotent: the double-invoked effect leaves one live rAF", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.5;
    const { container } = render(
      <StrictMode>
        <MeterHost specs={specs} />
      </StrictMode>,
    );
    const before = svc.peekCalls;
    step(16, 10);
    // One analyzer read per frame, not two: a leaked rAF from the discarded
    // first effect would double this.
    expect(svc.peekCalls - before).toBe(10);
    expect(Number(v(container.querySelector('[data-testid="meter-0"]')))).toBe(0.5);
  });
});

describe("T16 — the 250 ms readout throttle, in BOTH directions", () => {
  it("holds the numeric readout under 250 ms and writes it once across", () => {
    // VACUITY TRAP: a throttle keyed off performance.now() under a stubbed
    // rAF either never fires (loud failure) or always fires (a green test
    // over a dead throttle). Only asserting the NEGATIVE case separates them.
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.25;
    const { container } = render(<MeterHost specs={specs} />);
    const readout = container.querySelector('[data-testid="readout-0"]')!;

    // First tick always writes text (lastText starts at -Infinity).
    step(16, 1);
    expect(readout.textContent).toBe("0.25");

    // 14 more frames = 224 ms since that write — under the interval.
    features.bass = 0.75;
    step(16, 14);
    expect(readout.textContent).toBe("0.25"); // the negative half
    // …while --v, which is NOT throttled, has already followed.
    expect(Number(v(container.querySelector('[data-testid="meter-0"]')))).toBe(0.75);

    // Cross 250 ms.
    step(16, 3);
    expect(readout.textContent).toBe("0.75");
  });
});

describe("T17 — lifecycle and gates", () => {
  /** Every case below is the vacuous shape ON ITS OWN ("nothing happened").
   *  They are only meaningful shipped alongside T15, which proves the same
   *  engine, driven the same way, does move. */

  it("stage mode: not one analyzer read for the whole performance", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.5;
    const { container } = render(<MeterHost specs={specs} />);
    step(16, 5);
    const before = v(container.querySelector('[data-testid="meter-0"]'));
    expect(Number(before)).toBe(0.5);

    act(() => useVizStore.setState({ stageMode: true }));
    const peeksBefore = svc.peekCalls;
    features.bass = 1;
    step(16, 60);

    // R-7: the dock stays MOUNTED in stage mode (setStageMode does not clear
    // showPanel; CSS hides the chrome), so nothing but this gate stops an
    // invisible 60 Hz loop running for a whole set on the visuals thread.
    expect(svc.peekCalls).toBe(peeksBefore);
    expect(v(container.querySelector('[data-testid="meter-0"]'))).toBe(before);
  });

  it("batch render: frozen, holding the last values", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.5;
    const { container } = render(<MeterHost specs={specs} />);
    step(16, 5);
    const before = v(container.querySelector('[data-testid="meter-0"]'));

    act(() => useVizStore.setState({ batchStatus: "running" }));
    const peeksBefore = svc.peekCalls;
    features.bass = 1;
    step(16, 30);
    // batchRunner pauses the live render, so a moving meter would be a lie.
    expect(svc.peekCalls).toBe(peeksBefore);
    expect(v(container.querySelector('[data-testid="meter-0"]'))).toBe(before);

    act(() => useVizStore.setState({ batchStatus: "idle" }));
    step(16, 2);
    expect(Number(v(container.querySelector('[data-testid="meter-0"]')))).toBe(1);
  });

  it("single export: keeps running, because the preview genuinely animates", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.25;
    const { container } = render(<MeterHost specs={specs} />);
    step(16, 2);

    act(() => useVizStore.setState({ exporting: { done: 10, total: 100, speed: 24 } }));
    features.bass = 0.75;
    step(16, 2);
    expect(Number(v(container.querySelector('[data-testid="meter-0"]')))).toBe(0.75);
  });

  it("paused track: holds its last value and writes nothing at all", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.5;
    const { container } = render(<MeterHost specs={specs} />);
    const el = container.querySelector('[data-testid="meter-0"]') as HTMLElement;
    step(16, 2);
    expect(Number(v(el))).toBe(0.5);

    // Pause: the analyzer keeps producing frames but TRACK time stops, and
    // the features settle. 200 frames = 3.2 s of a paused preview.
    const spy = vi.spyOn(el.style, "setProperty");
    step(16, 200, { advanceTrack: false });
    // Zero style writes: the f.time hold skips most ticks outright and the
    // 1/512 quantum gate eats the ~13 that the 250 ms text clock lets through.
    expect(spy).not.toHaveBeenCalled();
    expect(Number(v(el))).toBe(0.5);
    spy.mockRestore();
  });

  it("no track loaded: one write, then a static skeleton", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    const { container } = render(<MeterHost specs={specs} />);
    const el = container.querySelector('[data-testid="meter-0"]') as HTMLElement;
    // features.time stays 0 forever with nothing loaded.
    step(16, 30, { advanceTrack: false });
    expect(Number(v(el))).toBe(0);
  });

  it("analyzer absent (panel tests, browser build before init): no throw, no write", () => {
    const step = fakeRaf();
    svc.analyzer = null;
    const specs: MeterSpec[] = [{ source: "bass" }];
    const { container } = render(<MeterHost specs={specs} />);
    expect(() => step(16, 30)).not.toThrow();
    expect(v(container.querySelector('[data-testid="meter-0"]'))).toBe("");
  });

  it("another page / panel closed: the driver is not mounted, so nothing reads", () => {
    const step = fakeRaf();
    // Elements registered by a card that is still in the tree, but no driver
    // — the shape of "the Modulation SectionDef is filtered out of
    // visibleSections" and of "{showPanel && <ParamsPanel/>}" being false.
    const spec: MeterSpec = { source: "bass" };
    features.bass = 0.5;
    const { container } = render(<div data-testid="meter-0" ref={meterRef(spec)} />);
    step(16, 30);
    expect(svc.peekCalls).toBe(0);
    expect(v(container.querySelector('[data-testid="meter-0"]'))).toBe("");
  });

  it("navigating away / unmounting: reads stop, later frames are inert", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.5;
    const { unmount } = render(<MeterHost specs={specs} />);
    step(16, 5);
    expect(svc.peekCalls).toBeGreaterThan(0);

    unmount();
    const peeksBefore = svc.peekCalls;
    expect(__meterCount()).toBe(0); // the ref cleanup deregistered
    expect(() => step(16, 30)).not.toThrow();
    expect(svc.peekCalls).toBe(peeksBefore);
  });

  it("a re-registered element is repainted rather than left at var(--v, 0)", () => {
    const step = fakeRaf();
    const specs: MeterSpec[] = [{ source: "bass" }];
    features.bass = 0.5;
    const { container, rerender } = render(<MeterHost specs={specs} />);
    step(16, 2);
    const el = container.querySelector('[data-testid="meter-0"]') as HTMLElement;
    expect(Number(v(el))).toBe(0.5);

    // A card re-render rebuilds the inline ref: React runs the cleanup (which
    // removes --v) and registers again. The value has not moved, so WITHOUT
    // the quantum memo also being cleared the element would sit at
    // var(--v, 0) until the audio happened to cross a 1/512 boundary — a
    // permanently empty meter on a held note, with every test green.
    rerender(<MeterHost specs={[{ source: "bass" }]} />);
    expect(v(el)).toBe("");
    step(16, 1);
    expect(Number(v(container.querySelector('[data-testid="meter-0"]')))).toBe(0.5);

    // Same on a PAUSED track, where the f.time hold skips most ticks: the
    // 250 ms text clock lets one through, so the blank lasts at most that.
    rerender(<MeterHost specs={[{ source: "bass" }]} />);
    expect(v(el)).toBe("");
    step(16, 20, { advanceTrack: false });
    expect(Number(v(container.querySelector('[data-testid="meter-0"]')))).toBe(0.5);
  });
});

describe("T19 — structural: the UI cannot become a second evaluator", () => {
  /** Every source file under src/ui, read as TEXT — the ?raw route, because
   *  the app tsconfig deliberately carries no node types and this is the only
   *  test in the repo that needs to look at source rather than behaviour. */
  const UI_SOURCES = Object.entries(
    import.meta.glob("./**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  );

  /** Assembled from fragments so this file does not match its own patterns —
   *  the acceptance criterion is a literal `grep -rn` over src/ui. */
  const EVAL_STATE = "Mod" + "EvalState";
  const LAG_EVAL = "route" + "Value";
  const FORBIDDEN_IN_UI = [EVAL_STATE, "create" + EVAL_STATE, LAG_EVAL];

  it("no file under src/ui names the engine's caller-owned lag state or its evaluator", () => {
    expect(UI_SOURCES.length).toBeGreaterThan(10); // the scan is live
    const hits: string[] = [];
    for (const [path, src] of UI_SOURCES) {
      src.split("\n").forEach((line, i) => {
        for (const token of FORBIDDEN_IN_UI) {
          if (line.includes(token)) hits.push(`${path}:${i + 1}: ${token}`);
        }
      });
    }
    // A UI call through the lag evaluator with the loop's state would advance
    // every lagged route's envelope twice per frame and make the loop see
    // dt === 0 — preview diverging from export DEPENDING ON WHETHER THIS
    // PANEL IS OPEN. This grep is the sharpest single guard in the feature.
    expect(hits).toEqual([]);
  });

  it("keeps the per-route lag evaluator unexported from the engine", () => {
    const engine = modMatrixSource;
    expect(engine).toContain(`function ${LAG_EVAL}(`); // it still exists…
    expect(engine).not.toContain(`export function ${LAG_EVAL}`); // …and stays private
    // The whole engine diff for this feature is the other half of this pair.
    expect(engine).toContain("export function shapedValue(");
  });

  it("imports nothing from the engine but the two pure, stateless functions", () => {
    const clauses: string[] = [];
    for (const [, src] of UI_SOURCES) {
      for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+"[^"]*modMatrix"/g)) {
        clauses.push(m[1]);
      }
    }
    expect(clauses.length).toBeGreaterThan(0); // the scan is live
    for (const clause of clauses) {
      expect(clause).not.toMatch(/\bapplyMods\b|\bapplyPostMods\b/);
    }
  });

  it("is a sink: the driver never writes to the store, prefs or a canvas", () => {
    const src = modMetersSource;
    expect(src).not.toMatch(/\buseState\b|\buseReducer\b|\buseSyncExternalStore\b/);
    expect(src).not.toMatch(/setPrefs|\.setState\(/);
    expect(src).not.toMatch(/canvas|getContext/i);
    // The ONLY permitted store touch is a pull. `useVizStore(` (the hook
    // form) is a subscription and would put the dock back on a hot path.
    expect(src).not.toMatch(/useVizStore\(/);
    expect(src).toContain("useVizStore.getState()");
  });
});
