import { currentWindowLabel, isPerformContext } from "./perform/context";

/**
 * Entry branch (FEAT-009): the performance-output window (Tauri label
 * "perform", or `?perform` in browser dev) mounts the mirror surface; every
 * other context mounts the app. BOTH branches are dynamic imports on
 * purpose — a static `import App` would evaluate the store/persistence
 * modules in the performance window too, making it a second localStorage/
 * autosave writer. The one-microtask cost on the main path hides behind the
 * desktop boot veil.
 */
const rootEl = document.getElementById("root") as HTMLElement;
if (isPerformContext(window.location.search, currentWindowLabel())) {
  void import("./perform/performMain").then((m) => m.mountPerform(rootEl));
} else {
  void import("./appMain").then((m) => m.mountApp(rootEl));
}
