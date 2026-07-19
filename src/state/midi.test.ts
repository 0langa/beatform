import { describe, expect, it } from "vitest";
import {
  applyMidiMessage,
  bindingId,
  isBindableMessage,
  learnBinding,
  upsertBinding,
  validMidiBindings,
  type MidiBinding,
} from "./midi";

// CC 74 on channel 1 = [0xB0, 74, value]; Note-on 60 = [0x90, 60, vel].
const CC = (n: number, v: number) => [0xb0, n, v];
const NOTE_ON = (n: number, v = 100) => [0x90, n, v];
const NOTE_OFF = (n: number) => [0x80, n, 0];

const ccBind: MidiBinding = { kind: "cc", cc: 74, param: "glow", min: 0, max: 1 };
const noteBind: MidiBinding = { kind: "note", note: 60, presetId: "radial-burst" };

describe("applyMidiMessage", () => {
  it("scales a CC value into the param range", () => {
    expect(applyMidiMessage([ccBind], CC(74, 0))).toEqual({ type: "param", key: "glow", value: 0 });
    expect(applyMidiMessage([ccBind], CC(74, 127))).toEqual({
      type: "param",
      key: "glow",
      value: 1,
    });
    const mid = applyMidiMessage([{ kind: "cc", cc: 74, param: "x", min: 2, max: 10 }], CC(74, 64));
    expect(mid?.type).toBe("param");
    expect((mid as { value: number }).value).toBeCloseTo(2 + (64 / 127) * 8, 5);
  });

  it("maps a note-on to a preset switch", () => {
    expect(applyMidiMessage([noteBind], NOTE_ON(60))).toEqual({
      type: "preset",
      id: "radial-burst",
    });
  });

  it("ignores note-off and zero-velocity note-on", () => {
    expect(applyMidiMessage([noteBind], NOTE_OFF(60))).toBeNull();
    expect(applyMidiMessage([noteBind], NOTE_ON(60, 0))).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(applyMidiMessage([ccBind], CC(75, 100))).toBeNull(); // different CC
    expect(applyMidiMessage([noteBind], NOTE_ON(61))).toBeNull(); // different note
    expect(applyMidiMessage([], CC(74, 100))).toBeNull(); // no bindings
  });

  it("matches on any channel (channel byte ignored)", () => {
    expect(applyMidiMessage([ccBind], [0xb5, 74, 127])).toEqual({
      type: "param",
      key: "glow",
      value: 1,
    });
  });
});

describe("isBindableMessage", () => {
  it("accepts CC and note-on, rejects note-off / zero-velocity", () => {
    expect(isBindableMessage(CC(1, 1))).toBe(true);
    expect(isBindableMessage(NOTE_ON(60))).toBe(true);
    expect(isBindableMessage(NOTE_OFF(60))).toBe(false);
    expect(isBindableMessage(NOTE_ON(60, 0))).toBe(false);
  });
});

describe("learnBinding", () => {
  it("binds a CC-learn only to a CC message", () => {
    expect(learnBinding({ kind: "cc", param: "glow", min: 0, max: 1 }, CC(74, 40))).toEqual(ccBind);
    // wiggling a note during a CC-learn is ignored
    expect(learnBinding({ kind: "cc", param: "glow", min: 0, max: 1 }, NOTE_ON(60))).toBeNull();
  });

  it("binds a note-learn only to a note-on", () => {
    expect(learnBinding({ kind: "note", presetId: "radial-burst" }, NOTE_ON(60))).toEqual(noteBind);
    expect(learnBinding({ kind: "note", presetId: "radial-burst" }, CC(74, 40))).toBeNull();
    expect(learnBinding({ kind: "note", presetId: "radial-burst" }, NOTE_ON(60, 0))).toBeNull();
  });
});

describe("upsertBinding / bindingId", () => {
  it("replaces a binding with the same trigger instead of stacking", () => {
    const a = upsertBinding([ccBind], { kind: "cc", cc: 74, param: "vignette", min: 0, max: 1 });
    expect(a).toHaveLength(1);
    expect((a[0] as { param: string }).param).toBe("vignette");
  });

  it("keeps distinct triggers", () => {
    const a = upsertBinding([ccBind], noteBind);
    expect(a).toHaveLength(2);
    expect(bindingId(ccBind)).toBe("cc:74");
    expect(bindingId(noteBind)).toBe("note:60");
  });
});

describe("validMidiBindings", () => {
  it("keeps valid entries, drops junk, dedupes by trigger", () => {
    const out = validMidiBindings([
      ccBind,
      noteBind,
      { kind: "cc", cc: 74, param: "later", min: 0, max: 1 }, // dupe trigger, last wins
      { kind: "bogus" },
      null,
      42,
    ]);
    expect(out).toHaveLength(2);
    const cc = out.find((b) => b.kind === "cc") as { param: string };
    expect(cc.param).toBe("later");
  });

  it("returns [] for non-arrays", () => {
    expect(validMidiBindings(null)).toEqual([]);
    expect(validMidiBindings("nope")).toEqual([]);
  });
});
