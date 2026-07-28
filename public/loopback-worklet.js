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
// Everything held in this ring is LATENCY. A zero-gain destination branch
// keeps the worklet on the device clock, but capture is never audibly
// re-emitted. A frame sitting here is a frame the visuals are behind the sound
// the user is hearing, so ring depth is a correctness property.
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
// leaving a fixed 90 ms cushion sized from real WebView2 delivery tests. It can
// never remove a frame the window just proved was in use. Skipping is safe here
// because output is analysis-only: a discontinuity costs one stale analysis
// window, not a click in the user's music.
const SAFETY_SEC = 0.09; // absorbs rare WebView delivery stalls without fetch IPC
const MEASURE_SEC = 0.25; // window the minimum depth is observed over
const MAX_LAG_SEC = 0.12; // triggers credit-backed stale-frame recovery

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
    // Diagnostics are read only on explicit dev-smoke requests. Production
    // capture pays a few integer increments, never periodic postMessage work.
    this.totalSkipped = 0;
    this.hardSkipped = 0;
    this.adaptiveSkipped = 0;
    this.underrunFrames = 0;
    this.underrunEvents = 0;
    this.underrunRun = 0;
    this.maxUnderrunRun = 0;
    // Frames already emitted as silence while an IPC delivery was late. When
    // that delayed batch arrives, exactly this many captured frames are stale
    // and may be discarded without creating a future hole. A plain depth
    // ceiling cannot distinguish delayed delivery from normal batching and
    // caused 5-6% real dropouts by repeatedly discarding valid audio.
    this.underrunCredit = 0;
    this.maxDepth = 0;
    this.primed = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === "stats") {
        this.port.postMessage({
          type: "stats",
          requestId: d.requestId,
          depthFrames: this.w - this.rd,
          maxDepthFrames: this.maxDepth,
          skippedFrames: this.totalSkipped,
          hardSkippedFrames: this.hardSkipped,
          adaptiveSkippedFrames: this.adaptiveSkipped,
          underrunFrames: this.underrunFrames,
          underrunEvents: this.underrunEvents,
          maxUnderrunFrames: Math.max(this.maxUnderrunRun, this.underrunRun),
          sampleRate,
        });
        if (d.reset) {
          this.maxDepth = this.w - this.rd;
          this.totalSkipped = 0;
          this.hardSkipped = 0;
          this.adaptiveSkipped = 0;
          this.underrunFrames = 0;
          this.underrunEvents = 0;
          this.underrunRun = 0;
          this.maxUnderrunRun = 0;
          this.underrunCredit = 0;
        }
        return;
      }
      const pcm16 = d && d.type === "pcm16" && d.data instanceof ArrayBuffer;
      if (!pcm16 && !(d instanceof ArrayBuffer)) return;
      const s = pcm16 ? new Int16Array(d.data) : new Float32Array(d);
      const scale = pcm16 ? 1 / 32768 : 1;
      const frames = s.length >> 1;
      for (let i = 0; i < frames; i++) {
        const idx = this.w % this.cap;
        this.l[idx] = s[i * 2] * scale;
        this.r[idx] = s[i * 2 + 1] * scale;
        this.w++;
      }
      // Ceiling only. The gradual drain in process() handles the ordinary case;
      // this catches the pathological one (a long stall recovering in a single
      // delivery) so the ring cannot hold more than MAX_LAG_SEC even for the
      // half second it would take the measurement to notice.
      const depth = this.w - this.rd;
      if (depth > this.maxDepth) this.maxDepth = depth;
      if (depth > this.maxLag) {
        const wanted = depth - this.safety;
        const skip = Math.min(wanted, this.underrunCredit);
        this.totalSkipped += skip;
        this.hardSkipped += skip;
        this.underrunCredit -= skip;
        this.rd += skip;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    if (!this.primed && this.w - this.rd >= this.safety) this.primed = true;
    for (let i = 0; i < L.length; i++) {
      if (this.primed && this.rd < this.w) {
        if (this.underrunRun > 0) {
          this.maxUnderrunRun = Math.max(this.maxUnderrunRun, this.underrunRun);
          this.underrunRun = 0;
        }
        const idx = this.rd % this.cap;
        L[i] = this.l[idx];
        R[i] = this.r[idx];
        this.rd++;
      } else {
        this.primed = false;
        L[i] = 0;
        R[i] = 0;
        this.underrunFrames++;
        if (this.underrunRun === 0) this.underrunEvents++;
        this.underrunRun++;
        this.underrunCredit++;
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
      if (slack > 0) {
        this.rd += slack;
        this.totalSkipped += slack;
        this.adaptiveSkipped += slack;
      }
      this.minDepth = Infinity;
      this.sinceMeasure = 0;
    }
    return true;
  }
}
registerProcessor("loopback-feed", LoopbackFeed);
