/**
 * "Generate lyrics" (FEAT-004 phase 2): fully-local vocal isolation +
 * transcription producing timed lyrics for the loaded track.
 *
 * Self-contained store-connected panel (ExportDialog pattern) mounted inside
 * the Text tab's Lyrics section. The approval gate's disclosure rule shapes
 * this UI: disk and time costs are visible BEFORE any download or run, and
 * the time estimate uses sustained-thermal device measurements — with the
 * DirectML-vs-CPU difference probed, not guessed, and (2026-10-13) the
 * CUDA whisper pack offered only where an NVIDIA driver answers.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CUDA_RUNTIME_ID,
  cudaReady,
  cudaRuntime,
  estimateGenerateSeconds,
  formatBytes,
  formatEstimate,
  formatEta,
  LYRICS_LANGUAGES,
  recommendedTier,
  TIER_NAMES,
  tierDownloadBytes,
  tierInstalled,
  tierOptions,
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

/** What a download row calls itself — models by id, the pack by what it is. */
function downloadLabel(id: string): string {
  return id === CUDA_RUNTIME_ID ? "GPU acceleration" : id;
}

export function LyricsGenPanel() {
  const lyricsGen = useVizStore((s) => s.lyricsGen);
  const realign = useVizStore((s) => s.lyricsRealign);
  const store = useVizStore.getState;
  // null = the user has not picked: follow the recommendation, which moves
  // to Large v3 Turbo the moment the GPU pack lands.
  const [tierChoice, setTierChoice] = useState<LyricsTier | null>(null);
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

  const { models, dml, gpu, runtimes, phase, download, gen, modelOp } = lyricsGen;
  const cuda = cudaReady(gpu, runtimes);
  const tier = tierChoice ?? recommendedTier(cuda);
  const duration = trackDuration();
  const estimate =
    duration > 0
      ? formatEstimate(
          estimateGenerateSeconds(duration, tier, dml === true, measuredRtf, {
            cuda,
            discreteGpu: gpu?.cudaCapable === true,
          }),
        )
      : null;

  // HD-17: the model manager — what is on disk, with Verify (installed
  // files) and Remove (installed files and stalled partial downloads). It
  // rides under every phase view so a download in progress still shows what
  // already landed, locked with the reason on each button; the store guards
  // the same conditions, this is the visible half. Runtime packs list here
  // too (Remove only — their files are verified at unpack time).
  const onDisk = models?.models.filter((m) => m.installed || m.partBytes > 0) ?? [];
  const packsOnDisk = runtimes?.runtimes.filter((r) => r.installed || r.partBytes > 0) ?? [];
  const onDiskBytes =
    onDisk.reduce((n, m) => n + (m.installed ? m.bytes : m.partBytes), 0) +
    packsOnDisk.reduce((n, r) => n + (r.installed ? r.bytes : r.partBytes), 0);
  const modelsBusyWhy =
    phase === "downloading"
      ? "Wait for the download to finish"
      : phase === "generating"
        ? "Wait for the running lyrics job"
        : modelOp
          ? modelOp.kind === "verify"
            ? `Checking ${downloadLabel(modelOp.id)}…`
            : `Removing ${downloadLabel(modelOp.id)}…`
          : realign
            ? "Wait for the running line re-align"
            : null;
  const modelManager =
    models != null && onDisk.length + packsOnDisk.length > 0 ? (
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
        {packsOnDisk.map((r) => {
          const mine = modelOp?.id === r.id ? modelOp.kind : null;
          return (
            <div key={r.id} className="lyr-model-row" data-lyr-runtime={r.id}>
              <span className="lyr-model-name" title={r.dirName}>
                {downloadLabel(r.id)}
              </span>
              <span className="lyr-model-size">
                {r.installed ? formatBytes(r.bytes) : `${formatBytes(r.partBytes)} partial`}
              </span>
              <span className="lyr-model-btns">
                <button
                  type="button"
                  className="text-btn danger"
                  disabled={modelsBusyWhy !== null}
                  title={
                    modelsBusyWhy ??
                    (r.installed
                      ? "Delete the GPU runtime from disk — Whisper goes back to the CPU until it is downloaded again"
                      : "Delete the partial download — the next download starts over")
                  }
                  onClick={() => void store().removeLyricsRuntime(r.id)}
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
            Downloading {downloadLabel(download.id)} — {formatBytes(download.received)} of{" "}
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
  // The GPU acceleration row: offered where an NVIDIA driver answered, shown
  // as on once the pack is installed, and honest about the CPU elsewhere.
  const pack = cudaRuntime(runtimes);
  const gpuLabel = gpu?.gpuName ?? "your NVIDIA GPU";
  const firstCudaRun =
    cuda &&
    measuredRtf.whisperSmallCuda == null &&
    measuredRtf.whisperMediumCuda == null &&
    measuredRtf.whisperTurboCuda == null &&
    measuredRtf.whisperLargeCuda == null;
  const gpuRow =
    gpu == null ? null : gpu.cudaCapable ? (
      pack?.installed ? (
        <p className="section-hint" data-lyr-gpu="on">
          GPU acceleration on — Whisper runs on {gpuLabel}
          {gpu.vramMb != null ? ` (${Math.round(gpu.vramMb / 1024)} GB)` : ""}, which is what makes
          the Large models quick.
          {firstCudaRun
            ? " The first GPU run prepares Whisper's kernels for this card — allow an extra minute or two, once."
            : ""}
        </p>
      ) : (
        <>
          <button
            className="text-btn"
            disabled={pack == null || modelsBusyWhy !== null}
            data-lyr-gpu="offer"
            title={
              modelsBusyWhy ??
              "One-time download of whisper.cpp's official CUDA build from its GitHub release; the zip and every file in it are checksum-verified"
            }
            onClick={() => void store().downloadLyricsRuntime(CUDA_RUNTIME_ID)}
          >
            Download GPU acceleration
            {pack ? ` (${formatBytes(Math.max(0, pack.zipBytes - pack.partBytes))})` : "…"}
          </button>
          <p className="section-hint">
            {gpuLabel} can run Whisper 10-20x faster than the CPU and make the Large models the
            sensible choice. The pack is {pack ? formatBytes(pack.bytes) : "about 1.1 GB"} on disk
            once unpacked.
          </p>
        </>
      )
    ) : (
      <p className="section-hint" data-lyr-gpu="none">
        No NVIDIA driver found — Whisper runs on the CPU
        {dml === true ? " (vocal isolation still uses the GPU through DirectML)" : ""}. Small is the
        quick choice here; the larger models read sung words better and take proportionally longer.
      </p>
    );
  return (
    <div className="lyrics-gen">
      <SelectRow
        label="AI model"
        hint="Which speech model transcribes the vocals — larger ones read sung words better; the estimate on the button says what each costs on this PC"
        value={tier}
        onChange={(v) => setTierChoice(v)}
        options={tierOptions(cuda)}
      />
      <SelectRow
        label="Language"
        hint="Spoken language in the track — Auto-detect listens to the isolated vocal; naming it directly helps on quieter or accented singing"
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
            "One-time download from Beatform's model mirror (the Large models from whisper.cpp's own Hugging Face release); every file is checksum-verified"
          }
          onClick={() => void store().downloadLyricsTier(tier)}
        >
          Download models{dl ? ` (${formatBytes(dl.remaining)})` : "…"}
        </button>
      )}
      {gpuRow}
      <p className="section-hint">
        Runs entirely on this PC — vocals are isolated (UVR MDX-Net
        {dml === true ? " on DirectML" : ""}), transcribed (Whisper {TIER_NAMES[tier]}
        {cuda ? " on the GPU" : ""}), then every word is timed against the vocal (wav2vec2 forced
        alignment) so the karaoke fill follows the singer word by word
        {estimate ? `; ${estimate} for this track` : ""}
        {dml === false ? " (no GPU acceleration found — CPU timing)" : ""}. Word timing happens
        automatically once its model is installed. Words will need a few fixes — that is normal for
        sung vocals.
      </p>
      {modelManager}
    </div>
  );
}
