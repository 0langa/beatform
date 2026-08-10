import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orderedPresets } from "../state/presetOrder";
import { useVizStore } from "../state/store";
import { IconChevronLeft, IconChevronRight } from "./Icons";

/**
 * Why the shader editor can't be opened on the Canvas2D fallback (audit F1),
 * which has no WGSL pipeline at all: the editor used to open, compile and save
 * a visual that then drew the same spectrum bars as everything else.
 */
const NEW_VISUAL_BLOCKED =
  "The shader editor needs hardware rendering (WebGPU), which isn't available on this system";

/**
 * Horizontal chip strip for one-click preset switching.
 *
 * Store-direct (P-12 wave 2): always mounted, so before the migration it was
 * memo()d and relied on App holding six prop identities still across every
 * playback tick. It now subscribes the five slices it renders from, which is
 * the same set — enforced by the store instead of by a `useCallback` block.
 * NOT memo()d: with zero props memo can never bail on anything.
 *
 * Clicking a chip goes through `queuePreset`, so it obeys the beat-quantize
 * takeover rather than switching mid-bar.
 */
export function PresetStrip() {
  const activeId = useVizStore((s) => s.presetId);
  /** A beat-quantized switch waiting to land (null = none) — its chip pulses. */
  const pendingId = useVizStore((s) => s.pendingPresetId);
  /** presetId -> PNG data URL; null while thumbnails are still rendering. */
  const thumbs = useVizStore((s) => s.presetThumbs);
  const presetOrder = useVizStore((s) => s.presetOrder);
  const customDefs = useVizStore((s) => s.customDefs);
  const simplifiedRenderer = useVizStore((s) => s.simplifiedRenderer);
  const store = useVizStore.getState;

  // A DERIVATION THAT ALLOCATES: two selections + useMemo, never a selector —
  // `orderedPresets(...)` inside one would hand useSyncExternalStore a fresh
  // array on every store notification ("Maximum update depth exceeded" on
  // mount, i.e. a white screen).
  const presets = useMemo(() => orderedPresets(presetOrder, customDefs), [presetOrder, customDefs]);
  const newVisualDisabledReason = simplifiedRenderer ? NEW_VISUAL_BLOCKED : undefined;

  const idx = presets.findIndex((p) => p.id === activeId);
  const step = (d: number) =>
    store().queuePreset(presets[(idx + d + presets.length) % presets.length].id);

  const chipsRef = useRef<HTMLDivElement>(null);
  // On narrow windows the strip overflows and scrolls, but the scrollbar is
  // hidden by design — these edge-fade flags are the visual cue that more
  // modes exist beyond the fold (each side fades only while there IS content
  // hidden on that side).
  const [fadeL, setFadeL] = useState(false);
  const [fadeR, setFadeR] = useState(false);
  useEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const update = () => {
      setFadeL(el.scrollLeft > 4);
      setFadeR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [presets.length, thumbs]);

  // THE strip's one scroller. Everything that moves the selection — a click, a
  // MIDI pad, P/N, the digits, the arrow keys below — routes here rather than
  // scrolling for itself, because two scroll authorities on one container is
  // how you get a smooth animation fighting an instant jump.
  const revealChip = useCallback((id: string) => {
    chipsRef.current
      ?.querySelector(`[data-preset-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, []);

  // Keep the active (or queued) chip visible: switching via keys/MIDI on a
  // narrow window used to move the selection somewhere off-screen with no
  // indication anything happened.
  useEffect(() => {
    revealChip(pendingId ?? activeId);
  }, [activeId, pendingId, revealChip]);

  /**
   * The chip that owns the strip's single tab stop — the queued switch if one
   * is in flight, else the active mode, else the first chip.
   *
   * The fallback is not theoretical: `presetId` can be a HIDDEN built-in (the
   * classic `builder`, kept resolvable forever for old projects) that the strip
   * does not list, and a roving tabindex with no `0` in it removes the whole
   * strip from the tab order.
   */
  const focusTarget = pendingId ?? activeId;
  const tabId = (presets.find((p) => p.id === focusTarget) ?? presets[0])?.id;

  /**
   * Roving tabindex with follow-focus arrows — the model `ParamsPanel`'s rail
   * already uses, deliberately not a second one. The strip is ONE tab stop,
   * arrows move AND switch (wrapping at both ends), Home/End jump to the
   * first/last mode.
   *
   * Two differences from the rail, both forced by where the strip lives:
   *
   *  - the strip is horizontal, so the axis is Left/Right rather than Up/Down;
   *  - ← and → are GLOBAL shortcuts (seek ±5 s) and a focused `<button>` is not
   *    one of the tags `useAppShortcuts` exempts, so without stopPropagation
   *    every arrow press would also seek the track. `preventDefault` alone is
   *    not enough — it stops the browser scrolling `.chips`, not the window
   *    listener above us.
   *
   * `preventScroll` for the same single-scroller reason as `revealChip`: the
   * browser's own focus scroll is instant and ancestor-wide, and it would land
   * on top of the smooth scroll the switch is about to trigger.
   */
  const onChipKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End")
      return;
    e.preventDefault();
    e.stopPropagation();
    // Read the buttons from the DOM, like the rail does: the `+` chip shares
    // the container, carries no `data-preset-id`, and must never be an arrow
    // target — it is its own tab stop, exactly as the rail's search item is.
    const items = chipsRef.current
      ? [...chipsRef.current.querySelectorAll<HTMLButtonElement>("button.chip[data-preset-id]")]
      : [];
    if (items.length === 0) return;
    const here = items.indexOf(e.currentTarget);
    const at =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : e.key === "ArrowRight"
            ? (here + 1 + items.length) % items.length
            : (here - 1 + items.length) % items.length;
    const next = items[at];
    const id = next.dataset.presetId;
    if (!id) return;
    next.focus({ preventScroll: true });
    store().queuePreset(id);
    // Exactly ONE reveal per keypress. Moving to a different mode writes the
    // store and the effect above does it; Home/End can land on the mode that is
    // already selected, which changes no field and so re-runs no effect — that
    // case, and only that case, reveals here.
    if (id === focusTarget) revealChip(id);
  };

  return (
    <div className="chrome preset-strip">
      <button className="icon-btn subtle" title="Previous preset (P)" onClick={() => step(-1)}>
        <IconChevronLeft size={16} />
      </button>
      <div
        ref={chipsRef}
        className={`chips ${fadeL ? "fade-l" : ""} ${fadeR ? "fade-r" : ""}`}
        onWheel={(e) => {
          // The strip is the only horizontal scroller under the cursor here —
          // translate the (vertical) wheel so hidden modes are one scroll away.
          if (e.deltaY !== 0 && chipsRef.current) chipsRef.current.scrollLeft += e.deltaY;
        }}
      >
        {presets.map((p) => {
          const thumb = thumbs?.[p.id];
          const queued = p.id === pendingId;
          return (
            <button
              key={p.id}
              data-preset-id={p.id}
              className={`chip ${thumb ? "with-thumb" : ""} ${p.id === activeId ? "active" : ""} ${queued ? "queued" : ""}`}
              title={
                queued ? `${p.name} — queued for the next boundary` : (p.description ?? p.name)
              }
              // Same reasoning as the rail: NOT role="tab". These switch what
              // the canvas draws, and aria-current is the honest word for
              // "this is the one you are on" without renaming the button.
              aria-current={p.id === activeId ? "true" : undefined}
              aria-busy={queued || undefined}
              tabIndex={p.id === tabId ? 0 : -1}
              onKeyDown={onChipKeyDown}
              onClick={() => store().queuePreset(p.id)}
            >
              {thumb && <img className="chip-thumb" src={thumb} alt="" draggable={false} />}
              <span>{p.name}</span>
            </button>
          );
        })}
        <button
          className="chip chip-new"
          disabled={!!newVisualDisabledReason}
          title={newVisualDisabledReason ?? "Write your own visual in WGSL — the shader editor"}
          onClick={() => store().setShowShaderEditor(true)}
        >
          +
        </button>
      </div>
      <button className="icon-btn subtle" title="Next preset (N)" onClick={() => step(1)}>
        <IconChevronRight size={16} />
      </button>
    </div>
  );
}
