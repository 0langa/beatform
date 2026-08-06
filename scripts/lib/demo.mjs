// Shared demo-track helpers: load a built-in demo, wait for the engine to
// accept it, start playback, and re-seek before a shot — the pattern every
// visual-evidence harness repeats.

/** loadDemo + wait for a positive duration + play. Resolves to the track
 * duration in seconds. */
export async function loadDemoAndPlay(cdp, demo, { loadTimeoutMs = 30_000 } = {}) {
  await cdp.eval(`window.__store.getState().loadDemo(${JSON.stringify(demo)})`);
  return cdp.eval(`(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + ${loadTimeoutMs};
    while (!(window.__engine.state.duration > 0)) {
      if (Date.now() > deadline) throw new Error("demo did not load");
      await delay(200);
    }
    window.__store.getState().play?.();
    return window.__engine.state.duration;
  })()`);
}

/** Caching wrapper: returns ensureDemo(demo) that only reloads on change —
 * the gallery-seed-shots pattern for multi-candidate runs. */
export function makeDemoLoader(cdp, opts) {
  let current = null;
  return async (demo) => {
    if (current === demo) return;
    await loadDemoAndPlay(cdp, demo, opts);
    current = demo;
  };
}

/** Seek to a known point and make sure playback is running — the standard
 * pre-shot reset so every screenshot pumps from the same track position. */
export function seekAndPlay(cdp, seconds = 2) {
  return cdp.eval(
    `(() => {
      window.__engine.seek?.(${seconds});
      if (!window.__engine.state.playing) window.__store.getState().play?.();
      return true;
    })()`,
    false,
  );
}
