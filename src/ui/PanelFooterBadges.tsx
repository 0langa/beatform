import { useVizStore } from "../state/store";
import { selectBpm, selectKeyName } from "../state/selectors";

/**
 * The Inspector footer's readout badges — renderer backend, tempo, key,
 * loudness.
 *
 * Its own component purely for SUBSCRIPTION GRANULARITY: `lufs` ticks at 4 Hz
 * for the whole of playback, and reading it at the Inspector's top level would
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
 * The rendered DOM is byte-identical to the pre-extraction footer — same
 * elements, classNames, titles, text and order. `npm run test:gpu` reads
 * `.params-panel`'s textContent and runs an a11y audit over it, so drift here
 * surfaces inside the pixel-hash gate as a failure that reads like a shader
 * regression.
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
            : "Active render backend"
        }
      >
        {simplifiedRenderer ? "simplified" : rendererKind}
      </span>
      {bpm !== null && bpm > 0 && (
        <span className="renderer-badge" title="Detected tempo (beat grid)">
          {bpm.toFixed(bpm % 1 === 0 ? 0 : 1)} BPM
        </span>
      )}
      {keyName && (
        <span className="renderer-badge" title="Detected musical key (Krumhansl profile match)">
          {keyName}
        </span>
      )}
      {lufs !== null && (
        <span
          className="renderer-badge"
          title="Momentary loudness (BS.1770). Streaming targets sit around -14 LUFS."
        >
          {lufs <= -70 ? "−∞" : lufs.toFixed(1)} LUFS
        </span>
      )}
    </>
  );
}
