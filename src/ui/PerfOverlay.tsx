import { useEffect, useRef } from "react";
import { isTauri } from "../state/platform";
import { getPresentedFrames } from "../state/services";
import type {
  PerfOverlayColor,
  PerfOverlayCorner,
  PerfOverlaySize,
  PerfOverlayStats,
} from "../state/prefs";

/**
 * Live performance readout — a pure DOM overlay, absolutely positioned over
 * the stage. It NEVER draws into the render canvas and never touches the
 * export path, so it cannot affect determinism or WYSIWYG by construction.
 * Mounted only while the pref is on (App gates it), so the disabled state
 * costs literally nothing: no component, no rAF, no polling, no Rust calls.
 *
 * Update strategy (the "keep React churn tiny" requirement): the component
 * renders its row skeleton ONCE per config change and never re-renders on a
 * tick. A single rAF loop samples frame timestamps every frame (that part
 * must run per-frame to measure FPS at all) but only writes text — directly
 * via ref.textContent, no setState — at most every 250 ms. React's
 * reconciler is therefore completely idle between config edits; the per-frame
 * work is one array push + prune.
 */

export interface PerfOverlayProps {
  corner: PerfOverlayCorner;
  size: PerfOverlaySize;
  color: PerfOverlayColor;
  show: PerfOverlayStats;
  /** Renderer badge source of truth — the store's rendererKind (same value
   * ParamsPanel's WEBGPU badge shows). Passed in, not re-detected. */
  rendererKind: string;
}

/** perf_stats payload (src-tauri/src/perfstats.rs, serde camelCase). */
interface PerfStatsPayload {
  processCpuPct: number;
  systemCpuPct: number;
  processMemBytes: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskReadBytesTotal: number;
  diskWrittenBytesTotal: number;
  gpuPct: number | null;
}

/** Latest Rust sample with disk rates derived on this side — the Rust command
 * reports cumulative bytes and the poller diffs consecutive samples. */
interface RustSnapshot {
  stats: PerfStatsPayload;
  readKbps: number;
  writeKbps: number;
}

const FONT_PX: Record<PerfOverlaySize, number> = { s: 10, m: 12, l: 14 };
const COLORS: Record<PerfOverlayColor, string> = {
  accent: "var(--accent)",
  white: "#f4f6fa",
  green: "#53d17a",
  amber: "#e8b43a",
};

/** Corner anchors: top offsets clear the top bar, bottom offsets clear the
 * player bar — plain CSS, no collision logic. */
const CORNER_STYLE: Record<PerfOverlayCorner, React.CSSProperties> = {
  "top-left": { top: 56, left: 12 },
  "top-right": { top: 56, right: 12 },
  "bottom-left": { bottom: 72, left: 12 },
  "bottom-right": { bottom: 72, right: 12 },
};

/** Text update cadence (ms) — ~4 Hz. FPS is still measured every frame. */
const TEXT_INTERVAL_MS = 250;
/** Rolling FPS window (ms). */
const WINDOW_MS = 1000;

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function fmtGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}`;
}

export function PerfOverlay(props: PerfOverlayProps) {
  const { corner, size, color, show, rendererKind } = props;

  // One ref per mutable readout; rows not shown simply have no ref target.
  const fpsRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);
  const rendererRef = useRef<HTMLSpanElement>(null);
  const heapRef = useRef<HTMLSpanElement>(null);
  const cpuRef = useRef<HTMLSpanElement>(null);
  const ramRef = useRef<HTMLSpanElement>(null);
  const diskRef = useRef<HTMLSpanElement>(null);
  const gpuRef = useRef<HTMLSpanElement>(null);

  /** Latest Rust sample; written by the 1 Hz poller, read by the text tick. */
  const rustRef = useRef<RustSnapshot | null>(null);

  const needsRust = show.cpu || show.ram || show.disk || show.gpu;

  // 1 Hz Rust poll — only while a Rust-backed stat is visible, only on
  // desktop. In the browser those rows read "n/a".
  useEffect(() => {
    if (!needsRust || !isTauri()) return;
    let cancelled = false;
    let prev: { t: number; read: number; written: number } | null = null;
    const poll = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const stats = await invoke<PerfStatsPayload>("perf_stats");
        if (cancelled) return;
        const now = performance.now();
        let readKbps = 0;
        let writeKbps = 0;
        if (prev && now > prev.t) {
          const dt = (now - prev.t) / 1000;
          readKbps = Math.max(0, stats.diskReadBytesTotal - prev.read) / 1024 / dt;
          writeKbps = Math.max(0, stats.diskWrittenBytesTotal - prev.written) / 1024 / dt;
        }
        prev = { t: now, read: stats.diskReadBytesTotal, written: stats.diskWrittenBytesTotal };
        rustRef.current = { stats, readKbps, writeKbps };
      } catch {
        // invoke rejections are raw strings; a failed sample just keeps the
        // previous readout (or "…" before the first one lands).
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
      rustRef.current = null;
    };
  }, [needsRust]);

  // Frame sampling + throttled text writes.
  useEffect(() => {
    let raf = 0;
    const times: number[] = [];
    let lastText = 0;
    const desktop = isTauri();

    const writeText = () => {
      const n = times.length;
      if (show.fps && fpsRef.current) {
        const span = n > 1 ? times[n - 1] - times[0] : 0;
        fpsRef.current.textContent = span > 0 ? ((n - 1) / (span / 1000)).toFixed(1) : "—";
      }
      if (show.frameTime && frameRef.current) {
        if (n > 1) {
          let worst = 0;
          for (let i = 1; i < n; i++) worst = Math.max(worst, times[i] - times[i - 1]);
          const avg = (times[n - 1] - times[0]) / (n - 1);
          frameRef.current.textContent = `${avg.toFixed(1)} / ${worst.toFixed(1)} ms`;
        } else {
          frameRef.current.textContent = "—";
        }
      }
      if (show.renderer && rendererRef.current) {
        const canvas = document.querySelector<HTMLCanvasElement>("canvas.viz-canvas");
        const res = canvas ? ` · ${canvas.width}×${canvas.height}` : "";
        rendererRef.current.textContent = `${rendererKind}${res}`;
      }
      if (show.jsHeap && heapRef.current) {
        const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
        heapRef.current.textContent =
          typeof mem?.usedJSHeapSize === "number" ? fmtMB(mem.usedJSHeapSize) : "n/a";
      }
      const rust = rustRef.current;
      const pending = desktop ? "…" : "n/a";
      if (show.cpu && cpuRef.current) {
        cpuRef.current.textContent = rust
          ? `${rust.stats.processCpuPct.toFixed(0)}% · sys ${rust.stats.systemCpuPct.toFixed(0)}%`
          : pending;
      }
      if (show.ram && ramRef.current) {
        ramRef.current.textContent = rust
          ? `${fmtMB(rust.stats.processMemBytes)} · ${fmtGB(rust.stats.memUsedBytes)}/${fmtGB(
              rust.stats.memTotalBytes,
            )} GB`
          : pending;
      }
      if (show.disk && diskRef.current) {
        diskRef.current.textContent = rust
          ? `R ${rust.readKbps.toFixed(0)} · W ${rust.writeKbps.toFixed(0)} KB/s`
          : pending;
      }
      if (show.gpu && gpuRef.current) {
        // gpuPct is Option<f32> on the Rust side and always None on this
        // build — an honest "—" beats a flaky number.
        gpuRef.current.textContent =
          rust && rust.stats.gpuPct !== null
            ? `${rust.stats.gpuPct.toFixed(0)}%`
            : rust
              ? "—"
              : pending;
      }
    };

    // Sample PRESENTED frames, not rAF ticks: rAF fires at display refresh
    // regardless of the frame cap (the cap skips presents inside ticks), so
    // tick-counting pinned the readout at the panel's Hz whatever the cap.
    // The rAF here is only the sampling clock; a timestamp is recorded when
    // the renderer's presented-frame counter advances. Granularity is one
    // tick, which is exact for any presented rate <= the display rate.
    let lastPresented = getPresentedFrames();
    const tick = (t: number) => {
      const presented = getPresentedFrames();
      if (presented !== lastPresented) {
        lastPresented = presented;
        times.push(t);
      }
      while (times.length > 0 && times[0] < t - WINDOW_MS) times.shift();
      if (t - lastText >= TEXT_INTERVAL_MS) {
        lastText = t;
        writeText();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [show, rendererKind]);

  const anyRow =
    show.fps ||
    show.frameTime ||
    show.renderer ||
    show.jsHeap ||
    show.cpu ||
    show.ram ||
    show.disk ||
    show.gpu;
  if (!anyRow) return null;

  const labelStyle: React.CSSProperties = { opacity: 0.65 };
  const valueStyle: React.CSSProperties = { textAlign: "right" };

  return (
    <div
      className="perf-overlay"
      role="status"
      aria-label="Performance statistics"
      style={{
        position: "absolute",
        ...CORNER_STYLE[corner],
        zIndex: 50,
        pointerEvents: "none",
        userSelect: "none",
        background: "rgba(8, 10, 14, 0.72)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "Consolas, 'Cascadia Mono', ui-monospace, monospace",
        fontSize: FONT_PX[size],
        lineHeight: 1.5,
        color: COLORS[color],
        display: "grid",
        gridTemplateColumns: "auto auto",
        columnGap: 10,
      }}
    >
      {show.fps && (
        <>
          <span style={labelStyle}>FPS</span>
          <span ref={fpsRef} style={valueStyle}>
            …
          </span>
        </>
      )}
      {show.frameTime && (
        <>
          <span style={labelStyle}>Frame time</span>
          <span ref={frameRef} style={valueStyle}>
            …
          </span>
        </>
      )}
      {show.renderer && (
        <>
          <span style={labelStyle}>Renderer</span>
          <span ref={rendererRef} style={valueStyle}>
            …
          </span>
        </>
      )}
      {show.jsHeap && (
        <>
          <span style={labelStyle}>JS heap</span>
          <span ref={heapRef} style={valueStyle}>
            …
          </span>
        </>
      )}
      {show.cpu && (
        <>
          <span style={labelStyle}>CPU</span>
          <span ref={cpuRef} style={valueStyle}>
            …
          </span>
        </>
      )}
      {show.ram && (
        <>
          <span style={labelStyle}>RAM</span>
          <span ref={ramRef} style={valueStyle}>
            …
          </span>
        </>
      )}
      {show.disk && (
        <>
          <span style={labelStyle}>Disk</span>
          <span ref={diskRef} style={valueStyle}>
            …
          </span>
        </>
      )}
      {show.gpu && (
        <>
          <span style={labelStyle}>GPU</span>
          <span ref={gpuRef} style={valueStyle}>
            …
          </span>
        </>
      )}
    </div>
  );
}
