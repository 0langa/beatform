/**
 * Poll the native capture's death flag while system-audio listening runs.
 *
 * Rust's `loopback_died` (src-tauri/src/loopback.rs) turns true when cpal's
 * error callback loses the device; nothing pushes that to the page, so the
 * store polls it once a second and tears the session down the moment it
 * reads true (HD-16 — before this, a yanked device left the broadcast icon
 * lit over silence until the user clicked it). Pure wiring with injectable
 * timers so the cadence and the one-shot contract are unit-tested.
 *
 * Returns the stop function. `onDead` fires at most once, and never after
 * stop(). A poll that rejects (IPC hiccup) is ignored; the next tick retries.
 */
export function watchLiveInput(
  died: () => Promise<boolean>,
  onDead: () => void,
  intervalMs = 1000,
): () => void {
  let stopped = false;
  let inFlight = false;
  const stop = () => {
    stopped = true;
    clearInterval(id);
  };
  const id = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    died().then(
      (dead) => {
        inFlight = false;
        if (stopped || !dead) return;
        stop();
        onDead();
      },
      () => {
        inFlight = false;
      },
    );
  }, intervalMs);
  return stop;
}
