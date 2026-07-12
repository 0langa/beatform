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
  /** Band energies 0..1 */
  bass: number;
  mid: number;
  treble: number;
  /** True exactly on onset frames */
  beat: boolean;
  /** 1 on beat, exponential decay after — drive pulses with this */
  beatIntensity: number;
  /** Playback position, seconds */
  time: number;
  /** Track duration, seconds (0 when nothing loaded) */
  duration: number;
}

export interface PlaybackState {
  playing: boolean;
  time: number;
  duration: number;
  trackName: string | null;
}
