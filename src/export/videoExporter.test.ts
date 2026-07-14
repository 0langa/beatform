import { describe, expect, it } from "vitest";
import { exportVideo } from "./videoExporter";

describe("exportVideo abort handling", () => {
  it("rejects an already-aborted signal before touching the audio", async () => {
    const ac = new AbortController();
    ac.abort();
    // The guard runs before pcmFromAudioBuffer, so a null buffer is safe here
    // and proves the point: nothing is read. Without the guard, runInWorker
    // only ever calls addEventListener("abort") — which never fires for a
    // signal aborted beforehand — so the whole job would render and only then
    // be thrown away.
    await expect(
      exportVideo(null as unknown as AudioBuffer, {
        width: 256,
        height: 144,
        fps: 30,
        bitrate: 1_000_000,
        presetId: "spectrum-bars",
        params: {},
        bg: { kind: "solid", colorA: "#000", colorB: "#000", angle: 0, alpha: 1 } as never,
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
