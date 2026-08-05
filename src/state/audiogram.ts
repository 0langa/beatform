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

/** Field-by-field validation + defaulting of an untrusted AudiogramSettings
 * blob. Shared by the localStorage cache and the .bfproj document validator. */
export function validAudiogram(v: unknown): AudiogramSettings {
  const raw = (typeof v === "object" && v !== null ? v : {}) as Partial<AudiogramSettings>;
  const d = DEFAULT_AUDIOGRAM;
  return {
    progressBar: typeof raw.progressBar === "boolean" ? raw.progressBar : d.progressBar,
    timeReadout: typeof raw.timeReadout === "boolean" ? raw.timeReadout : d.timeReadout,
    waveformStrip: typeof raw.waveformStrip === "boolean" ? raw.waveformStrip : d.waveformStrip,
    position: raw.position === "top" ? "top" : d.position,
    color:
      typeof raw.color === "string" && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : d.color,
  };
}

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
