/**
 * Auto-update via the Tauri updater plugin + GitHub Releases.
 *
 * The endpoint (latest.json on the newest GitHub release) and the minisign
 * public key live in tauri.conf.json; the plugin verifies every downloaded
 * payload against that key before it will install. Desktop-only — every
 * entry point here no-ops (resolves null) in the browser build.
 *
 * The Update handle is kept module-scoped rather than in the store: it is a
 * live plugin resource, not serializable state. The store only mirrors the
 * user-facing phase (see UpdatePhase in store.ts).
 */
import { isTauri } from "./platform";
import type { Update } from "@tauri-apps/plugin-updater";

let current: Update | null = null;

export interface AvailableUpdate {
  version: string;
  notes: string | null;
}

/** User-facing updater phase, rendered in the Help modal (and later the
 * Settings page). Kept as plain data — the live Update handle stays here. */
export type UpdatePhase =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "none" } // checked; already the newest build
  | { state: "available"; version: string; notes: string | null }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "ready"; version: string } // installed; relaunch to finish
  | { state: "error"; message: string };

/** Ask the endpoint whether a newer signed build exists. Null = up to date
 * (or not on desktop). Throws on network/endpoint failure — callers decide
 * whether that is silent (startup) or surfaced (manual check). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) {
    current = null;
    return null;
  }
  current = update;
  return { version: update.version, notes: update.body ?? null };
}

/** Download + install the update found by checkForUpdate. Progress reports
 * bytes received / total (total may be unknown). Resolves when the installer
 * has run; the app must relaunch to pick it up. */
export async function downloadAndInstallUpdate(
  onProgress: (received: number, total: number | null) => void,
): Promise<void> {
  if (!current) throw new Error("No update staged — check first");
  let received = 0;
  let total: number | null = null;
  await current.downloadAndInstall((e) => {
    if (e.event === "Started") {
      total = e.data.contentLength ?? null;
      onProgress(0, total);
    } else if (e.event === "Progress") {
      received += e.data.chunkLength;
      onProgress(received, total);
    } else if (e.event === "Finished") {
      onProgress(total ?? received, total);
    }
  });
  current = null;
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
