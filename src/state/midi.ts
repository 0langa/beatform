/**
 * Web MIDI mapping — the pure, testable core (Phase 9.3). The browser adapter
 * (requestMIDIAccess + input listeners) is a thin shell in the store that feeds
 * raw messages here and applies the resulting actions.
 *
 * Local-only, no drivers, no network. Live-performance control: MIDI never
 * touches the export path, so determinism is unaffected.
 *
 * Bindings are keyed by their trigger (`cc:<n>` / `note:<n>`), so re-learning
 * the same control replaces the old binding instead of stacking duplicates.
 */

/** A control-change knob/fader → a numeric param, scaled into [min,max]. */
export interface CcBinding {
  kind: "cc";
  /** MIDI CC number 0..127. */
  cc: number;
  /** Target param key on the active preset. */
  param: string;
  /** Range captured at learn time (usually the param spec's own min/max). */
  min: number;
  max: number;
}

/** A note → a preset switch (routed through queuePreset, so it inherits the
 * beat-quantize takeover just like the number-key hotkeys). */
export interface NoteBinding {
  kind: "note";
  /** MIDI note number 0..127. */
  note: number;
  presetId: string;
}

export type MidiBinding = CcBinding | NoteBinding;

/** Stable map key for a binding — also the dedupe key. */
export function bindingId(b: MidiBinding): string {
  return b.kind === "cc" ? `cc:${b.cc}` : `note:${b.note}`;
}

/** What an incoming MIDI message resolves to, given the current bindings. */
export type MidiAction =
  { type: "param"; key: string; value: number } | { type: "preset"; id: string };

const STATUS_MASK = 0xf0;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

function status(data: ArrayLike<number>): number {
  return (data[0] ?? 0) & STATUS_MASK;
}

/** True for a MIDI message this app cares about (CC, or a note-on with
 * velocity > 0). Note-off and running-status noise are ignored. */
export function isBindableMessage(data: ArrayLike<number>): boolean {
  const s = status(data);
  if (s === CONTROL_CHANGE) return true;
  if (s === NOTE_ON && (data[2] ?? 0) > 0) return true;
  return false;
}

/**
 * Resolve a raw MIDI message against the bindings. Channel is intentionally
 * ignored (match any channel — most controllers default to channel 1 and users
 * don't want to think about it). Returns null when nothing matches.
 */
export function applyMidiMessage(
  bindings: MidiBinding[],
  data: ArrayLike<number>,
): MidiAction | null {
  const s = status(data);
  if (s === CONTROL_CHANGE) {
    const cc = data[1] ?? 0;
    const raw = data[2] ?? 0;
    for (const b of bindings) {
      if (b.kind === "cc" && b.cc === cc) {
        const t = Math.max(0, Math.min(127, raw)) / 127;
        return { type: "param", key: b.param, value: b.min + t * (b.max - b.min) };
      }
    }
    return null;
  }
  if (s === NOTE_ON && (data[2] ?? 0) > 0) {
    const note = data[1] ?? 0;
    for (const b of bindings) {
      if (b.kind === "note" && b.note === note) return { type: "preset", id: b.presetId };
    }
    return null;
  }
  return null;
}

/** What the UI is currently arming a "MIDI learn" for. */
export type MidiLearn =
  { kind: "cc"; param: string; min: number; max: number } | { kind: "note"; presetId: string };

/**
 * Build the binding a learn gesture produces from the first matching message.
 * A CC-learn only binds to a CC message; a note-learn only to a note-on — so
 * wiggling the wrong control during learn is simply ignored (returns null).
 */
export function learnBinding(learn: MidiLearn, data: ArrayLike<number>): MidiBinding | null {
  const s = status(data);
  if (learn.kind === "cc" && s === CONTROL_CHANGE) {
    return { kind: "cc", cc: data[1] ?? 0, param: learn.param, min: learn.min, max: learn.max };
  }
  if (learn.kind === "note" && s === NOTE_ON && (data[2] ?? 0) > 0) {
    return { kind: "note", note: data[1] ?? 0, presetId: learn.presetId };
  }
  return null;
}

/** Insert/replace a binding (dedupe by trigger). */
export function upsertBinding(bindings: MidiBinding[], next: MidiBinding): MidiBinding[] {
  const id = bindingId(next);
  return [...bindings.filter((b) => bindingId(b) !== id), next];
}

/** Validate a persisted bindings array (localStorage/project), dropping junk. */
export function validMidiBindings(raw: unknown): MidiBinding[] {
  if (!Array.isArray(raw)) return [];
  const out: MidiBinding[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    if (
      o.kind === "cc" &&
      typeof o.cc === "number" &&
      typeof o.param === "string" &&
      typeof o.min === "number" &&
      typeof o.max === "number"
    ) {
      out.push({ kind: "cc", cc: o.cc | 0, param: o.param, min: o.min, max: o.max });
    } else if (o.kind === "note" && typeof o.note === "number" && typeof o.presetId === "string") {
      out.push({ kind: "note", note: o.note | 0, presetId: o.presetId });
    }
  }
  // Dedupe by trigger, last wins.
  const map = new Map<string, MidiBinding>();
  for (const b of out) map.set(bindingId(b), b);
  return [...map.values()];
}
