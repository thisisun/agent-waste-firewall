# Validation report — 2026-07-30

This report records the validated macOS integration and pinned-runtime baseline. A later same-day
hot-path follow-up is described separately below. Its short, loaded-host A/B measurements are
diagnostic relative comparisons only and do not replace the full product-path, packaging, CI, or
release-gate runs recorded for the baseline.

## Verdict

The candidate is suitable for continued review as a source-buildable research alpha.

The functional, privacy, packaging, runtime-sealing, and native lifecycle gates exercised here
passed. It is not ready to be called a downloadable public beta because:

- the recorded external-Node and pinned native product-path baselines missed the 100 ms local
  product target, and the later loaded-host diagnostic did not establish a current-head pass;
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
| `npm run check` | Pass: 67 JavaScript files and 47 JSON files |
| `npm test` | Pass: 312/312; 0 failures, skips, or cancellations |
| `npm run test:coverage` | Pass: 312/312; line 94.50%, branch 82.03%, functions 95.13% |
| Native `AWFTests` | Pass: 92/92; 0 failures, skips, or expected failures |
| `git diff --check` | Pass |
| Plist/localization lint | Pass: runtime entitlement, Info.plist, English, and Korean resources |
| `npm pack --dry-run --json` | Pass: 121 entries, including the janitor; exact native-source/runtime exclusion checks passed |

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

The app-owned dashboard also receives a private stdin lifeline. Closing the owning supervisor end
caused a ready child to observe EOF and exit before the bounded signal escalation path; a separate
regression proves that a standalone CLI dashboard survives closed stdin when the lifeline flag is
absent. Direct stop now cancels an outstanding readiness read promptly. These tests cover a
responsive dashboard child, not a true owner-`SIGKILL`/power-loss case or an unresponsive
descendant process group.

Freshly copied official Node runtimes took more than two seconds to initialize V8 on this machine.
The manager therefore uses a separate bounded 10-second install-time validation budget and
prewarms the staged runtime before activation. The steady-state helper deadline remains 2.25
seconds.

## Performance

### Hook paths

The following rows are the pre-follow-up full product-path baselines; they are not measurements of
the later hot-path follow-up.

| Path | Samples | Result | Gate |
| --- | ---: | ---: | --- |
| External Node + inner shell shim + real hook | 100 after 10 warmups | p95 129.037 ms; p99 132.445 ms | Fail: 100 ms product target |
| External Node repeat run | 100 after 10 warmups | p95 210.986 ms; p99 234.793 ms | Fail: 100 ms product target |
| Ad-hoc signed helper + cloned sealed Node + real hook | 100 after 10 warmups | p95 248.935 ms; p99 274.147 ms | Pass: 350 ms CI budget; fail: 100 ms product target |
| Pinned runtime prewarm | 1 install-time run | 2,563.514 ms | Reported separately; excluded from steady-state latency |

These baseline failures remain sufficient to block a public-beta latency claim. The short follow-up
A/B runs below excluded the shell launcher and ran under material host load, so they cannot close
the 100 ms gate. A current-head rerun must separately profile fresh-process startup, shell/helper
handoff, state maintenance, and atomic live/trace publication. The current temp-write/rename paths
do not claim fsync-backed power-loss durability.

### Loaded-host hot-path diagnostic — relative only

A later same-day diagnostic used Node.js `v22.22.3` on arm64 with 10 logical CPUs. The one-minute
host load average ranged from 6.75 to 8.02. Each entry-path sample launched a fresh Node process
directly; the provider shell, inner launcher, native helper, and pinned v24 runtime were excluded.
Sample counts were intentionally short to avoid adding load. These values are not comparable to
the full product-path rows above and do not establish a pass or failure against the 100 ms product
target.

| Comparison | Samples | Before | After | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Active trace: HEAD CLI entry vs dedicated `hook-stdio` entry | 12 after 2 warmups per arm | p50 157.056 ms; p95 200.580 ms | p50 161.618 ms; p95 197.247 ms | No measurable end-to-end improvement under this host variance |
| No active trace: HEAD CLI entry vs dedicated `hook-stdio` entry | 10 after 2 warmups per arm | p50 102.756 ms; p95 125.797 ms | p50 105.824 ms; p95 124.530 ms | No measurable end-to-end improvement under this host variance |
| 1,000 fresh session files: prior per-hook retention sweep vs scheduled maintenance not due | 24 after 3 warmups per arm | p50 16.576 ms; p95 20.280 ms | p50 1.637 ms; p95 4.329 ms | Median fell by 90.1%; paired median saving was 13.885 ms |

The dedicated hook entry adds a bounded one-megabyte input reader, lazy trace loading, and one
reused active-trace lookup, but the loaded-host A/B does not support a latency-improvement claim.

That intermediate scheduled-retention implementation was subsequently replaced. Hook mutation now
performs no retention marker read or directory scan. A dashboard-owned janitor holds one directory
cursor and visits at most 64 entries or uses a soft 8 ms work budget per tick. It writes the next
hourly marker only at EOF and abandons an incomplete cursor without a marker on close or error.

### Incremental session-retention follow-up

The local `benchmark:state-retention` fixture measured both the state mutation path and a complete
incremental cleanup. Times are loaded-host diagnostics, while the entry count is the deterministic
gate:

| Fixture | Hook mutation, 30 samples | Janitor result |
| --- | ---: | ---: |
| 1,000 expired session files | p50 0.400 ms; p95 0.628 ms; max 0.706 ms | 1,000 removed in 28 ticks over 223.550 ms; max 43 entries/tick; p95 tick 8.226 ms; max tick 8.622 ms |
| 10,000 expired session files | p50 0.433 ms; p95 0.570 ms; max 0.577 ms | 10,000 removed in 499 ticks over 4,171.917 ms; max 35 entries/tick; p95 tick 8.730 ms; max tick 21.482 ms |

Both cases stayed below the fixed 64-entry limit and reached EOF. The wall-clock tick values confirm
that 8 ms is cooperative rather than a hard deadline: an individual filesystem operation can
overrun it. The 10x larger directory did not introduce an `O(N)` scan into state mutation.

A same-host external-launcher A/B recorded p95 142.968 ms on this worktree and p95 160.126 ms on a
detached unchanged `fa2a85b` baseline immediately afterward. A later final-code diagnostic under
greater host load recorded p95 226.157 ms. All failed the 100 ms product target, so these loaded-host
measurements support neither an improvement nor a regression claim. The final-code native-helper
diagnostic recorded p95 247.886 ms and passed its separate 350 ms CI budget. The supported-Mac
product-path rerun remains open.

Security regression fixtures also verify that a symlinked `sessions` directory cannot delete an
external victim, malformed maintenance control triggers no deletion, an old but held session lock
is never reclaimed by automatic or explicit cleanup, only one janitor owns the global lock, and a
mid-sweep close writes no completion marker. Cleanup reads file metadata, not detector-state
content, and exposes no path or file name.

### Storage and dashboards

| Path | Result |
| --- | ---: |
| 4,096-event live publication | p95 4.267 ms; rotation 18.236 ms |
| Full-generation live cold audit | 446.181 ms |
| Live warm status | p95 5.003 ms |
| Concurrent live publication | p95 34.171 ms |
| Live rotation visibility | 416.034 ms; 0 dropped publications |
| 15,000-event trace dashboard | 194.900 ms startup; status p95 7.146 ms; append visibility 4.212 ms |

The configured spool, warm-status, rotation, and trace-dashboard gates passed for the recorded
baseline. They were not rerun as part of the short hot-path diagnostic. Rotation visibility
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
| Current-head full product-path latency rerun after hot-path changes | Open |
| Bounded state-retention due path at large session counts | Local logical gate passed at 1,000 and 10,000 entries; unattended OS trigger and hard lifecycle/workload caps remain open |
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

The previously pushed baseline completed all seven configured GitHub Actions jobs: Node 18/22 tests on
macOS and Linux, dashboard benchmarks on macOS and Linux, and the native macOS job. This configured
set does not replace the open release gates above, and every later head must complete its own
remote checks before being described as passing CI. Those seven jobs do not transfer their status
to the later hot-path follow-up; its current remote result is tracked on draft PR #3.
