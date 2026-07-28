// Loopback feed worklet — a jitter-absorbing ring between the IPC chunks
// (WASAPI loopback capture from Rust) and the audio graph.
//
// A REAL FILE, not an inline blob: the app's CSP is `script-src 'self'`, and
// a blob: worklet module is exactly the kind of dynamic script it exists to
// block — loading this from a bundled asset keeps the CSP strict AND makes
// live input work in the installed app (the blob path threw "Unable to load
// a worklet's module" there; dev builds carry no CSP, which is why it only
// failed on real installs).
//
// Everything held in this ring is LATENCY. The node feeds the analysers and
// nothing else (never the speakers — that would loop the system output back
// into itself), so a frame sitting here is a frame the visuals are behind the
// sound the user is actually hearing. That makes ring depth a correctness
// property, not a comfort setting, and it is why the drain below exists:
//
//   Capture and the audio graph run off the SAME device clock (loopback taps
//   the default output), so they do not drift apart on their own. What pushes
//   them apart is that the render thread can HITCH — a quantum of graph time it
//   fails to run is a quantum of audio the capture side produced anyway, and it
//   lands here. Depth therefore only ever RATCHETED UP: consumption matches
//   production again afterwards, so nothing takes those frames back out. The
//   only corrective branch waited for a quarter second of backlog before
//   halving it, which made 125-250 ms of pure lag the steady state of a long
//   session rather than an emergency.
//
// The drain is the classic adaptive-jitter-buffer measurement: watch the ring's
// MINIMUM depth over a window and remove what was never needed during it,
// leaving a small safety cushion. It self-tunes — a machine with a choppy main
// thread keeps the cushion its jitter actually demands, a smooth one converges
// to almost nothing — and it can never remove a frame the window just proved
// was in use. Skipping is safe here in a way it would not be on an audible
// path: nothing listens to this node, so a discontinuity costs one stale
// analysis window, not a click in the user's music.
const SAFETY_SEC = 0.008; // depth the drain deliberately leaves behind
const MEASURE_SEC = 0.25; // window the minimum depth is observed over
const MAX_LAG_SEC = 0.12; // hard ceiling for a pile that arrives all at once

class LoopbackFeed extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = sampleRate * 2;
    this.l = new Float32Array(this.cap);
    this.r = new Float32Array(this.cap);
    this.w = 0; // absolute frames written
    this.rd = 0; // absolute frames read
    this.safety = Math.max(1, (sampleRate * SAFETY_SEC) | 0);
    this.measure = Math.max(1, (sampleRate * MEASURE_SEC) | 0);
    this.maxLag = Math.max(this.safety, (sampleRate * MAX_LAG_SEC) | 0);
    // Running minimum depth for the current window, and how far through it we
    // are. Infinity means "nothing observed yet this window".
    this.minDepth = Infinity;
    this.sinceMeasure = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (!(d instanceof ArrayBuffer)) return;
      const s = new Float32Array(d);
      const frames = s.length >> 1;
      for (let i = 0; i < frames; i++) {
        const idx = this.w % this.cap;
        this.l[idx] = s[i * 2];
        this.r[idx] = s[i * 2 + 1];
        this.w++;
      }
      // Ceiling only. The gradual drain in process() handles the ordinary case;
      // this catches the pathological one (a long stall recovering in a single
      // delivery) so the ring cannot hold more than MAX_LAG_SEC even for the
      // half second it would take the measurement to notice.
      if (this.w - this.rd > this.maxLag) this.rd = this.w - this.safety;
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    for (let i = 0; i < L.length; i++) {
      if (this.rd < this.w) {
        const idx = this.rd % this.cap;
        L[i] = this.l[idx];
        R[i] = this.r[idx];
        this.rd++;
      } else {
        L[i] = 0;
        R[i] = 0;
      }
    }
    // Measured AFTER consuming, so this is the depth the next quantum starts
    // from: a window whose minimum is zero is one that genuinely ran dry, and
    // it must not be drained at all.
    const depth = this.w - this.rd;
    if (depth < this.minDepth) this.minDepth = depth;
    this.sinceMeasure += L.length;
    if (this.sinceMeasure >= this.measure) {
      const slack = this.minDepth - this.safety;
      if (slack > 0) this.rd += slack;
      this.minDepth = Infinity;
      this.sinceMeasure = 0;
    }
    return true;
  }
}
registerProcessor("loopback-feed", LoopbackFeed);
