import { useEffect, useRef, useState } from "react";
import {
  startPerformRuntime,
  type PerformRuntimeStats,
  type PerformSceneView,
  type PerformStatus,
} from "./performRuntime";
import "./perform.css";

/**
 * FEAT-009 — the performance window's entire UI: a canvas, a blackout
 * cover, an optional preset-name HUD, and a waiting card. No store, no
 * panels, no dialogs — the operator console is the PRIMARY window's Perform
 * drawer; this surface exists to be projected.
 */

/** Local, dependency-free isTauri — the perform chunk must not pull
 * state/platform.ts (which drags the prefs module) for one boolean. */
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Best-effort window command — the perform window owns no window chrome of
 * its own; Esc/double-click delegate to the Rust owner. In the browser dev
 * tab this is a no-op (close the tab like any tab). */
function invokePerform(cmd: "perform_escape" | "perform_toggle_fullscreen"): void {
  if (!inTauri) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke(cmd))
    .catch((e) => console.warn("[perform]", cmd, e));
}

export function PerformApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<PerformStatus>({
    phase: "waiting",
    renderer: null,
    warning: null,
  });
  const [scene, setScene] = useState<PerformSceneView>({
    blackout: false,
    hud: false,
    aspect: "free",
  });
  const [hudName, setHudName] = useState<string | null>(null);
  const [hudKey, setHudKey] = useState(0);

  useEffect(() => {
    const handle = startPerformRuntime(canvasRef.current!, {
      onStatus: setStatus,
      onScene: setScene,
      onPresetName: (name) => {
        setHudName(name);
        setHudKey((k) => k + 1); // re-mount replays the fade, stage-HUD style
      },
    });
    // Measurement probe for the lane's device evidence + E2E tooling — the
    // same ungated-window-global idiom as the primary's __vizFrames.
    (window as unknown as { __performStats?: () => PerformRuntimeStats }).__performStats =
      handle.getStats;
    return () => handle.dispose();
  }, []);

  // Esc: fullscreen → windowed first, then close (perform_escape owns the
  // ladder). The listener is the whole keyboard surface of this window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") invokePerform("perform_escape");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ar = scene.aspect === "16:9" ? "1.77778" : scene.aspect === "9:16" ? "0.5625" : "1";
  return (
    <div
      className="perform-root"
      // A stray file drop must not navigate the output webview mid-show.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      onDoubleClick={() => invokePerform("perform_toggle_fullscreen")}
    >
      <div
        className={`perform-stage ${scene.aspect !== "free" ? "fixed-aspect" : ""}`}
        style={{ "--ar": ar } as React.CSSProperties}
      >
        <canvas ref={canvasRef} className="perform-canvas" aria-label="Performance output" />
      </div>
      {scene.blackout && <div className="perform-blackout" />}
      {scene.hud && !scene.blackout && hudName && (
        <div className="perform-hud" key={hudKey}>
          {hudName}
        </div>
      )}
      {status.phase === "waiting" && !scene.blackout && (
        <div className="perform-waiting" role="status">
          <div className="perform-waiting-title">Beatform</div>
          <div className="perform-waiting-text">
            Performance output — waiting for the main window
          </div>
        </div>
      )}
      {status.warning && status.phase === "live" && !scene.blackout && (
        <div className="perform-warning">{status.warning}</div>
      )}
    </div>
  );
}
