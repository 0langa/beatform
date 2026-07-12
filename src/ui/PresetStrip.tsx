import type { PresetDef } from "../render/types";
import { IconChevronLeft, IconChevronRight } from "./Icons";

/** Horizontal chip strip for one-click preset switching. */
export function PresetStrip(props: {
  presets: PresetDef[];
  activeId: string;
  onSwitch: (id: string) => void;
}) {
  const idx = props.presets.findIndex((p) => p.id === props.activeId);
  const step = (d: number) =>
    props.onSwitch(
      props.presets[(idx + d + props.presets.length) % props.presets.length].id,
    );

  return (
    <div className="chrome preset-strip">
      <button className="icon-btn subtle" title="Previous preset ([)" onClick={() => step(-1)}>
        <IconChevronLeft size={16} />
      </button>
      <div className="chips">
        {props.presets.map((p) => (
          <button
            key={p.id}
            data-preset-id={p.id}
            className={`chip ${p.id === props.activeId ? "active" : ""}`}
            onClick={() => props.onSwitch(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <button className="icon-btn subtle" title="Next preset (])" onClick={() => step(1)}>
        <IconChevronRight size={16} />
      </button>
    </div>
  );
}
