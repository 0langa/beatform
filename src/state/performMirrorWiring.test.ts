// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  initPerformPublisher,
  type PerformChannel,
  type PerformLiveMsg,
  type PerformMsg,
} from "./performBridge";

/**
 * Review F1 — the WIRING test the pure sig-builder tests could not stand in
 * for: the store-bottom subscribe block itself (store.ts). The defect it
 * pins: while the mirror is inactive every subscribe fire nulls the
 * baseline; hello activates and pushes full state WITHOUT a store write; so
 * the FIRST write after activation used to seed the baseline from
 * post-change state and publish nothing — show-night shape: paused + idle,
 * open the output window, press 0 → operator says "Blacked out", audience
 * output keeps rendering.
 *
 * This imports the REAL store module (its subscription included) and swaps
 * the publisher's channel for an in-memory fake — the exact module instance
 * the store wired, so a regression in the subscribe block reddens here.
 */

class FakeChannel implements PerformChannel {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: PerformMsg[] = [];
  postMessage(msg: unknown): void {
    this.sent.push(msg as PerformMsg);
  }
  close(): void {}
  deliver(msg: unknown): void {
    this.onmessage?.({ data: msg } as MessageEvent);
  }
}

const { useVizStore } = await import("./store");
const { buildPerformAssets, buildPerformLive, buildPerformScene } =
  await import("./slices/performActions");

describe("perform mirror wiring (store subscription -> publisher)", () => {
  it("publishes the FIRST store write after activation instead of swallowing it into the baseline", () => {
    const ch = new FakeChannel();
    // Re-init the module-level publisher with a fake channel, serving the
    // store's own builders — identical wiring to the store-bottom init.
    initPerformPublisher(
      {
        getLive: () => buildPerformLive(useVizStore.getState()),
        getScene: () => buildPerformScene(useVizStore.getState()),
        getAssets: () => buildPerformAssets(useVizStore.getState()),
      },
      () => ch,
    );

    // Deterministic starting point: one write while INACTIVE nulls the
    // subscription's baseline (the defect's precondition).
    useVizStore.setState({ blackout: false });
    // Activation is hello — a channel message, NO store write involved.
    ch.deliver({ type: "hello" });
    const afterHello = ch.sent.length; // hi + assets/scene/live

    // The write the defect swallowed. With the fix, the null-baseline seed
    // republishes full state (idempotent on the receiver); without it,
    // nothing is sent and this test is red.
    useVizStore.setState({ blackout: true });
    const extra = ch.sent.slice(afterHello);
    expect(extra.length).toBeGreaterThan(0);
    const lastLive = [...ch.sent].reverse().find((m): m is PerformLiveMsg => m.type === "live");
    expect(lastLive?.blackout).toBe(true);

    // From the second write on, the diff path takes over: exactly the
    // changed tier publishes, nothing else.
    const beforeSecond = ch.sent.length;
    useVizStore.setState({ blackout: false });
    const second = ch.sent.slice(beforeSecond);
    expect(second.map((m) => m.type)).toEqual(["live"]);
    expect((second[0] as PerformLiveMsg).blackout).toBe(false);

    // And an untouched-tier write publishes nothing (the quietness the
    // three-tier split exists for).
    const beforeNoop = ch.sent.length;
    useVizStore.setState({ blackout: false });
    expect(ch.sent.length).toBe(beforeNoop);
  });

  it("deactivation drops the baseline so a reconnect re-seeds instead of diffing stale sigs", () => {
    const ch = new FakeChannel();
    initPerformPublisher(
      {
        getLive: () => buildPerformLive(useVizStore.getState()),
        getScene: () => buildPerformScene(useVizStore.getState()),
        getAssets: () => buildPerformAssets(useVizStore.getState()),
      },
      () => ch,
    );
    useVizStore.setState({ blackout: false });
    ch.deliver({ type: "hello" });
    useVizStore.setState({ blackout: true }); // seeds + publishes (F1 path)

    ch.deliver({ type: "bye" }); // window gone
    useVizStore.setState({ blackout: false }); // inactive: nulls baseline, no publish
    const beforeReconnect = ch.sent.length;

    ch.deliver({ type: "hello" }); // reconnect: full state again
    expect(ch.sent.slice(beforeReconnect).map((m) => m.type)).toEqual(["assets", "scene", "live"]);
    // First write after the reconnect publishes too — same F1 guarantee.
    const beforeWrite = ch.sent.length;
    useVizStore.setState({ blackout: true });
    expect(ch.sent.length).toBeGreaterThan(beforeWrite);
  });
});
