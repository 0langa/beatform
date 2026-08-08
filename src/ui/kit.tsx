import { useEffect, useRef, useState, type ReactNode } from "react";
import { Slider, decimalsOf, snapToStep, taperStep, useDoubleTap } from "./Slider";
import { Switch } from "./Switch";
import type { AngleParamSpec, EnumParamSpec, ParamSpec } from "../render/types";

/**
 * The shared control kit. Every settings surface builds rows from these —
 * one toggle idiom, one slider row, one segmented control — instead of the
 * three hand-rolled variants that had accumulated (ParamsPanel's private
 * rows, LayersPanel's private slider, `.segmented` markup duplicated five
 * times across ParamsPanel/ExportDialog).
 *
 * All components are plain function components taking value + onChange —
 * safe inside memoized panels as long as callers keep handlers stable
 * (the H13 discipline).
 */

/** Pointer + keyboard hint wiring for a row (H17: focus mirrors hover). */
function hintProps(hint: string | undefined, onHint?: (h: string | null) => void) {
  return {
    title: hint,
    onPointerEnter: () => onHint?.(hint ?? null),
    onPointerLeave: () => onHint?.(null),
    onFocus: () => onHint?.(hint ?? null),
    onBlur: () => onHint?.(null),
  };
}

/**
 * Why a row is unavailable right now. Its PRESENCE is what disables the
 * control, and it replaces the row's hover hint — so a control cannot be
 * switched off without telling the user what would switch it back on.
 *
 * That coupling is the point (audit F1): the Canvas2D fallback accepted and
 * silently discarded Post / Motion / Builder input, and a plain `disabled`
 * flag would only have downgraded that from a lie to a mystery.
 */
type DisabledReason = { disabledReason?: string };

/** Labelled switch row. */
export function ToggleRow(
  props: {
    label: string;
    hint?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    onHint?: (hint: string | null) => void;
  } & DisabledReason,
) {
  const off = !!props.disabledReason;
  return (
    <label
      className={`row toggle-row ${off ? "is-unavailable" : ""}`}
      {...hintProps(props.disabledReason ?? props.hint, props.onHint)}
    >
      <span className="row-label">{props.label}</span>
      <Switch
        checked={props.checked}
        onChange={props.onChange}
        label={props.label}
        disabled={off}
      />
    </label>
  );
}

/**
 * A readout printed in a unit the value is NOT stored in — "150%" for a 1.5,
 * "18.0 kHz" for an 18000. Unlike a bare format function this is invertible,
 * which the numeric editor needs: a row reading "100%" has to accept the 100
 * the user sees, not the 1 it stores.
 */
export interface ValueUnit {
  /** Multiplier from the slider's own units to the shown ones. */
  scale: number;
  /** Suffix printed after the number ("%", " Hz", "s"). */
  unit: string;
  /** Decimals shown. Defaults to whatever `step` needs in display units. */
  decimals?: number;
}

/** How a row prints its value: a display-only function, or an invertible unit. */
export type ValueFormat = ((v: number) => string) | ValueUnit;

/** The app's percent masters (rotation, pulse, detail, contrast, …). */
export const PERCENT: ValueUnit = { scale: 100, unit: "%" };
/** Hue and other angles, stored in degrees already. */
export const DEGREES: ValueUnit = { scale: 1, unit: "°" };
/** Frequency edges, stored in Hz. */
export const HERTZ: ValueUnit = { scale: 1, unit: " Hz" };
/** Durations stored in seconds. */
export const SECONDS: ValueUnit = { scale: 1, unit: " s" };

/** Display-unit multiplier — 1 for plain and display-only formats. */
function unitScale(format: ValueFormat | undefined): number {
  return format && typeof format !== "function" ? format.scale : 1;
}

/**
 * The readout string. Without a format this is the kit's long-standing
 * default (2 dp for fractional steps, integers otherwise) — every row printed
 * that before units existed, so the default must keep printing it.
 */
export function formatValue(format: ValueFormat | undefined, v: number, step: number): string {
  if (!format) return v.toFixed(step < 1 ? 2 : 0);
  if (typeof format === "function") return format(v);
  const d = format.decimals ?? decimalsOf(step * format.scale);
  return `${(v * format.scale).toFixed(d)}${format.unit}`;
}

/**
 * Text the editor opens with: the value in the unit the readout shows, at the
 * precision `step` can actually reach. The readout's OWN rounding is
 * deliberately not reused — a row that prints 2 dp for a 0.005 step would
 * seed a number that commits as a different value.
 */
function editText(v: number, min: number, step: number, scale: number): string {
  const d = Math.max(decimalsOf(step * scale), decimalsOf(min * scale));
  return String(Number((v * scale).toFixed(d)));
}

/**
 * Slider plus its numeric readout, where the readout is also a text field:
 * double-click (or double-tap) either half — or focus the readout and press
 * Enter/F2 — to type an exact value. Dragging a 200-step slider lands *next*
 * to 0 but almost never ON it, which is the report this answers.
 *
 * Renders exactly the two elements it always did (slider + `.row-value`), so
 * it drops into a `.param-row` grid or a flex row unchanged. The edit state
 * is local on purpose: in the store it would re-render every panel on each
 * keystroke, and it has no business in a saved project either.
 */
export function SliderField(props: {
  /** Accessible name for the editor — the row's label. */
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: ValueFormat;
  hint?: string;
  disabled?: boolean;
  /** Extra class on the range input — the hue row repaints its track with it. */
  trackClass?: string;
  /** Display-side log taper (ParamSpec.taper) — forwarded to the slider, and
   * typed entry snaps onto the same refined grid dragging produces. */
  taper?: "log";
}) {
  const { min, max, step, value, disabled } = props;
  // The one value grid this row can produce, by any input method. A log
  // taper refines the declared step (see taperStep); everything else keeps it.
  const gridStep = props.taper === "log" ? taperStep(min, max, step) : step;
  const scale = unitScale(props.format);
  /** `null` = not editing; any string = the in-progress text. */
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement>(null);
  const readoutRef = useRef<HTMLButtonElement>(null);
  // Enter/Escape close the editor themselves, so the blur that follows must
  // not commit a second time (or at all, after Escape) — and the keyboard
  // wants its place in the tab order back.
  const closedByKey = useRef(false);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      // Select on open so the first keystroke replaces the value: the point
      // is typing "0", not backspacing your way to it.
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      readoutRef.current?.focus();
    }
  }, [editing]);

  const open = (from: number) => {
    if (disabled) return;
    closedByKey.current = false;
    // Opening must not change anything, and a double-click's first press has
    // already dragged the thumb to the pointer — put that back.
    if (from !== value) props.onChange(from);
    setDraft(editText(from, min, gridStep, scale));
  };

  const commit = (text: string) => {
    // "," is the decimal separator on German keyboards (and what the numpad
    // decimal key emits there); parseFloat would read "0,5" as 0.
    const typed = parseFloat(text.trim().replace(",", "."));
    // Empty or non-numeric keeps the previous value — never write NaN.
    if (!Number.isFinite(typed)) return;
    const next = snapToStep(typed / scale, min, max, gridStep);
    // Same setter the drag path uses, so a typed value and a dragged one are
    // indistinguishable downstream.
    if (next !== value) props.onChange(next);
  };

  const onReadoutTap = useDoubleTap(() => open(value));

  return (
    <>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className={props.trackClass}
        taper={props.taper}
        onChange={props.onChange}
        onEditRequest={open}
      />
      {editing ? (
        <input
          ref={inputRef}
          // Not type="number": no spinner arrows in a 44px column, and the
          // parsing (comma decimals, clamping, step snapping) is ours.
          type="text"
          inputMode="decimal"
          className="row-value row-value-input"
          aria-label={props.label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              closedByKey.current = true;
              restoreFocus.current = true;
              commit(e.currentTarget.value);
              setDraft(null);
            } else if (e.key === "Escape") {
              // The app-level Escape handler closes the whole panel and runs
              // BEFORE its own text-entry guard, so this one stops here.
              e.preventDefault();
              e.stopPropagation();
              closedByKey.current = true;
              restoreFocus.current = true;
              setDraft(null);
            }
          }}
          onBlur={(e) => {
            if (!closedByKey.current) commit(e.currentTarget.value);
            setDraft(null);
          }}
        />
      ) : (
        <button
          ref={readoutRef}
          type="button"
          className="row-value"
          disabled={disabled}
          // A disabled readout must not advertise an affordance it no longer
          // has — "double-click to type a value" on a control that ignores
          // both is the same class of lie this row's disabling exists to fix.
          title={
            disabled
              ? props.hint
              : props.hint
                ? `${props.hint} — double-click to type a value`
                : "Double-click to type a value"
          }
          onDoubleClick={() => open(value)}
          onPointerUp={onReadoutTap}
          onKeyDown={(e) => {
            // Enter/F2 is the spreadsheet idiom, Space is what a button owes
            // its user — and Space has to stop here, because the global map
            // reads it as play/pause.
            if (e.key !== "Enter" && e.key !== "F2" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            open(value);
          }}
        >
          {formatValue(props.format, value, gridStep)}
        </button>
      )}
    </>
  );
}

/** Labelled slider row with a numeric readout. */
export function SliderRow(
  props: {
    label: string;
    hint?: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
    format?: ValueFormat;
    onHint?: (hint: string | null) => void;
  } & DisabledReason,
) {
  const reason = props.disabledReason;
  return (
    <label
      className={`row param-row ${reason ? "is-unavailable" : ""}`}
      {...hintProps(reason ?? props.hint, props.onHint)}
    >
      <span className="row-label">{props.label}</span>
      <SliderField
        label={props.label}
        hint={reason ?? props.hint}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={props.onChange}
        format={props.format}
        disabled={!!reason}
      />
    </label>
  );
}

/**
 * A dropdown row for an `enum` param.
 *
 * The stored value is still the plain number the shader reads, so a saved
 * project written before this control existed selects the right option with
 * no migration. A value that matches NO option (a hand-edited project, a
 * range that shrank) gets its own transient option rather than silently
 * snapping the select to the first entry and writing that back on the next
 * unrelated edit.
 */
export function EnumRow(props: {
  spec: EnumParamSpec;
  value: number;
  onChange: (v: number) => void;
  onHint?: (hint: string | null) => void;
}) {
  const { spec, value } = props;
  const known = spec.options.some((o) => o.value === value);
  const active = spec.options.find((o) => o.value === value);
  return (
    <label
      className="row select-row"
      {...hintProps(active?.hint ?? spec.hint, props.onHint)}
      // A <label> around a <select> already labels it; the aria-label on the
      // select itself is what the row's accessible name is read from in tests
      // and by screen readers when the label text is visually truncated.
    >
      <span className="row-label">{spec.label}</span>
      <select
        className="select"
        aria-label={spec.label}
        value={String(value)}
        onChange={(e) => props.onChange(Number(e.target.value))}
      >
        {!known && <option value={String(value)}>{`Custom (${value})`}</option>}
        {spec.options.map((o) => (
          <option key={o.value} value={String(o.value)} title={o.hint}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A dial for an angle param, drawn as the direction it actually points.
 *
 * Deliberately NOT focusable: it sits beside the same param's real slider,
 * which owns the keyboard (arrows, Home/End) and the accessible name. A second
 * focusable control for one value would double every tab stop in the panel and
 * announce the setting twice.
 */
function Dial(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    // Screen y grows downward; negate it so the dial's maths match the
    // shaders', where these degrees are added to an atan2 (0 = right, angle
    // increases counter-clockwise).
    const deg =
      (Math.atan2(-(e.clientY - box.top - box.height / 2), e.clientX - box.left - box.width / 2) *
        180) /
      Math.PI;
    props.onChange(snapToStep(deg < 0 ? deg + 360 : deg, props.min, props.max, props.step));
  };
  return (
    <div
      ref={ref}
      className="dial"
      title={props.title}
      aria-hidden="true"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e);
      }}
    >
      <span
        className="dial-needle"
        // The needle hangs DOWNWARD from the dial's centre (transform-origin
        // is its top edge), so pointing it at `value` is one rotation:
        // CSS rotates clockwise, screen-down is -90° in the shaders' y-up
        // convention, hence -90 - value. A translate() cannot do this job —
        // percentages there resolve against the NEEDLE's own 2x9 box, not the
        // dial's radius, which is how the first attempt moved it 2px.
        style={{ transform: `rotate(${-90 - props.value}deg)` }}
      />
    </div>
  );
}

/** Angle row: the dial for pointing, the slider for nudging, one value. */
export function AngleRow(props: {
  spec: AngleParamSpec;
  value: number;
  onChange: (v: number) => void;
  onHint?: (hint: string | null) => void;
}) {
  const { spec, value } = props;
  return (
    <label className="row angle-row" {...hintProps(spec.hint, props.onHint)}>
      <span className="row-label">{spec.label}</span>
      <Dial
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={props.onChange}
        title={`${spec.label} — drag to point`}
      />
      <SliderField
        label={spec.label}
        hint={spec.hint}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={props.onChange}
        format={DEGREES}
      />
    </label>
  );
}

/**
 * A ParamSpec-driven row — the auto-UI behind every preset parameter.
 *
 * The `switch` is exhaustive against the ParamSpec union (see the `never` in
 * the default arm), so adding a control type to the model is a compile error
 * here until it has a widget. That is the whole point of making ParamSpec a
 * discriminated union: the old single "is it 0..1 step 1?" heuristic silently
 * rendered every discrete choice — symmetry counts, image fit, kaleidoscope
 * segments — as a slider you had to hunt values on.
 */
export function ParamRow(props: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
  onHint: (hint: string | null) => void;
}) {
  const { spec: p, value } = props;
  switch (p.control) {
    case "toggle":
      return (
        <ToggleRow
          label={p.label}
          hint={p.hint}
          checked={value > 0.5}
          onChange={(on) => props.onChange(on ? 1 : 0)}
          onHint={props.onHint}
        />
      );
    case "enum":
      return <EnumRow spec={p} value={value} onChange={props.onChange} onHint={props.onHint} />;
    case "angle":
      return <AngleRow spec={p} value={value} onChange={props.onChange} onHint={props.onHint} />;
    case "hue":
    case "slider":
    case undefined:
      // A 0..1 step-1 numeric spec is a boolean that predates the toggle
      // control. Custom shaders built in the in-app editor still declare them
      // that way (the editor only writes min/max/step/default), so the legacy
      // reading has to survive the model change or every user shader with an
      // on/off knob would regress to a two-position slider.
      if (p.control === undefined && p.min === 0 && p.max === 1 && p.step === 1) {
        return (
          <ToggleRow
            label={p.label}
            hint={p.hint}
            checked={value > 0.5}
            onChange={(on) => props.onChange(on ? 1 : 0)}
            onHint={props.onHint}
          />
        );
      }
      return (
        <label className="row param-row" {...hintProps(p.hint, props.onHint)}>
          <span className="row-label">{p.label}</span>
          <SliderField
            label={p.label}
            hint={p.hint}
            min={p.min}
            max={p.max}
            step={p.step}
            value={value}
            onChange={props.onChange}
            format={p.control === "hue" ? DEGREES : undefined}
            trackClass={p.control === "hue" ? "hue" : undefined}
            taper={p.taper}
          />
        </label>
      );
    default: {
      const unhandled: never = p;
      return unhandled;
    }
  }
}

/** Labelled colour swatch row — the one colour idiom outside the background
 * picker (which additionally carries its chroma-key presets). */
export function ColorRow(props: {
  label: string;
  hint?: string;
  value: string;
  onChange: (hex: string) => void;
  onHint?: (hint: string | null) => void;
}) {
  return (
    <label className="row color-field-row" {...hintProps(props.hint, props.onHint)}>
      <span className="row-label">{props.label}</span>
      <input
        type="color"
        className="bg-color"
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

/** Labelled native select row. */
export function SelectRow<T extends string | number>(props: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  parse?: (raw: string) => T;
  /** Footer-hint sink, so a dropdown explains itself like every slider row. */
  onHint?: (hint: string | null) => void;
}) {
  const parse = props.parse ?? ((raw: string) => raw as T);
  return (
    <label className="field" {...hintProps(props.hint, props.onHint)}>
      <span>{props.label}</span>
      <select
        className="select"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(parse(e.target.value))}
      >
        {props.options.map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Tooltip AND footer-hint text (via the onHint prop). */
  hint?: string;
  disabled?: boolean;
}

/** Segmented control — one active choice out of a small row of buttons. */
export function Segmented<T extends string | number>(props: {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (v: T) => void;
  /** Disables every segment (e.g. while an export runs). */
  disabled?: boolean;
  ariaLabel?: string;
  /** Footer-hint sink (panels route this to their hint bar). */
  onHint?: (hint: string | null) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          className={`segment ${props.value === o.value ? "active" : ""}`}
          disabled={props.disabled || o.disabled}
          aria-pressed={props.value === o.value}
          {...hintProps(o.hint, props.onHint)}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* CollapsibleSection lived here until P-1. The Visuals section rail is
 * now the one navigation model, so a section no longer collapses — its single
 * production call site became ParamsPanel's local PageSection, and the
 * component, its CSS and its two tests went with it. */
