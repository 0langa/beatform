/**
 * Stereo width from L/R correlation over a sample window:
 * 0 = mono (fully correlated), 1 = fully decorrelated or anti-phase wide.
 * Deterministic pure function — shared by the realtime and offline paths.
 */
export function stereoWidth(l: Float32Array, r: Float32Array): number {
  const n = Math.min(l.length, r.length);
  if (n === 0) return 0;
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < n; i++) {
    lr += l[i] * r[i];
    ll += l[i] * l[i];
    rr += r[i] * r[i];
  }
  const denom = Math.sqrt(ll * rr);
  if (denom < 1e-9) return 0; // silence (or one dead channel)
  const corr = lr / denom; // -1..1
  return Math.min(1, Math.max(0, 1 - Math.max(0, corr)));
}
