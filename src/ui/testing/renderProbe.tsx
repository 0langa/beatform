import { Profiler, type ReactNode } from "react";

/**
 * Counts COMMITS of a wrapped subtree — the shared render-cost probe for
 * panel tests.
 *
 * Why a Profiler and not the older trick of planting a getter on the value a
 * component reads: zustand runs EVERY subscriber's selector on EVERY
 * `setState`, so a getter on store state fires without anything rendering and
 * reports work that never happened. React calls `onRender` only when the
 * subtree actually committed, so a `memo` bail-out, an unchanged selector
 * result, or a store write to a slice nobody subscribed to all produce
 * nothing. That makes one probe valid for both contracts: a props-based
 * component (does its `memo` hold?) and a zero-prop store-direct one (is its
 * selector granular enough?).
 *
 * StrictMode-safe: React 19 double-invokes render but commits once.
 *
 * Usage:
 * ```tsx
 * const { Probe, commits } = renderProbe();
 * render(<Probe><SomePanel /></Probe>);
 * const before = commits();
 * act(() => useVizStore.setState({ lufs: -14.2 }));
 * expect(commits()).toBe(before); // the 4 Hz meter tick costs this panel nothing
 * ```
 */
export function renderProbe() {
  let commits = 0;
  const Probe = ({ children }: { children: ReactNode }) => (
    <Profiler
      id="probe"
      onRender={() => {
        commits += 1;
      }}
    >
      {children}
    </Profiler>
  );
  return { Probe, commits: () => commits };
}
