import {
  autoBitrateMbps,
  LOUDNESS_PRESETS,
  RESOLUTIONS,
  resolutionsForAspect,
  SIMPLIFIED_EXPORT_REASON,
  useVizStore,
} from "../state/store";
import { exportCodecOptions, exportFormatOptions, type ExportOption } from "../state/exportConfig";
import { BG_TRANSPARENT } from "../render/types";
import { isTauri, showInFolder } from "../state/platform";
import { Slider } from "./Slider";
import { Switch } from "./Switch";
import { useFocusTrap } from "./useFocusTrap";
import { IconClose, IconExport } from "./Icons";
import { Segmented } from "./kit";

/**
 * P-8 — the capability map. Every format and every codec is listed always;
 * the ones this machine or this mode cannot produce are dimmed and print the
 * one-line reason, so the dialog answers "why can't I pick that?" instead of
 * silently omitting the row.
 *
 * ACCESSIBILITY, and why there are two kinds of "off" here:
 *
 *  - `disabled` (real, out of the tab order) is used ONLY for `frozen` — an
 *    export is running and the whole form is inert. There is nothing to read
 *    there that the progress bar beside it does not already say.
 *  - `aria-disabled` is used for an unavailable CHOICE, and the tile stays a
 *    real tab stop. The reason is the entire payload of this feature; a bare
 *    `disabled` attribute would take the one control carrying it out of the
 *    tab order, which is how you turn a lie into a mystery. So the reason
 *    travels three routes: visible text in the tile, the pointer tooltip,
 *    and the accessible name.
 *
 * The accessible name is set EXPLICITLY rather than left to name-from-content,
 * which was measured wrong in the live app: with only content + `title`, one
 * engine named the four ffmpeg tiles "Needs the desktop app — it runs the
 * bundled ffmpeg" (four buttons, one name, no way to tell ProRes from GIF) and
 * announced the transparent-WebM codec as "transparent WebM overlay"; the other
 * ran the two spans together as "ProResNeeds the desktop app…". An aria-label
 * outranks both, and starting it with the visible label keeps WCAG 2.5.3
 * (label in name) satisfied.
 *
 * Re-selecting the active tile is a no-op rather than a same-value write:
 * in canvas mode the Codec group displays the H.264 the export will actually
 * use, and dispatching that would quietly overwrite the codec the user picked
 * for their Video exports.
 */
function CapabilityGrid<T extends string>(props: {
  label: string;
  /** DOM id stem — the group's label is wired to the grid with it. */
  name: string;
  options: ExportOption<T>[];
  value: T;
  /** An export is running: freeze the whole group. */
  frozen: boolean;
  onChange: (v: T) => void;
}) {
  const labelId = `${props.name}-label`;
  return (
    <div className="field-block">
      <span className="field-block-label" id={labelId}>
        {props.label}
      </span>
      <div className="capability-grid" role="group" aria-labelledby={labelId}>
        {props.options.map((o) => {
          const off = o.reason !== null;
          const active = props.value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              className={`capability-tile${active ? " active" : ""}${off ? " is-unavailable" : ""}`}
              disabled={props.frozen}
              aria-disabled={off || undefined}
              aria-pressed={active}
              aria-label={`${o.label} — ${o.reason ?? o.hint}`}
              title={o.reason ?? o.hint}
              onClick={() => {
                if (off || active) return;
                props.onChange(o.id);
              }}
            >
              <span className="capability-name">{o.label}</span>
              {off && <span className="capability-reason">{o.reason}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Export modal, extracted whole from App.tsx (it was ~330 lines and five
 * subscriptions inside the app shell). Subscribes to the store directly —
 * it is an app-level modal, not a memoized leaf panel, so the props-only
 * rule for panels deliberately does not apply. The caller gates mounting on
 * `showExport`, so every subscription here costs nothing while closed.
 */
export function ExportDialog() {
  const exportSettings = useVizStore((s) => s.exportSettings);
  const exporting = useVizStore((s) => s.exporting);
  // E2-U5: runExport claims shared.exportStarting synchronously, well
  // before `exporting` itself is set — the native save dialog and the
  // disk pre-flight (with its own "Low disk space?" confirm) both run in
  // that gap. exportPreparing is the reactive mirror of that claim, so the
  // dialog's own dismissal gate below covers the WHOLE run, not just the
  // encode phase.
  const exportPreparing = useVizStore((s) => s.exportPreparing);
  const exportError = useVizStore((s) => s.exportError);
  const exportDone = useVizStore((s) => s.exportDone);
  const exportDonePath = useVizStore((s) => s.exportDonePath);
  const aspect = useVizStore((s) => s.aspect);
  const bg = useVizStore((s) => s.bg);
  const codecSupport = useVizStore((s) => s.codecSupport);
  const duration = useVizStore((s) => s.playback.duration);
  const simplifiedRenderer = useVizStore((s) => s.simplifiedRenderer);
  const store = useVizStore.getState;

  const dialogRef = useFocusTrap(true);

  const canvasMode = exportSettings.mode === "canvas";
  // Built in the render body, never inside a selector: these allocate, and an
  // allocating zustand selector is "Maximum update depth exceeded" on mount.
  const caps = { canvasMode, desktop: isTauri(), codecSupport };
  const formatOptions = exportFormatOptions(caps);
  const codecOptions = exportCodecOptions(caps);
  // What the export will ACTUALLY encode with: runExport pins canvas loops to
  // H.264 regardless of the stored codec, so every sentence below (and the
  // Codec group's active tile) has to read this, not exportSettings.codec.
  const effCodec = canvasMode ? "h264" : exportSettings.codec;
  // Formats whose file carries an alpha channel at all. Only these can be
  // let down by an opaque background — and only these can promise anything.
  const keepsAlpha =
    exportSettings.format === "png" ||
    exportSettings.format === "prores" ||
    exportSettings.format === "webp" ||
    (exportSettings.format === "mp4" && effCodec === "vp9a");
  const res = canvasMode ? { w: 1080, h: 1920 } : RESOLUTIONS[exportSettings.resIdx];
  const effFps = canvasMode ? 30 : exportSettings.fps;
  const effectiveMbps = exportSettings.autoRate
    ? autoBitrateMbps(res.w, res.h, effFps)
    : exportSettings.manualMbps;
  const canvasMaxStart = Math.max(0, duration - exportSettings.canvasDuration);
  const exportPct = exporting
    ? Math.round((exporting.done / Math.max(1, exporting.total)) * 100)
    : 0;
  const exportSpeed = exporting?.speed != null ? exporting.speed.toFixed(0) : null;
  // Both dismissal paths gate on this (E2-U5) — a run that hasn't reached
  // `exporting` yet is still a run, and closing the dialog on it must not
  // orphan the save dialog / disk pre-flight / its own "Low disk space?"
  // confirm still in flight underneath.
  const dismissBlocked = !!exporting || exportPreparing;

  return (
    <div className="modal-backdrop" onClick={() => !dismissBlocked && store().setShowExport(false)}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export video"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span className="panel-heading">Export video</span>
          <button
            className="icon-btn subtle"
            disabled={dismissBlocked}
            aria-label="Close"
            title={exporting ? "Export in progress…" : exportPreparing ? "Preparing export…" : "Close"}
            onClick={() => store().setShowExport(false)}
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="field">
          <span>Type</span>
          <Segmented
            value={exportSettings.mode}
            disabled={!!exporting}
            ariaLabel="Export type"
            onChange={(mode) => store().setExportSettings({ mode })}
            options={[
              { value: "video", label: "Video", hint: "Export the whole track as a video" },
              {
                value: "canvas",
                label: "Canvas loop",
                hint: "3-8 s seamless loop at 1080×1920 — Spotify Canvas spec",
              },
            ]}
          />
        </div>

        <CapabilityGrid
          label="Format"
          name="export-format"
          options={formatOptions}
          value={exportSettings.format}
          frozen={!!exporting}
          onChange={(format) => store().setExportSettings({ format })}
        />

        {exportSettings.format === "png" && (
          <p className="section-hint">
            Writes numbered PNG frames into a folder you pick — no audio track. Set Background to{" "}
            <strong>Transparent</strong> to keep alpha for compositing.
          </p>
        )}

        {exportSettings.format === "prores" && (
          <p className="section-hint">
            ProRes 4444 (.mov) with alpha + untouched PCM audio — the editorial mezzanine. Set
            Background to <strong>Transparent</strong> to keep alpha. Encoded by the bundled ffmpeg
            (LGPL). Files are large by design.
          </p>
        )}

        {exportSettings.format === "av1-10" && (
          <p className="section-hint">
            Genuine 10-bit AV1 (.mp4) — every frame reaches the encoder at 10-bit depth, for grading
            and mastering where 8-bit banding matters. Software-encoded by the bundled ffmpeg
            (LGPL), so it works on any machine — and is slower and larger than H.264. No alpha: a
            Transparent background encodes as black.
          </p>
        )}

        {(exportSettings.format === "gif" || exportSettings.format === "webp") && (
          <p className="section-hint">
            Animated {exportSettings.format === "gif" ? "GIF" : "WebP"} — no audio. Best with{" "}
            <strong>Canvas loop</strong> mode (seamless loop) and a modest resolution; full-track
            animations get very large.
            {exportSettings.format === "webp" &&
              " WebP keeps alpha — set Background to Transparent for a transparent loop."}
          </p>
        )}

        {exportSettings.format === "mp4" && (
          <label className="field">
            <span>Loudness</span>
            <select
              className="select"
              value={exportSettings.loudnessTarget ?? ""}
              disabled={!!exporting}
              title="Match exported audio to a loudness standard. Audio only — this setting does not change export analysis or visual frames."
              onChange={(e) =>
                store().setExportSettings({
                  loudnessTarget: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            >
              <option value="">Off — keep original level</option>
              {LOUDNESS_PRESETS.map((p) => (
                <option key={p.lufs} value={p.lufs}>
                  {p.label} LUFS — {p.hint}
                </option>
              ))}
            </select>
          </label>
        )}

        {exportSettings.format === "mp4" && exportSettings.loudnessTarget != null && (
          <p className="section-hint">
            Measures the track and matches it to {exportSettings.loudnessTarget} LUFS, holding peaks
            under {exportSettings.truePeakDb} dBTP so nothing clips when a streaming service
            re-encodes it. Audio only — the visuals are unchanged. Already-loud tracks can land a
            little under target: the peak ceiling wins, and holding it costs loudness.
          </p>
        )}

        {!canvasMode && (
          <label className="field">
            <span>Resolution</span>
            <select
              className="select"
              value={exportSettings.resIdx}
              disabled={!!exporting}
              onChange={(e) => store().setExportSettings({ resIdx: Number(e.target.value) })}
            >
              {resolutionsForAspect(aspect).map((i) => (
                <option key={RESOLUTIONS[i].label} value={i}>
                  {RESOLUTIONS[i].label}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Shown whenever the format is MP4 — including canvas mode, where
            every tile but H.264 says so, and including the single-codec
            machine whose Codec row used to vanish entirely. That vanishing is
            what made transparent WebM undiscoverable. */}
        {exportSettings.format === "mp4" && (
          <CapabilityGrid
            label="Codec"
            name="export-codec"
            options={codecOptions}
            value={effCodec}
            frozen={!!exporting}
            onChange={(codec) => store().setExportSettings({ codec })}
          />
        )}

        {exportSettings.format === "mp4" && (
          <p className="section-hint">
            Pixels are identical — the codec only changes file size and player compatibility. The
            list above is what this machine&rsquo;s encoder accepted at 1080p60; a 4K job is checked
            again at its own size, so a very large export can still be refused.
          </p>
        )}

        {exportSettings.format === "mp4" && effCodec === "vp9a" && (
          <p className="section-hint">
            VP9 + alpha writes a transparent <strong>.webm</strong> — for OBS overlays, web embeds,
            and players that honor WebM transparency. Set Background to <strong>Transparent</strong>
            ; an opaque background just encodes a solid alpha.
          </p>
        )}

        {!canvasMode && (
          <label className="field">
            <span>Frame rate</span>
            <select
              className="select"
              value={exportSettings.fps}
              disabled={!!exporting}
              onChange={(e) => store().setExportSettings({ fps: Number(e.target.value) })}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
        )}

        {canvasMode && (
          <>
            <label className="field">
              <span>Loop length</span>
              <select
                className="select"
                value={exportSettings.canvasDuration}
                disabled={!!exporting}
                onChange={(e) =>
                  store().setExportSettings({ canvasDuration: Number(e.target.value) })
                }
              >
                {[3, 4, 5, 6, 7, 8].map((d) => (
                  <option key={d} value={d}>
                    {d} s
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              {/* Show the CLAMPED value — the label must match what the
                  slider shows and what the export actually uses. */}
              <span>
                Starts at {Math.min(exportSettings.canvasStart, canvasMaxStart).toFixed(1)} s
              </span>
              <Slider
                min={0}
                max={Math.max(0.1, canvasMaxStart)}
                step={0.1}
                value={Math.min(exportSettings.canvasStart, canvasMaxStart)}
                disabled={!!exporting}
                onChange={(v) => store().setExportSettings({ canvasStart: v })}
              />
            </div>
            <p className="section-hint">
              1080×1920 (9:16) at 30 fps. The last half second crossfades into the first — the loop
              point is seamless. Spotify Canvas accepts 3-8 s.
            </p>
          </>
        )}

        {exportSettings.format === "mp4" && (
          <div className="field">
            <span>Bitrate</span>
            <div className="bitrate-controls">
              <span className="inline">
                <Switch
                  checked={exportSettings.autoRate}
                  disabled={!!exporting}
                  onChange={(autoRate) => store().setExportSettings({ autoRate })}
                  label="Automatic bitrate"
                />
                Auto
              </span>
              {!exportSettings.autoRate && (
                <Slider
                  min={2}
                  max={60}
                  step={1}
                  value={exportSettings.manualMbps}
                  disabled={!!exporting}
                  onChange={(v) => store().setExportSettings({ manualMbps: v })}
                />
              )}
              <span className="row-value">{effectiveMbps} Mbps</span>
            </div>
          </div>
        )}

        <p className="section-hint">
          Renders the current preset, parameters and background — what you see live is what you get.
          Sync is sample-exact.
          {bg.mode === BG_TRANSPARENT &&
            exportSettings.format === "mp4" &&
            effCodec !== "vp9a" &&
            " Transparent background becomes black in MP4 — PNG frames, ProRes, WebP and VP9+alpha keep it."}
          {/* The converse, which the dialog never said: an alpha-capable
              deliverable over an opaque background writes a solid alpha, and
              the user finds out in their compositor. */}
          {keepsAlpha &&
            bg.mode !== BG_TRANSPARENT &&
            " This format carries an alpha channel, but Background is not Transparent — the alpha exports solid."}
        </p>

        {/* F2: the dialog stayed fully operable on the Canvas2D fallback and
            only admitted the truth after the save dialog, the decode and the
            analysis — a GpuInitError thrown from inside the export worker.
            Say it here, where the decision is made, and disable the button. */}
        {simplifiedRenderer && (
          <div className="toast-inline error">
            {SIMPLIFIED_EXPORT_REASON}. The renderer in use draws a simplified preview only; a
            graphics driver or WebView2 runtime update usually restores it.
          </div>
        )}

        {exporting ? (
          <>
            <div className="progress">
              <div className="progress-fill" style={{ width: `${exportPct}%` }} />
            </div>
            <div className="export-status">
              <span>
                {exportPct}% — frame {exporting.done}/{exporting.total}
                {exportSpeed ? ` · ${exportSpeed} fps` : ""}
              </span>
              <button className="text-btn danger" onClick={() => store().cancelExport()}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            className="btn-primary wide"
            disabled={simplifiedRenderer}
            title={simplifiedRenderer ? SIMPLIFIED_EXPORT_REASON : undefined}
            onClick={() => void store().runExport()}
          >
            <IconExport size={16} />
            Export {res.w}×{res.h} @ {effFps} fps
          </button>
        )}
        {exportError && <div className="toast-inline error">{exportError}</div>}
        {exportDone && (
          <div className="toast-inline success export-done-toast">
            <span>{exportDone}</span>
            {exportDonePath && caps.desktop && (
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  void showInFolder(exportDonePath).catch((e: unknown) => {
                    // Never a silent swallow: the path was valid a moment ago
                    // (it came from this very export), so a failure here — the
                    // file or folder was moved, the drive unmounted — is
                    // worth saying.
                    console.error("[export]", e);
                    store().setError(
                      e instanceof Error ? e.message : typeof e === "string" ? e : String(e),
                    );
                  });
                }}
              >
                Show in folder
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
