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
import { knownPresetId, presetById, presets } from "../render/presets";

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

  it("rejects non-finite numbers instead of letting NaN reach a uniform", () => {
    expect(validMidiBindings([{ kind: "cc", cc: 1, param: "glow", min: NaN, max: 1 }])).toEqual([]);
    expect(
      validMidiBindings([{ kind: "cc", cc: 1, param: "glow", min: 0, max: Infinity }]),
    ).toEqual([]);
    expect(validMidiBindings([{ kind: "note", note: NaN, presetId: "x" }])).toEqual([]);
  });

  it("clamps CC and note numbers into MIDI's 0..127 range", () => {
    const out = validMidiBindings([
      { kind: "cc", cc: 999, param: "glow", min: 0, max: 1 },
      { kind: "note", note: -5, presetId: "x" },
    ]);
    expect((out.find((b) => b.kind === "cc") as { cc: number }).cc).toBe(127);
    expect((out.find((b) => b.kind === "note") as { note: number }).note).toBe(0);
  });

  /**
   * E2. A note binding is a PERSISTED preset id (localStorage
   * `viz.midiBindings.v1`), so it rides the same rename map every other
   * persisted-id loader does. It did not: a pad bound to Particles before
   * v2.68 stored "starfield", which `presetById` cannot resolve, so
   * `queuePreset` -> `switchPreset` fell through to `presets[0]` and the pad
   * switched the live set to Spectrum Bars.
   */
  describe("renamed preset ids on a persisted note binding", () => {
    it("maps a legacy id to its current spelling", () => {
      const out = validMidiBindings([{ kind: "note", note: 36, presetId: "starfield" }]);
      expect(out).toEqual([{ kind: "note", note: 36, presetId: "particles" }]);
    });

    it("the mapped id is one presetById can actually render", () => {
      const b = validMidiBindings([{ kind: "note", note: 36, presetId: "starfield" }])[0];
      const id = (b as { presetId: string }).presetId;
      expect(knownPresetId(id)).toBe(true);
      // The pre-fix failure was silent: the WRONG mode, not a no-op.
      expect(presetById(id).id).toBe(id);
      expect(presetById(id).id).not.toBe(presets[0].id);
    });

    it("leaves current ids and unknown-but-current ids alone", () => {
      const out = validMidiBindings([
        { kind: "note", note: 1, presetId: "particles" },
        // A custom visual the user has not re-imported yet still keeps its pad:
        // canonicalPresetId is a rename map, not a validity check.
        { kind: "note", note: 2, presetId: "custom-abc" },
      ]);
      expect(out.map((b) => (b as { presetId: string }).presetId)).toEqual([
        "particles",
        "custom-abc",
      ]);
    });

    it("is idempotent — re-saving a migrated binding does not move it again", () => {
      const once = validMidiBindings([{ kind: "note", note: 36, presetId: "starfield" }]);
      expect(validMidiBindings(once)).toEqual(once);
    });
  });
});
