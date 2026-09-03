/**
 * "Generate lyrics" (FEAT-004 phase 2): fully-local vocal isolation +
 * transcription producing timed lyrics for the loaded track.
 *
 * Self-contained store-connected panel (ExportDialog pattern) mounted inside
 * the Text tab's Lyrics section. The approval gate's disclosure rule shapes
 * this UI: disk and time costs are visible BEFORE any download or run, and
 * the time estimate uses sustained-thermal device measurements — with the
 * DirectML-vs-CPU difference probed, not guessed.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  estimateGenerateSeconds,
  formatBytes,
  formatEstimate,
  formatEta,
  LYRICS_LANGUAGES,
  tierDownloadBytes,
  tierInstalled,
  type LyricsTier,
  type SidecarStage,
} from "../state/lyricsGen";
import { isTauri } from "../state/platform";
import { getPrefs, subscribePrefs } from "../state/prefs";
import { getEngine } from "../state/services";
import { useVizStore } from "../state/store";
import { SelectRow } from "./kit";

const STAGE_LABELS: Record<SidecarStage, string> = {
  decode: "Reading audio",
  isolate: "Isolating vocals",
  vad: "Finding vocal lines",
  transcribe: "Transcribing",
  align: "Timing words",
  assemble: "Building lyrics",
};

/** Loaded track duration, tolerating an uninitialized engine (tests). */
function trackDuration(): number {
  try {
    return getEngine().state.duration;
  } catch {
    return 0;
  }
}

export function LyricsGenPanel() {
  const lyricsGen = useVizStore((s) => s.lyricsGen);
  const realign = useVizStore((s) => s.lyricsRealign);
  const store = useVizStore.getState;
  const [tier, setTier] = useState<LyricsTier>("small");
  const [language, setLanguage] = useState("auto");
  const desktop = isTauri();
  // getPrefs() is a stable reference until setPrefs actually changes a
  // field (samePrefs guards that) — safe to read directly, same pattern as
  // App.tsx's own useSyncExternalStore(subscribePrefs, getPrefs).
  const measuredRtf = useSyncExternalStore(subscribePrefs, getPrefs).measuredRtf;

  useEffect(() => {
    if (desktop) void store().refreshLyricsGen();
  }, [desktop, store]);

  if (!desktop) {
    return (
      <p className="section-hint">
        Generate lyrics automatically in the desktop app — it isolates the vocals and transcribes
        them on your PC, nothing leaves the machine. In the browser build, import an .lrc instead.
      </p>
    );
  }

  const { models, dml, phase, download, gen, modelOp } = lyricsGen;
  const duration = trackDuration();
  const estimate =
    duration > 0
      ? formatEstimate(estimateGenerateSeconds(duration, tier, dml === true, measuredRtf))
      : null;

  // HD-17: the model manager — what is on disk, with Verify (installed
  // files) and Remove (installed files and stalled partial downloads). It
  // rides under every phase view so a download in progress still shows what
  // already landed, locked with the reason on each button; the store guards
  // the same conditions, this is the visible half.
  const onDisk = models?.models.filter((m) => m.installed || m.partBytes > 0) ?? [];
  const onDiskBytes = onDisk.reduce((n, m) => n + (m.installed ? m.bytes : m.partBytes), 0);
  const modelsBusyWhy =
    phase === "downloading"
      ? "Wait for the download to finish"
      : phase === "generating"
        ? "Wait for the running lyrics job"
        : modelOp
          ? modelOp.kind === "verify"
            ? `Checking ${modelOp.id}…`
            : `Removing ${modelOp.id}…`
          : realign
            ? "Wait for the running line re-align"
            : null;
  const modelManager =
    models != null && onDisk.length > 0 ? (
      <div className="lyr-models">
        <div className="lyr-models-head" title={`Stored in ${models.modelsDir}`}>
          <span className="lyr-count">Models on this PC · {formatBytes(onDiskBytes)}</span>
        </div>
        {onDisk.map((m) => {
          const mine = modelOp?.id === m.id ? modelOp.kind : null;
          return (
            <div key={m.id} className="lyr-model-row" data-lyr-model={m.id}>
              <span className="lyr-model-name" title={m.fileName}>
                {m.id}
              </span>
              <span className="lyr-model-size">
                {m.installed ? formatBytes(m.bytes) : `${formatBytes(m.partBytes)} partial`}
              </span>
              <span className="lyr-model-btns">
                {m.installed && (
                  <button
                    type="button"
                    className="text-btn"
                    disabled={modelsBusyWhy !== null}
                    title={
                      modelsBusyWhy ??
                      "Re-check this file against its published checksum — a few seconds, on this PC"
                    }
                    onClick={() => void store().verifyLyricsModel(m.id)}
                  >
                    {mine === "verify" ? "checking…" : "Verify"}
                  </button>
                )}
                <button
                  type="button"
                  className="text-btn danger"
                  disabled={modelsBusyWhy !== null}
                  title={
                    modelsBusyWhy ??
                    (m.installed
                      ? "Delete this model from disk — generating lyrics with it will need the download again"
                      : "Delete the partial download — the next download starts over")
                  }
                  onClick={() => void store().removeLyricsModel(m.id)}
                >
                  {mine === "remove" ? "removing…" : "Remove"}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    ) : null;

  if (phase === "downloading" && download) {
    const pct = download.total > 0 ? Math.round((100 * download.received) / download.total) : 0;
    return (
      <div className="lyrics-gen">
        <div className="progress">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="export-status">
          <span>
            Downloading {download.id} — {formatBytes(download.received)} of{" "}
            {formatBytes(download.total)}
          </span>
          <button className="text-btn danger" onClick={() => store().cancelLyricsDownload()}>
            Cancel
          </button>
        </div>
        <p className="section-hint">Cancel keeps what is downloaded — the next try resumes.</p>
        {modelManager}
      </div>
    );
  }

  if (phase === "generating" && gen) {
    return (
      <div className="lyrics-gen">
        <div className="progress">
          <div className="progress-fill" style={{ width: `${Math.round(gen.overall * 100)}%` }} />
        </div>
        <div className="export-status">
          <span>
            {gen.starting
              ? // Follow-up (a): the instant a stage completes, name the
                // NEXT stage instead of leaving the finished one frozen at
                // "— 100%" until its first real event arrives (medium's
                // first-token latency is the worst case — minutes, per the
                // owner's first-impressions note).
                `Starting ${STAGE_LABELS[gen.stage].toLowerCase()}…`
              : `${STAGE_LABELS[gen.stage]}${gen.pct != null ? ` — ${Math.round(gen.pct)}%` : "…"}${
                  gen.etaSec != null && gen.etaSec > 1 ? ` · ${formatEta(gen.etaSec)} left` : ""
                }`}
          </span>
          <button className="text-btn danger" onClick={() => store().cancelLyricsGenerate()}>
            Cancel
          </button>
        </div>
        {modelManager}
      </div>
    );
  }

  const ready = models != null && tierInstalled(models, tier);
  const dl = models ? tierDownloadBytes(models, tier) : null;
  return (
    <div className="lyrics-gen">
      <SelectRow
        label="AI model"
        hint="Which speech model transcribes the vocals — Medium reads sung words better but takes several times longer"
        value={tier}
        onChange={(v) => setTier(v)}
        options={[
          { value: "small" as const, label: "Small — recommended" },
          { value: "medium" as const, label: "Medium — better words, much slower" },
        ]}
      />
      <SelectRow
        label="Language"
        hint="Spoken language in the track — Auto-detect works well for clear vocals; naming it directly helps on quieter or accented singing"
        value={language}
        onChange={(v) => setLanguage(v)}
        options={LYRICS_LANGUAGES}
      />
      {ready ? (
        <button
          className="text-btn"
          disabled={duration <= 0 || modelsBusyWhy !== null}
          title={
            modelsBusyWhy ??
            (duration <= 0
              ? "Load a track first"
              : "Isolate the vocals and transcribe them — fully on this PC")
          }
          onClick={() => void store().generateLyrics(tier, language)}
        >
          ♪ Generate lyrics{estimate ? ` (${estimate})` : ""}
        </button>
      ) : (
        <button
          className="text-btn"
          disabled={models == null || modelsBusyWhy !== null}
          title={
            modelsBusyWhy ??
            "One-time download from Beatform's model mirror; every file is checksum-verified"
          }
          onClick={() => void store().downloadLyricsTier(tier)}
        >
          Download models{dl ? ` (${formatBytes(dl.remaining)})` : "…"}
        </button>
      )}
      <p className="section-hint">
        Runs entirely on this PC — vocals are isolated (UVR MDX-Net), transcribed (Whisper {tier}),
        then every word is timed against the vocal (wav2vec2 forced alignment) so the karaoke fill
        follows the singer word by word{estimate ? `; ${estimate} for this track` : ""}
        {dml === false ? " (no GPU acceleration found — CPU timing)" : ""}. Word timing happens
        automatically once its model is installed. Words will need a few fixes — that is normal for
        sung vocals.
      </p>
      {modelManager}
    </div>
  );
}
