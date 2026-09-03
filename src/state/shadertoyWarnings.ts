/**
 * Pre-translate warnings for a pasted Shadertoy shader (HD-12).
 *
 * The transpiler (src-tauri/src/shadertoy.rs) accepts `iChannel1..3` and
 * `iMouse` because they are valid GLSL — the macros bind an empty texture and
 * a zero vector. So a shader that leans on them translates cleanly and then
 * renders black (or its mouse-idle state) with no diagnostic anywhere. This
 * pure scan tells the user BEFORE they translate, in the dialog, for the
 * exact text they pasted. It is advice, not a gate: nothing here blocks the
 * import, because a shader may sample iChannel1 as an optional extra and
 * still look right.
 *
 * Text heuristics on purpose: Shadertoy binds Buffer passes to channels in
 * the web UI, not in code, so `texture(iChannel1, …)` is indistinguishable
 * from a static texture there — the warning names both possibilities.
 */
export function shadertoyWarnings(glsl: string): string[] {
  if (!glsl.trim()) return [];
  const code = stripComments(glsl);
  const out: string[] = [];

  const channels = new Set<string>();
  for (const m of code.matchAll(/\biChannel([123])\b/g)) channels.add(m[1]);
  if (channels.size > 0) {
    const list = [...channels]
      .sort()
      .map((n) => `iChannel${n}`)
      .join(", ");
    out.push(
      `${list} ${channels.size > 1 ? "are" : "is"} sampled — Beatform binds an empty texture there, so whatever Shadertoy fed it (a Buffer pass, a texture, video or keyboard) renders black. Only iChannel0 carries data (the audio texture).`,
    );
  }

  if (/\biMouse\b/.test(code)) {
    out.push(
      "iMouse is always zero — Beatform has no pointer input, so mouse-driven parts stay at their (0,0) state in preview and export alike.",
    );
  }

  // Comments count here: multi-pass shaders usually carry "// Buffer A holds
  // the velocity field" style notes, and that is the only trace the Image
  // tab keeps of its other tabs.
  if (/\bBuffer\s*[A-D]\b|\bCommon\b/.test(glsl)) {
    out.push(
      "The source mentions Buffer A–D or Common — a multi-pass shader needs those tabs, which cannot be translated. Only the Image tab runs; passes it reads through channels come back black.",
    );
  }

  return out;
}

/** Drop line and block comments so a commented-out iChannel1 does not warn. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
