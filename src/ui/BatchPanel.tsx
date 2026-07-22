import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { BatchRun, BatchTrack } from "../state/batch";
import { runStats } from "../state/batch";
import type { OverlayLayer } from "../render/overlay";
import { useFocusTrap } from "./useFocusTrap";

/**
 * Batch render panel — a table of tracks with editable, tag-filled titles.
 *
 * The product is "drop 20 MP3s in, get 20 titled videos out", so the surface is
 * the tracks and their titles; the job queue underneath is implementation.
 * Props-only, like every other component here — App.tsx does the wiring.
 */

export interface BatchPanelProps {
  run: BatchRun | null;
  status: "idle" | "running" | "done";
  /** Files still being tag-scanned (0 = idle) — the scan takes seconds/file. */
  scanning: number;
  /** Document layers, for the pre-flight checks. */
  overlayLayers: OverlayLayer[];
  aspect: string;
  formatLabel: string;
  onAddTracks(files: File[]): void;
  onRemoveTrack(id: string): void;
  onRetitle(id: string, title: string): void;
  onStart(): void;
  onSkipJob(): void;
  onCancel(): void;
  onRetryFailed(): void;
  /** Clear the finished run so another batch can be set up. */
  onNewBatch(): void;
  onClose(): void;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * "2h 14m left · finishes ~5:20 AM".
 *
 * Both halves earn their place: "2h 14m" makes you do arithmetic, "5:20 AM"
 * just answers the question you actually had at midnight.
 */
function fmtEta(ms: number | null, now: number): string {
  if (ms == null) return "estimating…";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const left = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  const at = new Date(now + ms);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${left} · finishes ~${time}`;
}

// Memoized (H13): requires every callback prop from App.tsx to stay
// reference-stable (see the useCallback block there) or memo does nothing.
export const BatchPanel = memo(function BatchPanel(props: BatchPanelProps) {
  const { run, status, overlayLayers, aspect, formatLabel } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const tracks = run?.tracks ?? [];
  const running = status === "running";
  // This component only exists in the tree while the panel is open, so its
  // own mount IS "dialog opened" — no separate `active` flag needed (H17).
  const dialogRef = useFocusTrap(true);

  // A clock, not a render-time Date.now(): reading the time during render is
  // impure, and a memo keyed only on `run` would freeze the countdown between
  // job updates — which on a 40-minute track is a very stale "left".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const stats = useMemo(() => (run && run.jobs.length > 0 ? runStats(run, now) : null), [run, now]);

  // Pre-flight checks. Catching the 11pm mistake beats explaining the 3am
  // result — but warn, never block: it is the user's call.
  const warnings: string[] = [];
  if (tracks.length > 0 && status === "idle") {
    const usesTitle = overlayLayers.some((l) => l.type === "text" && l.text.includes("{title}"));
    if (!usesTitle) {
      warnings.push(
        "Titles from tags won't appear — no text layer uses {title}. Add one in Layers, or the videos will all look the same.",
      );
    }
    if (overlayLayers.some((l) => l.type === "image")) {
      warnings.push(
        "An image layer shows the same art on every video. For per-track cover art, use a preset with a Cover option (e.g. Bass Circle).",
      );
    }
    const untagged = tracks.filter((t) => !t.metaFromTags).length;
    if (untagged > 0) {
      warnings.push(
        `${untagged} of ${tracks.length} track${tracks.length === 1 ? "" : "s"} ${
          untagged === 1 ? "has" : "have"
        } no title tag — the filename was used. Edit any title below.`,
      );
    }
  }

  const jobFor = (t: BatchTrack) => run?.jobs.find((j) => j.trackId === t.id);

  return (
    <div className="modal-backdrop" onClick={() => !running && props.onClose()}>
      <div
        ref={dialogRef}
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Batch render"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span className="panel-heading">Batch render</span>
          <button
            className="icon-btn subtle"
            onClick={props.onClose}
            disabled={running}
            title={running ? "Stop the queue first" : "Close"}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {tracks.length === 0 && props.scanning === 0 && (
          <p className="section-hint">
            Drop in a folder of tracks and render one video per track, unattended. Titles come from
            each file's own tags — no spreadsheet, no retyping. Everything else (preset, layers,
            timeline, post) is whatever you have set up right now.
          </p>
        )}

        {props.scanning > 0 && (
          <p className="section-hint">
            Reading tags… {props.scanning} file{props.scanning === 1 ? "" : "s"} left. Titles and
            durations appear when the scan finishes.
          </p>
        )}

        {status === "idle" && (
          <div className="save-look-row">
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) props.onAddTracks(files);
                // Reset so re-picking the same file fires onChange again.
                e.target.value = "";
              }}
            />
            <button className="text-btn" onClick={() => fileInput.current?.click()}>
              + Add tracks…
            </button>
            {tracks.length > 0 && (
              <span className="section-hint" style={{ margin: 0 }}>
                {tracks.length} track{tracks.length === 1 ? "" : "s"} → {formatLabel} · {aspect}
              </span>
            )}
          </div>
        )}

        {running && stats && (
          <>
            <div className="export-status">
              <span>
                {stats.done + stats.failed} of {stats.total}
              </span>
              <span>{fmtEta(stats.etaMs, now)}</span>
            </div>
            <div className="progress">
              <div
                className="progress-fill"
                style={{
                  width: `${stats.framesTotal > 0 ? (stats.framesDone / stats.framesTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </>
        )}

        {status === "done" && stats && (
          <div className="export-status">
            <span>
              {stats.done} done
              {stats.failed > 0 ? ` · ${stats.failed} failed` : ""}
              {stats.skipped > 0 ? ` · ${stats.skipped} skipped` : ""}
            </span>
            <span className="save-look-row" style={{ margin: 0 }}>
              {(stats.failed > 0 || stats.queued > 0) && (
                <button className="text-btn" onClick={props.onRetryFailed}>
                  {stats.failed > 0 && stats.queued > 0
                    ? `Retry ${stats.failed} failed + resume ${stats.queued} queued`
                    : stats.failed > 0
                      ? `Retry ${stats.failed} failed`
                      : `Resume ${stats.queued} queued`}
                </button>
              )}
              {/* Without this the panel is a dead end — the only way to run a
                  second batch was to restart the app. */}
              <button className="text-btn" onClick={props.onNewBatch}>
                New batch
              </button>
            </span>
          </div>
        )}

        {warnings.map((w) => (
          <p className="section-hint" key={w}>
            {w}
          </p>
        ))}

        <div className="batch-list">
          {tracks.map((t) => {
            const job = jobFor(t);
            const st = job?.status;
            return (
              <div className="layer-row-wrap" key={t.id}>
                <div className="layer-row">
                  <input
                    className="look-name-input"
                    value={t.meta.title}
                    // Editable while idle or after a run (so a failed track can
                    // be retitled and retried), locked only while rendering.
                    disabled={running}
                    // Filename-guessed titles read dim + italic, so the three
                    // that need fixing are obvious at a glance among twenty.
                    style={t.metaFromTags ? undefined : { fontStyle: "italic", opacity: 0.65 }}
                    title={t.file.name}
                    onChange={(e) => props.onRetitle(t.id, e.target.value)}
                  />
                  <span className="batch-meta">{fmtDuration(t.duration)}</span>
                  {st?.k === "done" && <span className="renderer-badge ok">done</span>}
                  {st?.k === "failed" && (
                    <span className="renderer-badge danger" title={st.message}>
                      {st.kind}
                    </span>
                  )}
                  {st?.k === "skipped" && <span className="batch-meta">skipped</span>}
                  {st?.k === "running" && (
                    <span className="batch-meta">
                      {st.total > 0 ? Math.round((st.done / st.total) * 100) : 0}%
                      {st.fps ? ` · ${Math.round(st.fps)} fps` : ""}
                    </span>
                  )}
                  {status === "idle" && (
                    <button
                      className="chip-x"
                      onClick={() => props.onRemoveTrack(t.id)}
                      aria-label={`Remove ${t.meta.title}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {st?.k === "running" && (
                  <div className="progress" style={{ marginTop: 4 }}>
                    <div
                      className="progress-fill"
                      style={{ width: `${st.total > 0 ? (st.done / st.total) * 100 : 0}%` }}
                    />
                  </div>
                )}
                {st?.k === "failed" && <p className="section-hint">{st.message}</p>}
              </div>
            );
          })}
        </div>

        {status === "idle" && tracks.length > 0 && (
          <button className="btn-primary wide" onClick={props.onStart}>
            Render {tracks.length} video{tracks.length === 1 ? "" : "s"}…
          </button>
        )}
        {running && (
          <div className="save-look-row">
            <button className="text-btn" onClick={props.onSkipJob}>
              Skip this track
            </button>
            <button className="text-btn danger" onClick={props.onCancel}>
              Stop queue
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
