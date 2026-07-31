# Security policy

## Data handling

AWF (Agent Waste Firewall) is local-first. The installed runtime makes no outbound requests and has
no telemetry exporter. Release preparation is separate from the product runtime:
`prepare:macos-runtime` reads an explicit local archive by default and downloads an official Node
archive only when a release engineer passes `--download`. AWF stores pseudonymous detector state
under `~/.agent-waste-firewall/` by default.
Raw session IDs, provider tool names, workspace basenames, file names, and absolute or relative
paths are not persisted. Prompt, call, result, file-content, file-identity, and workspace
identifiers use session-scoped keyed aliases. These aliases are pseudonyms rather than encryption.
Detector state keeps rule IDs and typed evidence rather than detector prose or recommendations.
Hook state mutation performs no retention directory scan. While the dashboard or macOS monitor is
open, a metadata-only janitor removes state older than 30 days in batches of at most 64 entries
under a soft 8 ms tick budget. It validates user-private root/session identities, never follows a
`sessions` symlink, acquires each session lock non-blockingly, and returns only closed status values
and numeric counters. A completion marker is written only at directory EOF. Without an open
monitor, automatic cleanup is delayed until the next monitor run; users can run
`agent-waste-firewall purge` or `purge --all` for an immediate full scan.

The janitor and explicit purge conservatively treat every existing session lock as active,
regardless of its timestamp. Age alone cannot prove that a paused writer has exited, so these
cleanup paths do not reclaim locks or delete their state. Unlocked orphan atomic-write files may be
removed. An unsupported detector-state schema is replaced when that session next produces a hook
event. Public beta still requires an OS-supervised cleanup trigger, proven orphan-lock recovery,
and hard lifecycle and workload caps.

Every supported hook also attempts to publish one event to the bounded, always-on `LiveEventV1`
spool. This path constructs a new object from a closed allowlist; it does not persist the provider
payload and redact it later. Live events contain only enums, bounded numeric counts and durations,
rule/issue IDs, and a `session_<HMAC>` alias. They cannot contain free text, paths, file names,
wall-clock timestamps, raw session/tool/model identifiers, prompts, commands, output, or source
content.

The spool uses mode `0700` directories and `0600` keys, control files, temporary files, and event
files where supported. Concurrent hook processes publish private temporary event files and rename
them atomically under a short global lock. A fresh random 256-bit HMAC key is created for each
generation. The 4,096-event and 8 MiB limits are hard ceilings. The 24-hour age trigger runs on the
next publish, read, or `doctor` access; without a background daemon, an idle machine cannot delete
files exactly at the deadline. All three values may only be configured downward. Rotation removes
the previous events and key, so a new generation cannot correlate its session alias with an
earlier generation.
Partial temporary files and an interrupted pending publication are recovered without exposing
unaudited bytes. Expensive reconstruction of a damaged control file is reserved for a reader or
`doctor`, not the hook hot path. If publication is busy or unavailable, the event is dropped and
the already-computed guard decision remains in force; a rate-limited local diagnostic reports
degraded presentation.

The always-on spool is short-lived local presentation transport and is not an export format.
`agent-waste-firewall purge --all` removes it. The browser dashboard consumes the spool by default;
an explicitly supplied trace ID selects the separate historical trace view.

Explicit live recordings use a stricter boundary than detector state:

- raw hook JSON is never written;
- an allowlist serializer emits only enums, numbers, booleans, elapsed time, and per-trace HMAC
  aliases;
- a random 256-bit key is created for each trace, never exported, and removed when recording stops;
- exported traces contain no local label, wall-clock time, path, file name, prompt, command, output,
  detector message, source content, URL, model name, or raw platform identifier;
- schema and secret-pattern audit runs before export and against the exact temporary export bytes;
- export refuses unknown fields and refuses to overwrite an existing file.

Trace aliases preserve equality inside one recording and are therefore pseudonymous, not fully
anonymous. A distinctive sequence of semantic actions can still identify a workflow. Review the
exported corpus as potentially sensitive project metadata.

The live dashboard binds only to a loopback address, rejects non-loopback `Host` and cross-origin
requests, requires a random token in its local URL, uses a restrictive Content Security Policy,
loads no third-party assets, and makes no outbound requests. Do not expose or proxy its port to
another host.

Do not include raw prompts, source code, secrets, or private transcripts in bug reports. Use the
fixture schema and replace project paths and error messages with synthetic values.

## Reporting a vulnerability

Do not open a public issue containing an exploit or sensitive data. Use the repository's
[private vulnerability reporting](https://github.com/thisisun/agent-waste-firewall/security/advisories/new)
form. If that form is unavailable, disclose only that the private channel is unavailable in a
public issue; do not include exploit details, credentials, prompts, transcripts, source code, or
other sensitive data.

## Boundary

Lifecycle hooks are a guardrail, not a complete security boundary. Some hosted or specialized tool
paths may not emit hook events. Do not rely on this project as the only control for destructive
commands, credentials, or production access. The dashboard observes model-visible tool behavior,
not private chain-of-thought. Exact token counts are also outside the current hook event schema.
