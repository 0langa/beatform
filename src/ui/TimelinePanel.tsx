import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { BeatGrid } from "../audio/analysis/beatGrid";
import type { PresetDef } from "../render/types";
import { allParams, type ParamValues } from "../render/types";
import {
  newSceneId,
  TRANSITION_KINDS,
  type AutomationLane,
  type Keyframe,
  type Scene,
  type Timeline,
} from "../state/timeline";
import { Slider } from "./Slider";
import { Switch } from "./Switch";
import { IconClose } from "./Icons";

const TRANSITION_LABELS: Record<(typeof TRANSITION_KINDS)[number], string> = {
  crossfade: "Crossfade",
  wipe: "Wipe →",
  wipeup: "Wipe ↑",
  iris: "Iris",
  zoom: "Zoom",
  glitch: "Glitch",
  cut: "Hard cut",
};

export interface TimelinePanelProps {
  timeline: Timeline;
  duration: number;
  time: number;
  beatGrid: BeatGrid | null;
  sections: number[];
  waveform: Float32Array | null;
  activePreset: PresetDef;
  presets: PresetDef[];
  activeParams: ParamValues;
  onChange: (timeline: Timeline) => void;
  /** Build scenes from the detected sections (energy-ranked visuals). */
  onAutoArrange: () => void;
  onSeek: (t: number) => void;
  onClose: () => void;
}

/**
 * Bottom timeline panel: beat/section ruler, waveform overview, a scene lane
 * and one row per automation lane. Everything edits through onChange with a
 * whole new Timeline — the store records history (gesture-grouped) and
 * persists; drags snap to the beat grid when one exists.
 *
 * Memoized (H13): at zoom 12 the track is 11,280px wide with ~840 ruler/
 * scene/keyframe elements — reconciling all of that 4x/second just because
 * some unrelated store field ticked (to move one playhead div) was the
 * worst offender the audit found. Requires every callback prop from
 * App.tsx to stay reference-stable — see the useCallback block there.
 */
export const TimelinePanel = memo(function TimelinePanel(props: TimelinePanelProps) {
  const { timeline, duration } = props;
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
    const beats = props.beatGrid?.beatTimes;
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
    const wf = props.waveform;
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
  }, [props.waveform, width]);

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
    const beats = props.beatGrid?.beatTimes;
    if (beats && pps > 18) {
      for (let i = 0; i < beats.length; i++) {
        out.push({ t: beats[i], kind: i % 4 === 0 ? "bar" : "beat" });
      }
    }
    return out;
  }, [duration, pps, props.beatGrid]);

  const sortedScenes = useMemo(
    () => [...timeline.scenes].sort((a, b) => a.start - b.start),
    [timeline.scenes],
  );

  const update = (patch: Partial<Timeline>) =>
    props.onChange({ ...timeline, enabled: true, ...patch });

  const addSceneAtPlayhead = () => {
    const scene: Scene = {
      id: newSceneId(),
      name: props.activePreset.name,
      presetId: props.activePreset.id,
      start: snap(props.time),
    };
    update({ scenes: [...timeline.scenes, scene] });
    setSelectedScene(scene.id);
  };

  const removeScene = (id: string) => {
    update({ scenes: timeline.scenes.filter((s) => s.id !== id) });
    if (selectedScene === id) setSelectedScene(null);
  };

  const setScenePreset = (id: string, presetId: string) => {
    const preset = props.presets.find((p) => p.id === presetId);
    update({
      scenes: timeline.scenes.map((s) =>
        s.id === id ? { ...s, presetId, name: preset?.name ?? s.name } : s,
      ),
    });
  };

  const addLane = (param: string) => {
    if (!param || timeline.lanes.some((l) => l.param === param)) return;
    const value = props.activeParams[param] ?? 0;
    const lane: AutomationLane = {
      param,
      keyframes: [{ t: snap(props.time), value, curve: "linear" }],
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
    const own = allParams(props.activePreset).find((p) => p.key === lane.param);
    if (own) return own;
    for (const p of props.presets) {
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
      const keyframes = [...lane.keyframes, { t, value, curve: "linear" as const }].sort(
        (a, b) => a.t - b.t,
      );
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

  const paramOptions = allParams(props.activePreset);

  return (
    <div className="chrome timeline-panel">
      <div className="tl-toolbar">
        <span className="section-title">Timeline</span>
        <span className="inline tl-enable" title="Master switch — off plays the base setup">
          <Switch
            checked={timeline.enabled}
            onChange={(enabled) => props.onChange({ ...timeline, enabled })}
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
          onClick={props.onAutoArrange}
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
          onClick={props.onClose}
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
              props.onSeek(tOf(e.clientX - rect.left));
            }}
          >
            {ticks.map((tick, i) => (
              <div key={i} className={`tl-tick tl-tick-${tick.kind}`} style={{ left: xOf(tick.t) }}>
                {tick.label && <span>{tick.label}</span>}
              </div>
            ))}
            {props.sections.map((t) => (
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
                        key={ki}
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
          {duration > 0 && <div className="tl-playhead" style={{ left: xOf(props.time) }} />}
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
                  {props.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="row-value">@ {s.start.toFixed(2)}s</span>
                <label className="inline" title="Crossfade from the previous scene (0 = hard cut)">
                  Fade
                  <Slider
                    min={0}
                    max={4}
                    step={0.25}
                    value={s.fadeSec ?? 0}
                    onChange={(v) => {
                      const fadeSec = v || undefined;
                      update({
                        scenes: timeline.scenes.map((x) => (x.id === s.id ? { ...x, fadeSec } : x)),
                      });
                    }}
                  />
                  <span className="row-value">{(s.fadeSec ?? 0).toFixed(2)}s</span>
                </label>
                <label className="inline" title="How this scene's incoming fade renders">
                  Transition
                  <select
                    className="select"
                    value={s.transition ?? "crossfade"}
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
});
