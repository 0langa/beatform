/**
 * Races an async task against a timeout — the CRITICAL fix on top of E2-U4
 * (whole-lane review). ShaderEditor/ShadertoyImport's `apply()` awaits an
 * on-device WGSL compile check or a Rust-side (naga) GLSL transpile, and
 * E2-U4 made the dialog's own dismissal (backdrop/close/Escape) hard-gate
 * on `busy` for as long as that await is outstanding. Neither call has a
 * timeout anywhere in its own chain — `shadertoy.rs`'s own fuzz-testing
 * notes record that a genuine infinite loop in the transpiler cannot be
 * interrupted from inside, and the on-device WebGPU compile check has no
 * cancellation path either — so a hang (not just a slow compile) used to
 * leave the dialog permanently unclosable, with no way out short of
 * killing the app.
 *
 * `task` receives an `AbortSignal` that is aborted the moment the timeout
 * fires. Neither `transpileShadertoy` (a single opaque Tauri `invoke()`)
 * nor the WebGPU compile check can actually be interrupted mid-flight by
 * that signal — this file cannot make the hang stop — but a callee that
 * checks `signal.aborted` at its OWN next resumption point (as
 * `saveCustomPreset`/`importShadertoyGlsl` now do) can skip applying a
 * result that arrives after the caller has already moved on. That is the
 * actual guarantee this buys: the UI unsticks reliably, and a late
 * resolution can never register/persist/switch the live visual out from
 * under a user who was already told it failed.
 */

export const SHADER_APPLY_TIMEOUT_MS = 15_000;

export type RaceResult<T> =
  | { ok: true; value: T }
  | { ok: false; timedOut: true }
  | { ok: false; timedOut: false; error: unknown };

export async function raceTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<RaceResult<T>> {
  const controller = new AbortController();
  // Attached to the raw task UNCONDITIONALLY, regardless of which side of
  // the race below actually wins: a task that resolves or rejects AFTER the
  // timeout has already settled this function must not become an unhandled
  // promise rejection (or a dangling resolution nobody reads). The `await`
  // inside this IIFE is what catches a task that throws SYNCHRONOUSLY too
  // (before ever returning a promise) — `task(...).then(...)` alone would
  // have let that throw straight out of raceTimeout, uncaught by the
  // try/finally below (which only wraps the race, not this construction).
  const settled: Promise<RaceResult<T>> = (async () => {
    try {
      const value = await task(controller.signal);
      return { ok: true as const, value };
    } catch (error) {
      return { ok: false as const, timedOut: false as const, error };
    }
  })();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<RaceResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, timedOut: true });
    }, ms);
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
