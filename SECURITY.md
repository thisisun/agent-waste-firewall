# Security policy

## Data handling

AWF (Agent Waste Firewall) is local-first. The current release has no network client and no telemetry
exporter. It stores pseudonymous detector state under `~/.agent-waste-firewall/` by default.
Raw session IDs, provider tool names, workspace basenames, file names, and absolute or relative
paths are not persisted. Prompt, call, result, file-content, file-identity, and workspace
identifiers use session-scoped keyed aliases. These aliases are pseudonyms rather than encryption.
Detector state keeps rule IDs and typed evidence rather than detector prose or recommendations.
State older than 30 days is removed during hook activity by default, and users can run
`agent-waste-firewall purge --all` at any time. An unsupported detector-state schema is replaced
when that session next produces a hook event.

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
