// Loopback feed worklet — a jitter-absorbing ring between the IPC chunks
// (WASAPI loopback capture from Rust) and the audio graph.
//
// A REAL FILE, not an inline blob: the app's CSP is `script-src 'self'`, and
// a blob: worklet module is exactly the kind of dynamic script it exists to
// block — loading this from a bundled asset keeps the CSP strict AND makes
// live input work in the installed app (the blob path threw "Unable to load
// a worklet's module" there; dev builds carry no CSP, which is why it only
// failed on real installs).
class LoopbackFeed extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = sampleRate * 2;
    this.l = new Float32Array(this.cap);
    this.r = new Float32Array(this.cap);
    this.w = 0; // absolute frames written
    this.rd = 0; // absolute frames read
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
      const maxLag = (sampleRate * 0.25) | 0;
      if (this.w - this.rd > maxLag) this.rd = this.w - (maxLag >> 1);
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
    return true;
  }
}
registerProcessor("loopback-feed", LoopbackFeed);
