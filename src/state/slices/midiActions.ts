import { allParams } from "../../render/types";
import { presetById } from "../../render/presets";
import { applyMidiMessage, bindingId, learnBinding, upsertBinding } from "../midi";
import { startMidi } from "../midiInput";
import { saveStoredMidiBindings } from "../persistence";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

export function midiActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    async enableMidi() {
      if (get().midiEnabled || shared.midiHandle) return;
      const handle = await startMidi(
        (data) => get().handleMidiMessage(data),
        (names) => set({ midiDevices: names }),
      );
      if (!handle) {
        ctx.flashNotice("MIDI isn't available here (needs a Chromium-based build)");
        return;
      }
      shared.midiHandle = handle;
      set({ midiEnabled: true });
    },

    disableMidi() {
      shared.midiHandle?.stop();
      shared.midiHandle = null;
      set({ midiEnabled: false, midiDevices: [], midiLearn: null });
    },

    handleMidiMessage(data) {
      const s = get();
      // Learn mode: the first matching message becomes a binding, and is NOT
      // also applied (so wiggling the control to learn it doesn't fire it).
      if (s.midiLearn) {
        const b = learnBinding(s.midiLearn, data);
        if (b) {
          const midiBindings = upsertBinding(s.midiBindings, b);
          set({ midiBindings, midiLearn: null });
          saveStoredMidiBindings(midiBindings);
        }
        return;
      }
      const action = applyMidiMessage(s.midiBindings, data);
      if (!action) return;
      if (action.type === "param") {
        // A binding can outlive a mode switch — only drive a param the active
        // preset actually has, and clamp to its range.
        const spec = allParams(presetById(s.presetId)).find((p) => p.key === action.key);
        if (spec) get().setParam(action.key, Math.min(spec.max, Math.max(spec.min, action.value)));
      } else {
        get().queuePreset(action.id); // inherits the beat-quantize takeover
      }
    },

    setMidiLearn(learn) {
      set({ midiLearn: learn });
    },

    removeMidiBinding(id) {
      const midiBindings = get().midiBindings.filter((b) => bindingId(b) !== id);
      set({ midiBindings });
      saveStoredMidiBindings(midiBindings);
    },
  } satisfies Partial<VizState>;
}
