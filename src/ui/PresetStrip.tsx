import { memo, useEffect, useRef, useState } from "react";
import type { PresetDef } from "../render/types";
import { IconChevronLeft, IconChevronRight } from "./Icons";

/** Horizontal chip strip for one-click preset switching. Always mounted, so
 * it's memoized — it only depends on the preset list / active id / thumbnails,
 * not on playback, and shouldn't reconcile on every position tick. */
export const PresetStrip = memo(function PresetStrip(props: {
  presets: PresetDef[];
  activeId: string;
  /** A beat-quantized switch waiting to land (null = none) — its chip pulses. */
  pendingId?: string | null;
  /** presetId -> PNG data URL; null while thumbnails are still rendering. */
  thumbs: Record<string, string> | null;
  onSwitch: (id: string) => void;
  /** Open the WGSL shader editor. */
  onNewVisual: () => void;
  /**
   * Why the shader editor can't be opened right now (audit F1). Set on the
   * Canvas2D fallback, which has no WGSL pipeline at all: the editor used to
   * open, compile and save a visual that then drew the same spectrum bars as
   * everything else. Undefined on the normal path — the button is unchanged.
   */
  newVisualDisabledReason?: string;
}) {
  const idx = props.presets.findIndex((p) => p.id === props.activeId);
  const step = (d: number) =>
    props.onSwitch(props.presets[(idx + d + props.presets.length) % props.presets.length].id);

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
  }, [props.presets.length, props.thumbs]);

  // Keep the active (or queued) chip visible: switching via keys/MIDI on a
  // narrow window used to move the selection somewhere off-screen with no
  // indication anything happened.
  useEffect(() => {
    const target = props.pendingId ?? props.activeId;
    chipsRef.current
      ?.querySelector(`[data-preset-id="${CSS.escape(target)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [props.activeId, props.pendingId]);

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
        {props.presets.map((p) => {
          const thumb = props.thumbs?.[p.id];
          const queued = p.id === props.pendingId;
          return (
            <button
              key={p.id}
              data-preset-id={p.id}
              className={`chip ${thumb ? "with-thumb" : ""} ${p.id === props.activeId ? "active" : ""} ${queued ? "queued" : ""}`}
              title={
                queued ? `${p.name} — queued for the next boundary` : (p.description ?? p.name)
              }
              aria-busy={queued || undefined}
              onClick={() => props.onSwitch(p.id)}
            >
              {thumb && <img className="chip-thumb" src={thumb} alt="" draggable={false} />}
              <span>{p.name}</span>
            </button>
          );
        })}
        <button
          className="chip chip-new"
          disabled={!!props.newVisualDisabledReason}
          title={
            props.newVisualDisabledReason ?? "Write your own visual in WGSL — the shader editor"
          }
          onClick={props.onNewVisual}
        >
          +
        </button>
      </div>
      <button className="icon-btn subtle" title="Next preset (N)" onClick={() => step(1)}>
        <IconChevronRight size={16} />
      </button>
    </div>
  );
});
