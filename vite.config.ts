import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // E3f: default to IPv4 loopback, never `false`. `host: false` makes Vite
    // bind whatever Node resolves "localhost" to — `[::1]` on modern Windows —
    // while tauri probes its devUrl as 127.0.0.1 and waits forever, blaming
    // the server that is actually READY. 127.0.0.1 keeps the server off the
    // LAN; WebView2 consumers loading http://localhost:1420 reach it through
    // address fallback (::1 refuses fast, 127.0.0.1 answers — proven by the
    // built-app loopback and Shadertoy smokes against this exact default).
    // TAURI_DEV_HOST still overrides for LAN/device work.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    rollupOptions: {
      output: {
        // Without this the whole app — React, zustand, the WebGPU renderer,
        // every preset, and the mediabunny codec stack used by
        // export and video backgrounds — lands in one >1 MB entry chunk
        // (past Vite's 500 kB warning). None of that is lazy: the app is a
        // single-page desktop shell, so splitting here is about caching and
        // parse cost, not reducing what has to load.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // React + its scheduler change far less often than the app itself
          // does (this repo ships multiple releases a day) — their own
          // chunk means the webview cache doesn't have to re-fetch and
          // re-parse them on every update.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          // mediabunny is the heavy codec/mux dependency behind export,
          // video backgrounds and decode — the biggest single contributor
          // to the oversized chunk.
          if (/[\\/]node_modules[\\/]mediabunny[\\/]/.test(id)) {
            return "vendor-codec";
          }
          return undefined;
        },
      },
    },
  },
}));
