import { useMemo, useState } from "react";
import { useVizStore } from "../state/store";
import { getPrefs, setPrefs, type AppPrefs, type PerfOverlayStats } from "../state/prefs";
import { isTauri } from "../state/platform";
import { presets } from "../render/presets";
import { isDefaultPresetOrder } from "../state/presetOrder";
import { APP_VERSION } from "../version";
import type { UpdatePhase } from "../state/updater";
import { useFocusTrap } from "./useFocusTrap";
import { IconClose } from "./Icons";
import { PresetOrderEditor } from "./PresetOrderEditor";
import { SECONDS, Segmented, SelectRow, SliderRow, ToggleRow } from "./kit";

/**
 * App-level settings (Ctrl+,) — preferences about the APP, as opposed to the
 * per-visual settings panel. Backed by the beatform.prefs.v1 object; nothing
 * here touches the project document or the deterministic export path (the
 * FPS cap is live-preview-only by design).
 */
export interface SettingsDialogProps {
  update: UpdatePhase;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  onRelaunch: () => void;
}

type Tab = "general" | "modes" | "performance" | "updates";

/** Built-in defs by id — the strip order is a list of ids, and this turns it
 * back into names/thumbs. Module-level: the registry cannot change at runtime. */
const PRESETS_BY_ID = new Map(presets.map((p) => [p.id, p]));

/** The overlay's per-stat visibility checkboxes, in overlay row order. */
const PERF_STAT_TOGGLES: Array<{ key: keyof PerfOverlayStats; label: string }> = [
  { key: "fps", label: "FPS" },
  { key: "frameTime", label: "Frame time" },
  { key: "renderer", label: "Renderer" },
  { key: "jsHeap", label: "JS heap" },
  { key: "cpu", label: "CPU" },
  { key: "ram", label: "RAM" },
  { key: "disk", label: "Disk I/O" },
  { key: "gpu", label: "GPU" },
];

export function SettingsDialog(props: SettingsDialogProps) {
  const store = useVizStore.getState;
  const dialogRef = useFocusTrap(true);
  const [tab, setTab] = useState<Tab>("general");
  // Prefs are module state, not store state — mirror locally for re-render.
  const [prefs, setLocal] = useState<AppPrefs>(() => getPrefs());
  const apply = (patch: Partial<AppPrefs>) => setLocal(setPrefs(patch));
  // The strip order DOES live in the store, so the chips behind this dialog
  // reorder live as you drag — no "apply" step, no way to leave the two views
  // disagreeing.
  const presetOrder = useVizStore((s) => s.presetOrder);
  const presetThumbs = useVizStore((s) => s.presetThumbs);
  const orderIsDefault = useMemo(() => isDefaultPresetOrder(presetOrder), [presetOrder]);
  const desktop = isTauri();
  const { update } = props;

  return (
    <div className="modal-backdrop" onClick={() => store().setShowSettings(false)}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="App settings"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <span className="panel-heading">App settings</span>
          <button
            className="icon-btn subtle"
            aria-label="Close"
            onClick={() => store().setShowSettings(false)}
          >
            <IconClose size={16} />
          </button>
        </div>

        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Settings section"
          options={[
            { value: "general", label: "General" },
            { value: "modes", label: "Modes" },
            { value: "performance", label: "Performance" },
            { value: "updates", label: "Updates" },
          ]}
        />

        {tab === "general" && (
          <>
            {desktop && (
              <SliderRow
                label="Autosave delay"
                hint="How long after your last edit the crash-recovery autosave is written"
                min={2}
                max={30}
                step={1}
                value={prefs.autosaveIntervalSec}
                onChange={(v) => apply({ autosaveIntervalSec: v })}
                format={SECONDS}
              />
            )}
            <div className="field">
              <span>Save dialogs open in</span>
              <div className="save-look-row">
                <span className="row-value settings-path" title={prefs.lastSaveDir ?? undefined}>
                  {prefs.lastSaveDir ?? "System default"}
                </span>
                {prefs.lastSaveDir && (
                  <button
                    className="text-btn"
                    title="Forget the remembered folder"
                    onClick={() => apply({ lastSaveDir: null })}
                  >
                    Forget
                  </button>
                )}
              </div>
            </div>
            <p className="section-hint">
              Project-specific settings (visuals, sync, background, post…) live in the settings
              panel (G) and save into your project file — this page is preferences about the app
              itself. Beatform stores everything locally and sends no telemetry, ever.
            </p>
          </>
        )}

        {tab === "modes" && (
          <>
            <PresetOrderEditor
              order={presetOrder}
              byId={PRESETS_BY_ID}
              thumbs={presetThumbs}
              isDefault={orderIsDefault}
              onChange={(ids) => store().setPresetOrder(ids)}
              onReset={() => store().resetPresetOrder()}
            />
            <p className="section-hint">
              Order is yours and stays put across restarts and updates. Modes added by a future
              update slot in before Builder rather than disappearing. Your own WGSL visuals always
              follow at the end of the strip.
            </p>
          </>
        )}

        {tab === "performance" && (
          <>
            <div className="field">
              <span>Live preview frame cap</span>
              <Segmented<0 | 30 | 60>
                value={prefs.fpsCap}
                onChange={(v) => apply({ fpsCap: v })}
                ariaLabel="Live preview frame cap"
                options={[
                  { value: 0, label: "Display", hint: "Render at your display's refresh rate" },
                  { value: 60, label: "60", hint: "Cap the live preview at 60 fps" },
                  {
                    value: 30,
                    label: "30",
                    hint: "Cap the live preview at 30 fps — easiest on battery and thermals",
                  },
                ]}
              />
            </div>
            <p className="section-hint">
              Caps only the live preview — exports always render every frame at the exact export
              frame rate, so files are unaffected.
            </p>
            <div className="field">
              <span>Preview resolution</span>
              <Segmented<1 | 0.75 | 0.5>
                value={prefs.previewScale}
                onChange={(v) => apply({ previewScale: v })}
                ariaLabel="Live preview resolution"
                options={[
                  { value: 1, label: "Native", hint: "Render the preview at full resolution" },
                  {
                    value: 0.75,
                    label: "75%",
                    hint: "Render the preview at 75% resolution — a solid FPS boost, barely visible",
                  },
                  {
                    value: 0.5,
                    label: "50%",
                    hint: "Render the preview at half resolution — biggest FPS boost on weak GPUs",
                  },
                ]}
              />
            </div>
            <p className="section-hint">
              Lowers only the live canvas — every export still renders at the exact size you pick in
              the export dialog.
            </p>
            <SelectRow
              label="GPU preference"
              hint="Which adapter the renderer asks for on dual-GPU machines. Takes effect after a restart."
              value={prefs.powerPreference}
              options={[
                { value: "default", label: "Automatic" },
                { value: "high-performance", label: "High performance (discrete GPU)" },
                { value: "low-power", label: "Power saver (integrated GPU)" },
              ]}
              onChange={(v) => apply({ powerPreference: v })}
              parse={(raw) => raw as AppPrefs["powerPreference"]}
            />
            <p className="section-hint">GPU preference applies the next time the app starts.</p>
            <ToggleRow
              label="Performance display"
              hint="Live FPS / CPU / memory readout drawn over the preview"
              checked={prefs.perfOverlay}
              onChange={(v) => apply({ perfOverlay: v })}
            />
            {prefs.perfOverlay && (
              <>
                <SelectRow
                  label="Position"
                  value={prefs.perfOverlayCorner}
                  options={[
                    { value: "top-left", label: "Top left" },
                    { value: "top-right", label: "Top right" },
                    { value: "bottom-left", label: "Bottom left" },
                    { value: "bottom-right", label: "Bottom right" },
                  ]}
                  onChange={(v) => apply({ perfOverlayCorner: v })}
                  parse={(raw) => raw as AppPrefs["perfOverlayCorner"]}
                />
                <div className="field">
                  <span>Size</span>
                  <Segmented<AppPrefs["perfOverlaySize"]>
                    value={prefs.perfOverlaySize}
                    onChange={(v) => apply({ perfOverlaySize: v })}
                    ariaLabel="Performance display size"
                    options={[
                      { value: "s", label: "S" },
                      { value: "m", label: "M" },
                      { value: "l", label: "L" },
                    ]}
                  />
                </div>
                <SelectRow
                  label="Colour"
                  value={prefs.perfOverlayColor}
                  options={[
                    { value: "accent", label: "Theme accent" },
                    { value: "white", label: "White" },
                    { value: "green", label: "Green" },
                    { value: "amber", label: "Amber" },
                  ]}
                  onChange={(v) => apply({ perfOverlayColor: v })}
                  parse={(raw) => raw as AppPrefs["perfOverlayColor"]}
                />
                <div className="field">
                  <span>Stats</span>
                  <div
                    role="group"
                    aria-label="Performance display stats"
                    style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}
                  >
                    {PERF_STAT_TOGGLES.map((s) => (
                      <label
                        key={s.key}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                      >
                        <input
                          type="checkbox"
                          checked={prefs.perfOverlayStats[s.key]}
                          onChange={(e) =>
                            apply({
                              perfOverlayStats: {
                                ...prefs.perfOverlayStats,
                                [s.key]: e.target.checked,
                              },
                            })
                          }
                        />
                        {s.label}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
            <p className="section-hint">
              The performance display is a live diagnostic drawn over the preview only — it is never
              part of the rendered frame, so it can't appear in exports.
            </p>
          </>
        )}

        {tab === "updates" && (
          <>
            <div className="field">
              <span>Current version</span>
              <span className="row-value">v{APP_VERSION}</span>
            </div>
            {desktop ? (
              <>
                <ToggleRow
                  label="Check for updates automatically"
                  hint="A plain fetch of a static file on GitHub shortly after launch — no telemetry"
                  checked={prefs.updateAutoCheck}
                  onChange={(v) => apply({ updateAutoCheck: v })}
                />
                <div className="update-line">
                  {update.state === "available" ? (
                    <>
                      <span>Version {update.version} is available</span>
                      <button className="ghost-btn accent" onClick={props.onInstallUpdate}>
                        Update now
                      </button>
                    </>
                  ) : update.state === "downloading" ? (
                    <span aria-live="polite">
                      Downloading update…{" "}
                      {update.total
                        ? `${Math.round((update.received / update.total) * 100)}%`
                        : `${(update.received / 1e6).toFixed(0)} MB`}
                    </span>
                  ) : update.state === "ready" ? (
                    <>
                      <span>Version {update.version} installed</span>
                      <button className="ghost-btn accent" onClick={props.onRelaunch}>
                        Restart now
                      </button>
                    </>
                  ) : (
                    <>
                      <span aria-live="polite">
                        {update.state === "checking"
                          ? "Checking for updates…"
                          : update.state === "none"
                            ? "You're on the newest version"
                            : update.state === "error"
                              ? `Update check failed: ${update.message}`
                              : ""}
                      </span>
                      <button
                        className="ghost-btn"
                        disabled={update.state === "checking"}
                        onClick={props.onCheckUpdate}
                      >
                        Check for updates
                      </button>
                    </>
                  )}
                </div>
                <p className="section-hint">
                  Updates download from GitHub Releases and are verified against a signing key built
                  into the app before anything installs.
                </p>
              </>
            ) : (
              <p className="section-hint">
                Updates apply to the desktop app — grab installers from the GitHub releases page.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
