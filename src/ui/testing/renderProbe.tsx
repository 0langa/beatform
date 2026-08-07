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
 * nothing.
 *
 * SCOPE — read before reaching for this in a props test. It proves what it
 * claims only when the update ORIGINATES INSIDE the probed subtree: a store
 * write reaching a zero-prop store-direct component. It cannot prove a `memo`
 * bail-out under a re-rendering parent, because React flags a Profiler for
 * `onRender` whenever the Profiler element itself re-renders — and making the
 * parent re-render is precisely what a memo test has to do. (Measured, React
 * 19.2.8: two parent ticks commit three times whether the child's props are
 * stable or not.) Any arrangement that spares the Profiler also makes the
 * child element reference-equal, which bails out ABOVE the memo and proves
 * nothing either.
 *
 * For a props-based panel, count body executions instead — a getter on a
 * nested field the render body reads unconditionally, whose parent object
 * `memo`'s shallow compare only touches by identity. TimelinePanel.test.tsx
 * and PlayerBar.test.tsx do this, and still use the probe alongside it to
 * prove the parent actually ticked, so "the body never ran" cannot be
 * confused with "the harness never fired".
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
