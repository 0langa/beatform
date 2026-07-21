import { memo } from "react";
import type { LibraryTrack } from "../state/platform";
import { Switch } from "./Switch";
import { IconClose } from "./Icons";

/**
 * Music library sidebar: pick a folder once, get every audio file with its
 * real tags, click to play. Props-only, like every other panel — App.tsx
 * does the wiring.
 */
export interface LibraryPanelProps {
  library: { dir: string; tracks: LibraryTrack[] } | null;
  scanning: boolean;
  activePath: string | null;
  autoAdvance: boolean;
  /** False in browser dev — the scan needs the desktop app. */
  desktop: boolean;
  onPickFolder(): void;
  onPlay(path: string): void;
  onAutoAdvance(v: boolean): void;
  onClose(): void;
}

function fmtDur(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Folder tail — "D:/Music/Beats 2026" renders as "Beats 2026". */
function folderName(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

// Memoized (H13): can hold up to 5,000 track rows; requires every callback
// prop from App.tsx to stay reference-stable (see the useCallback block
// there) or memo does nothing.
export const LibraryPanel = memo(function LibraryPanel(props: LibraryPanelProps) {
  const { library, scanning, activePath } = props;
  return (
    <aside className="chrome library-panel">
      <div className="panel-header">
        <span className="panel-heading">Library</span>
        <button
          className="icon-btn subtle"
          title="Close (Q)"
          aria-label="Close library"
          onClick={props.onClose}
        >
          <IconClose size={16} />
        </button>
      </div>

      <div className="library-toolbar">
        <button
          className="text-btn"
          disabled={scanning || !props.desktop}
          title={props.desktop ? "Scan a folder for audio files" : "Needs the desktop app"}
          onClick={props.onPickFolder}
        >
          {library ? "Change folder…" : "Choose music folder…"}
        </button>
        <span className="inline" title="Play the next track when this one ends">
          <Switch
            checked={props.autoAdvance}
            onChange={props.onAutoAdvance}
            label="Auto-play next"
          />
          Auto-play next
        </span>
      </div>

      {!props.desktop && (
        <p className="section-hint">
          The library scans a folder on disk, so it needs the desktop app. In the browser, drop
          files onto the window instead.
        </p>
      )}

      {scanning && <p className="section-hint">Scanning…</p>}

      {library && !scanning && (
        <>
          <p className="library-dir" title={library.dir}>
            {folderName(library.dir)} — {library.tracks.length} track
            {library.tracks.length === 1 ? "" : "s"}
            {library.tracks.length >= 5000 ? " (showing the first 5000)" : ""}
          </p>
          <div className="library-list">
            {library.tracks.map((t) => (
              <button
                key={t.path}
                className={`library-row ${t.path === activePath ? "active" : ""}`}
                title={t.path}
                onClick={() => props.onPlay(t.path)}
              >
                <span className="library-title">{t.title || t.fileName}</span>
                <span className="library-artist">{t.artist ?? ""}</span>
                <span className="library-dur">{fmtDur(t.durationSec)}</span>
              </button>
            ))}
            {library.tracks.length === 0 && (
              <p className="section-hint">No audio files found in this folder.</p>
            )}
          </div>
        </>
      )}

      {!library && !scanning && props.desktop && (
        <p className="section-hint">
          Pick your music folder once — every track shows up here with its real title and artist,
          one click to play. Finished tracks flow into the next automatically.
        </p>
      )}
    </aside>
  );
});
