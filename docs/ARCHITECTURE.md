# Architecture

## Design constraints

AWF (Agent Waste Firewall) is designed around seven constraints:

1. A detector must not require another model call on the hot path.
2. The same detector core must accept additive Codex and Claude Code schema changes.
3. Warnings must cite observable evidence and separate attribution from blame.
4. Blocking must happen before the tool call and only at high confidence.
5. The guard must fail open and must not create a Stop-continuation loop.
6. Raw hook payloads must be transformed in memory and must never be written as a recording.
7. The human-facing monitor and opt-in research trace must consume separate, closed semantic
   schemas; neither boundary may receive a provider payload.

## Live sidecar flow

```text
Codex / Claude hook payload (raw in memory only)
            │
            ├──► normalizer ─► detector state ─► allow / warn / deny
            │
            ├──► LiveEventV1 allowlist ─► bounded always-on private spool
            │                                      │
            │                                      └──► current loopback live dashboard
            └──► explicit recording? ─► trace-scoped semantic JSONL
                                              │
                                              └──► historical dashboard / audit / export / replay

semantic JSONL ─► schema/privacy audit ─► export ─► repository-free replay
```

Both serializers construct new objects from closed allowlists; neither saves raw JSON for later
redaction. The dashboard consumes the always-on spool by default; passing an explicit trace ID
selects the historical trace cursor instead. Both inputs are projected through the same closed
dashboard model. The dashboard never receives the hook payload, detector prose, command, output,
path, or source content. The HTTP server binds only to loopback and requires a random token in the
local URL. Browser assets have no external dependencies or outbound requests.

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

## Always-on live event model

Every supported hook makes a best-effort `LiveEventV1` publication after the detector decision,
without requiring `record start`. Projection happens in memory from the normalized detector result.
The schema has one exact shape and allows only:

- closed event, platform, mode, tool-family, operation, outcome, rule, severity, attribution, and
  issue-ID vocabularies;
- bounded numeric sequence, relative elapsed time, occurrence, progress, incident/avoidable-call
  deltas, and decision-latency fields;
- one validated `session_<HMAC>` alias.

It rejects unknown keys and cannot represent prose, a wall-clock timestamp, a path or file name,
a command, output, source content, or a raw provider/model/session/tool identifier.

`LiveEventStore` publishes one private JSON event file by atomic rename under a short global lock.
The spool uses private directories and files, recovers interrupted pending writes, and revalidates
every event on read. One generation has hard ceilings of 4,096 events and 8 MiB. A 24-hour age
trigger is enforced on the next publish, read, or maintenance access; the open dashboard runs
retention-only maintenance once per second. Configuration may lower but not raise any limit.
Triggering rotation atomically switches control to a new generation and retires old events and
their alias key outside the publish lock. Each generation has its own random 256-bit HMAC key, so
session aliases are comparable only inside that bounded window. Busy or unavailable publication
fails open: presentation may miss an event, but the hook decision is unchanged.

The live dashboard cursor does not take the publisher lock. It reads control, generation
metadata, committed event files, and control again, then accepts the window only when both control
snapshots agree. It reads private files through no-following file descriptors, validates exact
metadata and event invariants, and retries bounded writer races. Normal polling validates only new
committed events; a complete bounded-generation audit runs every 30 seconds to detect mutation of
already cached events. A race yields `stale`, corruption yields `degraded`, and either condition
retains the last fully audited snapshot.

Status separates four independent facts:

- `source`: live spool or explicit trace;
- `sourceState`: empty or active;
- `streamHealth`: healthy, stale, or degraded;
- `coverage`: complete, incomplete, or unknown.

A reserved sequence gap or persisted publication-drop marker keeps coverage incomplete for that
generation. The marker is also best-effort: a storage failure may prevent both the event and its
marker from being written. SSE uses a per-generation HMAC stream alias plus sequence ID. Rotation
or an invalid resume ID sends one atomic snapshot reset before replay, and status and replay are
derived from the same cursor frame.

The live spool is operational UI transport, not an export artifact. Explicit traces retain their
separate audit, export, replay, and historical-dashboard lifecycle.

## Semantic trace model

Unlike the always-on spool, recording is opt-in, exportable, and scoped to one workspace. A
recording may contain multiple concurrent
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
