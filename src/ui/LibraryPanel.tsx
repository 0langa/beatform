import { isTauri } from "../state/platform";
import { useVizStore } from "../state/store";
import { Switch } from "./Switch";
import { IconClose } from "./Icons";

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

/**
 * Music library sidebar: pick a folder once, get every audio file with its
 * real tags, click to play.
 *
 * Store-direct (P-12 wave 2): it can hold up to 5,000 track rows, and before
 * the migration it was memo()d with four callback props whose identities App
 * had to keep still or the memo did nothing. It now subscribes the four slices
 * it renders and calls the actions at the click site. NOT memo()d: with zero
 * props memo can never bail on anything.
 */
export function LibraryPanel() {
  const library = useVizStore((s) => s.library);
  const scanning = useVizStore((s) => s.libraryScanning);
  const activePath = useVizStore((s) => s.libraryActivePath);
  const autoAdvance = useVizStore((s) => s.libraryAutoAdvance);
  const store = useVizStore.getState;
  // False in browser dev — the scan needs the desktop app. The env probe
  // reads fine in the body (LyricsGenPanel/ParamsPanel precedent); tests mock
  // the module rather than injecting a boolean.
  const desktop = isTauri();

  return (
    <aside className="chrome library-panel">
      <div className="panel-header">
        <span className="panel-heading">Library</span>
        <button
          className="icon-btn subtle"
          title="Close (Q)"
          aria-label="Close library"
          onClick={() => store().setShowLibrary(false)}
        >
          <IconClose size={16} />
        </button>
      </div>

      <div className="library-toolbar">
        <button
          className="text-btn"
          disabled={scanning || !desktop}
          title={desktop ? "Scan a folder for audio files" : "Needs the desktop app"}
          onClick={() => void store().pickLibraryFolder()}
        >
          {library ? "Change folder…" : "Choose music folder…"}
        </button>
        <span className="inline" title="Play the next track when this one ends">
          <Switch
            checked={autoAdvance}
            onChange={(v) => store().setLibraryAutoAdvance(v)}
            label="Auto-play next"
          />
          Auto-play next
        </span>
      </div>

      {!desktop && (
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
                onClick={() => void store().playLibraryTrack(t.path)}
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

      {!library && !scanning && desktop && (
        <p className="section-hint">
          Pick your music folder once — every track shows up here with its real title and artist,
          one click to play. Finished tracks flow into the next automatically.
        </p>
      )}
    </aside>
  );
}
