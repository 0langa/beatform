import { useMemo, useSyncExternalStore } from "react";
import { useVizStore } from "../state/store";
import { orderedPresets } from "../state/presetOrder";
import { QUANTIZE_MODES } from "../state/quantize";
import { bindingId } from "../state/midi";
import { midiSupported } from "../state/midiInput";
import { isTauri } from "../state/platform";
import { getPrefs, subscribePrefs } from "../state/prefs";
import { monitorLabel } from "../state/slices/performActions";
import { presetById, presets as builtinPresets } from "../render/presets";
import { allParams } from "../render/types";
import type { SyncMode } from "../audio/types";
import { Segmented } from "./kit";
import { Switch } from "./Switch";
import { IconClose } from "./Icons";

/**
 * P-4 — the Perform drawer: the operator console for live sets, and
 * FEAT-009's second-display controls in the same room. The Visuals ▸ Live
 * page CONFIGURES (CC learn with its param picker, quantize explanation);
 * this drawer PERFORMS: big pads, blackout, the output window.
 *
 * Deliberately NOT `.chrome` and mounted above the blackout overlay: it is
 * summoned from inside Stage mode (D), and the control that undoes a
 * blackout must never be hidden by one.
 */

const MIDI_SUPPORTED = midiSupported();

/** The sync-source row reuses the Sync page's vocabulary (labels only — the
 * full hints live there; the drawer is for reaching, not learning). */
const SYNC_CHOICES: Array<{ mode: SyncMode; label: string }> = [
  { mode: "kick", label: "Kicks" },
  { mode: "energy", label: "Energy" },
  { mode: "bass", label: "Bass" },
  { mode: "melody", label: "Melody" },
  { mode: "voice", label: "Voice" },
  { mode: "treble", label: "Treble" },
  { mode: "snare", label: "Snare" },
  { mode: "hats", label: "Hats" },
];

export function PerformDrawer() {
  const presetId = useVizStore((s) => s.presetId);
  const pendingId = useVizStore((s) => s.pendingPresetId);
  const thumbs = useVizStore((s) => s.presetThumbs);
  const presetOrder = useVizStore((s) => s.presetOrder);
  const customDefs = useVizStore((s) => s.customDefs);
  const switchQuantize = useVizStore((s) => s.switchQuantize);
  const blackout = useVizStore((s) => s.blackout);
  const stageMode = useVizStore((s) => s.stageMode);
  const performOpen = useVizStore((s) => s.performOpen);
  const performMonitors = useVizStore((s) => s.performMonitors);
  const syncMode = useVizStore((s) => s.sync.mode);
  const midiEnabled = useVizStore((s) => s.midiEnabled);
  const midiBindings = useVizStore((s) => s.midiBindings);
  const midiLearn = useVizStore((s) => s.midiLearn);
  const store = useVizStore.getState;
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs);

  const all = useMemo(() => orderedPresets(presetOrder, customDefs), [presetOrder, customDefs]);
  const pads = all.slice(0, 9);
  const desktop = isTauri();
  const activePreset = presetById(presetId);
  const blackoutArmed = stageMode || performOpen;
  const noteLearnArmed = midiLearn?.kind === "note";

  return (
    <div className="perform-drawer" role="region" aria-label="Perform">
      <div className="perform-drawer-head">
        <span className="panel-heading">Perform</span>
        <span className="perform-drawer-hint">
          1–9 switch modes{switchQuantize !== "off" ? ` on the next ${switchQuantize}` : ""} · 0
          cuts to black
        </span>
        <button
          className="icon-btn subtle"
          aria-label="Close the Perform drawer"
          title="Close (D or Esc)"
          onClick={() => store().setShowPerform(false)}
        >
          <IconClose size={15} />
        </button>
      </div>

      <div className="perform-drawer-body">
        {/* -------- mode pads ------------------------------------------ */}
        <div className="perform-pads" role="group" aria-label="Mode pads">
          {pads.map((p, i) => {
            const active = p.id === presetId;
            const pending = p.id === pendingId;
            const thumb = thumbs?.[p.id];
            return (
              <button
                key={p.id}
                className={`perform-pad ${active ? "active" : ""} ${pending ? "pending" : ""}`}
                title={`${p.name} (${i + 1})`}
                aria-pressed={active}
                onClick={() => store().queuePreset(p.id)}
              >
                {thumb && <img className="perform-pad-thumb" src={thumb} alt="" />}
                <span className="perform-pad-num">{i + 1}</span>
                <span className="perform-pad-name">{p.name}</span>
              </button>
            );
          })}
        </div>

        <div className="perform-columns">
          {/* -------- cut & switch ------------------------------------- */}
          <section className="perform-section" aria-label="Cut and switch">
            <button
              className={`perform-blackout-btn ${blackout ? "engaged" : ""}`}
              disabled={!blackoutArmed}
              aria-pressed={blackout}
              title={
                blackoutArmed
                  ? "Cut the output to black (0)"
                  : "Blackout arms in Stage mode or with the performance window open"
              }
              onClick={() => store().setBlackout(!blackout)}
            >
              {blackout ? "Blacked out — tap to restore" : "Blackout"}
            </button>
            <div className="perform-row">
              <span className="row-label">Quantize</span>
              <Segmented
                value={switchQuantize}
                onChange={(m) => store().setSwitchQuantize(m)}
                ariaLabel="Switch quantize"
                options={QUANTIZE_MODES.map((m) => ({
                  value: m,
                  label: m === "off" ? "Off" : m === "beat" ? "Beat" : "Bar",
                }))}
              />
            </div>
            <div className="perform-row">
              <span className="row-label">Sync</span>
              <select
                className="select"
                value={syncMode}
                title="What the visuals react to"
                onChange={(e) =>
                  store().setSync({ ...store().sync, mode: e.target.value as SyncMode })
                }
              >
                {SYNC_CHOICES.map((c) => (
                  <option key={c.mode} value={c.mode}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* -------- second display ----------------------------------- */}
          <section className="perform-section" aria-label="Second display">
            <div className="perform-row">
              <span className={`perform-dot ${performOpen ? "live" : ""}`} aria-hidden="true" />
              <span className="row-label">
                {performOpen ? "Performance window live" : "Performance window"}
              </span>
              {desktop ? (
                <button
                  className={`text-btn ${performOpen ? "" : "accent"}`}
                  title={
                    performOpen
                      ? "Close the performance window"
                      : "Open a clean output window on the chosen display"
                  }
                  onClick={() =>
                    performOpen
                      ? void store().closePerformWindow()
                      : void store().openPerformWindow()
                  }
                >
                  {performOpen ? "Close" : "Open"}
                </button>
              ) : (
                <span className="perform-drawer-hint">desktop app only</span>
              )}
            </div>
            <div className="perform-row">
              <span className="row-label">Display</span>
              <select
                className="select"
                disabled={!desktop}
                value={prefs.performMonitor ?? -1}
                title="Which monitor the performance window targets (re-listed each time the drawer opens)"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  void store().setPerformMonitor(v < 0 ? null : v);
                }}
              >
                <option value={-1}>Auto (largest secondary)</option>
                {performMonitors.map((m) => (
                  <option key={m.index} value={m.index}>
                    {monitorLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="perform-row">
              <span className="row-label">Fullscreen</span>
              <Switch
                checked={prefs.performFullscreen}
                disabled={!desktop}
                label="Fullscreen performance window"
                title="Fullscreen on the target display (Esc in the window steps back out)"
                onChange={(v) => void store().setPerformFullscreen(v)}
              />
            </div>
            <div className="perform-row">
              <span className="row-label">Mode HUD</span>
              <Switch
                checked={prefs.performHud}
                disabled={!desktop && !prefs.performHud}
                label="Preset-name flash on the output"
                title="Flash the mode name on the output when it changes (off = fully clean feed)"
                onChange={(v) => store().setPerformHud(v)}
              />
            </div>
          </section>

          {/* -------- MIDI mappings, live ------------------------------ */}
          {MIDI_SUPPORTED && (
            <section className="perform-section" aria-label="MIDI">
              <div className="perform-row">
                <span className="row-label">MIDI</span>
                {midiEnabled ? (
                  <button
                    className={`text-btn ${noteLearnArmed ? "accent" : ""}`}
                    title={`Bind a controller note/pad to ${activePreset.name} — press it after arming`}
                    onClick={() =>
                      noteLearnArmed
                        ? store().setMidiLearn(null)
                        : store().setMidiLearn({ kind: "note", presetId })
                    }
                  >
                    {noteLearnArmed ? "Play a note…" : `Learn note → ${activePreset.name}`}
                  </button>
                ) : (
                  <button
                    className="text-btn"
                    title="Grant MIDI access and start listening"
                    onClick={() => void store().enableMidi()}
                  >
                    Enable MIDI…
                  </button>
                )}
              </div>
              {midiEnabled && midiBindings.length === 0 && (
                <p className="perform-drawer-hint">
                  No mappings yet — CC learn (knobs → params) lives on Visuals ▸ Live.
                </p>
              )}
              {midiEnabled && (
                <div className="perform-midi-list">
                  {midiBindings.map((b) => {
                    const label =
                      b.kind === "cc"
                        ? `CC ${b.cc} → ${
                            allParams(activePreset).find((p) => p.key === b.param)?.label ?? b.param
                          }`
                        : `Note ${b.note} → ${
                            builtinPresets.find((p) => p.id === b.presetId)?.name ??
                            customDefs.find((p) => p.id === b.presetId)?.name ??
                            b.presetId
                          }`;
                    const id = bindingId(b);
                    return (
                      <div key={id} className="perform-midi-row">
                        <span className="perform-midi-label">{label}</span>
                        <button
                          className="chip-x"
                          title="Remove this mapping"
                          aria-label={`Remove ${label}`}
                          onClick={() => store().removeMidiBinding(id)}
                        >
                          <IconClose size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
