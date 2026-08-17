/**
 * FEAT-009 — is this page the performance-output window?
 *
 * Two signals, either wins:
 *  - the Tauri window label ("perform", assigned by the Rust
 *    WebviewWindowBuilder), read synchronously off __TAURI_INTERNALS__ so
 *    the decision happens before any chunk loads;
 *  - a `?perform` query flag, the browser-dev affordance: `npm run dev`
 *    plus a second tab at `/?perform=1` exercises the whole mirror bridge
 *    with no desktop shell and no second display.
 *
 * main.tsx branches on this into two DYNAMIC imports, so the performance
 * window never evaluates the store/persistence modules — one persistence
 * writer per app, by construction.
 */
export function isPerformContext(search: string, label: string | null): boolean {
  return label === "perform" || new URLSearchParams(search).has("perform");
}

/** The current Tauri window label, or null outside the desktop shell.
 * Reads the same internals field @tauri-apps/api/window's
 * getCurrentWindow() uses, without pulling the API into the entry chunk. */
export function currentWindowLabel(): string | null {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
  };
  return w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null;
}
