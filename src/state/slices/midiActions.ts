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
      if (get().midiEnabled || shared.midiHandle || shared.midiStarting) return;
      // Claimed BEFORE the await (audit S3): two rapid calls both passed the
      // guard, attached two onmidimessage handlers and leaked the first
      // handle — every message then fired twice for the session.
      shared.midiStarting = true;
      // R2-31b: a disable during the permission await must WIN. Capture the
      // generation this claim belongs to; disableMidi bumps it.
      const gen = shared.midiGen;
      const handle = await startMidi(
        (data) => get().handleMidiMessage(data),
        (names) => set({ midiDevices: names }),
      );
      shared.midiStarting = false;
      if (!handle) {
        ctx.flashNotice("MIDI isn't available here (needs a Chromium-based build)");
        return;
      }
      if (gen !== shared.midiGen) {
        // Disabled while the permission prompt was open: the fresh listener
        // must not outlive the answer the user already gave (stop() also
        // clears the device list it published while attaching).
        handle.stop();
        return;
      }
      shared.midiHandle = handle;
      set({ midiEnabled: true });
    },

    disableMidi() {
      shared.midiGen++; // R2-31b: outruns an enable parked on its await
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
        // preset actually has, and clamp to its range. The param's `mod`
        // metadata applies here exactly as on the mod-matrix path (RP-2):
        // "off" params are not CC targets (a stale binding is inert), "snap"
        // params take whole numbers so a fader can't park an enum on 3.7.
        const spec = allParams(presetById(s.presetId)).find((p) => p.key === action.key);
        if (spec && spec.mod !== "off") {
          const value = spec.mod === "snap" ? Math.round(action.value) : action.value;
          get().setParam(action.key, Math.min(spec.max, Math.max(spec.min, value)));
        }
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
