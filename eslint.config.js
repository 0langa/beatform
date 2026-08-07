import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // .claude/ holds agent worktrees (full repo copies); linting the parent repo
  // must never descend into them or eslint dies on multiple tsconfig roots.
  { ignores: ["dist/", "src-tauri/target/", "src-tauri/gen/", "node_modules/", ".claude/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node build scripts (fetch-ffmpeg etc.) — Node globals, not browser ones
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
      },
    },
  },
  {
    // AudioWorklet global scope (the bundled loopback worklet, v2.44.1) —
    // its runtime globals exist neither in browser nor Node environments.
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
        currentFrame: "readonly",
        currentTime: "readonly",
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The Tauri dialog plugin patches these onto plugin:dialog commands the
      // capability file deliberately does not grant (only `ask` is allowed) —
      // raw window.confirm threw "not allowed by ACL" in installed builds.
      // Use askConfirm() from state/platform (its browser fallback is the one
      // sanctioned window.confirm call site).
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "confirm",
          message:
            "Use askConfirm() from state/platform — raw confirm hits the dialog-plugin ACL in installed builds.",
        },
        {
          object: "window",
          property: "alert",
          message:
            "Use flashNotice/store error state — raw alert hits the dialog-plugin ACL in installed builds.",
        },
        {
          object: "window",
          property: "prompt",
          message:
            "Build a proper input UI — raw prompt hits the dialog-plugin ACL in installed builds.",
        },
        {
          object: "globalThis",
          property: "confirm",
          message:
            "Use askConfirm() from state/platform — raw confirm hits the dialog-plugin ACL in installed builds.",
        },
        {
          object: "globalThis",
          property: "alert",
          message:
            "Use flashNotice/store error state — raw alert hits the dialog-plugin ACL in installed builds.",
        },
        {
          object: "globalThis",
          property: "prompt",
          message:
            "Build a proper input UI — raw prompt hits the dialog-plugin ACL in installed builds.",
        },
      ],
      // Same ban, second spelling. A BARE `confirm("…")` (no `window.`
      // prefix — the more common way to write it) resolves to the identical
      // ACL-blocked plugin command but sailed straight past the property
      // rule above; that hole shipped the v2.64.0 "not allowed by ACL"
      // failure class. The sanctioned browser fallback in state/platform is
      // spelled `window.confirm`, so it needs no exception here.
      "no-restricted-globals": [
        "error",
        {
          name: "confirm",
          message:
            "Use askConfirm() from state/platform — raw confirm hits the dialog-plugin ACL in installed builds.",
        },
        {
          name: "alert",
          message:
            "Use flashNotice/store error state — raw alert hits the dialog-plugin ACL in installed builds.",
        },
        {
          name: "prompt",
          message:
            "Build a proper input UI — raw prompt hits the dialog-plugin ACL in installed builds.",
        },
      ],
      // Allocating zustand selectors — a CRASH class, not a slow-render one.
      // zustand v5 hands the selector straight to useSyncExternalStore with
      // no equality function, so a selector that builds a fresh object or
      // array returns a new reference on every store notification: React
      // re-reads, sees a change, re-renders, re-reads... "Maximum update
      // depth exceeded" ON MOUNT — a white screen. The `.filter()` shape is
      // the worst of them: it emits no React warning at all before dying.
      // Select one store-owned reference (or primitive) per hook and combine
      // with useMemo; the shared derivations live in state/selectors.ts.
      // An eslint-disable on any of these requires a written justification in
      // the same comment.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'CallExpression[callee.name="useVizStore"] ArrowFunctionExpression ObjectExpression',
          message:
            "zustand v5 selectors must not allocate: an object-returning selector is 'Maximum update depth exceeded' on mount, not a slow render. Select one field per hook and combine with useMemo.",
        },
        {
          selector:
            'CallExpression[callee.name="useVizStore"] ArrowFunctionExpression ArrayExpression',
          message:
            "zustand v5 selectors must not allocate (array literal). Select the array field itself and derive with useMemo.",
        },
        {
          selector:
            'CallExpression[callee.name="useVizStore"] ArrowFunctionExpression SpreadElement',
          message: "zustand v5 selectors must not allocate (spread).",
        },
        {
          selector:
            'CallExpression[callee.name="useVizStore"] ArrowFunctionExpression CallExpression[callee.property.name=/^(filter|map|flatMap|slice|concat|sort|reverse|toSorted|toReversed|split)$/]',
          message:
            "zustand v5 selectors must not allocate: this returns a fresh array on every store notification and breaks getSnapshot caching. Use two selectors + useMemo (see ParamsPanel's looksForMode).",
        },
      ],
    },
  },
  prettier,
);
