# macOS development guide

This guide turns the [macOS product architecture](MACOS-ARCHITECTURE.md) into an implementation
plan. English is the source language for public GitHub documentation; Korean README content should
summarize and link to the English source.

Native commands in this guide assume a GitHub checkout. The published npm artifact is the portable
plugin/CLI package and intentionally excludes `macos/`.

## Working principles

1. Keep the hook path local, deterministic, dependency-free, and independent of the GUI.
2. Never persist raw prompts, hook JSON, tool inputs, outputs, transcripts, or source content.
3. Build persisted/displayed events from a closed allowlist; do not save and redact.
4. Use observable progress evidence. Attribution is diagnostic evidence, not blame.
5. Keep `Stop` observation-only.
6. Ship in `observe`, prove precision, then graduate to `warn`; treat `block` as a separately gated
   policy.
7. Keep one detector engine until there is a compelling, measured reason to port it.

## Prerequisites

Current portable core:

- macOS or another contributor platform;
- Node.js 18 or newer;
- Git.

Native shell:

- a supported macOS development machine;
- the current stable Xcode capable of targeting macOS 13 or newer;
- Node.js 18 or newer for the current developer preview;
- an Apple Developer Program identity only for signed/notarized release builds.

The external-runtime hook launcher rejects symlink candidates in this alpha. For a provider
launched from a Homebrew- or Volta-only environment, set `AWF_NODE_PATH` to the underlying absolute
regular Node executable; a symlink path alone fails open.

Run the current baseline before changing anything:

```bash
npm ci
npm run check
npm test
npm run test:coverage
node bin/agent-waste-firewall.mjs doctor
node bin/agent-waste-firewall.mjs integration status --json
node bin/agent-waste-firewall.mjs replay fixtures/repeated-test-loop.jsonl
```

Do not introduce Swift or runtime packaging failures into the existing cross-platform Node checks.

Treat engine readiness and provider activity as separate facts. `doctor` may return
`engineReady: true` because the local files, runtime, and spool are healthy while
`providerInstalled` and `monitoringActive` describe two narrower facts. The one-shot CLI does not
promote retained events to current activity, so an installed plugin can coexist with
`monitoringActive: false` and `monitoring: attention`. `integration status --json` returns the
exact closed `ProviderIntegrationStatusV1` shape: two allowlisted provider records, optional
numeric versions, and closed state/activity enums. It must never include executable paths,
provider command output, configuration text, or probe errors. Synchronous and asynchronous probes
receive only the explicit caller environment after allowlist projection. The shipped CLI and
dashboard paths run Codex and Claude concurrently; each provider's version and plugin-list steps
share one three-second result budget. Timeout and thrown-error detail collapse to the same closed
`unknown` state. Dashboard shutdown aborts and kills in-flight default provider children.

Provider hook launch boundaries differ. Claude execs `/bin/sh -p` without an additional
command-evaluation shell. Provider and initial interpreter/loader startup remain outside the
launcher's post-start scrubbing boundary. Codex additionally evaluates its command string through
inherited `$SHELL -lc`, which is also outside AWF's boundary. Direct launcher acceptance and
latency benchmarks do not exercise provider dispatch, hostile initial loader state, or that outer
Codex shell. See the
[Codex command-runner source](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/command_runner.rs#L125-L164).

## Milestone plan

### M0 — Freeze the semantic contract

Goal: create a stable boundary that the native app can consume without raw data.

Implementation status: the dependency-free `LiveEventV1` schema, detector-result projection,
bounded private store, always-on hook publication, numeric decision latency, privacy fixtures,
concurrent-writer coverage, fail-open behavior, generation-aware live reader, and shared dashboard
projection are implemented. The no-argument dashboard consumes the bounded spool without an active
export recording; an explicit trace ID selects historical trace presentation.

Deliverables:

- `LiveEventV1` closed schema and validator;
- conversion from a detector result to `LiveEventV1`;
- a bounded private semantic spool;
- live-event, state, and trace version constants;
- latency instrumentation that records only numeric durations;
- fixtures for every valid event and adversarial privacy canaries;
- rotation to a new unlinkable live generation when a retention boundary is reached.

The language-neutral JSON Schemas, version registry, and synthetic positive,
productive-progress, privacy, and incompatible-version fixtures live under `protocol/`. Runtime
validation remains dependency-free. The native preview now has closed Swift readiness/status
decoders; keep their conformance tests aligned with the same public corpus without making the hook
runtime depend on a schema package.

Acceptance:

- unknown fields and free text are rejected before a write;
- concurrent hook processes do not corrupt the spool;
- an unavailable spool does not change the hook response;
- event creation plus persistence remains below 100 ms at p95;
- the dashboard runs without an active export recording.

### M1 — Native read-only shell

Goal: make the current live monitor feel like a real Mac app without changing enforcement.

Implementation status: an unsigned macOS 13+ developer preview is source-buildable. It implements
the SwiftUI lifecycle, menu bar, restricted local `WKWebView`, app-owned dashboard subprocess, and
transparent `NSPanel` sentinel. It still depends on an installed Node.js runtime. The native
sentinel decodes `ProviderIntegrationStatusV1` and remains yellow until fresh audited provider
activity is observed; retained or expired activity cannot make it green. The local `AWFTests`
target passes 39/39 with no skips, including inherited-`PATH` rejection, bounded NVM discovery,
and the real bundled worker. The prior PR head passes
the configured GitHub Node matrix, dashboard benchmark jobs, and unsigned native build/unit job.
M1 acceptance is still incomplete because a successfully materialized UI run, signed launch, and
clean-machine tests remain pending.

Deliverables:

- SwiftUI app lifecycle and `MenuBarExtra`;
- main window containing a local `WKWebView`;
- app-owned launch of the existing loopback dashboard;
- transparent floating `NSPanel` sentinel;
- green, yellow, red, and critical-red state projection;
- session selector and disconnected/degraded states;
- VoiceOver labels, keyboard access, Reduce Motion behavior, and light/dark themes.

Acceptance:

- closing the main window leaves the menu bar and configured sentinel working;
- minimizing or hiding the dashboard does not hide the sentinel;
- app termination does not break Codex or Claude Code hooks;
- a severity state clears only through progress, acknowledgement, or documented decay;
- no view receives a raw provider payload.

### M2 — Supervision and health

Goal: make failures understandable and recoverable.

Implementation status: the read-only provider reality gate is implemented. It probes Codex and
Claude Code with bounded, non-shell subprocesses, projects the result into
`ProviderIntegrationStatusV1`, and exposes the same closed meaning through `doctor`,
`integration status [--json]`, and loopback dashboard provider cards. Dashboard activity is
derived only from audited `LiveEventV1` records that arrive after the dashboard server starts.
Evidence expires after five minutes. Retained pre-start spool events and historical trace events
must not impersonate current activity. Provider installation without fresh observed delivery
therefore remains `installed_unverified`, not `active`. Provider subprocesses inherit only a
closed discovery environment. The shipped CLI/dashboard probes run providers concurrently and
give each provider one shared three-second version/list budget. Restart policy, notifications,
start-at-login, and a complete diagnostics bundle remain pending.

The bounded `integration verify <codex|claude> --timeout 60 [--json]` command is the narrower
live-delivery witness. It takes a read-only live-spool baseline, waits for a fresh audited prompt
event from the selected provider, and returns the closed `ProviderDeliveryVerificationV1`
contract. It does not call a provider CLI, install or enable a plugin, launch a provider, repair an
integration, or write provider configuration. Retained prompt events, other-provider events, and
tool events cannot satisfy the check. A timeout means no qualifying post-baseline event was
observed; it does not prove that a provider is broken. The event is local semantic evidence rather
than cryptographic provider attestation.

Deliverables:

- worker/protocol version handshake;
- provider integration status checks;
- spool validation, backpressure, retention, and recovery;
- bounded dashboard restart policy;
- rate-limited user notifications;
- explicit start-at-login toggle using `SMAppService`;
- diagnostics export containing versions, booleans, enums, and timings only.

Acceptance:

- kill/restart tests cover the app, dashboard, and worker;
- corrupt state affects one session only;
- diagnostics pass the same secret/path/free-text audit as public traces;
- “offline” is visibly different from “clear.”

### M3 — Integration manager

Goal: make installation safe and reversible for non-technical users.

Implementation status: read-only detection, a bounded live-delivery witness, and isolated Codex
and Claude acceptance runners are available, but user-owned installation management and live-provider
acceptance are not complete. On the current validation Mac, the shell-inherited CLI probe detects
Codex `0.146.0` as `needs_install` and reports Claude Code as `not_detected` on that shell `PATH`.
The native supervisor's closed search path also detects user-local Claude Code `2.1.207` as
`needs_install`. On that same Mac, `npm run acceptance:providers` passed isolated marketplace
add/install/inventory, installed-launcher execution, closed-event production, raw-canary
exclusion, and temporary-tree cleanup for both providers. Codex covers four hook events including
observation-only Stop; Claude covers five by also including failure. Productive non-nonce
counterexamples are allowed while partial raw persistence fails the gates. The runners use private
temporary provider state and do not modify global configuration.

The isolated gate deliberately does not invoke `/hooks` or approve provider trust. Installation,
enablement, hook review, and trust are user-controlled actions, and a successful install must not
be reported as active monitoring until fresh audited delivery is observed in the live dashboard.
Provider probes receive a closed environment allowlist rather than the whole parent environment.
The acceptance runner validates a system-temp parent, creates a fresh child itself, and recursively
removes only that owned child.

Run the acceptance gates on a Mac with the provider CLIs:

```bash
npm run acceptance:providers
```

A pass establishes only that the isolated package/install/direct-launcher path and privacy cleanup
worked on that machine. Actual user-owned `/hooks` review/trust, provider-driven live delivery,
upgrade, repair, rollback, and uninstall remain separate acceptance gates.

These isolated gates invoke installed launchers directly; they are not proof that a provider
registered and called the hook. Claude reports `providerDelivery: "not_tested"` explicitly. To
collect a user-controlled live-delivery witness, first complete the provider's trust
flow. Then start one of these in a normal terminal and submit a new harmless short prompt in a
separate conversation of that provider:

```bash
node bin/agent-waste-firewall.mjs integration verify codex --timeout 60
node bin/agent-waste-firewall.mjs integration verify claude --timeout 60 --json
```

The JSON form reserves stdout for one final closed result and emits a fixed
`AWF_READY provider=<codex|claude> timeoutSeconds=<1..300>` readiness line on stderr after the
baseline. Automated callers must wait for that line before submitting the fresh prompt.

Provider-specific trust and troubleshooting:

- Codex: connect the marketplace, install and enable AWF, review the AWF command hooks in `/hooks`,
  and trust the exact current hook hash. A changed hook after an upgrade can require re-review.
- Claude Code marketplace: run
  `claude plugin marketplace add thisisun/agent-waste-firewall`, then
  `claude plugin install agent-waste-firewall@agent-waste-firewall`, and run `/reload-plugins`.
  Trust is attached to the plugin source at load/install time. Claude's `/hooks` is a read-only
  inspection view, not an approval UI.
- Claude Code development checkout: `claude --plugin-dir /absolute/path/to/agent-waste-firewall`
  loads the checkout only for that new session. It is not a global installation and is not expected
  in the global `claude plugin list`; use `/reload-plugins` after hook changes.
- If nothing arrives, check plugin enablement and provider reload/restart. For Codex, check the
  current hook hash in `/hooks`. For Claude Code, inspect `/hooks` and account for
  `disableAllHooks` and enterprise `allowManagedHooksOnly`. Managed policy can exclude local plugin
  hooks even when plugin files are present.

Do not run `integration verify` from the same provider turn whose `UserPromptSubmit` event you are
trying to witness: that event precedes the command's baseline. The watcher belongs in a terminal,
and the qualifying prompt belongs in a separate provider conversation after the watcher starts.
No user-owned live-delivery pass is claimed until that manual sequence is completed and recorded
as such.

Deliverables for each provider:

- detect installed CLI/application and version;
- preview installation target;
- install only app-owned plugin files;
- guide the user through required hook review/trust;
- validate manifests and execute a harmless hook self-test;
- repair version drift;
- uninstall without deleting unrelated configuration;
- document manual install and recovery.

Codex acceptance:

- the app does not bypass hook trust;
- supported command hooks load from the packaged plugin root;
- unsupported hosted-tool gaps are stated in health UI and docs.

Claude Code acceptance:

- development checkout works with `claude --plugin-dir`;
- packaged plugin validates;
- `PostToolUseFailure` maps to the shared outcome model;
- paths with spaces work through executable/argument form.

### M4 — Measurement and evaluation

Goal: validate usefulness without inventing token numbers.

Deliverables:

- optional, read-only provider usage adapters;
- `UsageSampleV1` with actual counters and provenance;
- time/session correlation using semantic aliases or bounded time windows;
- observe-only pilot workflow;
- label format and replay report;
- false-warning, false-block, detection-latency, and completion metrics.

Acceptance:

- no adapter is required for a hook decision;
- missing usage data is displayed as unavailable, not zero;
- token savings are computed only from supported observed counters;
- the public beta gates in [Evaluation](EVALUATION.md) pass.

### M5 — Signed public beta

Goal: publish a GitHub release that works on a clean Mac.

Deliverables:

- pinned bundled worker runtime;
- universal or separately published Apple silicon/Intel artifacts;
- hardened runtime and least-privilege entitlements;
- Developer ID signing of nested code in inside-out order;
- notarization with `notarytool` and stapling;
- signed update strategy, or no automatic updater in the first beta;
- checksums, SBOM, changelog, privacy statement, security policy, and uninstall guide;
- protected GitHub release workflow.

Acceptance:

- Gatekeeper accepts the downloaded artifact on a clean test Mac;
- `codesign`, `spctl`, and stapler verification pass;
- there are no release secrets in pull-request workflows or artifacts;
- clean install, upgrade, rollback, and uninstall scenarios pass.

## Suggested implementation order

### Step 1: define `LiveEventV1` — implemented

The implementation reuses the existing trace vocabulary while keeping live events smaller than
trace events. One incident event has this exact closed shape:

```json
{
  "v": 1,
  "seq": 42,
  "elapsedMs": 3120,
  "kind": "incident",
  "platform": "codex",
  "sessionAlias": "session_0123456789abcdef0123456789abcdef",
  "mode": "warn",
  "family": "shell",
  "operation": "test",
  "outcome": "warned",
  "ruleId": "exact_tool_repeat",
  "severity": "medium",
  "attribution": "agent",
  "occurrences": 2,
  "progressVersion": 3,
  "issueIds": [],
  "incidentCountDelta": 1,
  "avoidableCallsDelta": 1,
  "decisionLatencyMs": 4
}
```

All string values are enums or the validated per-generation session alias; all remaining values are
bounded numbers or enum arrays. The validator requires the exact field set and rejects unknown
keys before persistence. Do not add:

- warning prose;
- prompt or recommendation text;
- wall-clock timestamps;
- paths or file names;
- commands, arguments, errors, or outputs;
- model, user, repository, session, turn, or tool identifiers.

The UI owns localized copy for each rule/issue ID. This makes English-default/Korean-optional
presentation possible without persisting free text. A random 256-bit HMAC key scopes session
equality to one generation and is never included in an event.

### Step 2: build the spool — implemented

`LiveEventStore` lives beside, not inside, `TraceStore`. Every supported hook publishes to it on a
best-effort basis even when no explicit recording exists.

Implemented properties:

- private directory and file modes;
- closed-schema validation before every write and after every read;
- atomic publication under concurrency;
- hard ceilings of 4,096 events and 8 MiB plus a 24-hour age trigger on next access, all
  configurable only downward;
- monotonic sequence across normal rotations within one spool lifecycle; explicit purge resets it;
- safe recovery from a partial temporary file;
- a no-op, fail-open result when publishing fails.

Each generation has its own HMAC alias key. Rotation atomically switches to the new generation and
removes the old events and key. Keep explicit trace recording unchanged: the live spool is
short-lived operational UI transport, while a trace is an opt-in audit/export/replay artifact with
a separate key lifecycle.

### Step 3: connect the dashboard projection — implemented

The validated live-spool cursor and pure semantic-event-to-dashboard projection are implemented.
The no-argument SSE/status server consumes the live spool without `record start`;
`dashboard <trace-id>` retains the historical audited-trace path. Status and replay use one atomic
cursor frame. Generation changes emit a snapshot reset, and health distinguishes empty, stale,
degraded, and incomplete-coverage states without exposing an unaudited event.

Steady-state reads validate only appended events and do not take the publish lock. A complete
bounded-generation audit runs every 30 seconds, while retention-only maintenance runs every second
while the dashboard is open. Tests cover concurrent publication/tailing, rotation, resume IDs,
sequence gaps, drop markers, corruption, invalid UTF-8, reconnect, and physical expiry cleanup.

Do not let Swift invent detector meaning. Swift receives typed IDs and numbers, then maps IDs to
localized copy and visual state.

### Step 4: scaffold the Xcode project — developer preview implemented

The project contains one macOS application target, one unit-test target, one UI-test target, and a
shared scheme under `macos/`. Current modules:

```text
App/              lifecycle, window routing, observable presentation state
Engine/           Node/worker discovery, dashboard supervisor, status client
MenuBar/          compact state and actions
Protocol/         closed readiness/status decoders and stream regression guard
Sentinel/         NSPanel controller and state renderer
Dashboard/        WKWebView and exact local navigation policy
Resources/        Info.plist and English/Korean localized copy
AWFTests/         protocol, navigation, runtime, supervisor, and projection tests
AWFUITests/       initial app-lifecycle smoke test
```

`assets/`, `bin/`, and `src/` are copied into the application as folder resources. There are no
external Swift packages. Integrations, Settings, a version handshake, and a notification sender
remain later milestones. Introduce protocol-based interfaces around those future side effects so
tests can use temporary directories and fake clocks.

The Swift process must not read or mutate `StateStore` JSON. That state contains detector-internal
metadata not approved for presentation and must have one writer: the Node worker.

### Step 5: package the worker

Developer preview:

- bundles the reviewed JavaScript worker source, dashboard source, and visual assets;
- discovers Node 18+ explicitly with a bounded direct `--version` probe, no interactive shell, and
  no inherited `PATH`;
- accepts `AWF_NODE_PATH` only as an absolute regular executable path;
- checks Volta, at most 64 strict NVM versions, and fixed standard locations;
- still needs to show the resolved executable and version in health UI;
- never assume an interactive shell `PATH`;
- fail with an actionable install message.

Public beta:

- pin an LTS runtime version, architecture, checksum, upstream signature identity, and full
  third-party license file. Node 24 is the current production LTS line; treat the exact patch as a
  release input rather than a floating URL;
- assemble the helper from reviewed source;
- place standalone Mach-O helpers in `AWF.app/Contents/Helpers`, not `Resources`;
- avoid dynamic downloads on first launch;
- sign the helper and its nested libraries;
- expose `--version`, `doctor --json`, and a protocol version;
- keep stdout machine-readable and stderr diagnostic.

The hook should launch the packaged worker through a stable native launcher under
`~/Library/Application Support/io.github.thisisun.agent-waste-firewall/integration-v1/`. The app
may be absent. Ship signed `awf-hook` and `awf-node` payloads in `Contents/Helpers`, install the
next runtime into a versioned directory, run its health and protocol checks, then atomically replace
a closed regular-file manifest. Do not use a writable `current` symlink. Retain one known-good
version for rollback. Record closed runtime IDs in a private ownership ledger and reconstruct
paths from those IDs; uninstall must remove only ledger-owned entries.

Sign from the inside out (`awf-node`, `awf-hook`, app, distribution container), never use
`codesign --deep` for signing, and include Node's complete bundled third-party `LICENSE`.
Apple documents standalone command-line tools under the app's executable-code locations and
requires every distributed executable to be signed for notarization. See
[Apple bundle structure](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFBundles/BundleTypes/BundleTypes.html),
[distribution signing](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/),
[notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[Node release status](https://nodejs.org/en/about/previous-releases), and the
[Node license](https://github.com/nodejs/node/blob/main/LICENSE).

## Test strategy

### Portable core

Every detector change requires:

- a positive waste fixture;
- a productive counterexample;
- an earliest-warning assertion;
- mode assertions for `observe`, `warn`, and `block` when applicable;
- persistence assertions proving raw fields are absent.

Every schema change requires:

- valid min/max fixtures;
- unknown-key rejection;
- free-text rejection;
- path, URL, email, credential, JWT, and private-key canaries;
- version compatibility tests;
- concurrent writer and corrupted-file tests.

### Provider contracts

Keep sanitized fixtures for:

- every supported Codex event;
- every supported Claude Code event;
- failure, interruption, missing optional fields, and additive unknown fields;
- plugin roots containing spaces and non-ASCII characters;
- a provider event the adapter intentionally ignores.

Fixtures should be synthetic. Do not copy a real user's hook payload into the repository.

### Native unit tests

Cover:

- semantic event decoding and rejection;
- severity aggregation and decay;
- session aggregation;
- disconnected versus clear state;
- spool tailing, rotation, and duplicate delivery;
- engine handshake and version mismatch;
- install plan generation and uninstall ownership checks;
- notification rate limiting;
- start-at-login state projection.

### Native UI tests

Cover:

- first launch and privacy explanation;
- English default and Korean switch;
- menu bar open/close behavior;
- compact transparent sentinel;
- yellow, red, and critical-red transitions;
- light/dark mode;
- VoiceOver labels and keyboard navigation;
- integration repair flow;
- local data purge confirmation.

### Failure and performance tests

Automate:

- app not running;
- dashboard crash/restart;
- hook process killed;
- unavailable/corrupt/full spool;
- corrupt session state;
- 2–10 concurrent sessions;
- slow filesystem;
- provider version mismatch;
- 10,000-event replay;
- cold and warm hook latency distributions.

Measure p50, p95, and p99. Do not store event content in benchmark output.

## Manual integration matrix

Run each row with a temporary project containing no secrets:

| Provider | Mode | Scenario | Expected |
| --- | --- | --- | --- |
| Codex | `observe` | Productive edit-test-edit | No blocking; progress resets repeats |
| Codex | `warn` | Same test twice without progress | Evidence warning at configured threshold |
| Codex | `block` | High-confidence repeated tool call | Pre-tool denial only |
| Claude | `observe` | Failed command then changed fix | Failure observed; progress prevents false repeat |
| Claude | `warn` | Same failure fingerprint repeatedly | Warning with environment/agent evidence |
| Both | Any | Stop event | Recorded only; no continuation |
| Both | Any | macOS app killed | Agent and hook continue |
| Both | Any | UI minimized | Menu bar/sentinel keeps current severity |

Also test an intentionally unsupported provider/tool path and ensure the UI reports incomplete
coverage rather than showing a misleading green state.

## Pull-request workflow

Keep pull requests small enough to audit one boundary at a time:

1. protocol/schema;
2. worker/storage;
3. provider adapter;
4. native presentation;
5. installer/release.

Before requesting review:

```bash
npm run check
npm test
npm run test:coverage
npm run benchmark:hook
npm run benchmark:live-spool
npm run benchmark:live-dashboard
npm run benchmark:dashboard
```

The unsigned source build and unit-only test commands are:

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

xcodebuild \
  -project macos/AWF.xcodeproj \
  -scheme AWF \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath "$AWF_DERIVED_DATA" \
  -only-testing:AWFTests \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM= \
  test
```

These commands intentionally do not sign the app. They prove neither Developer ID distribution nor
notarization. Run `AWFUITests` separately on an interactive macOS test host; the pull-request job
does not execute UI automation.

PR description checklist:

- user-visible outcome;
- trust boundary changed, or “none”;
- new persisted/displayed fields, or “none”;
- positive and counterexample fixtures;
- latency result;
- screenshots for all affected themes/severity states;
- install/upgrade/uninstall impact;
- rollback plan.

## Continuous integration

Current and recommended GitHub Actions jobs:

1. Node checks and tests on macOS and Linux with the minimum and current supported Node versions.
2. Privacy/schema adversarial suite on every pull request.
3. Unsigned Xcode build and `AWFTests` on the macOS runner. The same commands pass locally; the
   first branch result must still be observed before calling the CI gate validated.
4. UI smoke tests on protected branches or nightly runs.
5. Unsigned reproducible artifact assembly for pull requests.
6. Signed/notarized release only from a protected tag environment.

Release secrets must be unavailable to forked pull requests. Pin third-party Actions by commit SHA,
grant the workflow minimum permissions, and generate provenance/checksums after the final signed
artifact is assembled.

## Signing and notarization

For direct GitHub distribution:

1. Build a Release archive.
2. Sign nested runtime libraries and helpers, then the app bundle, with Developer ID Application.
3. Enable hardened runtime and only required entitlements.
4. Verify with `codesign --verify --strict --verbose=2`.
5. Package as a ZIP, DMG, or installer appropriate to the tested install flow.
6. Submit with `xcrun notarytool submit ... --wait`.
7. Inspect the notarization log; do not treat submission alone as success.
8. Staple and validate the ticket.
9. Test with Gatekeeper on a clean machine.
10. Publish checksums, release notes, supported versions, and uninstall instructions.

Do not use `codesign --deep` as a substitute for understanding and signing nested code.

## Open-source release checklist

- English README is authoritative; Korean README accurately summarizes it.
- `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, and privacy model are current.
- No screenshots, fixtures, logs, or traces contain user/project data.
- Architecture limitations and unsupported observation paths are explicit.
- The default build has no outbound analytics.
- Every bundled third-party component has a recorded version, license, and checksum.
- Installation is previewable and uninstall is scoped and tested.
- Changelog distinguishes detector behavior, protocol, UI, and integration changes.
- Public claims use measured results from the evaluation plan.

## Definition of done for the first macOS beta

The beta is done when a non-technical user can:

1. install the notarized app;
2. connect Codex or Claude Code with an understandable trust step;
3. see a truthful connected/degraded/offline state;
4. receive a prompt-contract suggestion before an underspecified long task;
5. see the sentinel turn yellow/red during a synthetic no-progress loop;
6. continue working if the app is closed or crashes;
7. inspect the evidence without exposing prompt, command, output, path, or source text;
8. purge local data and uninstall the integration;
9. reproduce the published evaluation on synthetic, raw-free semantic fixtures.

The `LiveEventV1` schema, privacy validator, bounded spool, validated live-spool consumer, shared
dashboard projection, fixture-driven publication tests, and closed provider reality gate are
implemented. The isolated Codex and Claude package/install/direct-launcher acceptance gates are
also implemented and have passed on the validation Mac. The bounded delivery witness is
implemented, but no
user-owned Codex or Claude Code live-delivery pass is claimed yet. The next integration work is a
reversible install/repair/uninstall manager plus actual user-owned trust and live-delivery
acceptance. It must preserve each provider's trust model and must not infer successful monitoring
from installation or retained historical events.
