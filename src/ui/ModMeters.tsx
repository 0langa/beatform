import { useEffect } from "react";
import { getLiveRouteValues, getLiveStemValues, peekAnalyzer } from "../state/services";
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
 * resolves, never a second opinion of its own. Two read-only sources feed it:
 *   - sourceValue and shapedValue, modMatrix.ts's two PURE, STATELESS
 *     exports, for the raw-source-through-curve INSTANT value; and
 *   - getLiveRouteValues() (services.ts), a published Map the live loop
 *     fills, once per frame, strictly AFTER its own applyMods/applyPostMods
 *     calls, with each route's resolved POST-LAG value (H9's published-slot
 *     contract) — see MeterSpec.routeId below.
 * It never constructs, holds, reads or passes the caller-owned lag memory
 * itself: the private per-route lag evaluator in modMatrix.ts MUTATES the
 * memo it reads, and the live loop owns exactly one of those (services.ts,
 * inside its frame loop). A UI call through it would advance every lagged
 * route's envelope a second time per frame and change what the renderer
 * draws — preview would diverge from export depending on whether this panel
 * happens to be open. That is why the lag evaluator is not exported from
 * modMatrix.ts and must never be; getLiveRouteValues() only ever hands back
 * a plain number the loop already finished computing for its own render.
 *
 * CONSEQUENCE: a MeterSpec with no routeId — every source chip, and a route
 * diamond whose route has no attack/release — shows the RAW source through
 * the CURVE, computed right here. That is bit-exact with what the loop
 * actually used, by construction: a lag-less route's own resolution IS that
 * same expression. A MeterSpec whose routeId DOES have an entry in
 * getLiveRouteValues() this frame (a route with attack/release, currently
 * part of the frame being rendered) shows that value instead — the exact
 * post-lag number the render used, copied out, never re-derived. Should the
 * published Map have nothing for it this frame (the route belongs to a
 * preset that is not the one currently active), it falls back to the same
 * instant expression as any other meter. (0 of the 43 routes in the 13
 * shipped factory themes carry curve or lag, so for shipped content every
 * meter takes the instant path and the two are indistinguishable.)
 */

export interface MeterSpec {
  source: ModSource;
  /** Route curve; undefined = linear. Display-only. */
  curve?: ModCurve;
  /**
   * H9 — set only for a route-meter whose route carries attack/release. When
   * present, the tick prefers getLiveRouteValues().get(routeId) over the
   * instant curve value, for exactly the frames where the loop published an
   * entry for it; otherwise (unset, or the id is not in the Map this frame)
   * the meter computes the same raw-source-through-curve value every other
   * meter does. A lag-less route should leave this unset: its instant value
   * already equals its resolved one, so there is nothing the indirection
   * would change — see the file header.
   */
  routeId?: string;
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
      const publishedRoutes = getLiveRouteValues();
      for (const [el, spec] of meters) {
        // H9: routeId is set only for a lag-carrying route (see MeterSpec);
        // `published` is undefined whenever it's unset OR the loop did not
        // publish an entry for it this frame, and `??` falls through to the
        // same instant expression every other meter uses. Never `||`: a
        // published 0 (a route parked at its floor) must not be discarded.
        const published = spec.routeId ? publishedRoutes.get(spec.routeId) : undefined;
        const v = published ?? shapedValue(spec.curve, sourceValue(f, spec.source, stems));
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
