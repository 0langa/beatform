# BACKLOG — the live work ledger

This is the canonical ledger (per CLAUDE.md): read it before feature work,
update it when finishing. It was reset on **2026-08-20** after the
quality-consolidation program completed (2.99.0 → 2.104.2 shipped the last of
it). The full 5k-line history — every DONE record, evidence trail, dismissed
finding and design decision through v2.104.2 — is preserved verbatim at
**[archive/ledgers/](archive/ledgers/)**. Consult it for context; never reopen
rows from it. User-facing history lives in CHANGELOG.md; process memory in the
agents' memory stores.

Rules unchanged: never rename a persisted ID without a migration; new modes
follow the registry + grid + matrix re-bless discipline; GATES.md is canonical
for what "done" means; quality over speed.

## Owner-pending (only the owner can close these)

- [ ] **FEAT-004 word-timing verdict** — the cold-boot retest's subjective
      half: watch Lyric Stage's karaoke fill on a known song, say whether the
      timing feels right. (Instrumented half PASSED 2026-08-19: cold
      generation 2:45, honest ETAs, RTF learning persists — archive has the
      full record.) Guide: `AI text stuff\beatform-owner-board-2026-08-20.md`.
- [ ] **FEAT-009 eyes-only legs** — subjective sharpness/smoothness on the
      real second display, ~5 min stability impression, and the HDMI hotplug
      yank/replug. (All programmatic legs PASSED 2026-08-19 on real mixed-DPI
      hardware.)
- [ ] **Launch kit** — README hero pick, [SLOT] fills, [VERIFY] flag checks,
      the 3 screen-recording animateds, and posting (exclusively the owner's
      action). Kit: `OneDrive\Documents\doc\beatform-launch-kit\`.
- [ ] **Fresh-session unbiased audit** — after the play session: a
      clean-context agent audits the whole product against source, device and
      releases (the 2026-08-06 273-item audit is the rigor precedent). Its
      findings land HERE.

## Next hardening pass (agent-ready, not scheduled — small, non-blocking)

- [ ] Unit test for the fps-cap + paused interaction (the `advance-only`
      branch under `capSkipped` is device-proven but has no vitest pin —
      2.104.2 review noted it; both consumers read one shared boolean, so
      risk is low).
- [ ] Live-capture async-setup window test (`startLiveInput`: `playing` reads
      false during the worklet-load await — correct behavior, untested).
- [ ] Overgrowth mist seam sub-LSB inset (F4 nit, 2.103.0 review): fixed-UV
      inset under-insets below ~119 px canvas height; deterministic,
      below one 8-bit LSB, frozen into the blessed baseline — cosmetic only.
- [ ] Overgrowth present-only virgin-branch comment (F5 nit): one-line
      comment explaining why the un-dt-gated visTex-alpha write is harmless.
- [ ] Perform drawer: dedicated fullscreen MIDI-learn overlay (P-4's one
      not-built possible follow-up; the drawer shows mappings live instead).

## Trigger-gated (activate on the named trigger, not before)

| Row                                                                                                            | Trigger                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Spout output (share live visuals to Resolume/OBS on-machine)                                                   | A real user with a real rig asks            |
| NDI output (live visuals over LAN)                                                                             | Same                                        |
| macOS / Linux ports (Tauri supports them; WASAPI loopback, registry heal, job objects are Windows-bound today) | Genuine demand — issues/users               |
| Lyrics streaming rework (whole-decode memory ceiling → 90-min limit stands)                                    | A user actually hits the limit meaningfully |
| DSP-001 — DC-offset waveform/trigger behavior                                                                  | A reproducible report                       |
| DSP-002 — Short analyzer history after seek                                                                    | A reproducible report                       |

## Known limitations (by-design verdicts — do not "fix" without an owner decision)

- **VIS-001** — Aurora's mirrored hue spread is folded into the mode's
  identity (owner verdict 2026-08-16; Ember Veil is the registry's showcase
  of it).
- **DSP-001 / DSP-002** — see trigger table; recorded behavior, not defects,
  until a report proves user harm.
- **Feedback modes after a live seek** — the preview keeps pre-seek history
  (finite for Spectro Falls, indefinite for Overgrowth); exports always
  replay from clip start. Documented in docs/PREVIEW-EXPORT-CONTRACT.md.
- **Batch renders carry no lyrics** — Lyric Stage degrades to its rehearsal
  in batch output (recorded 2.101.0).

## Cleared-work pointer

Everything shipped through **v2.104.2** (2026-08-19) — including the entire
2026-08 quality-consolidation program, the P-19 five-mode roster, FEAT-004/005/009,
P-1…P-21, Tracks A–F, and the hardening waves — is recorded with evidence in
[archive/ledgers/BACKLOG-through-v2.104.2.md](archive/ledgers/BACKLOG-through-v2.104.2.md)
and [archive/ledgers/PROPOSALS-2026-08-audit.md](archive/ledgers/PROPOSALS-2026-08-audit.md).
