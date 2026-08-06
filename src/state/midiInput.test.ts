import { afterEach, describe, expect, it, vi } from "vitest";
import { midiSupported, startMidi } from "./midiInput";

/**
 * REGRESSION PIN for the VERIFY-003 shipped outage (fixed in v2.69):
 * extracting `navigator.requestMIDIAccess` into a local strips the receiver,
 * every real Chromium then throws `TypeError: Illegal invocation`, and
 * startMidi's catch converts that into "MIDI isn't available" — the entire
 * feature dead in every installed build while unit tests stayed green,
 * because ordinary spoofed doubles are receiver-less plain functions that
 * cannot notice the extraction.
 *
 * The navigator stub below therefore ENFORCES the receiver exactly like the
 * real API: its `requestMIDIAccess` throws unless invoked with the navigator
 * object as `this`. A refactor that re-extracts the method into a local
 * re-creates the shipped bug and fails these tests in plain Node — no MIDI
 * hardware, no loopMIDI, no manual harness (scripts/midi-e2e.mjs) involved.
 */

interface StubInput {
  name: string | null;
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
}

interface StubAccess {
  inputs: { forEach(cb: (input: StubInput) => void): void };
  onstatechange: (() => void) | null;
}

function receiverEnforcingNavigator() {
  const input: StubInput = { name: "Stub Pad", onmidimessage: null };
  const access: StubAccess = {
    inputs: { forEach: (cb) => cb(input) },
    onstatechange: null,
  };
  const nav = {
    /** Mirrors the WebIDL shape: READING the property is fine from anywhere;
     * CALLING the function with any receiver but the navigator throws. */
    get requestMIDIAccess() {
      return function (this: unknown, _opts?: { sysex?: boolean }): Promise<StubAccess> {
        if (this !== nav) throw new TypeError("Illegal invocation");
        return Promise.resolve(access);
      };
    },
  };
  return { nav, access, input };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startMidi against a receiver-enforcing Web MIDI stub", () => {
  it("the stub itself enforces the receiver, so these tests cannot go vacuous", async () => {
    const { nav, access } = receiverEnforcingNavigator();
    // The exact shipped mistake: method extracted into a local, called bare.
    const extracted = nav.requestMIDIAccess;
    expect(() => extracted({ sysex: false })).toThrow(TypeError);
    expect(() => extracted({ sysex: false })).toThrow("Illegal invocation");
    // …while the method-call spelling resolves normally.
    await expect(nav.requestMIDIAccess({ sysex: false })).resolves.toBe(access);
  });

  it("succeeds — proving requestMIDIAccess is invoked as a method ON navigator", async () => {
    const { nav, input } = receiverEnforcingNavigator();
    vi.stubGlobal("navigator", nav);
    expect(midiSupported()).toBe(true);

    const messages: Uint8Array[] = [];
    let devices: string[] | null = null;
    const handle = await startMidi(
      (data) => messages.push(data),
      (names) => {
        devices = names;
      },
    );

    // null is exactly what the VERIFY-003 outage produced (the catch turned
    // Illegal invocation into "unavailable"), so this line is the pin.
    expect(handle, "startMidi must survive a receiver-enforcing navigator").not.toBeNull();
    expect(devices).toEqual(["Stub Pad"]);

    // And the adapter actually attached: raw packets flow through.
    const packet = new Uint8Array([0x90, 60, 127]);
    input.onmidimessage?.({ data: packet });
    expect(messages).toEqual([packet]);

    handle?.stop();
  });

  it("stop() detaches listeners and reports an empty device list", async () => {
    const { nav, access, input } = receiverEnforcingNavigator();
    vi.stubGlobal("navigator", nav);

    let devices: string[] | null = null;
    const handle = await startMidi(
      () => {},
      (names) => {
        devices = names;
      },
    );
    expect(handle).not.toBeNull();
    expect(input.onmidimessage).not.toBeNull();
    expect(access.onstatechange, "hot-plug re-attach must be registered").not.toBeNull();

    handle?.stop();
    expect(input.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
    expect(devices).toEqual([]);
  });

  it("returns null (never throws) when the platform has no Web MIDI", async () => {
    vi.stubGlobal("navigator", {});
    expect(midiSupported()).toBe(false);
    await expect(
      startMidi(
        () => {},
        () => {},
      ),
    ).resolves.toBeNull();
  });
});
