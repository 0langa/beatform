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
import { isTauri, saveTextFile, transpileShadertoy } from "../platform";
import { saveCustomPresets, saveStoredTimeline } from "../persistence";
import { getRenderer } from "../services";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

export function customShaderActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    setShowShaderEditor(open) {
      set({ showShaderEditor: open });
    },

    openShadertoyImport(editId) {
      set({ showShadertoyImport: true, shadertoyImportEditId: editId ?? null });
    },

    closeShadertoyImport() {
      set({ showShadertoyImport: false, shadertoyImportEditId: null });
    },

    async importShadertoyGlsl(glsl, meta, editId, signal) {
      if (!isTauri()) {
        return ["Importing Shadertoy shaders needs the desktop app (the translator runs there)"];
      }
      let result;
      try {
        result = await transpileShadertoy(glsl);
      } catch (e) {
        return [`Shader translator unavailable: ${(e as Error).message}`];
      }
      // Whole-lane review, CRITICAL on top of E2-U4: transpileShadertoy is
      // one opaque Rust invoke() with no cancellation path — a genuine
      // hang there cannot be interrupted, only outlasted. If the caller's
      // own timeout already fired while this was in flight, the RESULT is
      // still real GLSL->WGSL output, but applying it now would switch the
      // live visual to something the user was already told had failed —
      // stop here, before even building `def`.
      if (signal?.aborted) return [];
      if (!result.ok || !result.wgsl) {
        return result.errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message));
      }
      const attribution = [meta.author?.trim() && `by ${meta.author.trim()}`, meta.license?.trim()]
        .filter(Boolean)
        .join(" — ");
      const def: PresetDef = {
        id: editId ?? newCustomPresetId(),
        name: meta.name.trim() || "Imported visual",
        ...(attribution ? { description: attribution } : {}),
        params: [],
        wgsl: result.wgsl,
        shadertoy: {
          glsl,
          ...(meta.author?.trim() ? { author: meta.author.trim() } : {}),
          ...(meta.source?.trim() ? { source: meta.source.trim() } : {}),
          ...(meta.license?.trim() ? { license: meta.license.trim() } : {}),
        },
      };
      // saveCustomPreset runs the on-device compile check (the tint gate the
      // Rust-side validator cannot replace), registers, persists, switches.
      // `signal` forwarded: its OWN await (checkCustomPreset) is the other
      // hang risk in this whole chain, and needs the identical guard.
      return get().saveCustomPreset(def, signal);
    },

    async checkCustomPreset(def) {
      const r = getRenderer();
      if (!(r instanceof WebGPURenderer)) {
        return ["Custom presets need the WebGPU renderer (Canvas2D fallback active)"];
      }
      return r.compilePresetCheck(def);
    },

    async saveCustomPreset(defIn, signal) {
      const def = validCustomPreset(defIn);
      if (!def) return ["Preset failed validation (id/name/params/wgsl shape)"];
      const errors = await get().checkCustomPreset(def);
      // Whole-lane review, CRITICAL on top of E2-U4: checkCustomPreset's
      // on-device WebGPU compile has no cancellation path of its own either
      // — same reasoning as importShadertoyGlsl's check above. A caller
      // that timed out and already told the user "compile timed out" must
      // not have this arrive five seconds later and silently apply anyway.
      if (signal?.aborted) return [];
      if (errors.length > 0) return errors;
      // E2-D2 fix: customDefs is a docOf-covered document field like every
      // other document write, so it must join undo history the SAME way —
      // recorded BEFORE the mutation, not after. The old code called a bare
      // set() here and relied on switchPreset()'s own record("preset")
      // below to cover it — but by the time that ran, the edit was already
      // baked into the "before" snapshot it captured, making a re-save of
      // the ACTIVE shader permanently un-undoable (no depth of Ctrl+Z could
      // reach the old WGSL — see mergeEmbeddedDefs' `fromHistory` for the
      // other half of why). asOneGesture both records the correct pre-edit
      // snapshot AND suppresses switchPreset's own inner record() (still
      // called below — it's what actually pushes the new WGSL to the
      // renderer), so a save costs exactly one Ctrl+Z: without the
      // suppression, re-saving the ALREADY-active shader would push a
      // SECOND, redundant "preset" entry whose snapshot already contains
      // the edit (nothing changes customDefs between the two record()
      // calls), so the first Ctrl+Z would look like a silent no-op and only
      // a second one would actually restore the old WGSL.
      let persisted = false;
      ctx.asOneGesture("shader-save", () => {
        registerCustomPreset(def);
        const customDefs = [...get().customDefs.filter((d) => d.id !== def.id), def];
        set({ customDefs });
        // Quota failure must not hide behind a success toast — the shader
        // would exist this session and silently vanish on restart.
        persisted = saveCustomPresets(customDefs);
        get().switchPreset(def.id);
      });
      ctx.flashNotice(
        persisted
          ? `Custom visual "${def.name}" saved`
          : `"${def.name}" is active but too large to remember — export it as .bfshader to keep it`,
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
          `${safeName(def.name)}.bfshader`,
          serializeCustomPreset(def, APP_VERSION),
          [{ name: "Beatform shader", extensions: ["bfshader"] }],
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
