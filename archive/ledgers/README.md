# archive/ledgers — frozen project history

Terminal ledgers, preserved verbatim for context. **Nothing in here is open
work.** The live ledger is [/BACKLOG.md](../../BACKLOG.md).

| File                            | What it is                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BACKLOG-through-v2.104.2.md`   | The full work ledger from the 2026-08 quality program's start through v2.104.2 (2026-08-19) — every DONE record, evidence trail, review finding, dismissal-with-reason, and owner verdict. ~5k lines.        |
| `PROPOSALS-2026-08-audit.md`    | The opinionated half of the 2026-08-06 full-product audit: P-1…P-21 with original briefs, owner verdicts, and the execution table (all terminal: complete/rejected).                                         |
| `BACKLOG-through-v2.108.0.md`   | The live ledger as it stood after audit round 2 (2026-08-21) shipped as v2.105.0 → v2.108.0: the R2-01…R2-37 findings with fix evidence, dismissals, and the execution record. Archived at the v3.0.0 reset. |
| `TESTING-through-2026-08-04.md` | Every manual/agent test run from v2.44.1 (2026-07-23) to VERIFY-003 (2026-08-04), including the frozen 2026-07-27 v2.51.0/v2.52.0 acceptance batch and its sign-off. Archived at the v3.0.0 reset.           |

Rules for agents:

1. **Read-only.** These files are history. Update the live ledger, never these.
2. A row here marked GATED/KNOWN LIMITATION/SOMEDAY was migrated to the live
   ledger's trigger table on 2026-08-20 — the live ledger's version is the
   authoritative one.
3. If an archived record contradicts current code or the live ledger, current
   code and the live ledger win (the archive reflects what was true when
   written).
4. When the live BACKLOG.md grows unwieldy again, repeat this pattern: archive
   the whole file here with a dated name + the ARCHIVED banner, reset the live
   one to open rows only.
