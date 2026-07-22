import type { PresetDef } from "../../render/types";
import { WebGPURenderer } from "../../render/webgpuRenderer";
import {
  customPresets,
  newCustomPresetId,
  parseCustomPreset,
  registerCustomPreset,
  serializeCustomPreset,
  ShaderParseError,
  unregisterCustomPreset,
  validCustomPreset,
} from "../../render/presets/custom";
import { presets } from "../../render/presets";
import { APP_VERSION } from "../../version";
import { safeName } from "../batch";
import { saveTextFile } from "../platform";
import { saveCustomPresets, saveStoredTimeline } from "../persistence";
import { getRenderer } from "../services";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

export function customShaderActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    setShowShaderEditor(open) {
      set({ showShaderEditor: open });
    },

    async checkCustomPreset(def) {
      const r = getRenderer();
      if (!(r instanceof WebGPURenderer)) {
        return ["Custom presets need the WebGPU renderer (Canvas2D fallback active)"];
      }
      return r.compilePresetCheck(def);
    },

    async saveCustomPreset(defIn) {
      const def = validCustomPreset(defIn);
      if (!def) return ["Preset failed validation (id/name/params/wgsl shape)"];
      const errors = await get().checkCustomPreset(def);
      if (errors.length > 0) return errors;
      registerCustomPreset(def);
      const customDefs = [...get().customDefs.filter((d) => d.id !== def.id), def];
      set({ customDefs });
      // Quota failure must not hide behind a success toast — the shader would
      // exist this session and silently vanish on restart.
      const persisted = saveCustomPresets(customDefs);
      get().switchPreset(def.id);
      ctx.flashNotice(
        persisted
          ? `Custom visual "${def.name}" saved`
          : `"${def.name}" is active but too large to remember — export it as .avshader to keep it`,
      );
      return [];
    },

    deleteCustomPreset(id) {
      // This mutates document state (timeline scenes below), so it has to join
      // the undo history like every other document write — without it the next
      // Ctrl+Z restored a timeline referencing a preset that no longer exists.
      ctx.record("delete-preset");
      unregisterCustomPreset(id);
      const customDefs = get().customDefs.filter((d) => d.id !== id);
      set({ customDefs });
      saveCustomPresets(customDefs);
      // Never leave the app pointing at a deleted visual.
      if (get().presetId === id) get().switchPreset(presets[0].id);
      // Timeline scenes too: a scene keeping the dead id would silently
      // render the default visual live AND in exports (and the next reload's
      // validTimeline would drop the scene outright).
      const tl = get().timeline;
      if (tl.scenes.some((s) => s.presetId === id)) {
        const repaired = {
          ...tl,
          scenes: tl.scenes.map((s) =>
            s.presetId === id ? { ...s, presetId: get().presetId } : s,
          ),
        };
        set({ timeline: repaired });
        saveStoredTimeline(repaired);
        ctx.flashNotice("Timeline scenes using the deleted visual now use the active one");
      }
    },

    async exportCustomPreset(id) {
      const def =
        get().customDefs.find((d) => d.id === id) ?? customPresets().find((d) => d.id === id);
      if (!def) return;
      try {
        const path = await saveTextFile(
          `${safeName(def.name)}.avshader`,
          serializeCustomPreset(def, APP_VERSION),
          [{ name: "Beatform shader", extensions: ["avshader"] }],
        );
        if (path) ctx.flashNotice(`Shader "${def.name}" saved — share the file anywhere`);
      } catch (e) {
        set({ error: `Could not save shader: ${(e as Error).message}` });
      }
    },

    async importCustomPresetText(contents) {
      try {
        const imported = parseCustomPreset(contents);
        // Mint a fresh id — an import must never silently overwrite an
        // existing custom visual that happens to share an id.
        const def: PresetDef = { ...imported, id: newCustomPresetId() };
        const errors = await get().saveCustomPreset(def);
        if (errors.length > 0) {
          set({ error: `Shader failed to compile: ${errors[0]}` });
        }
      } catch (e) {
        set({
          error:
            e instanceof ShaderParseError
              ? `Could not import shader: ${e.message}`
              : `Could not import shader: ${(e as Error).message}`,
        });
      }
    },
  } satisfies Partial<VizState>;
}
