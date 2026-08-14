import { useVizStore } from "../state/store";
import { selectBpm, selectKeyName } from "../state/selectors";

/**
 * The Visuals footer's readout badges — renderer backend, tempo, key,
 * loudness.
 *
 * Its own component purely for SUBSCRIPTION GRANULARITY: `lufs` ticks at 4 Hz
 * for the whole of playback, and reading it at the Visuals top level would
 * put the panel's ~2,000 lines back on that tick — which is exactly the cost
 * the store-direct migration exists to remove. Everything here is read by
 * nothing else in the panel, so the four-badge subtree is the only thing that
 * reconciles.
 *
 * `simplifiedRenderer` is deliberately subscribed BOTH here and at the panel's
 * top level: it cross-cuts every tab (it disables Post, the Motion masters,
 * Builder Studio and the Video background), so it is not this component's to
 * own. It changes at most once per session.
 *
 * The rendered TEXT is byte-identical to the pre-extraction footer — same
 * elements, classNames, text and order. `npm run test:gpu` reads
 * `.params-panel`'s textContent and runs an a11y audit over it, so drift here
 * surfaces inside the pixel-hash gate as a failure that reads like a shader
 * regression. The `title`s are the one thing that has moved since (P-10): they
 * are not textContent, so the gate does not see them.
 *
 * EVERY TOOLTIP BELOW IS DERIVED FROM THE PIPELINE, NOT FROM THE LABEL, and
 * each one names its measurement's basis — a badge that states the wrong basis
 * is worse than a bare number. The four sources, so the next edit can re-check
 * them rather than trust this comment:
 *
 *  - backend  — `rendererKind` is `Renderer["kind"]` ("webgpu" | "canvas2d"),
 *    written by `onRendererChanged` on every renderer swap, including the
 *    rebuild after a GPU device loss (state/store.ts:1241-1257, services.ts:265).
 *  - BPM      — `beatGrid.bpm` from `analyzeBeatGrid`: offline spectral-flux
 *    onsets, autocorrelation, 60-200 BPM, ONE value for the whole track
 *    (audio/analysis/beatGrid.ts:4-28). Computed once per loaded FILE
 *    (store.ts:2288) and explicitly nulled for live system audio
 *    (store.ts:1948-1952). Hidden even with a grid present when it has no
 *    usable pulse — `selectBpm` returns null for `beatTimes.length < 2`, the
 *    same "no grid" floor `gridPhase` uses, so a silent/DC track's spurious
 *    tempo (detection still scores SOME lag) never becomes a claim here.
 *  - key      — `trackKey.name` from `estimateKey`: chromagram averaged over
 *    the whole track, correlated with the Krumhansl-Kessler profiles over 24
 *    rotations; null when the chroma is too flat to call
 *    (audio/analysis/keyDetect.ts:3-8, 60-114). Same file-only lifecycle.
 *  - LUFS     — MOMENTARY, verified: both sources feed the pipeline
 *    `this.meter.momentary` (realtimeSource.ts:303, offlineSource.ts:448) and
 *    that getter is a 400 ms ring (dsp/lufs.ts:96-141). It is NOT the
 *    integrated figure export normalisation targets (exportCore.ts imports
 *    `integratedLufs`). The meter taps the engine's unity-gain node, upstream
 *    of the volume gain (audio/engine.ts:57-59, 113-128), so volume and mute
 *    never move it; `onMeter` only fires while playing (services.ts:520-523),
 *    so it holds its last reading when paused.
 */
export function PanelFooterBadges() {
  const simplifiedRenderer = useVizStore((s) => s.simplifiedRenderer);
  const rendererKind = useVizStore((s) => s.rendererKind);
  const bpm = useVizStore(selectBpm);
  const keyName = useVizStore(selectKeyName);
  const lufs = useVizStore((s) => s.lufs);

  return (
    <>
      {/* The backend id is developer shorthand — fine as a badge while it
          reads "webgpu" and everything works, useless as the ONLY signal
          that the app has quietly stopped drawing what you asked for (F1).
          On the fallback it says so in words, in the app's warning colour. */}
      <span
        className={`renderer-badge ${simplifiedRenderer ? "danger" : ""}`}
        title={
          simplifiedRenderer
            ? "Simplified renderer — hardware rendering (WebGPU) is unavailable, so every mode draws the same spectrum bars and video export is off"
            : "Graphics backend currently drawing the preview. “webgpu” is the hardware path: every visual mode, post-processing, Builder and video export are available. Re-read on every renderer swap, including the rebuild after a GPU reset."
        }
      >
        {simplifiedRenderer ? "simplified" : rendererKind}
      </span>
      {bpm !== null && bpm > 0 && (
        <span
          className="renderer-badge"
          title="Track tempo, detected once from the loaded file (onset autocorrelation, 60-200 BPM) and held constant for the whole track. Drives beat-synced motion and beat-quantised mode switches. Live system audio has no grid, so no tempo is shown."
        >
          {bpm.toFixed(bpm % 1 === 0 ? 0 : 1)} BPM
        </span>
      )}
      {keyName && (
        <span
          className="renderer-badge"
          title="Musical key, estimated once from the whole file: the average chromagram matched against the Krumhansl-Kessler major/minor profiles. Coarse by design, and shown only when the track is tonal enough to call. Live system audio is not analysed."
        >
          {keyName}
        </span>
      )}
      {lufs !== null && (
        <span
          className="renderer-badge"
          title="Momentary loudness — the last 400 ms, K-weighted per ITU-R BS.1770. Not the integrated figure export normalisation targets. Measured ahead of the volume gain, so volume and mute never move it, and it holds its last reading while paused. Streaming targets sit around -14 LUFS."
        >
          {lufs <= -70 ? "−∞" : lufs.toFixed(1)} LUFS
        </span>
      )}
    </>
  );
}
