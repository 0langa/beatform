import type { PlaybackState } from "./types";

/**
 * AudioWorklet that turns pushed sample chunks into a live audio-graph
 * source. Ring-buffered per channel; underruns emit silence; if the writer
 * runs more than ~250 ms ahead of playback it jumps forward so live visuals
 * never drift behind what the user hears. Input is interleaved stereo f32
 * (the loopback capture's wire format), at the context's own sample rate.
 */

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
  /** Unity-gain analysis tap: sources connect here, not to `gain`, so volume
   * and mute never reach the analysers. */
  private tap: GainNode;
  private gain: GainNode;
  private splitter: ChannelSplitterNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  /** Monotonic load counter: a slow decode must not clobber a newer load. */
  private loadGen = 0;
  // Live system-audio input (WASAPI loopback): a worklet source connected to
  // the ANALYSERS ONLY — routing it to the destination would feed the system
  // output back into itself.
  private liveNode: AudioWorkletNode | null = null;
  private liveStartAt = 0;
  private nameBeforeLive: string | null = null;
  private workletReady = false;

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
    // Unity-gain analysis tap. Sources feed THIS, and it feeds both the
    // analysers and the volume gain — so what we analyse is the raw programme
    // material, exactly like the offline path (which analyses raw PCM).
    //
    // Tapping after `gain` instead meant the preview changed with the volume
    // slider (at 50% every magnitude bin sat ~6 dB lower, shifting bands,
    // drive and the flux threshold) and went completely flat when muted, while
    // the export rendered normally — a live-vs-export divergence on a control
    // that has nothing to do with the picture. Live loopback input already
    // taps here (see startLiveInput); this puts track playback on the same
    // footing.
    this.tap = this.ctx.createGain();
    this.gain = this.ctx.createGain();
    this.tap.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.tap.connect(this.analyser);
    this.splitter = this.ctx.createChannelSplitter(2);
    this.tap.connect(this.splitter);
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
  }

  /** True while the analysers are fed by live system audio, not a track. */
  get liveInput(): boolean {
    return this.liveNode !== null;
  }

  /**
   * Switch the analysis graph to live system audio. Returns the push
   * function the loopback capture feeds (interleaved stereo f32 chunks at
   * the context's sample rate — the caller verifies rates match). Playback
   * of the loaded track stops; the track itself stays loaded.
   */
  async startLiveInput(): Promise<(chunk: ArrayBuffer) => void> {
    if (this.liveNode) throw new Error("Live input already active");
    // Freeze the playhead the way pause() does BEFORE tearing down the
    // source — otherwise leaving live mode later resumes from wherever the
    // last segment began (usually 0), silently rewinding the track.
    if (this._playing) this.offset = this.currentTime;
    this.stopSource();
    this._playing = false;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.workletReady) {
      // A bundled asset, NOT an inline blob: the app CSP is script-src 'self',
      // which (correctly) blocks blob: worklet modules — the blob path threw
      // "Unable to load a worklet's module" in every installed build. Dev
      // carries no CSP, which is why it only failed on real installs.
      await this.ctx.audioWorklet.addModule("/loopback-worklet.js");
      this.workletReady = true;
    }
    const node = new AudioWorkletNode(this.ctx, "loopback-feed", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(this.analyser);
    node.connect(this.splitter);
    this.liveNode = node;
    this.liveStartAt = this.ctx.currentTime;
    this.nameBeforeLive = this._trackName;
    this._trackName = "System audio";
    this.emit();
    return (chunk) => node.port.postMessage(chunk, [chunk]);
  }

  /** Back to track mode. Safe to call when live input is not active. */
  stopLiveInput(): void {
    if (!this.liveNode) return;
    this.liveNode.port.close();
    this.liveNode.disconnect();
    this.liveNode = null;
    this._trackName = this.nameBeforeLive;
    this.nameBeforeLive = null;
    this.emit();
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
    if (this.liveNode) return; // live mode: the store toggles it off instead
    if (!this.buffer || this._playing) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.offset >= this.buffer.duration) this.offset = 0;
    this.startSourceAt(this.offset);
  }

  pause(): void {
    if (this.liveNode) return;
    if (!this._playing) return;
    this.offset = this.currentTime;
    this.stopSource();
    this._playing = false;
    this.emit();
  }

  seek(time: number): void {
    if (this.liveNode) return; // nothing to seek in a live stream
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
    // Live input counts as "playing": beat detectors gate on it, and the
    // frame loop's latency compensation should apply.
    return this._playing || this.liveNode !== null;
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
    // Live mode reports 0: the seek bar disables itself and progress-driven
    // features stay quiet (progress guards divide-by-zero already).
    if (this.liveNode) return 0;
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
    // Live mode: a monotonic clock from capture start. The origin is
    // arbitrary (no track), it just has to advance smoothly for u.time.
    if (this.liveNode) return this.ctx.currentTime - this.liveStartAt;
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
    // THE TAP, not the gain. `tap` feeds both the analysers and `gain`, so
    // connecting a source straight to `gain` routes it to the speakers while
    // bypassing every analyser: audio plays, the spectrum reads digital
    // silence (-70 LUFS), and since every visual is audio-driven the whole
    // canvas goes black except the static background wash. Exports are
    // unaffected — they analyse raw PCM offline — which is exactly why this
    // survived a full export-based verification pass.
    src.connect(this.tap);
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
    this.stopLiveInput();
    this.stopSource();
    this._playing = false;
    void this.ctx.close().catch(() => undefined);
  }
}
