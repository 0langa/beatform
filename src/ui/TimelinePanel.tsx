import { useEffect, useMemo, useRef, useState } from "react";
import { allParams } from "../render/types";
import {
  newKeyframeId,
  newSceneId,
  TRANSITION_KINDS,
  type AutomationLane,
  type Keyframe,
  type Scene,
  type Timeline,
} from "../state/timeline";
import { currentBuilder2Def, isBuilderVirtualKey } from "../render/builder2";
import { orderedPresets } from "../state/presetOrder";
import { useVizStore } from "../state/store";
import { selectPreset } from "../state/selectors";
import { Slider } from "./Slider";
import { SliderField, type ValueUnit } from "./kit";
import { Switch } from "./Switch";
import { IconClose } from "./Icons";

/** Scene fades read "0.50s" — same string the row printed by hand. */
const FADE_SECONDS: ValueUnit = { scale: 1, unit: "s" };

const TRANSITION_LABELS: Record<(typeof TRANSITION_KINDS)[number], string> = {
  crossfade: "Crossfade",
  wipe: "Wipe →",
  wipeup: "Wipe ↑",
  iris: "Iris",
  zoom: "Zoom",
  glitch: "Glitch",
  cut: "Hard cut",
};

/**
 * The one element that moves at the playback tick, in its own component so
 * that the tick costs ONE div rather than the ~840 the panel around it draws.
 *
 * This is the point of P-12 wave 2 on this file. The panel used to take
 * `time` as a prop, so 4 Hz of playhead movement reconciled every ruler tick,
 * scene block and keyframe dot with it. The fix is not "subscribe more
 * narrowly" — the panel genuinely needs the time, it draws a playhead — but
 * "subscribe LOWER". Note that a COMMIT COUNT cannot see the difference:
 * before and after, a tick commits exactly once. What changes is how much runs
 * inside that commit, which is why TimelinePanel.test.tsx counts PANEL-BODY
 * EXECUTIONS instead.
 */
function TimelinePlayhead({ pps }: { pps: number }) {
  const time = useVizStore((s) => s.playback.time);
  return <div className="tl-playhead" style={{ left: time * pps }} />;
}

/**
 * Bottom timeline panel: beat/section ruler, waveform overview, a scene lane
 * and one row per automation lane. Every edit writes a whole new Timeline
 * through `setTimeline` — the store records history (gesture-grouped) and
 * persists; drags snap to the beat grid when one exists.
 *
 * Store-direct (P-12 wave 2), and this panel is why the wave exists: at zoom
 * 12 the track is 11,280px wide with ~840 ruler/scene/keyframe elements, and
 * it used to reconcile all of that four times a second (the `time` prop) plus
 * once per pointermove of any slider in the app (the `activeParams` prop).
 * Both are gone:
 *
 *  - `time` moved DOWN into <TimelinePlayhead />, the only thing that reads it;
 *  - `activeParams` is not subscribed at all — its single reader is `addLane`,
 *    which runs at CLICK time and takes the live value off `store()`. A
 *    subscription would have re-rendered the panel at pointer rate to serve a
 *    value nothing renders.
 *
 * It is deliberately NOT memo()d — with zero props memo can never bail on
 * anything, and leaving it would assert a contract nothing enforces. Never
 * allocate inside a selector: zustand v5 hands it straight to
 * useSyncExternalStore with no equality fn, so a fresh array per notification
 * is "Maximum update depth exceeded" ON MOUNT (lint enforces the shapes; the
 * `presets` derivation below is the sanctioned two-selectors + useMemo form).
 */
export function TimelinePanel() {
  const timeline = useVizStore((s) => s.timeline);
  /** A PRIMITIVE off `playback`, not the object: subscribing `s.playback`
   * would put the panel straight back on the 4 Hz tick that
   * <TimelinePlayhead /> exists to contain. */
  const duration = useVizStore((s) => s.playback.duration);
  const beatGrid = useVizStore((s) => s.beatGrid);
  const sections = useVizStore((s) => s.sections);
  const waveform = useVizStore((s) => s.waveformOverview);
  const activePreset = useVizStore(selectPreset);
  const presetOrder = useVizStore((s) => s.presetOrder);
  const customDefs = useVizStore((s) => s.customDefs);
  /**
   * True while the Canvas2D fallback is drawing (audit F1). It hard-cuts
   * between scenes — setTransitionPreset is an empty stub — so the Transition
   * select is disabled rather than offering seven effects it will not run.
   * Scene fades stay editable: they are document data, and the timeline is
   * still worth building for a later render on capable hardware.
   */
  const simplifiedRenderer = useVizStore((s) => s.simplifiedRenderer);

  // A DERIVATION THAT ALLOCATES: two selections + useMemo, never a selector.
  // `orderedPresets(...)` inside one would hand useSyncExternalStore a fresh
  // array on every store notification.
  const presets = useMemo(() => orderedPresets(presetOrder, customDefs), [presetOrder, customDefs]);

  // One stable accessor; actions are called at the edit site. They are built
  // once inside create()'s initializer and every write is a partial merge, so
  // their identity is permanently stable — no useCallback.
  const store = useVizStore.getState;

  const scrollRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [drag, setDrag] = useState<
    | {
        kind: "scene";
        id: string;
        /** Pointer-to-scene-start offset in seconds, captured at pointerdown —
         * without it the block TELEPORTS its start to the cursor on the first
         * move, so merely selecting a scene could shift it. */
        grabOffsetSec: number;
        downX: number;
        downY: number;
        moved: boolean;
      }
    | {
        kind: "key";
        lane: number;
        index: number;
        spec: { min: number; max: number };
        /** Screen position at pointerdown — a "drag" that never moved is a
         * click (pointer capture retargets real click events away from the
         * dot, so the tap gesture must be reconstructed here). */
        downX: number;
        downY: number;
        moved: boolean;
      }
    | null
  >(null);

  const viewWidth = 940; // logical timeline width at zoom 1 (scrolls beyond)
  const width = Math.max(viewWidth, Math.round(viewWidth * zoom));
  const pps = duration > 0 ? width / duration : 1; // pixels per second

  const xOf = (t: number) => t * pps;
  const tOf = (x: number) => Math.min(duration, Math.max(0, x / pps));

  const snap = (t: number): number => {
    const beats = beatGrid?.beatTimes;
    if (!beats || beats.length === 0) return t;
    // nearest beat within 12 px
    let best = t;
    let bestD = 12 / pps;
    for (const b of beats) {
      const d = Math.abs(b - t);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  };

  // Waveform overview: draw once per (track, width)
  useEffect(() => {
    const canvas = waveRef.current;
    const wf = waveform;
    if (!canvas || !wf || wf.length === 0) return;
    canvas.width = width;
    canvas.height = 36;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, 36);
    ctx.fillStyle = "rgba(120, 160, 255, 0.45)";
    const bucket = Math.max(1, Math.floor(wf.length / width));
    for (let x = 0; x < width; x++) {
      let peak = 0;
      const base = Math.min(wf.length - bucket, x * bucket);
      for (let i = 0; i < bucket; i++) peak = Math.max(peak, Math.abs(wf[base + i]));
      const h = Math.max(1, peak * 34);
      ctx.fillRect(x, 18 - h / 2, 1, h);
    }
  }, [waveform, width]);

  // Ruler ticks: seconds at low zoom, beats when they fit
  const ticks = useMemo(() => {
    const out: Array<{ t: number; label?: string; kind: "sec" | "beat" | "bar" }> = [];
    const secStep = pps > 60 ? 1 : pps > 25 ? 2 : pps > 10 ? 5 : 15;
    for (let t = 0; t <= duration; t += secStep) {
      out.push({
        t,
        label: `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`,
        kind: "sec",
      });
    }
    const beats = beatGrid?.beatTimes;
    if (beats && pps > 18) {
      for (let i = 0; i < beats.length; i++) {
        out.push({ t: beats[i], kind: i % 4 === 0 ? "bar" : "beat" });
      }
    }
    return out;
  }, [duration, pps, beatGrid]);

  const sortedScenes = useMemo(
    () => [...timeline.scenes].sort((a, b) => a.start - b.start),
    [timeline.scenes],
  );

  const update = (patch: Partial<Timeline>) =>
    store().setTimeline({ ...timeline, enabled: true, ...patch });

  /** The playhead, read at CLICK time off the live snapshot. Subscribing to
   * it here is what the migration removed: `time` moves 4x/second and is
   * wanted by two click handlers and one child div, never by this body. */
  const playheadTime = () => store().playback.time;

  const addSceneAtPlayhead = () => {
    const scene: Scene = {
      id: newSceneId(),
      name: activePreset.name,
      presetId: activePreset.id,
      start: snap(playheadTime()),
    };
    update({ scenes: [...timeline.scenes, scene] });
    setSelectedScene(scene.id);
  };

  const removeScene = (id: string) => {
    update({ scenes: timeline.scenes.filter((s) => s.id !== id) });
    if (selectedScene === id) setSelectedScene(null);
  };

  const setScenePreset = (id: string, presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    update({
      scenes: timeline.scenes.map((s) =>
        s.id === id ? { ...s, presetId, name: preset?.name ?? s.name } : s,
      ),
    });
  };

  const addLane = (param: string) => {
    if (!param || timeline.lanes.some((l) => l.param === param)) return;
    // Also a click-time read: `activeParams` is rewritten on every
    // pointermove of every slider, and this is its only reader here.
    const value = store().activeParams[param] ?? 0;
    const lane: AutomationLane = {
      param,
      keyframes: [{ id: newKeyframeId(), t: snap(playheadTime()), value, curve: "linear" }],
    };
    update({ lanes: [...timeline.lanes, lane] });
  };

  const removeLane = (index: number) => {
    update({ lanes: timeline.lanes.filter((_, i) => i !== index) });
  };

  const setLane = (index: number, lane: AutomationLane) => {
    update({ lanes: timeline.lanes.map((l, i) => (i === index ? lane : l)) });
  };

  // Resolve the param's real range. Lanes outlive preset switches, so a lane
  // whose param is not on the ACTIVE preset must still find its spec — the
  // old {0,1} fallback silently rescaled (corrupted) keyframe values on drag.
  const laneSpec = (lane: AutomationLane) => {
    const own = allParams(activePreset).find((p) => p.key === lane.param);
    if (own) return own;
    // Builder virtual params (RP-20): resolve l<i>.* against the CURRENT
    // builder2 def — `presets` carries the def captured at boot, whose
    // structure (and therefore virtual list) may be stale.
    if (isBuilderVirtualKey(lane.param)) {
      const spec = allParams(currentBuilder2Def()).find((p) => p.key === lane.param);
      if (spec) return spec;
    }
    for (const p of presets) {
      const spec = allParams(p).find((s) => s.key === lane.param);
      if (spec) return spec;
    }
    return { min: 0, max: 1 };
  };

  const onLanePointer = (
    e: React.PointerEvent<HTMLDivElement>,
    laneIndex: number,
    action: "add" | "none",
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = snap(tOf(e.clientX - rect.left));
    const lane = timeline.lanes[laneIndex];
    const spec = laneSpec(lane);
    const value =
      spec.min +
      (1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))) * (spec.max - spec.min);
    if (action === "add") {
      const keyframes = [
        ...lane.keyframes,
        { id: newKeyframeId(), t, value, curve: "linear" as const },
      ].sort((a, b) => a.t - b.t);
      setLane(laneIndex, { ...lane, keyframes });
    }
  };

  // Pointer capture on the (stable) scroll container keeps a drag alive even
  // when the cursor leaves the element or outruns it — matching the seek bar.
  const beginDrag = (e: React.PointerEvent, d: NonNullable<typeof drag>) => {
    scrollRef.current?.setPointerCapture(e.pointerId);
    setDrag(d);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag?.kind === "key") {
      if (!drag.moved) {
        // The pointer never really moved: this was a TAP on the dot. Pointer
        // capture retargets the browser's click/contextmenu to the scroll
        // container, so the "click a dot to cycle its curve" gesture is
        // reconstructed from the capture stream instead.
        cycleCurve(drag.lane, drag.index);
      } else {
        // Keyframes are moved IN PLACE during the drag (so drag.index stays
        // valid even when one crosses a neighbor); sort once on release.
        const lane = timeline.lanes[drag.lane];
        if (lane) {
          setLane(drag.lane, { ...lane, keyframes: [...lane.keyframes].sort((a, b) => a.t - b.t) });
        }
      }
    }
    try {
      scrollRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone
    }
    setDrag(null);
  };

  const moveDragged = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    // .tl-lanes rect.left already reflects the scroll offset (it is the
    // scrolled content inside the overflow container) — do NOT add scrollLeft.
    const rect = scrollRef.current!.querySelector(".tl-lanes")!.getBoundingClientRect();
    const t = snap(tOf(e.clientX - rect.left));
    if (drag.kind === "scene") {
      // Tap threshold + grab offset: a click selects, a real drag moves —
      // and moves relative to where the block was grabbed, not its left edge.
      if (!drag.moved && Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      const start = snap(
        Math.max(0, Math.min(duration, tOf(e.clientX - rect.left) - drag.grabOffsetSec)),
      );
      update({
        scenes: timeline.scenes.map((s) => (s.id === drag.id ? { ...s, start } : s)),
      });
    } else {
      // Ignore sub-3px jitter so a tap stays a tap (see endDrag).
      if (!drag.moved && Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY) < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      const lane = timeline.lanes[drag.lane];
      const row = scrollRef.current!.querySelectorAll(".tl-lane-row")[drag.lane];
      const rowRect = (row as HTMLElement).getBoundingClientRect();
      const f = 1 - Math.min(1, Math.max(0, (e.clientY - rowRect.top) / rowRect.height));
      const value = drag.spec.min + f * (drag.spec.max - drag.spec.min);
      // In place: no re-sort while dragging, so drag.index keeps pointing at
      // the same keyframe. The array is re-sorted on pointer release.
      const keyframes = lane.keyframes.map((k, i) => (i === drag.index ? { ...k, t, value } : k));
      setLane(drag.lane, { ...lane, keyframes });
    }
  };

  const cycleCurve = (laneIndex: number, kfIndex: number) => {
    const lane = timeline.lanes[laneIndex];
    const order: Keyframe["curve"][] = ["linear", "smooth", "hold"];
    const keyframes = lane.keyframes.map((k, i) =>
      i === kfIndex ? { ...k, curve: order[(order.indexOf(k.curve) + 1) % order.length] } : k,
    );
    setLane(laneIndex, { ...lane, keyframes });
  };

  const removeKeyframe = (laneIndex: number, kfIndex: number) => {
    const lane = timeline.lanes[laneIndex];
    const keyframes = lane.keyframes.filter((_, i) => i !== kfIndex);
    if (keyframes.length === 0) removeLane(laneIndex);
    else setLane(laneIndex, { ...lane, keyframes });
  };

  // Keyboard nudge for a focused keyframe (parity with the pointer drag):
  // ↑/↓ move its value, ←/→ move it in time, Delete removes it.
  const nudgeKeyframe = (laneIndex: number, kfIndex: number, dValue: number, dTime: number) => {
    const lane = timeline.lanes[laneIndex];
    const spec = laneSpec(lane);
    const cur = lane.keyframes[kfIndex];
    if (!cur) return;
    const value = Math.min(spec.max, Math.max(spec.min, cur.value + dValue));
    const t = dTime ? Math.min(duration || cur.t, Math.max(0, cur.t + dTime)) : cur.t;
    const keyframes = lane.keyframes
      .map((k, i) => (i === kfIndex ? { ...k, value, t } : k))
      .sort((a, b) => a.t - b.t);
    setLane(laneIndex, { ...lane, keyframes });
  };

  const paramOptions = allParams(activePreset);

  return (
    <div className="chrome timeline-panel">
      <div className="tl-toolbar">
        <span className="section-title">Timeline</span>
        <span className="inline tl-enable" title="Master switch — off plays the base setup">
          <Switch
            checked={timeline.enabled}
            onChange={(enabled) => store().setTimeline({ ...timeline, enabled })}
            label="Timeline enabled"
          />
          Enabled
        </span>
        <button
          className="text-btn"
          title="Add a scene with the current visual at the playhead"
          onClick={addSceneAtPlayhead}
        >
          + Scene at playhead
        </button>
        <button
          className="text-btn"
          title="Build an arrangement from the song's detected sections — quiet parts get calm visuals, loud parts get hard ones. One Ctrl+Z undoes."
          onClick={() => store().autoArrangeTimeline()}
        >
          ✦ Auto-arrange
        </button>
        <select
          className="select tl-add-lane"
          value=""
          title="Add an automation lane for a parameter"
          onChange={(e) => addLane(e.target.value)}
        >
          <option value="">+ Automation lane…</option>
          {paramOptions.map((p) => (
            <option
              key={p.key}
              value={p.key}
              disabled={timeline.lanes.some((l) => l.param === p.key)}
            >
              {p.label}
            </option>
          ))}
        </select>
        <div className="tl-zoom">
          <span className="row-label">Zoom</span>
          <Slider
            min={1}
            max={12}
            step={0.5}
            value={zoom}
            onChange={setZoom}
            title="Timeline zoom"
          />
        </div>
        <span className="tl-spacer" />
        <button
          className="icon-btn subtle"
          title="Close (T)"
          aria-label="Close timeline"
          onClick={() => store().setShowTimeline(false)}
        >
          <IconClose size={16} />
        </button>
      </div>

      <div
        className="tl-scroll"
        ref={scrollRef}
        onPointerMove={moveDragged}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="tl-lanes" style={{ width }}>
          {/* Ruler */}
          <div
            className="tl-ruler"
            title="Click to seek"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              store().seekEnd(tOf(e.clientX - rect.left));
            }}
          >
            {ticks.map((tick, i) => (
              <div key={i} className={`tl-tick tl-tick-${tick.kind}`} style={{ left: xOf(tick.t) }}>
                {tick.label && <span>{tick.label}</span>}
              </div>
            ))}
            {sections.map((t) => (
              <div
                key={`sec${t}`}
                className="tl-section-mark"
                style={{ left: xOf(t) }}
                title="Section change"
              />
            ))}
          </div>

          {/* Waveform */}
          <canvas ref={waveRef} className="tl-wave" />

          {/* Scene lane */}
          <div className="tl-scene-lane">
            {sortedScenes.map((s, i) => {
              const end = i + 1 < sortedScenes.length ? sortedScenes[i + 1].start : duration;
              return (
                <div
                  key={s.id}
                  className={`tl-scene ${selectedScene === s.id ? "selected" : ""}`}
                  style={{ left: xOf(s.start), width: Math.max(8, xOf(end - s.start)) }}
                  title={`${s.name} — drag to move (snaps to beats)`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return; // only the primary button drags
                    e.preventDefault();
                    setSelectedScene(s.id);
                    const rect = scrollRef
                      .current!.querySelector(".tl-lanes")!
                      .getBoundingClientRect();
                    beginDrag(e, {
                      kind: "scene",
                      id: s.id,
                      grabOffsetSec: tOf(e.clientX - rect.left) - s.start,
                      downX: e.clientX,
                      downY: e.clientY,
                      moved: false,
                    });
                  }}
                >
                  <span className="tl-scene-name">{s.name}</span>
                </div>
              );
            })}
            {timeline.scenes.length === 0 && (
              <span className="tl-empty-hint">No scenes — the base setup plays throughout</span>
            )}
          </div>

          {/* Automation lanes */}
          {timeline.lanes.map((lane, li) => {
            const spec = laneSpec(lane);
            return (
              <div key={lane.param} className="tl-lane-row">
                <div
                  className="tl-lane-area"
                  title="Double-click to add a keyframe; drag dots; right-click removes; click a dot to cycle its curve"
                  onDoubleClick={(e) =>
                    onLanePointer(e as unknown as React.PointerEvent<HTMLDivElement>, li, "add")
                  }
                >
                  {lane.keyframes.map((k, ki) => {
                    const f = (k.value - spec.min) / Math.max(1e-9, spec.max - spec.min);
                    const vStep = ("step" in spec ? spec.step : 0) || (spec.max - spec.min) / 50;
                    return (
                      <div
                        // Stable id, not the array index: endDrag/nudgeKeyframe
                        // re-sort by t on every move, which shifts indices the
                        // instant two keyframes cross (L9) — falls back to the
                        // index only for a keyframe that somehow still lacks an
                        // id (should not happen post-validTimeline backfill).
                        key={k.id ?? ki}
                        className={`tl-key tl-key-${k.curve}`}
                        style={{ left: xOf(k.t), top: `${(1 - f) * 100}%` }}
                        title={`${lane.param} = ${k.value.toFixed(2)} @ ${k.t.toFixed(2)}s (${k.curve})`}
                        role="slider"
                        tabIndex={0}
                        aria-label={`${lane.param} keyframe at ${k.t.toFixed(2)}s`}
                        aria-valuemin={spec.min}
                        aria-valuemax={spec.max}
                        aria-valuenow={k.value}
                        onKeyDown={(e) => {
                          let handled = true;
                          if (e.key === "ArrowUp") nudgeKeyframe(li, ki, vStep, 0);
                          else if (e.key === "ArrowDown") nudgeKeyframe(li, ki, -vStep, 0);
                          else if (e.key === "ArrowRight") nudgeKeyframe(li, ki, 0, 0.05);
                          else if (e.key === "ArrowLeft") nudgeKeyframe(li, ki, 0, -0.05);
                          else if (e.key === "Delete" || e.key === "Backspace")
                            removeKeyframe(li, ki);
                          else handled = false;
                          if (handled) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Right-button = remove, handled HERE because the
                          // pointer capture below retargets click/contextmenu
                          // to the scroll container (they never reach the dot).
                          if (e.button === 2) {
                            removeKeyframe(li, ki);
                            return;
                          }
                          if (e.button !== 0) return;
                          beginDrag(e, {
                            kind: "key",
                            lane: li,
                            index: ki,
                            spec,
                            downX: e.clientX,
                            downY: e.clientY,
                            moved: false,
                          });
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                      />
                    );
                  })}
                </div>
                <div className="tl-lane-label">
                  {lane.param}
                  <button
                    className="chip-x"
                    title="Remove lane"
                    aria-label={`Remove ${lane.param} automation lane`}
                    onClick={() => removeLane(li)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          {/* Playhead */}
          {duration > 0 && <TimelinePlayhead pps={pps} />}
        </div>
      </div>

      {selectedScene && (
        <div className="tl-scene-editor">
          {(() => {
            const s = timeline.scenes.find((x) => x.id === selectedScene);
            if (!s) return null;
            return (
              <>
                <select
                  className="select"
                  value={s.presetId}
                  title="Visual for this scene"
                  onChange={(e) => setScenePreset(s.id, e.target.value)}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="row-value">@ {s.start.toFixed(2)}s</span>
                <label className="inline" title="Crossfade from the previous scene (0 = hard cut)">
                  Fade
                  <SliderField
                    label="Scene fade seconds"
                    min={0}
                    max={4}
                    step={0.25}
                    value={s.fadeSec ?? 0}
                    format={FADE_SECONDS}
                    onChange={(v) => {
                      const fadeSec = v || undefined;
                      update({
                        scenes: timeline.scenes.map((x) => (x.id === s.id ? { ...x, fadeSec } : x)),
                      });
                    }}
                  />
                </label>
                <label
                  className="inline"
                  title={
                    simplifiedRenderer
                      ? "Transitions are GPU effects — hardware rendering (WebGPU) isn't available, so scenes hard-cut. The choice is kept for a render on capable hardware."
                      : "How this scene's incoming fade renders"
                  }
                >
                  Transition
                  <select
                    className="select"
                    value={s.transition ?? "crossfade"}
                    disabled={simplifiedRenderer}
                    onChange={(e) => {
                      const transition = e.target.value as (typeof TRANSITION_KINDS)[number];
                      update({
                        scenes: timeline.scenes.map((x) =>
                          x.id === s.id
                            ? {
                                ...x,
                                transition: transition === "crossfade" ? undefined : transition,
                              }
                            : x,
                        ),
                      });
                    }}
                  >
                    {TRANSITION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {TRANSITION_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="text-btn danger" onClick={() => removeScene(s.id)}>
                  Delete scene
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
