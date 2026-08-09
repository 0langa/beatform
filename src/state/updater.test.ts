import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";

/**
 * The update machine, moved out of App.tsx by G5.
 *
 * It used to be four `useState` transitions inside a 1,100-line component,
 * which is why it had no tests: reaching them meant mounting the whole shell.
 * As a module it is directly drivable, so the behaviours that actually matter
 * — which surface reports a find, which failures are silent, where the
 * version in "ready" comes from — are pinned here rather than assumed.
 *
 * The mocks are the module's three environment edges and nothing else:
 * `isTauri` (the real one reads `window`, absent in this node-environment
 * file), the prefs gate, and the two Tauri plugins the dynamic imports pull.
 */
const env = vi.hoisted(() => ({
  tauri: true,
  autoCheck: true,
  check: vi.fn<() => Promise<Update | null>>(),
}));

vi.mock("./platform", () => ({ isTauri: () => env.tauri }));
vi.mock("./prefs", () => ({ getPrefs: () => ({ updateAutoCheck: env.autoCheck }) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: env.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const {
  dismissUpdatePrompt,
  getUpdatePhase,
  installUpdate,
  isUpdatePromptOpen,
  runUpdateCheck,
  scheduleStartupUpdateCheck,
  setUpdatePhase,
  subscribeUpdate,
} = await import("./updater");

/** A staged update whose install reports Started → two chunks → Finished. */
function stagedUpdate(version: string, notes: string | null = null): Update {
  return {
    version,
    body: notes ?? undefined,
    downloadAndInstall: vi.fn(
      async (onEvent: (e: { event: string; data: Record<string, number> }) => void) => {
        onEvent({ event: "Started", data: { contentLength: 1000 } });
        onEvent({ event: "Progress", data: { chunkLength: 400 } });
        onEvent({ event: "Progress", data: { chunkLength: 600 } });
        onEvent({ event: "Finished", data: {} });
      },
    ),
  } as unknown as Update;
}

/** Records the phase after every notification — the machine is a sequence of
 * states, and asserting only the last one would miss a skipped "checking". */
function recordPhases(): { states: string[]; stop: () => void } {
  const states: string[] = [];
  const stop = subscribeUpdate(() => states.push(getUpdatePhase().state));
  return { states, stop };
}

beforeEach(() => {
  env.tauri = true;
  env.autoCheck = true;
  env.check.mockReset();
  setUpdatePhase({ state: "idle" }, false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checking (G5)", () => {
  it("an automatic find opens the one-per-boot prompt", async () => {
    env.check.mockResolvedValue(stagedUpdate("9.9.9", "notes"));
    const rec = recordPhases();

    await runUpdateCheck(false);

    expect(rec.states).toEqual(["checking", "available"]);
    expect(getUpdatePhase()).toEqual({ state: "available", version: "9.9.9", notes: "notes" });
    expect(isUpdatePromptOpen()).toBe(true);
    rec.stop();
  });

  it("a MANUAL find reports inline and never opens the prompt", async () => {
    // The whole reason runUpdateCheck takes `manual`: two surfaces, and a
    // modal appearing over Preferences because you pressed the button in
    // Preferences is the fight this flag prevents.
    env.check.mockResolvedValue(stagedUpdate("9.9.9"));

    await runUpdateCheck(true);

    expect(getUpdatePhase()).toEqual({ state: "available", version: "9.9.9", notes: null });
    expect(isUpdatePromptOpen()).toBe(false);
  });

  it("up to date lands on `none`, silently, either way", async () => {
    env.check.mockResolvedValue(null);

    await runUpdateCheck(false);
    expect(getUpdatePhase()).toEqual({ state: "none" });
    expect(isUpdatePromptOpen()).toBe(false);

    await runUpdateCheck(true);
    expect(getUpdatePhase()).toEqual({ state: "none" });
    expect(isUpdatePromptOpen()).toBe(false);
  });

  it("a failed AUTOMATIC check says nothing — being offline at boot is not news", async () => {
    env.check.mockRejectedValue(new Error("network down"));
    const rec = recordPhases();

    await runUpdateCheck(false);

    expect(rec.states).toEqual(["checking", "idle"]);
    expect(getUpdatePhase()).toEqual({ state: "idle" });
    expect(isUpdatePromptOpen()).toBe(false);
    rec.stop();
  });

  it("a failed MANUAL check surfaces the message — someone is waiting for an answer", async () => {
    env.check.mockRejectedValue(new Error("network down"));

    await runUpdateCheck(true);

    expect(getUpdatePhase()).toEqual({ state: "error", message: "network down" });
  });
});

describe("installing (G5)", () => {
  it("carries the version from `available` through downloading to `ready`", async () => {
    env.check.mockResolvedValue(stagedUpdate("9.9.9"));
    await runUpdateCheck(true);
    const rec = recordPhases();

    await installUpdate();

    // `downloading` does not carry the version, so "ready" can only name it by
    // reading the phase it started from — that read is the thing under test.
    expect(getUpdatePhase()).toEqual({ state: "ready", version: "9.9.9" });
    expect(rec.states).toEqual([
      "downloading", // armed at 0/unknown before the first plugin event
      "downloading", // Started: total known
      "downloading", // chunk 1
      "downloading", // chunk 2
      "downloading", // Finished
      "ready",
    ]);
    rec.stop();
  });

  it("reports progress as received/total", async () => {
    env.check.mockResolvedValue(stagedUpdate("9.9.9"));
    await runUpdateCheck(true);
    const seen: Array<[number, number | null]> = [];
    const stop = subscribeUpdate(() => {
      const p = getUpdatePhase();
      if (p.state === "downloading") seen.push([p.received, p.total]);
    });

    await installUpdate();

    expect(seen).toEqual([
      [0, null],
      [0, 1000],
      [400, 1000],
      [1000, 1000],
      [1000, 1000],
    ]);
    stop();
  });

  it("a failed install lands on `error`, not on a stuck progress bar", async () => {
    const update = stagedUpdate("9.9.9");
    (update.downloadAndInstall as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("signature mismatch"),
    );
    env.check.mockResolvedValue(update);
    await runUpdateCheck(true);

    await installUpdate();

    expect(getUpdatePhase()).toEqual({ state: "error", message: "signature mismatch" });
  });

  it("installing with nothing staged is an error phase, not an unhandled rejection", async () => {
    // Reachable from the dev hook and from a prompt left open across a failed
    // re-check; the guard lives in downloadAndInstallUpdate and must surface.
    setUpdatePhase({ state: "available", version: "9.9.9", notes: null }, false);

    await expect(installUpdate()).resolves.toBeUndefined();

    expect(getUpdatePhase().state).toBe("error");
  });
});

describe("the React-facing snapshot contract (G5)", () => {
  it("getUpdatePhase returns a STABLE reference across a notification that did not change it", () => {
    // useSyncExternalStore compares snapshots with Object.is. A getter that
    // allocated would make every notification look like a change and loop
    // React to "Maximum update depth exceeded" — the same crash class as an
    // allocating zustand selector, and the reason this is a test and not a
    // comment.
    setUpdatePhase({ state: "available", version: "9.9.9", notes: null }, true);
    const before = getUpdatePhase();

    dismissUpdatePrompt(); // notifies; the phase itself is untouched

    expect(getUpdatePhase()).toBe(before);
    expect(isUpdatePromptOpen()).toBe(false);
  });

  it("dismissing an already-closed prompt notifies nobody", () => {
    let notifications = 0;
    const stop = subscribeUpdate(() => notifications++);

    dismissUpdatePrompt();

    expect(notifications).toBe(0);
    stop();
  });

  it("unsubscribing stops delivery", () => {
    let notifications = 0;
    const stop = subscribeUpdate(() => notifications++);
    setUpdatePhase({ state: "checking" }, false);
    expect(notifications).toBe(1);

    stop();
    setUpdatePhase({ state: "none" }, false);

    expect(notifications).toBe(1);
  });

  it("setUpdatePhase drives phase AND prompt together — the DEV hook's contract", () => {
    // window.__setUpdatePhase points straight at this; the browser harness
    // uses it to render prompt states that otherwise need a published release.
    setUpdatePhase({ state: "ready", version: "9.9.9" });

    expect(getUpdatePhase()).toEqual({ state: "ready", version: "9.9.9" });
    expect(isUpdatePromptOpen()).toBe(true); // defaults to open, as before G5
  });
});

describe("the startup check (G5)", () => {
  // The async timer variants throughout: the check reaches the plugin through
  // a dynamic import, so advancing the clock synchronously would assert before
  // that promise had settled and read every one of these as "never ran".
  it("arms a silent check after the boot delay, and the canceller stops it", async () => {
    vi.useFakeTimers();
    env.check.mockResolvedValue(null);

    const cancel = scheduleStartupUpdateCheck();
    expect(env.check).not.toHaveBeenCalled(); // not during first paint
    await vi.advanceTimersByTimeAsync(5000);
    expect(env.check).toHaveBeenCalledTimes(1);

    const cancelSecond = scheduleStartupUpdateCheck();
    cancelSecond();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(env.check).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("stays off when the preference is off, and in the browser build", async () => {
    vi.useFakeTimers();
    env.check.mockResolvedValue(null);

    env.autoCheck = false;
    scheduleStartupUpdateCheck()();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(env.check).not.toHaveBeenCalled();

    env.autoCheck = true;
    env.tauri = false;
    scheduleStartupUpdateCheck()();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(env.check).not.toHaveBeenCalled();
  });
});
