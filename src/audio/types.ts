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
  /** 0 = instant/punchy, 1 = very smooth */
  smooth: number;
}

export const DEFAULT_SYNC: SyncSettings = { mode: "kick", smooth: 0.5 };

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
