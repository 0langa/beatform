import { BuilderParseError, parseBuilderStack, serializeBuilderStack } from "../../render/builder2";
import { APP_VERSION } from "../../version";
import { saveTextFile } from "../platform";
import type { VizState } from "../store";
import type { GetFn, SetFn, SliceCtx } from "./ctx";

export function builderActions(set: SetFn, get: GetFn, ctx: SliceCtx) {
  return {
    async exportBuilderStack() {
      try {
        const path = await saveTextFile(
          "stack.avbuilder",
          serializeBuilderStack(get().builderStack, APP_VERSION),
          [{ name: "Beatform builder stack", extensions: ["avbuilder"] }],
        );
        if (path) ctx.flashNotice("Builder stack saved — share the file anywhere");
      } catch (e) {
        set({ error: `Could not save builder stack: ${(e as Error).message}` });
      }
    },

    importBuilderStackText(text) {
      try {
        const parsed = parseBuilderStack(text);
        get().setBuilderStack(parsed);
        ctx.flashNotice("Builder stack imported");
      } catch (e) {
        set({
          error:
            e instanceof BuilderParseError
              ? `Could not import builder stack: ${e.message}`
              : `Could not import builder stack: ${(e as Error).message}`,
        });
      }
    },
  } satisfies Partial<VizState>;
}
