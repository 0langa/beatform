import { useRef, useState } from "react";
import type { PresetDef } from "../render/types";
import { movePresetOrder } from "../state/presetOrder";

/**
 * Reorder the mode strip. Props-only (the BuilderPanel/LayersPanel idiom):
 * every gesture hands a brand-new id list to onChange and the store owns the
 * persisting.
 *
 * Lives in App settings rather than on the strip itself. Dragging chips
 * directly would put a drag gesture on top of the strip's existing click-to-
 * switch and wheel-to-scroll — mis-grabbing a chip mid-set would switch the
 * live visual, which is the one thing the strip must never do by accident.
 * Reordering is also a set-it-once task, so it belongs on the page you open
 * on purpose, not in the always-visible chrome.
 *
 * Two ways to move a row, deliberately: drag for speed, ▲▼ for precision and
 * for anyone on a keyboard (a drag-only list is unusable without a mouse).
 */
export interface PresetOrderEditorProps {
  /** Current display order, as built-in preset ids. */
  order: readonly string[];
  /** id -> def, for names. Ids with no def are skipped, never rendered blank. */
  byId: ReadonlyMap<string, PresetDef>;
  /** id -> PNG data URL; null while thumbnails are still rendering. */
  thumbs: Record<string, string> | null;
  onChange: (ids: string[]) => void;
  onReset: () => void;
  /** Whether `order` already is the shipped one (Reset would do nothing). */
  isDefault: boolean;
}

export function PresetOrderEditor(props: PresetOrderEditorProps) {
  const { order } = props;
  /**
   * The row being dragged, in a ref rather than in state. A React state value
   * read inside onDrop is whatever the LAST RENDER captured, so the drop only
   * knows its own source if a re-render happened in between — true for a
   * human drag (many frames), false the moment anything drives the sequence
   * in one turn, which is precisely how this silently did nothing at all.
   */
  const from = useRef<number | null>(null);
  /** Drop-indicator only. Local state: a drag in progress is not a preference,
   * and routing it through the store would re-render the app on every tick. */
  const [hint, setHint] = useState<{ from: number; over: number } | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    props.onChange(movePresetOrder(order, from, to));
  };

  return (
    <>
      <p className="section-hint">
        The left-to-right order of the mode strip. Drag a row, or use ▲▼. The first nine also answer
        to the number keys 1-9.
      </p>
      <ol className="mode-order" onDragOver={(e) => e.preventDefault()}>
        {order.map((id, i) => {
          const def = props.byId.get(id);
          if (!def) return null;
          const thumb = props.thumbs?.[id];
          return (
            <li
              key={id}
              className={`mode-order-row ${hint?.from === i ? "dragging" : ""} ${
                hint && hint.over === i && hint.from !== i
                  ? hint.from < i
                    ? "drop-after"
                    : "drop-before"
                  : ""
              }`}
              draggable
              onDragStart={(e) => {
                from.current = i;
                setHint({ from: i, over: i });
                e.dataTransfer.effectAllowed = "move";
                // Firefox refuses to start a drag at all without payload.
                e.dataTransfer.setData("text/plain", id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setHint((h) => (h && h.over === i ? h : { from: from.current ?? i, over: i }));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (from.current !== null) move(from.current, i);
                from.current = null;
                setHint(null);
              }}
              onDragEnd={() => {
                from.current = null;
                setHint(null);
              }}
            >
              <span className="mode-order-index" aria-hidden="true">
                {i + 1}
              </span>
              <span className="mode-order-grip" aria-hidden="true" title="Drag to reorder">
                ⠿
              </span>
              {thumb ? (
                <img className="mode-order-thumb" src={thumb} alt="" draggable={false} />
              ) : (
                <span className="mode-order-thumb placeholder" />
              )}
              <span className="mode-order-name">{def.name}</span>
              <button
                className="chip-x"
                title="Move earlier"
                aria-label={`Move ${def.name} earlier`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                ▲
              </button>
              <button
                className="chip-x"
                title="Move later"
                aria-label={`Move ${def.name} later`}
                disabled={i === order.length - 1}
                onClick={() => move(i, i + 1)}
              >
                ▼
              </button>
            </li>
          );
        })}
      </ol>
      <div className="save-look-row">
        <button
          className="ghost-btn"
          disabled={props.isDefault}
          title={
            props.isDefault
              ? "The strip is already in its default order"
              : "Put every mode back in the order beatform ships with"
          }
          onClick={props.onReset}
        >
          Restore default order
        </button>
      </div>
    </>
  );
}
