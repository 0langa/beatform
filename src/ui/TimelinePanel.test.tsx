// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { presets } from "../render/presets";
import { defaultParams } from "../render/types";
import type { Timeline } from "../state/timeline";
import { renderProbe } from "./testing/renderProbe";
import { TimelinePanel, type TimelinePanelProps } from "./TimelinePanel";

afterEach(cleanup);

/**
 * The H13 stable-props contract for the panel it matters most on, and the
 * safety net for the store-direct migration's second wave (P-12).
 *
 * TimelinePanel is `memo()`d because at zoom 12 its track is 11,280px wide
 * with ~840 ruler/scene/keyframe elements, and App re-renders it on the 4 Hz
 * playback tick plus every pointermove that writes `activeParams`. That memo
 * only ever bails if EVERY prop keeps its identity across App renders — a
 * contract enforced by nothing but the `useCallback` block in App.tsx and a
 * comment. This file is the first coverage it has ever had, so wave 2 can tell
 * "the migration changed the render cost" from "it was always like that".
 *
 * ── Instrumentation, and why it is not `renderProbe()` alone ──────────────
 *
 * `renderProbe()` counts COMMITS of the subtree under its `<Profiler>`. That
 * is the right instrument for a zero-prop store-direct panel, where the Probe
 * sits at the root and the only thing that can re-render underneath it is the
 * panel's own subscription firing.
 *
 * It cannot see a `memo` bail-out. Verified empirically against this repo's
 * React 19.2.8: with the Probe inside a ticking parent, two parent ticks
 * produce THREE commits whether the child's props are stable or not. React
 * flags a Profiler for `onRender` when the Profiler element itself re-renders
 * (its child fiber is re-cloned, so `bubbleProperties` does not report a
 * bail-out) — and forcing the parent to re-render is exactly what a memo test
 * has to do. Any arrangement that keeps the Profiler from re-rendering also
 * keeps the panel's element reference-equal, which bails out ABOVE the memo
 * and proves nothing about it.
 *
 * So the assertion instrument is a counting getter on a NESTED prop field the
 * render body reads unconditionally (`timeline.scenes`, read by the
 * `sortedScenes` dep array and the empty-lane hint) — the same trick
 * `ParamsPanel.test.tsx` used on `preset.params`. `memo`'s shallow compare
 * only touches `props.timeline` by identity, never its fields, so every read
 * is one execution of the render body.
 *
 * `renderProbe()` still earns its place: it proves the parent tick actually
 * committed. Without it, "the body never ran" would be indistinguishable from
 * "nothing happened at all" — the vacuous version of this test.
 */

/** Props whose `timeline.scenes` reads are counted. Every body execution reads
 * it exactly twice — the `sortedScenes` useMemo dep array and the
 * `scenes.length === 0` empty hint — plus once more on the first run, when
 * that useMemo's factory actually executes (3 at mount, +2 per re-render). The
 * counter is therefore proportional to body runs and independent of how much
 * data the panel is holding. */
function probedProps(): { props: TimelinePanelProps; bodyReads: () => number } {
  let reads = 0;
  const scenes: Timeline["scenes"] = [];
  const timeline = {
    enabled: false,
    lanes: [],
    get scenes() {
      reads += 1;
      return scenes;
    },
  } as Timeline;

  const preset = presets[0];
  return {
    props: {
      timeline,
      duration: 100,
      time: 30,
      beatGrid: null,
      sections: [],
      // null: the waveform effect early-returns, so jsdom is never asked for
      // a 2D canvas context it does not implement.
      waveform: null,
      activePreset: preset,
      presets,
      activeParams: defaultParams(preset),
      onChange: vi.fn(),
      onAutoArrange: vi.fn(),
      onSeek: vi.fn(),
      onClose: vi.fn(),
      simplifiedRenderer: false,
    },
    bodyReads: () => reads,
  };
}

/** Re-renders on demand, the way App does on the playback tick. `unstable`
 * rebuilds ONE callback prop per render — the defect shape (an inline arrow
 * in the JSX) that silently defeats the memo. */
function Host({ props, unstable }: { props: TimelinePanelProps; unstable?: boolean }) {
  const [, setN] = useState(0);
  return (
    <>
      <button onClick={() => setN((n) => n + 1)}>parent tick</button>
      {unstable ? (
        <TimelinePanel {...props} onSeek={(t) => props.onSeek(t)} />
      ) : (
        <TimelinePanel {...props} />
      )}
    </>
  );
}

describe("TimelinePanel memo (H13 stable-props contract)", () => {
  it("does not reconcile when the parent re-renders with stable prop identities", () => {
    const { props, bodyReads } = probedProps();
    const { Probe, commits } = renderProbe();

    render(
      <Probe>
        <Host props={props} />
      </Probe>,
    );
    expect(screen.getByText("Timeline")).toBeTruthy(); // it mounted
    const mountedCommits = commits();
    const mountedReads = bodyReads();
    expect(mountedReads).toBeGreaterThan(0); // the probe is live

    fireEvent.click(screen.getByText("parent tick"));
    fireEvent.click(screen.getByText("parent tick"));

    // The parent really did re-render twice...
    expect(commits()).toBe(mountedCommits + 2);
    // ...and the panel's ~840-element body did not run once.
    expect(bodyReads()).toBe(mountedReads);
  });

  it("control: one fresh callback identity per render defeats the memo", () => {
    const { props, bodyReads } = probedProps();
    const { Probe, commits } = renderProbe();

    render(
      <Probe>
        <Host props={props} unstable />
      </Probe>,
    );
    const mountedCommits = commits();
    const mountedReads = bodyReads();

    fireEvent.click(screen.getByText("parent tick"));
    fireEvent.click(screen.getByText("parent tick"));

    expect(commits()).toBe(mountedCommits + 2);
    // Same two ticks, same commit count — but now the whole panel reconciled
    // with the parent, which is what proves the stable case above is a real
    // bail-out and not a harness that never ticked.
    expect(bodyReads()).toBeGreaterThan(mountedReads);
  });
});
