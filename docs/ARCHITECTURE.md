# Architecture

## Design constraints

AWF (Agent Waste Firewall) is designed around seven constraints:

1. A detector must not require another model call on the hot path.
2. The same detector core must accept additive Codex and Claude Code schema changes.
3. Warnings must cite observable evidence and separate attribution from blame.
4. Blocking must happen before the tool call and only at high confidence.
5. The guard must fail open and must not create a Stop-continuation loop.
6. Raw hook payloads must be transformed in memory and must never be written as a recording.
7. The human-facing monitor must consume the same strict semantic stream that can be safely
   exported and replayed.

## Live sidecar flow

```text
Codex / Claude hook payload (raw in memory only)
            │
            ├──► normalizer ─► detector state ─► allow / warn / deny
            │
            └──► strict allowlist serializer
                         │
                         ├──► trace-scoped semantic JSONL
                         └──► loopback SSE ─► local dashboard + prompt coach

semantic JSONL ─► schema/privacy audit ─► export ─► repository-free replay
```

The dashboard never receives the hook payload, detector prose, command, output, path, or source
content. The HTTP server binds only to loopback and requires a random token in the local URL.
Browser assets have no external dependencies or outbound requests.

## Portable decision model

The portable core intentionally emits only:

- allow;
- add concise context;
- deny a pre-tool call;
- block a severely underspecified prompt when explicitly configured.

Claude-only `ask`, `defer`, post-tool output replacement, and Codex-unsupported fields are excluded
from the shared path. `Stop` is observation-only in the MVP.

## Progress model

Every session has a monotonic `progressVersion`. The version increments after:

- a supported write produces a new file-content hash that is not an immediate revert;
- the same observation returns a different result fingerprint;
- a test/build returns a new successful result; or
- a user interruption changes control flow.

Repeat detectors compare events only inside the current progress version. This prevents a normal
edit-test-edit loop from being treated like a stuck retry loop.

Identical passing test output does not repeatedly advance the version. Consecutive failures are
considered the same failure only when their normalized result fingerprints match. Future progress
markers may include:

- a requested artifact appearing;
- an approved plan step completing;
- peer/subagent work being incorporated.

## State model

Session state is projected through the closed `DetectorStateV4` schema and stored as atomic JSON
files under the local data directory. Workspace and file identity use session-scoped aliases;
raw provider tool names, workspace labels, file names, paths, detector prose, and unknown fields
are dropped before every write. A per-session lock directory prevents concurrent hook processes
from overwriting each other. State is bounded:

- recent tool events are capped;
- failure fingerprints are capped;
- incidents are capped;
- each file keeps only recent content hashes.

The transcript format is not a dependency because coding-agent transcript files are not stable
public interfaces.

## Semantic trace model

Recording is explicit and scoped to one workspace. A recording may contain multiple concurrent
Codex or Claude sessions observed inside that workspace; each session receives a trace-local HMAC
alias. The active marker stores only a workspace HMAC alias. On every hook, candidate ancestor paths
are HMACed in memory until the matching workspace is found, so subdirectories work without
persisting the root path.

Each recording creates a random 256-bit key. Domain-separated HMAC aliases cover prompts, sessions,
turns, calls, normalized signatures, results, paths, and observed file content. The key is never
part of an event or export and is deleted at `record stop`. No reverse alias table exists.

Trace v1 has four event types:

- `prompt`: locale, contract score, issue IDs, and prompt alias;
- `tool_pre`: tool family, semantic operation, risk class, target aliases, and progress version;
- `tool_post`: the pre-tool fields plus outcome, failure class, result alias, and progress signal;
- `stop`: the final progress version only.

All event objects use a closed schema. Unknown keys and free text are rejected. Audit additionally
checks serialized bytes for path, URL, email, private-key, JWT, common API-key, and secret-assignment
patterns. Export writes a private temporary file, audits its actual bytes again, and atomically
renames it without overwriting an existing destination.

The trace is intentionally pseudonymous rather than perfectly anonymous. It preserves equality
inside one recording because replay must know that two actions, sessions, or file states are the
same. A multi-session trace therefore reveals that several distinct pseudonymous sessions were
observed in the same explicitly recorded workspace window. Keys are different across traces, so
aliases are not linkable between recordings.

## Attribution

The initial taxonomy is:

- `user_instruction`: prompt contract evidence;
- `agent`: repeated actions or oscillation;
- `environment`: repeated failures with environment evidence such as missing commands, permissions,
  network errors, or exhausted disk space;
- `harness`: repeated coordination or status polling behavior.

Attribution follows the evidence available in the hook event and remains a diagnostic label, not a
claim of blame.

## Platform adapters

Codex loads its default `hooks/hooks.json`. Claude Code uses the explicit
`hooks/claude-hooks.json` path in `.claude-plugin/plugin.json`, adding `PostToolUseFailure` because
Codex reports non-zero shell results through `PostToolUse` and does not expose Claude's
failure-specific event. Both adapters feed the same normalizer and detector core.

## Measurement boundary

Hook decisions must complete in milliseconds and therefore use local state only. Token counts and
cost estimates will arrive through asynchronous usage adapters. Until then the dashboard reports
observable event counts, avoidable-call candidates, and detection time. A measurement adapter may
annotate incidents after the fact, but it must never be required for a pre-tool decision.

Semantic replay performs no file reads and runs no commands. It simulates how the already-detected
incident stream would be handled in `observe`, `warn`, or `block` mode and reports decision drift.
Detector-regex changes still require synthetic raw prompt fixtures because exported traces contain
features and issue IDs, not prompt text.
