# AWF — Agent Waste Firewall

[한국어](README.ko.md)

Local-first live monitoring, prompt coaching, and no-progress circuit breakers for Codex and
Claude Code.

> Status: `0.1.0` research alpha. The live hook path, anonymized recorder, replay, and local
> dashboard work and are tested. Exact token accounting and one-command installation are not
> implemented yet. Provider-shaped events pass the real hook executable, but installed Codex and
> Claude Code acceptance tests are still pending.

AWF is not another token dashboard. It answers three earlier questions:

1. Is the instruction concrete enough to execute safely?
2. Is the agent repeating work without repository progress?
3. Does the evidence point to the instruction, the agent, the environment, or the harness?

## What works today

- Checks action prompts for a target, definition of done, verification, stop conditions, and
  conflicting instructions.
- Detects exact tool-call repeats, unchanged re-reads, retries after the same failure fingerprint, repeated
  status polling, and file edit/revert oscillation.
- Resets repeat counters after observable progress such as a changed file, a newly changed tool
  result, or a new test/build result. Re-running the same passing test does not reset the counter.
- Uses separate Codex and Claude Code hook registrations so Claude's `PostToolUseFailure` is
  observed without sending an unsupported event to Codex.
- Ignores user-interrupted tool calls and distinguishes identical failures from changing failures.
- Stores hashes and detector evidence locally. Raw prompts, tool inputs, and tool outputs are not
  persisted.
- Records explicitly scoped workspace activity, including concurrent pseudonymous sessions, as a
  strict semantic JSONL trace using a fresh per-trace HMAC key. The key is removed when recording
  stops.
- Serves a token-protected, loopback-only live dashboard with an English-default incident timeline,
  a Korean language option, a prompt-contract coach, and a one-click compact sentinel. The
  sentinel, tab title, and favicon move from green to yellow to red; repeated high-severity
  signals also turn the compact background deep red.
- Performs one strict dashboard trace audit at startup, then validates only complete appended
  semantic JSONL records. Concurrent pseudonymous sessions keep independent progress and warning
  state. A failed append audit changes the sentinel to a red `DEGRADED` state while retaining only
  the last verified projection.
- Audits every semantic event against a closed schema before export and rejects unknown fields,
  free text, paths, URLs, emails, and common secret formats.
- Fails open if its hook cannot run, but shows a rate-limited warning instead of silently disabling
  protection.
- Replays anonymized semantic traces in `observe`, `warn`, and `block` modes without accessing a
  repository or running commands. Legacy synthetic hook fixtures remain supported.

## Quick start

Requirements: Node.js 18 or newer.

```bash
npm test
node bin/agent-waste-firewall.mjs doctor
node bin/agent-waste-firewall.mjs check-prompt \
  "Refactor the whole repository and keep going until it is perfect"
node bin/agent-waste-firewall.mjs replay fixtures/repeated-test-loop.jsonl
node bin/agent-waste-firewall.mjs report
```

Start a live, raw-free pilot for one repository:

```bash
node bin/agent-waste-firewall.mjs record start \
  --workspace /absolute/path/to/project \
  --label first-pilot \
  --mode observe

node bin/agent-waste-firewall.mjs dashboard
```

Open the printed `127.0.0.1` URL in a browser. The URL contains a random local access token. Start
Codex or Claude Code in the recorded workspace with this plugin loaded. The active recording mode
applies only to that workspace and overrides the default mode while the trace is active.

Select `COMPACT` to leave only the magnifying-glass eye visible. Select the eye to restore the full
dashboard. A normal browser window cannot stay visible after an operating-system minimize, so the
web alpha also mirrors the state in the tab title and favicon. A future desktop shell can reuse the
same audited semantic state for a menu-bar or tray indicator.

When the task reaches its declared stop boundary:

```bash
node bin/agent-waste-firewall.mjs record stop
node bin/agent-waste-firewall.mjs trace list
node bin/agent-waste-firewall.mjs trace audit <trace-id>
node bin/agent-waste-firewall.mjs trace export <trace-id> \
  --output ./public-semantic-trace.jsonl
node bin/agent-waste-firewall.mjs replay ./public-semantic-trace.jsonl \
  --mode warn
```

The plugin packages use the standard `.codex-plugin/plugin.json`,
`.claude-plugin/plugin.json`, and `hooks/hooks.json` locations. During development:

- Claude Code can load the checkout with `claude --plugin-dir /absolute/path/to/agent-waste-firewall`.
- Codex requires hook review and trust after the plugin is connected through a local marketplace.
  Follow the official [Codex plugin development guide](https://learn.chatgpt.com/docs/build-plugins)
  until the repository has a published marketplace entry.

No installer edits a user's global configuration in this MVP.

The dashboard is a local sidecar web app, not a cloud service. It binds only to loopback, makes no
outbound requests, and receives semantic events rather than raw hook payloads.

## Modes

Set `AGENT_WASTE_FIREWALL_MODE` before starting the coding agent:

| Mode | Behavior |
| --- | --- |
| `observe` | Record detector evidence; never add context or block. |
| `warn` | Record and inject a concise, evidence-based warning. This is the default. |
| `block` | Also deny high-confidence pre-tool repeats and severely underspecified prompts. |

`block` mode intentionally does not block ordinary re-reads or automatically continue a stopped
turn. A guard that repeatedly wakes an agent can become the loop it was meant to prevent.

## Detectors and attribution

| Rule | Evidence | Primary attribution | Default action |
| --- | --- | --- | --- |
| `prompt_contract` | Missing scope, done, verification, stop condition, or conflicting instructions | `user_instruction` | Warn |
| `exact_tool_repeat` | Same normalized tool and input, no progress in between | `agent` | Warn; deny at the block threshold |
| `unchanged_reread` | Same read/search repeated, no progress in between | `agent` | Warn |
| `retry_after_same_failure` | Same call after consecutive identical failed results and no progress | `agent` or `environment` | Warn or deny |
| `repeated_failure_result` | Same failure fingerprint at least three times | `agent` or `environment` | Warn |
| `status_polling_loop` | Same wait/status target without new state | `harness` | Warn; deny only at a high threshold |
| `edit_revert_oscillation` | File content follows an A→B→A pattern | `agent` | Warn |

Attribution is evidence, not blame. In particular, a harness polling loop must not be reported as
a bad user prompt.

## Local data and privacy

The default data directory is:

```text
~/.agent-waste-firewall/
```

State files contain:

- session-scoped keyed aliases for prompts, calls, results, file content, workspace identifiers,
  and file identities;
- prompt aliases, scores, and rule IDs;
- closed tool-family and operation labels plus tool-call/result fingerprints;
- closed numeric, boolean, enum, and alias evidence for detected rules.

State files do not contain:

- raw prompts;
- raw provider tool names, shell commands, tool arguments, or tool output;
- workspace basenames, file names, or absolute/relative paths;
- transcript text;
- detector prose or recommendations;
- source-file content.

An exported semantic trace is stricter than local detector state. It contains only closed enums,
numbers, booleans, relative elapsed time, and trace-scoped aliases for prompts, calls, results, and
file states. It contains no workspace basename, file name, relative path, detector prose, command,
output, model name, wall-clock timestamp, or local recording label.

Each recording uses a random 256-bit HMAC key. The same item remains linkable only inside that
recording so repetition can be replayed. A different trace produces different aliases, and the key
is deleted by `record stop`. This is strongly minimized pseudonymous data, not a mathematical
guarantee of anonymity: a distinctive event sequence can still reveal facts about a workflow.

Hashes are pseudonymous detector identifiers, not encryption. Protect the local data directory as
you would other developer-tool metadata.

Session state older than 30 days is deleted during normal hook activity. Change this with
`AGENT_WASTE_FIREWALL_RETENTION_DAYS`. Remove expired state immediately with
`agent-waste-firewall purge`, or all inactive session state with
`agent-waste-firewall purge --all`. The same command removes expired or inactive semantic traces
and orphan trace keys. Active hook state and an active trace are skipped and reported; run the
command again after the coding-agent session stops. Stale locks and orphan atomic-write files are
cleaned automatically. An unsupported detector-state schema is replaced when that session next
produces a hook event, so older path-bearing state is not carried into the new schema.

Override the directory with `AGENT_WASTE_FIREWALL_DATA_DIR`. The implementation uses user-only
directory and file permissions where the operating system supports them.

## Configuration

All configuration is optional:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `AGENT_WASTE_FIREWALL_MODE` | `warn` | `observe`, `warn`, or `block` |
| `AGENT_WASTE_FIREWALL_REPEAT_WARN_AT` | `3` | Identical-call warning threshold |
| `AGENT_WASTE_FIREWALL_HIGH_COST_REPEAT_WARN_AT` | `2` | Repeated test/build/release-verification warning threshold |
| `AGENT_WASTE_FIREWALL_REPEAT_BLOCK_AT` | `4` | Identical-call deny threshold |
| `AGENT_WASTE_FIREWALL_READ_WARN_AT` | `3` | Unchanged read/search warning threshold |
| `AGENT_WASTE_FIREWALL_WAIT_WARN_AT` | `3` | Wait/status warning threshold |
| `AGENT_WASTE_FIREWALL_WAIT_BLOCK_AT` | `5` | Wait/status deny threshold |
| `AGENT_WASTE_FIREWALL_FAILED_ATTEMPTS_BEFORE_BLOCK` | `2` | Failed attempts allowed before the next identical call can be denied |
| `AGENT_WASTE_FIREWALL_PROMPT_BLOCK_SCORE` | `35` | Maximum preflight score eligible for blocking |
| `AGENT_WASTE_FIREWALL_RETENTION_DAYS` | `30` | Local session-state retention period |

## Architecture

```text
Codex / Claude hook event
          │
          ▼
 tolerant event normalizer
          │
          ├── prompt contract checks
          ├── progress-aware repeat detectors
          └── causal attribution
          │
          ▼
 local detector state ───────► allow / add context / deny pre-tool
          │
          ▼
 strict semantic serializer
          │
          ├──► loopback live dashboard + prompt coach
          └──► audit / export / offline replay
```

Hooks are the enforcement path. OpenTelemetry will be the measurement path. This separation keeps
asynchronous telemetry out of low-latency decisions.

See [core architecture](docs/ARCHITECTURE.md),
[macOS product architecture](docs/MACOS-ARCHITECTURE.md),
[macOS development guide](docs/DEVELOPMENT-GUIDE.md),
[GitHub landscape and reuse decision](docs/GITHUB-BENCHMARK-2026-07-29.md),
[evaluation](docs/EVALUATION.md), the
[latest local validation report](docs/VALIDATION-REPORT-2026-07-29.md), and the
[first live pilot](docs/FIRST-PILOT.md).

## Honest limitations

- The alpha does not yet read OpenTelemetry token counters and therefore reports candidate
  avoidable calls and detection time, not a claimed number of tokens saved.
- Prompt checks are deterministic heuristics, not proof that an instruction is good.
- Shell commands that change files without using a file-edit tool may not produce a file progress
  signal until a later observation exposes the change.
- Codex hosted tools such as web search may not emit local pre/post tool hooks.
- Hook coverage is a useful guardrail, not a complete security boundary.
- Windows hook loading has not been tested in this repository yet.
- Cross-session semantic duplicate-task detection is not implemented.

## Roadmap

1. Run an observe-only anonymized real-world pilot and publish precision/false-block results.
2. Add read-only Codex and Claude usage adapters for actual token/time measurement.
3. Add semantic tool-cycle and cross-session duplicate-task fingerprints without storing raw
   prompts.
4. Package the local dashboard with the
   [documented native macOS shell](docs/MACOS-ARCHITECTURE.md) after the semantic live-event
   contract stabilizes.
5. Add one-command installation only after safe upgrade/uninstall behavior is tested.

## License

Apache-2.0. See [LICENSE](LICENSE).
