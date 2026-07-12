import type { DemoDef } from "../audio/demoTrack";
import { IconDrop, IconFolder, IconPlay } from "./Icons";

/** Centered onboarding hero shown until a track is loaded. */
export function EmptyState(props: {
  demos: DemoDef[];
  onOpenFile: () => void;
  onDemo: (id: string) => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-icon">
          <IconDrop size={40} />
        </div>
        <h1 className="empty-title">Drop an audio file anywhere</h1>
        <p className="empty-sub">mp3 · flac · wav · ogg · m4a</p>
        <button className="btn-primary" onClick={props.onOpenFile}>
          <IconFolder size={16} />
          Browse files
        </button>
        <div className="empty-divider">
          <span>or try a demo</span>
        </div>
        <div className="empty-demos">
          {props.demos.map((d) => (
            <button key={d.id} className="chip demo-chip" onClick={() => props.onDemo(d.id)}>
              <IconPlay size={12} />
              {d.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
