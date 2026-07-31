# Validation report — 2026-08-01

This report records privacy-safe, user-owned Codex and Claude Code hook-delivery and
loopback-dashboard acceptance on the validation Mac. It is a narrow follow-up to the
[2026-07-30 validation report](VALIDATION-REPORT-2026-07-30.md), not a replacement for the
remaining release, native UI, or cross-machine gates.

## Verdict

Codex user-owned trust, live prompt delivery, and fresh loopback-dashboard activity are closed for
this installed version on this Mac. Claude Code canonical-plugin load, live prompt delivery, and
fresh dashboard activity are also closed. The later Claude model API request did not complete
because of external account authentication; that is recorded separately from the earlier hook
dispatch and reported zero automated usage.

| Gate | Result |
| --- | --- |
| Canonical Codex plugin | Pass: `agent-waste-firewall@agent-waste-firewall` installed and enabled |
| Model-free Codex preflight | Pass: `ready`; exact 4/4 hooks ready, with 0 unexpected hooks, 0 errors, and 0 warnings |
| Fresh Codex delivery | Pass: `integration verify codex` observed one qualifying post-baseline prompt event |
| Canonical Claude plugin | Pass: `agent-waste-firewall@agent-waste-firewall` installed and enabled in user scope |
| Fresh Claude delivery | Pass: `integration verify claude` returned `observed` / `fresh_prompt_event` |
| Closed event projection | Pass for both: `kind=prompt`, `family=prompt`, `operation=prompt`, `outcome=allowed` |
| Local raw-text canary audit | Pass: 0 matches in the AWF data root; no explicit trace exists |
| Dashboard Codex activity | Pass: `active` / `observed`, version `0.146.0` |
| Dashboard Claude activity | Pass: `active` / `observed`, final version `2.1.220` |
| Claude model completion | Not claimed: external account authentication stopped the request after hook dispatch |

The two Codex acceptance requests incurred the following provider-reported usage:

| Acceptance request | Codex-reported tokens |
| --- | ---: |
| Delivery watcher probe | 4,010 |
| Dashboard live-activity probe | 6,757 |
| **Total acceptance cost** | **10,767** |

These values disclose the validation cost. They are not measurements of AWF overhead or tokens
saved.

Two bounded noninteractive Claude model attempts each reported 0 input tokens, 0 output tokens,
and USD 0 before completion. A final interactive attempt confirmed the same authentication stop
without a model response. These attempts were not needed to establish hook delivery: Claude Code
had already dispatched the qualifying `UserPromptSubmit` event to the installed AWF plugin. No
additional model retry was made.

## Native helper/worker compatibility follow-up

The same candidate adds a fixed, raw-free native helper/worker compatibility contract. The helper
validates the checked-in canonical marker before handing provider stdin to the worker. Portable
and native launchers both pass exact protocol arguments; zero, unknown, stale, or incompatible
arguments fail open with a fixed provider-visible warning before stdin is read, and no live event
is published. The native path still starts the Node worker only once per event.

The current candidate passed `npm run check`, all 357 JavaScript tests, and all 94 native unit
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

Before the user-owned Claude run, a provider-boundary review found and closed three false-positive
or raw-data risks. The shell shim now requires its explicit provider and matching provider-root
variable before native or portable dispatch. The worker rejects unattributed invocation before
reading stdin, and the public direct entry is `hook <codex|claude>`. Debug fail-open diagnostics
use a fixed string instead of exception text. Current Claude top-level plugin arrays count as an
installed collection only when the entry carries the exact canonical marketplace ID; name-only,
conflicting-ID, look-alike-marketplace, unrelated-plugin, and ambiguous Codex-array cases are
covered by productive counterexamples.

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
`0.146.0`; at that earlier Codex-only stage, Claude remained `not_detected` and `not_observed`.
Codex reported 6,757 tokens for this second acceptance turn. No local dashboard URL or access token
is recorded here.

For Claude Code, the canonical local marketplace checkout was validated, installed in user scope,
and hash-compared against the current hook boundary before the run. A new loopback dashboard and
delivery watcher established their baselines first. A separate user-owned Claude Code process
then dispatched a prompt hook. The watcher returned `observed` with reason `fresh_prompt_event`
and the closed allowed prompt projection. The dashboard moved from `installed_unverified` /
`not_observed` to `active` / `observed`. Claude Code updated from `2.1.207` to `2.1.220` during the
acceptance; a fresh bounded probe reconfirmed canonical installation after the update.

The later model API authentication error occurred after `UserPromptSubmit` dispatch and therefore
does not reverse the delivery witness. It does mean this report does not claim a successful Claude
model response or validate the external account session.

A standalone `integration status` invocation can still report either provider as
`installed_unverified`. That is intentional: the standalone status path does not treat retained
or pre-start events as fresh activity. Only the running dashboard that had an SSE consumer
connected before the new event
could establish the `active` result in this acceptance. This prevents historical evidence from
impersonating current monitoring.

The witnesses retained only closed semantic allowlist values. AWF did not persist raw request text
from any probe, any model output, tool input, tool output, transcript text, source content,
commands, paths, hook JSON, or provider RPC. This report intentionally does not reproduce any
request text. A direct fixed-string audit for all request-text canaries found zero matches beneath
the AWF data root, and `trace list` returned no explicit trace.

## Scope and limitations

- `ready` is provider-reported discovery evidence for the exact enabled and trusted hook metadata
  at that moment. It does not independently attest the Codex binary or installed file contents.
- `observed` closes fresh prompt delivery for both user-owned provider installations on this Mac.
  It is local semantic evidence, not cryptographic provider identity or a model-completion claim.
- The dashboard result covers its loopback SSE activity projection and integration endpoint. It
  does not close native UI automation.
- The run did not verify Claude model completion, clean-machine setup, upgrade or rollback,
  release signing, notarization, or broader supported-Mac behavior.

The operator procedure and safety boundary are documented in
[First live pilot](FIRST-PILOT.md#confirm-fresh-hook-delivery). The closed preflight and delivery
contracts, provider trust boundaries, and remaining integration work are documented in
[Development guide](DEVELOPMENT-GUIDE.md#m3--integration-manager). The raw-free event boundary is
defined in [Architecture](ARCHITECTURE.md).
