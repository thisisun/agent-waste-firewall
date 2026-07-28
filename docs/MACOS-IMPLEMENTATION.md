# macOS implementation status

This document tracks what is implemented on the path from the portable AWF worker to a native
macOS application. Product behavior and trust boundaries remain authoritative in
[MACOS-ARCHITECTURE.md](MACOS-ARCHITECTURE.md); the ordered engineering plan remains in
[DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md).

## Current milestone

The portable M0 live transport is implemented:

- `LiveEventV1` is an exact, dependency-free schema made only of closed enums, bounded numbers,
  rule/issue IDs, and one validated session alias.
- A checked-in JSON Schema, protocol version registry, and valid/invalid conformance fixtures give
  the later Swift decoder the same contract as the Node runtime validator.
- The projector constructs an event in memory from the detector result. It never records the raw
  hook object and redacts it later.
- Every supported Codex or Claude Code hook makes a best-effort publication, whether or not the user
  started a research trace.
- `LiveEventStore` serializes concurrent publishers under a short lock, validates before and after
  persistence, publishes private temporary files by atomic rename, and recovers interrupted
  publications.
- A generation has hard ceilings of 4,096 events and 8 MiB plus a 24-hour age trigger enforced on
  next access; configuration may shorten but not extend those limits.
- Each generation owns a fresh random 256-bit HMAC key. Rotation removes the previous events and
  key, so session aliases cannot be correlated across generations.
- Busy or unavailable presentation storage drops the live event without changing the detector's
  allow, warn, or deny decision.

Live events contain no prompt or recommendation text, command, argument, output, error text, path,
file name, source content, wall-clock timestamp, model name, or raw session/turn/tool identifier.
The local spool is operational UI transport and is not exportable.

## Separate explicit trace path

`record start` remains an explicit research action. It creates a workspace-scoped semantic trace
with a separate per-trace key and supports audit, export, and offline replay. The always-on spool
does not make recording implicit and does not change the export boundary.

The current browser dashboard still reads this explicit trace through its audited trace cursor.
It does not yet consume `LiveEventV1`. Therefore, users still need `record start` to populate the
current dashboard even though the worker is already maintaining the bounded live spool.

## Next implementation PR

The next PR should add the presentation read path without changing detection or enforcement:

1. implement a generation-aware, closed-schema live-spool cursor;
2. distinguish rotation/gaps, degraded input, and an empty-but-connected spool;
3. project `LiveEventV1` into the existing dashboard status and timeline model;
4. switch the loopback SSE/status endpoints to that projection without requiring an explicit
   recording;
5. retain explicit trace controls only for audit/export/replay;
6. add concurrent publication/tailing, rotation, duplicate-delivery, corruption, and reconnect
   regressions.

The cursor must never expose an unaudited event or read detector state directly. A dropped
best-effort publication must be represented as degraded/incomplete observation rather than a
misleading clear state.

## Native shell remains pending

No SwiftUI/AppKit target, `MenuBarExtra`, transparent `NSPanel`, app-owned worker supervisor,
provider integration manager, signed helper, DMG, or notarized artifact exists yet. Those tasks
remain M1 and later work after the live consumer contract is stable.
