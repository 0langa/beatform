/**
 * Auto-update via the Tauri updater plugin + GitHub Releases.
 *
 * The endpoint (latest.json on the newest GitHub release) and the minisign
 * public key live in tauri.conf.json; the plugin verifies every downloaded
 * payload against that key before it will install. Desktop-only — every
 * entry point here no-ops (resolves null) in the browser build.
 *
 * THIS MODULE OWNS THE WHOLE UPDATE MACHINE (G5): the live `Update` handle,
 * the user-facing phase, the one-per-boot prompt flag, and the transitions
 * between them. Until v2.85 the handle lived here and the phase lived in
 * `App.tsx` as `useState`, which cost two things:
 *
 *  - Every progress callback of a ~100 MB download re-rendered App's whole
 *    body — the top bar, the mode strip, the player bar, the dock — because
 *    that is what a `setState` in App does. The phase now notifies its own
 *    subscribers and nothing else.
 *  - `SettingsDialog` took the phase and three callbacks as props, the last
 *    prop-drilling into an otherwise store-direct dialog (P-12 wave 1).
 *
 * It is deliberately NOT in the zustand store, for the same two reasons the
 * `Update` handle never was. (1) The handle is a live plugin resource that
 * cannot be serialized and must stay module-scoped; splitting a machine so
 * that its data sits in the store and its resource sits here is exactly the
 * kind of two-owner arrangement that drifts. (2) zustand runs EVERY
 * subscriber's selector on EVERY `set()`, so putting a per-chunk download
 * counter in the store would sweep every subscriber in the app hundreds of
 * times per install — the same objection that keeps the params panel's
 * pointer-rate `hint` out of the store (BACKLOG G3). The emitter below is the
 * `state/prefs.ts` shape (`subscribe` + a stable snapshot getter, read through
 * `useSyncExternalStore`), which is this repo's established answer for module
 * state that React must re-render on.
 */
import { isTauri } from "./platform";
import { getPrefs } from "./prefs";
import type { Update } from "@tauri-apps/plugin-updater";

let current: Update | null = null;

export interface AvailableUpdate {
  version: string;
  notes: string | null;
}

/** User-facing updater phase, rendered in Preferences › Updates and in the
 * startup prompt. Kept as plain data — the live Update handle stays private
 * to this module. */
export type UpdatePhase =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "none" } // checked; already the newest build
  | { state: "available"; version: string; notes: string | null }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "ready"; version: string } // installed; relaunch to finish
  | { state: "error"; message: string };

/** How long after boot the silent check runs. Late enough that it never
 * competes with the first paint or the renderer's device request. */
const STARTUP_CHECK_DELAY_MS = 5000;

let phase: UpdatePhase = { state: "idle" };
/** Startup-found updates open a one-per-boot prompt; manual checks report
 * inside Preferences instead, so the two flows never fight. */
let promptOpen = false;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to phase/prompt changes; returns the unsubscribe. Shape matches
 * React's useSyncExternalStore(subscribeUpdate, getUpdatePhase). */
export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam only — never called by the app. A React reader that stopped
 * unsubscribing (a hand-rolled `useEffect` in place of `useSyncExternalStore`,
 * say) would leave a dead listener here to be woken by every chunk of every
 * future download, with nothing on screen to show for it. */
export function __updateListenerCount(): number {
  return listeners.size;
}

/** The phase, as a reference that changes only on a real transition. That is
 * the `useSyncExternalStore` contract, and it is load-bearing rather than
 * tidy: a getter that ALLOCATED would hand React a fresh value on every
 * notification and loop it to "Maximum update depth exceeded" — the
 * useSyncExternalStore spelling of the allocating-zustand-selector crash. */
export function getUpdatePhase(): UpdatePhase {
  return phase;
}

/** Is the startup prompt showing? Its own snapshot rather than a field of a
 * combined object, so a download tick does not re-render whoever only cares
 * whether the dialog is mounted. */
export function isUpdatePromptOpen(): boolean {
  return promptOpen;
}

/**
 * Drive the machine directly. The DEV hook (`window.__setUpdatePhase`) points
 * here so the browser harness can exercise the prompt, which otherwise needs
 * an installed build plus a newer published release.
 */
export function setUpdatePhase(next: UpdatePhase, open = true): void {
  phase = next;
  promptOpen = open;
  emit();
}

export function dismissUpdatePrompt(): void {
  if (!promptOpen) return;
  promptOpen = false;
  emit();
}

/** Ask the endpoint whether a newer signed build exists. Null = up to date
 * (or not on desktop). Throws on network/endpoint failure — `runUpdateCheck`
 * decides whether that is silent (startup) or surfaced (manual check). */
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

/**
 * Check, and move the phase. `manual` is the difference between the two
 * surfaces: an automatic check opens the startup prompt on a find and stays
 * SILENT on failure (being offline at boot is not news), while a manual check
 * reports both outcomes inline in Preferences and never opens the prompt.
 */
export async function runUpdateCheck(manual: boolean): Promise<void> {
  phase = { state: "checking" };
  emit();
  try {
    const found = await checkForUpdate();
    phase = found ? { state: "available", ...found } : { state: "none" };
    if (found && !manual) promptOpen = true;
  } catch (e) {
    phase = manual ? { state: "error", message: (e as Error).message } : { state: "idle" };
  }
  emit();
}

/** Download + install the update found by checkForUpdate. Progress reports
 * bytes received / total (total may be unknown). Resolves when the installer
 * has run; the app must relaunch to pick it up. */
let installing = false;

export async function downloadAndInstallUpdate(
  onProgress: (received: number, total: number | null) => void,
): Promise<void> {
  if (!current) throw new Error("No update staged — check first");
  // Two surfaces can trigger an install (startup prompt + Settings). The
  // flag is claimed synchronously before the first await, so a double
  // invoke during the download window is a no-op instead of a second
  // downloadAndInstall on the same consumed handle (audit UP3/S5).
  if (installing) return;
  installing = true;
  let received = 0;
  let total: number | null = null;
  try {
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
  } finally {
    installing = false;
  }
}

/** Install what the last check found, moving the phase as it goes. The
 * version is read off the CURRENT phase rather than passed in: `downloading`
 * does not carry it, so "ready" would otherwise have nothing to name. */
export async function installUpdate(): Promise<void> {
  const version = phase.state === "available" ? phase.version : "";
  phase = { state: "downloading", received: 0, total: null };
  emit();
  try {
    await downloadAndInstallUpdate((received, total) => {
      phase = { state: "downloading", received, total };
      emit();
    });
    phase = { state: "ready", version };
  } catch (e) {
    phase = { state: "error", message: (e as Error).message };
  }
  emit();
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/**
 * Arm the silent post-boot check, honouring the desktop-only and
 * `updateAutoCheck` gates. Returns the canceller, so a caller can hand it
 * straight back from a React effect.
 */
export function scheduleStartupUpdateCheck(): () => void {
  if (!isTauri() || !getPrefs().updateAutoCheck) return () => {};
  const timer = setTimeout(() => void runUpdateCheck(false), STARTUP_CHECK_DELAY_MS);
  return () => clearTimeout(timer);
}
