import { useEffect } from "react";
import { getLiveStemValues, peekAnalyzer } from "../state/services";
import { shapedValue, sourceValue, type ModCurve, type ModSource } from "../state/modMatrix";
import { useVizStore } from "../state/store";

/**
 * Live source meters for the Modulation page — a pure DOM driver, built on the
 * PerfOverlay contract (src/ui/PerfOverlay.tsx:11-25): the components that own
 * the elements render their skeleton once per DOCUMENT change and never
 * re-render on a tick; one rAF samples every frame but writes only a CSS
 * custom property, never setState. React's reconciler is completely idle
 * between route edits. This is what keeps the v2.80.0/v2.82.0 win — the 4 Hz
 * LUFS tick no longer reconciling ~2,000 lines of dock — from being undone by
 * a 60 Hz meter, silently, with every existing test still green.
 *
 * DETERMINISM: this file may only DISPLAY what the shipping evaluator
 * resolves. It calls the two PURE, STATELESS exports of modMatrix.ts —
 * sourceValue and shapedValue — and nothing else. It never constructs, holds,
 * reads or passes the caller-owned lag memory: the private per-route lag
 * evaluator in modMatrix.ts MUTATES the memo it reads, and the live loop owns
 * exactly one of those (services.ts:315). A UI call through it would advance
 * every lagged route's envelope a second time per frame and change what the
 * renderer draws — preview would diverge from export depending on whether
 * this panel happens to be open. That is why the lag evaluator is not
 * exported from modMatrix.ts and must never be.
 *
 * CONSEQUENCE, stated honestly: the indicator is the RAW source through the
 * CURVE. It is not post-lag. For a route with attack/release it LEADS the
 * render; the card's hint says so. (0 of the 43 routes in the 13 shipped
 * factory themes carry curve or lag, so for shipped content this is
 * bit-exactly the value that enters the multiply.)
 */

export interface MeterSpec {
  source: ModSource;
  /** Route curve; undefined = linear. Display-only. */
  curve?: ModCurve;
  /**
   * Optional numeric readout, written on the 250 ms clock only.
   *
   * The spec object is read LIVE on every tick, not copied at registration —
   * so a card whose readout element attaches after the meter element may
   * simply assign `spec.readout = el` from its own callback ref. Registration
   * order between the two is irrelevant.
   */
  readout?: HTMLElement | null;
}

/** Text cadence — PerfOverlay's TEXT_INTERVAL_MS, same reason: the string
 *  conversions cost multiples of the values behind them. */
const TEXT_INTERVAL_MS = 250;
/** Write quantum. 1/512 is finer than one pixel of a 554 px track (the widest
 *  content column the dock can produce), so an integer compare skips the
 *  string conversion and the style write on any frame that would not move
 *  anything on screen. */
const Q = 512;

/** element -> spec. Module scope so the driver survives every card re-render. */
const meters = new Map<HTMLElement, MeterSpec>();
const lastQ = new WeakMap<HTMLElement, number>();

/**
 * Ref callback for a meter element. React 19 ref cleanups make register /
 * unregister automatic on mount, unmount, card collapse and page change —
 * there is no layout key to go stale, which is the failure mode where
 * expanding a collapsed group leaves permanently dead meters with every test
 * green.
 *
 * CONTRACT: the driver writes `--v` (0..1, three decimals) on this element and
 * NOTHING else — no class, no inline geometry, no text. All geometry is CSS,
 * and both of these are compositor-only, so a tick never lays out or repaints
 * the card:
 *   .mod-meter-fill { transform-origin: left center; transform: scaleX(var(--v,0)); }
 *   .mod-swing-arm  { width: 100%; transform: translateX(calc(var(--v,0) * 100%)); }
 *
 * Callers may build the ref inline: a fresh function per render just
 * re-registers (cleanup, then register), which is correct and costs two Map
 * operations. Memoize it if the card renders often enough to care.
 */
export function meterRef(spec: MeterSpec) {
  return (el: HTMLElement | null) => {
    if (!el) return;
    meters.set(el, spec);
    return () => {
      meters.delete(el);
      // Both halves, or a re-registered element whose value has not moved
      // since would keep its stale quantum and never be written again — a
      // meter stuck at var(--v, 0) after any card re-render on a paused
      // track. (The one addition to the plan's §3b body; strictly a fix.)
      lastQ.delete(el);
      el.style.removeProperty("--v");
    };
  };
}

/** Test seam only — never called by the app. */
export function __meterCount(): number {
  return meters.size;
}

/**
 * The single rAF. Mounted inside the Modulation SectionDef body, so it exists
 * only while that page is displayed. Renders null: it owns no DOM.
 */
export function ModMeterDriver() {
  useEffect(() => {
    // StrictMode double-invokes effects; `let raf = 0` + cancelAnimationFrame
    // is idempotent, exactly as PerfOverlay does it.
    let raf = 0;
    let lastText = -Infinity;
    let lastTime = Number.NaN;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);

      // STAGE MODE. setStageMode(true) does NOT clear showPanel (store.ts:2068);
      // the dock is hidden by `.app.stage-mode .chrome { display: none }`
      // (App.css:233), so the panel stays MOUNTED for the whole performance.
      // A plain pull — no subscription, no commit. If you ever "fix" this
      // into a useVizStore SELECTOR HOOK at a component top level, you have
      // added a 60 Hz-adjacent subscription to the dock; don't. (A test
      // greps this file for the hook call form, so the "fix" fails loudly.)
      const s = useVizStore.getState();
      if (s.stageMode) return;
      // BATCH. batchRunner calls setLiveRenderPaused(true): the preview is
      // frozen, so a moving meter would be the lie. A SINGLE export does NOT
      // pause the loop — the preview genuinely animates, so the meter keeps
      // running; 6-21 compositor writes against an encode is noise.
      if (s.batchStatus === "running") return;

      // peekAnalyzer, never getAnalyzer (services.ts throws when services are
      // down). Null in jsdom, in the browser build before init, and in every
      // panel test — the skeleton just sits still.
      const f = peekAnalyzer()?.features;
      if (!f) return;

      const wantText = t - lastText >= TEXT_INTERVAL_MS;
      // PAUSED: features settle but never stop being written. Holding on an
      // unchanged TRACK time is the same semantics the engine's own lag stage
      // already uses (`if (dt === 0) return memo.value`) and costs one
      // comparison per tick. Keyed off the rAF timestamp `t`, never
      // performance.now(), so a stubbed rAF advances the throttle in tests.
      if (f.time === lastTime && !wantText) return;
      lastTime = f.time;
      if (wantText) lastText = t;

      const stems = getLiveStemValues();
      for (const [el, spec] of meters) {
        const v = shapedValue(spec.curve, sourceValue(f, spec.source, stems));
        const q = v <= 0 ? 0 : v >= 1 ? Q : (v * Q) | 0;
        if (lastQ.get(el) !== q) {
          lastQ.set(el, q);
          el.style.setProperty("--v", (q / Q).toFixed(3));
        }
        if (wantText && spec.readout) spec.readout.textContent = v.toFixed(2);
      }
    };

    raf = requestAnimationFrame(tick);
    // rAF, never setInterval: rAF self-suspends in a hidden window. It must
    // NOT copy the loop's deliberate 300 ms setTimeout starvation fallback
    // (services.ts) — that exists to keep RENDERING alive, and a meter that
    // copied it would be the most expensive thing in a backgrounded app.
    return () => cancelAnimationFrame(raf);
  }, []); // config-only deps: the registry is a Map, not a dependency.

  return null;
}
