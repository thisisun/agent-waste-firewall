# macOS implementation status

This document tracks what is implemented on the path from the portable AWF worker to a native
macOS application. Product behavior and trust boundaries remain authoritative in
[MACOS-ARCHITECTURE.md](MACOS-ARCHITECTURE.md); the ordered engineering plan remains in
[DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md).

## Current portable milestone

The M0 live transport and browser-side presentation consumer are implemented:

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
- The default `dashboard` command reads the always-on spool without requiring `record start`.
- A generation-aware cursor tails committed events without taking the publish lock, performs a
  complete bounded-generation audit every 30 seconds, and retains the last audited snapshot across
  writer races or corruption.
- Rotation or an invalid SSE resume ID produces one atomic reset. Known sequence gaps and persisted
  publication drops are shown as incomplete coverage instead of a misleading clear state.
- The dashboard distinguishes source, empty/active state, healthy/stale/degraded stream health, and
  complete/incomplete/unknown coverage.
- Retention-only maintenance runs once per second while the dashboard is open, physically removing
  expired events and per-generation alias keys.

Live events contain no prompt or recommendation text, command, argument, output, error text, path,
file name, source content, wall-clock timestamp, model name, or raw session/turn/tool identifier.
The local spool is operational UI transport and is not exportable.

## Separate explicit trace path

`record start` remains an explicit research action. It creates a workspace-scoped semantic trace
with a separate per-trace key and supports audit, export, and offline replay. The always-on spool
does not make recording implicit and does not change the export boundary.

`dashboard <trace-id>` explicitly selects that historical trace through its audited trace cursor.
The no-argument dashboard never makes a trace exportable and does not require one to exist.

## Completed live-consumer contract

The presentation read path does not change detection or enforcement. The cursor never exposes an
unaudited event or reads detector state directly. Loopback status and SSE responses are derived
from one atomic cursor frame, and the browser accepts only exact allowlisted status and event
shapes. An empty healthy spool is connected but visually neutral/yellow; a known dropped
best-effort publication is incomplete coverage; corruption is degraded.

## Native shell remains pending

No SwiftUI/AppKit target, `MenuBarExtra`, transparent `NSPanel`, app-owned worker supervisor,
provider integration manager, signed helper, DMG, or notarized artifact exists yet. Those tasks
are now the next M1 work on top of the stable live-consumer contract.
