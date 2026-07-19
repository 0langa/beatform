/**
 * Web MIDI browser adapter — the thin, untestable shell around the pure core in
 * midi.ts. Requests access, enumerates inputs, forwards raw messages, and
 * re-attaches on hot-plug. Everything decision-making lives in midi.ts / the
 * store; this file only touches the platform API.
 *
 * Minimal local types so we don't need @types/webmidi (the API surface we use
 * is tiny). Feature-absent (unsupported / denied / non-secure-context) returns
 * null and the app simply has no MIDI — never throws into the caller.
 */

interface WebMidiMessage {
  data: Uint8Array;
}
interface WebMidiInput {
  name: string | null;
  onmidimessage: ((e: WebMidiMessage) => void) | null;
}
interface WebMidiInputMap {
  forEach(cb: (input: WebMidiInput) => void): void;
}
interface WebMidiAccess {
  inputs: WebMidiInputMap;
  onstatechange: (() => void) | null;
}
type RequestMIDIAccess = (opts?: { sysex?: boolean }) => Promise<WebMidiAccess>;

export interface MidiHandle {
  stop(): void;
}

/** True if the platform exposes Web MIDI at all (used to show/hide the UI). */
export function midiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

/**
 * Start listening. `onMessage` gets every raw MIDI packet from every input;
 * `onDevices` gets the current input-name list (and again on every hot-plug).
 * Returns a handle to stop, or null if MIDI is unavailable/denied.
 */
export async function startMidi(
  onMessage: (data: Uint8Array) => void,
  onDevices: (names: string[]) => void,
): Promise<MidiHandle | null> {
  const req = (navigator as unknown as { requestMIDIAccess?: RequestMIDIAccess }).requestMIDIAccess;
  if (!req) return null;
  let access: WebMidiAccess;
  try {
    access = await req({ sysex: false });
  } catch {
    return null; // denied or unsupported context
  }
  const attach = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      names.push(input.name ?? "MIDI device");
      input.onmidimessage = (e) => onMessage(e.data);
    });
    onDevices(names);
  };
  attach();
  access.onstatechange = attach; // hot-plug: re-enumerate + re-attach
  return {
    stop() {
      access.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      access.onstatechange = null;
      onDevices([]);
    },
  };
}
