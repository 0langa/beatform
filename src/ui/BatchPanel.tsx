import { useEffect, useMemo, useRef, useState } from "react";
import type { BatchTrack } from "../state/batch";
import { runStats } from "../state/batch";
import { EXPORT_RUNNING_REASON } from "../state/slices/batchActions";
import { NO_HARDWARE_RENDERING_CLAUSE } from "../state/exportConfig";
import { RESOLUTIONS, useVizStore } from "../state/store";
import { useFocusTrap } from "./useFocusTrap";

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

/**
 * Batch render panel — a table of tracks with editable, tag-filled titles.
 *
 * The product is "drop 20 MP3s in, get 20 titled videos out", so the surface is
 * the tracks and their titles; the job queue underneath is implementation.
 *
 * Store-direct (P-12 wave 2). Two things about the subscriptions below carry
 * their weight:
 *
 *  - `formatLabel` is derived HERE, from `exportSettings.resIdx`. Deriving it
 *    in App was the sole reason App subscribed to the whole `exportSettings`
 *    object, so every codec/bitrate/fps edit in the export dialog re-rendered
 *    the entire shell. `resIdx` is a number, so this panel only hears about
 *    the one field the label is made of.
 *  - `exporting` is selected as a BOOLEAN. The raw field is rewritten once per
 *    encoded frame — and a running batch mirrors its own progress into it
 *    (batchActions.onJobUpdate) — so selecting the object would put this panel
 *    on the encoder's frame rate to answer a yes/no question.
 *
 * NOT memo()d: with zero props memo can never bail on anything.
 */
export function BatchPanel() {
  const run = useVizStore((s) => s.batch);
  const status = useVizStore((s) => s.batchStatus);
  /** Files still being tag-scanned (0 = idle) — the scan takes seconds/file. */
  const scanning = useVizStore((s) => s.batchScanning);
  /** Batch refusal messages (SS-3) — they used to go to exportError, which
   * only ExportDialog renders, so a refused Start looked like a dead click. */
  const batchError = useVizStore((s) => s.batchError);
  /** Document layers, for the pre-flight checks. */
  const overlayLayers = useVizStore((s) => s.overlayLayers);
  const aspect = useVizStore((s) => s.aspect);
  const formatLabel = useVizStore((s) => RESOLUTIONS[s.exportSettings.resIdx].label);
  /** True while a SINGLE export is running: Start disables with the same
   * sentence the store guard would answer with (F2 — one shared reason). */
  const exporting = useVizStore((s) => !!s.exporting);
  /**
   * True while the Canvas2D fallback is drawing (audit F2). Every job builds
   * its own WebGPU device, so on that path a 20-track queue used to fail 20
   * times — one full decode + analysis each — instead of saying so once, up
   * front, before the output folder was even chosen.
   */
  const simplifiedRenderer = useVizStore((s) => s.simplifiedRenderer);
  const store = useVizStore.getState;

  // Not a pre-flight WARNING (those advise and let you proceed) — these are
  // hard blocks, so they disable Start rather than sitting above it. The
  // running-export reason is the exact sentence startBatch would refuse with;
  // status !== "running" because a running BATCH mirrors itself into
  // `exporting` (see batchActions.onJobUpdate) and must not self-block.
  const blocked = simplifiedRenderer
    ? `Batch render ${NO_HARDWARE_RENDERING_CLAUSE} — every job would fail after decoding its track`
    : exporting && status !== "running"
      ? EXPORT_RUNNING_REASON
      : null;
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
    <div className="modal-backdrop" onClick={() => !running && store().setShowBatch(false)}>
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
            onClick={() => store().setShowBatch(false)}
            disabled={running}
            title={running ? "Stop the queue first" : "Close"}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {tracks.length === 0 && scanning === 0 && (
          <p className="section-hint">
            Drop in a folder of tracks and render one video per track, unattended. Titles come from
            each file's own tags — no spreadsheet, no retyping. Everything else (preset, layers,
            timeline, post) is whatever you have set up right now.
          </p>
        )}

        {scanning > 0 && (
          <p className="section-hint">
            Reading tags… {scanning} file{scanning === 1 ? "" : "s"} left. Titles and durations
            appear when the scan finishes.
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
                if (files.length) void store().addBatchTracks(files);
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
                <button
                  className="text-btn"
                  disabled={!!blocked}
                  title={blocked ?? undefined}
                  onClick={() => void store().retryFailedBatch()}
                >
                  {stats.failed > 0 && stats.queued > 0
                    ? `Retry ${stats.failed} failed + resume ${stats.queued} queued`
                    : stats.failed > 0
                      ? `Retry ${stats.failed} failed`
                      : `Resume ${stats.queued} queued`}
                </button>
              )}
              {/* Without this the panel is a dead end — the only way to run a
                  second batch was to restart the app. */}
              <button className="text-btn" onClick={() => store().dismissBatch()}>
                New batch
              </button>
            </span>
          </div>
        )}

        {blocked && <div className="toast-inline error">{blocked}</div>}

        {/* Refusals from startBatch/retryFailedBatch (SS-3) — shown where the
            click happened. Skipped when `blocked` already states the same
            condition, so the panel never nags twice in a row. */}
        {batchError && batchError !== blocked && (
          <div className="toast-inline error">{batchError}</div>
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
                    onChange={(e) => store().setBatchTrackMeta(t.id, { title: e.target.value })}
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
                      onClick={() => store().removeBatchTrack(t.id)}
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
          <button
            className="btn-primary wide"
            disabled={!!blocked}
            title={blocked ?? undefined}
            onClick={() => void store().startBatch()}
          >
            Render {tracks.length} video{tracks.length === 1 ? "" : "s"}…
          </button>
        )}
        {running && (
          <div className="save-look-row">
            <button className="text-btn" onClick={() => store().skipCurrentBatchJob()}>
              Skip this track
            </button>
            <button className="text-btn danger" onClick={() => store().cancelBatch()}>
              Stop queue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
