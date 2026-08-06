**What & why**

**How this was tested**

**Checklist**

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`
      all pass locally
- [ ] `(cd src-tauri && cargo test --workspace)` passes, if `src-tauri/`
      changed (always `--workspace` — bare cargo silently skips the
      lyrics-sidecar member)
- [ ] No `Math.random`, `Date.now`, `performance.now`, or other wall-clock
      value reaches a rendered pixel (the determinism law — see
      CONTRIBUTING.md)
- [ ] Live preview and offline export still produce the same frames for
      this change (the WYSIWYG law — same file)
- [ ] A new visual preset uses the shared WGSL header helpers and ships
      5-7 curated factory styles, if applicable
- [ ] README.md / docs updated if user-facing behavior changed

Note: this project stays free and open-source with GitHub as the only
distribution channel — no paid tier, cloud rendering, or telemetry.
