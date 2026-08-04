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

import { useEffect, useState } from "react";
import {
  estimateGenerateSeconds,
  formatBytes,
  formatEstimate,
  formatEta,
  tierDownloadBytes,
  tierInstalled,
  type LyricsTier,
  type SidecarStage,
} from "../state/lyricsGen";
import { isTauri } from "../state/platform";
import { getEngine } from "../state/services";
import { useVizStore } from "../state/store";
import { SelectRow } from "./kit";

const STAGE_LABELS: Record<SidecarStage, string> = {
  decode: "Reading audio",
  isolate: "Isolating vocals",
  vad: "Finding vocal lines",
  transcribe: "Transcribing",
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
  const store = useVizStore.getState;
  const [tier, setTier] = useState<LyricsTier>("small");
  const desktop = isTauri();

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

  const { models, dml, phase, download, gen } = lyricsGen;
  const duration = trackDuration();
  const estimate =
    duration > 0 ? formatEstimate(estimateGenerateSeconds(duration, tier, dml === true)) : null;

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
            {STAGE_LABELS[gen.stage]}
            {gen.pct != null ? ` — ${Math.round(gen.pct)}%` : "…"}
            {gen.etaSec != null && gen.etaSec > 1 ? ` · ${formatEta(gen.etaSec)} left` : ""}
          </span>
          <button className="text-btn danger" onClick={() => store().cancelLyricsGenerate()}>
            Cancel
          </button>
        </div>
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
      {ready ? (
        <button
          className="text-btn"
          disabled={duration <= 0}
          title={
            duration <= 0
              ? "Load a track first"
              : "Isolate the vocals and transcribe them — fully on this PC"
          }
          onClick={() => void store().generateLyrics(tier, "auto")}
        >
          ♪ Generate lyrics{estimate ? ` (${estimate})` : ""}
        </button>
      ) : (
        <button
          className="text-btn"
          disabled={models == null}
          title="One-time download from Beatform's model mirror; every file is checksum-verified"
          onClick={() => void store().downloadLyricsTier(tier)}
        >
          Download models{dl ? ` (${formatBytes(dl.remaining)})` : "…"}
        </button>
      )}
      <p className="section-hint">
        Runs entirely on this PC — vocals are isolated (UVR MDX-Net), then transcribed (Whisper{" "}
        {tier}) into timed lines{estimate ? `; ${estimate} for this track` : ""}
        {dml === false ? " (no GPU acceleration found — CPU timing)" : ""}. Words will need a few
        fixes — that is normal for sung vocals.
      </p>
    </div>
  );
}
