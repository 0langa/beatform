/**
 * AudioFeatures is the contract between the audio pipeline and every renderer.
 * Renderers/presets consume this and nothing else, so audio internals and
 * visual code can evolve independently.
 */
export interface AudioFeatures {
  /** Log-spaced, smoothed spectrum bins, 0..1 */
  bins: Float32Array;
  /** Peak-hold values per bin (gravity fall), 0..1 */
  peaks: Float32Array;
  /** Time-domain waveform, -1..1 */
  waveform: Float32Array;
  /** Overall loudness 0..1 */
  rms: number;
  /** Slow loudness envelope (~1s), 0..1 — drives calm/idle motion */
  energy: number;
  /** Voice band (~300-3400 Hz) energy 0..1 */
  voice: number;
  /**
   * The user-selected sync source as one smooth scalar 0..1 — presets use
   * this as their PRIMARY reactive input (default: energy).
   */
  drive: number;
  /** Onset pulse (1 on hit, exponential decay) of the selected sync source */
  driveBeat: number;
  /** Band energies 0..1 */
  bass: number;
  mid: number;
  treble: number;
  /** Stereo width 0 (mono) .. 1 (wide/anti-phase), smoothed */
  width: number;
  /** Momentary loudness, LUFS (BS.1770 400 ms window); -70 floor */
  lufs: number;
  /** Drum-class onset pulses (1 on hit, fast decay), 0..1 */
  kick: number;
  snare: number;
  hat: number;
  /** Detected tempo (0 until track analysis lands) */
  bpm: number;
  /** 0..1 position within the current beat (0 until analysis lands) */
  beatPhase: number;
  /** 0..1 position within the current 4-beat bar */
  barPhase: number;
  /** True exactly on onset frames */
  beat: boolean;
  /** 1 on beat, exponential decay after — drive pulses with this */
  beatIntensity: number;
  /** Playback position, seconds */
  time: number;
  /** Track duration, seconds (0 when nothing loaded) */
  duration: number;
}

/** What the visuals react to — the primary sync source. */
export type SyncMode =
  "energy" | "bass" | "kick" | "melody" | "voice" | "treble" | "snare" | "hats";

export interface SyncSettings {
  mode: SyncMode;
  /** Overall response macro: 0 = instant/punchy, 1 = very smooth. Also the
   * fallback for attack/release when those are not set. */
  smooth: number;
  /** How fast the reaction rises (0 = instant, 1 = slow). Falls back to smooth. */
  attack?: number;
  /** How fast the reaction falls (0 = instant, 1 = long glide). Falls back to smooth. */
  release?: number;
}

export const DEFAULT_SYNC: SyncSettings = { mode: "kick", smooth: 0.5 };

const SYNC_MODES: readonly SyncMode[] = [
  "energy",
  "bass",
  "kick",
  "melody",
  "voice",
  "treble",
  "snare",
  "hats",
];

/**
 * Coerce untrusted sync settings (imported .avpreset / .avproj, localStorage)
 * into a safe shape. An out-of-range or missing `smooth` fed the drive EMA a
 * NaN/negative coefficient — and a NaN drive self-propagates forever, killing
 * visuals until restart. Every path into the pipeline goes through this.
 */
export function sanitizeSync(v: unknown): SyncSettings {
  const p = (typeof v === "object" && v !== null ? v : {}) as Partial<SyncSettings>;
  const clamp01 = (n: unknown, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  const smooth = clamp01(p.smooth, DEFAULT_SYNC.smooth);
  return {
    mode: SYNC_MODES.includes(p.mode as SyncMode) ? (p.mode as SyncMode) : DEFAULT_SYNC.mode,
    smooth,
    ...(p.attack !== undefined ? { attack: clamp01(p.attack, smooth) } : {}),
    ...(p.release !== undefined ? { release: clamp01(p.release, smooth) } : {}),
  };
}

export interface PlaybackState {
  playing: boolean;
  time: number;
  duration: number;
  trackName: string | null;
  loop: boolean;
}

/**
 * Decoded PCM as plain data — the worker-transferable stand-in for
 * AudioBuffer (which cannot cross thread boundaries). Channels are
 * per-channel sample arrays of identical length.
 */
export interface PcmData {
  sampleRate: number;
  /** Samples per channel. */
  length: number;
  /** Seconds; length / sampleRate. */
  duration: number;
  channels: Float32Array[];
}
