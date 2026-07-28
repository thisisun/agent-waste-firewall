# Changelog

## 0.1.0

- Adopt the public name AWF — Agent Waste Firewall and the `agent-waste-firewall` technical slug.
- Replace persisted workspace, tool, and file labels with session-scoped aliases and closed
  semantic categories.
- Add deterministic prompt preflight checks in Korean and English.
- Add progress-aware repeat, failure, polling, and edit/revert detectors.
- Add separate Codex and Claude Code hook registrations.
- Add local redacted state, 30-day retention, reporting, purging, and JSONL replay.
- Add observe, warn, and high-confidence block modes.
- Add workspace-scoped live recording with a per-trace HMAC key and strict semantic JSONL schema.
- Add privacy audit, safe export, and repository-free semantic replay across all three modes.
- Add a token-protected, loopback-only English-default live dashboard with Korean localization
  and a prompt-contract coach.
- Add a compact magnifying-glass sentinel with allowlisted green, yellow, red, and critical-red
  visual states mirrored in the browser title and favicon.
- Add high-cost release verification classification and earlier repeat warnings.
- Add a Korean README and end-to-end live-recording tests.
- Support concurrent pseudonymous sessions in one explicitly scoped workspace trace.
- Add an incrementally audited dashboard cursor, session-aware warning projection, and a checked-in
  long-trace benchmark.
- Add reproducible hook and dashboard latency gates for macOS and Linux CI.
- Reject non-loopback `Host` and cross-origin dashboard requests and compare access tokens with a
  fixed-length constant-time operation.
- Handle malformed local request targets without crashing, close active SSE connections on
  shutdown, recover streams after trace rotation, and display audited-trace failures as a red
  degraded state.
