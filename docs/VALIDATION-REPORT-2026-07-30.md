# Validation report — 2026-07-30

This report records the validated macOS integration and pinned-runtime baseline, the later
loaded-host hot-path diagnostic, and a controlled current-head latency rerun. The loaded-host A/B
measurements remain historical relative comparisons. The controlled rerun establishes a narrower
current-head result for local inner product paths on the inspected Apple-silicon Mac; it does not
replace packaging, broader supported-Mac, clean-machine, or provider-dispatch release evidence.

## Verdict

The candidate is suitable for continued review as a source-buildable research alpha.

The functional, privacy, packaging, runtime-sealing, and native lifecycle gates exercised here
passed. It is not ready to be called a downloadable public beta because:

- controlled current-head inner paths passed the 100 ms p95 target on the inspected Apple-silicon
  Mac, and the new exact-manifest shell benchmark passed its separate 150 ms budget. That
  benchmark still excludes provider process creation and dispatch; broader supported Macs and a
  clean machine have not established the product target;
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
| `npm run check` | Pass: 72 JavaScript files and 55 JSON files |
| `npm test` | Pass: 340/340; 0 failures, skips, or cancellations |
| `npm run test:coverage` | Pass: 340/340; line 94.52%, branch 81.75%, functions 95.26% |
| `npm run acceptance:providers` | Pass: Codex isolated install, installed-root-bound model-free discovery, direct launchers, events, privacy, and cleanup in 457 ms; Claude isolated direct-launcher path in 2,474 ms with provider delivery explicitly not tested |
| `claude plugin validate --strict .` | Pass |
| Native `AWFTests` | Pass: 92/92; 0 failures, skips, or expected failures |
| `git diff --check` | Pass |
| Plist/localization lint | Pass: runtime entitlement, Info.plist, English, and Korean resources |
| `npm pack --dry-run --json` | Pass: 132 entries and 3,723,582 unpacked bytes, including the Codex preflight contract and bounded probe; exact native-source/runtime exclusion checks passed |

The npm package contains only the runtime manifest and entitlement from `runtime/`. It does not
contain `macos/`, `awf-node`, a prepared payload, or generated app artifacts.

## Provider compatibility and shell-boundary evidence

Current Codex exports `PLUGIN_ROOT` and the compatibility alias `CLAUDE_PLUGIN_ROOT` with the same
plugin root. The prior shim treated that real environment as ambiguous, skipped the fixed native
helper, and fell back to the external runtime. The manifests now pass `codex` or `claude`
explicitly. The shim accepts that value only when the corresponding provider-root variable
matches the same plugin root, clears an unvalidated platform override, and otherwise preserves
the portable fail-open path. A positive regression reproduces Codex's dual-root environment; a
productive counterexample proves a provider/root mismatch cannot select the native helper.

The separate provider-shell benchmark validates the exact checked-in manifest before every run.
It uses a private temporary home, data root, and a workspace containing spaces and Korean
characters. Codex runs through `/bin/zsh -lc` plus the inner shim; Claude uses its exact exec-form
`/bin/sh` arguments. Neither form launches a provider process or includes provider dispatch.

| Shell boundary | Trace | p50 | p95 | p99 | max | Budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Codex manifest via isolated `/bin/zsh -lc` | off | 57.396 ms | 140.005 ms | 221.148 ms | 241.849 ms | 150 ms |
| Codex manifest via isolated `/bin/zsh -lc` | on | 58.196 ms | 73.329 ms | 113.620 ms | 134.850 ms | 150 ms |
| Claude exact exec form | off | 53.023 ms | 69.601 ms | 113.374 ms | 119.865 ms | 150 ms |
| Claude exact exec form | on | 52.336 ms | 92.130 ms | 108.173 ms | 126.944 ms | 150 ms |

Each row used 10 warmups and 100 measured calls, produced all 110 expected closed semantic events,
and produced no incident. The Codex rows reproduced its equal `PLUGIN_ROOT` and
`CLAUDE_PLUGIN_ROOT` compatibility environment. These values are reproducible shell-path
measurements, not provider-delivery measurements.

One real Codex CLI probe was attempted with an ephemeral temporary project and a second
`UserPromptSubmit` blocker intended to stop processing before any model request. The temporary
project hook layer was not discovered because project trust had not been established. Neither the
blocker marker nor an AWF semantic event appeared, and Codex proceeded to a model turn that
reported 14,397 tokens. This is a failed delivery probe and negative safety evidence, not a pass.
No further automated provider launch is permitted until a discovery-only `hooks/list` preflight
proves the exact hook set is loaded, enabled, and trusted before `turn/start`. The temporary probe
tree was removed. Claude Code is installed on this Mac but is not authenticated, so no real
Claude provider turn was attempted.

That model-free gate is now implemented as
`integration preflight codex --workspace <path> [--json]`. It sends only app-server
`initialize`, `initialized`, and `hooks/list`, bounds stdout and runtime, discards stderr, and
reduces provider metadata to `CodexHookPreflightV1`. Paths, commands, hook hashes, plugin IDs,
warning/error text, and raw RPC never enter the result. A real check against this workspace
completed in 178 ms with `provider_plugin_not_found`, `0/4` hooks ready, and no model turn. This is
the correct fail-closed result because AWF is not installed in the current user Codex
configuration; it is not a delivery pass. No automated provider turn was retried.

The preflight matcher recognizes only the exact provider-reported plugin ID
`agent-waste-firewall@agent-waste-firewall`. A different custom-marketplace ID intentionally
collapses to `provider_plugin_not_found`, even if other metadata resembles AWF. A `ready` result
would establish only that Codex reported the expected manifest-shaped metadata, enablement, and
trust state at discovery time. It would not attest the installed plugin files, the Codex binary,
or subsequent hook delivery.

The isolated Codex acceptance now also invokes the same model-free app-server discovery after
local marketplace installation. It binds every discovered source path to the validated installed
cache root before redaction. A separate closed-result capture completed discovery in 66 ms with
`untrusted_hooks`: all four exact events were discovered as `untrusted`, with zero unexpected
hooks, errors, or warnings. The acceptance then directly exercised those launchers, produced
closed events, ran boundary-and-interior privacy canaries, and cleaned up. That gate intentionally
accepts exact metadata in either trusted or untrusted state, and its public report records only the
closed `providerHooksDiscovered` check. It is therefore real provider-registration evidence, but
not a user-owned `ready` or live-delivery pass.

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

These historical baseline failures are retained rather than averaged together with the controlled
current-head rerun below. They show that startup tail latency can vary materially with host state
and runtime construction. The current temp-write/rename paths do not claim fsync-backed power-loss
durability.

### Controlled current-head inner-path rerun

The current head was measured in three independent generations per condition, each with 50 samples
after five warmups. Every generation used a fresh private benchmark root and synthetic allowlisted
events. The always-on live spool remained enabled in both conditions; `--no-trace` disabled only
the optional active semantic trace.

| Path | No active trace, p95 by generation | Active trace, p95 by generation | Local 100 ms target |
| --- | ---: | ---: | --- |
| External launcher + real worker + live spool | 64.670 / 49.438 / 48.692 ms | 50.294 / 57.978 / 50.585 ms | Pass on inspected Mac |
| Native inner full path + live spool | 60.054 / 60.040 / 60.271 ms | 66.668 / 60.684 / 60.999 ms | Pass on inspected Mac |

The external launcher row includes its inner shell and a fresh real worker process. The native row
starts at the inner shell and includes the unsigned Debug helper, a temporary clone of the current
Node executable, the real worker, and live-spool publication. Provider dispatch and the
provider-created outer shell are excluded. Runtime prewarming is also excluded rather than being
hidden inside steady-state latency. Consequently, these results establish the current-head inner
path target only on the inspected Apple-silicon Mac; broader supported Macs, a clean machine, and
provider-created dispatch/outer-shell timing remain open.

A controlled fresh-process stage breakdown isolated where the inner-path time was spent:

| Stage | p95 |
| --- | ---: |
| Node no-op startup | 24.260 ms |
| Hook-module import | 31.061 ms |
| Direct worker, no active trace | 41.833 ms |
| Direct worker, active trace | 40.643 ms |
| External shell path, active trace | 52.386 ms |
| Cloned native runtime, direct | 43.078 ms |
| Cloned runtime through unsigned Debug helper | 53.775 ms |
| Full native inner shell path | 61.725 ms |

The stage values are diagnostics, not additive components. Each row is an independently timed
fresh-process boundary, so summing them would double-count startup.

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
diagnostic recorded p95 247.886 ms and passed its separate 350 ms CI budget. These remain historical
loaded-host observations; the controlled current-head section above records the later local inner
path pass. Broader supported-Mac, clean-machine, and provider-created outer-shell/dispatch timing
remain open.

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
| Local inner hook latency below 100 ms p95 on the inspected Apple-silicon Mac | Passed in three 50-sample generations for external/native and active/no-trace paths |
| Broader supported-Mac and clean-machine hook latency | Open |
| Provider-created outer shell and provider-dispatch latency | Open |
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
