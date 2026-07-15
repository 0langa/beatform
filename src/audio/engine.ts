import type { PlaybackState } from "./types";

/**
 * AudioEngine owns the AudioContext graph:
 *
 *   AudioBufferSourceNode -> GainNode -> destination
 *                                \-> AnalyserNode (tap, no audible effect)
 *
 * Decoded-buffer playback (not <audio> element) so seeking is sample-accurate
 * and later features (gapless queue, offline analysis, custom DSP worklets)
 * need no rework. BufferSource nodes are one-shot: seek/pause recreate the
 * source at an offset.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  /** Per-channel taps for stereo features (width) and loudness metering. */
  readonly analyserL: AnalyserNode;
  readonly analyserR: AnalyserNode;
  private gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  /** Monotonic load counter: a slow decode must not clobber a newer load. */
  private loadGen = 0;

  /** ctx.currentTime at which playback of current segment began */
  private startedAt = 0;
  /** Track offset (seconds) where current segment began */
  private offset = 0;
  private _playing = false;
  private _trackName: string | null = null;
  private _loop = false;

  onStateChange: ((s: PlaybackState) => void) | null = null;
  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    // The analyser is a time-domain tap only (fftSize = window length);
    // RealtimeAnalyzer runs its own FFT so live matches offline export.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyserL = this.ctx.createAnalyser();
    this.analyserR = this.ctx.createAnalyser();
    this.analyserL.fftSize = 4096;
    this.analyserR.fftSize = 4096;
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.gain.connect(this.analyser);
    const splitter = this.ctx.createChannelSplitter(2);
    this.gain.connect(splitter);
    splitter.connect(this.analyserL, 0);
    splitter.connect(this.analyserR, 1);
  }

  async loadFile(file: File): Promise<void> {
    const data = await file.arrayBuffer();
    await this.loadArrayBuffer(data, file.name);
  }

  async loadArrayBuffer(data: ArrayBuffer, name: string): Promise<void> {
    const gen = ++this.loadGen;
    const buffer = await this.ctx.decodeAudioData(data);
    // Two overlapping loads race their decodes: whichever resolves LAST used
    // to win, so a slow first drop could clobber a quick second one. Only the
    // newest load may commit.
    if (gen !== this.loadGen) return;
    this.stopSource();
    this.buffer = buffer;
    this._trackName = name;
    this.offset = 0;
    this._playing = false;
    this.emit();
  }

  /** Load an already-synthesized buffer (demo track). */
  loadBuffer(buffer: AudioBuffer, name: string): void {
    this.loadGen++; // supersede any decode still in flight
    this.stopSource();
    this.buffer = buffer;
    this._trackName = name;
    this.offset = 0;
    this._playing = false;
    this.emit();
  }

  async play(): Promise<void> {
    if (!this.buffer || this._playing) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.offset >= this.buffer.duration) this.offset = 0;
    this.startSourceAt(this.offset);
  }

  pause(): void {
    if (!this._playing) return;
    this.offset = this.currentTime;
    this.stopSource();
    this._playing = false;
    this.emit();
  }

  seek(time: number): void {
    if (!this.buffer) return;
    const clamped = Math.max(0, Math.min(time, this.buffer.duration));
    if (this._playing) {
      this.stopSource();
      this.startSourceAt(clamped);
    } else {
      this.offset = clamped;
      this.emit();
    }
  }

  setVolume(v: number): void {
    this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get playing(): boolean {
    return this._playing;
  }

  get loop(): boolean {
    return this._loop;
  }

  /** Gapless: toggles AudioBufferSourceNode.loop, live on a playing source. */
  set loop(v: boolean) {
    this._loop = v;
    if (this.source) this.source.loop = v;
    this.emit();
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  /** Decoded track, if any — the export pipeline's input. */
  get audioBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  /**
   * Seconds between the graph head (what ctx.currentTime and the analysers
   * describe) and the speakers. Visuals presented "now" should show the
   * track at currentTime minus this, or they lead the audible sound.
   */
  get outputLatency(): number {
    const out = this.ctx.outputLatency;
    return this.ctx.baseLatency + (Number.isFinite(out) ? out : 0);
  }

  get currentTime(): number {
    if (!this.buffer) return 0;
    if (!this._playing) return this.offset;
    const raw = this.offset + (this.ctx.currentTime - this.startedAt);
    if (this._loop) return raw % this.buffer.duration;
    return Math.min(raw, this.buffer.duration);
  }

  get state(): PlaybackState {
    return {
      playing: this._playing,
      time: this.currentTime,
      duration: this.duration,
      trackName: this._trackName,
      loop: this._loop,
    };
  }

  private startSourceAt(offset: number): void {
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this._loop;
    src.connect(this.gain);
    src.onended = () => {
      // Fires for natural end only; stopSource() detaches first otherwise.
      if (this.source === src) {
        this._playing = false;
        this.offset = this.buffer?.duration ?? 0;
        this.source = null;
        this.emit();
        this.onEnded?.();
      }
    };
    src.start(0, offset);
    this.source = src;
    this.startedAt = this.ctx.currentTime;
    this.offset = offset;
    this._playing = true;
    this.emit();
  }

  private stopSource(): void {
    if (this.source) {
      const src = this.source;
      this.source = null; // detach before stop so onended is a no-op
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    }
  }

  private emit(): void {
    this.onStateChange?.(this.state);
  }

  /** Stop playback and release the AudioContext (unmount cleanup). */
  dispose(): void {
    this.stopSource();
    this._playing = false;
    void this.ctx.close().catch(() => undefined);
  }
}
