/**
 * Audiogram elements: per-frame overlay pieces driven purely by track state —
 * a progress bar, an elapsed/total time readout, and a mini-waveform strip.
 * The "podcast clip" look. All positions/values are pure functions of track
 * time (and the static waveform overview), so live and export agree frame for
 * frame, exactly like lyrics.
 */

export interface AudiogramSettings {
  /** Progress bar along an edge. */
  progressBar: boolean;
  /** Elapsed / total time text. */
  timeReadout: boolean;
  /** Static waveform strip with a moving playhead. */
  waveformStrip: boolean;
  /** Vertical anchor for the whole audiogram block. */
  position: "bottom" | "top";
  /** Accent color (bar fill, playhead, played waveform). */
  color: string;
}

export const DEFAULT_AUDIOGRAM: AudiogramSettings = {
  progressBar: false,
  timeReadout: false,
  waveformStrip: false,
  position: "bottom",
  color: "#7c5cff",
};

/** True when at least one element is on — cheap gate for the compositor. */
export function audiogramActive(a: AudiogramSettings): boolean {
  return a.progressBar || a.timeReadout || a.waveformStrip;
}

/** mm:ss (or h:mm:ss past an hour). */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
