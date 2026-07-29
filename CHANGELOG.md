# Changelog

## 0.1.0

- Adopt the public name AWF — Agent Waste Firewall and the `agent-waste-firewall` technical slug.
- Replace persisted workspace, tool, and file labels with session-scoped aliases and closed
  semantic categories.
- Add deterministic prompt preflight checks in Korean and English.
- Add progress-aware repeat, failure, polling, and edit/revert detectors.
- Add separate Codex and Claude Code hook registrations.
- Route macOS/POSIX provider hooks through a fail-open launcher that never searches inherited
  `PATH` after the inner launcher starts, strips Node and dynamic-loader injection variables,
  rejects symlink or group/world-writable worker/runtime files on macOS, and uses a bounded
  external Node allowlist for the alpha. Claude uses exec-form arguments for the inner
  `/bin/sh -p`; Codex first invokes the command through inherited `$SHELL -lc`, which remains a
  trusted user/provider startup boundary. The launcher emits one fixed, raw-free stderr warning
  for every event it cannot check; this pre-runtime warning is not rate-limited. Windows
  provider-hook execution remains unsupported.
- Add best-effort `LiveEventV1` publication for every supported hook, independent of explicit
  recording.
- Add a private, concurrent-writer-safe live spool with hard 4,096-event/8 MiB ceilings and a
  24-hour age trigger on next access, with atomic publication and interrupted-write recovery.
- Scope live session aliases to a fresh per-generation HMAC key and restrict persisted events to a
  closed enum, bounded-number, rule/issue-ID, and alias allowlist.
- Add local redacted state, 30-day retention, reporting, purging, and JSONL replay.
- Add observe, warn, and high-confidence block modes.
- Add workspace-scoped live recording with a per-trace HMAC key and strict semantic JSONL schema.
- Add privacy audit, safe export, and repository-free semantic replay across all three modes.
- Add a token-protected, loopback-only English-default live dashboard with Korean localization
  and a prompt-contract coach.
- Add a closed, raw-free `ProviderIntegrationStatusV1` reality gate and
  `integration status [--json]` CLI. `doctor` now separates `engineReady`, `providerInstalled`,
  and `monitoringActive`, and the dashboard shows provider installation/activity cards without
  treating an empty healthy spool as active monitoring.
- Add the closed, raw-free `ProviderDeliveryVerificationV1` contract and bounded
  `integration verify <codex|claude> --timeout 60 [--json]` watcher. It accepts only a fresh
  post-baseline audited prompt event, never changes provider configuration, and is explicitly a
  delivery witness rather than cryptographic provider attestation.
- Keep JSON stdout to one final verification record and emit a fixed, raw-free `AWF_READY` line on
  stderr only after the audited baseline is established.
- Detect provider state without modifying global configuration. Installation, enablement, hook
  review, and trust remain user-controlled. Current activity requires a new audited event after
  dashboard startup and expires after five minutes; retained spool and trace events do not count.
- Add an isolated `npm run acceptance:codex` gate for temporary marketplace add, plugin
  install/list, installed-launcher prompt/pre-tool/post-tool/Stop execution, closed-event production,
  prefix/suffix raw-canary scanning, and cleanup. This direct-launcher check deliberately does not
  claim provider-driven registration, user-owned `/hooks` trust, or live provider delivery.
- Add an isolated `npm run acceptance:claude` gate for local marketplace add/install,
  list/details, installed-launcher execution across prompt/pre-tool/post-tool/failure/Stop,
  closed-event and raw-canary auditing, and owned-root cleanup. Its closed report fixes provider
  delivery to `not_tested` and never bypasses trust or managed hook policy.
- Add a repository-root Claude Code marketplace entry and source provenance for the plugin
  manifest. Document Claude's source-trust/load boundary, read-only `/hooks` view,
  `/reload-plugins`, and session-only `--plugin-dir` behavior separately from Codex hook-hash
  trust.
- Restrict provider probe environments to a closed configuration-discovery allowlist and make the
  acceptance runner delete only a fresh child it owns beneath the validated system temp tree.
- Run the shipped CLI and dashboard provider probes concurrently, give each provider one shared
  three-second version/list budget, hard-kill timed-out default subprocesses, thread only the
  caller's allowlisted discovery environment, and keep timeout or probe errors inside closed
  `unknown` states. Dashboard shutdown cancels and kills in-flight default probes.
- Load and cache allowlisted dashboard images asynchronously on first request, return a bounded
  raw-free `503` when storage cannot materialize one, and keep status/SSE responsive.
- Package the repository-local `.agents` marketplace descriptor so a published npm artifact can
  expose the Codex plugin without an external path.
- Add a compact magnifying-glass sentinel with allowlisted green, yellow, red, and critical-red
  visual states mirrored in the browser title and favicon.
- Add high-cost release verification classification and earlier repeat warnings.
- Add a Korean README and end-to-end live-recording tests.
- Support concurrent pseudonymous sessions in one explicitly scoped workspace trace.
- Add an incrementally audited dashboard cursor, session-aware warning projection, and a checked-in
  long-trace benchmark.
- Add a lock-free, generation-aware live-spool cursor and make the bounded `LiveEventV1` stream the
  default dashboard source without requiring `record start`.
- Preserve explicit `dashboard <trace-id>` access for historical audited traces while projecting
  live and trace inputs through one closed, pure dashboard model.
- Add atomic generation snapshot resets, composite SSE resume IDs, incomplete-coverage signaling
  for sequence gaps and known publication drops, stale/degraded health states, and retention-only
  dashboard maintenance.
- Add a reproducible saturated-spool benchmark covering cold audit, warm status, concurrent hook
  publication, rotation, and SSE visibility.
- Add reproducible hook and dashboard latency gates for macOS and Linux CI.
- Reject non-loopback `Host` and cross-origin dashboard requests and compare access tokens with a
  fixed-length constant-time operation.
- Handle malformed local request targets without crashing, close active SSE connections on
  shutdown, recover streams after trace rotation, and display audited-trace failures as a red
  degraded state.
- Publish closed `DashboardReadyV1` and `DashboardStatusV1` contracts with JSON Schemas, synthetic
  conformance fixtures, dependency-free Node validators, and strict Swift decoders.
- Add an unsigned macOS 13+ developer-preview Xcode project with SwiftUI/AppKit menu-bar lifecycle,
  a non-persistent restricted `WKWebView`, app-owned loopback dashboard supervision, English/Korean
  localization, and a transparent floating `NSPanel` sentinel.
- Bundle the reviewed `assets`, `bin`, and `src` trees into the developer-preview app while retaining
  an explicit installed-Node.js requirement; no signed or notarized distribution artifact is
  claimed.
- Add native unit and UI test targets and an unsigned macOS pull-request build/unit job. UI
  automation, Developer ID signing, notarization, and clean-machine acceptance remain release
  gates.
- Add the transparent green guardian mark as the native app icon, remove a `MenuBarExtra`
  write-back loop that caused runaway CPU/memory, and launch the worker with a closed environment
  allowlist. The native worker can discover the Codex executable bundled with the ChatGPT app
  without widening its environment. Node discovery validates major version 18+ with a bounded
  direct probe. The minimized native sentinel decodes the closed provider contract and requires
  recent observed provider activity before it turns green.
- Remove inherited `PATH` lookup from the native Node locator. Prefer an explicit override, then
  Volta, a strict 64-entry NVM scan, and fixed standard paths, while retaining the bounded Node 18+
  version probe. The local native unit/integration target passes 39/39 tests with no skips.
