import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Focus trap for a modal dialog (H17): moves focus into the dialog when it
 * opens, cycles Tab/Shift+Tab among its own focusable descendants so Tab
 * can't escape to whatever's behind the backdrop, and restores focus to
 * whatever had it before the dialog opened once it closes.
 *
 * Attach the returned ref to the dialog's outer element (give it
 * `tabIndex={-1}` so it can receive focus itself when the dialog has no
 * focusable children). `active` is the same boolean that gates whether the
 * dialog renders — pass it unconditionally, the effect no-ops until the ref
 * is attached and `active` is true.
 */
export function useFocusTrap(active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Initial focus: the first focusable control, or the dialog itself (a
    // dialog with nothing focusable — a compile-error list, say — still
    // needs to own focus so Escape/Tab don't leak to the page behind it).
    const first = focusables()[0];
    (first ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === firstEl || !container.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !container.contains(active)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Guard: the element that had focus before could itself be gone by now
      // (e.g. the button that opened this dialog got removed elsewhere).
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return containerRef;
}
