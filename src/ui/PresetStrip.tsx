import { memo } from "react";
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
}) {
  const idx = props.presets.findIndex((p) => p.id === props.activeId);
  const step = (d: number) =>
    props.onSwitch(props.presets[(idx + d + props.presets.length) % props.presets.length].id);

  return (
    <div className="chrome preset-strip">
      <button className="icon-btn subtle" title="Previous preset ([)" onClick={() => step(-1)}>
        <IconChevronLeft size={16} />
      </button>
      <div className="chips">
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
          title="Write your own visual in WGSL — the shader editor"
          onClick={props.onNewVisual}
        >
          +
        </button>
      </div>
      <button className="icon-btn subtle" title="Next preset (])" onClick={() => step(1)}>
        <IconChevronRight size={16} />
      </button>
    </div>
  );
});
