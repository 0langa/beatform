import type { DemoDef } from "../audio/demoTrack";
import { IconDrop, IconFolder, IconGallery, IconPlay } from "./Icons";

/**
 * Centered onboarding hero shown until a track is loaded.
 *
 * Three paths for someone who HAS a file (drop it, browse for it, or take a
 * demo instead) and, since P-3, one for someone who does not: the Gallery is
 * the shortest route from a cold start to something worth looking at, because
 * a theme brings a whole look with it and the demos supply the audio. It sits
 * last and at chip weight — the file paths are still the point of the screen.
 */
export function EmptyState(props: {
  demos: DemoDef[];
  onOpenFile: () => void;
  onDemo: (id: string) => void;
  onGallery: () => void;
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
        <div className="empty-divider">
          <span>or start from the Gallery</span>
        </div>
        <button
          className="chip gallery-chip"
          title="Community looks and themes — pair one with a demo above"
          onClick={props.onGallery}
        >
          <IconGallery size={13} />
          Browse looks and themes
        </button>
      </div>
    </div>
  );
}
