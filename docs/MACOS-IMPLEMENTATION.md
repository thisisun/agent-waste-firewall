# macOS implementation status

This document tracks what is implemented on the path from the portable AWF worker to a native
macOS application. Product behavior and trust boundaries remain authoritative in
[MACOS-ARCHITECTURE.md](MACOS-ARCHITECTURE.md); the ordered engineering plan remains in
[DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md).

## Current portable milestone

The M0 live transport and browser-side presentation consumer are implemented:

- `LiveEventV1` is an exact, dependency-free schema made only of closed enums, bounded numbers,
  rule/issue IDs, and one validated session alias.
- Checked-in JSON Schemas, a protocol version registry, and valid/invalid conformance fixtures give
  the Swift decoder the same readiness/status contracts as the Node runtime validators.
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

## Native developer preview

An unsigned, source-buildable macOS 13+ shell now exists under `macos/`:

- `AWF.xcodeproj` contains the `AWF`, `AWFTests`, and `AWFUITests` targets and one shared `AWF`
  scheme. It uses SwiftUI, AppKit, WebKit, Foundation, and XCTest without external packages.
- The SwiftUI lifecycle owns a normal dashboard window and a `MenuBarExtra`; closing the main
  window does not opt the app out of menu-bar operation.
- A borderless, non-activating, transparent `NSPanel` stays independent of the main window. It
  projects clear, review, danger, critical, degraded, and offline states. Only critical state adds
  the translucent red panel background. It decodes the closed provider integration response and
  requires fresh `observed` activity before showing green; retained or expired activity stays
  yellow unless a real warning takes precedence.
- The app supervisor locates an installed Node.js 18+ executable with a bounded direct
  `--version` probe, launches the bundled `bin/agent-waste-firewall.mjs dashboard --port 0 --json`,
  accepts one bounded readiness line, and terminates only its presentation subprocess when the app
  exits.
- The app bundle copies the reviewed `assets/`, `bin/`, and `src/` directories as folder
  resources. This packages the AWF JavaScript source but not a Node runtime.
- The main window embeds the existing loopback dashboard in a non-persistent `WKWebView`.
  Navigation is restricted to the exact tokenized `127.0.0.1` origin.
- English and Korean `Localizable.strings` cover native status, action, rule, and failure labels.
  The sentinel includes VoiceOver labels and respects Reduce Motion, Reduce Transparency, and
  Differentiate Without Color.

The source build has no Developer ID signature, notarization ticket, DMG, installer, update
mechanism, or bundled/pinned Node runtime. It is a developer preview, not a downloadable beta.
Provider install/repair/uninstall, start at login, signed helper lifecycle, and release packaging
remain pending.

## Native privacy boundary

The native app does not receive a provider hook envelope, detector state, prompt, command, tool
input/output, transcript, source file, or raw identifier. Its native protocol surface is limited to:

- one exact `DashboardReadyV1` object capped at 1,024 bytes;
- exact `DashboardStatusV1` and `ProviderIntegrationStatusV1` objects capped at 16 KiB each; and
- the already-audited loopback document and SSE consumed inside the restricted `WKWebView`.

All public contracts have checked-in JSON Schemas, dependency-free Node validators, Swift closed
decoders, and synthetic conformance fixtures. Redirects, oversized responses, unknown keys,
non-loopback hosts, changed ports/tokens, and status regressions within one stream are rejected.
WebKit uses `WKWebsiteDataStore.nonPersistent()`.

The developer preview intentionally has App Sandbox disabled because it launches an externally
installed Node executable and reads the non-container AWF data directory through that worker.
Release hardening must therefore be evaluated again after a pinned runtime is bundled. No signing
or sandbox claim should be inferred from an unsigned Debug build.

## Source build and verification status

The current portable rerun passed `npm run check` across 53 JavaScript and 32 JSON files and
`npm test` with 203/203 tests. The same-machine performance rerun measured:

| Path | Result |
| --- | ---: |
| Real hook subprocess | p95 94.641 ms; p99 103.181 ms |
| Live dashboard full-generation cold audit | 233.230 ms |
| Live dashboard warm status | p95 2.204 ms |
| Concurrent live publication | p95 18.927 ms |
| Full-generation rotation | 15.779 ms |
| SSE reset visibility | 451.285 ms; 0 drops |
| 15,000-event trace cursor | 107.937 ms cold startup; 2.368 ms status p95; 1.639 ms append visibility |

SSE visibility includes the bounded polling interval and is not hook decision latency.

The source compiles as an unsigned Debug application on the inspected Apple-silicon environment
with Xcode 26.6 and Swift 6.3.3:

```bash
AWF_DERIVED_DATA="${TMPDIR%/}/awf-derived-data"
xcodebuild \
  -project macos/AWF.xcodeproj \
  -scheme AWF \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath "$AWF_DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM= \
  build
```

This command verifies source compilation, the guardian-mark app icon, Info.plist processing,
localization, and folder-resource assembly. It does not create a signed release. The local
`AWFTests` target passed 36/36 tests with no skips, including Node 18+ probe boundaries, a real
bundled-worker launch, closed status/provider fetches, child cancellation and forced reap, exact
protocol decoding, navigation rejection, and the fresh-provider sentinel state table. A direct
temporary-data launch
remained idle at a 0.0% app CPU snapshot after ten seconds (about 96 MB app RSS and 55 MB Node RSS)
and removed its Node child on normal quit.

The GitHub unsigned build/unit job passed on the prior PR head and is rechecked after current
changes are pushed. The UI target compiles, but the local Xcode 26.6 UI runner did not materialize
its worker or launch the target app during a 74-second attempt, so that run was interrupted and is
not counted as a UI pass or product failure. No signed clean-machine launch matrix has run.
