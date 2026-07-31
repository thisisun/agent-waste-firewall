# Validation report — 2026-08-01

This report records privacy-safe, user-owned Codex hook-delivery and loopback-dashboard acceptance
on the validation Mac. It is a narrow follow-up to the
[2026-07-30 validation report](VALIDATION-REPORT-2026-07-30.md), not a replacement for the
remaining release, native UI, or cross-provider gates.

## Verdict

Codex user-owned trust, live prompt delivery, and fresh loopback-dashboard activity are closed for
this installed version on this Mac. Claude Code user-owned trust and live delivery remain open.

| Gate | Result |
| --- | --- |
| Canonical Codex plugin | Pass: `agent-waste-firewall@agent-waste-firewall` installed and enabled |
| Model-free Codex preflight | Pass: `ready`; exact 4/4 hooks ready, with 0 unexpected hooks, 0 errors, and 0 warnings |
| Fresh provider delivery | Pass: `integration verify codex` observed one qualifying post-baseline prompt event |
| Closed event projection | Pass: `event=prompt`, `family=prompt`, `operation=prompt`, `outcome=allowed` |
| Local raw-text canary audit | Pass: 0 matches in the AWF data root; no explicit trace exists |
| Dashboard fresh activity | Pass: Codex `active` / `observed`, version `0.146.0` |
| Dashboard Claude state | `not_detected` / `not_observed` |
| Claude Code user-owned acceptance | Open |

The two Codex acceptance requests incurred the following provider-reported usage:

| Acceptance request | Codex-reported tokens |
| --- | ---: |
| Delivery watcher probe | 4,010 |
| Dashboard live-activity probe | 6,757 |
| **Total acceptance cost** | **10,767** |

These values disclose the validation cost. They are not measurements of AWF overhead or tokens
saved.

## Native helper/worker compatibility follow-up

The same candidate adds a fixed, raw-free native helper/worker compatibility contract. The helper
validates the checked-in canonical marker before handing provider stdin to the worker. Portable
and native launchers both pass exact protocol arguments; zero, unknown, stale, or incompatible
arguments fail open with a fixed provider-visible warning before stdin is read, and no live event
is published. The native path still starts the Node worker only once per event.

The current candidate passed `npm run check`, all 347 JavaScript tests, and all 94 native unit
tests. A real Debug helper plus an explicit Node.js `v24.18.0` runtime then processed all 55
expected semantic events in each 5-warmup/50-sample run:

| Native path | p50 | p95 | p99 | Result |
| --- | ---: | ---: | ---: | --- |
| Always-on live spool, no explicit trace | 59.167 ms | 61.335 ms | 66.371 ms | Pass: p95 < 100 ms |
| Always-on live spool with explicit trace | 59.901 ms | 62.053 ms | 86.130 ms | Pass: p95 < 100 ms |

The measurements include the inner shell shim, native helper, one real worker process, detector,
and live-spool publication. They exclude provider dispatch and the provider-created outer shell;
the separately reported runtime prewarm is excluded from steady-state latency.

The portable external-Node launcher also published all 55 expected events and remained below the
same local target: p95 50.252 ms without an explicit trace and 55.100 ms with one.

The post-change isolated package gates also passed: Codex completed package staging, model-free
hook discovery, direct launcher execution, semantic event production, privacy audit, and cleanup
in 485 ms; Claude completed its explicitly non-provider-delivery install/direct-launcher gate in
2,649 ms. Neither gate made a model request.

## Acceptance sequence

The user installed and enabled the canonical plugin and completed Codex's user-controlled review
for the current four-hook set. The model-free preflight then returned `ready` for exactly 4/4
expected hooks. It reported no unexpected hook, error, or warning and did not start a model turn.

After the delivery watcher established its baseline and emitted readiness, a separate fresh Codex
session received one ephemeral, read-only, bounded harmless request. The watcher accepted only the
new post-baseline prompt event and returned `observed`. Codex reported 4,010 tokens for that
acceptance turn.

For the dashboard acceptance, a live loopback dashboard started on an ephemeral port and an SSE
consumer connected before a second ephemeral, read-only, bounded harmless Codex request. The
dashboard integration endpoint then reported Codex as `active` with `observed` activity and version
`0.146.0`; Claude remained `not_detected` and `not_observed`. Codex reported 6,757 tokens for this
second acceptance turn. No local dashboard URL or access token is recorded here.

A standalone `integration status` invocation can still report Codex as `installed_unverified`.
That is intentional: the standalone status path does not treat retained or pre-start events as
fresh activity. Only the running dashboard that had an SSE consumer connected before the new event
could establish the `active` result in this acceptance. This prevents historical evidence from
impersonating current monitoring.

The witnesses retained only closed semantic allowlist values. AWF did not persist raw request text
from either probe, any model output, tool input, tool output, transcript text, source content,
commands, paths, hook JSON, or provider RPC. This report intentionally does not reproduce either
request text. A direct fixed-string audit for both request-text canaries found zero matches beneath
the AWF data root, and `trace list` returned no explicit trace.

## Scope and limitations

- `ready` is provider-reported discovery evidence for the exact enabled and trusted hook metadata
  at that moment. It does not independently attest the Codex binary or installed file contents.
- `observed` closes fresh prompt delivery for this user-owned Codex installation on this Mac. It is
  local semantic evidence, not cryptographic provider identity.
- The dashboard result covers its loopback SSE activity projection and integration endpoint. It
  does not close native UI automation.
- The run did not verify Claude Code delivery, clean-machine setup, upgrade or rollback, release
  signing, notarization, or broader supported-Mac behavior.

The operator procedure and safety boundary are documented in
[First live pilot](FIRST-PILOT.md#confirm-fresh-hook-delivery). The closed preflight and delivery
contracts, provider trust boundaries, and remaining integration work are documented in
[Development guide](DEVELOPMENT-GUIDE.md#m3--integration-manager). The raw-free event boundary is
defined in [Architecture](ARCHITECTURE.md).
