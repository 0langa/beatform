// Shared CDP client for the device harnesses — the ONE copy of what used to
// be pasted into a dozen scripts/*.mjs files with drifting behavior (P-14).
// Talks to a WebView2 page over its webSocketDebuggerUrl.
//
// Hard-earned behavior, kept deliberately:
//  - close/error rejects every in-flight send. A dying app (crash, OOM)
//    closes the socket; without this a poll loop waits forever on a corpse —
//    the failure mode of lyrics-e2e's first run, and previously fixed in
//    only ONE of the twelve copies.
//  - eval() surfaces exceptionDetails with the richest message available
//    (description, then thrown value, then the bare text).
//  - shotCanvas() dismisses the update prompt and the autosave toast, raises
//    chromeIdle, and closes the Visuals dock before framing: a stale debug
//    exe sees the freshly published release and pops the update hero (with a
//    backdrop blur) over everything, and an open dock is composited over the
//    full-bleed canvas it clips to. Everything it changes, it changes back.
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new globalThis.WebSocket(url);
  }

  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
    this.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
    });
    const failAll = (why) => () => {
      for (const p of this.pending.values()) p.reject(new Error(why));
      this.pending.clear();
    };
    this.ws.addEventListener("close", failAll("CDP socket closed — app gone?"), { once: true });
    this.ws.addEventListener("error", failAll("CDP socket error"), { once: true });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already dead */
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, awaitPromise = true) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception;
      throw new Error(
        ex?.description ??
          (ex?.value != null ? JSON.stringify(ex.value) : null) ??
          r.exceptionDetails.text ??
          "eval failed",
      );
    }
    return r.result.value;
  }

  /** Full-page screenshot to `file`. Returns the path (callers own logging —
   * the harnesses' console contracts differ and are grepped by other tools). */
  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  /** Screenshot clipped to the live canvas (the visual, no chrome), after
   * dismissing anything that could be composited on top of it. Returns
   * the path. */
  async shotCanvas(file, { settleMs = 250 } = {}) {
    // Also closes the Visuals dock, remembering whether it was open (H8).
    // The dock overlays the full-bleed canvas: its bounding rect stays the
    // same, but Page.captureScreenshot composites the dock over the clip.
    // GATES §3 makes canvas-only wave shots the basis of a test:gpu re-bless,
    // so UI chrome in one side of the comparison would make the evidence lie.
    const hadPanel = await this.eval(
      `(() => {
        document.querySelector(".update-hero-close")?.click();
        const st = window.__store.getState();
        if (st.recoveredDoc) st.dismissAutosave();
        window.__store.setState({ chromeIdle: true });
        const was = st.showPanel;
        // setShowPanel, not a raw setState: it also writes the panelOpen
        // pref, so a raw write would leave prefs disagreeing with the store
        // and the dock would come back on the next boot anyway.
        if (was) st.setShowPanel(false);
        return was === true;
      })()`,
      false,
    ).catch(() => false);
    try {
      // The settle covers the dock disappearing from the composited page as
      // well as the other dismissals.
      await sleep(settleMs);
      const rect = await this.eval(
        `(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect();
           return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
        false,
      );
      const r = await this.send("Page.captureScreenshot", {
        format: "png",
        clip: { ...rect, scale: 1 },
      });
      writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    } finally {
      // The dock goes back where the user had it even if the shot threw. A
      // dead socket can restore nothing, and that failure must not replace
      // the one the harness is already reporting.
      if (hadPanel) {
        await this.eval(`window.__store.getState().setShowPanel(true); true`, false).catch(
          () => {},
        );
      }
    }
  }
}
