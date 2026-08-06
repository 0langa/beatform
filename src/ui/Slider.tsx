import { useRef } from "react";

/**
 * How long after a press a second press still belongs to the same gesture.
 * Comfortably covers every platform's double-click window, which is all this
 * needs to do: it only decides which press snapshots the pre-gesture value.
 */
const DOUBLE_MS = 500;

/** How far two taps may drift apart and still count as a double-tap (px). */
const TAP_SLOP = 24;

/**
 * Decimal places a number's literal notation carries — 0.005 → 3, 50 → 0.
 * Used to round binary-float drift back out of a computed value (0.1 * 3 is
 * 0.30000000000000004), so a typed value is byte-identical to the one
 * dragging produces for the same thumb position.
 */
export function decimalsOf(n: number): number {
  const s = Math.abs(n).toString();
  // Exponent notation only appears for steps far finer than any control here
  // uses; 10 places is past all of them and still exact for those.
  if (s.includes("e")) return 10;
  return s.split(".")[1]?.length ?? 0;
}

/**
 * The value this slider itself would produce for `v` (which must be finite):
 * clamped into range and snapped onto the min + n * step grid, the same
 * sanitization a native range input applies to its own value. Typed entry
 * goes through this so "0" lands exactly on 0 and a typed number is never
 * one the thumb could not sit on.
 */
export function snapToStep(v: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, v));
  if (!(step > 0)) return clamped;
  // A max that is off the step grid (min 0, max 0.95, step 0.1) has no
  // reachable value AT max — the thumb stops one step below, so typing must
  // stop there too. The epsilon absorbs quotient drift (0.29 / 0.005 comes
  // out as 57.99999999999999, and flooring that would lose a whole step).
  const top = Math.floor((max - min) / step + 1e-9);
  // Round the QUOTIENT through a fixed decimal too. Binary float puts an exact
  // half-step just below .5 — (0.35 - 0.2) / 0.02 is 7.499999999999998 — so a
  // bare Math.round snapped 0.35 DOWN to 0.34 where the native range input,
  // which aligns steps with exact decimal arithmetic, gives 0.36. Typing "35"
  // on a percent row read back 34%.
  const q = Math.round(Number(((clamped - min) / step).toFixed(9)));
  const snapped = min + Math.min(q, top) * step;
  return Number(snapped.toFixed(Math.max(decimalsOf(step), decimalsOf(min))));
}

// ---- Log taper (ParamSpec.taper === "log") --------------------------------
// A native range input is linear in POSITION. For multiplicative ranges
// (frequency edges, zoom/scale factors) that linearity is the defect: on
// nebula's 0.8..6 Scale the whole "big billows" half of the visual range
// (0.8..2) occupies the first fifth of the track. These helpers run the
// input in a normalized 0..1 position domain and map position <-> value
// exponentially, so equal drag distance means equal RATIO. Values stay raw
// everywhere else — documents, mods, MIDI and the ABI never see positions.

/** Value -> normalized position 0..1 for a log-tapered range. min must be > 0. */
export function logPos(v: number, min: number, max: number): number {
  if (!(min > 0) || !(max > min)) return 0;
  const c = Math.min(max, Math.max(min, v));
  return Math.log(c / min) / Math.log(max / min);
}

/** Normalized position 0..1 -> value (unsnapped) for a log-tapered range. */
export function logVal(t: number, min: number, max: number): number {
  if (!(min > 0) || !(max > min)) return min;
  const c = Math.min(1, Math.max(0, t));
  return min * Math.exp(c * Math.log(max / min));
}

/**
 * Effective value grid for a log-tapered slider.
 *
 * The declared `step` was chosen for a LINEAR track. Near a log slider's low
 * end one keyboard notch (the UA moves `step="any"` inputs by 1% of the
 * position range) covers far less value than that step, so snapping to the
 * declared grid would round every press back to where it started — dead
 * arrow keys across the bottom of the range. Refine the grid by powers of
 * ten until the coarsest keyboard notch (at min, where log resolution is
 * finest) always reaches the next value. Ranges whose declared step is
 * already reachable keep it unchanged.
 */
export function taperStep(min: number, max: number, step: number): number {
  if (!(min > 0) || !(max > min) || !(step > 0)) return step;
  const worstNotch = min * Math.log(max / min) * 0.01;
  let s = step;
  while (s > worstNotch && s > 1e-9) s /= 10;
  return s;
}

/**
 * Double-tap detection for touch. Browsers only synthesize `dblclick` from a
 * double-tap when they are sure the gesture is not a zoom, and never on a
 * control that is also a drag target — so without this a touch user would
 * have no way into the numeric editor at all.
 */
export function useDoubleTap(onDoubleTap: () => void): (e: React.PointerEvent) => void {
  const last = useRef({ t: 0, x: 0, y: 0 });
  return (e) => {
    if (e.pointerType === "mouse") return; // the mouse gets a real dblclick
    const now = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    const prev = last.current;
    last.current = now;
    // A pair only counts while it stays in one spot: two taps far apart on a
    // track are two deliberate value changes, not a request to type.
    const near = Math.abs(now.x - prev.x) <= TAP_SLOP && Math.abs(now.y - prev.y) <= TAP_SLOP;
    if (now.t - prev.t > DOUBLE_MS || !near) return;
    last.current = { t: 0, x: 0, y: 0 }; // a third tap must not fire again
    onDoubleTap();
  };
}

/**
 * Styled range slider with a filled track. Fill percentage drives a CSS
 * custom property consumed by App.css.
 */
export function Slider(props: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** "log" runs the track in position space (see logPos/logVal). Values in
   * and out of this component stay raw; only the thumb mapping changes. */
  taper?: "log";
  /**
   * The user asked to type an exact value (double-click / double-tap on the
   * track). The argument is the value the slider held BEFORE the gesture
   * started: the first click of a double-click has already jumped the thumb
   * to the pointer, and opening an editor on that accidental number would
   * defeat the point of asking for one.
   */
  onEditRequest?: (valueBeforeGesture: number) => void;
}) {
  const { min, max, step } = props;
  // A taper on a range that cannot take one (min <= 0) falls back to linear
  // instead of rendering log(0) NaNs.
  const log = props.taper === "log" && min > 0 && max > min;
  const pct = log ? logPos(props.value, min, max) * 100 : ((props.value - min) / (max - min)) * 100;
  const beforeGesture = useRef(props.value);
  const lastDown = useRef(Number.NEGATIVE_INFINITY);
  const requestEdit = () => props.onEditRequest?.(beforeGesture.current);
  const onPointerUp = useDoubleTap(requestEdit);
  return (
    <input
      type="range"
      className={`slider ${props.className ?? ""}`}
      // Log taper: the input runs over normalized POSITION 0..1. step="any"
      // keeps dragging pixel-continuous and leaves keyboard arrows on the
      // UA's 1%-of-range notch; emitted values snap onto the taperStep grid,
      // so what leaves this component is always a clean raw value.
      min={log ? 0 : min}
      max={log ? 1 : max}
      step={log ? "any" : step}
      value={log ? logPos(props.value, min, max) : props.value}
      disabled={props.disabled}
      title={props.title}
      style={{ "--pct": `${Math.max(0, Math.min(100, pct))}%` } as React.CSSProperties}
      onPointerDown={(e) => {
        // Only the first press of a gesture snapshots: by the second press of
        // a double-click the thumb has already moved to the pointer.
        if (e.timeStamp - lastDown.current > DOUBLE_MS) beforeGesture.current = props.value;
        lastDown.current = e.timeStamp;
      }}
      onPointerUp={onPointerUp}
      onDoubleClick={requestEdit}
      onChange={(e) =>
        props.onChange(
          log
            ? snapToStep(
                logVal(Number(e.target.value), min, max),
                min,
                max,
                taperStep(min, max, step),
              )
            : Number(e.target.value),
        )
      }
    />
  );
}
