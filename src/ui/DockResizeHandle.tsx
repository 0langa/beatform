/**
 * The pointer-capture resize-drag idiom shared by App.tsx's two dock
 * handles (Library, Visuals) — extracted (E2-U1) so both get the SAME
 * capture-phase Escape handling ModulationPage.tsx's `startRouteDrag`
 * (ModulationPage.tsx:478-541) already uses, instead of each hand-rolling
 * its own copy, and so the fix is unit-testable without mounting all of
 * App.tsx (which pulls in the store, audio engine and canvas wiring — see
 * useAppShortcuts.test.tsx's own comment: "no existing suite does").
 *
 * Deliberately a CONTROLLED component: `value` is the last COMMITTED
 * number (what Escape reverts to), `onDrag` fires on every live
 * pointermove, `onCommit` fires exactly once on a real release
 * (pointerup/pointercancel), and `onCancel` fires exactly once when
 * Escape cancels mid-drag. Library and Visuals want different "cancel"
 * semantics (Library restores the exact pre-drag width; Visuals just
 * clears its drag-ephemeral `visualsDragW` back to null, per App.tsx's own
 * two-value comment) — passing the captured pre-drag value INTO onCancel
 * lets each caller decide rather than baking one interpretation in here.
 */
interface DockResizeHandleProps {
  className: string;
  ariaLabel: string;
  title: string;
  /** The value from BEFORE any live drag — captured once at pointerdown as
   *  what Escape should revert to. For Library this is the same number as
   *  `ariaValueNow`; for Visuals it is the committed `visualsW`, distinct
   *  from the drag-ephemeral `ariaValueNow` (`visualsDragW ?? visualsW`). */
  value: number;
  ariaValueNow: number;
  min: number;
  max: number;
  /** Raw pointer event -> clamped candidate value for this handle's axis. */
  compute: (ev: PointerEvent) => number;
  /** Called on every pointermove with the live candidate value. */
  onDrag: (value: number) => void;
  /** Called once, on pointerup/pointercancel ONLY — never on an
   *  Escape-cancelled drag — with the final value. The one place a caller
   *  should persist (e.g. setPrefs). */
  onCommit: (value: number) => void;
  /** Called once when Escape cancels mid-drag, with the pre-drag `value`
   *  this drag started from. Never followed by onCommit for the same
   *  gesture. */
  onCancel: (startValue: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function DockResizeHandle(props: DockResizeHandleProps) {
  const { compute, onDrag, onCommit, onCancel, value } = props;

  // Plain closure, recreated every render (matching ModulationPage's
  // startRouteDrag — no useCallback): `startValue` below must read
  // whatever `value` this component was passed AT THE MOMENT pointerdown
  // fires, not a stale one pinned by an empty dependency array.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startValue = value;
    // null, not 0 (the previous inline App.tsx code's sentinel): a
    // pointerdown/pointerup with zero pointermoves between them (a plain
    // click) must skip onCommit entirely, and 0 is a valid clamped output
    // for some axes where a sentinel would be ambiguous.
    let latest: number | null = null;

    const onMove = (ev: PointerEvent) => {
      latest = compute(ev);
      onDrag(latest);
    };
    const onUp = () => end(true);
    // CAPTURE phase, and stopPropagation on the way in (E2-U1, mirroring
    // ModulationPage.tsx:498-510's "Capture always reaches window before
    // bubble does"): useAppShortcuts is mounted at App root on `window`,
    // BUBBLE phase, and its own Escape branch unconditionally unmounts
    // THIS handle (setShowLibrary(false) / setShowPanel(false)). Per the
    // Pointer Events spec, removing a captured element implicitly releases
    // capture and fires `lostpointercapture` — never `pointerup` — so
    // without this, the drag's only persist path (onCommit, called from
    // onUp) would never run and the width silently would not stick.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      end(false);
    };
    // Hoisted function declaration: onUp/onKey above reference `end` by
    // name before this line runs, which is fine — neither is actually
    // CALLED until the browser dispatches a real event, by which point
    // this whole synchronous body has long since finished (same reasoning
    // as ModulationPage.tsx's startRouteDrag).
    function end(commit: boolean) {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      el.releasePointerCapture(e.pointerId);
      if (commit) {
        if (latest !== null) onCommit(latest);
      } else {
        // Cancel semantic (E2-U1, decided here): Escape REVERTS to the
        // pre-drag value rather than committing wherever the pointer last
        // landed — the same "nothing happened" contract Escape already
        // gives every other drag in this app (ModulationPage's route
        // reorder resolves zero mutation, zero history entry on cancel).
        onCancel(startValue);
      }
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    // pointercancel commits the same as pointerup (audit U7, preserved by
    // this extraction): a cancelled gesture (window drag-out, pen palm
    // rejection) still persists whatever width was last reached — only a
    // deliberate Escape reverts.
    el.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
  };

  return (
    <div
      className={props.className}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.ariaLabel}
      aria-valuenow={props.ariaValueNow}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      tabIndex={0}
      title={props.title}
      onPointerDown={onPointerDown}
      onKeyDown={props.onKeyDown}
    />
  );
}
