// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Update } from "@tauri-apps/plugin-updater";
import { renderProbe } from "./testing/renderProbe";

/**
 * Preferences after G5 — the dialog takes no props at all.
 *
 * Two claims, and they are different claims:
 *
 *  1. WIRING. The updater phase and the three actions now come from
 *     `state/updater.ts`, so pressing "Check for updates" has to drive the
 *     real machine and the real machine's phases have to reach this DOM.
 *     A props test could not see any of that; it asserted a `vi.fn()`.
 *
 *  2. RECONCILIATION. A download reports progress once per HTTP chunk. While
 *     the phase was App's `useState`, every one of those ticks re-rendered
 *     App's whole body — the top bar, the mode strip, the player bar, the
 *     dock — because that is what a setState in App does. The probes below
 *     measure what a tick costs now.
 *
 * The `<Bystander>` is the stand-in for that body: a plain zustand subscriber
 * mounted as a SIBLING of the dialog, which is the shape the move created.
 * Both probes are only meaningful because the updates ORIGINATE INSIDE their
 * subtrees (see renderProbe's SCOPE note) — nothing above them re-renders, so
 * a commit can only come from a subscription that fired.
 */

const env = vi.hoisted(() => ({ check: vi.fn<() => Promise<Update | null>>() }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: env.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

// Only isTauri is faked: the Updates tab is desktop-only, and jsdom is not
// Tauri. Everything else in platform (which prefs and the store both reach
// into) stays real.
vi.mock("../state/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/platform")>()),
  isTauri: () => true,
}));

const { SettingsDialog } = await import("./SettingsDialog");
const { useVizStore } = await import("../state/store");
const { __updateListenerCount, getUpdatePhase, setUpdatePhase } = await import("../state/updater");

/** Stand-in for everything App renders that has nothing to do with updates. */
function Bystander() {
  const presetId = useVizStore((s) => s.presetId);
  return <span data-testid="bystander">{presetId}</span>;
}

let consoleErrors: string[] = [];
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  env.check.mockReset();
  setUpdatePhase({ state: "idle" }, false);
  consoleErrors = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  cleanup();
  errorSpy.mockRestore();
  // An unstable snapshot getter is a white screen, not a slow render, and the
  // "getSnapshot should be cached" warning is the only notice React gives.
  expect(consoleErrors.join("\n")).not.toMatch(/getSnapshot should be cached|Maximum update depth/);
});

/** Mount the dialog on its Updates tab. */
function openUpdatesTab() {
  render(<SettingsDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
}

function stagedUpdate(version: string): Update {
  return {
    version,
    body: null,
    downloadAndInstall: vi.fn(async () => {}),
  } as unknown as Update;
}

/**
 * TIMEOUTS: an explicit 30 s budget rather than vitest's 5 s default. Every
 * describe below mounts the real dialog against the real store and updater
 * machine (openUpdatesTab/renderProbe both call `render()`), one driving
 * async `waitFor` on top — the whole-branch review saw exactly this suite
 * time out under parallel-worker contention. Same remedy as
 * `engineGraph.test.ts`; see GATES.md §1.
 */
describe("Preferences › Updates drives the machine itself (G5)", { timeout: 30_000 }, () => {
  it("the check button runs the real check and the result lands in the DOM", async () => {
    env.check.mockResolvedValue(stagedUpdate("9.9.9"));
    openUpdatesTab();
    expect(screen.getByText(`v${(await import("../version")).APP_VERSION}`)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    // Not a spy call — the module's phase moved, and the dialog re-rendered
    // off its own subscription to show it.
    await waitFor(() => expect(screen.getByText("Version 9.9.9 is available")).toBeTruthy());
    expect(getUpdatePhase()).toEqual({ state: "available", version: "9.9.9", notes: null });
    expect(screen.getByRole("button", { name: "Update now" })).toBeTruthy();
    // A manual check must not have raised the startup prompt; App renders that
    // from the same module and would have mounted it over this dialog.
    expect((await import("../state/updater")).isUpdatePromptOpen()).toBe(false);
  });

  it("a phase set from outside the dialog reaches it — the DEV hook path", () => {
    openUpdatesTab();
    act(() => setUpdatePhase({ state: "ready", version: "9.9.9" }, false));
    expect(screen.getByText("Version 9.9.9 installed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart now" })).toBeTruthy();

    act(() => setUpdatePhase({ state: "error", message: "network down" }, false));
    expect(screen.getByText("Update check failed: network down")).toBeTruthy();
  });
});

describe("what an update tick costs (G5)", { timeout: 30_000 }, () => {
  it("a download progress tick reconciles the dialog and nothing else", () => {
    const bystander = renderProbe();
    const dialog = renderProbe();
    let storeNotifications = 0;
    const unsubStore = useVizStore.subscribe(() => storeNotifications++);
    render(
      <>
        <bystander.Probe>
          <Bystander />
        </bystander.Probe>
        <dialog.Probe>
          <SettingsDialog />
        </dialog.Probe>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    const beforeBystander = bystander.commits();
    const beforeDialog = dialog.commits();
    expect(beforeDialog).toBeGreaterThan(0); // both probes are live
    expect(beforeBystander).toBeGreaterThan(0);

    const TICKS = 20;
    for (let i = 1; i <= TICKS; i++) {
      // One act() per tick: batching them into one would measure React's
      // batching rather than the subscription, and pass just as happily if
      // every tick cost a full-tree render.
      act(() => setUpdatePhase({ state: "downloading", received: i * 1e6, total: 20e6 }, false));
    }

    // Exactly one commit per tick — the subscription is connected, and it is
    // not re-rendering twice per notification.
    expect(dialog.commits()).toBe(beforeDialog + TICKS);
    // …and the rest of the tree paid nothing. Before G5 this component and
    // the dialog were both children of the setState, so both re-rendered.
    expect(bystander.commits()).toBe(beforeBystander);
    // The direct evidence for keeping the machine OUT of the store: zustand
    // runs every subscriber's selector on every set(), so 20 chunks would
    // have been 20 sweeps of every subscriber in the app.
    expect(storeNotifications).toBe(0);
    // The commits were real — the last tick is on screen.
    expect(document.querySelector(".update-line")?.textContent).toMatch(/Downloading update.*100%/);
    unsubStore();
  });

  it("a store tick the dialog does not read costs it nothing", () => {
    const dialog = renderProbe();
    render(
      <dialog.Probe>
        <SettingsDialog />
      </dialog.Probe>,
    );
    const before = dialog.commits();

    // The 4 Hz playback meters: the dialog reads presetOrder and presetThumbs
    // and must not have picked up anything else on the way to store-direct.
    act(() => useVizStore.setState({ lufs: -14.2 }));
    expect(dialog.commits()).toBe(before);

    // …and the subscription it DOES have is live.
    act(() => useVizStore.setState({ presetOrder: ["spectrum-bars"] }));
    expect(dialog.commits()).toBe(before + 1);
    act(() => useVizStore.setState({ presetOrder: [] }));
  });

  it("an update tick with the dialog closed reaches nobody", () => {
    // The dialog is mounted only while `showSettings` is true, so on the
    // normal path an install's whole progress stream has no React reader at
    // all. That is only true because the phase lives outside App.
    const bystander = renderProbe();
    render(
      <bystander.Probe>
        <Bystander />
      </bystander.Probe>,
    );
    const before = bystander.commits();
    for (let i = 1; i <= 5; i++) {
      act(() => setUpdatePhase({ state: "downloading", received: i, total: 5 }, false));
    }
    expect(bystander.commits()).toBe(before);
    expect(getUpdatePhase()).toEqual({ state: "downloading", received: 5, total: 5 });
  });

  it("unmounting the dialog releases its subscription", () => {
    // Counted on the EMITTER, not on a listener of this test's own: a
    // notification counter here moves whether or not the dialog leaked, so it
    // would pass with no dialog rendered at all (verified — it did).
    const before = __updateListenerCount();
    const { unmount } = render(<SettingsDialog />);
    expect(__updateListenerCount()).toBe(before + 1);

    unmount();

    expect(__updateListenerCount()).toBe(before);
    // …and the phase kept moving underneath with nobody listening.
    act(() => setUpdatePhase({ state: "none" }, false));
    expect(getUpdatePhase()).toEqual({ state: "none" });
  });
});
