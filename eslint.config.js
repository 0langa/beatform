import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/target/", "src-tauri/gen/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node build scripts (fetch-ffmpeg etc.) — Node globals, not browser ones
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", fetch: "readonly" } },
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
      ],
    },
  },
  prettier,
);
