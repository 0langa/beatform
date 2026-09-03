import { allParams } from "../../render/types";
import { presetById } from "../../render/presets";
import {
  applyMidiMessage,
  bindingId,
  learnBinding,
  upsertBinding,
  type MidiCommand,
} from "../midi";
import { startMidi } from "../midiInput";
import { saveStoredMidiBindings } from "../persistence";
import { getPrefs, setPrefs } from "../prefs";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";
import { shared } from "./shared";

export function midiActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  /**
   * The one start path. `quiet` is the boot re-enable (HD-18): a launch on
   * which Web MIDI turns out to be unavailable must not toast "MIDI isn't
   * available" every single time — the explicit Enable button still does.
   */
  async function start(quiet: boolean): Promise<void> {
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
      if (!quiet) ctx.flashNotice("MIDI isn't available here (needs a Chromium-based build)");
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
    // HD-18: remembered across launches — initApp's restoreMidi reads it.
    // Only a SUCCESSFUL enable writes it, so a denied prompt never arms a
    // silent retry the user did not ask for.
    setPrefs({ midiEnabled: true });
  }

  /**
   * HD-19: a note bound to one of the Perform drawer's own controls fires
   * EXACTLY the store action the drawer button or the key fires — same
   * arming rule for blackout (the 0 key and the button both gate on a
   * performance surface), same beat-quantized walk for the mode steps
   * (stepPreset -> queuePreset, like N / P). No parallel code path: if the
   * mouse cannot do it, neither can the pad.
   */
  function runCommand(command: MidiCommand): void {
    const s = get();
    switch (command) {
      case "blackout":
        if (s.stageMode || s.performOpen) get().setBlackout(!s.blackout);
        break;
      case "playPause":
        void get().togglePlay();
        break;
      case "nextMode":
        get().stepPreset(1);
        break;
      case "prevMode":
        get().stepPreset(-1);
        break;
    }
  }

  return {
    enableMidi() {
      return start(false);
    },

    restoreMidi() {
      if (!getPrefs().midiEnabled) return Promise.resolve();
      return start(true);
    },

    disableMidi() {
      shared.midiGen++; // R2-31b: outruns an enable parked on its await
      shared.midiHandle?.stop();
      shared.midiHandle = null;
      set({ midiEnabled: false, midiDevices: [], midiLearn: null });
      setPrefs({ midiEnabled: false });
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
      } else if (action.type === "preset") {
        get().queuePreset(action.id); // inherits the beat-quantize takeover
      } else {
        runCommand(action.command);
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
