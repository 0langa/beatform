import { useEffect, useRef, useState, type ReactNode } from "react";
import { Slider, decimalsOf, snapToStep, useDoubleTap } from "./Slider";
import { Switch } from "./Switch";
import type { ParamSpec } from "../render/types";

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
}) {
  const { min, max, step, value, disabled } = props;
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
    setDraft(editText(from, min, step, scale));
  };

  const commit = (text: string) => {
    // "," is the decimal separator on German keyboards (and what the numpad
    // decimal key emits there); parseFloat would read "0,5" as 0.
    const typed = parseFloat(text.trim().replace(",", "."));
    // Empty or non-numeric keeps the previous value — never write NaN.
    if (!Number.isFinite(typed)) return;
    const next = snapToStep(typed / scale, min, max, step);
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
          {formatValue(props.format, value, step)}
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

/** A ParamSpec-driven row: 0/1 step-1 specs render as a switch, everything
 * else as a slider — the auto-UI behind every preset parameter. */
export function ParamRow(props: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
  onHint: (hint: string | null) => void;
}) {
  const { spec: p, value } = props;
  const isToggle = p.step === 1 && p.min === 0 && p.max === 1;
  return isToggle ? (
    <label className="row toggle-row" {...hintProps(p.hint, props.onHint)}>
      <span className="row-label">{p.label}</span>
      <button
        className={`switch ${value > 0.5 ? "on" : ""}`}
        role="switch"
        aria-checked={value > 0.5}
        aria-label={p.label}
        onClick={() => props.onChange(value > 0.5 ? 0 : 1)}
      >
        <span className="knob" />
      </button>
    </label>
  ) : (
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
}) {
  const parse = props.parse ?? ((raw: string) => raw as T);
  return (
    <label className="field" title={props.hint}>
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

/**
 * Collapsible section shell: a header button toggling its body, with
 * aria-expanded. Uncontrolled by default (open unless told otherwise);
 * pass `open`/`onToggle` to control it (the v2.41 tabbed panel persists
 * per-section state through exactly that pair).
 */
export function CollapsibleSection(props: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** Extra header content (e.g. a Reset button), right-aligned. */
  headerExtra?: ReactNode;
}) {
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? true);
  const open = props.open ?? localOpen;
  const toggle = () => {
    props.onToggle?.(!open);
    if (props.open === undefined) setLocalOpen(!open);
  };
  return (
    <div className="panel-section">
      <div className="section-head">
        <button
          className="section-toggle"
          aria-expanded={open}
          onClick={toggle}
          title={open ? "Collapse" : "Expand"}
        >
          <span className={`section-chevron ${open ? "open" : ""}`}>▸</span>
          {props.title}
        </button>
        {props.headerExtra}
      </div>
      {open && props.children}
    </div>
  );
}
