import type { PresetDef } from "../render/types";
import { IconChevronLeft, IconChevronRight } from "./Icons";

/** Horizontal chip strip for one-click preset switching. */
export function PresetStrip(props: {
  presets: PresetDef[];
  activeId: string;
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
          return (
            <button
              key={p.id}
              data-preset-id={p.id}
              className={`chip ${thumb ? "with-thumb" : ""} ${p.id === props.activeId ? "active" : ""}`}
              title={p.description ?? p.name}
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
}
