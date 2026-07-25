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
  const snapped = min + Math.min(Math.round((clamped - min) / step), top) * step;
  return Number(snapped.toFixed(Math.max(decimalsOf(step), decimalsOf(min))));
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
  /**
   * The user asked to type an exact value (double-click / double-tap on the
   * track). The argument is the value the slider held BEFORE the gesture
   * started: the first click of a double-click has already jumped the thumb
   * to the pointer, and opening an editor on that accidental number would
   * defeat the point of asking for one.
   */
  onEditRequest?: (valueBeforeGesture: number) => void;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  const beforeGesture = useRef(props.value);
  const lastDown = useRef(Number.NEGATIVE_INFINITY);
  const requestEdit = () => props.onEditRequest?.(beforeGesture.current);
  const onPointerUp = useDoubleTap(requestEdit);
  return (
    <input
      type="range"
      className={`slider ${props.className ?? ""}`}
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
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
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  );
}
