# AWF — Agent Waste Firewall

[한국어](README.ko.md)

Local-first live monitoring, prompt coaching, and no-progress circuit breakers for Codex and
Claude Code.

> Status: `0.1.0` research alpha with an unsigned native macOS developer preview. The live hook
> path, bounded always-on `LiveEventV1` spool, generation-aware dashboard, anonymized recorder, and
> replay work and are tested. The source tree now also contains a SwiftUI/AppKit menu-bar shell,
> local `WKWebView`, and transparent floating sentinel. It is not a signed, notarized, or packaged
> release and still needs an installed Node.js 18+ runtime. Exact token accounting, one-command
> installation, and installed Codex/Claude acceptance tests remain pending.

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
- Best-effort publishes one `LiveEventV1` for every supported hook without requiring an explicit
  recording. The closed schema accepts only enums, bounded numbers, and a per-generation HMAC
  session alias. The private spool rotates at 4,096 events, 8 MiB, or a 24-hour age trigger;
  configuration may only lower those limits.
- Records explicitly scoped workspace activity, including concurrent pseudonymous sessions, as a
  strict semantic JSONL trace using a fresh per-trace HMAC key. The key is removed when recording
  stops.
- Serves a token-protected, loopback-only dashboard from the bounded live spool by default, with an
  English-default incident timeline, Korean localization, a prompt-contract coach, and a one-click
  compact sentinel. `dashboard <trace-id>` remains available for explicit historical traces.
- Reads live generations without taking the publisher lock, validates only committed semantic
  records during steady-state polling, and periodically re-audits the complete bounded generation.
  Rotation emits an atomic reset, sequence gaps or dropped publications show incomplete coverage,
  and corruption retains the last verified projection in a red `DEGRADED` state.
- Keeps warning state independent for concurrent pseudonymous sessions. The sentinel, tab title,
  and favicon move from green to yellow to red; repeated high-severity signals also turn the
  compact background deep red.
- Provides an unsigned macOS 13+ source preview with a `MenuBarExtra`, app-owned loopback dashboard
  process, non-persistent `WKWebView`, and transparent floating `NSPanel`. The native sentinel maps
  only validated status enums and counters to clear, review, danger, critical, degraded, or offline
  presentation.
- Validates the dashboard readiness line and status response against exact closed Swift contracts,
  refuses redirects and non-exact loopback navigation, and keeps the Node detector independent of
  the app lifecycle.
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

The hook maintains the bounded raw-free live spool automatically whenever the plugin runs. Start
the live dashboard directly; no explicit recording is required:

```bash
node bin/agent-waste-firewall.mjs dashboard
```

Open the printed `127.0.0.1` URL in a browser. The URL contains a random local access token. Start
Codex or Claude Code with this plugin loaded. An empty but healthy spool is shown as connected and
waiting; live events appear as the hooks publish them.

Select `COMPACT` to leave only the magnifying-glass eye visible. Select the eye to restore the full
dashboard. A normal browser window cannot stay visible after an operating-system minimize, so the
web alpha also mirrors the state in the tab title and favicon.

### Native macOS developer preview

The repository includes an Xcode project for macOS 13 or newer. It bundles the reviewed `bin/`,
`src/`, and `assets/` directories into the app resources, but intentionally uses an installed
Node.js 18+ executable during this developer-preview phase. Build the source without signing:

```bash
AWF_DERIVED_DATA="${TMPDIR%/}/awf-derived-data"
xcodebuild \
  -project macos/AWF.xcodeproj \
  -scheme AWF \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath "$AWF_DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM= \
  build
```

This is a compile/package check, not a distributable artifact. It has no Developer ID signature,
notarization ticket, DMG, installer, or bundled Node runtime. For interactive development, open
`macos/AWF.xcodeproj` in Xcode and use local signing. The app searches explicit and standard Node
locations; `AWF_NODE_PATH` may point to an absolute regular executable for development.

An explicit research trace is still opt-in and is the only source that can be audited, exported,
or replayed. To capture one workspace:

```bash
node bin/agent-waste-firewall.mjs record start \
  --workspace /absolute/path/to/project \
  --label first-pilot \
  --mode observe

# Run Codex or Claude Code until the declared stop boundary.
node bin/agent-waste-firewall.mjs record stop
node bin/agent-waste-firewall.mjs trace list
node bin/agent-waste-firewall.mjs trace audit <trace-id>
node bin/agent-waste-firewall.mjs dashboard <trace-id>
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
outbound requests, and receives semantic events rather than raw hook payloads. Its status and SSE
endpoints share one audited cursor snapshot so a generation change cannot mix old status with new
events.

The native preview does not widen that observation boundary. Its supervisor receives one bounded,
closed `dashboard_ready` record, and its status client accepts only the closed `DashboardStatusV1`
shape. The embedded WebKit store is non-persistent and navigation is restricted to the exact
tokenized `127.0.0.1` dashboard origin. Raw prompts, tool inputs, outputs, transcripts, source
content, and detector state are never sent to Swift. The preview is not App Sandbox-contained
because it must launch an external Node executable; this is another reason it is a source preview,
not a public security-hardened build.

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

Separately, every supported hook makes a best-effort publication to the private `LiveEventV1`
spool. Each event is constructed from a closed allowlist of enums, bounded numeric counters and
durations, issue/rule IDs, and one `session_<HMAC>` alias. It contains no free text, path, file name,
wall-clock timestamp, raw provider ID, prompt, command, output, or source content. A fresh random
256-bit HMAC key is used for each spool generation, so aliases are not linkable after rotation.
The generation is replaced when it reaches the hard 4,096-event or 8 MiB ceiling. A 24-hour age
trigger is enforced by the dashboard's maintenance loop while it is open, or on the next publish,
read, or `doctor` access otherwise; an entirely idle machine cannot delete files exactly at the
deadline. Configuration can only lower these limits. This spool is short-lived presentation
transport and has no export command.

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
and orphan trace keys; `purge --all` also removes the live spool. Active hook state and an active
trace are skipped and reported; run the command again after the coding-agent session stops. Live
spool rotation removes its previous generation, key, and events. Stale locks and orphan
atomic-write files are cleaned automatically. An unsupported detector-state schema is replaced
when that session next produces a hook event, so older path-bearing state is not carried into the
new schema.

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
| `AGENT_WASTE_FIREWALL_LIVE_MAX_EVENTS` | `4096` | Maximum events in the current live-spool generation |
| `AGENT_WASTE_FIREWALL_LIVE_MAX_BYTES` | `8388608` | Maximum serialized bytes in the current live-spool generation |
| `AGENT_WASTE_FIREWALL_LIVE_MAX_AGE_MINUTES` | `1440` | Maximum age of one live-spool generation |
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
          ├──► bounded always-on LiveEventV1 spool ─► default loopback dashboard
          │                                      ├──► browser
          │                                      └──► native macOS preview
          └──► explicit trace ─► historical dashboard / audit / export / replay
```

Hooks are the enforcement path. OpenTelemetry will be the measurement path. This separation keeps
asynchronous telemetry out of low-latency decisions.

See [core architecture](docs/ARCHITECTURE.md),
[macOS product architecture](docs/MACOS-ARCHITECTURE.md),
[macOS implementation status](docs/MACOS-IMPLEMENTATION.md),
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
- A best-effort publication can be absent if the private spool is busy or unavailable. AWF marks
  known sequence gaps and drop markers as incomplete coverage, but storage failure can also prevent
  the marker itself from being written.
- The native app is currently an unsigned source build. It depends on an installed Node.js 18+
  executable and has not completed UI acceptance, Developer ID signing, notarization, clean-machine
  installation, upgrade, or uninstall testing.
- Windows hook loading has not been tested in this repository yet.
- Cross-session semantic duplicate-task detection is not implemented.

## Roadmap

1. Run an observe-only anonymized real-world pilot and publish precision/false-block results.
2. Add read-only Codex and Claude usage adapters for actual token/time measurement.
3. Add semantic tool-cycle and cross-session duplicate-task fingerprints without storing raw
   prompts.
4. Complete native UI acceptance, bundle a pinned worker runtime, and sign/notarize the
   [macOS shell](docs/MACOS-ARCHITECTURE.md).
5. Add one-command installation only after safe upgrade/uninstall behavior is tested.

## License

Apache-2.0. See [LICENSE](LICENSE).
