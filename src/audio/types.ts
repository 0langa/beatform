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
  /**
   * The stereo pair behind `waveform` (which stays the mono mixdown): the
   * LEFT and RIGHT channel windows, -1..1, cut at the SAME zero-crossing
   * trigger as `waveform` — one trigger indexes all three lanes, so plotting
   * left against right preserves the inter-channel phase an XY/Lissajous
   * display exists to show. Mono sources carry the mono window in both, so
   * consumers degrade gracefully without a channel-count flag.
   */
  waveformL: Float32Array;
  waveformR: Float32Array;
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
  /**
   * Absolute track time corresponding to this frame's `time === 0`.
   * Absent (or 0) on the live path and on full-track exports, where `time`
   * ALREADY is track time. A SEGMENT export slices the audio so the clip
   * starts at t=0, and this carries where that t=0 sits on the track, so a
   * source that needs an absolute anchor — the tempo-locked LFOs — resolves
   * it as `time + (timeOrigin ?? 0)`.
   *
   * `time` itself stays CLIP time on purpose: the timeline, lane keyframes,
   * beat grid, lyrics, sections, vocal spans and stems are all rebased to the
   * clip by videoExporter.buildJob, so an absolute `time` would double-shift
   * every one of them. Runtime contract only — AudioFeatures is never
   * serialized, so this needs no schema migration.
   */
  timeOrigin?: number;
  /**
   * ---- Additive "reactivity fuel" fields (P-15) -------------------------
   * Optional AT THE TYPE LEVEL ONLY, so hand-built feature frames elsewhere
   * (tests, demo/thumbnail frames) stay valid without churn: the pipeline
   * itself ALWAYS populates every one of them. CPU-side contract for the
   * modulation engine and Canvas2D consumers — no GPU uniform carries them
   * yet (per-mode adoption is a later wave). All of them resolve from track
   * time or offline track analysis, never wall clock, so they are
   * deterministic and seek-stable like everything else here.
   */
  /** Integer count of beats since track start at the current time, from the
   * offline beat grid (the same grid behind bpm/beatPhase). −1 until
   * analysis lands, and −1 before the grid's first beat — the value only
   * ever counts REAL beats, matching gridPhase's convention. */
  beatIndex?: number;
  /** Integer 4/4 bar count: floor(beatIndex / 4) (the same 4-beat
   * assumption barPhase already makes). −1 whenever beatIndex is −1. */
  barIndex?: number;
  /** Index of the current song section (intro/drop/breakdown...), from the
   * offline section analysis: 0 before the first detected boundary, +1 at
   * each boundary. −1 until section analysis lands. */
  sectionIndex?: number;
  /** 1 exactly at each section boundary, exponential decay after (~4/s) —
   * a pure function of track time and the boundary list, so scrubbing
   * resolves the identical pulse the export renders. 0 before the first
   * boundary and while no section analysis is attached. */
  sectionPulse?: number;
  /** Pitch-class energies, C first (C, C#, ... B), each 0..1. Folded from
   * the analysis FFT (55–2000 Hz, the keyDetect range) on the sync dB
   * scale and smoothed with the same attack/release EMA as `bins`, so the
   * lanes move like the spectrum does. Always length 12. */
  chroma?: Float32Array;
  /** Lyrics-derived vocal presence 0..1: 1 inside a timed word/line with
   * short attack/release ramps at the edges, 0 in instrumental stretches.
   * Document-derived (the .lrc timings) and a pure function of track time —
   * NOT a DSP estimate; `voice` remains the voice-band energy. 0 when no
   * timed lyrics are loaded. */
  vocal?: number;
}

/** What the visuals react to — the primary sync source. */
export type SyncMode =
  "energy" | "bass" | "kick" | "melody" | "voice" | "treble" | "snare" | "hats";

/** Drawn-spectrum quality only. Detector analysis stays on responsive. */
export type SpectrumResolution = "responsive" | "detailed" | "precise";
export type SpectrumAxis = "log" | "linear";
export type SpectrumSampling = "interpolated" | "measured";

export interface SyncSettings {
  mode: SyncMode;
  /** Overall response macro: 0 = instant/punchy, 1 = very smooth. Also the
   * fallback for attack/release when those are not set. */
  smooth: number;
  /** How fast the reaction rises (0 = instant, 1 = slow). Falls back to smooth. */
  attack?: number;
  /** How fast the reaction falls (0 = instant, 1 = long glide). Falls back to smooth. */
  release?: number;
  /** Spectrum SHAPE (drawn bins only — never the sync feel):
   * Merge: Monstercat-style neighbor falloff — every bar props its neighbors
   * up with an exponential decay, melting isolated spikes into one connected
   * mountain. 0 = off. */
  shapeMerge?: number;
  /** Rounding: kernel blur across neighboring bins (real smoothing, unlike
   * the spline which only interpolates BETWEEN spiky values). 0 = off. */
  shapeRound?: number;
  /** Contrast of the drawn spectrum: 0.5 = current look, lower = flatter/
   * fuller bars, higher = spikier peaks vs deeper valleys. */
  contrast?: number;
  /** Low edge of the analysed span, Hz. The drawn bars are geometrically
   * spaced across freqMin..freqMax, so raising this spends the whole bar
   * budget on the range that actually carries the music (a track with no
   * sub-bass wastes bars on silence below 60 Hz). Defaults to MIN_FREQ. */
  freqMin?: number;
  /** High edge of the analysed span, Hz. Defaults to MAX_FREQ. */
  freqMax?: number;
  /** Drawn-spectrum FFT window. Longer windows resolve closer low tones but
   * add matching visual history; onset detectors never use this setting. */
  spectrumResolution?: SpectrumResolution;
  /** Display-band spacing. Measured FFT bins are always linear in hertz. */
  spectrumAxis?: SpectrumAxis;
  /** Interpolated bands keep the 96-bar budget; measured reads integer FFT
   * bins only and may expose fewer bars when the chosen span contains fewer. */
  spectrumSampling?: SpectrumSampling;
}

/** Hard bounds for the user-settable analysed span. The low bound sits at the
 * bottom of human hearing; the high bound is clamped against Nyquist by the
 * pipeline itself. MIN_SPAN_RATIO keeps the two edges at least an octave and
 * a half apart, so the geometric spacing can never collapse. */
export const FREQ_LIMIT_LOW = 10;
export const FREQ_LIMIT_HIGH = 22050;
const MIN_SPAN_RATIO = 3;

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
const SPECTRUM_RESOLUTIONS: readonly SpectrumResolution[] = ["responsive", "detailed", "precise"];
const SPECTRUM_AXES: readonly SpectrumAxis[] = ["log", "linear"];
const SPECTRUM_SAMPLING: readonly SpectrumSampling[] = ["interpolated", "measured"];

/**
 * Coerce untrusted sync settings (imported .bfpreset / .bfproj, localStorage)
 * into a safe shape. An out-of-range or missing `smooth` fed the drive EMA a
 * NaN/negative coefficient — and a NaN drive self-propagates forever, killing
 * visuals until restart. Every path into the pipeline goes through this.
 */
export function sanitizeSync(v: unknown): SyncSettings {
  const p = (typeof v === "object" && v !== null ? v : {}) as Partial<SyncSettings>;
  const clamp01 = (n: unknown, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  const smooth = clamp01(p.smooth, DEFAULT_SYNC.smooth);
  // The analysed span travels as a PAIR: a lone edge, an inverted pair, or a
  // collapsed one would divide by zero (or NaN) in the geometric spacing, so
  // either both edges survive validation together or neither is carried.
  const hz = (n: unknown): number | null =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.min(FREQ_LIMIT_HIGH, Math.max(FREQ_LIMIT_LOW, n))
      : null;
  const lo = hz(p.freqMin);
  const hi = hz(p.freqMax);
  // COERCE a too-narrow span rather than discarding it. Dropping the pair sent
  // BOTH sliders back to their defaults, so dragging one edge into the other
  // silently destroyed the setting the user had made on the OTHER slider.
  let span: { freqMin: number; freqMax: number } | Record<string, never> = {};
  if (lo !== null && hi !== null) {
    let a = lo;
    let b = hi;
    if (b / a < MIN_SPAN_RATIO) {
      b = Math.min(FREQ_LIMIT_HIGH, a * MIN_SPAN_RATIO);
      if (b / a < MIN_SPAN_RATIO) a = b / MIN_SPAN_RATIO;
    }
    span = { freqMin: a, freqMax: b };
  }
  return {
    mode: SYNC_MODES.includes(p.mode as SyncMode) ? (p.mode as SyncMode) : DEFAULT_SYNC.mode,
    smooth,
    ...(p.attack !== undefined ? { attack: clamp01(p.attack, smooth) } : {}),
    ...(p.release !== undefined ? { release: clamp01(p.release, smooth) } : {}),
    ...(p.shapeMerge !== undefined ? { shapeMerge: clamp01(p.shapeMerge, 0) } : {}),
    ...(p.shapeRound !== undefined ? { shapeRound: clamp01(p.shapeRound, 0) } : {}),
    ...(p.contrast !== undefined ? { contrast: clamp01(p.contrast, 0.5) } : {}),
    ...(SPECTRUM_RESOLUTIONS.includes(p.spectrumResolution as SpectrumResolution)
      ? { spectrumResolution: p.spectrumResolution as SpectrumResolution }
      : {}),
    ...(SPECTRUM_AXES.includes(p.spectrumAxis as SpectrumAxis)
      ? { spectrumAxis: p.spectrumAxis as SpectrumAxis }
      : {}),
    ...(SPECTRUM_SAMPLING.includes(p.spectrumSampling as SpectrumSampling)
      ? { spectrumSampling: p.spectrumSampling as SpectrumSampling }
      : {}),
    ...span,
  };
}

export interface PlaybackState {
  playing: boolean;
  time: number;
  duration: number;
  trackName: string | null;
  loop: boolean;
  /** Session-only A-B loop markers. Both null means whole-track looping. */
  loopStart: number | null;
  loopEnd: number | null;
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
