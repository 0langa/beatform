import { useState } from "react";
import { useVizStore } from "../state/store";
import { getPrefs, setPrefs, type AppPrefs } from "../state/prefs";
import { isTauri } from "../state/platform";
import { APP_VERSION } from "../version";
import type { UpdatePhase } from "../state/updater";
import { useFocusTrap } from "./useFocusTrap";
import { IconClose } from "./Icons";
import { Segmented, SelectRow, SliderRow, ToggleRow } from "./kit";

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

type Tab = "general" | "performance" | "updates";

export function SettingsDialog(props: SettingsDialogProps) {
  const store = useVizStore.getState;
  const dialogRef = useFocusTrap(true);
  const [tab, setTab] = useState<Tab>("general");
  // Prefs are module state, not store state — mirror locally for re-render.
  const [prefs, setLocal] = useState<AppPrefs>(() => getPrefs());
  const apply = (patch: Partial<AppPrefs>) => setLocal(setPrefs(patch));
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
                format={(v) => `${v} s`}
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
