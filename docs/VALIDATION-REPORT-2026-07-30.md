# Validation report — 2026-07-30

This report records the local validation of the AWF macOS integration lifecycle and pinned-runtime
release pipeline. It supersedes the 2026-07-29 milestone for current implementation status without
rewriting that historical snapshot.

## Verdict

The candidate is suitable for continued review as a source-buildable research alpha.

The functional, privacy, packaging, runtime-sealing, and native lifecycle gates exercised here
passed. It is not ready to be called a downloadable public beta because:

- the external-Node and pinned native hook paths both missed the 100 ms local product target;
- the assembled app was ad-hoc signed, not Developer ID signed or notarized;
- Intel, minimum-supported-macOS, Gatekeeper, and clean-machine provider delivery were not tested;
- interactive English/Korean, light/dark UI automation did not complete; and
- the helper/worker protocol handshake and true process-kill crash harness remain future work.

## Candidate scope

This validation covers:

- the dependency-free Node detector, hook launcher, live spool, dashboard, and semantic trace path;
- the macOS 13.5+ SwiftUI/AppKit source application and native helper;
- English-default and Korean-localized native integration presentation;
- transactional install, upgrade, repair, rollback, reconciliation, and conservative uninstall;
- pinned Node.js `v24.18.0` arm64 release preparation;
- exact `allow-jit=true` entitlement validation, V8/JIT readiness, and runtime prewarming; and
- npm packaging boundaries that exclude native source and generated runtime payloads.

All hook and lifecycle tests used synthetic allowlisted events. No raw prompt, command, tool input,
tool output, transcript, source-file content, or provider hook JSON was persisted.

## Functional gates

| Gate | Result |
| --- | --- |
| `npm run check` | Pass: 63 JavaScript files and 47 JSON files |
| `npm test` | Pass: 292/292; 0 failures, skips, or cancellations |
| `npm run test:coverage` | Pass: 292/292; line 94.54%, branch 82.16%, functions 95.13% |
| Native `AWFTests` | Pass: 90/90; 0 failures, skips, or expected failures |
| `git diff --check` | Pass |
| Plist/localization lint | Pass: runtime entitlement, Info.plist, English, and Korean resources |
| `npm pack --dry-run --json` | Pass: 118 entries; 2,852,415-byte package; 3,581,492 bytes unpacked |

The npm package contains only the runtime manifest and entitlement from `runtime/`. It does not
contain `macos/`, `awf-node`, a prepared payload, or generated app artifacts.

The serial native run used a fresh derived-data directory on arm64 macOS 26.5.2. Xcode selected the
arm64 destination and emitted five SDK-link warnings because its XCTest support libraries are built
for macOS 14 while the AWF targets retain a macOS 13.5 deployment target. There were no build
errors or analyzer warnings. A real macOS 13.5 runtime test remains required.

## Pinned-runtime release evidence

The release preparation and finalization path was exercised with the official thin arm64
Node.js `v24.18.0` archive:

1. The preparer verified the pinned archive, executable, complete license, and canonical payload.
2. The copied Node executable was re-signed with hardened runtime and exactly
   `com.apple.security.cs.allow-jit = true`.
3. The finalizer verified the architecture, exact Node version, nested signature, hardened-runtime
   flag, exact entitlement allowlist, and a fixed WebAssembly/V8 readiness probe.
4. It wrote the complete 157,606-byte license and 65-byte newline-terminated runtime digest file.
5. The helper, Node executable, and outer app passed strict on-disk code-signature verification.

The sealed arm64 runtime SHA-256 was:

```text
8dda8cd7a7c7ecf1b1e3d840e1044d2834b3fbee6f6ab0685d4c9b2236b34d2a
```

The signatures in this exercise were ad-hoc. This proves structural sealing and runtime viability,
not Developer ID identity, notarization, stapling, or Gatekeeper acceptance.

Negative evidence matters here: `node --version` succeeds without `allow-jit`, but V8 execution
fails. The finalizer therefore performs an actual fixed V8/JIT probe and has regression tests for
missing or excessive entitlements, missing hardened runtime, and version-only runtimes.

## Native lifecycle evidence

The current manager source was compiled into an isolated lifecycle harness and exercised against
the sealed helper/runtime payload without touching real user installation paths. Three consecutive
fresh cycles passed:

```text
install → helper drift → repair → rollback → uninstall → not installed
```

The suite also covers:

- complete payload validation before destination mutation;
- same-volume staging and atomic publication;
- process and cross-process mutation locks;
- helper/runtime digest ownership;
- side-by-side release retention and rollback;
- interrupted-publication reconciliation;
- unknown or changed residue preservation;
- version-only runtime rejection; and
- a cold runtime that legitimately exceeds the dashboard helper's 2.25-second budget.

Freshly copied official Node runtimes took more than two seconds to initialize V8 on this machine.
The manager therefore uses a separate bounded 10-second install-time validation budget and
prewarms the staged runtime before activation. The steady-state helper deadline remains 2.25
seconds.

## Performance

### Hook paths

| Path | Samples | Result | Gate |
| --- | ---: | ---: | --- |
| External Node + inner shell shim + real hook | 100 after 10 warmups | p95 129.037 ms; p99 132.445 ms | Fail: 100 ms product target |
| External Node repeat run | 100 after 10 warmups | p95 210.986 ms; p99 234.793 ms | Fail: 100 ms product target |
| Ad-hoc signed helper + cloned sealed Node + real hook | 100 after 10 warmups | p95 248.935 ms; p99 274.147 ms | Pass: 350 ms CI budget; fail: 100 ms product target |
| Pinned runtime prewarm | 1 install-time run | 2,563.514 ms | Reported separately; excluded from steady-state latency |

The 100 ms target failure is reproducible enough to block a public-beta claim. The two external
Node runs also show substantial host variance, so a future optimization pass must profile process
startup, shell/helper handoff, and durable event publication separately instead of relaxing the
product target from one measurement.

### Storage and dashboards

| Path | Result |
| --- | ---: |
| 4,096-event live publication | p95 4.267 ms; rotation 18.236 ms |
| Full-generation live cold audit | 446.181 ms |
| Live warm status | p95 5.003 ms |
| Concurrent live publication | p95 34.171 ms |
| Live rotation visibility | 416.034 ms; 0 dropped publications |
| 15,000-event trace dashboard | 194.900 ms startup; status p95 7.146 ms; append visibility 4.212 ms |

The configured spool, warm-status, rotation, and trace-dashboard gates passed. Rotation visibility
includes the bounded polling interval and is not hook decision latency.

## UI inspection

An isolated local app launch displayed the English/light one-screen dashboard, connected to the
loopback worker, and exposed the native integration control with a closed “not installed” state.
No unintended Korean product copy appeared in the English dashboard; the visible Korean language
toggle is intentional.

The UI automation transport disconnected while opening the native integration detail sheet.
Because the remaining English/Korean and light/dark combinations were not captured, this report
does not count the inspection as a complete UI pass. The native presentation and localization unit
tests passed, but interactive UI automation remains a separate release gate.

## Release gates still open

| Gate | Status |
| --- | --- |
| Hook latency below 100 ms p95 on supported Macs | Open |
| Developer ID identity and inside-out signing | Open |
| Notarization, stapling, and Gatekeeper | Open |
| Intel/x64 execution | Open |
| macOS 13.5 runtime acceptance | Open |
| Clean-machine install, upgrade, repair, rollback, and uninstall | Open |
| User-owned Codex and Claude Code trust and live delivery | Open |
| Complete English/Korean and light/dark UI automation | Open |
| Fixed raw-free helper/worker protocol handshake | Open |
| True `SIGKILL`/power-loss crash harness | Open |
| Start at login, updater, and distribution container | Open |

GitHub Actions must be evaluated again on the pushed candidate. Local results must not be described
as passing CI before the corresponding commit completes its remote checks.
