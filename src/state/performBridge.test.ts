import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disposePerformPublisher,
  getPerformBridgeStats,
  initPerformPublisher,
  notePerformWindowClosed,
  performMirrorActive,
  publishPerformFrame,
  publishPerformLive,
  publishPerformState,
  type PerformChannel,
  type PerformFrameMsg,
  type PerformMsg,
  type PerformStateProviders,
} from "./performBridge";
import type { AudioFeatures } from "../audio/types";
import { DEFAULT_MOTION, DEFAULT_POST } from "../render/types";

/**
 * FEAT-009 publisher contract: inert until a performance surface says
 * hello, full-state response on hello, per-frame publish mirrors the render
 * call's arguments, and bye/close deactivate. The channel is injected — the
 * real BroadcastChannel transport is exercised on-device (two windows), not
 * here.
 */

class FakeChannel implements PerformChannel {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: PerformMsg[] = [];
  closed = false;
  postMessage(msg: unknown): void {
    if (this.closed) throw new Error("posting on a closed channel");
    this.sent.push(msg as PerformMsg);
  }
  close(): void {
    this.closed = true;
  }
  deliver(msg: unknown): void {
    this.onmessage?.({ data: msg } as MessageEvent);
  }
}

function fakeFeatures(): AudioFeatures {
  return {
    bins: new Float32Array(4),
    peaks: new Float32Array(4),
    waveform: new Float32Array(4),
    waveformL: new Float32Array(4),
    waveformR: new Float32Array(4),
    rms: 0,
    energy: 0,
    voice: 0,
    drive: 0,
    driveBeat: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    width: 0,
    lufs: -70,
    kick: 0,
    snare: 0,
    hat: 0,
    bpm: 0,
    beatPhase: 0,
    barPhase: 0,
    beat: false,
    beatIntensity: 0,
    time: 0,
    duration: 60,
  };
}

function providers(): PerformStateProviders {
  return {
    getLive: () => ({
      blackout: false,
      hud: false,
      aspect: "free",
      motion: DEFAULT_MOTION,
      smoothSpectrum: false,
    }),
    getScene: () => ({
      customDefs: [],
      builderStack: { layers: [] } as never,
      bgImageParams: null,
      bgVideoParams: null,
      overlay: { layers: [], meta: { title: "", artist: "" } },
      lyrics: null,
      audiogram: null,
      waveformOverview: null,
    }),
    getAssets: () => ({
      coverUrl: null,
      bgImageUrl: null,
      bgVideoUrl: null,
      overlayAssets: {},
    }),
  };
}

function publishOneFrame(): void {
  publishPerformFrame(
    fakeFeatures(),
    1.5,
    "nebula",
    { hue: 0.5 },
    null,
    null,
    1,
    0,
    { mode: 0, color: [0, 0, 0] },
    DEFAULT_POST,
    null,
    "present-only",
  );
}

afterEach(() => {
  disposePerformPublisher();
  vi.restoreAllMocks();
});

describe("perform publisher", () => {
  it("announces itself with hi on init (receiver-booted-first race)", () => {
    const ch = new FakeChannel();
    initPerformPublisher(providers(), () => ch);
    expect(ch.sent.map((m) => m.type)).toEqual(["hi"]);
  });

  it("is inert before hello — frames and state publishes go nowhere", () => {
    const ch = new FakeChannel();
    initPerformPublisher(providers(), () => ch);
    ch.sent.length = 0;

    publishOneFrame();
    publishPerformState();
    publishPerformLive();

    expect(performMirrorActive()).toBe(false);
    expect(ch.sent).toEqual([]);
  });

  it("hello activates the mirror and answers with assets, scene, live — in that order", () => {
    const ch = new FakeChannel();
    initPerformPublisher(providers(), () => ch);
    ch.sent.length = 0;

    ch.deliver({ type: "hello" });

    expect(performMirrorActive()).toBe(true);
    expect(ch.sent.map((m) => m.type)).toEqual(["assets", "scene", "live"]);
  });

  it("publishes frames with the exact render-call arguments after hello", () => {
    const ch = new FakeChannel();
    initPerformPublisher(providers(), () => ch);
    ch.deliver({ type: "hello" });
    ch.sent.length = 0;

    publishOneFrame();
    publishOneFrame();

    expect(ch.sent).toHaveLength(2);
    const [a, b] = ch.sent as PerformFrameMsg[];
    expect(a.type).toBe("frame");
    expect(a.presetId).toBe("nebula");
    expect(a.params).toEqual({ hue: 0.5 });
    expect(a.t).toBe(1.5);
    expect(a.feedback).toBe("present-only");
    expect(a.prevPresetId).toBeNull();
    expect(b.seq).toBe(a.seq + 1);
    expect(getPerformBridgeStats().framesSent).toBe(2);
  });

  it("bye deactivates; a later hello re-arms with fresh state", () => {
    const ch = new FakeChannel();
    initPerformPublisher(providers(), () => ch);
    ch.deliver({ type: "hello" });
    ch.deliver({ type: "bye" });
    expect(performMirrorActive()).toBe(false);
    ch.sent.length = 0;

    publishOneFrame();
    expect(ch.sent).toEqual([]);

    ch.deliver({ type: "hello" });
    expect(performMirrorActive()).toBe(true);
    expect(ch.sent.map((m) => m.type)).toEqual(["assets", "scene", "live"]);
  });

  it("notePerformWindowClosed covers the destroy() path where pagehide never fired", () => {
    const ch = new FakeChannel();
    initPerformPublisher(providers(), () => ch);
    ch.deliver({ type: "hello" });

    notePerformWindowClosed();

    expect(performMirrorActive()).toBe(false);
    ch.sent.length = 0;
    publishOneFrame();
    expect(ch.sent).toEqual([]);
  });

  it("a throwing postMessage deactivates the mirror instead of poisoning the live loop", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ch = new FakeChannel();
    initPerformPublisher(providers(), () => ch);
    ch.deliver({ type: "hello" });

    ch.closed = true; // every postMessage now throws
    expect(() => publishOneFrame()).not.toThrow();
    expect(performMirrorActive()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("dispose closes the channel and a factory returning null degrades to inert", () => {
    const ch = new FakeChannel();
    const dispose = initPerformPublisher(providers(), () => ch);
    dispose();
    expect(ch.closed).toBe(true);

    initPerformPublisher(providers(), () => null);
    expect(performMirrorActive()).toBe(false);
    expect(() => publishOneFrame()).not.toThrow();
  });
});
