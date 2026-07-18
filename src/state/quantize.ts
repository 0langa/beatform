/**
 * Beat-quantized preset takeover (live performance). A queued switch lands on
 * the next musical boundary — a beat, or a bar (every 4th beat, matching the
 * grid's bar phase in beatGrid.ts) — Ableton-session-launch style.
 *
 * Live-only: this drives on-stage interaction, never export. Exports stay
 * timeline-driven and byte-reproducible, so nothing here touches the render
 * frame path's determinism.
 */
export type QuantizeMode = "off" | "beat" | "bar";

export const QUANTIZE_MODES: QuantizeMode[] = ["off", "beat", "bar"];

export function isQuantizeMode(v: unknown): v is QuantizeMode {
  return v === "off" || v === "beat" || v === "bar";
}

/**
 * Did a quantize boundary fall in the half-open interval (prev, cur]?
 *
 * Frames are ~16 ms and beats hundreds of ms apart, so at most one boundary
 * lands per frame; we only need a boolean "fire now". `prev >= cur` (a pause or
 * a backward seek) never fires. `mode === "off"` never fires — the caller
 * switches immediately instead.
 *
 * For "bar" the boundary is every 4th beat starting at beat index 0, i.e. the
 * downbeats implied by beatGrid's `barPhase = ((i % 4) + beatPhase) / 4`.
 */
export function crossedBoundary(
  beatTimes: ArrayLike<number>,
  prev: number,
  cur: number,
  mode: QuantizeMode,
): boolean {
  if (mode === "off") return false;
  if (!(cur > prev)) return false;
  const stride = mode === "bar" ? 4 : 1;
  for (let i = 0; i < beatTimes.length; i += stride) {
    const t = beatTimes[i];
    if (t <= prev) continue;
    if (t <= cur) return true;
    // beatTimes is ascending, so the first one past `cur` ends the search.
    break;
  }
  return false;
}

/**
 * Can a queued switch ever land, given where we are now? False when there is no
 * usable grid, or the playhead is already at/after the last relevant boundary
 * (so no future boundary exists) — the caller should then switch immediately
 * rather than queue a switch that would hang forever.
 */
export function hasFutureBoundary(
  beatTimes: ArrayLike<number>,
  cur: number,
  mode: QuantizeMode,
): boolean {
  if (mode === "off" || beatTimes.length < 2) return false;
  const stride = mode === "bar" ? 4 : 1;
  for (let i = 0; i < beatTimes.length; i += stride) {
    if (beatTimes[i] > cur) return true;
  }
  return false;
}
